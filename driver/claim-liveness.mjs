// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// claim-liveness.mjs — IS A PROCESS ACTUALLY PRODUCING THIS RUN? One home for the answer.
//
// ── WHY THIS FILE EXISTS, AND WHY IT IS NOT IN runner.mjs ───────────────────────────────────────────
//
// These primitives were the runner's. The tool that DELETES — scripts/purge-runs.mjs — needs the same
// answer, and that script deliberately imports nothing from driver/ because it destroys bytes. So the
// choice was: copy the liveness rule into the delete path, or give the rule one home both can import.
// A second copy of "is this claimer alive" is the disease this codebase has paid for eight times over
// (`SKIP_DIRS`, the mark-key normalizer, `SURFACE_VERDICTS`, `kebab` — pairs that looked linked by a
// comment and had already diverged). The runner re-exports every name below, so nothing that imported
// them from there had to change.
//
// ── THE FAILURE THIS CLOSES ─────────────────────────────────────────────────────────────────────────
//
// `scripts/e2e.mjs` teardown rewrote any run whose `status.json` said `running` to `failed`, logging
// "no process was producing this run" and writing that same sentence into the reason field. NOTHING
// CHECKED IT. Not a pid, not a heartbeat, not a claim. `scripts/purge-runs.mjs` then protected live runs
// with exactly one rule — `state === "running"` — i.e. the field teardown had just overwritten. A live
// round, torn down, became purgeable, and purge's own header says removing a run mid-flight "loses work
// no retry can recover."
//
// A decision taken on a surface token while the thing itself said the opposite. The cure is not a better
// string: it is asking the process.
//
// ── THE POLARITY IS LOAD-BEARING AND IT IS NOT RESTATED HERE ────────────────────────────────────────
//
// `claimerIsAlive` declares a claimer DEAD only on POSITIVE evidence — the pid is gone, or the pid is
// alive and provably a different process. An alive pid whose starttime cannot be read counts as ALIVE.
// Every caller below composes that function rather than re-deriving its reasoning, because getting the
// direction backwards deletes a running matter.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";   // — the birth stamp where there is no /proc
import { join } from "node:path";
import { config } from "./driver.config.mjs";

// ── B2 — fail-safe claim liveness ────────────────────────────────────────────────────────────────────
// The .pid sidecar records "<pid>:<starttime>" (starttime = field 22 of /proc/<pid>/stat, the kernel's
// boot-tick birth stamp of the process), so a RECYCLED pid — pid_max is 4194304 and wraps — can never
// impersonate a dead claimer and rot its `.processing` forever. Legacy bare-pid sidecars still parse
// (starttime null → pid-aliveness is all we have, today's behavior). All exported for unit tests.
export function procStarttime(pid, readStat = undefined,
  { platform = process.platform, readPsStart = defaultReadPsStart } = {}) {
  // AN INJECTED READER IS THE CALLER'S STATEMENT ABOUT HOW TO READ, and it outranks the platform.
  //
  // Measured on macOS (, the verification run): the arm that pins the field-22
  // parse hands this function its own `readStat` and asserts the parse. With the platform deciding
  // first, that injection was silently ignored off Linux and the arm read `null` — the seam was there
  // and nothing went through it. A caller that supplies a reader is not asking which box this is.
  //
  // The platform therefore decides only the DEFAULT: no reader given, Linux reads /proc and everything
  // else asks `ps`. Production never injects, so production behaviour is unchanged.
  if (readStat || platform === "linux") {
    const read = readStat ?? ((p) => readFileSync(`/proc/${p}/stat`, "utf8"));
    try {
      const stat = read(pid);
      // comm (field 2) may itself contain spaces/parens — split AFTER the last ')'; starttime is overall
      // field 22, i.e. index 19 of the post-comm tail (state, field 3, is index 0).
      return stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/)[19] ?? null;
    } catch { return null; }
  }
  // ── — THE SAME DEFENCE WHERE THERE IS NO /proc ─────────────────────────
  //
  // Returning null here was not a neutral degradation. `claimToken` announces it and falls back to a
  // bare pid, which is a stated trade; `workerAlive` does not, and cannot — its fail-safe direction
  // reads an unreadable stamp as NOT ALIVE, so on macOS it answered false for a heartbeat the calling
  // process had written a millisecond earlier, and `drainingState` then told every reader on a
  // supervising install that nothing was draining their queue while their worker ran. That is the
  // false alarm exists to close, inverted, on the platform README.md's "Where it runs" names
  // first. Measured on the first macOS run this repository has ever had.
  //
  // `lstart` is the process's absolute start time, parsed to epoch ms: an integer, so it carries no
  // colon and the `<pid>:<starttime>` sidecar keeps its shape, and a fixed moment, so it identifies
  // the process rather than describing it (`etime` is a duration and differs between two reads of the
  // same pid). NOT MEMOISED, deliberately: a cache keyed on pid returns the dead process's stamp for
  // the recycled pid wearing its number, which is the one case this whole mechanism exists for.
  try {
    const ms = Date.parse(String(readPsStart(pid)).trim());
    return Number.isFinite(ms) ? String(ms) : null;
  } catch { return null; }
}

/** `ps` is POSIX and is on macOS. Empty stdout (no such pid) parses to NaN above, which is `null`. */
function defaultReadPsStart(pid) {
  const r = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8" });
  return r.status === 0 ? r.stdout : "";
}

export function parseClaimSidecar(text) {
  const m = /^\s*(\d+)(?::(\S+))?\s*$/.exec(String(text ?? ""));
  return m ? { pid: Number(m[1]), starttime: m[2] ?? null } : null;
}

// B2 — age of the CLAIM, not of the queue entry. The `.pid` sidecar is freshly written at every claim
// site (claimAndPrep, claimDuePostponed, takeoverClaim), so its mtime IS the claim time. The
// `.processing` marker's mtime is useless for this: rename(2) preserves mtime, so it dates from the
// manifest write at ENQUEUE and survives the whole rename chain (.json → .processing → .postponed →
// .processing). Measured that way, a job that queued or 5h-cap-postponed across a weekend read
// "over-age" on Monday while its resumed claimer was LIVE and healthy — and the over-age escape hatch
// force-took-over a concurrent RESUME of the same codename (the double-run the liveness gate exists to
// prevent). Sidecar-less legacy claims fall back to the marker mtime (their claim predates the sidecar,
// and with no .pid they are re-claimable regardless of age anyway).
export function claimAgeMs(procPath, markerPath = procPath, now = Date.now()) {
  for (const p of [`${procPath}.pid`, markerPath]) {
    try { return now - statSync(p).mtimeMs; } catch { /* next source */ }
  }
  return 0;
}

// Liveness POLARITY (deliberate, fail-safe): a claimer is declared DEAD only on POSITIVE evidence — the
// pid is gone, or the pid is alive but provably a DIFFERENT process (starttime mismatch = pid reuse). An
// alive pid whose starttime cannot be READ counts as ALIVE: re-claiming a live run would double-run a
// billable search and double-deliver to the lawyer, strictly worse than one skipped tick (the max-claim-age
// ceiling in drainQueue is the honest escape hatch for a wedge this polarity keeps alive). kill(pid,0)
// EPERM means the pid exists under another uid ⇒ alive.
export function claimerIsAlive(rec, { kill = (p, s) => process.kill(p, s), starttimeOf = procStarttime } = {}) {
  if (!rec?.pid) return false;
  let alive = false;
  try { kill(rec.pid, 0); alive = true; } catch (e) { alive = e.code === "EPERM"; }
  if (!alive) return false;
  if (!rec.starttime) return true;               // legacy bare-pid sidecar
  const current = starttimeOf(rec.pid);
  if (current == null) return true;              // unreadable stat on a live pid ⇒ ALIVE (never double-claim)
  return current === rec.starttime;              // mismatch ⇒ the pid was recycled — the claimer is dead
}

// ── THE FOUR ANSWERS, AND WHY THERE ARE FOUR ────────────────────────────────────────────────────────
//
// Three of these would be a lie by compression. Callers act the same on `alive` and `unreadable` — both
// mean HANDS OFF — but a record that cannot tell them apart cannot tell "we protected a live run" from
// "we could not look", and this shop has paid for exactly that confusion: a missing path, a permission
// error and a true zero printing identically.
//
//   alive       a claim owns this codename and its claimer answers        HANDS OFF
//   gone        a claim owns it and the claimer is provably not there     safe to correct and purge
//   unclaimed   no queue claim owns it, and every queue was accounted     no queue opinion; the caller's
//               for                                                       other rules decide
//   unreadable  a queue that EXISTS could not be listed, or a claim       HANDS OFF
//               exists with no identifiable process
//
// `unclaimed` is NOT `gone`. A pipeline started by hand never takes a queue claim, so "the queue does not
// know about it" is silence, not evidence of death. Only `gone` is positive evidence.
//
// WHY `gone`/`unreadable` AND NOT `dead`/`unknown`, WHICH IS WHAT THIS SAID FIRST. Provider doctrine
// teaches a REGISTRATION-status vocabulary — `live` / `dead` / `unknown` — about whether a trademark
// registration is in force. The guard binds a documented enumeration to whichever code vocabulary it
// overlaps, this set matched it on two tokens, and the register doctrine was then reported as teaching a
// token the code refuses. The guard was right: two unrelated vocabularies had collided under one meaning.
// Renaming was the fix, and the names are better for it — `unreadable` says WHY the answer is missing,
// which is the entire reason there are four states and not two.
export const CLAIM_LIVENESS = Object.freeze(["alive", "gone", "unclaimed", "unreadable"]);

const CLAIM_META_SUFFIXES = [".processing.meta", ".postponed.meta"];

// A claim sidecar stores the BARE codename (`mintFreshCodename`), with the date in a separate `dateISO`
// field. A run directory's leaf is `<YYYY-MM-DD>-<codename>`. So a caller holding a directory name and a
// caller holding a claim are not holding the same string, and comparing them directly finds nothing.
//
// THE MATCH IS DELIBERATELY GENEROUS, and the direction is the whole reason. Every consumer of this
// module uses a match to PROTECT — to keep a run rather than delete it. An over-match spares a run that
// did not need sparing, which costs a purge that has to be re-run. An under-match deletes a live matter.
// Codenames are also not unique across stores, which is an argument for the same generosity.
export function codenameCandidates(name) {
  const raw = String(name ?? "").trim();
  if (!raw) return [];
  const stripped = raw.replace(/^\d{4}-\d{2}-\d{2}-/, "");
  return stripped && stripped !== raw ? [raw, stripped] : [raw];
}

/**
 * Is a process producing the run under this codename?
 *
 * Returns `{ state, why }` where `state` is one of CLAIM_LIVENESS and `why` is a sentence naming the
 * evidence — it is written into an operator-facing record, so it says what was READ, not what was
 * concluded.
 *
 * Every filesystem read is injectable so the tests drive all four states without a queue on disk.
 */
export function claimLivenessForCodename(codename, {
  queueDirs = null,
  isAlive = claimerIsAlive,
  readDir = readdirSync,
  readFile = (p) => readFileSync(p, "utf8"),
} = {}) {
  const names = new Set(codenameCandidates(codename));
  const name = String(codename ?? "").trim();
  if (!names.size) return { state: "unreadable", why: "no codename to look up" };

  let dirs = queueDirs;
  if (dirs == null) {
    // A THROWING GETTER IS NOT AN EMPTY QUEUE. `config.queueDirs` scans the workspace root; if that root
    // is gone or unreadable the honest answer is that we could not look.
    try { dirs = config.queueDirs; } catch (e) { return { state: "unreadable", why: `queue dirs could not be resolved (${e?.message ?? e})` }; }
  }
  // ZERO QUEUE DIRECTORIES IS `unclaimed`, NOT `unreadable`, AND THAT CHOICE WAS MADE THE OTHER WAY FIRST.
  //
  // Reading it as `unreadable` is the instinct — an empty list is not evidence — and it broke the delete tool
  // outright: purge-runs' own suite pins a workspace root with no queues, every run came back "cannot
  // tell", and the tool kept the entire estate. A purge that spares everything whenever no queue exists is
  // not cautious, it is broken, and it would behave that way on any headless deployment.
  //
  // The resolution is the constraint this module was built under: THIS CHECK IS ADDITIVE. It may turn a
  // DELETE into a KEEP; it may never turn a KEEP into a DELETE, and where it cannot see it DEFERS to the
  // rules that were already there rather than seizing the decision. Deferring is safe here precisely
  // because nothing was removed — `state === "running"` still guards every run it always guarded.
  //
  // The genuinely dangerous case is narrower and is still caught below: a queue directory that EXISTS and
  // cannot be listed counts as unreadable and returns `unreadable`.
  if (!Array.isArray(dirs) || dirs.length === 0)
    return { state: "unclaimed", why: "no queue directories exist on this host, so no queue claim can own this run" };

  let unreadable = 0;
  for (const q of dirs) {
    let entries;
    // A queue dir we cannot list is the zero-means-pass shape sitting directly on a delete path: it would
    // answer "no claim owns this" for a queue full of live claims. Counted, and it forces `unreadable` below
    // rather than being swallowed.
    //
    // BUT ENOENT IS NOT "COULD NOT LOOK" — IT IS "NOTHING THERE", AND CONFLATING THEM BROKE THE DELETE
    // TOOL. `config.queueDirs` synthesises a path for the default agent whether or not that workspace
    // exists, so on any host without it every lookup hit ENOENT, counted itself as blind, and returned
    // `unreadable` — purge then kept the entire estate. A directory that does not exist holds no claims, and
    // that is a COMPLETE answer. Only a refused look is an incomplete one.
    //
    // This is the same rule as the sibling mistake, pointed the other way: "cannot look" must never print
    // as "nothing there", and "nothing there" must never print as "cannot look".
    try { entries = readDir(q); }
    catch (e) {
      if (e?.code === "ENOENT" || e?.code === "ENOTDIR") continue;   // no such queue ⇒ it holds no claims
      unreadable += 1;
      continue;
    }
    for (const f of entries) {
      if (!CLAIM_META_SUFFIXES.some((s) => f.endsWith(s))) continue;
      let meta;
      try { meta = JSON.parse(readFile(join(q, f))); } catch { unreadable += 1; continue; }
      if (!names.has(String(meta?.codename ?? "").trim())) continue;

      // The claim is ours. `<base>.processing.meta` → `<base>.processing.pid`, the sidecar written fresh
      // at every claim and takeover.
      const claimPath = join(q, f.replace(/\.meta$/, ""));
      let rec = null;
      try { rec = parseClaimSidecar(readFile(`${claimPath}.pid`)); } catch { /* no sidecar */ }
      if (!rec)
        return { state: "unreadable", why: `a queue claim owns codename ${name} but carries no readable .pid sidecar, so the process holding it cannot be identified` };
      return isAlive(rec)
        ? { state: "alive", why: `queue claim ${f.replace(/\.meta$/, "")} is held by pid ${rec.pid}, which answers` }
        : { state: "gone", why: `queue claim ${f.replace(/\.meta$/, "")} names pid ${rec.pid}, which is gone or has been recycled` };
    }
  }
  if (unreadable)
    return { state: "unreadable", why: `${unreadable} queue location(s) could not be read, so an absent claim for ${name} proves nothing` };
  return { state: "unclaimed", why: `every queue directory was read and none holds a claim for codename ${name}` };
}

/** HANDS OFF unless the evidence is positive. The one-line form both callers use. */
export const claimForbidsDestruction = (state) => state === "alive" || state === "unreadable";
