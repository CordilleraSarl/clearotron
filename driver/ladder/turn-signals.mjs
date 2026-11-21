// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// ladder/turn-signals.mjs — what the ladder reads off a settled turn and decides from it: the stream's meta, digest and
// token rate, the tool gauge, how a hard-wall kill read, the refusals in a window, a write's boundary, whether an attempt
// passed and spent its budget cleanly, whether a failure may retry warm or carry its draft, and the wait between attempts.
//
// Moved out of gateway.mjs unchanged, so that the ladder's phases import these instead of having them handed in.
import { CONNOTATION_FORM_TOKEN_SRC } from "../connotation-search.mjs";
import { anyResultErrored } from "../engine/session-record.mjs";
import { toolWrittenArtifact } from "./form-sync.mjs";

/**
 * Did this attempt spend its whole derived budget, exit cleanly, and still fail? PURE.
 *
 * THE CASE THIS NAMES, measured on one round: an attempt ran 958.6 seconds against a derived limit of 900,
 * exited 0, wrote nothing, and was recorded as `missing_file` naming its own output. It was working the whole
 * time — 35,341 output tokens, 119 tool calls, 947.7 seconds of active time. The hard kill is the limit plus
 * 60, so it finished 1.4 seconds under it.
 *
 * WHY THE CLASSIFICATION ABOVE IS RIGHT AND THE RECORD WAS STILL WRONG. `isTimeout`'s third signal needs a
 * non-zero exit as well as a wall past the budget, and the program exited 0 — so it is not a timeout, and
 * nothing here argues it should be. The defect is that the row then read `missing_file`, which names an
 * artifact and sends the next reader to look for a path bug or a race. The two numbers that say otherwise
 * were both on the row — the wall beside the derived limit — and nobody was pointed at them.
 *
 * SO THIS RECORDS A FACT AND MOVES NO POLICY. It does not feed `isTimeout`, it does not change which retry
 * the attempt earns, and the fail class is untouched. Whether a clean exit at the budget should also earn the
 * longer retry a timeout earns is a question for the owner, and the issue that asked for this says so
 * explicitly: it may be right that a clean exit is not a timeout. This is the record it would be decided on.
 *
 * Three-valued, like the model fields on the same row: null when the budget is unknown, so "nobody derived a
 * limit for this stage" stays visibly different from "it did not spend it".
 */
export function spentBudgetCleanly({ fail, killed, code, wall, derivedLimitSec }) {
  if (!fail) return false;                              // a passing attempt is not this shape
  if (!Number.isFinite(derivedLimitSec) || derivedLimitSec <= 0) return null;
  if (!Number.isFinite(wall)) return null;
  if (killed) return false;                             // a kill is the timeout path, not this one
  if (code !== 0) return false;                         // a dirty exit at the budget IS a timeout already
  return wall >= derivedLimitSec;
}


// ── — THE RATE, DERIVED ONCE ──────────────────────────────────────────────────────────────────
//
// register-unit:transliteration-numeric spent 24.5 min to emit FEWER output tokens than a 6.8-min run of
// the same stage — 44.9 tok/s against 10.5 — and finished 31 seconds inside its timeout. Both halves of
// that comparison were already on the attempt row (`wall`, `usage.output`); the RATIO was not, anywhere
// in the tree, so establishing it meant reading two archived runs by hand and dividing. A stage that
// generates four times slower is invisible to anything watching wall alone, because a slow stage and a
// stage doing more work look identical until you divide.
//
// DENOMINATOR, STATED. `wall` excludes lane wait — t0 is taken after the slot is held and `laneWaitMs` is
// the separate measure — so this is seat time, not queueing. It does NOT separate thinking from
// generation: the numerator blends both, and the denominator still contains the turn's own tool waits.
// It records the ratio; it does not diagnose it. A field that claimed more than that would be worse than
// none, because the next reader would stop measuring.
//
// NULL IS NOT ZERO, and that is the whole reason this is a function rather than a division at the call
// site. A killed turn has a null usage envelope; emitting 0 for it would report "generated nothing" for
// exactly the 485-second-opus-killed class that run-economics keeps deliberately visible as UNMEASURED.
// An honest 0 output tokens on a measured turn still reports 0. PURE + exported for test.
// — THE TOOL GAUGE, AND WHY NULL IS NOT ZERO HERE EITHER.
//
// `toolCalls` and `toolWaitMs` say how much of a turn was tool wait rather than generation. An engine
// that cannot report them is NOT a turn that called no tools: `openai-agent` reports no whole-turn tool
// count, so a codex attempt's `toolCalls` is unmeasured. Writing 0 for it would make every codex turn read
// as "called no tools", and a cross-engine comparison would then conclude tool calls are an Anthropic-only
// phenomenon — from an instrument that had simply gone quiet. Its tool wait it does time, from when each
// tool item opens and closes in its stream (openai-agent.mjs, codexTiming).
//
// PRESENT AND NULL, never absent, which is this file's own house rule: a field written even when null
// keeps "this engine cannot report" visibly different from "this record predates the gauge". The first
// cut emitted `undefined`, which JSON drops — the field vanished and those two states became one.
//
// A function rather than a ternary at each call site, for the same reason `tokensPerSec` is one: there
// are two sites, and the rule has to be impossible to state differently in each. PURE + exported for test.
/**
 * THE SAME GAUGE RIDES TWO LEDGERS, AND SUMMING BOTH DOUBLE-COUNTS EVERY FIGURE.
 *
 * `toolGauge` is spread into the per-stage `_driver/<stage>.jsonl` attempt row AND into `run.jsonl`'s
 * `attempt` event, deliberately — the per-stage ledger is what a stage's own analysis reads and the
 * spine is what a whole-run rollup reads, and neither should have to join the other. But a scan that
 * walks every jsonl under the run dir sees each attempt twice, and every millisecond total comes out
 * exactly 2x. That happened: a run-level tool-wait rollup was quoted at double before the shares (which
 * are ratios, and so survive the doubling untouched) gave it away.
 *
 * A ROLLUP MUST PICK ONE LEDGER. Proportions are safe either way; absolute times are not.
 */
export function toolGauge(turn) {
  const n = (v) => (Number.isFinite(v) && v >= 0 ? v : null);
  return {
    toolCalls: n(turn?.toolCalls), toolWaitMs: n(turn?.toolWaitMs),
    // round 2 — the two fields that make a WALL KILL readable. `activeMs` is elapsed minus tool wait,
    // including the gap still open when the kill landed; `toolWaitByTool` says what the wait was made of,
    // keyed by the tool(s) of each ask. The total alone cannot separate `register_execute_plan` (the harness
    // working) from the perplexity tools (another MODEL generating) — and the whole "should the kill clock
    // count tool wait" question turns on which of those the wait was.
    activeMs: n(turn?.activeMs),
    // An OBJECT is a measurement (possibly `{}`: measured, no tools). null is "this engine cannot report".
    toolWaitByTool: turn?.toolWaitByTool && typeof turn.toolWaitByTool === "object" && !Array.isArray(turn.toolWaitByTool)
      ? { ...turn.toolWaitByTool } : null,
    // — the asks whose wait the driver COULD NOT MEASURE: ask and result arrived in
    // one stdout chunk, so both were parsed at the same millisecond and the gap reads 0 for a wait that
    // really happened. An ARRAY is a measurement (`[]` = measured, nothing unmeasurable); null is "this
    // engine cannot report", the same distinction toolWaitByTool draws one line up. RECORDING ONLY:
    // toolWaitMs and the per-tool split are exactly what they were, because the kill clock reads them.
    toolWaitUnmeasurable: Array.isArray(turn?.toolWaitUnmeasurable) ? [...turn.toolWaitUnmeasurable] : null, ...toolCallCounts(turn),
    // The calls by tool name, beside the total, so a tool server's own log can be set against what the
    // model asked for. An OBJECT is a measurement (`{}`: none); null is "this engine cannot report".
    toolCallsByName: turn?.toolCallsByName && typeof turn.toolCallsByName === "object" && !Array.isArray(turn.toolCallsByName)
      ? { ...turn.toolCallsByName } : null,
    // ms from spawn to the engine's first output, on both engines; null when it never spoke or cannot report. With
    // `toolWaitMs` and `activeMs` it splits a turn into start-up, tool wait and work. RECORDING ONLY.
    firstByteMs: n(turn?.firstByteMs),
    // The first call's cache read and write in tokens, where the engine reports them (Claude), and how many times the turn
    // searched for a tool to load (`ToolSearch`), read off its own per-name counts. null where the engine cannot say.
    firstCallCache: turn?.firstCallCache && Number.isFinite(turn.firstCallCache.read) && Number.isFinite(turn.firstCallCache.creation)
      ? { read: turn.firstCallCache.read, creation: turn.firstCallCache.creation } : null,
    toolSearchCalls: turn?.toolCallsByName && typeof turn.toolCallsByName === "object" ? (turn.toolCallsByName.ToolSearch ?? 0) : null,
  };
}

/**
 * Whether the attempt is OK: the driver's verdict (`fail`) AND no result event of the session carried
 * `is_error`. A session the vendor refused and a restart recovered ends in a successful LAST result, so
 * the retry ladder (which reads that last result, unchanged) accepts it; the record says what happened.
 * Readers that ask "did the stage fail" read `fail`, which this does not touch. PURE.
 */
export function attemptOk(fail, turn) {
  return !fail && !anyResultErrored(turn?.session);
}

/**
 * The stream record as a row carries it: the file relative to the run, as the dispatch record names its
 * file, and the size — or why it was not kept. null when the engine kept none or ran no session. PURE.
 */
export function streamMeta(runDir, stream) {
  if (!stream || typeof stream !== "object" || !stream.file) return null;
  const dir = String(runDir ?? "");
  const file = dir && String(stream.file).startsWith(dir) ? String(stream.file).slice(dir.length).replace(/^[\\/]+/, "").replace(/\\/g, "/") : String(stream.file);   // forward slashes, as every record path is, on Windows too
  return { file, present: stream.present === true, bytes: Number.isFinite(stream.bytes) ? stream.bytes : null,
    ...(stream.reason ? { reason: stream.reason } : {}) };
}

export function tokensPerSec(usage, wall) {
  const w = Number(wall);
  if (!usage || !Number.isFinite(w) || w <= 0) return null;
  const out = Number(usage.output);
  if (!Number.isFinite(out) || out < 0) return null;
  return Math.round((out / w) * 100) / 100;
}


// ── — THE CAUSE HAS TO SURVIVE THE DIGEST, AND `slice(-3)` IS WHY IT DID NOT ──────────────────────
//
// Both attempt records kept the LAST three non-empty stderr lines. That is the wrong end for the failure
// this issue is about: a warm-patch rung on the codex engine dies in UNDER A SECOND with exit 1, zero
// tokens, `runId: null` — a startup crash, whose cause is the FIRST thing a process says, not the last.
// What survived was the standing codex PATH-alias warning ("Refusing to create helper binaries under
// temporary dir"), so the record carried noise and the actual exit cause was unrecoverable from the
// artifacts. The rung is spent either way; the diagnosis is what was lost.
//
// HEAD AND TAIL, and the elision is MARKED. A digest that silently drops its middle is a narrator
// claiming to be a transcript — the same shape as a summary line that reads broader than it measures. If
// lines were dropped the digest says how many, so a reader knows it is holding an excerpt.
//
// NOT FILTERED. The obvious move is to drop the known PATH-alias line and keep three real ones, and it is
// refused: a filter that removes what it has decided is noise is exactly how a real cause disappears the
// first time it arrives wearing an unexpected shape. Widening the window keeps the noise AND the signal.
export const STREAM_DIGEST_KEEP = 4;
export function streamDigest(text, { keep = STREAM_DIGEST_KEEP } = {}) {
  const lines = String(text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length <= keep * 2) return lines.join(" ⏎ ");
  const dropped = lines.length - keep * 2;
  return [...lines.slice(0, keep), `… ${dropped} line(s) elided …`, ...lines.slice(-keep)].join(" ⏎ ");
}


// D3 — inter-attempt retry backoff. The ladder used to re-dispatch the SAME SECOND an attempt failed,
// so a failure caused by the environment (the 04:30 gateway restart, a still-booting gateway, a
// transient provider blip) burned every retry into the same broken window — the direct cause of one
// outbox-wake failure. Every retry now waits CLEAROTRON_RETRY_BACKOFF_MS first (default 20s; attempt 1
// never waits, and the wait holds NO turn slot — the engine acquires that inside runTurn). Env knob so
// the test suite pins a tiny value and ops can widen it without a code change; explicit 0 disables.
export function retryBackoffMs() {
  const raw = process.env.CLEAROTRON_RETRY_BACKOFF_MS;
  const n = Number(raw);
  return raw != null && raw !== "" && Number.isFinite(n) ? Math.max(0, n) : 20000;
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// — THE ENGINE'S OWN WRITE GUARANTEE, for the run record.
//
// The boundary is enforced on the anthropic path and absent on the codex path, and until now nothing
// in the record said which one a run got. e2e put it plainly on 2026-08-18: "the same job, run on a
// different engine, gets a different write guarantee, and nothing in the run record says so." A guarantee
// that varies by engine is acceptable when it is DECLARED and dishonest only while it is silent.
//
// UNDECLARED IS A VALUE, not an omission. An adapter that says nothing gets "undeclared" written into the
// record rather than the field quietly disappearing — an absent field reads as "not applicable" to every
// later reader, which is the failure this exists to end. A new engine therefore announces its own silence.
export const writeBoundaryOf = (engine) => {
  const v = String(engine?.writeBoundary ?? "").trim();
  return v || "undeclared";
};

/**
 * One dispatch's refusals, read from the refusal journals of the tool-written artifacts in `files`.
 * An entry is placed by its `at`; one with no readable `at` cannot be placed in a dispatch, so it is
 * counted apart rather than guessed into this one.
 * @returns {{ count: number, last: string|null, unattributed?: number } | null}  null when no file in
 *   `files` has a refusal journal, so "this stage keeps no journal" never reads as "nothing was refused".
 */
export function refusalsInWindow(files, runDir, from, to) {
  let journals = 0, count = 0, unattributed = 0, last = null, lastAt = -Infinity;
  for (const f of files) {
    const reader = toolWrittenArtifact(f)?.refusals;
    if (!reader) continue;
    journals++;
    for (const r of reader(runDir, f) ?? []) {
      const at = Date.parse(String(r?.at ?? ""));
      if (!Number.isFinite(at)) { unattributed++; continue; }
      if (at < from || at > to) continue;
      count++;
      if (at >= lastAt) { lastAt = at; last = String(r?.reason ?? ""); }
    }
  }
  return journals ? { count, last, ...(unattributed ? { unattributed } : {}) } : null;
}

// A failure string's display path. A path outside a studio keeps its Windows drive, `C:\…`, so the patterns
// that read these strings back never stop the path at the first colon: FORM_CLASS_RE and WARM_ELIGIBLE_RE
// take the path lazily up to the token they know, and failingTarget allows a drive letter.
export function rel(p) {
  const m = /[\\/](clearance-search|prelim-search)[\\/]/.exec(p);   // either spelling of the studio segment, behind either separator
  return m ? p.slice(m.index + 1) : p;
}
const WARM_ELIGIBLE_RE = new RegExp(`^(missing_file|invalid_file:.*?:(use_check_missing|own_rights_missing|coverage_ledger_unparseable|coverage_ledger_empty|coverage_axis_invalid|coverage_axis_missing|coverage_status_(invalid|offenum)|coverage_key_unknown|coverage_(no_status|form_damaged|form_axis_invalid|form_engine_vocabulary)|grid_join_missing|grid_ledger_unparseable|platforms_missing|${CONNOTATION_FORM_TOKEN_SRC}|findings?_[a-z_]+|blindframe_[a-z_]+|framediff_[a-z_]+|named_band_(state_invalid|block_invalid|unparseable|missing)|tool_timeout:[a-z_]+:[a-z0-9-]+|plan_audit_missing|intake_ask_unanswered))`);

// — `tool_timeout` IS ON THAT LIST TO KEEP ROUTING WHERE IT ALREADY IS, not to add a lane.
//
// This failure reaches the ladder today as `named_band_missing`, which is warm-eligible. Renaming the
// token without adding it here would quietly move the class from warm to COLD — a full stage re-run
// instead of a resume, on every timeout, as a side effect of an attribution fix. A rename must not
// change what a failure costs.
//
// The issue notes that the argument applies: "the retry ladder cannot help a deterministic tool
// timeout — this failure class is an argument for the same disclosed-deferral treatment when the ladder
// is provably futile." That is a real question and it is NOT settled here. Two reasons to leave it:
// this issue's OTHER half raised the bridge cap, so a retry is no longer provably futile — R5's four
// attempts all died at a 300s cap that no longer applies; and turning a failure class into a disclosed
// deferral is a doctrine change, which is the to make and not an attribution fix's.

// — a rejected draft may be CARRIED across a recovery park only when its repair is a PATCH, not a
// re-search. That is exactly the judgement WARM_ELIGIBLE_RE already encodes: the tokens meaning "the
// search did not happen" (connotation_search_missing, the merge-gate drop) are deliberately kept OUT of
// it, and telling a model "do NOT redo the sweep" over an unsearched grid would manufacture a clean read.
// ONE allowlist governs both "patchable inside the dispatch" and "patchable across a park", so the two
// can never drift apart. Narrowed to invalid_file: a missing_file draft has no bytes to carry.
export function draftCarryEligible(fail) {
  const f = String(fail ?? "");
  return /^invalid_file:/.test(f) && WARM_ELIGIBLE_RE.test(f);
}
export function warmEligible(fail, json) {
  return json?.status === "ok" && WARM_ELIGIBLE_RE.test(fail ?? "");
}

/**
 * How a turn stopped at its hard wall read when it was stopped: "working" when it asked for a tool other than its own record
 * write within the stage's last stall window, "record-only" when its only asks there were that write, "silent" when it asked
 * for none, and null for anything that is not a hard-wall kill or a turn whose engine could not say. The window is the stage's
 * own `stallSec`, 120 s where it sets none, read back from the end of the turn. Measured before this was built, over saved
 * hard-wall kills: 10 of 14 on production and 18 of 24 on a test machine were working. PURE.
 */
export function killedWhile(turn, stallSec) {
  if (!turn?.killed || !turn?.signals?.hardWall || turn?.signals?.stalled) return null;
  const asked = turn.lastToolAsk;
  const wallMs = Number(turn.wall) * 1000;
  if (!asked || !Number.isFinite(wallMs)) return null;
  const windowMs = (Number.isFinite(stallSec) && stallSec > 0 ? stallSec : 120) * 1000;
  const within = (ms) => Number.isFinite(ms) && wallMs - ms <= windowMs;
  return within(asked.workMs) ? "working" : within(asked.recordMs) ? "record-only" : "silent";
}

// ── — THE FIRST RETRY IS ROUTED BY THE RUN'S OWN COUNTED STATE, NOT BY A TOKEN NAME ────────────
//
// Two m-seat failures in the same hour, on the same engine, with opposite correct answers:
//
//   R5  3 rows of many unruled     warm patch     83s  closed
//   R6  EVERY row unruled          warm patch   1007s  byte-identical, discarded
//
// The warm patch is right on R5 and unwinnable on R6. A resumed session re-reads its own output; it
// cannot produce rulings it did not produce the first time when the defect is "you ruled none of the
// rows". The engine already reaches that conclusion — the byte-identical escalation in runStage says so
// in its own words — and pays seventeen minutes to reach it.
//
// THE CONDITION IS THE DIRECT STATE: attempt > 1 and the stage's meaning population has ZERO ruled rows,
// read from the judgement's own count (syncDispositionForm → lastUnion, counted by isRuled — the same
// predicate the gate judges with). It is DELIBERATELY NOT a token list. The first cut keyed this veto on
// TOTAL_DEFECT_TOKENS, a closed list of two form-path tokens — and when the typed transport armed, the
// failure tokens moved out of the list and the veto silently stood down with every assertion still green
// (the hold). An enrolled-token veto is an ENUMERATED check: a future fifth token forgetting to
// enrol is the move-blindness this repo has counted seven instances of. The direct state keys the veto
// on the condition it exists for, and nothing has to remember to join.
//
// THE CALL TAXONOMY IS CLASSIFICATION, NOT THE VETO'S KEY. call_never_made / call_truncated /
// call_partial / call_schema_violation stay as telemetry and as the seat's own remedy routing — their
// partial-vs-total reasoning (a seat that has recorded rows is a seat warm can help; R5's case, and warm
// wins it) now lives in the COUNT the veto reads rather than in a list a token must enrol in.
//
// THE DISPATCH KIND STRING "fresh-total-defect" IS KEPT for journal-vocabulary stability — readers of
// dispatch records and attempt rows bind to it, and a rename would change what a failure costs a reader
// long after it stopped changing what it costs the run.
//
// This does not add or remove a ladder attempt. It decides what attempt 2 IS.
/**
 * Must a corrective retry refuse to RESUME the failed session? True exactly when this stage owes a
 * meaning population and that population has zero ruled rows — the state a resumed session cannot fix.
 *
 * `state` is syncDispositionForm's return: null (stage owes no meaning sweep — the veto does not
 * apply), { countable: false } (owes a sweep, state unreadable), or the counted stats.
 *
 * ── RIDER: A MISSING OR UNCOUNTABLE RULINGS COUNT READS AS ZERO — THE VETO FIRES. DELIBERATELY. ──────
 * This INVERTS the house "an absence is a finding, never a zero" rule, and it is correct in exactly
 * this one place, for one reason: the veto's failure direction is RESUMING-WHEN-IT-SHOULDN'T. Reading
 * an unknown count as "some rows were ruled" resumes a session that may have ruled nothing — the exact
 * 2026-08-15 terminal shape, seventeen paid minutes of a session re-reading its own output. Reading it
 * as zero costs one fresh dispatch. Do not "fix" this to fail loud or to skip the veto on absence: the
 * absence IS still a finding (syncDispositionForm notes it, the validator fails the run in its own
 * lane) — it is only the RESUME decision that must take the safe direction. PURE.
 */
export function vetoResumeRuledNone(attempt, state) {
  if (!(attempt > 1) || state == null) return false;
  const ruled = state.countable === true ? Number(state.ruled) : 0;
  return !(ruled > 0);
}

// ── — WHY THIS IMPORT IS AT THE BOTTOM OF THE FILE ─────────────────────────────────────────────
//
// `import` is hoisted, so its position is free — and at the top of THIS file it is not free. 61
// line-citations across 35 tracked files point into this file and its sibling; one line added at the
// top repoints every one of them by one. `scripts/citation-line-check.mjs` would catch only the few
// that landed on a blank line: it says so itself — "a citation that drifted onto a different REAL line
// reads as correct to it". So the choice was a 61-number sweep with a silent-error mode, or one import
// placed where it shifts nothing. This is the second.
//
// Move it to the top the day those citations name symbols instead of numbers — which is what
// CONTRIBUTING.md asks for, and what makes them checkable at all.

/**
 * THE COUNTS A TEST ROUND READS PER STAGE, on both engines, spread into `toolGauge`. `toolCallsRefused`:
 * calls the program refused (Claude's own denials; Codex's tool-server calls refused before reaching their
 * server). `commandToolCalls`: calls to a tool that runs a command, which no Claude stage is offered, so
 * zero is the expected reading there; Codex keeps its shell and counts the commands it ran. `mcpToolCalls`: the tool-server
 * calls Codex completed, its only count of calls made, since its `toolCalls` stays null.
 * `toolCallsErroredByName`: the tool-server calls that came back as an error, by tool name, so a stage that
 * had a call refused and made it again says so where its row otherwise reads ok on one attempt. Null, as in
 * `toolGauge`, is "this engine does not report", never zero. RECORDING ONLY. It sits at the end of this
 * file so that adding it moved no line another file cites.
 */
function toolCallCounts(turn) {
  const n = (v) => (Number.isFinite(v) && v >= 0 ? v : null);
  const errored = turn?.toolCallsErroredByName;
  return { toolCallsRefused: n(turn?.toolCallsRefused), commandToolCalls: n(turn?.commandToolCalls), mcpToolCalls: n(turn?.mcpToolCalls),
    toolCallsErroredByName: errored && typeof errored === "object" && !Array.isArray(errored) ? { ...errored } : null };
}
