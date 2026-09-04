// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// e2e-rounds.mjs — the doors receipt as a HISTORY OF ROUNDS, and how to find a round's runs on disk.
//
// ── the defect this exists to remove ──────────────────────────────────────────────────────────
//
// 's noise floor needs the SAME scenario run twice on one commit. Until this module, `run` wrote
// `_e2e-doors-<ID>.json` holding exactly one token and `report` scoped itself to whatever token it found
// there — so the second run of a pair OVERWROTE the only record of the first round's token, and the
// first half became unreportable. Silently: `report` then described the second run, thirty seconds into
// a two-hour job, as though it were the only round, printing its in-flight state as FAILs that read like
// engine defects. Observed 2026-08-07: R2a had delivered with all ten assertions green and could not be
// named. It was recovered by hand with `evalAssertion` against the archived run dir — which is the shape
// this module makes first-class.
//
// THE SCOPING IS NOT TOUCHED. Reading two same-day rounds as one is the defect fixed, and it stays
// fixed: `report` still reads exactly ONE round, still by the `<ref>-<token>` prefix. What changes is
// that the round it excludes is now NAMEABLE — it is in the receipt, it is discoverable on disk, and
// `--round <token>` selects it.
//
// ── why a pure leaf, and not more of scripts/e2e.mjs ─────────────────────────────────────────────────
//
// `scripts/score.mjs` is deliberately OFFLINE — no provider, no queue, no door graph — so it can be
// pointed at a preserved run dir on any machine. Importing scripts/e2e.mjs to reach the receipt path or
// the token parser would drag portal-mcp-client, enqueue-schema and door-gates in behind them. So the
// receipt's format and round discovery live here, in node:fs + node:path and nothing else — the same
// reasoning queue-markers.mjs and usage-ledger.mjs already carry.
//
// ── the v1 migration is not optional ────────────────────────────────────────────────────────────────
//
// The test box `--ff-only`s from origin/main every hour. A round launched before that deploy has a v1
// receipt (`{scenario, token, doors, cases}`) sitting on disk, and dropping the migration would make it
// unreportable AT THE MOMENT OF DEPLOY — this issue's own defect, recreated by its fix. So v1 is
// normalized to v2 IN MEMORY, in one function, and nothing downstream branches on the version. The first
// `run` after deploy rewrites the file as v2; a reverted binary still parses that file, because v2 keeps
// `scenario` and each round's `cases` in the shape v1 used.

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { DRIVER_DIR } from "../shared/driver-dir.mjs";   //

export const RECEIPT_VERSION = 2;

/**
 * THE ONE receipt-path calculation. Beside the pool, not inside it: the pool is what `teardown` purges,
 * and the record of what each door said must survive that.
 */
export function receiptPath(poolRoot, id) {
  return join(String(poolRoot ?? ""), "..", `_e2e-doors-${String(id).toUpperCase()}.json`);
}

const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const iso = (ms) => new Date(ms).toISOString();

/**
 * A round, with every field present so no consumer has to guess which absences are meaningful.
 *
 * `recorded` is the one field that is not about the round but about THIS ENTRY: false means the entry
 * was written by `stampRound` for a round the receipt never held, so it carries that the round was read
 * and nothing about what the doors answered. It DEFAULTS TO TRUE, so every v1 receipt and every round
 * `run` ever appended keeps meaning what it meant.
 */
function normalizeRound(r = {}) {
  return {
    token: typeof r.token === "string" && r.token ? r.token : null,
    startedAt: typeof r.startedAt === "string" && r.startedAt ? r.startedAt : null,
    startedAtSource: r.startedAtSource ?? null,
    doors: Array.isArray(r.doors) ? r.doors : [],
    cases: Array.isArray(r.cases) ? r.cases : [],
    recorded: r.recorded !== false,
    reportedAt: r.reportedAt ?? null,
    // — WHEN IT WAS FIRST NOTICED, AND WHEN IT WAS LAST CHECKED, are two facts. `reportedAt` is
    // first-write-wins (firstWriteWins above); this carries the latest. Absent on every round written
    // before this change, which is honest: those rounds' read history was already destroyed and a
    // back-filled value would be the credible wrong number this fix exists to stop producing.
    lastReadAt: r.lastReadAt ?? null,
    reportedState: r.reportedState ?? null,
    clearedAt: r.clearedAt ?? null,
  };
}

/**
 * The receipt, as five distinguishable answers.
 *
 * ABSENT IS NOT EMPTY, and neither is UNREADABLE. A missing file, a file that cannot be read, a file
 * that does not parse and a file holding zero rounds are four different findings about a round history,
 * and collapsing them to `[]` is how a caller reports "we never looked" as "there is nothing there".
 *
 * @returns {{path, state:"absent"|"unreadable"|"torn"|"present", rounds, scenario, migrated, why}}
 */
export function readReceipt(poolRoot, id) {
  const path = receiptPath(poolRoot, id);
  if (!existsSync(path)) {
    return { path, state: "absent", rounds: [], scenario: null, migrated: false,
      why: `no receipt at ${path} — no round of this scenario has been recorded here` };
  }
  let raw;
  try { raw = readFileSync(path, "utf8"); }
  catch (e) {
    return { path, state: "unreadable", rounds: [], scenario: null, migrated: false,
      why: `${path} is on disk and could not be read (${e.code || e.message})` };
  }
  let doc;
  try { doc = JSON.parse(raw); }
  catch (e) {
    return { path, state: "torn", rounds: [], scenario: null, migrated: false,
      why: `${path} is on disk (${raw.length} bytes) and does not parse as JSON (${e.message})` };
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return { path, state: "torn", rounds: [], scenario: null, migrated: false,
      why: `${path} parses as JSON but is not a receipt object (${Array.isArray(doc) ? "an array" : typeof doc})` };
  }
  if (Array.isArray(doc.rounds)) {
    return { path, state: "present", rounds: doc.rounds.map(normalizeRound),
      scenario: doc.scenario ?? null, migrated: false, why: null };
  }
  // v1: one round, written flat. The mtime is the only start time such a file carries, and it is
  // reported AS the mtime — never as though the round had recorded its own.
  if (typeof doc.token === "string" || Array.isArray(doc.cases)) {
    let mtime = null;
    try { mtime = iso(statSync(path).mtimeMs); } catch { /* the stat is best-effort; null says so */ }
    return { path, state: "present", scenario: doc.scenario ?? null, migrated: true,
      why: `${path} is a v1 receipt (one round, written flat) — read as one round, and its start time is the FILE's mtime, not the round's own`,
      rounds: [normalizeRound({ token: doc.token, doors: doc.doors, cases: doc.cases,
        startedAt: mtime, startedAtSource: mtime ? "receipt-mtime" : null })] };
  }
  return { path, state: "torn", rounds: [], scenario: null, migrated: false,
    why: `${path} parses as JSON and carries neither \`rounds\` (v2) nor \`token\`/\`cases\` (v1) — it is not a receipt` };
}

/**
 * APPEND a round. This is the whole issue: the old write REPLACED the file.
 *
 * A torn or unreadable receipt is PRESERVED before anything is written, because the door answers it
 * holds exist nowhere else on disk — a door refusal happens inside `enqueue`, before any queue file is
 * written, so there is no marker and no `.reason` to recover them from. If the bytes cannot be
 * preserved, this REFUSES to write and says why: the new round's token is on `run`'s stdout and can be
 * recovered, the earlier rounds' door answers cannot.
 */
export function appendRound(poolRoot, id, round) {
  const cur = readReceipt(poolRoot, id);
  const path = cur.path;
  let preserved = null;
  if (cur.state === "torn" || cur.state === "unreadable") {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "");
    const to = `${path}.torn-${stamp}`;
    try { copyFileSync(path, to); preserved = to; }
    catch (e) {
      return { ok: false, path, preserved: null,
        why: `${cur.why}; and its bytes could NOT be copied to ${to} (${e.code || e.message}), so nothing was written — `
          + `this round is recorded only on stdout above, and the earlier rounds' door answers are still on disk` };
    }
  }
  const doc = { version: RECEIPT_VERSION, scenario: String(id).toUpperCase(),
    rounds: [...cur.rounds, normalizeRound(round)] };
  try { writeFileSync(path, JSON.stringify(doc, null, 2) + "\n"); }
  catch (e) { return { ok: false, path, preserved, why: `could not write ${path}: ${e.code || e.message}` }; }
  return { ok: true, path, preserved, rounds: doc.rounds.length,
    why: preserved ? `${cur.why}; its bytes were preserved at ${preserved} and a fresh receipt now holds this round ALONE` : null };
}

/**
 * Merge a patch into ONE round, matched by token. Best-effort by design and it never throws: the callers
 * are `report` (stamping that it read a round) and `teardown` (stamping that it removed the evidence),
 * and neither may fail because a receipt could not be written. It returns `why` so the caller can SAY it
 * failed rather than proceed as though it had not.
 */
/**
 * WHEN A TERMINAL WAS FIRST NOTICED IS A FACT ABOUT THE ROUND; WHEN IT WAS LAST CHECKED IS NOT.
 *
 * `stampRound` merged `{ ...r, ...patch }` with the patch winning, and `report`'s call site passes a
 * fresh `new Date().toISOString()` unconditionally — so every re-read overwrote the original
 * first-read stamp. Measured on test: 43 rounds carried both stamps and were destroyable, with gaps up
 * to 160.6 hours.
 *
 * WHY THIS ONE COULD NOT BE DEFERRED. The metric does not degrade to an ABSENCE, which an instrument
 * would catch — an absence is a finding. It degrades to a CREDIBLE WRONG NUMBER: a round genuinely
 * noticed 34 hours late reads as noticed a week late, and nothing distinguishes the artefact from the
 * real thing. And the round most exposed is the one means can never settle, so it is the most
 * likely to be re-read and its figure inflates on every attempt.
 *
 * THE PRECEDENT IS IN THIS TREE: `writeRunStatus` does first-write-wins for `startedAt`, and the A3
 * 2026-07-28 postmortem comment above it explains why. Same shape, same reason.
 *
 * BOTH FACTS SURVIVE: `reportedAt` keeps its first value; `lastReadAt` carries the latest. The
 * SETTLEMENT WORD is untouched — `reportedState` is overwritten on every read exactly as before,
 * because the stale-terminal warning keys on it rather than on `reportedAt != null`, precisely so a
 * thirty-second-early read cannot permanently silence it. That design is why this bug hid (one field
 * doing two jobs, and only the timestamp job was damaged) and it must survive intact.
 *
 * PURE.
 */
export function firstWriteWins(existing, patch) {
  const out = { ...patch };
  if (patch.reportedAt != null) {
    const had = String(existing?.reportedAt ?? "").trim();
    out.lastReadAt = patch.reportedAt;
    if (had) out.reportedAt = existing.reportedAt;
  }
  return out;
}

export function stampRound(poolRoot, id, token, patch = {}) {
  const cur = readReceipt(poolRoot, id);
  // A torn or unreadable receipt is NEVER written over here. `appendRound` preserves the bytes first
  // because it has a round to record; a stamp has nothing worth that risk.
  if (cur.state !== "present" && cur.state !== "absent") return { ok: false, path: cur.path, why: cur.why };
  const i = cur.rounds.findIndex((r) => r.token === (token ?? null));
  let rounds, appended = false;
  if (i >= 0) {
    rounds = cur.rounds.map((r, n) => (n === i ? { ...r, ...firstWriteWins(r, patch) } : r));
  } else if (token) {
    // A ROUND THE RECEIPT NEVER HELD IS STILL STAMPABLE. Otherwise a round discovered only on disk —
    // the case, where a later round overwrote the receipt, or where `run`'s own append failed —
    // could never be marked read, and the launch pre-flight would warn about it forever with no command
    // that stops it. A warning with no off switch is one the operator learns to skip.
    //
    // `recorded: false` keeps the two facts apart: this entry says the round was READ, and says nothing
    // about what its doors answered, so `report` still declines that question rather than going quiet.
    rounds = [...cur.rounds, normalizeRound({ token, recorded: false, ...patch })];
    appended = true;
  } else {
    return { ok: false, path: cur.path,
      why: `no untokened round in ${cur.path} — it knows ${cur.rounds.map((r) => r.token ?? "(untokened)").join(", ") || "no rounds at all"}, and a round with no token cannot be created` };
  }
  try { writeFileSync(cur.path, JSON.stringify({ version: RECEIPT_VERSION, scenario: String(id).toUpperCase(), rounds }, null, 2) + "\n"); }
  catch (e) { return { ok: false, path: cur.path, why: `could not write ${cur.path}: ${e.code || e.message}` }; }
  return { ok: true, path: cur.path, appended,
    why: appended ? `${cur.path} held no entry for round ${token} — one was added recording that it was read, and nothing about what its doors answered` : null };
}

/**
 * The round token carried by a submitted ref, or null.
 *
 * ANCHORED AND SHAPED, because both loosenings fail silently:
 *   - `startsWith(baseRef)` alone lets base `E2E-R0` sweep in `E2E-R0d-<token>`, and R0's five cases
 *     cross-contaminate each other's round history with nothing thrown.
 *   - dropping the hex-8 shape makes the door suffix (`cli`, `opsmcp`, `portal`, `clientmcp`) read as a
 *     token, so every door of a case becomes its own "round".
 * `newRunToken` is four CSPRNG bytes hex, which is what the shape below states.
 *
 * NOT PARSED FROM THE runId. `deriveSlug` strips every non-alphanumeric character, so `E2E-R2-2328c0a8`
 * becomes `tmpe2er22328c0a8-…` with base and token fused — recovering the token from there is guesswork
 * that happens to work on a fixture and mis-parses any base ref ending in a digit. `status.json.ref` is
 * the job's ref VERBATIM (driver/progress.mjs seeds `ref: job.ref ?? null`), and it is what
 * `queueOutcomes` already matches on.
 */
export function tokenFromRef(baseRef, ref) {
  const base = String(baseRef ?? ""), full = String(ref ?? "");
  if (!base || !full.startsWith(`${base}-`)) return null;
  const seg = full.slice(base.length + 1).split("-")[0];
  return /^[0-9a-f]{8}$/.test(seg) ? seg : null;
}

/** The refs a scenario DECLARES — one per case, or one for a single-job scenario. */
export const scenarioRefs = (s) => (s?.job ? [s.job.ref] : (s?.cases ?? []).map((c) => c?.job?.ref)).filter(Boolean);

/**
 * Every run whose ref starts with `ref`, and WHETHER THE SEARCH HAPPENED.
 *
 * Keyed on status.json, not meta.json: meta.json is written at PUBLISH time, so discovery by it finds
 * every run that succeeded and not one that failed — backwards for a teardown and for a report reached
 * for when something broke.
 *
 * `searched:false` is the field that stops "the workspace root is unset" being reported as "no runs
 * exist". A bare `[]` for both is how a round nobody looked for gets described as a round that isn't
 * there.
 */
export function findRunsByRef(ref, workspaceRoot) {
  if (!workspaceRoot) {
    return { runs: [], searched: false, why: "CLEAROTRON_WORK_DIR is unset — no directory was walked, so this is not a count of runs" };
  }
  if (!existsSync(workspaceRoot)) {
    return { runs: [], searched: false, why: `CLEAROTRON_WORK_DIR ${workspaceRoot} is unreadable — no directory was walked, so this is not a count of runs` };
  }
  const hits = [];
  const walk = (dir, depth) => {
    if (depth < 0) return;
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isFile() && e.name === "status.json") {
        const st = readJson(p);
        if (st && String(st.ref ?? "").startsWith(String(ref))) {
          let mtime = 0;
          try { mtime = statSync(p).mtimeMs; } catch { /* the sort key degrades; the hit still counts */ }
          hits.push({ runDir: dir, status: st, runId: st.runId, mtime });
        }
      } else if (e.isDirectory() && e.name !== DRIVER_DIR && e.name !== "register-units") walk(p, depth - 1);
    }
  };
  walk(workspaceRoot, 7);
  return { runs: hits.sort((a, b) => b.mtime - a.mtime), searched: true, why: null };
}

/** When a run started, and FROM WHERE — a backfilled mtime is never presented as the run's own record. */
function runStart(hit) {
  const at = hit?.status?.startedAt;
  if (typeof at === "string" && at && Number.isFinite(Date.parse(at))) return { at, source: "status" };
  if (Number.isFinite(hit?.mtime) && hit.mtime > 0) return { at: iso(hit.mtime), source: "mtime" };
  return { at: null, source: null };
}

/**
 * The rounds visible ON DISK, grouped by round token.
 *
 * `untokened` counts runs whose ref carries no round token — a pre- round, or one submitted by
 * hand. They belong to no nameable round, and saying how many there are is the difference between
 * "these are all the rounds" and "these are the rounds I could name".
 */
export function roundsFromRuns(refs, workspaceRoot) {
  const byToken = new Map();
  let searched = null, why = null, untokened = 0;
  for (const ref of refs ?? []) {
    const found = findRunsByRef(ref, workspaceRoot);
    // One workspace root, so the searched-ness is the same for every ref — but record the first reason
    // rather than assuming, and let one un-searched ref make the whole answer un-searched.
    searched = searched === null ? found.searched : (searched && found.searched);
    why = why ?? found.why;
    for (const hit of found.runs) {
      const token = tokenFromRef(ref, hit.status?.ref);
      if (!token) { untokened++; continue; }
      const start = runStart(hit);
      const cur = byToken.get(token) ?? { token, runs: [], startedAt: null, startedAtSource: null };
      cur.runs.push({ ...hit, baseRef: ref });
      // The round started when its EARLIEST run did.
      if (start.at && (!cur.startedAt || start.at < cur.startedAt)) {
        cur.startedAt = start.at; cur.startedAtSource = start.source;
      }
      byToken.set(token, cur);
    }
  }
  return { byToken, searched: searched ?? false, untokened,
    why: why ?? (searched ? null : "no ref was searched — the scenario declares none") };
}

/** Newest first, with an unknown start time sorting LAST and never comparing as NaN. */
function byStartDesc(a, b) {
  const ka = Date.parse(a.startedAt ?? ""), kb = Date.parse(b.startedAt ?? "");
  const fa = Number.isFinite(ka), fb = Number.isFinite(kb);
  if (!fa && !fb) return String(a.token).localeCompare(String(b.token));
  if (!fa) return 1;
  if (!fb) return -1;
  return kb - ka || String(a.token).localeCompare(String(b.token));
}

/**
 * One history from the two sources, newest first.
 *
 * THE RECEIPT'S OWN START TIME WINS. R0's rounds are mostly door refusals — refused inside `enqueue`,
 * before any queue file or run dir exists — so a history ordered by run dirs would show R0 as having
 * almost no rounds at all. The run dirs add the runs, and add rounds the receipt never recorded (the
 * case: a later round overwrote a v1 receipt), but they do not decide when a recorded round began.
 */
export function mergeRounds({ receiptRounds = [], diskRounds = new Map() } = {}) {
  const out = new Map();
  for (const r of receiptRounds) {
    const n = normalizeRound(r);
    // `inReceipt` is about the ROUND'S OWN RECORD — what each door answered — not about whether some
    // entry with this token exists. A stamp-only entry (`recorded: false`) says the round was read and
    // nothing more, so the reader must still be told its door answers are unrecoverable.
    out.set(n.token, { ...n, inReceipt: n.recorded, onDisk: false, runs: [] });
  }
  for (const [token, d] of diskRounds) {
    const prior = out.get(token);
    if (prior) {
      prior.onDisk = true;
      prior.runs = d.runs;
      if (!prior.startedAt) { prior.startedAt = d.startedAt; prior.startedAtSource = d.startedAtSource; }
      continue;
    }
    out.set(token, { ...normalizeRound({ token, startedAt: d.startedAt, startedAtSource: d.startedAtSource, recorded: false }),
      inReceipt: false, onDisk: true, runs: d.runs });
  }
  return [...out.values()].sort(byStartDesc);
}

/**
 * WHICH round to read.
 *
 * No token → the newest, which is exactly today's behaviour, so the scoping does not move.
 * An unknown token → an ERROR NAMING EVERY TOKEN IT KNOWS, never a fall-back to the newest. A silent
 * fall-back is this whole issue wearing a flag: `report R2 --round <mistyped>` would report the newest
 * round again and nothing would say so.
 * No rounds at all → `round: null` with a reason, which the caller reports as UNSCOPED — the pre-
 * reading, kept, because refusing to report a round that predates the receipt would lose it entirely.
 */
export function selectRound(rounds, requestedToken = null) {
  const known = (rounds ?? []).map((r) => r.token ?? "(untokened)");
  if (requestedToken) {
    const hit = (rounds ?? []).find((r) => r.token === requestedToken);
    if (hit) return { round: hit, why: `round ${requestedToken}, named with --round` };
    return { error: `no round ${requestedToken} is known for this scenario.\n`
      + `  known rounds (newest first): ${known.join(", ") || "none — neither the receipt nor the workspace holds one"}\n`
      + `  --round takes the round TOKEN, never the letter: the letters shift when a round is torn down.` };
  }
  if (!rounds?.length) return { round: null, why: "no round is known — neither the receipt nor the workspace holds one" };
  return { round: rounds[0], why: `the newest round of ${rounds.length}` };
}

/**
 * The run dir of the round BEFORE the one `runDir` belongs to — the other half of a pair.
 *
 * MATCHED ON THE DOOR, EXACTLY. `refForDoor` strips non-word characters, so the suffixes are `cli`,
 * `opsmcp`, `portal` and `clientmcp` — and `cli` is a PREFIX of `clientmcp`. A `startsWith` pairing
 * would hand the cli door the client-mcp door's run and score the wrong pair with nothing thrown. The
 * previous round's ref is composed by substituting the token into THIS run's ref, and matched by
 * equality.
 */
export function previousRunDir({ refs = [], workspaceRoot = null, runDir = null } = {}) {
  if (!runDir) return { error: "no run dir given — previousRunDir needs the run it should find the predecessor of" };
  const st = readJson(join(runDir, "status.json"));
  if (!st) return { error: `${join(runDir, "status.json")} is missing or does not parse — a run's own ref is the only way to say which round it belongs to` };
  const thisRef = String(st.ref ?? "");
  if (!thisRef) return { error: `${join(runDir, "status.json")} carries no \`ref\`, so this run belongs to no nameable round` };
  const base = (refs ?? []).find((r) => thisRef.startsWith(`${r}-`) || thisRef === r) ?? null;
  if (!base) return { error: `this run's ref ${thisRef} matches none of the scenario's declared refs (${(refs ?? []).join(", ") || "none"})` };
  const token = tokenFromRef(base, thisRef);
  if (!token) return { error: `this run's ref ${thisRef} carries no round token, so it belongs to no nameable round — a round predating the per-round token cannot be paired` };

  const disk = roundsFromRuns(refs, workspaceRoot);
  if (!disk.searched) return { error: `the workspace was NOT SEARCHED — ${disk.why}. This is not "there is no previous round".` };
  const ordered = mergeRounds({ receiptRounds: [], diskRounds: disk.byToken });
  const i = ordered.findIndex((r) => r.token === token);
  if (i < 0) return { error: `this run's own round (${token}) was not found in ${workspaceRoot} — the workspace was searched and does not hold it` };
  const prev = ordered[i + 1] ?? null;
  if (!prev) {
    return { error: `no round of this scenario started before ${token}.\n`
      + `  rounds on disk (newest first): ${ordered.map((r) => `${r.token}${r.startedAt ? ` @${r.startedAt}` : " @start unknown"}`).join(", ")}\n`
      + `  A pair needs two rounds; point --previous at a preserved run dir if the other half was torn down.` };
  }
  // The same door of the same case, one round earlier.
  const wantRef = `${base}-${prev.token}${thisRef.slice(base.length + 1 + token.length)}`;
  const cands = prev.runs.filter((r) => String(r.status?.ref ?? "") === wantRef);
  if (cands.length === 1) {
    return { dir: cands[0].runDir, token: prev.token, ref: wantRef,
      why: `round ${prev.token}${prev.startedAt ? ` (started ${prev.startedAt})` : ""}, matched on ref ${wantRef}` };
  }
  return { error: cands.length
    ? `${cands.length} runs in round ${prev.token} carry the ref ${wantRef}: ${cands.map((c) => c.runDir).join(", ")} — name one with --previous <dir>`
    : `round ${prev.token} holds no run with the ref ${wantRef}. It holds: ${prev.runs.map((r) => `${r.status?.ref} (${r.runDir})`).join(", ") || "no runs at all"}` };
}

/**
 * `R2a`, `R2b`, … — DERIVED FROM ORDERING, so a letter SHIFTS when a round is torn down or a disk-only
 * round is discovered. Print it beside the token, never instead of it, and never accept one as input.
 * Past the 26th round it counts instead of wrapping silently back to `a`.
 */
export function roundLetters(rounds) {
  // Chronological: the OLDEST round is `a`. `rounds` arrives newest first.
  const n = (rounds ?? []).length;
  return (rounds ?? []).map((_, i) => {
    const k = n - 1 - i;
    return k < 26 ? String.fromCharCode(97 + k) : `#${k + 1}`;
  });
}

// ── · THE SCENARIO FILENAME PATTERN, AND ITS ORDER ──────────────────────────────────────────────
//
// Here rather than in scripts/e2e.mjs for the reason everything else in this file is here: the harness
// is not the only reader. `scripts/compare.mjs` selects a comparison set out of the same store and is
// deliberately OFFLINE — importing scripts/e2e.mjs would drag portal-mcp-client, enqueue-schema and
// door-gates in behind one regex. docs/design/e2e-product-suite.md already names this pattern as
// "encoded TWICE" and says what happens when only one copy moves: "a new naming scheme silently yields
// an empty list". A third copy in a second script is that failure with a wider blast radius.
//
// WHY `\d+` AND NOT `\d`. A single digit is ten IDs and the store holds seven (R0–R6); needs five
// more and five does not fit in three. No letters: `loadScenario` uppercases (so `R7a` looks for
// `R7A.json`) and letters already mean CASES (`R0a`) and ROUNDS (`R2a`, from `roundLetters` above) in
// this same suite. One suffix, three meanings, is a collision rather than a convention.
export const SCENARIO_FILE = /^R\d+\.json$/;

// ── · ONE STORE, TWO TIERS ────────────────────────────────────────────────────────────────────
//
// `standing` is the suite that runs as a round. `hardening` is the one-off catalogue (R100+), each of
// which is a deep clearance costing hours and real money, gated on the owner's per-run yes.
//
// ABSENT MEANS `standing`, so the thirteen scenarios that predate this field need no edit. That default
// is REAL, not a shrug, and it prints as `standing` — never as blank. Blank is what this suite already
// uses for "cannot tell" (see `markProvenanceOf`), and showing a known value as unknown inverts that
// discipline instead of applying it.
//
// AND AN UNRECOGNISED VALUE REFUSES, which is the opposite of what `markProvenanceOf` does with an
// unrecognised `markProvenance` — deliberately, because the two fields answer different kinds of
// question. Provenance is a CLAIM about what a scenario proves, so degrading a typo to "cannot tell" is
// the honest answer and costs nothing. Tier is a SELECTION KEY: a typo that quietly resolves to the
// default either enrols an hours-long clearance into a round nobody authorised, or drops a scenario
// somebody meant to run. `"standng"` joining the standing round is the failure this refusal exists for.
export const SCENARIO_TIERS = Object.freeze(["standing", "hardening"]);
export const DEFAULT_TIER = "standing";

/**
 * The tier a scenario declares, or the default. Throws by name on anything else.
 *
 * Throws rather than returning a third state because every caller is selecting or displaying, and there
 * is no honest thing to show for a tier we cannot read: a scenario that might be either must not be
 * silently placed in one.
 */
export function tierOf(scenario) {
  const raw = scenario?.tier;
  if (raw === undefined || raw === null) return DEFAULT_TIER;
  // TYPE FIRST, and not `String(raw)`. Coercing meant `["hardening"]` stringified to "hardening" and was
  // accepted — a shape typo silently selecting a tier, which is the same failure as a spelling typo and
  // harder to see in a diff. Caught by this file's own arm before it shipped.
  if (typeof raw !== "string") throw new Error(`tier must be a string, not ${Array.isArray(raw) ? "an array" : typeof raw} `
    + `(${JSON.stringify(raw)}) — one of: ${SCENARIO_TIERS.join(", ")}`);
  const v = raw.trim();
  if (v === "") return DEFAULT_TIER;
  if (SCENARIO_TIERS.includes(v)) return v;
  throw new Error(`tier ${JSON.stringify(raw)} is not one of: ${SCENARIO_TIERS.join(", ")} `
    + `(omit the key for "${DEFAULT_TIER}" — it is the default, and a typo must never pick a tier for you)`);
}

/**
 * NUMERIC, not lexicographic. With one digit the two agreed; with two they do not, and a `have:` line
 * reading "R0, R1, R10, R11, R2" is a list an operator reads as a store that has lost R3–R9.
 */
export const byScenarioNumber = (a, b) =>
  (Number(String(a).slice(1)) - Number(String(b).slice(1))) || String(a).localeCompare(String(b));
