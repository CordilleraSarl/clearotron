#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// replay-archive.mjs — validator-replay harness.
//
// Replays every file validator (verify.mjs) + the pre-delivery lint against a corpus of REAL archived
// run artifacts, and diffs the verdicts against a recorded snapshot. Purpose: a validator-touching
// change must be corpus-clean (no unintended verdict flips on any historical run) BEFORE merge —
// all five receipts-gate misfire classes (PRs /) reproduce offline this way for $0.
//
// This is a TEST/DEV tool: it never mutates run artifacts and changes no production behavior.
// The corpus contains real client matter — it stays on the machine that holds it; the snapshot
// holds verdict strings (which can include mark names in failure reasons) and therefore lives OUTSIDE
// the git tree (default: the invoking user's home).
//
// Usage (run as the user that owns the workspaces):
//   node replay-archive.mjs --update     # record the current code's verdicts as the snapshot
//   node replay-archive.mjs              # diff current verdicts vs snapshot; exit 2 on any flip
//   node replay-archive.mjs --list       # print every run × check verdict
//
// PR gate workflow: on main run --update; on the candidate branch run the diff; every flip must be
// an INTENDED fix (then --update on the merged result).
//
// Env: CLEAROTRON_REPLAY_ROOTS  colon-separated corpus roots
//        (default: <workspaceRoot>/workspace-*/studio/prelim-search — live slugs + archive/)
//      CLEAROTRON_REPLAY_SNAPSHOT  snapshot path (default: ~/.prelim-replay-snapshot.json)

import "../shared/env-local.mjs";   // — FIRST: the CLEAROTRON_* translation must land before any
                                     // module-top capture below it evaluates. A call in this file's BODY
                                     // would run too late — that was the repair that left this open.
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { DRIVER_DIR, driverDir } from "../shared/driver-dir.mjs";   //
import { homedir } from "node:os";
import { validators } from "./verify.mjs";
import { runLint, clientSummaryShape } from "./predelivery-lint.mjs";
import { config } from "./driver.config.mjs";
import { GRID_HALVES } from "./common-law-receipts.mjs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   // — one entry-point test, all spellings

// Artifact filename → verify.mjs validator key. notify receipts are trivial and skipped.
const FILE_CHECKS = {
  "matter-context.md": "matterContext",
  "variant-manifest.md": "variantManifest",
  "common-law-findings.md": "commonLaw",           // includes the receipts gate (manifest auto-read)
  "placement-recommendations.md": "placement",
  "register-findings.md": "registerFindings",
  "skeptic-flags.md": "skepticFlags",
  "narrative.md": "narrative",
  "case-law-findings.md": "caseLaw",
  "senior-eye-review.md": "seniorEyeReview",
  "report.md": "report",
  "client-summary.md": "clientSummary",
};

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const names = (p) => { try { return readdirSync(p); } catch { return []; } };

// A run dir holds at least one known artifact or a _driver/ journal.
function looksLikeRunDir(p) {
  const n = names(p);
  return n.includes(DRIVER_DIR) || n.some((f) => FILE_CHECKS[f]);
}

// Corpus roots → sorted run dirs. Layout per root (a workspace's studio/prelim-search):
//   <slug>/<date>-<codename>/                      (live slugs)
//   archive/<YYYY-MM>/<slug>/<date>-<codename>/    (archived)
export function discoverRuns(roots) {
  const runs = [];
  for (const root of roots) {
    if (!isDir(root)) continue;
    for (const slug of names(root)) {
      // _known-conflicts = the workspace-level per-mark recall store, not a matter dir.
      if (slug === "queue" || slug === "archive" || slug === "tmp" || slug === "_known-conflicts") continue;
      const slugDir = join(root, slug);
      if (!isDir(slugDir)) continue;
      for (const leaf of names(slugDir)) {
        const runDir = join(slugDir, leaf);
        if (isDir(runDir) && looksLikeRunDir(runDir)) runs.push(runDir);
      }
    }
    const archive = join(root, "archive");
    for (const month of names(archive)) {
      const monthDir = join(archive, month);
      if (!isDir(monthDir)) continue;
      for (const slug of names(monthDir)) {
        const slugDir = join(monthDir, slug);
        if (!isDir(slugDir)) continue;
        for (const leaf of names(slugDir)) {
          const runDir = join(slugDir, leaf);
          if (isDir(runDir) && looksLikeRunDir(runDir)) runs.push(runDir);
        }
      }
    }
  }
  return [...new Set(runs)].sort();
}

// Rebuild the lint's recordsByUri from the run's archived _records/*.json (A1 artifacts): every URI the
// report cites maps to its artifact filename by the same transform writeRecordArtifacts used.
const URI_RE = /\/mark\/[a-z]{2,6}\/[\w-]+/gi;
function recordsFor(runDir, reportMd) {
  const map = new Map();
  const dir = join(runDir, "_records");
  if (!isDir(dir)) return map;
  for (const uri of new Set((reportMd.match(URI_RE) ?? []).map((u) => u.toLowerCase()))) {
    const file = join(dir, uri.replace(/^\/mark\//, "").replace(/[^a-z0-9]+/gi, "-") + ".json");
    try { map.set(uri, JSON.parse(readFileSync(file, "utf8"))); } catch { /* unfetched/missing → lint flags it */ }
  }
  return map;
}

function searchedNamesFor(runDir) {
  try {
    const st = JSON.parse(readFileSync(join(runDir, "status.json"), "utf8"));
    return [...new Set([st.markName, ...((st.marks ?? []).map((m) => m?.name))].filter(Boolean))];
  } catch { return []; }
}

// R.1 reasoning-integrity primitive #1 (design document retired with the subsystem in): carry the
// reason on PASSING verdict-bearing checks too, not just failures. This makes seniorEyeReview's
// CLEAR/CONDITIONAL/BLOCKING (the reasoning headline) a diffable snapshot value — the keystone the quality
// Check reads. INTENTIONALLY widens the verdict strings (ok→ok:CLEAR, ok→ok:machine-ledger, ok→ok:clean),
// so the snapshot schema bumps 1→2 and the corpus snapshot must be re-baselined (--update) once, as an
// explicit intended step. Legacy checks that return ok("") stay bare "ok".
const verdict = (v) => (v.ok ? (v.reason ? `ok:${v.reason}` : "ok") : `fail:${v.reason}`);

// One run dir → { check: verdictString }. Pure replay — reads only.
export function replayRun(runDir) {
  const out = {};
  for (const [file, check] of Object.entries(FILE_CHECKS)) {
    const p = join(runDir, file);
    if (!existsSync(p)) continue;
    let v;
    try { v = validators[check](p, readFileSync(p, "utf8")); }
    catch (e) { v = { ok: false, reason: `validator_threw:${e.message}` }; }
    out[check] = verdict(v);
  }
  // — THE HALF FINDINGS, THE SEAT THE MEANING-SWEEP GATE ACTUALLY JUDGES. Until this, the corpus
  // gate was blind to validators.commonLawHalf: `grep half replay-archive.mjs` returned nothing, so a
  // change to the meaning-sweep gate could be "corpus-clean" while never being replayed at the one seat
  // that writes the PR section. The validator needed no change to be replayable — it is (path, content),
  // derives its half from the filename and reads its own siblings off disk.
  //
  // A COMPOSED KEY, NOT TWO FILE_CHECKS ROWS, and the difference is not cosmetic: replayRun keys its
  // output by the VALIDATOR key (`out[check] = …` above), so two rows both mapping to `commonLawHalf`
  // would collide — the second half's verdict would overwrite the first's, the snapshot would silently
  // carry one half, and the other would never be gated at all. That is an absence that reads as a pass.
  // The registerUnit loop below already solved the same problem the same way.
  for (const h of GRID_HALVES) {
    const p = join(runDir, `common-law-findings.half-${h}.md`);
    if (!existsSync(p)) continue;
    let v;
    try { v = validators.commonLawHalf(p, readFileSync(p, "utf8")); }
    catch (e) { v = { ok: false, reason: `validator_threw:${e.message}` }; }
    out[`commonLawHalf:${h}`] = verdict(v);
  }
  // register units (one verdict per axis file)
  const unitsDir = join(runDir, "register-units");
  for (const f of names(unitsDir).filter((f) => f.endsWith(".md")).sort()) {
    const p = join(unitsDir, f);
    let v;
    try { v = validators.registerUnit(p, readFileSync(p, "utf8")); }
    catch (e) { v = { ok: false, reason: `validator_threw:${e.message}` }; }
    out[`registerUnit:${basename(f, ".md")}`] = verdict(v);
  }
  // pre-delivery lint replay (the NAME(S) / client-summary class) — mirrors pipeline.mjs lintNow()
  const reportPath = join(runDir, "report.md");
  if (existsSync(reportPath)) {
    try {
      const reportMd = readFileSync(reportPath, "utf8");
      const csPath = join(runDir, "client-summary.md");
      const csMd = existsSync(csPath) ? readFileSync(csPath, "utf8") : "";
      const searchedNames = searchedNamesFor(runDir);
      const shape = clientSummaryShape(csMd);
      // WS-B: the live lint unions the run's profile platforms into its vocabulary — replay must
      // mirror it from the archived sidecar or post-WS-B runs flip live-vs-replay (pre-WS-B runs
      // have no sidecar → empty extras, verdicts unchanged).
      let extraPlatformNames = [];
      try { extraPlatformNames = JSON.parse(readFileSync(driverDir(runDir, "profile.json"), "utf8")).platforms ?? []; }
      catch { /* legacy run */ }
      const narrativeMd = existsSync(join(runDir, "narrative.md")) ? readFileSync(join(runDir, "narrative.md"), "utf8") : ""; // R.1: narrative plumbing
      // wp50/wi2 — mirror the live lint's verdict-sidecar read (pre-49 runs have none → check skipped).
      let verdictDoc = null;
      try { verdictDoc = JSON.parse(readFileSync(driverDir(runDir, "verdict.json"), "utf8")); } catch { /* legacy run */ }
      const lint = runLint({
        reportMd, clientSummaryMd: csMd, narrativeMd,
        recordsByUri: recordsFor(runDir, reportMd + "\n" + csMd),
        searchedNames,
        headerName: shape.headerName || searchedNames.join(" / "),
        ratedNames: searchedNames,
        extraPlatformNames, verdictDoc,
      });
      out.predeliveryLint = lint.failures.length === 0
        ? "ok"
        : `fail:${lint.failures.map((f) => f.id).sort().join(",")}`;
    } catch (e) { out.predeliveryLint = `fail:lint_threw:${e.message}`; }
  }
  // NOT replayed: screen-gate (needs the live provider call ledger, which rotates) — run-time only.
  return out;
}

// Snapshot diff → { changed: [{run, check, was, now}], added: [run], removed: [run] }
export function diffSnapshots(prev, curr) {
  const changed = [], added = [], removed = [];
  for (const run of Object.keys(curr).sort()) {
    if (!prev[run]) { added.push(run); continue; }
    const checks = new Set([...Object.keys(prev[run]), ...Object.keys(curr[run])]);
    for (const check of [...checks].sort()) {
      const was = prev[run][check], now = curr[run][check];
      if (was !== now) changed.push({ run, check, was: was ?? "(absent)", now: now ?? "(absent)" });
    }
  }
  for (const run of Object.keys(prev)) if (!curr[run]) removed.push(run);
  return { changed, added, removed };
}

function main() {
  const args = new Set(process.argv.slice(2));
  const snapshotPath = process.env.CLEAROTRON_REPLAY_SNAPSHOT || join(homedir(), ".prelim-replay-snapshot.json");
  const roots = process.env.CLEAROTRON_REPLAY_ROOTS
    ? process.env.CLEAROTRON_REPLAY_ROOTS.split(":").filter(Boolean)
    : names(config.workspaceRoot)
        .filter((d) => config.agentIdFromWorkspaceName(d) != null)
        .map((d) => join(config.workspaceRoot, d, "studio", "prelim-search"));

  const runDirs = discoverRuns(roots);
  if (!runDirs.length) {
    console.error(`replay-archive: no run dirs found under: ${roots.join(", ")}`);
    process.exit(1);
  }
  const curr = {};
  for (const dir of runDirs) {
    const checks = replayRun(dir);
    if (Object.keys(checks).length) curr[dir] = checks;
  }
  const nChecks = Object.values(curr).reduce((n, c) => n + Object.keys(c).length, 0);
  console.log(`replay-archive: ${Object.keys(curr).length} runs, ${nChecks} checks (screen-gate not replayable offline)`);

  if (args.has("--list")) {
    for (const [run, checks] of Object.entries(curr))
      for (const [check, v] of Object.entries(checks)) console.log(`${run} ${check} ${v}`);
  }
  if (args.has("--update")) {
    writeFileSync(snapshotPath, JSON.stringify({ schema: 2, generatedAt: new Date().toISOString(), runs: curr }, null, 2) + "\n");
    console.log(`snapshot written: ${snapshotPath}`);
    return;
  }
  let prev;
  try { prev = JSON.parse(readFileSync(snapshotPath, "utf8")).runs; }
  catch {
    console.error(`no snapshot at ${snapshotPath} — run with --update first (on the BASE code state)`);
    process.exit(1);
  }
  const { changed, added, removed } = diffSnapshots(prev, curr);
  for (const c of changed) console.log(`CHANGED ${c.run} ${c.check}: ${c.was} → ${c.now}`);
  for (const r of added) console.log(`NEW run (not in snapshot): ${r}`);
  for (const r of removed) console.log(`GONE run (in snapshot, not on disk): ${r}`);
  console.log(`verdict flips: ${changed.length}, new runs: ${added.length}, gone: ${removed.length}`);
  if (changed.length) {
    console.error("FAIL: verdict flips vs snapshot — every flip must be an intended fix (then --update).");
    process.exit(2);
  }
  console.log("corpus-clean: no verdict flips.");
}

const isMain = isEntrypoint(import.meta.url);
if (isMain) main();
