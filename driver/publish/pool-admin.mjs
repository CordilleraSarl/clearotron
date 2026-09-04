#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// pool-admin.mjs — curate which runs are VISIBLE on the staff trademark index vs tucked into the collapsible
// "Archive" fold. Tags live in <poolRoot>/archive-tags.json ({ archived: ["<runId>", ...] }); a run is visible
// unless its runId is listed. This is deterministic Node (no LLM, no gateway) — it edits the sidecar and
// re-renders index.html via the SAME regenIndex the driver calls, then calls the same regenSurfaces seam
// (a no-op today — see publish/index.mjs), so the on-disk result is identical to a run's publish.
//
// Must run as the service account that owns the pool root, so what it writes carries the web-server
// group-read bit.
//
// Usage:
//   node pool-admin.mjs list                       # show every run + [shown|ARCHIVED]
//   node pool-admin.mjs archive   <id> [<id>...]    # move run(s) into the Archive fold
//   node pool-admin.mjs unarchive <id> [<id>...]    # bring run(s) back to the visible table
//   node pool-admin.mjs archive-only <id> [<id>...] # keep ONLY these visible; archive everything else
//   node pool-admin.mjs regen                       # just re-render index.html from the current tags
//   node pool-admin.mjs reassign <id> <accountKey>  # change which customer OWNS a delivered run (the
//                                                   #   meta.json customerKey every reader gates on).
//                                                   #   Needs CLEAROTRON_CUSTOMERS_DIR so the key is checked
//                                                   #   against the real roster. Moves who may open the
//                                                   #   report; the frozen report still names the
//                                                   #   original client in its prose.
//   node pool-admin.mjs link-home                   # retrofit existing reports with the "← All reports" pill
//   node pool-admin.mjs backfill-issued             # one-off: stamp meta.json issuedAt from the run dir's
//                                                   #   birthtime (mtime fallback) for runs that predate the
//                                                   #   field, then re-render. Never touches stamped metas.
//   node pool-admin.mjs republish <id> [--pool <dir>] [--run-dir <path>]
//                                                   # re-render an EXISTING run through publishReport from its
//                                                   #   archived run workspace (report.md + findings.json +
//                                                   #   _driver sidecars). --pool republishes into a scratch
//                                                   #   pool for offline verification; --run-dir bypasses the
//                                                   #   workspace discovery. NOTE: republish restamps the
//                                                   #   visible §2.9 'issued' display and re-evaluates the
//                                                   #   machine-QC checks; meta issuedAt is write-once and
//                                                   #   survives. (--internal-only is RETIRED with the client
//                                                   #   export — there is one report.)
//   node pool-admin.mjs rerender-all [--pool <dir>]
//                                                   # ONE-TIME BACKFILL: re-render every run's report.html from
//                                                   #   its workspace (after a report-chrome change). Runs with
//                                                   #   no workspace are skipped + listed. One index/staff regen
//                                                   #   at the end. Use --pool <scratch> for offline verify.
//                                                   #   (--include-client is RETIRED — there is no client twin.)
// <id> = an exact runId, or an unambiguous codename (codenames are not unique — ambiguous ones error).
// poolRoot: $CLEAROTRON_REPORTS_DIR. NO DEFAULT — unset refuses and names the variable, because this
// CLI rewrites and retires published reports and its old fallback was a deployment's real client archive.
import "../../shared/env-local.mjs";   // — FIRST: the CLEAROTRON_* translation must land before any
                                     // module-top capture below it evaluates. A call in this file's BODY
                                     // would run too late — that was the repair that left this open.
import { readdirSync, readFileSync, writeFileSync, existsSync, chmodSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { regenIndex, regenSurfaces, readArchivedSet, updateArchived, runOrder, publishReport } from './index.mjs';
import { homeButton } from './render.mjs';
import { republishRun } from './report-registry.mjs';
import { config } from '../driver.config.mjs';
import { isEntrypoint } from "../../shared/is-entrypoint.mjs";   // — one entry-point test, all spellings
import { envFrom } from "../../shared/env-aliases.mjs";   // — resolves EITHER spelling; names the retired one because that is the live-writable half

// One derivation, not a second copy of the literal: config.poolRoot IS the answer, and it refuses when
// CLEAROTRON_REPORTS_DIR is unset. This file used to spell `|| '/srv/trademark-archive'` itself, which
// meant a change to the driver's default left this CLI still writing into the archive.
const POOL = config.poolRoot;

// Every run in the pool (a dir with a meta.json), as the parsed meta. Mirrors regenIndex's scan filter and
// shares its comparator so the CLI listing and the rendered index can never order differently.
function listRuns(poolDir) {
  return readdirSync(poolDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== 'customer' && existsSync(join(poolDir, d.name, 'meta.json')))
    .map(d => JSON.parse(readFileSync(join(poolDir, d.name, 'meta.json'), 'utf8')))
    .sort(runOrder);
}

// Resolve a user token to a runId: exact runId wins; else an exact codename match (error if ambiguous/none).
function resolveId(token, runs) {
  if (runs.some(r => r.runId === token)) return token;
  const byCode = runs.filter(r => (r.codename || '') === token);
  if (byCode.length === 1) return byCode[0].runId;
  if (byCode.length > 1) {
    throw new Error(`"${token}" is an ambiguous codename (${byCode.map(r => r.runId).join(', ')}) — pass the full runId.`);
  }
  throw new Error(`no run matches "${token}" (not a runId or known codename).`);
}

// Inject the floating "← All reports" pill right after <body> into an ALREADY-rendered report (idempotent —
// skips if the homebtn marker is already present). Layout-agnostic: it does not depend on the report's frozen
// CSS or internal structure, only on the <body> tag every report has. Returns the new HTML, or null if it
// can't/needn't inject (no body, or already present).
function injectHome(html, href) {
  if (html.includes('class="homebtn')) return null;            // already retrofitted / natively rendered
  const i = html.indexOf('<body');
  if (i < 0) return null;
  const close = html.indexOf('>', i);
  if (close < 0) return null;
  return html.slice(0, close + 1) + '\n' + homeButton(href) + html.slice(close + 1);
}

// Retrofit existing reports across the pool with the home pill. report.html → the staff index
// (../index.html). One report (spec 2026-07-30 §5): stale report.client.html files in old pool dirs are
// dead bytes nothing links to — this deliberately leaves them alone rather than retrofitting them.
function linkHome(poolDir) {
  const runs = listRuns(poolDir);
  let done = 0, skipped = 0;
  for (const r of runs) {
    const p = join(poolDir, r.runId, 'report.html');
    if (!existsSync(p)) continue;
    const out = injectHome(readFileSync(p, 'utf8'), '../index.html');
    if (out == null) { skipped++; continue; }
    writeFileSync(p, out);
    try { chmodSync(p, 0o640); } catch { /* best-effort; group-read via set-gid pool */ }
    done++;
  }
  console.log(`link-home: injected into ${done} report(s), ${skipped} already had it / no body`);
}

// Locate an archived run's WORKSPACE dir (the publishReport input set: raw report.md, findings.json,
// _driver/ sidecars) across every agent workspace. Layout (pipeline archive step):
//   <workspaceRoot>/<workspacePrefix><agent>/studio/prelim-search/archive/<month|legacy-*>/<matter-slug>/<date-codename>/
// where `<matter-slug>-<date-codename>` === runId. Returns every match (ambiguity is the caller's error).
// The roots route through driver.config.mjs's workspace helpers (never inline the `workspace-` literal —
// a deployment picks its own prefix via CLEAROTRON_WORKSPACE_PREFIX / CLEAROTRON_WORK_DIR).
function findArchivedRunDirs(runId) {
  const out = [];
  const dirs = (p) => { try { return readdirSync(p, { withFileTypes: true }).filter(d => d.isDirectory()); } catch { return []; } };
  for (const ws of dirs(config.workspaceRoot)) {
    const agentId = config.agentIdFromWorkspaceName(ws.name);
    if (agentId == null) continue;
    const archiveRoot = config.archiveRootForAgent(agentId);
    for (const month of dirs(archiveRoot)) {
      const monthDir = join(archiveRoot, month.name);
      for (const matter of dirs(monthDir)) {
        for (const run of dirs(join(monthDir, matter.name))) {
          if (`${matter.name}-${run.name}` === runId) out.push(join(monthDir, matter.name, run.name));
        }
      }
    }
  }
  return out;
}

// Pull --pool/--run-dir (value flags) out of the arg tail, leaving positionals. Shared by republish
// (single) and rerender-all (batch). The retired audience flags FAIL LOUD rather than silently running a
// full republish under an operator who expected the old withholding behaviour.
function parseRepublishFlags(rest) {
  const flags = new Map(); const pos = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--internal-only' || rest[i] === '--include-client')
      throw new Error(`${rest[i]} is retired — there is ONE report now (spec 2026-07-30 §5); republish always re-renders report.html and nothing else exists to hold back.`);
    else if (rest[i] === '--pool' || rest[i] === '--run-dir') flags.set(rest[i], rest[++i]);
    else if (rest[i].startsWith('--')) throw new Error(`unknown flag ${rest[i]}`);
    else pos.push(rest[i]);
  }
  return { flags, pos };
}

// Re-render ONE run through publishReport from its archived agent WORKSPACE (report.md + findings.json +
// _driver/_records sidecars). The pool run dir keeps report.md/findings.json but NOT _driver/_records, so a
// faithful re-render must source the workspace, never the pool dir — and copyRO(src=dst) would self-truncate.
// skipRegen defers the index/staff regen to the caller.
async function doRepublish({ runId, meta, pool, runDir, skipRegen = false }) {
  if (!runDir) {
    const found = findArchivedRunDirs(runId);
    if (!found.length) throw new Error(`no archived run workspace found for ${runId} — pass --run-dir <path>.`);
    if (found.length > 1) throw new Error(`ambiguous archives for ${runId}: ${found.join(', ')} — pass --run-dir.`);
    runDir = found[0];
  }
  // Which publisher this run's shape calls for is republishRun's decision, read off the run's own meta —
  // NOT an assumption made here. This function used to call publishReport unconditionally, which meant a
  // knockout run could not be re-rendered at all: it has no report.md, so it died on the shape check with
  // "not a run workspace" for a workspace that was perfectly intact.
  return republishRun({ runId, meta, pool, poolUrl: config.poolUrl, runDir, skipRegen });
}

async function republish(rest) {
  const { flags, pos } = parseRepublishFlags(rest);
  const token = pos[0];
  if (!token) throw new Error('republish needs a runId/codename.');
  const pool = flags.get('--pool') || POOL;
  const runs = listRuns(POOL);                       // resolve codenames against the LIVE pool's metas
  const runId = resolveId(token, runs);
  const meta = runs.find(r => r.runId === runId);
  const out = await doRepublish({ runId, meta, pool, runDir: flags.get('--run-dir') });
  console.log(`republished ${runId} → ${out.poolRunDir}${pool !== POOL ? '  [scratch pool]' : ''}`);
  console.log(`machine QC: ${JSON.stringify(out.clientGate)}${out.url ? `\nurl: ${out.url}` : ''}`);
}

// Batch backfill: re-render EVERY run in the pool from its workspace — the one-time pass after a report-chrome
// change (nav/logo/toggles). Runs whose workspace is gone/ambiguous are SKIPPED and LISTED (never
// silently — they keep their frozen chrome until re-sourced). One regenIndex + regenSurfaces at the end
// (per-run skipRegen), so the index/staff pages settle once.
async function rerenderAll(rest) {
  const { flags } = parseRepublishFlags(rest);
  const pool = flags.get('--pool') || POOL;
  const runs = listRuns(POOL);
  const done = [], skipped = [];
  for (const meta of runs) {
    try {
      await doRepublish({ runId: meta.runId, meta, pool, skipRegen: true });
      done.push(meta.runId);
      console.log(`  ✓ ${meta.runId}`);
    } catch (e) {
      skipped.push(meta.runId);
      console.log(`  – ${meta.runId} — SKIPPED: ${e.message}`);
    }
  }
  const total = regenIndex(pool);
  await regenSurfaces(pool);
  console.log(`\nrerender-all: re-rendered ${done.length}/${runs.length} run(s), skipped ${skipped.length} · index + staff pages re-rendered (${total} total)`);
  if (skipped.length) console.log(`skipped (no workspace / not re-renderable): ${skipped.join(', ')}`);
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === 'republish') return republish(rest);
  if (cmd === 'rerender-all') return rerenderAll(rest);
  if (!cmd || cmd === 'list') {
    const runs = listRuns(POOL);
    const archived = readArchivedSet(POOL);
    for (const r of runs) {
      const tag = archived.has(r.runId) ? 'ARCHIVED' : 'shown   ';
      console.log(`[${tag}]  ${r.date} · ${r.codename || '?'}  (${r.runId})`);
    }
    console.log(`\n${runs.length} run(s) · ${runs.filter(r => archived.has(r.runId)).length} archived`);
    return;
  }
  if (cmd === 'regen') {
    const total = regenIndex(POOL);
    // NAMES ONLY WHAT THIS COMMAND WRITES. It used to claim "+ status/quality/feedback pages": the
    // Quality hub and its Feedback console were retired by, and `regenSurfaces` is a deliberate
    // empty seam (publish/index.mjs — removed its one writer, which never shipped in this
    // product). So the message named three pages, two of which do not exist and none of which this
    // call renders. It cost a reader a real detour, reading as evidence a Feedback page was live.
    // `surface-prose-names-what-renders.test.mjs` fails if the seam gains a writer and this stays.
    await regenSurfaces(POOL);
    console.log(`re-rendered index.html (${total} run(s))`);
    return;
  }
  if (cmd === 'backfill-issued') {
    // One-off migration for metas that predate issuedAt. Dir birthtime is a faithful proxy on this pool
    // (publishReport mkdirs the run dir at publish time); regenIndex itself stays a pure READER — the
    // backfill is an explicit curation act, exactly like archive tagging.
    const runs = listRuns(POOL);
    let stamped = 0, kept = 0;
    for (const r of runs) {
      if (r.issuedAt) { kept++; continue; }
      const dir = join(POOL, r.runId);
      const st = statSync(dir);
      const ms = (st.birthtimeMs && st.birthtimeMs > 0) ? st.birthtimeMs : st.mtimeMs;
      const metaPath = join(dir, 'meta.json');
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
      meta.issuedAt = new Date(ms).toISOString();
      writeFileSync(metaPath, JSON.stringify(meta, null, 2));
      try { chmodSync(metaPath, 0o640); } catch { /* best-effort; group-read via set-gid pool */ }
      stamped++;
    }
    const total = regenIndex(POOL);
    await regenSurfaces(POOL);
    console.log(`backfill-issued: stamped ${stamped} run(s), ${kept} already had issuedAt · index re-rendered (${total} total)`);
    return;
  }
  if (cmd === 'reassign') {
    // WHICH CUSTOMER OWNS A DELIVERED RUN. `customerKey` in meta.json is what every reader gates on:
    // scanAccountRuns resolves a row's owner from it, and the report route refuses anyone who does not
    // hold that account. Nothing else in the pool records ownership, so this one field is the whole
    // access decision for a published report.
    //
    // A CURATION ACT, deliberately shaped like backfill-issued: read the meta, change one field, write,
    // re-render. regenIndex stays a pure reader — reassignment is something a person decides, never
    // something a render infers.
    //
    // WHAT THIS DOES NOT DO, and must not be mistaken for. The delivered report is a FROZEN document
    // that names its client in the prose: the findings, the narrative and the risk-framework heading all
    // carry the original customer's name, and delivered runs are not re-rendered. So this moves WHO MAY
    // OPEN the report; it changes not one word of what they read. Reassigning a run across a real tenant
    // boundary therefore hands one customer a document that names another, which is a disclosure
    // decision and not a filing decision. The old key is printed on every run so that trade is visible
    // at the moment it is made rather than discovered later.
    const [token, target] = rest;
    if (!token || !target) throw new Error('reassign needs <runId|codename> <accountKey>.');
    // THE ROSTER MUST BE THE REAL ONE. loadProfiles() falls back to the demo roster bundled at
    // driver/profiles when CLEAROTRON_CUSTOMERS_DIR is unset, and that roster shares NOT ONE KEY with the
    // config store (driver/profiles.mjs header; the same split refused every real customer on
    // 2026-07-22). Validating against it would reject every genuine account here. The MCP door only
    // warns about this because failing closed there would be an outage; this is a one-shot curation
    // command where writing the wrong owner is worse than not running, so it refuses.
    const store = envFrom(process.env, "CLEAROTRON_CUSTOMERS_DIR");
    if (!store) {
      throw new Error(
        'CLEAROTRON_CUSTOMERS_DIR is unset, so the only roster available is the BUNDLED demo one at '
        + 'driver/profiles, which shares no keys with the config store. Point it at the config store\'s '
        + 'profiles directory and re-run — validating an account key against the wrong roster is how a '
        + 'run ends up filed under a customer nobody holds.');
    }
    const { loadProfiles } = await import('../profiles.mjs');
    const roster = [...loadProfiles({ force: true }).keys()].sort();
    if (!roster.includes(target)) {
      throw new Error(`"${target}" is not a customer in ${store} — known: ${roster.join(', ')}.`);
    }
    const runs = listRuns(POOL);
    const id = resolveId(token, runs);
    const metaPath = join(POOL, id, 'meta.json');
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    const from = meta.customerKey || 'generic';
    if (from === target) {
      console.log(`reassign: ${id} is already owned by "${target}" — nothing to do.`);
      return;
    }
    meta.customerKey = target;
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    try { chmodSync(metaPath, 0o640); } catch { /* best-effort; group-read via set-gid pool */ }
    const total = regenIndex(POOL);
    await regenSurfaces(POOL);
    console.log(`reassign: ${id}  ${from} → ${target}`);
    console.log(`  the report's own text still names "${meta.client ?? from}" — only access moved.`);
    console.log(`index.html + staff pages re-rendered (${total} run(s))`);
    return;
  }
  if (cmd === 'link-home') {
    linkHome(POOL);
    return;
  }
  if (cmd === 'archive' || cmd === 'unarchive' || cmd === 'archive-only') {
    if (!rest.length) throw new Error(`${cmd} needs at least one runId/codename.`);
    const runs = listRuns(POOL);
    const ids = rest.map(t => resolveId(t, runs));
    // — the mutation runs INSIDE the writer, over a set read immediately before the write. The
    // portal now retires runs too, and this command used to read the whole set, print, and write it
    // back: a portal retire landing in that window was simply erased. `archive`/`unarchive` are
    // deltas, so they lose nothing another writer added; `archive-only` is a whole-set operation by
    // definition and stays one.
    const archived = updateArchived(POOL, (set) => {
      if (cmd === 'archive') for (const id of ids) set.add(id);
      else if (cmd === 'unarchive') for (const id of ids) set.delete(id);
      else { // archive-only: keep exactly `ids` visible, archive the rest
        set.clear();
        const keep = new Set(ids);
        for (const r of runs) if (!keep.has(r.runId)) set.add(r.runId);
      }
      return set;
    });
    const total = regenIndex(POOL);
    await regenSurfaces(POOL);
    console.log(`${cmd}: ${ids.join(', ')}`);
    console.log(`archived now: ${archived.size}/${total} run(s) · index.html + staff pages re-rendered`);
    return;
  }
  throw new Error(`unknown command "${cmd}". Try: list | archive | unarchive | archive-only | regen | reassign | link-home | backfill-issued | republish | rerender-all`);
}

if (isEntrypoint(import.meta.url)) {
  main(process.argv.slice(2))
    .catch(e => { console.error(`pool-admin: ${e.message}`); process.exit(1); });
}
