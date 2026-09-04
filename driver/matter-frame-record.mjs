// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// matter-frame-record.mjs — the recording transport for the matter frame.
//
// Conversion 2 of the six the sanctioned-equivalents design rules, after blind-frame, skeptic
// and frame-diff. It is the hardest of the eight, and NOT because of the writer.
//
// ── WHY THIS ONE IS DIFFERENT: THE ARTIFACT HAS TWENTY READERS ──────────────────────────────────────
//
// `matter-context.md` is not a leaf. SIX consumers parse it —
//
//   channelsFromMatterContext / channelsDiagnosis  the `Search channels:` line
//   meaningAnglesFromMatterContext                 the `Meaning angles:` line (MEANING_ANGLES_RE)
//   parseIntakeAsks                                the `### Intake asks` section
//   validators.matterContext                       every instructed-scope value, whitespace-collapsed
//   anchor-reader                                  `- **Key:** value` request bullets
//   findSeedNeutralityViolations (S2)              the whole text
//
// — and TWELVE downstream dispatches hand a seat its PATH to read as prose. So the driver's render is
// not a private serialization: it is the input to everything downstream of the frame. Every line shape
// below exists because a named parser reads it, and the test file asserts the render against those
// parsers rather than against a copy of these regexes.
//
// ── WHAT THE CONVERSION ACTUALLY BUYS ───────────────────────────────────────────────────────────────
//
// `contract-e3-backlog.mjs` carries FIVE matter-frame rows, each a DICTATED LINE SHAPE with a parser
// that re-reads it, each stamped "NOTHING ON THE PLAN REMOVES THIS". This removes four of them:
// the machine lines stop being a shape a model has to hit and become typed values the driver renders.
// The prose body stays the seat's — it is judgment, and the contract says so.
//
// The fifth row is the `Scope jurisdictions:` claim in the skill doc, which the E3 audit already calls
// the weakest class it found: a dictated shape with no parser AND no dictator. The stage message never
// asked for it and nothing read it. It is not "converted" here — it is deleted, which is the only
// honest treatment of a shape nobody was writing and nobody was reading.
//
// ── THE DRIVER STAMPS WHAT THE DRIVER ALREADY HOLDS ─────────────────────────────────────────────────
//
// `## Instructed scope` was the frame's largest retyping duty: quote the marks, classes, territories and
// goods VERBATIM from a file the driver wrote at intake, so that `validators.matterContext` could
// string-compare the retyping back against that same file. The driver held every value the whole time.
// It is stamped now, from `_driver/instructed-scope.json`, and `frame_scope_missing` cannot arise from a
// recorded frame because there is no retyping left to drift. What that does to the token is stated at
// the validator, not here — a guard that cannot fail must be deleted or repointed, never left green.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { captureCall, stampVerdict } from "./call-capture.mjs";
import { join } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";   //
import { refuseUndeclared as refuseUndeclaredShared, keepIfAbsent, lastAccepted, acceptedEnvelope } from "./preserve-merge.mjs";

export const MATTER_CONTEXT_FILE = "matter-context.md";
const SCHEMA_VERSION = 1;

/** Where the call's evidence lives — the driver's own record of what the seat handed it. */
export function matterFrameCallPaths(runDir) {
  const dir = driverDir(runDir, "matter-frame-calls");
  return { dir, payload: join(dir, "call-001.json"), accepted: join(dir, "accepted.json") };
}

/** The owners an intake ask may name. The dictated vocabulary, unchanged — parseIntakeAsks reads it. */
export const INTAKE_ASK_OWNERS = Object.freeze(["common-law", "register", "synthesis"]);

/**
 * `Scope basis:` values — THE SKILL DOC'S VOCABULARY, not a new one.
 *
 * `instructed | worldwide | inferred`, exactly as `skills/matter-frame/SKILL.md` has dictated them, and
 * the reason for copying rather than choosing is that `scope_basis: "worldwide"` is a live value
 * elsewhere in the driver: `register-plan.mjs` stamps it and `scope-facts.mjs` reads it to decide the
 * "registers: worldwide" tail on the coverage line. A transport that offered a tidier two-value enum
 * would have made the doctrine's middle value unsendable and quietly changed what a frame can say.
 */
export const SCOPE_BASES = Object.freeze(["instructed", "worldwide", "inferred"]);

const str = (v) => String(v ?? "").trim();
const list = (v) => (Array.isArray(v) ? v : []).map(str).filter(Boolean);

/**
 * The instructed-scope section, STAMPED from the driver's own record rather than retyped by the seat.
 *
 * Shape note: the values are rendered one per labelled line so that `validators.matterContext`'s
 * whitespace-collapsed substring hunt finds each of them, and so a human reading the frame sees the
 * request as given. `none given` is the dictated form for an absent field and is kept verbatim — a
 * reader of an archived frame should not have to tell a new render from an old one to know what it means.
 *
 * PURE.
 */
export function renderInstructedScope(scope) {
  const out = ["## Instructed scope", ""];
  const row = (label, v) => {
    const vals = Array.isArray(v) ? list(v) : (str(v) ? [str(v)] : []);
    out.push(`- **${label}:** ${vals.length ? vals.join(", ") : "none given"}`);
  };
  row("Mark(s)", scope?.marks);
  row("Classes", scope?.classes);
  row("Instructed territories", scope?.jurisdictions);
  row("Goods/services", scope?.goods);
  out.push("", "Stamped by the driver from `_driver/instructed-scope.json`, the record written at intake "
    + "before any model ran. It is not retyped by the frame, so it cannot drift from the request.", "");
  return out;
}

/**
 * The frame, rendered from typed values.
 *
 * EVERY MACHINE LINE HERE HAS A NAMED PARSER, and the shapes are theirs, not ours:
 *   `Search channels: a.com, b.com`     channelsDiagnosis  /search channels?\s*[:\-—]\s*([^\n]+)/i
 *   `Meaning angles: q1; q2`            MEANING_ANGLES_RE  — LINE-ANCHORED, so it must start its line
 *   `### Intake asks` + `- ask: "…" | owner: …`            parseIntakeAsks's section + row regexes
 *
 * The prose body rides verbatim, between the stamped scope and the machine lines. It is the seat's
 * judgment and the driver does not touch it — reflowing a body that S2 scans for seed neutrality and
 * that twelve downstream seats read would be the driver editing legal reasoning to fit a renderer.
 *
 * PURE.
 */
export function renderMatterFrame(model) {
  const out = [`# Matter frame`, ""];
  out.push(...renderInstructedScope(model.instructed_scope));

  out.push("## The matter", "", model.prose_body, "");

  // ── The machine lines. Each on its own line, in the shape its parser anchors on. ──
  out.push("## Scope and search surface", "");
  out.push(`- **Scope basis:** ${model.scope_basis}`);
  if (model.scope_jurisdictions.length)
    out.push(`- **Scope jurisdictions:** ${model.scope_jurisdictions.join(", ")}`);
  if (model.excluded_jurisdictions.length)
    out.push(`- **Excluded jurisdictions:** ${model.excluded_jurisdictions.join(", ")}`);
  out.push("");

  // `Search channels:` — domains only; the grid site-restricts to them and the general web is always
  // added by the driver. An empty list renders the line with nothing after it ON PURPOSE: channelsDiagnosis
  // calls that `all-rejected`, which is "the seat answered and nothing survived", and it is a different
  // fact from `no-line`. Omitting the line would report the seat never answered.
  out.push(`Search channels: ${model.search_channels.join(", ")}`, "");

  // `Meaning angles:` — semicolon-separated, or the literal `none` a coined mark asserts. The assertion is
  // a FIELD (`meaning_angles_none`), never an inference from an empty array: "the mark has no semantic
  // field to probe" and "the seat did not answer" are different facts, and CHANNEL_STATES in
  // scope-ledger.mjs is this codebase having already learned that lesson once.
  out.push(`Meaning angles: ${model.meaning_angles_none ? "none" : model.meaning_angles.join("; ")}`, "");

  // `### Intake asks` — LAST, because parseIntakeAsks reads to the next heading or EOF.
  out.push("### Intake asks", "");
  if (!model.intake_asks.length) out.push("- none stated");
  else for (const a of model.intake_asks) out.push(`- ask: "${a.ask}" | owner: ${a.owner}`);
  out.push("");
  return out.join("\n");
}

/**
 * Assemble and validate the model from typed params.
 *
 * `instructedScope` is the DRIVER'S, read from the run's own intake record — never a parameter the seat
 * can send. Returns `{ok: true, model, content}` or `{ok: false, reason}` with a token-first reason in
 * the shape the corrective ladder already consumes. PURE.
 */
/** The shape this tool declares, at every depth — what the ACCEPTOR enforces. */
const DECLARED = Object.freeze({
  "": ["prose_body", "scope_basis", "scope_jurisdictions", "excluded_jurisdictions", "search_channels", "meaning_angles", "meaning_angles_none", "intake_asks"],
  intake_asks: ["ask", "owner"],
});

/** Refuse an undeclared key by path, at depth. Shared walk; the table above is what is this tool's. */
export const refuseUndeclared = (params) => refuseUndeclaredShared(params, DECLARED, "matterframe");

/** The last ACCEPTED call for this run, or null. */
export function lastAcceptedMatterFrame(runDir) {
  return lastAccepted(matterFrameCallPaths(String(runDir ?? "")).accepted, readFileSync);
}

/**
 * Merge a call onto the stored one. PURE. EVERY KEY DECIDED HERE, BEFORE IT IS WRITTEN.
 *
 * This transport wrote its artifact from the received call ALONE, so a repair rung that asked the seat
 * to correct part of it — and a seat that sent only the corrected part — silently deleted the rest.
 * Preserving rather than requiring, because nothing here can tell a first call from a repair and a
 * product refusal is never a pass. See preserve-merge.mjs for the class.
 */
export function mergeMatterFrameCall(stored, received) {
  const base = stored ?? {};
  return {
    prose_body: received?.prose_body,
    scope_basis: received?.scope_basis,
    search_channels: received?.search_channels,
    meaning_angles: received?.meaning_angles,
    intake_asks: received?.intake_asks,
    // KEEP-IF-ABSENT. These two are the matter's TERRITORIAL SCOPE — which jurisdictions the search
    // covers and which are deliberately out. A partial that drops them produces a frame that has
    // quietly stopped saying where the search applies.
    scope_jurisdictions: keepIfAbsent(received?.scope_jurisdictions, base.scope_jurisdictions),
    excluded_jurisdictions: keepIfAbsent(received?.excluded_jurisdictions, base.excluded_jurisdictions),
    meaning_angles_none: keepIfAbsent(received?.meaning_angles_none, base.meaning_angles_none),
  };
}

export function acceptMatterFrame(params, { instructedScope = null } = {}) {
  const prose_body = str(params?.prose_body);
  // The floors the old validator applied to the whole hand-written file now apply to the field that
  // actually carries the judgment. Same numbers, aimed at the thing they were always about.
  if (!prose_body) return { ok: false, reason: "matterframe_prose_missing: the frame's body is the commercial read of the matter — client, sector, product, customer base, channels of trade, off-field sectors, watchlist-owner seeds" };
  if (prose_body.length < 200) return { ok: false, reason: `matterframe_prose_too_short: ${prose_body.length} characters; the body must carry the whole commercial read, not a summary line` };

  const scope_basis = str(params?.scope_basis).toLowerCase();
  if (!SCOPE_BASES.includes(scope_basis))
    return { ok: false, reason: `matterframe_scope_basis_invalid:${scope_basis || "<empty>"} (one of: ${SCOPE_BASES.join(", ")})` };

  const meaning_angles = list(params?.meaning_angles);
  const meaning_angles_none = params?.meaning_angles_none === true;
  // BOTH or NEITHER is a defect, and both directions are refused. A seat that asserts `none` AND sends
  // angles has not decided; a seat that sends neither has not answered. The old dictation could express
  // only the second and caught it with `meaning_angles_missing` after the file was written.
  if (meaning_angles_none && meaning_angles.length)
    return { ok: false, reason: `matterframe_meaning_angles_contradictory: ${meaning_angles.length} angle(s) sent beside an asserted none — assert none ONLY for a coined term with no real-word semantic field` };
  if (!meaning_angles_none && !meaning_angles.length)
    return { ok: false, reason: "matterframe_meaning_angles_missing: 3-8 per-matter angles anchored on the mark's own element(s), or meaning_angles_none:true for a coined term with no semantic field to probe" };

  const intake_asks = [];
  for (const a of (Array.isArray(params?.intake_asks) ? params.intake_asks : [])) {
    const ask = str(a?.ask), owner = str(a?.owner).toLowerCase();
    if (!ask) return { ok: false, reason: "matterframe_intake_ask_empty: every ask carries the requester's own words, quoted verbatim" };
    if (!INTAKE_ASK_OWNERS.includes(owner))
      return { ok: false, reason: `matterframe_intake_ask_owner_invalid:${owner || "<empty>"} (one of: ${INTAKE_ASK_OWNERS.join(", ")})` };
    // A quote character inside the ask would close the rendered `- ask: "…"` early and parseIntakeAsks
    // would read a truncated ask. Refused at the boundary rather than escaped silently: the requester's
    // words are evidence, and a transport that rewrites them is not carrying them.
    if (ask.includes('"'))
      return { ok: false, reason: `matterframe_intake_ask_quote: an ask may not contain a double quote — send the requester's words without it (${ask.slice(0, 40)})` };
    intake_asks.push({ ask, owner });
  }

  const model = {
    schema_version: SCHEMA_VERSION,
    instructed_scope: instructedScope ?? null,
    prose_body,
    scope_basis,
    scope_jurisdictions: list(params?.scope_jurisdictions),
    excluded_jurisdictions: list(params?.excluded_jurisdictions),
    search_channels: list(params?.search_channels),
    meaning_angles, meaning_angles_none,
    intake_asks,
  };
  return { ok: true, model, content: renderMatterFrame(model) };
}

/** The driver's own intake record — the values the seat used to be asked to retype. IMPURE. */
export function readInstructedScope(runDir) {
  try { return JSON.parse(readFileSync(driverDir(String(runDir ?? ""), "instructed-scope.json"), "utf8")); }
  catch { return null; }   // legacy/replay run with no receipt — the section renders `none given`
}

/**
 * Capture what arrived, validate, and write the frame — in that order.
 *
 * The capture happens BEFORE the decision, as in all three sibling transports: it must exist even for a
 * REFUSED call, because its PRESENCE is what proves the typed transport was taken. That is the
 * discriminator every consumer of this conversion keys on — including `validators.matterContext`, which
 * uses it to tell a driver-rendered frame from an archived hand-written one.
 */
export function recordMatterFrame(runDir, received, { now = () => new Date().toISOString() } = {}) {
  const { dir, payload } = matterFrameCallPaths(String(runDir ?? ""));
  // — ONE FILE PER CALL, refusals included. This wrote a single fixed `call-001.json`,
  // so a turn refused and then re-sent kept only the survivor: the file whose header promises "including
  // calls that were refused" held the one call that was not. Sequence 1 still resolves to `call-001.json`,
  // so every consumer reading that name is unmoved. Best-effort throughout, as the capture always was —
  // a lost forensic record never fails a run.
  const nameFor = (seq) => join(dir, `call-${String(seq).padStart(3, "0")}.json`);
  const cap = captureCall({ nameFor, params: received, now });
  const captureFailed = cap.failed;
  const closeCapture = (v) => { stampVerdict(cap.path, v); return cap.path; };

  // ── ORDER IS THE MECHANISM ───────────────────────────────────────────────────
  //   1. CAPTURE what arrived (above), before any decision.
  //   2. REFUSE an undeclared key BY PATH, BEFORE the merge — a misplaced key must never reach the
  //      stored base, or the next repair inherits it.
  //   3. MERGE onto the last accepted call, so an omitted key comes back rather than being deleted.
  //   4. VALIDATE the MERGED call — it is what gets written; validating the received one would gate on
  //      a document nobody ships.
  //   5. WRITE the base only after 4 passes. A refused call must never become the base a later repair
  //      builds on, or one bad turn poisons every turn after it.
  const undeclared = refuseUndeclared(received);
  if (undeclared) {
    return { written: null, refused: undeclared, captured: closeCapture({ ok: false, refused: undeclared }), capture_failed: captureFailed };
  }
  const call = mergeMatterFrameCall(lastAcceptedMatterFrame(runDir), received);
  const verdict = acceptMatterFrame(call, { instructedScope: readInstructedScope(runDir) });
  if (!verdict.ok) {
    return { written: null, refused: verdict.reason, captured: closeCapture({ ok: false, refused: verdict.reason }), capture_failed: captureFailed };
  }

  const at = join(String(runDir ?? ""), MATTER_CONTEXT_FILE);
  try {
    writeFileSync(at, verdict.content);
    // Step 5. BEST-EFFORT, in its own try — see report-overview-record.mjs for why.
    try { writeFileSync(matterFrameCallPaths(String(runDir ?? "")).accepted, acceptedEnvelope(call, now())); }
    catch { /* a lost base is never a lost artifact */ }
  } catch (e) {
    // A VALID frame we could not store. An infrastructure failure must not read as a rejected frame —
    // the two have opposite repairs, and sending a seat to re-reason a correct frame because the disk is
    // full is the shape this whole category exists to stop.
    return { written: null, refused: null, write_failed: String(e?.message ?? e).slice(0, 200),
      captured: closeCapture({ ok: false, write_failed: true }), capture_failed: captureFailed };
  }

  return {
    written: at,
    refused: null,
    channels: verdict.model.search_channels.length,
    meaning_angles: verdict.model.meaning_angles_none ? "none (asserted)" : verdict.model.meaning_angles.length,
    intake_asks: verdict.model.intake_asks.length,
    instructed_scope_stamped: Boolean(verdict.model.instructed_scope),
    captured: closeCapture({ ok: true }),
    capture_failed: captureFailed,
  };
}

/**
 * Was this run's frame written through the typed transport?
 *
 * THE DISCRIMINATOR, and it is deliberately capture-presence rather than anything read out of the
 * artifact. The capture is written before validation, so it exists for a refused call too — which means
 * it answers "was the transport taken", not "did the frame come out well". Everything that must treat a
 * rendered frame differently from an archived hand-written one asks THIS, and nothing keys on the
 * instructed-scope sentinel (present on every current-era run, archived and parked included — keying on
 * it flipped real archived replay verdicts on 2026-07-31) or on a stage-contract marker (written at
 * dispatch, so it is true of archives as well).
 */
export function matterFrameWasRecorded(runDir) {
  try { readFileSync(matterFrameCallPaths(String(runDir ?? "")).payload, "utf8"); return true; }
  catch { return false; }
}
