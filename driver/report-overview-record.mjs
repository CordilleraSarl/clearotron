// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// report-overview-record.mjs — the recording transport for the report shell.
//
// Conversion 4, after blind-frame, skeptic, frame-diff, matter-frame and prelim-variants
//. It is the FIRST conversion whose artifact a client reads. report-overview.md is not an internal
// input that a later stage consumes — it is the front-matter and the Actions section of the delivered
// report, so a render defect here reaches a lawyer's desk rather than a test log.
//
// ── THE MEASUREMENT THAT MAKES THIS ONE OBVIOUS ────────────────────────────────────────────────────
//
// The stage declares SEVENTEEN contract elements and THIRTEEN of them are already classed mechanical.
// Nine of the ten front-matter keys are driver facts the seat is asked to retype:
//
//   type      a fixed literal — the driver knows the product name of its own pipeline
//   matter    held in the intake record, handed to the seat in the dispatch, typed back
//   title     the same, one field over
//   client    the same
//   use       the same
//   run       composed of driver facts (the run stamp, PROVIDER_META.label, whether common-law ran)
//   classes         STAMPED OVER by applyScopeFrontMatter from _driver/scope-facts.json
//   overall_label   STAMPED OVER by applyVerdictFrontMatter from _driver/verdict.json .tier
//   overall_badge   STAMPED OVER by the same closure, same line
//
// The last three are the sharpest case the programme has produced: the instruction dictates them, the
// seat types them, and the driver overwrites all three after every assembly AND after every lint-repair
// reassembly. The skill doc annotates its own three fields as driver-replaced, in the model's own
// reading. A model is asked to type nine values so code can throw three of them away.
//
// What stays the model's is the judgment and only the judgment: `overall_caption` (which finding is the
// genuine top risk and what conditions reliance), WHICH checks earn a place in # Actions and how each
// result reads in plain English, the optional # Methodology scope note, `handling_note`, and which notes
// are internal (`::p::`).
//
// ── CLASS 3, AND WHY THE FLOOR MOVED RATHER THAN COPIED ────────────────────────────────────────────
//
// O3c measured 61 Bash calls with 8 writes across 17 attempts on this stage — the shape being `wc -m`
// and `grep`-as-check over the seat's own output, a seat pre-checking the constraints the validator
// would apply. The design's Class 3 ruling is that such a check gets no compute tool: it moves to the
// ACCEPTANCE BOUNDARY, where it runs on every call instead of when a seat remembers.
//
// `validators.reportOverview` was `nonEmpty(c, 120)` + a `needs` for front-matter and a shell section.
// On an artifact the DRIVER now writes, that validator is code checking its own render — a guard
// comparing a value with itself. So the floor is measured HERE, against the values as received, and the
// refusal states the measured number the way the house rule requires: detector, never repair.
//
// THE VALIDATOR IS NOT DELETED. Archived and replayed shells were hand-written under the old dictation
// and must keep parsing — the archive-validator trap, ruled binding on every conversion: a new way in,
// never a replacement. The strict boundary binds new writes; the permissive read path stays.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { captureCall, stampVerdict } from "./call-capture.mjs";
import { join } from "node:path";
import { driverDir, driverRel } from "../shared/driver-dir.mjs";   //
import { refuseUndeclared as refuseUndeclaredShared, keepIfAbsent, lastAccepted, acceptedEnvelope } from "./preserve-merge.mjs";

export const PROSE_FILE = "report-overview.md";
const SCHEMA_VERSION = 1;

/** The driver's own identity record for the shell — see readReportIdentity for why it is not intake's. */
export const IDENTITY_FILE = driverRel("report-identity.json");

/** Where the call's evidence lives — the driver's own record of what the seat handed it. */
export function reportOverviewCallPaths(runDir) {
  const dir = driverDir(runDir, "report-overview-calls");
  return { dir, payload: join(dir, "call-001.json"), accepted: join(dir, "accepted.json") };
}

/**
 * THE SHAPE THIS TOOL DECLARES, at every depth — the same shape `tools/list` serves the seat.
 *
 * Stated here rather than derived, because the server cannot be imported without starting it. The
 * census `an-ordered-field-is-a-field-the-tool-can-express.test.mjs` asks the server directly; this
 * list is what the ACCEPTOR enforces, and a guard below asserts the two agree.
 */
const DECLARED = Object.freeze({
  "": ["overall_caption", "actions", "methodology", "handling_note"],
  actions: ["text", "source_link", "internal"],
});

/**
 * Refuse an undeclared key by path. THE SHARED IMPLEMENTATION (preserve-merge.mjs) — five transports
 * carry this hole and one of them is enough places for the walk to live. What stays here is what is
 * genuinely this tool's: WHICH keys it declares, above, and WHAT the rule is per key, below.
 */
export const refuseUndeclared = (params) => refuseUndeclaredShared(params, DECLARED, "reportoverview");

/** The last ACCEPTED call for this run, or null when there is none. */
export function lastAcceptedOverview(runDir) {
  return lastAccepted(reportOverviewCallPaths(String(runDir ?? "")).accepted, readFileSync);
}

/**
 * Merge a call onto the stored one. PURE. EVERY KEY DECIDED HERE, BEFORE IT IS WRITTEN.
 *
 * ── WHY THIS EXISTS AT ALL ───────────────────────────────────────────────────────────────────────────
 *
 * This transport used to write the shell from the received call ALONE. A repair rung asks the seat to
 * correct the shell; a seat that sends only what it corrected produced a client-facing overview with the
 * Actions list and the methodology GONE — accepted, because only `overall_caption` is required, and past
 * the 120-character floor, because a caption alone renders 149. Nothing fired.
 *
 * ── WHY PRESERVE AND NOT REFUSE ──────────────────────────────────────────────────────────────────────
 *
 * Requiring the fields instead would turn a legitimate omission into a REFUSAL on the stage that
 * produces the client's own document. Nothing here reads whether a first call or a repair is in flight,
 * so a partial cannot be told from a first call — and a product refusal is never a pass, however correct
 * the reason. Preserving is the answer that cannot fail closed.
 *
 * THE RULE, PER KEY:
 *   overall_caption   REPLACES — it is required, so every call carries it and means it.
 *   actions           KEEP-IF-ABSENT — an omitted list is "unchanged", never "empty". An empty ARRAY
 *                     sent deliberately is a different statement and is honoured as one.
 *   methodology       KEEP-IF-ABSENT.
 *   handling_note     KEEP-IF-ABSENT.
 *
 * The absent/empty distinction is the whole care here: `undefined` is "I did not speak about this",
 * `[]` and `""` are "I say there is none". Collapsing them is how a preserve-merge quietly becomes a
 * replace-merge for any seat that sends an empty value.
 */
export function mergeOverviewCall(stored, received) {
  const base = stored ?? {};
  return {
    overall_caption: received?.overall_caption,
    actions: keepIfAbsent(received?.actions, base.actions),
    methodology: keepIfAbsent(received?.methodology, base.methodology),
    handling_note: keepIfAbsent(received?.handling_note, base.handling_note),
  };
}

const str = (v) => String(v ?? "").trim();

// ── THE FLOOR, AND WHERE ITS NUMBER COMES FROM ─────────────────────────────────────────────────────
//
// 120 is `validators.reportOverview`'s own whole-file floor (`nonEmpty(c, 120)`), carried over rather
// than re-chosen: a conversion moves a check, it does not get to pick a new threshold on the way past.
// It is measured on the RENDERED shell for the same reason the validator measured the file — a caption
// long enough to pass on its own inside an otherwise empty shell was never what the floor was for.
const BODY_FLOOR_CHARS = 120;

// The cap `card-budget.mjs foldCaption` folds at. Refused here rather than folded, because a fold is a
// REPAIR and this boundary is a detector: a seat handed "your caption ran to 5 sentences" writes three,
// while a seat whose fourth sentence is silently cut never learns it wrote one. foldCaption stays where
// it is for the assembly path — archived shells and replays still meet it.
const CAPTION_MAX_SENTENCES = 3;

/** Sentence count, on the same terminator class foldCaption uses. */
const countSentences = (s) => (String(s).match(/[.!?](?=\s|$)/g) ?? []).length;

/**
 * The identity front-matter the driver holds, read from its own sidecar.
 *
 * NOT `_driver/instructed-scope.json`, and the reason is a live guard rather than a preference:
 * `validators.matterContext` compares the matter frame against EVERY VALUE in that file, so a key added
 * there becomes a value the frame must quote verbatim — a conversion of THIS stage would fail a
 * different stage's validator, for a field neither of them is about. The sidecar is separate and carries
 * exactly the four fields `frontMatterIdentity` used to dictate, from the same `job` object, written at
 * the point the dispatch would have stated them.
 *
 * `null` when absent: an archived or replayed run has no sidecar, and the caller renders what it holds.
 */
export function readReportIdentity(runDir) {
  try { return JSON.parse(readFileSync(join(String(runDir ?? ""), IDENTITY_FILE), "utf8")); }
  catch { return null; }
}

/**
 * Render the shell — front-matter, # Actions, optional # Methodology.
 *
 * DRIVEN BY THE CONSUMER LIST, not by the artifact's own reader. Conversion 3's finding was that a render
 * matching its own parser can still be wrong for everything downstream; here the downstream is the
 * delivered report, so the shape below is what `parseFront` / `parseSections` / `parseCards` /
 * `parseReport` read, what `assembleReportMd` splices into (it matches `^#\s+Actions\b` to place the
 * code-built sections), and what `predelivery-lint` re-parses for the reachability gate.
 *
 * The driver-stamped keys are rendered from the values it holds AT RECORD TIME. `applyScopeFrontMatter`
 * and `applyVerdictFrontMatter` still stamp them at assembly and after every lint-repair reassembly —
 * unchanged, and deliberately so: this render removes the SEAT from those three keys, it does not remove
 * the driver's own authority over them.
 */
export function renderReportOverview(model, identity) {
  const id = identity ?? {};
  const fm = [
    "---",
    "type: prelim-clearance",
    id.matter ? `matter: ${id.matter}` : "",
    id.title ? `title: ${id.title}` : "",
    id.client ? `client: ${id.client}` : "",
    id.use ? `use: ${id.use}` : "",
    id.classes ? `classes: ${id.classes}` : "",
    id.run ? `run: ${id.run}` : "",
    id.overall_label ? `overall_label: ${id.overall_label}` : "",
    id.overall_badge ? `overall_badge: ${id.overall_badge}` : "",
    `overall_caption: ${model.overall_caption}`,
    model.handling_note ? `handling_note: ${model.handling_note}` : "",
    "---",
  ].filter(Boolean);

  const out = [...fm, ""];
  if (model.actions.length) {
    out.push("# Actions", "", "### Checks we ran — what we found", "");
    for (const a of model.actions) {
      const link = a.source_link ? ` ([source](${a.source_link}))` : "";
      out.push(`- ${a.internal ? "::p:: " : ""}${a.text}${link}`);
    }
    out.push("");
  }
  if (model.methodology) out.push("# Methodology", "", model.methodology, "");
  return `${out.join("\n").replace(/\n+$/, "")}\n`;
}

/**
 * Validate the typed values, then render. Returns `{ok:true, model, content}` or `{ok:false, reason}`,
 * reason token-first. PURE.
 *
 * The identity is the DRIVER'S and arrives as an option, never as a parameter the seat can set — the
 * matter-frame precedent, and the reason the nine retyped keys cannot come back through the tool.
 */
export function acceptReportOverview(params, { identity = null } = {}) {
  const overall_caption = str(params?.overall_caption);
  if (!overall_caption)
    return { ok: false, reason: "reportoverview_caption_missing: the caption is the whole summary — the one driver and what conditions reliance" };
  // A newline anywhere in a front-matter value ends the key. The seat cannot see the rendered file, so
  // this is the cheapest place in the system to catch it, and the only one before a lawyer reads it.
  for (const [field, v] of [["overall_caption", overall_caption], ["handling_note", str(params?.handling_note)]])
    if (v.includes("\n"))
      return { ok: false, reason: `reportoverview_frontmatter_newline:${field} — a line break ends the front-matter key and everything after it is lost; state it as one line` };
  const sentences = countSentences(overall_caption);
  if (sentences > CAPTION_MAX_SENTENCES)
    return { ok: false, reason: `reportoverview_caption_too_long:${sentences} sentences (cap ${CAPTION_MAX_SENTENCES}) — a verdict, not a recap; the cap is the fold point, not the target (about 20-25 words a sentence)` };

  const actions = [];
  for (const a of (Array.isArray(params?.actions) ? params.actions : [])) {
    const text = str(a?.text);
    if (!text) return { ok: false, reason: "reportoverview_action_text_missing: every Actions bullet states what was checked and how it came back" };
    if (text.includes("\n"))
      return { ok: false, reason: `reportoverview_action_newline: a bullet is one line — the second line renders outside the list (${text.slice(0, 40)})` };
    const source_link = str(a?.source_link);
    if (source_link && /[()\s]/.test(source_link))
      return { ok: false, reason: `reportoverview_action_link_unbracketable:${source_link.slice(0, 60)} — a parenthesis or space in the URL closes the markdown link early` };
    actions.push({ text, source_link, internal: a?.internal === true });
  }

  const model = {
    schema_version: SCHEMA_VERSION,
    overall_caption,
    handling_note: str(params?.handling_note),
    actions,
    methodology: str(params?.methodology),
  };
  const content = renderReportOverview(model, identity);

  // The floor, measured on the render — the validator's own number, applied where the seat can act on it.
  if (content.length < BODY_FLOOR_CHARS)
    return { ok: false, reason: `reportoverview_too_short:${content.length} characters rendered (floor ${BODY_FLOOR_CHARS}) — the shell carries the caption AND the checks that were run` };

  return { ok: true, model, content };
}

/**
 * Capture, validate, then write — in that order.
 *
 * The capture happens BEFORE the decision, as in every sibling transport: it exists even for a REFUSED
 * call, which is what makes its presence the discriminator this conversion is proven by.
 */
export function recordReportOverview(runDir, received, { now = () => new Date().toISOString() } = {}) {
  const { dir, payload } = reportOverviewCallPaths(String(runDir ?? ""));
  // — ONE FILE PER CALL, refusals included. This wrote a single fixed `call-001.json`,
  // so a turn refused and then re-sent kept only the survivor: the file whose header promises "including
  // calls that were refused" held the one call that was not. Sequence 1 still resolves to `call-001.json`,
  // so every consumer reading that name is unmoved. Best-effort throughout, as the capture always was —
  // a lost forensic record never fails a run.
  const nameFor = (seq) => join(dir, `call-${String(seq).padStart(3, "0")}.json`);
  const cap = captureCall({ nameFor, params: received, now });
  const captureFailed = cap.failed;
  const closeCapture = (v) => { stampVerdict(cap.path, v); return cap.path; };

  // ── ORDER IS THE MECHANISM HERE, so it is stated rather than left to the reader ──────────────────
  //
  //   1. CAPTURE what arrived (above), before any decision — a payload recorded after validation
  //      records what we DECIDED, which is already in the answer.
  //   2. REFUSE an undeclared key BY PATH, BEFORE the merge. A misplaced key must never reach the
  //      stored base, or the next repair inherits it.
  //   3. MERGE onto the last accepted call, so an omitted key comes back rather than being deleted.
  //   4. VALIDATE the merged call — not the received one. The merged call is what gets written, and
  //      validating the other one would gate on a document nobody ships.
  //   5. WRITE the base only after 4 passes. A refused call must never become the base a later repair
  //      builds on, or one bad turn poisons every turn after it.
  const undeclared = refuseUndeclared(received);
  if (undeclared) {
    return { written: null, refused: undeclared, captured: closeCapture({ ok: false, refused: undeclared }), capture_failed: captureFailed };
  }

  const call = mergeOverviewCall(lastAcceptedOverview(runDir), received);
  const verdict = acceptReportOverview(call, { identity: readReportIdentity(runDir) });
  if (!verdict.ok) {
    return { written: null, refused: verdict.reason, captured: closeCapture({ ok: false, refused: verdict.reason }), capture_failed: captureFailed };
  }

  const at = join(String(runDir ?? ""), PROSE_FILE);
  try {
    writeFileSync(at, verdict.content);
    // Step 5. Stored ONLY now, after the values passed — see the order above. BEST-EFFORT, and in its
    // OWN try: this is bookkeeping, and bookkeeping that can kill a run is worse than bookkeeping that
    // is absent. Inside the artifact's try, an unwritable `_driver/` would cost a VALID call its
    // artifact — which is the exact failure blind-frame's capture arm exists to prevent.
    try { writeFileSync(reportOverviewCallPaths(String(runDir ?? "")).accepted, acceptedEnvelope(call, now())); }
    catch { /* the next repair merges onto nothing and re-sends; a lost base is never a lost artifact */ }
  }
  catch (e) {
    return { written: null, refused: null, write_failed: String(e?.message ?? e).slice(0, 200),
      captured: closeCapture({ ok: false, write_failed: true }), capture_failed: captureFailed };
  }

  return {
    written: at,
    refused: null,
    actions: verdict.model.actions.length,
    methodology: Boolean(verdict.model.methodology),
    captured: closeCapture({ ok: true }),
    capture_failed: captureFailed,
  };
}

/** Was this run's shell written through the typed transport? The ruled discriminator. */
export function reportOverviewWasRecorded(runDir) {
  try { readFileSync(reportOverviewCallPaths(String(runDir ?? "")).payload, "utf8"); return true; }
  catch { return false; }
}
