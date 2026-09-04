// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// declination-tool.mjs — the disk half of `record_declination`. Capture, decide, record, answer.
//
// The split is the house shape (doubt-closure-call/-tool, disposition-call/-tool): the acceptance
// boundary is PURE and lives next door in declination-call.mjs, so it tests offline and there is exactly
// one place that decides what a declination is. This half does the file work and nothing else.
//
// WHAT IT WRITES, AND WHY THE SEAM READS A JSON AND NOT A DOCUMENT: `_driver/declinations.json` is keyed
// by normalized record uri, because that is the key `record-discard.mjs` discards on. The synthesis seam
// looks a uri up and gets back the decision or nothing. No parser, no section headings, no prose
// contract between two modules — the failure mode this whole build exists to remove.
//
// NEVER THROWS on a write failure. The same doctrine as `appendDiscardRows` and the methodology witness:
// a record that cannot be kept must not fail a turn. But an unwritable ledger is REPORTED, not swallowed
// — the seat's answer says the decision was accepted and could not be stored, which is a different fact
// from a clean accept and reads differently to the next reader.
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join, basename } from "node:path";
import { driverDir, ensureDriverDir } from "../shared/driver-dir.mjs";   // — one definition of where `_driver/` is
import { acceptDeclinationCall, MAX_DECLINATIONS_PER_CALL } from "./declination-call.mjs";
import { normalizeRecordUri } from "./registry-fidelity.mjs";
import { idSetHash, priorCallWithIdSet, listGeneration } from "./call-repeat.mjs";   //
import { PARK_AFTER_REFUSALS, parkedIds, refusalCountsBy } from "./refusal-bound.mjs";   //

const CALLS_DIR = "declination-calls";
export const DECLINATION_LEDGER_NAME = "declinations.json";

export function declinationCallPaths(runDir, seq) {
  const dir = driverDir(runDir, CALLS_DIR);
  return {
    dir,
    payload: join(dir, `call-${String(seq).padStart(3, "0")}.json`),
    index: join(dir, "index.jsonl"),
    verdicts: join(dir, "verdicts.jsonl"),
    ledger: driverDir(runDir, DECLINATION_LEDGER_NAME),
  };
}

/**
 * Capture what arrived BEFORE anything is decided about it. Written whole and unfiltered — including
 * rows that will be refused and fields this transport does not accept. A payload pruned to what we
 * liked is not evidence about what was sent.
 */
// - `generation` is REQUIRED here and optional elsewhere, and the asymmetry is the whole point:
// this stage identifies rows by `row_index`, a POSITION into the spec's row list, and that spec is
// deliberately rewritten between the main and the corrective synthesis pass. The call index outlives
// both, so a match across them would compare positions into two different lists - which is the defect
// pipeline.mjs's own comment at the rewrite site exists to prevent, rebuilt one place over.
export function captureCall(runDir, seq, received, { now = () => new Date().toISOString(), generation = null } = {}) {
  const { dir, payload, index } = declinationCallPaths(runDir, seq);
  const rows = Array.isArray(received?.declinations) ? received.declinations : [];
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(payload, JSON.stringify({
      _provenance: "the typed call as RECEIVED by the tool, WHOLE — never the seat's own bytes, and never a selection: every key the recorder was handed is written, including ones this transport does not accept, because a payload pruned to what we liked is not evidence about what was sent",
      receivedAt: now(), seq, rowCount: rows.length,
          // ── — THE WHOLE CALL, not the one field this tool reads ──────────
          // This wrote `declinations` alone. A capture stamped "the typed call as RECEIVED" that records
          // one extracted field is not a record of the call, and an audit replaying it reads the
          // absent fields as a transport that never sent them. Spread LAST so the call's own keys
          // win over nothing and the meta above cannot be shadowed by a seat-supplied key.
          ...(received && typeof received === "object" && !Array.isArray(received) ? received : { declinations: rows }),
    }, null, 2) + "\n");
    appendFileSync(index, JSON.stringify({ at: now(), seq, payload: basename(payload), rowCount: rows.length,
        idSetHash: idSetHash(rows, { idField: "row_index", generation }) }) + "\n");
    return { ok: true, payload };
  } catch (e) {
    return { ok: false, payload: null, why: String(e?.message ?? e).slice(0, 200) };
  }
}

export function callsSoFar(runDir) {
  const { index } = declinationCallPaths(runDir, 0);
  try { return readFileSync(index, "utf8").split("\n").filter((l) => l.trim()).length; } catch { return 0; }
}

/**
 * The accepted set so far, keyed by normalized uri. Three-valued on purpose, like `outputMeta`:
 * `{present:false}` when no ledger exists (nothing was ever recorded — NOT the same as nothing was
 * declined), `{present:true, byUri}` when it read. An absence is a record, never a silence.
 */
export function readDeclinations(runDir) {
  const { ledger } = declinationCallPaths(runDir, 0);
  try {
    const raw = JSON.parse(readFileSync(ledger, "utf8"));
    const byUri = new Map();
    for (const d of Array.isArray(raw?.declinations) ? raw.declinations : []) {
      const u = normalizeRecordUri(d?.uri);
      if (u) byUri.set(u, d);
    }
    return { present: true, byUri, count: byUri.size };
  } catch {
    return { present: false, byUri: new Map(), count: 0 };
  }
}

/**
 * Merge newly accepted rows into the ledger. LAST DECISION WINS per uri and the supersession is kept:
 * a seat that re-states a declination after a refusal, or after a corrective, is doing the right thing,
 * and losing the earlier row would hide that it happened. `supersedes` carries the previous decision.
 */
export function appendDeclinations(runDir, accepted, { now = () => new Date().toISOString() } = {}) {
  const { ledger } = declinationCallPaths(runDir, 0);
  try {
    const prior = readDeclinations(runDir);
    const byUri = new Map(prior.byUri);
    for (const a of accepted) {
      const u = normalizeRecordUri(a?.uri);
      if (!u) continue;
      const was = byUri.get(u);
      byUri.set(u, {
        uri: u, mark: a.mark ?? null, reason: a.reason, grounds: a.grounds, recordedAt: now(),
        ...(was ? { supersedes: { reason: was.reason, grounds: was.grounds, recordedAt: was.recordedAt } } : {}),
      });
    }
    ensureDriverDir(runDir);
    writeFileSync(ledger, JSON.stringify({
      _provenance: "synthesis's own stated decision not to deliver a record that reached the findings surface (#1117). "
        + "Written by the driver from typed calls — never hand-authored, never parsed out of prose.",
      ts: now(), count: byUri.size, declinations: [...byUri.values()],
    }, null, 2) + "\n");
    return { ok: true, count: byUri.size };
  } catch (e) {
    return { ok: false, count: 0, why: String(e?.message ?? e).slice(0, 200) };
  }
}

/**
 * WHAT WAS DECIDED ABOUT A CALL, IN A SIBLING FILE — never folded into the index row.
 *
 * `index.jsonl` is written by the receiver BEFORE anything is decided, so an index line with no verdict
 * means the call died between receipt and decision. A refusal tally on that row would make the two
 * indistinguishable, which is why the verdicts live here. Disposition's transport established the shape.
 *
 * EVERY REFUSAL CARRIES `uri` AS WELL AS `row_index`, and the bound counts the FORMER. The index is a
 * position into a spec rewritten between the main and the corrective pass; the uri is the register
 * record's own identifier. Both are written because a reader of an old ledger needs to see which
 * position a refusal arrived under, and the bound needs to know which record it was about — those stop
 * being the same question the moment the spec is rewritten.
 */
export function recordDeclinationVerdict(runDir, seq, { accepted, refused } = {},
  { now = () => new Date().toISOString() } = {}) {
  const { dir, verdicts } = declinationCallPaths(runDir, seq);
  const arr = (v) => (Array.isArray(v) ? v : []);
  try {
    ensureDriverDir(runDir);
    mkdirSync(dir, { recursive: true });
    appendFileSync(verdicts, JSON.stringify({
      at: now(), seq,
      accepted: arr(accepted).map((r) => ({ uri: normalizeRecordUri(r?.uri) || "",
        row_index: Number.isInteger(r?.row_index) ? r.row_index : null,
        reason: String(r?.reason ?? "").trim() })),
      refused: arr(refused).map((r) => ({ uri: normalizeRecordUri(r?.uri) || "",
        row_index: Number.isInteger(r?.row_index) ? r.row_index : null,
        why: String(r?.why ?? "").slice(0, 400) })),
    }) + "\n");
    return { ok: true, verdicts };
  } catch (e) {
    return { ok: false, verdicts: null, why: String(e?.message ?? e).slice(0, 200) };
  }
}

/** The verdict ledger as parsed, oldest first. A bad line is SKIPPED rather than thrown on — one corrupt
 *  append must not blind the bound to the other twenty-nine. An absent ledger is an empty one. */
export function readDeclinationVerdicts(runDir) {
  const { verdicts } = declinationCallPaths(runDir, 0);
  let raw;
  try { raw = readFileSync(verdicts, "utf8"); } catch { return []; }
  const out = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); } catch { /* skipped, deliberately */ }
  }
  return out;
}

/**
 * The tool body.
 *
 * @param spec     {runDir, rows, scope} — ALL driver-supplied. `rows` is every record this synthesis pass
 *                 has on its findings surface, in the order the dispatch listed them; `scope` is
 *                 instructed-scope.json, written before any model ran. The seat contributes none of it,
 *                 which is what makes `row_index` positional and the contradiction checks trustworthy.
 * @param received the argument object as handed to this process.
 */
export function recordDeclinations(spec, received, { now = () => new Date().toISOString() } = {}) {
  const runDir = String(spec?.runDir ?? "");
  const seq = callsSoFar(runDir) + 1;
  // - the generation is the fingerprint of the LIST the row_index values point into, taken from the
  // spec the driver handed this call. Asked BEFORE the capture, which appends this call's own row.
  const generation = listGeneration(spec?.rows);
  const idSet = idSetHash(Array.isArray(received?.declinations) ? received.declinations : [],
    { idField: "row_index", generation });
  const repeatOf = priorCallWithIdSet(declinationCallPaths(runDir, 0).index, idSet);
  const capture = captureCall(runDir, seq, received, { now, generation });     // BEFORE any decision

  const decided = acceptDeclinationCall(spec, received);
  const stored = decided.accepted.length ? appendDeclinations(runDir, decided.accepted, { now }) : { ok: true, count: readDeclinations(runDir).count };

  // ── THE REFUSAL BOUND ─────────────────────────────────────────────────────────────────────
  // Computed BEFORE the answer and INCLUDING this call's own refusals, so a record crossing the bound on
  // this very call is parked now rather than one call late. Keyed on `uri`, never on `row_index` — see
  // recordDeclinationVerdict's note and refusal-bound.mjs's header for why that is not a free choice.
  //
  // THE IN-FLIGHT REFUSALS ARE NORMALIZED TO THE LEDGER'S KEY SHAPE BEFORE THEY ARE COUNTED, and this is
  // load-bearing rather than tidy. `recordDeclinationVerdict` stores `normalizeRecordUri(uri)`; the
  // objects still in hand carry the spec's raw value. Count the two together without normalizing and the
  // twenty-nine records read back from disk key differently from the one in memory, so the tally never
  // reaches the bound and the park never fires — a silent failure that looks exactly like a seat that
  // never repeated itself. It cost this file one red test to find, which is one more than it would have
  // cost to notice.
  const inFlight = { refused: decided.refused.map((r) => ({ ...r, uri: normalizeRecordUri(r?.uri) || "" })) };
  const allVerdicts = [...readDeclinationVerdicts(runDir), inFlight];
  const parked = new Set(parkedIds(allVerdicts, { idField: "uri" }));
  const refusalsByUri = refusalCountsBy(allVerdicts, { idField: "uri" });
  // A parked record LEAVES the open list, which is what lets the pass finish — the seat stops being told
  // it still owes a decision on a record it has been refused thirty times over. It is NOT recorded as
  // declined: nothing is appended to the declination ledger for it, so no count claims a decision that
  // was never made. The run reports it as undecided, which is the true and the useful answer.
  const stillOpen = decided.open.filter((r) => !parked.has(normalizeRecordUri(r?.uri) || ""));
  const parkedNow = [...parked].filter((u) => inFlight.refused.some((r) => r.uri === u));
  const vr = recordDeclinationVerdict(runDir, seq, { accepted: decided.accepted, refused: decided.refused }, { now });

  return {
    accepted: decided.accepted.length,
    refused: decided.refused,
    still_open: stillOpen,
    parked: [...parked],
    parked_refusals: Object.fromEntries([...parked].map((u) => [u, refusalsByUri[u] ?? 0])),
    ...(vr.ok ? {} : { verdict_journal_failed: vr.why }),
    offered: decided.offered,
    recorded_total: stored.count,
    limit_per_call: MAX_DECLINATIONS_PER_CALL,
    // - DETECTION ONLY, and both keys unconditional so an absence is never a claim. A match here
    // means the same row POSITIONS came back against the same list; across a spec rewrite the generation
    // differs and no match is reported, which is the honest answer rather than a confident wrong one.
    id_set: idSet,
    repeat_of: repeatOf ? repeatOf.seq : null,
    ...(capture.ok ? {} : { capture_failed: capture.why }),
    ...(stored.ok ? {} : { storage_failed: stored.why }),
    note: (vr.ok ? "" : `DRIVER FAULT: this call's verdict could not be journalled (${vr.why}) — your `
      + `decisions were still recorded, but the refusal bound cannot count what was not written, so a `
      + `record you are stuck on will not be parked. This is ours to fix, not yours. `)
      + (parkedNow.length
      ? `${parkedNow.length} record(s) reached the refusal bound (${PARK_AFTER_REFUSALS}) and are PARKED as `
        + `unresolvable — they are no longer owed and nothing further is asked of you for them. They are `
        + `NOT recorded as declined; this run will report them as undecided. `
      : "")
      + (stillOpen.length
      ? `${stillOpen.length} record(s) on your findings surface still carry no decision. Deliver each as a `
        + `finding or record a declination for it — a record that reached this surface leaves it by a stated `
        + `decision, and anything left silent is reported as a defect of this run, named per record.`
      : "every record on your findings surface now carries a decision — delivered, or declined with a ground."),
  };
}
