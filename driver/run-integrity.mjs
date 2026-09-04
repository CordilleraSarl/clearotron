// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — DID THE RUN'S OWN FORENSIC RECORD CHANGE WHILE A SEAT WAS RUNNING?
//
// THE EXPOSURE. built a `PreToolUse` deny-hook that refuses a seat's writes into `<runDir>/_driver/`.
// It is a `claude -p` mechanism, so it covers the anthropic engine only. On the codex engine the seat
// gets `--add-dir <runDir>` under `workspace-write` and cwd IS the run dir — and on the host this
// deployment actually runs codex on, `CLEAROTRON_CODEX_SANDBOX_BYPASS=1` is set (measured), because codex's
// own sandbox helper cannot spawn there. Net: no sandbox at all, one account, the run dir owned by the
// same user the seat runs as. A seat can author the record its own round is judged by.
//
// WHY THIS IS NOT A FILE. The obvious design writes a manifest into the run dir and compares against it.
// That is theatre: a seat that can write `_driver/` can write the manifest. The digest here lives in the
// DRIVER PROCESS'S MEMORY for the duration of one turn and is never persisted before the comparison. The
// seat cannot reach it. That is sound against everything short of compromising the driver itself, which
// is outside E13's threat model (drift and accident, not malice).
//
// WHY NOT `_driver/**`. `log.mjs` appends `run.jsonl` and `<stage>.jsonl` WHILE a turn is in flight —
// stages run concurrently — and the band server appends `reading-log.jsonl`. Hashing those would fault on
// the driver's own journalling, and an integrity check that cries wolf is one somebody turns off. The set
// below is the material a round is JUDGED by, written at known points, never continuously.
//
// ── LOG-ONLY, DELIBERATELY, FOR NOW ──────────────────────────────────────────────────────────────────
// Nothing here throws. `describeDrift` returns a record and the caller journals it. The reason is on the
// issue and it is the whole point: the claim "the frozen set does not change across a seat turn" is READ
// from the writers' call sites, not MEASURED on a running system. One run answers it. Zero legitimate
// changes ⇒ arm it to fault, with that run as the evidence its silence means something. Non-zero ⇒ the
// log names exactly which path to drop, before a single run has been blocked by a guard nobody measured.
//
// Arming this without that number would repeat the defect class it exists to catch.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";   //
import { WITNESS_FILE } from "./methodology-witness.mjs";       // — named by its writer, never retyped
import { DISPATCH_SUFFIX } from "./dispatch-record.mjs";        // — the dispatch record's own suffix

/**
 * Is this `_driver/` entry part of the frozen judged-by set?
 *
 * ONE PREDICATE, so the snapshot and any future arming decision cannot disagree about the set. Named
 * files are the driver-derived joins and receipts judgment reads; the dispatch records are what was
 * actually asked, including 's `.prev-<sha>` supersede chain.
 *
 * ──: EVERY `.jsonl` IS OUT, BY PATTERN, AND A NEW SINK IS OUT THE MOMENT IT IS CREATED ────────
 *
 * This docblock used to claim the opposite of what the function does. It said the journals were excluded
 * by name and not by pattern, so that a newly added sink would be watched by default and would have to be
 * excluded deliberately — and it called that the safe direction for a set whose job is to notice things.
 * (The sentence is not quoted here: a guard in run-integrity.test.mjs asserts its exact words are gone,
 * and quoting it to explain it would keep it alive in the file the guard reads.)
 *
 * Three things were wrong with that, measured on the tree:
 *
 *   · The name list held TWO entries, not the three the sentence claimed.
 *   · Both were already excluded by the `.jsonl` line below them, so the list decided NOTHING. Deleting
 *     it changed no behaviour, which is why it is gone.
 *   · A new `.jsonl` sink is therefore excluded by DEFAULT, not included — the unsafe direction, and the
 *     exact reverse of the promise. A sink added last night was outside the check before anybody had
 *     heard of its name.
 *
 * THE PATTERN IS RIGHT AND STAYS. This module's own header says why, and it is not a preference: every
 * `.jsonl` under `_driver/` is APPENDED WHILE A TURN IS IN FLIGHT — `log.mjs` writes `run.jsonl` and
 * `<stage>.jsonl` from concurrent stages, the band server appends `reading-log.jsonl` — so hashing them
 * would fault on the driver's own journalling. `<stage>.jsonl` cannot be excluded by name at all: the
 * stage name is open-ended, which is why a pattern was reached for in the first place. The name list was
 * the vestige of an intention; the pattern was always the mechanism.
 *
 * WHAT THE BLIND SPOT ACTUALLY COSTS, stated rather than implied: the frozen set is the tamper check on
 * `_driver/`, and NO append-only journal is inside it. That is a dozen-odd sinks across the driver, and
 * it grows without anyone deciding — two arrived on 2026-08-19 alone. The count is deliberately not
 * written here: run-integrity.test.mjs MEASURES it from the tree, with a floor so a broken enumeration
 * reds instead of reporting a small blind spot. A number in a comment is the thing that went stale last
 * time.
 *
 * PURE.
 */
export function isFrozenEntry(name) {
  const n = String(name ?? "");
  if (!n || n.endsWith(".tmp")) return false;
  // THE DECIDING LINE. Every append-only journal leaves the frozen set here — by pattern, because
  // `<stage>.jsonl` has no fixed name to exclude. Delete this and the check starts hashing files that
  // grow mid-turn, and faults on the driver's own progress.
  if (n.endsWith(".jsonl")) return false;
  return true;
}

/**
 * sha256 of every frozen entry under `<runDir>/_driver/`, keyed by name. Missing directory ⇒ an empty
 * map, which compares cleanly against a later one (everything reads as `added`, and on a first turn that
 * is exactly right). Never throws: an integrity check that can fail a run by failing itself is worse than
 * no check. An unreadable entry is recorded as `null` and compares only against another `null`.
 */
export function frozenSnapshot(runDir) {
  const out = new Map();
  if (!runDir) return out;
  const dir = driverDir(String(runDir));
  let names;
  try { names = readdirSync(dir); } catch { return out; }
  for (const n of names) {
    if (!isFrozenEntry(n)) continue;
    const p = join(dir, n);
    try {
      if (!statSync(p).isFile()) continue;
      out.set(n, createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 16));
    } catch { out.set(n, null); }
  }
  return out;
}

// ── — WHAT CHANGES BY DESIGN, AND WHY EACH ONE IS ALLOWED ────────────────────────────────────
//
// Measured on the 2026-08-18 delivered run: a clearance that finished 9/9 steps, ruled 73/73 and
// published its report would have faulted TWENTY-FIVE times. Every one was `armed: false`, so it cost
// nothing — and armed, it would have killed a clean delivery. That is the number this module's own
// header asked for ("Zero legitimate changes ⇒ arm it… Non-zero ⇒ the log names exactly which path to
// drop"), and it came back non-zero.
//
// A REASON PER ENTRY, NOT A PATH LIST. A bare list of allowed paths is indistinguishable from a list of
// paths somebody got tired of seeing, and the next reader cannot tell which entries are load-bearing.
// Each row says what writes it and why writing it mid-turn is correct, so an entry that stops being
// true can be recognised as wrong rather than merely inherited. `match` is a predicate rather than a
// string so the `.form.json` family is one row instead of a name per stage that grows it.
//
// NEITHER ENTRY WEAKENS THE SHARP EDGE. Both are files the DRIVER writes at known points in its own
// process; a seat rewriting `register-findings.json` or a dispatch record still lands in `changed` and
// still reads as a fault. What is allowed here is a driver behaviour this check did not model, not a
// class of write the threat model cares about.
export const BY_DESIGN_MUTATORS = Object.freeze([
  Object.freeze({
    name: WITNESS_FILE,
    match: (n) => n === WITNESS_FILE,
    why: "the methodology witness accumulates: stages record their doctrine reads into it AS THEY READ, "
      + "so it changes in place on almost every turn. It is the driver's own record of what was consulted, "
      + "written by the driver, and a turn during which it did NOT change would be the surprising one.",
  }),
  Object.freeze({
    name: "*.form.json",
    match: (n) => n.endsWith(".form.json"),
    why: "the form sidecars (placement, register coverage, disposition union) are written INCREMENTALLY "
      + "by design — a form is filled as its answers arrive, not published whole at the end. The driver "
      + "composes them; the seat answers into the driver, never into the file.",
  }),
]);

/** The allowlist entry that explains this name, or null. Exported so a caller can quote the reason. */
export function byDesignMutator(name) {
  const n = String(name ?? "");
  return BY_DESIGN_MUTATORS.find((m) => m.match(n)) ?? null;
}

// ── — SIBLING SEATS ARE NOT INTRUDERS ────────────────────────────────────────────────────────
//
// A stage block fans out into numbered seats that run AT THE SAME TIME, and the driver writes each
// seat's dispatch record just before its turn. So every seat's window contains its siblings' records:
// on the measured run `report-card:2` reported ELEVEN additions, all of them the other fourteen
// report-card seats being dispatched around it.
//
// Additions already read as `quiet` rather than a fault, so this is not what produced the 25 — but
// leaving it unmodelled makes the addition count meaningless, and the one thing `added` is for is
// noticing a file nobody in this run should have written. A field that is eleven-of-eleven explained
// noise cannot do that job.
//
// SCOPED TO THE BLOCK AND TO DISPATCH RECORDS. `report-card:2` and `report-card:9` share a block;
// `report-card:2` and `common-law-half:a` do not. And only files named as dispatch records qualify, so
// a seat writing `report-card:9.forged.json` during its sibling's turn is still an addition.
export const stageBlock = (stage) => String(stage ?? "").split(":")[0];

/** Is `name` the dispatch record of a seat in the same stage block as `stage`? */
export function isSiblingDispatch(name, stage) {
  const n = String(name ?? "");
  const block = stageBlock(stage);
  if (!block || !n.endsWith(`.${DISPATCH_SUFFIX}`)) return false;
  const label = n.slice(0, n.indexOf(".attempt"));
  if (!label || !n.includes(".attempt")) return false;
  return stageBlock(label) === block;
}

/**
 * What changed between two snapshots of one run's frozen set.
 *
 *   `changed`  present in both, different bytes — the sharp one: something rewrote a record in place
 *   `deleted`  present before, gone after
 *   `added`    absent before, present after
 *
 * `added` is REPORTED AND NOT TREATED AS A FAULT, and the distinction matters. Concurrent stages write
 * their own dispatch records while another stage's turn is in flight, so additions are routine and
 * expected — but a seat forging a NEW `_driver/` file would also land here, so they are counted rather
 * than filtered. Which of the two the field actually carries is one of the things the log-only run is
 * there to measure. PURE.
 */
export function frozenDiff(before, after) {
  const b = before instanceof Map ? before : new Map(Object.entries(before ?? {}));
  const a = after instanceof Map ? after : new Map(Object.entries(after ?? {}));
  const changed = [], deleted = [], added = [];
  for (const [name, sha] of b) {
    if (!a.has(name)) { deleted.push(name); continue; }
    if (a.get(name) !== sha) changed.push(name);
  }
  for (const name of a.keys()) if (!b.has(name)) added.push(name);
  return { changed: changed.sort(), deleted: deleted.sort(), added: added.sort() };
}

/**
 * The journalled record for one seat turn, or null when there is nothing to say.
 *
 * Returns null on a completely quiet turn — no change, no deletion, no addition — because a row per turn
 * saying "nothing happened" would bury the rows that matter. The quiet case has to stay quiet or the
 * instrument costs more than the exposure it watches.
 *
 * `verdict` is the reading this record would get IF the check were armed, recorded now so the log-only
 * run measures the arming decision rather than just the raw deltas:
 *   "quiet"        additions only — the expected shape (a concurrent stage's dispatch record)
 *   "would-fault"  a frozen record was rewritten in place or removed while a seat was running
 * PURE.
 */
export function describeDrift(stage, before, after) {
  const d = frozenDiff(before, after);
  if (!d.changed.length && !d.deleted.length && !d.added.length) return null;

  // — CLASSIFIED HERE, NOT IN `frozenDiff`. The raw diff stays pure and stage-blind; only this
  // function knows which stage's window it is describing, and sibling-hood is a fact about that stage.
  //
  // NOTHING IS DROPPED. The explained entries keep their own fields and their own counts, so a reader
  // meeting a row still sees everything that moved — a guard that hides what it forgave teaches nobody
  // what it is forgiving, and the counts are how the next arming decision gets measured.
  const byDesign = d.changed.filter((n) => byDesignMutator(n));
  const changed = d.changed.filter((n) => !byDesignMutator(n));
  const siblings = d.added.filter((n) => isSiblingDispatch(n, stage));
  const added = d.added.filter((n) => !isSiblingDispatch(n, stage));

  // Deletions are never allowlisted. Every entry above is a file its writer REWRITES; none of them is
  // a file the driver removes mid-run, so a deletion of one is exactly as unexplained as any other.
  const wouldFault = changed.length > 0 || d.deleted.length > 0;
  return {
    event: "run-integrity",
    stage: String(stage ?? "unknown"),
    verdict: wouldFault ? "would-fault" : "quiet",
    // Capped: a pathological turn must not write a row longer than the log's own truncation.
    changed: changed.slice(0, 12),
    deleted: d.deleted.slice(0, 12),
    addedCount: added.length,
    added: added.slice(0, 8),
    byDesignCount: byDesign.length,
    byDesign: byDesign.slice(0, 8),
    siblingAddCount: siblings.length,
    // LOG-ONLY, stated in the row itself. A reader meeting this in run.jsonl must not take a
    // "would-fault" verdict as a fault that happened — nothing was blocked, and the row says so.
    armed: false,
  };
}
