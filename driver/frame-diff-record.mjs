// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// frame-diff-record.mjs — the recording transport for the frame-diff stage's structured diff.
//
// Third conversion, after blind-frame and skeptic, and the first with TWO artifacts. The
// stage hands back VALUES; the driver serializes `frame-diff.json` and renders `frame-diff.md` from the
// same parsed model. The seat writes neither.
//
// ── WHY THE PROSE IS RENDERED RATHER THAN KEPT ──────────────────────────────────────────────────────
//
// The stage's own contract already ruled it: the prose element is `mechanical:code-rendered` — "the same
// directives the JSON already carries". And the JSON is the artifact with consumers; `frame-diff.md` is
// read by nothing in the driver. Its only job today is to satisfy `nonEmpty(c, 40)`, which is a length
// floor on a restatement. Asking a model to restate a structure it just handed over, so that a validator
// can check the restatement is at least 40 characters long, is the second-authoring shape exists to
// remove — and it is the one place a directive can say something the JSON does not.
//
// ── IT VALIDATES THROUGH THE SHIPPED PARSER, NOT A COPY ─────────────────────────────────────────────
//
// `parseFrameDiff` is what `verify.mjs` runs against the artifact, and it carries the ask contract — the
// undispatchable-firing-directive rule, with every offender collected into ONE throw. This module calls
// THAT function rather than re-checking the shape, so what the tool accepts and what the validator
// accepts cannot drift. The cardinality property comes with it for free, and it matters more here than
// anywhere: the ladder is three attempts and the 2026-07-29 artifact carried four offenders, so a
// per-directive refusal exhausts the ladder on the first pass.
//
// THE REFUSAL IS THE SAME TEXT THE LADDER WOULD HAVE SHOWN, one attempt earlier. That is the whole gain
// of moving this to a typed call: a seat that phrases a directive as a label learns it in the turn where
// restating is free, rather than at reopen with its session already exited.
//
// ── WHAT THE SCHEMA REMOVES RATHER THAN REFUSES ─────────────────────────────────────────────────────
//
// `layer` and `severity` are ENUMS in the tool's input schema, so `framediff_layer_invalid` and
// `framediff_severity_invalid` become unrepresentable at the transport rather than caught after the fact
// (doubt-closure-call.mjs's `file_index` rule). `dominant_element_gap` is typed `boolean`, which removes
// `framediff_gap_invalid` the same way. The key-unknown family goes with the named schema keys.
//
// Those tokens stay reachable through the dictated path and the parser keeps raising them, because the
// ARCHIVE is full of files written under the dictation and a replay must still be able to fail on them.
//
// ── WHAT THE SCHEMA NO LONGER ASKS FOR AT ALL ───────────────────────────────────────────────
//
// `dominant_element` was an ECHO: the seat was told to retype the blind model's spine verbatim, into a
// field the driver already held two copies of. It is now BOUND — `boundDominantElement` reads the run's
// own artifacts and the tool's input schema has no such property, so the value cannot be mistyped, and a
// seat that sends one anyway is ignored rather than obeyed (nothing below reads `params.dominant_element`;
// the capture still records that it arrived). The doubt-closure-call.mjs rule one more time: a field a schema
// cannot express is a defect that cannot arise, where a field a validator checks is one that has moved.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { captureCall, stampVerdict } from "./call-capture.mjs";
import { join } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";   //
import { parseFrameDiff } from "./frame-diff-model.mjs";
import { parseBlindFrameModel } from "./blind-frame-model.mjs";
import { dominantElementFromManifest } from "./scope-ledger.mjs";

export const MODEL_FILE = "frame-diff.json";
export const PROSE_FILE = "frame-diff.md";
const SCHEMA_VERSION = 1;

/**
 * The run's own dominant element, in a STATED order, from artifacts the driver wrote or validated.
 *
 * 1. `blind-frame-model.json` — the document this diff IS a diff of, and the only place the spine the
 *    blind re-derivation locked onto is recorded as a validated field.
 * 2. `variant-manifest.md`'s `Dominant element:` line — the prose seeding fallback, for a run whose blind
 *    model is missing or unparseable.
 *
 * Both were already the driver's fallback chain (pipeline.mjs); only removed the seat's echo from
 * IN FRONT of them. Returns `{value, source}` with `source: null` when neither artifact answers — an
 * empty spine is a state the backstop already handles, and naming the source is what lets a reader tell
 * "no artifact answered" from "the artifact said nothing".
 *
 * IMPURE (reads the run dir), and deliberately the only impure thing in this module besides the writes.
 *
 * TWO ENTRY POINTS ON PURPOSE. The driver holds a `paths` object and must keep using it —
 * `boundDominantElementFrom` takes it, so the pipeline never re-derives a filename the path table owns.
 * The MCP handler has only the run dir, so `boundDominantElement` joins the two names itself. One body,
 * so the two callers cannot come to different answers about which artifact is authoritative.
 */
export function boundDominantElementFrom({ blindFrameModel, variantManifest } = {}) {
  try {
    const v = String(parseBlindFrameModel(readFileSync(String(blindFrameModel), "utf8")).dominant_element ?? "").trim();
    if (v) return { value: v, source: "blind-frame-model.json" };
  } catch { /* unreadable or unparseable — fall through to the manifest */ }
  try {
    const v = String(dominantElementFromManifest(readFileSync(String(variantManifest), "utf8")) ?? "").trim();
    if (v) return { value: v, source: "variant-manifest.md" };
  } catch { /* neither artifact answers */ }
  return { value: "", source: null };
}

export function boundDominantElement(runDir) {
  const dir = String(runDir ?? "");
  return boundDominantElementFrom({
    blindFrameModel: join(dir, "blind-frame-model.json"),
    variantManifest: join(dir, "variant-manifest.md"),
  });
}

/** Where the call's evidence lives — the driver's own record of what the seat handed it. */
export function frameDiffCallPaths(runDir) {
  const dir = driverDir(runDir, "frame-diff-calls");
  return { dir, payload: join(dir, "call-001.json") };
}

/**
 * The prose, rendered from the PARSED model — never from the received params.
 *
 * Rendering from the parse is what makes the two artifacts one statement: the file on disk and the prose
 * beside it cannot disagree about a directive, because the prose is a projection of the same object that
 * was serialized. Rendering from `received` would re-open exactly the gap this conversion closes.
 *
 * PURE.
 */
export function renderFrameDiff(model) {
  const out = ["# Frame diff", ""];
  out.push(`Dominant element: ${model.dominant_element || "— (none named)"}`);
  out.push(`Dominant-element gap: ${model.dominant_element_gap ? "YES" : "no"}`, "");

  if (!model.directives.length) {
    out.push("## Directives", "", "None. The blind model matched the actual scope — a clean diff.", "");
  } else {
    out.push(`## Directives (${model.directives.length})`, "");
    for (const d of model.directives) {
      out.push(`### ${d.severity} · ${d.layer} · ${d.item}`);
      out.push("", d.observation || "— (no observation given)", "");
      if (d.remedy) {
        const parts = [];
        if (d.remedy.terms?.length) parts.push(`terms: ${d.remedy.terms.join(", ")}`);
        if (d.remedy.nice_classes?.length) parts.push(`classes: ${d.remedy.nice_classes.join(", ")}`);
        if (d.remedy.regions?.length) parts.push(`regions: ${d.remedy.regions.join(", ")}`);
        out.push(`Remedy — ${parts.join(" · ")}`, "");
      }
    }
  }
  // NAMED AS DRIVER-WRITTEN, in the artifact itself. A reader who finds this file in a run dir should not
  // have to know which build wrote it to know whether a human-shaped sentence in it means anything.
  out.push("---", "", "Rendered by the driver from the stage's `record_frame_diff` call. The structured "
    + `diff in ${MODEL_FILE} is the authority; this file restates it and is read by nothing.`, "");
  return out.join("\n");
}

/**
 * Assemble the model from typed params and validate it through the SHIPPED parser.
 *
 * `dominantElement` is the DRIVER'S value (boundDominantElement above), never the seat's —. It is a
 * parameter rather than a read so this function stays PURE and the run-dir read stays at the one impure
 * edge below.
 *
 * Returns `{ok: true, model, content}` or `{ok: false, reason}` where reason is the parser's own
 * token-first message. PURE.
 */
export function acceptFrameDiff(params, { dominantElement = "" } = {}) {
  const model = {
    schema_version: SCHEMA_VERSION,
    // `|| undefined` so the delete loop below drops the key when no artifact answered, rather than
    // stamping an empty string the render would print as a named-nothing.
    dominant_element: String(dominantElement ?? "").trim() || undefined,
    directives: params?.directives,
    dominant_element_gap: params?.dominant_element_gap,
  };
  // Undefined keys are dropped rather than sent as `undefined`: JSON.stringify would remove them anyway,
  // and the parser must see the same object the file will. `dominant_element_gap` is deliberately NOT
  // defaulted — the parser's `framediff_gap_invalid` is the right answer to a seat that omitted it, and a
  // default here would answer for the seat.
  for (const k of Object.keys(model)) if (model[k] === undefined) delete model[k];

  try {
    const parsed = parseFrameDiff(JSON.stringify(model));
    return { ok: true, model: parsed, content: renderFrameDiff(parsed) };
  } catch (e) {
    return { ok: false, reason: String(e?.message ?? e) };
  }
}

/**
 * Capture what arrived, validate, and write both artifacts — in that order.
 *
 * The capture happens BEFORE the decision, as in both sibling transports: a payload recorded after
 * validation records what we DECIDED, which is already in the answer, rather than what we were GIVEN.
 * That is also what makes the capture the discriminator a conversion is proven by — it exists even for a
 * REFUSED call, so its absence means the seat took the deleted path.
 *
 * THE JSON IS WRITTEN FIRST and the prose second, and the order is not arbitrary: the JSON is the
 * artifact every consumer reads, so a crash between the two leaves the run with its load-bearing file and
 * a missing restatement, rather than a restatement of something that was never stored.
 */
export function recordFrameDiff(runDir, received, { now = () => new Date().toISOString() } = {}) {
  const { dir, payload } = frameDiffCallPaths(String(runDir ?? ""));
  // — ONE FILE PER CALL, refusals included. This wrote a single fixed `call-001.json`,
  // so a turn refused and then re-sent kept only the survivor: the file whose header promises "including
  // calls that were refused" held the one call that was not. Sequence 1 still resolves to `call-001.json`,
  // so every consumer reading that name is unmoved. Best-effort throughout, as the capture always was —
  // a lost forensic record never fails a run.
  const nameFor = (seq) => join(dir, `call-${String(seq).padStart(3, "0")}.json`);
  const cap = captureCall({ nameFor, params: received, now });
  const captureFailed = cap.failed;
  const closeCapture = (v) => { stampVerdict(cap.path, v); return cap.path; };

  // BOUND, not received. Derived after the capture so that a call which still carries an echo is
  // recorded carrying it — the capture is the evidence of what the seat did, and it must not be tidied.
  const bound = boundDominantElement(runDir);
  const verdict = acceptFrameDiff(received, { dominantElement: bound.value });
  if (!verdict.ok) {
    return {
      written: null,
      refused: verdict.reason,
      captured: closeCapture({ ok: false, refused: verdict.reason }),
      capture_failed: captureFailed,
    };
  }

  const at = join(String(runDir ?? ""), MODEL_FILE);
  const proseAt = join(String(runDir ?? ""), PROSE_FILE);
  try {
    writeFileSync(at, JSON.stringify(verdict.model, null, 2) + "\n");
    writeFileSync(proseAt, verdict.content);
  } catch (e) {
    // The diff was VALID and we could not store it. An infrastructure failure must not read as a rejected
    // diff — the two have opposite repairs, and reporting a full disk as a reasoning defect sends the seat
    // to re-reason a diff that was already correct.
    return {
      written: null,
      refused: null,
      write_failed: String(e?.message ?? e).slice(0, 200),
      captured: closeCapture({ ok: false, write_failed: true }),
      capture_failed: captureFailed,
    };
  }

  return {
    written: at,
    prose: proseAt,
    refused: null,
    directives: verdict.model.directives.length,
    dominant_element_gap: verdict.model.dominant_element_gap,
    // TOLD BACK, because the seat is no longer the one supplying it: an answer that silently used a
    // different spine than the seat was reasoning about would be the echo defect with the arrow reversed.
    dominant_element: verdict.model.dominant_element,
    dominant_element_source: bound.source,
    captured: closeCapture({ ok: true }),
    capture_failed: captureFailed,
  };
}

/** Read back what was written — used by the tool's answer so the seat is told the stored state. */
export function readRecordedFrameDiff(runDir) {
  try { return parseFrameDiff(readFileSync(join(String(runDir ?? ""), MODEL_FILE), "utf8")); }
  catch { return null; }
}
