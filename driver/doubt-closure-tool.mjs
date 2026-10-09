// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// doubt-closure-tool.mjs — B's shape for the closure transport: the half that touches disk.
//
// `doubt-closure-call.mjs` decides whether a typed row is acceptable and is PURE. This resolves the run's
// paths, captures what arrived, and answers the seat inside its turn.
//
// ✅ CONSUMED AT CONVERSION 6. This header said the opposite for two days and is corrected here
// rather than left standing — a module whose header calls it inert, while the pipeline calls it, is the
// stale-comment disease in the one place a reader checks first.
//
// What it used to say: "Nothing calls this… converting it would strip a tool it demonstrably uses, which
// is exactly what the gate forbids", resting on O3c's 72 Bash calls / 9 writes across 16 attempts. That
// was a description of a measurement, not a ruling, and the measurement resolves the other way once you
// ask what those calls REACH. Re-measured (113 calls / 19 attempts, 1 attempt without a transcript):
// every Bash call that touched evidence touched one of the THREE citable files, `Read` already served
// those files 71 times, and the single attempt that wrote a scratch script wrote 13 lines of `open` and
// `print` over those same three. The gate's rule is "loses no tool it demonstrably uses" — and the seeded
// `Read` grant serves all of it, whole. The cost is real and stated in the RECORDING row: the seat loses
// grep over a 48KB findings.json and takes it whole.
//
// WHAT CHANGED HERE, PRECISELY: this module now RENDERS `doubt-closure.md` from the accepted rows, and it
// still does not apply anything. The ledgers are the pipeline's, from run state this module does not
// hold. The render lives here and not in the pipeline for an ordering reason worth keeping in view:
// `validators.doubtClosure` reads that file when the seat's turn ENDS, before the pipeline applies
// anything, and this stage is NON-FATAL — so a driver that rendered it afterwards would fail validation
// every run and ship the doubts open, looking exactly like a seat that said nothing.
//
// ── DECISION 3 FROM B, AND IT IS THE ONE THAT RE-CREATES YESTERDAY'S BLINDNESS IF IT CAPTURES WRONG ──
//
//   THE PAYLOAD IS CAPTURED AS RECEIVED, PRE-SERIALIZATION. What lands in the record is the argument
//   object this process was handed, serialized by US — not the seat's bytes, not a re-read, not a summary
//   computed after validation. A capture taken after validation records what we DECIDED, which is already
//   in the record, rather than what we were GIVEN.
//
//   THE INDEX IS WRITTEN BY THE RECEIVER, NEVER BY THE CONSUMER. This writes the payload and the line
//   naming it, in that order, BEFORE it validates anything. A consumer-written index can only ever name
//   the payloads the consumer reached; a call that dies mid-flight writes no index line, and its absence
//   is then indistinguishable from a call that was never made. Written here, the line exists before the
//   work does, so a payload with no verdict is a FACT rather than an inference.
//
// ── ONE DECISION IS THIS TRANSPORT'S OWN, AND IT IS THE OPPOSITE OF B'S ──────────────────────────────
//
// B folds accepted rows into the form through `unionDispositionForm` — the SHIPPED union — because a
// second writer for that artifact is disease 7. Here there is no equivalent: the doubt ledger is applied
// by `applyClosure`/`applyAskClosure` inside the pipeline, from run state this module does not hold. So
// this module DOES NOT APPLY ANYTHING. It records the accepted rows in the exact shape those two
// functions consume (`toClosureLines`), and the pipeline is what applies them — on the day it calls this.
// Writing a second application path would be the second writer, one artifact earlier.
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";   //
import { acceptClosureCall, toClosureLines, MAX_CLOSURES_PER_CALL } from "./doubt-closure-call.mjs";
import { idSetHash as idSetHashOf, priorCallWithIdSet as priorCallWithIdSetIn } from "./call-repeat.mjs";   //

const CALLS_DIR = "doubt-closure-calls";
const ARTIFACT = "doubt-closure.md";   // conversion 6 — the driver's render, read by validators.doubtClosure

/** Where a call's evidence lives. Under `_driver/` — this is the DRIVER's own record of what it received. */
export function closureCallPaths(runDir, seq) {
  const dir = driverDir(runDir, CALLS_DIR);
  return { dir, payload: join(dir, `call-${String(seq).padStart(3, "0")}.json`), index: join(dir, "index.jsonl") };
}

/**
 * Capture what arrived, BEFORE anything is decided about it, and index it here in the receiver.
 *
 * Best-effort: a capture that cannot be written must never cost the seat its call — the rows are still
 * valid work. But the failure is RETURNED rather than swallowed, because "captured" and "capture failed"
 * are different facts and the caller reports which.
 */
export function captureCall(runDir, seq, received, { now = () => new Date().toISOString() } = {}) {
  const { dir, payload, index } = closureCallPaths(runDir, seq);
  const rows = Array.isArray(received?.closures) ? received.closures : [];
  try {
    mkdirSync(dir, { recursive: true });
    // Written WHOLE and unfiltered — including rows that will be refused, and including fields this
    // transport does not accept. A payload pruned to what we liked is not evidence about what was sent.
    writeFileSync(payload, JSON.stringify({
      _provenance: "the typed call as RECEIVED by the tool, WHOLE — never the seat's own bytes, and never a selection: every key the recorder was handed is written, including ones this transport does not accept, because a payload pruned to what we liked is not evidence about what was sent",
      receivedAt: now(), seq, rowCount: rows.length,
          // ── — THE WHOLE CALL, not the one field this tool reads ──────────
          // This wrote `closures` alone. A capture stamped "the typed call as RECEIVED" that records
          // one extracted field is not a record of the call, and an audit replaying it reads the
          // absent fields as a transport that never sent them. Spread LAST so the call's own keys
          // win over nothing and the meta above cannot be shadowed by a seat-supplied key.
          ...(received && typeof received === "object" && !Array.isArray(received) ? received : { closures: rows }),
    }, null, 2) + "\n");
    appendFileSync(index, JSON.stringify({ at: now(), seq, payload: basename(payload), rowCount: rows.length,
        // — the id-set hash rides the index row, so a repeat is detectable from the DRIVER's own
        // record rather than by re-reading every payload, and it stays readable after the run.
        idSetHash: idSetHash(received) }) + "\n");
    return { ok: true, payload };
  } catch (e) {
    return { ok: false, payload: null, why: String(e?.message ?? e).slice(0, 200) };
  }
}

// ── — RE-SENT ACCEPTED WORK, WHICH IS NOT A REFUSAL ──────────────────────────────────────────
//
// The sibling stages bound a loop by counting REFUSALS per item (disposition's PARK_AFTER_REFUSALS). That
// instrument cannot see what killed this stage. Measured across six runs and seven kills at timeout+60,
// all `stopReason: tool_use`: one run sent six calls carrying TWO distinct id-sets — A,B,A,B,A,B,
// identical by hash — and **the tool refused nothing**. Every call was accepted. Every item was answered
// more than once; the seat was re-sending work already taken. A refusal counter reads zero through all of
// it, so a bound built on refusals would have shipped and changed nothing.
//
// So the bound here is on IDENTITY, not on rejection: a batch whose id-set has already been accepted in
// this stage is answered from the ledger instead of being re-run.
//
// A REPEAT IS ANSWERED FROM THE LEDGER, AND THE PREMISE THAT MAKES THAT SAFE IS NAMED HERE.
//
// A serve keyed on ids is only safe while the ids mean the same thing for the life of the stage. They do,
// and it is a property of THIS CALL SITE rather than of the ids themselves: `pipeline.mjs` writes
// `_driver/doubt-closure-spec.json` — `openIds` and all — and the very next statement is
// `await stage("doubt-closure", ctx)`. `stage()` runs its whole retry ladder inside that call, so the
// spec is written ONCE and every attempt reads the same file. There is exactly one writer of that
// filename in the tree; the MCP side only reads it.
//
// THAT PREMISE IS WHY THIS IS SAFE, SO CHECK IT BEFORE MOVING THE SPEC WRITE. Five of the six
// doubt-minting sites build an id from an ordinal over a FILTERED list
// (`presence-reconciliation.mjs:182` mints `doubt:presence:<sheet>:<n>` after three `continue` filters,
// with `status: "open"` hardcoded beside it); `doubt-ledger.mjs:232` is the exception and the template,
// putting the candidate name in the id and using the ordinal only as a tiebreaker. If the spec is ever
// minted per attempt instead of per stage, those ordinals can shift between attempts and this serve
// starts handing back a verdict about a different subject. Nothing else in this file would notice.
//
// IT ALSO STOPS THE ARTIFACT CONTRADICTING ITSELF, which is the half that was costing correctness rather
// than time. `readAcceptedClosures` concatenates every `accepted-NNN.json` and the render maps all of
// them, deduping nothing — so a re-sent batch put one line per send into `doubt-closure.md`, and where a
// verdict had changed it put BOTH answers in for the same id. A served repeat writes no second accepted
// file, so no duplicate line is ever rendered.
//
// AND IT STILL RECORDS THE REPEAT. The reason the same set comes back is not settled — a fresh seat
// re-reading identical artifacts, or something upstream — and these repeats are the evidence. Serving
// silently would remove the only trace, so the hash rides the call index and the answer names the call
// it repeats.
//
// WHAT THIS DOES NOT DO: it does not stop the seat re-sending, and it does not touch how a settle/open
// contradiction already in a ledger is resolved (`doubt-ledger.mjs:510`, first-SETTLED-wins, an OPEN line
// discarded). That resolution predates this and is being ruled on separately; deciding it by diff here
// would be answering a doctrine question with an implementation.

// — THE DETECTOR MOVED OUT. Coverage and declination need the same "have I already been sent these
// items" question, and three hand-written copies of one shape is the defect this tree keeps paying for.
// It lives in `call-repeat.mjs`; this stage supplies the one fact that differs — the property that names
// an item — and needs NO generation key, because `doubt_id` is stable for the life of the stage (the spec
// sidecar is written once, outside the retry ladder; see the block above).
//
// Re-exported so the existing callers and tests keep their import site.
export const idSetHash = (received) => idSetHashOf(received?.closures, { idField: "doubt_id" });
export const priorCallWithIdSet = (runDir, hash) => priorCallWithIdSetIn(closureCallPaths(runDir, 0).index, hash);

/** How many calls this run has already recorded — a budget is measured, never guessed. */
export function callsSoFar(runDir) {
  const { index } = closureCallPaths(runDir, 0);
  try { return readFileSync(index, "utf8").split("\n").filter((l) => l.trim()).length; } catch { return 0; }
}

/**
 * The tool body. Capture, decide, record, answer.
 *
 * @param spec     {runDir, openIds: string[], allowedFiles: string[], fileTexts: {name: text}} — all
 *                 supplied by the DRIVER. The seat contributes none of it, which is what makes
 *                 `file_index` positional and `doubt_id` closed.
 * @param received the argument object as handed to this process
 * @returns the seat-facing answer: what was accepted, what was refused and why, and what is still owed.
 */
export function recordClosures(spec, received, { now = () => new Date().toISOString() } = {}) {
  const runDir = String(spec?.runDir ?? "");
  const openIds = new Set(spec?.openIds ?? []);
  const allowedFiles = spec?.allowedFiles ?? [];
  const fileTexts = spec?.fileTexts ?? {};
  const bornIn = spec?.bornIn ?? {};                 // id → the artifact that doubt was minted out of

  const seq = callsSoFar(runDir) + 1;

  // — THE REPEAT CHECK RUNS BEFORE THE CAPTURE, AND THE ORDER IS THE WHOLE THING. `captureCall`
  // appends THIS call's row, hash included; asking afterwards would match the row we just wrote and every
  // call would report itself as a repeat of itself. Asked first, against the index as it stood.
  const idSet = idSetHash(received);
  const repeatOf = priorCallWithIdSet(runDir, idSet);

  const capture = captureCall(runDir, seq, received, { now });      // BEFORE any decision

  // — SERVED, NOT RE-RUN. Everything this batch asks about has already been decided and recorded in
  // this stage; re-running it produces the same rows, a second `accepted-NNN.json`, and a duplicate line
  // per row in the artifact. `still_open` is re-derived from the ledger as it stands NOW rather than
  // echoed, so the answer is current even though the work is not repeated.
  if (repeatOf) {
    const ledger = readAcceptedClosures(runDir);
    const answeredIds = new Set([...ledger.doubt, ...ledger.ask]
      .map((l) => String(l?.id ?? "").trim()).filter(Boolean));
    const sentIds = [...new Set((Array.isArray(received?.closures) ? received.closures : [])
      .map((r) => String(r?.doubt_id ?? "").trim()).filter(Boolean))];
    return {
      // How many of the rows you just sent are already recorded — not "how many we took just now", which
      // would be a truthful 0 and would read to the seat as a silent rejection of the whole batch.
      accepted: sentIds.filter((id) => answeredIds.has(id)).length,
      refused: [],                               // nothing was rejected; nothing was judged
      still_open: [...openIds].filter((id) => !answeredIds.has(id)),
      max_rows_per_call: MAX_CLOSURES_PER_CALL,
      evidence_files: allowedFiles,
      captured: capture.ok ? capture.payload : null,
      capture_failed: capture.ok ? null : capture.why,
      // BOTH NULL means not attempted, which is the truth: no new rows, so nothing to record and nothing
      // to re-render. `served_from_ledger` is what distinguishes this from a record that failed.
      recorded: null, record_failed: null,
      artifact: null, artifact_failed: null,
      id_set: idSet,
      repeat_of: repeatOf.seq,
      served_from_ledger: true,
      note: `every item in this batch was already accepted on call ${repeatOf.seq}; answered from the `
        + `ledger and not re-run. Send only what "still_open" lists, or stop.`,
    };
  }

  const { accepted, refused } = acceptClosureCall(received?.closures, { openIds, allowedFiles, fileTexts, bornIn });

  // The accepted rows in the shape applyClosure / applyAskClosure already consume. RECORDED, not applied —
  // see the header. The pipeline holds the ledgers; this module holds no run state and must not pretend to.
  const lines = { doubt: toClosureLines(accepted, "doubt"), ask: toClosureLines(accepted, "ask") };
  let recorded = { ok: false, why: "not attempted" };
  try {
    const { dir } = closureCallPaths(runDir, seq);
    mkdirSync(dir, { recursive: true });
    const at = join(dir, `accepted-${String(seq).padStart(3, "0")}.json`);
    writeFileSync(at, JSON.stringify({ at: now(), seq, lines }, null, 2) + "\n");
    recorded = { ok: true, path: at };
  } catch (e) { recorded = { ok: false, why: String(e?.message ?? e).slice(0, 200) }; }

  // THE ARTIFACT, RENDERED HERE AND NOT BY THE PIPELINE — an ordering fact, not a preference.
  // `validators.doubtClosure` reads doubt-closure.md and runStage checks it when the seat's turn ENDS,
  // which is before the pipeline gets to apply anything. A driver that rendered the file afterwards would
  // fail validation on every run, on a NON-FATAL stage, so the doubts would ship open and the run would
  // look like a seat that said nothing. Rendered from the union of everything accepted so far, this call
  // included, so a batch split across calls leaves one whole artifact rather than the last call's slice.
  // Best-effort, and the failure is returned rather than swallowed: the ledgers are applied from the
  // RECORDED rows either way, so a lost render costs the reader its file, never a settlement.
  let rendered = { ok: false, why: "not attempted" };
  try {
    const all = readAcceptedClosures(runDir);
    writeFileSync(join(runDir, ARTIFACT), renderClosureArtifact(all));
    rendered = { ok: true, path: join(runDir, ARTIFACT) };
  } catch (e) { rendered = { ok: false, why: String(e?.message ?? e).slice(0, 200) }; }

  // What is still owed, re-derived from the ledger as it stands NOW rather than from a frozen set: the
  // seat learns which of its own doubts remain unanswered from here or nowhere.
  const answered = new Set(accepted.map((r) => r.doubt_id));
  const stillOpen = [...openIds].filter((id) => !answered.has(id));

  return {
    accepted: accepted.length,
    refused,                                   // per row, with the reason the seat can act on
    still_open: stillOpen,
    max_rows_per_call: MAX_CLOSURES_PER_CALL,
    evidence_files: allowedFiles,              // BY POSITION — the list file_index indexes
    // Both facts, never inferred from silence: whether we kept what you sent, and whether we kept what
    // we decided. A caller that reports only one of them cannot tell a lost payload from a lost verdict.
    captured: capture.ok ? capture.payload : null,
    capture_failed: capture.ok ? null : capture.why,
    recorded: recorded.ok ? recorded.path : null,
    record_failed: recorded.ok ? null : recorded.why,
    artifact: rendered.ok ? rendered.path : null,
    artifact_failed: rendered.ok ? null : rendered.why,
    // — SAID OUT LOUD TO THE SEAT, not only written to the index. A seat that re-sends a batch it
    // has already had accepted is told so, by call number, which is the cheapest place for the loop to
    // end. Written UNCONDITIONALLY as string|null: "not a repeat" and "this tool does not report repeats"
    // are different facts, and a key that appears only when something is wrong makes its absence a claim.
    id_set: idSet,
    repeat_of: repeatOf ? repeatOf.seq : null,
    served_from_ledger: false,     // written on BOTH paths — a key that appears only when it is true
                                   // makes its absence mean two things at once.
  };
}

/**
 * Every accepted row this run recorded, in call order, split by ledger.
 *
 * THE PIPELINE'S READ, and it is deliberately over the RECORDED files rather than over a return value.
 * A stage can be re-dispatched (the repair ladder) and a batch can arrive across several calls, so the
 * ledger the driver applies is the UNION of what was accepted, not whatever the last call happened to
 * return. Reading the directory is also what makes a partial run legible: three accepted files and a
 * fourth call that died mid-flight leaves three files, and the union is exactly the work that survived.
 *
 * An unreadable or malformed accepted file is SKIPPED and counted, never thrown: this stage is
 * non-fatal by design, and one corrupt capture must not cost the run every settlement beside it. The
 * count is returned so the caller can say so rather than infer silence.
 */
export function readAcceptedClosures(runDir) {
  const { dir } = closureCallPaths(runDir, 0);
  const out = { doubt: [], ask: [], files: 0, unreadable: 0 };
  let names = [];
  try { names = readdirSync(dir).filter((f) => /^accepted-\d+\.json$/.test(f)).sort(); } catch { return out; }
  for (const n of names) {
    try {
      const doc = JSON.parse(readFileSync(join(dir, n), "utf8"));
      if (Array.isArray(doc?.lines?.doubt)) out.doubt.push(...doc.lines.doubt);
      if (Array.isArray(doc?.lines?.ask)) out.ask.push(...doc.lines.ask);
      out.files++;
    } catch { out.unreadable++; }
  }
  return out;
}

/**
 * Render the artifact from the accepted rows — the SAME set the ledgers are applied from.
 *
 * WHY THE FILE STILL EXISTS AT ALL. The seat no longer writes it and nothing parses it back: the driver
 * applies typed rows directly. But `validators.doubtClosure` reads this file and requires those lines,
 * the archive keeps it, and a human reads it. A conversion that simply stopped writing it would leave a
 * validator reading a file nobody writes — and this stage is NON-FATAL, so that failure would be quiet.
 * One accepted set, two outputs: the ledgers and this. Never a second source.
 */
export function renderClosureArtifact({ doubt = [], ask = [] } = {}) {
  const line = (l) => (l.verdict === "OPEN"
    ? `OPEN ${l.id}: ${l.reason}`
    : `${l.verdict} ${l.id}: ${l.file}: "${l.quote}" — ${l.reason}`);
  const body = [...doubt, ...ask].map(line);
  // A run with opens but no accepted rows still gets a file, and it says so in a line a reader can act
  // on. An empty file would validate as absence and read as "the stage had nothing to say".
  if (!body.length) return "# Doubt closure\n\n(no verdict was accepted this run — every open doubt and ask ships OPEN)\n";
  return `# Doubt closure\n\n${body.join("\n")}\n`;
}
