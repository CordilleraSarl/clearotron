// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Addendum AD-1 (2026-07-30) — the runStage ladder's two new stop conditions, end-to-end through the
// anthropic-agent engine + mock-claude ($0/offline):
//   A4: a byte-identical CONTENT failure signature on consecutive attempts breaks the ladder
//       immediately (same stage, same validator string ⇒ stop, park honestly) — and ONLY the content
//       classes: transport failures keep their existing retry policy untouched.
// build 2 (2026-08-08) carved out ONE case: when the repeating attempt was a WARM PATCH, the
//       two attempts are not independent samples — a warm patch resumes the session that produced the
//       previous failure, so the repeat proves nothing. There the SESSION is discarded and attempt N+1
//       runs fresh inside the ladder instead of the run parking to buy the same fresh sample. Everything
//       below is the UNCHANGED half: a cold repeat still breaks at the first repeat, and transport still
//       keeps its own policy. Those are the scope guards, in both directions.
//   A6: stop_reason max_tokens with zero usable output is a DETECTED, NAMED fault
//       (max_tokens_no_output:…) — counted in the stage log, steered in the corrective message —
//       never a silent paid retry of the generic missing_file ladder.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const HERE = dirname(fileURLToPath(import.meta.url));
process.env.CLEAROTRON_AI = "anthropic-agent";
pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", join(HERE, "mock-claude.mjs"));
process.env.CLEAROTRON_RUN_LOCK_DIR = mkdtempSync(join(tmpdir(), "ladder-locks-"));
process.env.CLEAROTRON_RETRY_BACKOFF_MS = "10";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
const { runStage } = await import("../gateway.mjs");

let dir;
beforeEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = mkdtempSync(join(tmpdir(), "ladder-break-"));
  mkdirSync(driverDir(dir), { recursive: true });
  process.env.MOCK_CLAUDE_CALL_LOG = join(dir, "calls.jsonl");
  // The mock's warm-mode branch is a separate path with its own env: it needs MOCK_COUNT_FILE to count
  // turns and writes its artifact to MOCK_OUT_FILE. Unset, `writeFileSync(undefined, …)` throws, the turn
  // exits non-zero, and the failure lands in the TRANSPORT class — so a warm test would run three attempts
  // and prove nothing about the warm lane while looking like it passed something.
  process.env.MOCK_COUNT_FILE = join(dir, "count");
  process.env.MOCK_OUT_FILE = join(dir, "out.md");
  delete process.env.MOCK_CLAUDE_MAXTOK;
  delete process.env.MOCK_FAIL_STAGE;
  delete process.env.MOCK_CLAUDE_NOFILE;
  delete process.env.MOCK_CLAUDE_FILE;
  delete process.env.MOCK_WARM_MODE;
});

const calls = () => readFileSync(process.env.MOCK_CLAUDE_CALL_LOG, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const stageRows = (name) => readFileSync(driverDir(dir, `${name}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l));
// round 2 — a decision that PREVENTS an attempt is not an attempt, so it lands on the run spine
// rather than in the seat ledger. `<stage>.jsonl` is the attempt ledger and several suites derive
// quantities per row from it; a row with no quantity does not belong there.
const preventedRows = () => readFileSync(driverDir(dir, "run.jsonl"), "utf8").trim().split("\n")
  .map((l) => JSON.parse(l)).filter((e) => e.event === "attempt-prevented");

const stage = (over = {}) => runStage("ladder-stage", {
  agent: "clawdi", message: "BASE TASK", sessionKey: "prelim-ladder-base",
  timeoutSec: 30, expectFile: join(dir, "out.md"), maxRetries: 3, runDir: dir, ...over,
});

test("A6: stop_reason max_tokens + no artifact = the NAMED fault, counted in the stage log — and A4 ends the second identical hit", async () => {
  process.env.MOCK_CLAUDE_MAXTOK = "1";
  const r = await stage();
  assert.equal(r.ok, false);
  // the fault is NAMED (never the bare missing_file ladder), and the second byte-identical hit breaks
  // the ladder at attempt 2 — with maxRetries 3 the old behavior would have paid 4 identical turns.
  assert.equal(r.attempts, 2);
  assert.equal(r.identicalSignature, true);
  assert.match(r.fail, /^max_tokens_no_output:missing_file:/);
  assert.deepEqual(r.attemptFails.map((f) => f.startsWith("max_tokens_no_output:")), [true, true]);
  // counted: every attempt row in the stage log carries the named fault + the raw discriminator
  const rows = stageRows("ladder-stage");
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.match(row.fail, /^max_tokens_no_output:/);
    assert.equal(row.stopReason, "max_tokens");
  }
  // never a SILENT retry: the second dispatch's corrective message names the ceiling and the fix
  const c = calls();
  assert.equal(c.length, 2);
  assert.match(c[1].prompt, /maximum output-token ceiling/);
  assert.match(c[1].prompt, /stop_reason max_tokens/);
  assert.match(c[1].prompt, /CALL THE WRITE TOOL/);
});

test("A4: consecutive DIFFERENT validator strings keep the ladder alive; the first byte-identical repeat stops it", async () => {
  // mock default mode writes no recognized artifact path from this message, so drive the validator by
  // hand: attempt 1 and 2 fail DIFFERENTLY (the ladder must continue), attempt 3 repeats attempt 2's
  // string byte-for-byte (the ladder must stop there — not run attempt 4 of maxRetries 3 = 4 allowed).
  const reasons = ["shape_a", "shape_b", "shape_b", "shape_c"];
  let i = 0;
  const validate = () => ({ ok: false, reason: reasons[Math.min(i++, reasons.length - 1)] });
  process.env.MOCK_CLAUDE_FILE = "content\n";
  const out = join(dir, "out.md");
  const r = await stage({ expectFile: out, validate, message: `BASE TASK — write your output to the ABSOLUTE path: ${out}` });
  assert.equal(r.ok, false);
  assert.equal(r.attempts, 3, "attempt 3 repeated attempt 2's validator string — stop, don't spend attempt 4");
  assert.equal(r.identicalSignature, true);
  assert.equal(r.attemptFails.length, 3);
  assert.notEqual(r.attemptFails[0], r.attemptFails[1], "different strings kept the ladder alive");
  assert.equal(r.attemptFails[1], r.attemptFails[2], "the byte-identical repeat is what stopped it");
});

test("#460 A4 scope guard, the other direction: a COLD identical repeat still breaks at the first repeat", async () => {
  // The carve-out is keyed on `warm`, not on "attempt > 1". `declared_unavailable` is deliberately NOT in
  // WARM_ELIGIBLE_RE (warm-retry.test.mjs pins that), so attempt 2 here is cold, nothing is escalated, and
  // A4 must behave exactly as it did before build 2. Key the carve-out on the attempt number instead
  // of on `warm` and this runs to 3 attempts — which is the silent version of widening the change.
  const validate = () => ({ ok: false, reason: "declared_unavailable" });
  process.env.MOCK_CLAUDE_FILE = "content\n";
  const out = join(dir, "out.md");
  const r = await stage({ expectFile: out, validate, maxRetries: 3, message: `BASE TASK — write your output to the ABSOLUTE path: ${out}` });
  assert.equal(r.ok, false);
  assert.equal(r.attempts, 2, "cold repeat: the ladder stops at the first repeat, as it always has");
  assert.equal(r.identicalSignature, true);
  assert.equal(r.warmEscalated, undefined, "nothing was warm, so nothing was escalated");
});

test("A4 scope guard: repeated identical TRANSPORT failures keep the full existing ladder (no early break)", async () => {
  process.env.MOCK_FAIL_STAGE = "BASE TASK";               // every turn: stderr + exit(1) → nonzero_exit_1
  const r = await stage({ maxRetries: 2 });
  assert.equal(r.ok, false);
  assert.equal(r.attempts, 3, "transport failures are NOT in A4's content class — policy unchanged");
  assert.equal(r.identicalSignature, undefined);
  assert.deepEqual(r.attemptFails, ["nonzero_exit_1", "nonzero_exit_1", "nonzero_exit_1"]);
});

// ── build 2 — THE ESCALATION IS ON THE RECORD, PER ATTEMPT ───────────────────────────────────────
// An absence is a finding, and that applies to this change's own evidence. The E2E round has to be able
// to tell "the escalation fired and cost one dispatch" from "the warm patch happened to succeed", and
// neither is readable unless the escalated attempt says so in the journal the round actually reads.
// moved this arm from `stubborn` to a WROTE-BUT-INVALID shape, and the move is the point. Both
// are byte-identical warm repeats; only one still escalates. `stubborn` writes nothing, and a fresh
// attempt 3 after a produced-nothing repeat converged 0 of 6 when it was finally measured — so that case
// now breaks, and its own arm below asserts it. The escalation this test is about is unchanged for a seat
// that produced something, which is where it converged 9 of 9.
const INVALID_EVERY_TURN = { validate: () => ({ ok: false, reason: "findings_unusable" }) };

test("#460 the escalated attempt names itself in the stage log, the spine and the dispatch record", async () => {
  process.env.MOCK_WARM_MODE = "draft";
  const r = await stage({ maxRetries: 2, ...INVALID_EVERY_TURN });
  assert.equal(r.attempts, 3);
  assert.equal(r.warmEscalated, true, "the ladder's own result carries it");

  const rows = readFileSync(driverDir(dir, "ladder-stage.jsonl"), "utf8")
    .trim().split("\n").map((l) => JSON.parse(l));
  const byAttempt = (n) => rows.find((x) => x.attempt === n);
  assert.equal(byAttempt(3)?.warmEscalated, true, "attempt 3 is the escalated dispatch");
  assert.equal(byAttempt(1)?.warmEscalated, undefined, "and only attempt 3 — the field marks ONE dispatch");
  assert.equal(byAttempt(2)?.warmEscalated, undefined);
  assert.equal(byAttempt(2)?.warm, true, "attempt 2 is still recorded as the warm patch it was");

  const spine = readFileSync(driverDir(dir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
    .filter((e) => e.event === "attempt" && e.stage === "ladder-stage");
  assert.equal(spine.length, 3);
  assert.equal(spine[2].warmEscalated, true, "run.jsonl carries it too, or the round has to join two files");
  assert.equal(spine[0].warmEscalated, undefined);
});

test("#460 the mark names ONE dispatch, not every dispatch after it", async () => {
  // The journalling trap. `warmEscalatedAt > 0` and `attempt === warmEscalatedAt` agree whenever the
  // escalated attempt is the LAST one, which is the shape of every other test here — so neither can catch
  // a cumulative flag. This ladder deliberately continues past the escalation: attempts 1 and 2 repeat
  // (escalating attempt 3), attempt 3 then fails DIFFERENTLY so attempt 4 runs. Only row 3 may be marked.
  // Write the flag cumulatively and row 4 is marked too, and the field stops meaning "this dispatch".
  process.env.MOCK_WARM_MODE = "draft";
  const reasons = ["use_check_missing:F1", "use_check_missing:F1", "use_check_missing:F2", "use_check_missing:F3"];
  let i = 0;
  const validate = () => ({ ok: false, reason: reasons[Math.min(i++, reasons.length - 1)] });
  const r = await stage({ validate, maxRetries: 3 });                 // 4 attempts allowed
  assert.equal(r.attempts, 4, "attempt 3 failed differently, so the ladder ran on");
  assert.equal(r.warmEscalated, true);

  const rows = stageRows("ladder-stage");
  assert.deepEqual(rows.map((x) => x.warmEscalated), [undefined, undefined, true, undefined],
    "exactly one dispatch is the escalation");
  assert.equal(calls().filter((c) => /RESUMING your own session/.test(c.prompt ?? "")).length, 1,
    "and still exactly one warm resume in a four-deep ladder");
});

test("#460 an escalated attempt that SUCCEEDS still says it was escalated", async () => {
  // Without the flag on the success return, a run that converged only because the session was discarded
  // is indistinguishable from one where the warm patch happened to work — and the round has nothing to
  // evidence the change with. This is the arm that fails if the field is dropped from the ok:true return.
  process.env.MOCK_WARM_MODE = "draft";
  const reasons = ["use_check_missing:F1", "use_check_missing:F1"];
  let i = 0;
  const validate = () => (i < reasons.length ? { ok: false, reason: reasons[i++] } : { ok: true });
  const r = await stage({ validate, maxRetries: 3 });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 3, "the escalated fresh attempt is the one that cleared it");
  assert.equal(r.warmEscalated, true, "the winning result names the escalation");
  assert.equal(stageRows("ladder-stage")[2].warmEscalated, true);
});

// ── — THE ESCALATION IS FOR A SEAT THAT PRODUCED SOMETHING ─────────────────────────────────────
// build 2 buys one fresh attempt after a warm repeat because a resumed session cannot disagree with
// itself. Measured, that holds for a seat whose output was WRONG (fresh attempt 3 converged 9 of 9) and
// not for a seat that wrote nothing at all (0 of 6, ~3.4 min and ~19k output tokens each time). These two
// arms are the line between them, and they must fail in opposite directions or the rule is not a rule.
test("#1062 a warm repeat that produced NOTHING breaks instead of buying a fresh attempt", async () => {
  process.env.MOCK_WARM_MODE = "stubborn";           // ok every turn, never writes the file
  const r = await stage({ maxRetries: 2 });
  assert.equal(r.ok, false);
  assert.equal(r.attempts, 2,
    `the ladder spent ${r.attempts} attempts on a produced-nothing repeat. Attempt 3 has never once `
    + "converged on this shape, and it is the most expensive thing the ladder can buy.");
  assert.equal(r.identicalSignature, true, "it must still break as an identical-signature stop");
  assert.equal(r.warmEscalated, undefined, "nothing was escalated — that is the whole change");
  assert.match(r.fail, /^missing_file:/, "the fixture stopped producing the shape this arm is about");
});

test("#1062 the cut is RECORDED by name — a decision that prevents an attempt must leave a trace", async () => {
  process.env.MOCK_WARM_MODE = "stubborn";           // the produced-nothing repeat: the cut fires
  await stage({ maxRetries: 2 });
  // `note` is stderr only and reaches no artifact. Because the cut RETURNS, the attempt it prevents never
  // runs — so nothing samples it and n=6 would be permanent: a seat or model change that made attempt 3
  // worth buying again could not be noticed, because nothing counted how often the cut fired or on what.
  const rows = preventedRows();
  assert.equal(rows.length, 1, `the seat's attempt jsonl carries ${rows.length} decision row(s). One decision `
    + "was made and it must appear exactly once — silence here is the state this arm exists to prevent, and "
    + "TWO rows would double every count taken off them (the cut also falls into the break below it).");
  const [r] = rows;
  assert.equal(r.decision, "escalation-declined:produced-nothing", "the row must name the CASE, not just that a cut happened");
  assert.equal(r.rule, "#1062", "and the rule, so a reader can find why without guessing");
  assert.equal(r.wouldHaveBeenAttempt, 3, "the attempt that was not bought is the thing worth counting");
  assert.match(r.fail, /^missing_file:/, "the failure that triggered it rides the row");
});

// ── ROUND 2 — THE BREAK BESIDE THE CUT RECORDED NOTHING, SO THE PATHOLOGY SURVIVED THE FIX ──────
//
// Measured on a delivered run of the test instance (engine 734689e8): the cut's marker appeared in ZERO
// files instance-wide.
// The cut requires `warm`, that run's attempt rows carried no `warm` field at all, and with warm falsy the
// run fell through to the pre-existing identical-signature break — which stopped attempt 3 exactly as the
// cut would have, and left no durable trace. The three arms below are the cold path the fix missed.
test("#1062 the COLD break records too — the same decision, reached by the other branch", async () => {
  // The measured shape: repeated missing_file with nothing warm. Before this, the run record held no
  // trace of a decision that prevented an attempt — which is the exact pathology the cut's own comment names.
  // `missing_file` IS warm-eligible, so the warm lane has to be OFF for this shape to reach the cold
  // break — which is the point: `warm` also requires the previous turn to have reported status ok and the
  // warm patch to be unspent, so a produced-nothing repeat reaches the cold break in ordinary operation
  // whenever any of those does not hold. CLEAROTRON_WARM_RETRY=0 is the code's own switch for it, not a
  // fixture-only shape.
  process.env.CLEAROTRON_WARM_RETRY = "0";
  process.env.MOCK_CLAUDE_NOFILE = "1";
  let r;
  try { r = await stage({ maxRetries: 3 }); } finally { delete process.env.CLEAROTRON_WARM_RETRY; }
  assert.equal(r.ok, false);
  assert.equal(r.identicalSignature, true);
  const rows = preventedRows();
  assert.equal(rows.length, 1, `the cold break wrote ${rows.length} decision row(s) — it must write exactly one`);
  const [d] = rows;
  assert.equal(d.decision, "ladder-break:identical-signature");
  assert.equal(d.rule, "#460", "the PRE-EXISTING rule, named as itself — this change records it, it does not re-decide it");
  assert.equal(d.warm, false, "and it must say the path was cold, or the two branches cannot be told apart in the record");
  assert.equal(d.producedNothing, true);
  assert.equal(d.wouldHaveBeenAttempt, 3, "budget remained: this was a choice, not the end of the ladder");
  // AND IT IS NOT A SEAT. `_driver/<stage>.jsonl` is read by seat-attempts.mjs, which claims any row
  // carrying `{attempt:int≥1, key, status}` as a dispatch and hands it to seat-retry-report's
  // fault-vs-refinement statistics. A decision is not a dispatch, and the row is spelled `atAttempt` so a
  // later hand adding `key`/`status` "for context" cannot silently move that denominator.
  assert.equal(d.attempt, 2, "the attempt the decision was taken at");
  assert.equal(d.stage, "ladder-stage", "the spine holds every stage, so the row must name its own");
  // AND IT IS NOT IN THE SEAT LEDGER. `<stage>.jsonl` is the attempt ledger — convergence-ledger derives
  // quantities per row from it, warm-retry and retry-backoff count rows as attempts, and seat-attempts.mjs
  // claims dispatch-shaped rows there for seat-retry-report. A decision has no quantity and is not a
  // dispatch; filing it there broke four suites the moment it fired on a common path.
  assert.equal(stageRows("ladder-stage").filter((x) => x.decision).length, 0,
    "a decision row leaked into the seat attempt ledger");
});

test("#1062 a cold break that PRODUCED something records the same way, and says so", async () => {
  // The other half of the cold path. `declared_unavailable` is not warm-eligible, so attempt 2 is cold and
  // the seat wrote a file every turn — the case my 0-of-6 measurement says nothing about. The record has to
  // distinguish it, or a later ruling on whether this break is right cannot separate the populations.
  const validate = () => ({ ok: false, reason: "declared_unavailable" });
  process.env.MOCK_CLAUDE_FILE = "content\n";
  const out = join(dir, "out.md");
  await stage({ expectFile: out, validate, maxRetries: 3, message: `BASE TASK — write your output to the ABSOLUTE path: ${out}` });
  const rows = preventedRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].producedNothing, false, "this seat wrote a file every turn — recording it as produced-nothing "
    + "would merge the case the escalation WINS into the case it loses");
  assert.equal(rows[0].warm, false);
});

test("#1062 wouldHaveBeenAttempt is NULL, and PRESENT, when the ladder was genuinely spent", async () => {
  // The difference between a choice and an ending. With maxRetries 1 the repeat lands on the last allowed
  // attempt, so no attempt was prevented — and printing `attempt + 1` there would claim one that never
  // existed. Null, never absent: an omitted key cannot be told from a row written before this field.
  process.env.MOCK_CLAUDE_NOFILE = "1";
  await stage({ maxRetries: 1 });
  const rows = preventedRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].wouldHaveBeenAttempt, null, "the ladder was spent — there was no attempt to prevent");
  assert.ok("wouldHaveBeenAttempt" in rows[0], "and the key must be PRESENT, or a spent ladder reads as a record predating the field");
});

test("#1062 a warm repeat that produced SOMETHING still escalates — #460's lane is not traded away", async () => {
  process.env.MOCK_WARM_MODE = "draft";              // writes a file every turn; the validator rejects it
  const r = await stage({ maxRetries: 2, ...INVALID_EVERY_TURN });
  assert.equal(r.attempts, 3,
    "a wrote-but-invalid repeat stopped escalating. That is the case the escalation was measured to win, "
    + "and #1062 must not cost it.");
  assert.equal(r.warmEscalated, true);
  assert.match(r.fail, /^invalid_file:/);
});
