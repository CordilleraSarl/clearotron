// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// record_knockout_review — the knockout lane's REVIEWING pass, as a typed return path.
//
// The screening product had two stages and no reviewing pass, so a plain-language flag on a line a
// client reads was a note to whoever was fixing the run and nothing rewrote it. The clearance product's
// equivalent rides `narrative-refutation`; this is the same rule reaching the same reader on the other
// product, through the smallest stage that can carry it.
//
// WHAT THE SEAT SENDS, AND WHY IT IS AN ADDRESS AND NOT A QUOTE.
//
// Each rewrite names the field it replaces by a typed address the DRIVER measured and handed over —
// {field, mark?, index?, ordinal?} — and carries the replacement prose. It does not quote the sentence
// it is replacing. A quote has to be matched back against the record, and the matcher is then the thing
// that decides where a rewrite lands: on the clearance lane a correction the cycle cannot bind to an
// entity is declined whatever its merit, and prose-matching is how a rewrite comes to land on the wrong
// mark when two names differ only in case. The address is the join key, and it is refused by name when
// it does not resolve.
//
// EVERY KEY'S MERGE RULE, STATED BEFORE THE CODE.
//
// `rewrites[]` — merged onto the stored call BY ADDRESS. A repair turn that re-sends one address
// replaces that rewrite whole; addresses it omits survive. This is the same rule the frame and assess
// transports state for a mark row, for the same reason: a seat correcting one line should not have to
// re-send the other twenty, and a partial payload that DELETED the rest is the failure that rule exists
// to stop.
//
// `declined[]` — merged the same way, by address. A seat that read a flag and judged the word to be the
// subject rather than the profession's shorthand says so here. This is not decoration: the pass is
// handed evidence and never a verdict, so "I looked and it is fine" and "I did not look" must be
// different states in the artifact, or the residue cannot be read afterwards.
//
// AND THE PASS DECIDES NOTHING.
//
// No band, no finding, no count and no record moves. The only thing a rewrite may change is the prose
// of a default-visible line. The acceptor enforces that by construction: the address grammar cannot
// express a band, an ordinal reassignment or a new finding, so there is no payload that reaches them.
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { driverDir, DRIVER_DIR } from "../shared/driver-dir.mjs";
import { captureCall, stampVerdict } from "./call-capture.mjs";
import { refuseUndeclared as refuseUndeclaredShared, lastAccepted, acceptedEnvelope } from "./preserve-merge.mjs";
import { knockoutVisibleProse } from "./predelivery-lint.mjs";   // the walk is the authority on what a reader sees
import { plainRegisterFlags } from "./plain-register.mjs";        // the pinned rule, one copy

const SCHEMA_VERSION = 1;

/**
 * Path → the keys that path declares, in `refuseUndeclared`'s own shape.
 *
 * The top level ("") is deliberately permissive by that helper's rule — an envelope field nobody reads
 * must never kill a stage. The care is inside the typed sub-objects: a rewrite whose replacement prose
 * arrived under a key this tool does not declare would be accepted at the top level and then dropped,
 * and the artifact would say the seat rewrote a line it did not.
 */
const DECLARED = {
  "": ["schema_version", "rewrites", "declined"],
  rewrites: ["at", "text", "why"],
  "rewrites.at": ["field", "mark", "index", "ordinal"],
  declined: ["at", "why"],
  "declined.at": ["field", "mark", "index", "ordinal"],
};

/**
 * The addressable fields, and the shape each address takes.
 *
 * THE SET IS WHAT A CLIENT SEES FIRST, WHICH IS NARROWER THAN THE WALK — in two different directions,
 * and each has to be said or the next reader repairs the wrong one.
 *
 * NARROWER BY WHO WROTE IT. The engine appends two of the standing caveats itself. They are in the walk
 * because an over-long engine caveat is a real defect for whoever edits the code that emits it, and they
 * are not addressable because a rewrite there breaks a delivery-time match or appends a second copy of
 * the note, silently either way.
 *
 * NARROWER BY WHAT A READER MEETS. `marks[].registerReads[].read` is in the walk and is NOT in
 * `DEFAULT_VISIBLE_FIELDS.knockout`. The walk is the authority on what the internal lint should READ;
 * that list is the authority on what a client meets before opening anything, and this pass is scoped to
 * the second — its own instruction to the seat says "a line a reader meets before opening anything", and
 * the ruling that authorised it says the lines a client reads. So a field that is visible to the lint and
 * not on that list is outside the pass, and the pass reaches eight.
 *
 * THAT THE TWO LISTS DISAGREE AT ALL IS A SEPARATE DEFECT, and it is filed as one rather than repaired
 * here. Reconciling them is a change to what the product calls default-visible; making the pass ACT on
 * the disagreement — which is what including `registerReads` did — would settle that question as a side
 * effect of a rewrite pass, on delivered prose, with nothing recording that it had been decided.
 *
 * An arm compares the SETS rather than the counts, and names each difference. Both lists happened to
 * hold nine entries while being different nines, which is exactly how a reconciliation reads as correct
 * when it is not.
 */
export const ADDRESSABLE = Object.freeze({
  "batch.executiveSummary": Object.freeze([]),
  "batch.standardCaveats": Object.freeze(["index"]),
  basis: Object.freeze(["mark"]),
  mitigation: Object.freeze(["mark"]),
  factors: Object.freeze(["mark", "index"]),
  counterFactors: Object.freeze(["mark", "index"]),
  purpleNotes: Object.freeze(["mark", "index"]),
  "findings.net": Object.freeze(["mark", "ordinal"]),
});

/** One file per call, refusals included, beside the other transports' capture directories. */
export function knockoutReviewCallPaths(runDir) {
  const dir = driverDir(runDir, "knockout-review-calls");
  return { dir, accepted: join(dir, "accepted.json"), refusals: join(dir, "refusals.jsonl") };
}

/**
 * The artifact this transport writes, AT THE RUN ROOT.
 *
 * NOT UNDER `_driver/`, and the lane learned that the expensive way. `_driver/` is the driver's own
 * measurements and is behind a deny hook; a stage whose `out` lands there has a seat that will be
 * refused on Write and on Bash, and a corrective ladder that exhausts against a dispatch ordering a
 * write nothing permits. The assess chunk was relocated out of it for exactly that reason. This file is
 * a MODEL output — the seat's rewrites — so the run root is where it belongs by the same rule, and an
 * arm sweeps both stage tables to keep it there.
 *
 * The CALL captures stay under `_driver/`: those are the driver's record of what arrived, not a seat's
 * output, and nothing dispatches against them.
 */
export function knockoutReviewFile(runDir) {
  return join(String(runDir ?? ""), "knockout-review.json");
}

/**
 * The address as one string, for joining and for saying which address was refused.
 *
 * ONE SPELLING. The merge joins on it, the refusal names it and the applier looks it up, so a second
 * way of writing the same address is a rewrite that merges against itself and applies to nothing.
 *
 * THE SEPARATOR IS A NUL, not a space, and it is named rather than inlined. A mark name may contain a
 * space — "OPEN COUNTRY" is an ordinary mark — so a space-joined key lets two different addresses
 * collide into one string, and the second rewrite would silently replace the first in the merge. A NUL
 * cannot appear in a field name or a mark name. It is also invisible in a diff, which is why it is a
 * named constant: the property is in the name, where a reader can see it.
 */
const ADDRESS_SEP = "\u0000";   // named: a literal control character in the source is invisible

export function addressKey(at) {
  const a = at ?? {};
  return [a.field, a.mark ?? "", a.index ?? "", a.ordinal ?? ""].join(ADDRESS_SEP);
}

/** Is this a well-formed address for a field the pass may reach? The reason, or null. */
export function addressFault(at) {
  if (!at || typeof at !== "object" || Array.isArray(at)) return "an address must be an object";
  const field = at.field;
  if (typeof field !== "string" || !Object.hasOwn(ADDRESSABLE, field))
    return `"${String(field)}" is not an addressable field — one of ${Object.keys(ADDRESSABLE).join(", ")}`;
  const need = ADDRESSABLE[field];
  for (const k of need) {
    if (at[k] === undefined || at[k] === null) return `address for "${field}" needs ${k}`;
    if (k === "mark" && (typeof at.mark !== "string" || !at.mark.trim())) return `address for "${field}": mark must be a name`;
    if ((k === "index" || k === "ordinal") && !Number.isInteger(at[k])) return `address for "${field}": ${k} must be an integer`;
  }
  for (const k of Object.keys(at)) {
    if (k === "field" || need.includes(k)) continue;
    return `address for "${field}" does not take "${k}"`;
  }
  return null;
}

/** SHAPE ONLY. Whether an address resolves against THIS run's record is the validator's join, not this. */
export function acceptKnockoutReview(call) {
  const rewrites = call?.rewrites, declined = call?.declined;
  if (rewrites !== undefined && !Array.isArray(rewrites)) return { ok: false, reason: "rewrites must be an array" };
  if (declined !== undefined && !Array.isArray(declined)) return { ok: false, reason: "declined must be an array" };
  const seen = new Set();
  for (const r of rewrites ?? []) {
    const fault = addressFault(r?.at);
    if (fault) return { ok: false, reason: `a rewrite's ${fault}` };
    if (typeof r?.text !== "string" || !r.text.trim())
      return { ok: false, reason: `the rewrite for "${r?.at?.field}" carries no replacement text` };
    for (const k of Object.keys(r)) if (!["at", "text", "why"].includes(k)) return { ok: false, reason: `a rewrite does not take "${k}"` };
    const key = addressKey(r.at);
    if (seen.has(key)) return { ok: false, reason: `two rewrites address the same line ("${r.at.field}") — send one` };
    seen.add(key);
  }
  for (const d of declined ?? []) {
    const fault = addressFault(d?.at);
    if (fault) return { ok: false, reason: `a declined row's ${fault}` };
    if (typeof d?.why !== "string" || !d.why.trim()) return { ok: false, reason: "a declined row must say why the line stands" };
    for (const k of Object.keys(d)) if (!["at", "why"].includes(k)) return { ok: false, reason: `a declined row does not take "${k}"` };
  }
  // An empty call and a stage that never ran leave the same artifact behind, and they are different
  // findings: one says the seat read the lines and had nothing to change, the other says nothing looked.
  if (!(rewrites ?? []).length && !(declined ?? []).length)
    return { ok: false, reason: "send at least one rewrite or one declined row — an empty call cannot be told from a stage that never ran" };
  return { ok: true, model: { schema_version: SCHEMA_VERSION, rewrites: rewrites ?? [], declined: declined ?? [] } };
}

/** Merge a repair turn onto what was already accepted, BY ADDRESS. See the header for the per-key rule. */
export function mergeKnockoutReviewCall(was, now) {
  const merge = (key) => {
    const byAddr = new Map();
    for (const row of was?.[key] ?? []) byAddr.set(addressKey(row?.at), row);
    for (const row of now?.[key] ?? []) byAddr.set(addressKey(row?.at), row);
    return [...byAddr.values()];
  };
  if (!was) return { ...now };
  return { ...was, ...now, rewrites: merge("rewrites"), declined: merge("declined") };
}

/**
 * What the driver MEASURED, as the evidence this stage is dispatched with.
 *
 * THE DRIVER MEASURES, THE SEAT JUDGES — the same split the clearance block states. `plainRegisterFlags`
 * is deterministic and says which line carries a word of the profession's and how long a sentence ran.
 * Whether the sentence is actually wrong, and what replaces it, is the seat's call. The ruling behind
 * this rejects a word list AS THE MECHANISM, so the seat is handed evidence and never a verdict: half
 * these words are ordinary English and several are plausible marks.
 *
 * BLIND TO THE RUN'S OWN NOUNS, and the empty case SAYS SO. `about` blanks every mark and owner before
 * the text is read, because a check that flagged the mark being cleared would put its noise on the one
 * report where it matters most. When the run named no mark to exclude, the seat is told that outright —
 * an absolute reassurance is false in exactly the state where a flag IS the mark, and telling a seat
 * nothing is worse than telling it the truth about what was not done.
 *
 * ENGINE-OWNED LINES ARE NOT OFFERED. They are in the walk and out of the pass's reach; see the applier.
 */
export function reviewEvidence(merged, about = {}) {
  const rows = [];
  for (const { where, text, at } of knockoutVisibleProse(merged)) {
    // OFFERED ONLY WHAT CAN BE REWRITTEN. The walk is wider than this pass in both directions — see
    // ADDRESSABLE — and handing a seat a line it cannot address wastes the turn and teaches it that a
    // refused address is normal.
    if (at?.engineOwned || !Object.hasOwn(ADDRESSABLE, at?.field)) continue;
    const flags = plainRegisterFlags(text, about);
    if (!flags.length) continue;
    rows.push({ at, where, says: flags.map((f) => f.say) });
  }
  const marks = (about.marks ?? []).filter(Boolean), owners = (about.owners ?? []).filter(Boolean);
  const ownerNote = owners.length ? ` The ${owners.length} owner name(s) from the record were also removed.` : "";
  const exclusionNote = marks.length
    ? `The ${marks.length} mark(s) this run is about were removed before reading, so none of these is a hit inside a name being screened.${ownerNote}`
    : `THIS RUN NAMED NO MARK TO EXCLUDE, so the names being screened were NOT removed before reading — a flag below may BE one of them. Check each against the batch before rewriting it.${ownerNote}`;
  return { rows, exclusionNote };
}

/** The addresses the driver offered this run, for the seat to quote back. One line each. */
export function reviewEvidenceLines({ rows }) {
  return rows.map(({ at, where, says }) => `- ${where} — address ${JSON.stringify(at)} — ${says.join(" ")}`);
}

/**
 * The `about` a knockout run is blind to: every name in the batch, and every owner on the record.
 *
 * TWO SOURCES, AND ONLY ONE OF THEM PROTECTS THE NAME BEING SCREENED. Owners come from the RECORD and
 * marks from the PLAN, so keying the reassurance on the union lets a record carrying thirteen owners
 * fire it over a batch that named no mark — telling the seat no flag is a screened name, over a flag
 * that is exactly that. The clearance side measured this; the two are counted separately here for it.
 */
export function reviewAbout(merged, plan) {
  const marks = [
    ...(plan?.marks ?? []).map((m) => (typeof m === "string" ? m : m?.name)),
    ...(merged?.marks ?? []).map((m) => m?.name),
  ].filter((x) => typeof x === "string" && x.trim());
  const owners = (merged?.marks ?? [])
    .flatMap((m) => [...(m?.findings ?? []).map((f) => f?.owner), ...(m?.registerReads ?? []).map((r) => r?.owner)])
    .filter((x) => typeof x === "string" && x.trim());
  return { marks: [...new Set(marks)], owners: [...new Set(owners)] };
}

/**
 * The stage's `validate` — shape, and the JOIN against the record this run actually holds.
 *
 * WHY IT LIVES HERE AND NOT IN `koValidators`. `verify-knockout.mjs` is where the lane's other
 * validators sit, and putting this one there would close an import cycle: this module reads the walk
 * from `predelivery-lint.mjs`, which reads `isEngineAppendedCaveat` from `verify-knockout.mjs`. ESM
 * would survive it and the hazard would be a const read during module init, years from now, by someone
 * who did not know the cycle was there. The stage def imports its validator from here instead.
 *
 * THE JOIN IS THE HALF THAT MATTERS. Shape alone accepts a rewrite aimed at a mark this run does not
 * carry, and the applier would then report it unresolved AFTER the stage had been declared good — a
 * seat's whole turn wasted with nothing telling it why. Refusing here puts the reason in front of the
 * seat while it can still send a repair turn.
 */
export function validateKnockoutReviewFile(file, text) {
  let doc;
  try { doc = JSON.parse(text); } catch (e) { return { ok: false, reason: `not valid JSON: ${e.message}` }; }
  const shape = acceptKnockoutReview(doc);
  if (!shape.ok) return shape;

  // The run dir, from the artifact's own path rather than a fixed depth — the assumption that bit the
  // assess validator when its chunk file moved out of `_driver/`.
  const dir = dirname(file);
  const runDir = basename(dir) === DRIVER_DIR ? dirname(dir) : dir;
  const findingsFile = join(runDir, "knockout-findings.json");
  if (!existsSync(findingsFile)) {
    // A COULD-NOT-LOOK, SAID AS ONE. Passing here would let every address through unchecked and read on
    // the receipt exactly like a run whose addresses all resolved.
    return { ok: false, reason: `the merged record is not on disk at ${findingsFile}, so no address could be checked` };
  }
  let merged;
  try { merged = JSON.parse(readFileSync(findingsFile, "utf8")); }
  catch (e) { return { ok: false, reason: `the merged record will not parse, so no address could be checked: ${e.message}` }; }

  const known = new Set(knockoutVisibleProse(merged).map((v) => addressKey(v.at)));
  const owned = new Set(knockoutVisibleProse(merged).filter((v) => v.at?.engineOwned).map((v) => addressKey(v.at)));
  for (const r of doc.rewrites ?? []) {
    const key = addressKey(r.at);
    if (owned.has(key)) return { ok: false, reason: `the rewrite for ${r.at.field} names a caveat the engine wrote, not a seat — it is not offered and cannot be changed` };
    if (!known.has(key)) return { ok: false, reason: `the rewrite for ${r.at.field}${r.at.mark ? ` on "${r.at.mark}"` : ""} names no line on this record` };
  }
  for (const d of doc.declined ?? []) {
    if (!known.has(addressKey(d.at))) return { ok: false, reason: `the declined row for ${d.at.field}${d.at.mark ? ` on "${d.at.mark}"` : ""} names no line on this record` };
  }
  return { ok: true };
}

/**
 * Apply accepted rewrites to the merged record, and say exactly what happened to each one.
 *
 * WHAT THIS MAY CHANGE, AND WHAT IT MAY NOT. Prose on a default-visible line, and nothing else. It
 * never adds or removes a mark, a finding or a caveat, never touches a band, an ordinal, evidence or a
 * count, and never lengthens or shortens an array. An address that does not resolve against THIS record
 * is reported as unresolved and changes nothing — a rewrite aimed at a mark the run does not carry is a
 * defect in the pass, and applying it by nearest match is how it would become a defect in the report.
 *
 * A CLONE, NOT AN IN-PLACE EDIT. The caller keeps the original to fall back to, and the failure path
 * below depends on there being one: this pass is the last thing that should be able to cost a client a
 * report, so anything it cannot do cleanly it does not do at all.
 *
 * `engineOwned` IS REFUSED HERE TOO, not only left out of the dispatch. A caveat the engine appended is
 * matched at delivery by `SURVIVOR_BOUNDARY_RE`; a rewrite that landed on it would either break that
 * match or append a second copy of the note, and both are silent. The dispatch never offers those
 * lines, so a rewrite naming one did not come from the evidence it was handed.
 */
export function applyKnockoutReview(merged, review) {
  const doc = JSON.parse(JSON.stringify(merged ?? {}));
  // THE WALK IS RE-DERIVED FROM THIS RECORD, never passed in. An index is only in range for the record
  // it was measured on, and a caller holding a walk from before the merge would write into a slot that
  // has moved — silently, because the address still resolves. Deriving it here makes the two the same
  // record by construction.
  const byKey = new Map();
  for (const v of knockoutVisibleProse(doc)) byKey.set(addressKey(v.at), v);

  const applied = [], unresolved = [], refused = [];
  for (const r of review?.rewrites ?? []) {
    const key = addressKey(r.at);
    const seen = byKey.get(key);
    if (!seen) { unresolved.push({ at: r.at, why: "no such line on this record" }); continue; }
    if (seen.at?.engineOwned) { refused.push({ at: r.at, why: "the engine wrote this caveat, not a seat" }); continue; }
    const at = r.at, text = String(r.text);
    // THE WALK IS THE BOUNDS CHECK. `seen` came from this same record, so a resolved address names a
    // field that exists and an index that is in range. The two lookups below cannot fail while that
    // holds — they are here because if they ever DO fire, the walk and the record disagree about the
    // shape of the same document, and writing through that disagreement is how a rewrite lands on the
    // wrong mark. They report; they never guess a nearest match.
    const mark = at.mark == null ? null : (doc.marks ?? []).find((m) => String(m?.name ?? "") === at.mark);
    if (at.mark != null && !mark) { unresolved.push({ at, why: "the walk and the record disagree: no such mark" }); continue; }
    switch (at.field) {
      case "batch.executiveSummary": doc.batch.executiveSummary = text; break;
      case "batch.standardCaveats": doc.batch.standardCaveats[at.index] = text; break;
      case "basis": mark.basis = text; break;
      case "mitigation": mark.mitigation = text; break;
      case "factors": mark.factors[at.index] = text; break;
      case "counterFactors": mark.counterFactors[at.index] = text; break;
      case "purpleNotes": {
        const note = mark.purpleNotes[at.index];
        if (note && typeof note === "object") note.text = text; else mark.purpleNotes[at.index] = text;
        break;
      }
      case "registerReads": mark.registerReads[at.index].read = text; break;
      case "findings.net": {
        // JOINED ON THE ORDINAL, never on position — the merged gate re-ranks and renumbers on the band,
        // so the index that addressed this row upstream addresses a different row after normalisation.
        const f = (mark.findings ?? []).find((x) => x?.ordinal === at.ordinal);
        if (!f) { unresolved.push({ at, why: "the walk and the record disagree: no finding with that ordinal" }); continue; }
        f.net = text;
        break;
      }
      default: refused.push({ at, why: "not an addressable field" }); continue;
    }
    applied.push({ at, chars: text.length });
  }
  return { doc, receipt: { applied: applied.length, unresolved, refused, declined: (review?.declined ?? []).length } };
}

export function recordKnockoutReview(runDir, received, { now = () => new Date().toISOString() } = {}) {
  const dir = String(runDir ?? "");
  const paths = knockoutReviewCallPaths(dir);
  const nameFor = (seq) => join(paths.dir, `call-${String(seq).padStart(3, "0")}.json`);
  const cap = captureCall({ nameFor, params: received, now });
  const captureFailed = cap.failed;
  const closeCapture = (v) => { stampVerdict(cap.path, v); return cap.path; };

  const journal = (reason) => {
    try { writeFileSync(paths.refusals, JSON.stringify({ at: now(), reason }) + "\n", { flag: "a" }); }
    catch { /* the refusal still stands and is still returned */ }
  };

  const undeclared = refuseUndeclaredShared(received, DECLARED, "knockoutreview");
  if (undeclared) {
    journal(undeclared);
    return { written: null, refused: undeclared, captured: closeCapture({ ok: false, refused: undeclared }), capture_failed: captureFailed };
  }

  // THE READER IS PASSED. `lastAccepted` throws without it rather than answering "nothing stored yet" —
  // the failure knockout-frame shipped, where every repair turn merged onto an empty base and was
  // refused for a field the seat had already sent.
  const call = mergeKnockoutReviewCall(lastAccepted(paths.accepted, readFileSync), received);
  const verdict = acceptKnockoutReview(call);
  if (!verdict.ok) {
    journal(verdict.reason);
    return { written: null, refused: verdict.reason, captured: closeCapture({ ok: false, refused: verdict.reason }), capture_failed: captureFailed };
  }

  const file = knockoutReviewFile(dir);
  try {
    writeFileSync(file, JSON.stringify(verdict.model, null, 2) + "\n");
    writeFileSync(paths.accepted, acceptedEnvelope(call, now()));
  } catch (e) {
    return { written: null, refused: null, write_failed: String(e?.message ?? e).slice(0, 200),
      captured: closeCapture({ ok: false, write_failed: true }), capture_failed: captureFailed };
  }

  return {
    written: file,
    refused: null,
    rewrites: verdict.model.rewrites.length,
    declined: verdict.model.declined.length,
    captured: closeCapture({ ok: true }),
    capture_failed: captureFailed,
  };
}

/** The refusals journalled for this run, newest last. The accessor a TOOL_WRITTEN_ARTIFACTS row carries. */
export function knockoutReviewRefusalsFor(runDir) {
  try {
    return readFileSync(knockoutReviewCallPaths(String(runDir ?? "")).refusals, "utf8")
      .split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { reason: l }; } });
  } catch { return []; }
}
