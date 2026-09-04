// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// e2e-run-token.test.mjs — the round token that makes a TEST scenario's matter signature unique per run.
//
//: matter dedup holds a 24-hour window on the matter signature, and a fixed scenario submitted a
// byte-identical signature every round — same mark, same classes, same ref, same level, that being what a
// fixed scenario IS. So the second round of any calendar day was refused at every door before any model
// call, and on 2026-08-04 R0, R3 and R4 all came back `.duplicate`. The dedup rule is CORRECT — a real
// client resubmitting the same matter inside a day must not be searched and billed twice — so the harness
// makes each ROUND a distinct matter instead of asking dedup to look the other way.
//
// This file is the pair of arithmetic facts that decision rests on, and they pull in OPPOSITE directions:
//
//   (1) ACROSS invocations the signature must CHANGE, or the day's second round is refused (the defect).
//   (2) WITHIN one invocation it must NOT, or R0d — whose whole subject is that the same matter submitted
//       twice runs once — stops being able to produce the duplicate it exists to detect. A token minted
//       per SUBMISSION satisfies (1) and silently deletes (2): the case would go green while testing
//       nothing, which is this suite's own named failure mode.
//
// It composes the refs the way `cmdRun` composes them (refForRun, then refForDoor) and reads them with the
// driver's own `matterSignature` / `findDuplicateMatter` / `recordMatter` — the real admission arithmetic,
// not a restatement of it. The production side of that boundary is pinned in runner.dedup.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

// Env BEFORE the dynamic runner import — driver.config captures the workspace root at module load, and a
// hermetic fixture root is what keeps this suite off any real pool.
const root = mkdtempSync(join(tmpdir(), "e2e-run-token-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", root);
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(root, "pool"));

const { matterSignature, findDuplicateMatter, recordMatter } = await import("../runner.mjs");
const { refForRun, newRunToken, refForDoor, queueOutcomes, dedupeAcrossDoors } = await import("../../scripts/e2e.mjs");

// The two doors `cmdRun` actually drives (DOORS entries with real:true).
const DOORS = ["cli", "ops-mcp"];

// Verbatim from the store's R0.json (the config repo — the only suite) — the two cases whose expectations pull opposite ways. R0d shares ONE
// ref across doors (oneMatterAcrossDoors) and expects `duplicate`; R0e keeps the door suffix and expects
// `delivered` at BOTH doors.
const R0D = { ref: "E2E-R0d", markName: "E2E DUPLICATE PROBE", classes: [9], profileKey: "aurora", product: "knockout-search", forwarder: "e2e" };
const R0E = { ref: "E2E-R0e", markName: "E2E FALLBACK PROBE", classes: [9], product: "knockout-search", forwarder: "e2e" };

// Exactly what cmdRun puts on the wire: the round token on the BASE ref, then the door suffix.
const submittedRef = (job, token, door, oneMatterAcrossDoors) =>
  refForDoor(refForRun(job.ref, token), door, { doors: DOORS, oneMatterAcrossDoors });
// claimAndPrep signs the job with the RESOLVED level; every scenario here states its own.
const sigOf = (job, ref) => matterSignature({ ...job, ref }, { product: job.product });
const freshQueue = (name) => {
  const q = join(mkdtempSync(join(tmpdir(), `${name}-`)), "queue");
  mkdirSync(q, { recursive: true });
  return q;
};
const NOW = 1_700_000_000_000;

test("across invocations: the day's second round is a NEW matter and admits", () => {
  const q = freshQueue("round");

  // The defect first, so the assertion below cannot pass against an empty ledger. With a constant ref the
  // second round is byte-identical and refused — this is the .duplicate that stopped the 2026-08-04 round.
  const constant = sigOf(R0D, refForDoor(R0D.ref, "cli", { doors: DOORS, oneMatterAcrossDoors: true }));
  recordMatter(q, { sig: constant, msgId: "<untokened-round-one@e2e>", ts: NOW });
  assert.ok(findDuplicateMatter(q, { sig: constant, msgId: "<untokened-round-two@e2e>" }, NOW + 60_000),
    "a scenario with a constant ref makes the day's second round a duplicate — the defect #388 reports");

  const t1 = newRunToken();
  const t2 = newRunToken();
  const one = sigOf(R0D, submittedRef(R0D, t1, "cli", true));
  const two = sigOf(R0D, submittedRef(R0D, t2, "cli", true));
  assert.notEqual(t1, t2, "two invocations mint two tokens");
  assert.notEqual(one, two, "…so they submit two different matters");

  // THE TOKEN MOVES THE REF AND NOTHING ELSE. forwarder|mark|classes|customer are the fields that decide
  // what is searched, who is billed and which profile rates it; if the token reached any of them, the
  // round would no longer be the same test.
  assert.deepEqual(one.split("|").slice(0, 4), two.split("|").slice(0, 4),
    "forwarder, mark, classes and customer are identical between rounds — only the ref moved");
  assert.equal(one.split("|")[5], two.split("|")[5], "the level dimension is untouched too");

  recordMatter(q, { sig: one, msgId: "<round-one@e2e>", ts: NOW });
  assert.ok(findDuplicateMatter(q, { sig: one, msgId: "<round-one-resent@e2e>" }, NOW + 60_000),
    "round one's ledger row is really there and really inside the window — so round two admitting is the token, not an empty ledger");
  assert.equal(findDuplicateMatter(q, { sig: two, msgId: "<round-two@e2e>" }, NOW + 60_000), null,
    "the SECOND round of the same day admits");
});

test("within one invocation: R0d's two doors still collide, and the second is refused as a duplicate", () => {
  const q = freshQueue("r0d");
  const token = newRunToken();

  const refs = DOORS.map((d) => submittedRef(R0D, token, d, true));
  assert.deepEqual(refs, [`E2E-R0d-${token}`, `E2E-R0d-${token}`],
    "the token rides the BASE ref, UNDER the door suffix, so oneMatterAcrossDoors still hands both doors one ref");
  const [cli, opsmcp] = refs.map((ref) => sigOf(R0D, ref));
  assert.equal(cli, opsmcp, "one ref ⇒ one matter ⇒ the duplicate this case exists to detect can occur");

  // Each door is its own message on its own thread (enqueue.mjs and start_run both default conversationId
  // to the per-submission id), so the match below is the SIGNATURE dimension — the one the token moves.
  recordMatter(q, { sig: cli, conversationId: "cli-submission", msgId: "<door-cli@e2e>", ts: NOW });
  const prior = findDuplicateMatter(q, { sig: opsmcp, conversationId: "opsmcp-submission", msgId: "<door-opsmcp@e2e>" }, NOW + 1_000);
  assert.ok(prior, "the second door is refused as a duplicate of the first");
  assert.equal(prior.msgId, "<door-cli@e2e>", "…matched against the door that admitted, by matter signature");
});

test("within one invocation: R0e's doors stay SEPARATE matters and both admit", () => {
  const q = freshQueue("r0e");
  const token = newRunToken();

  const refs = DOORS.map((d) => submittedRef(R0E, token, d, false));
  assert.deepEqual(refs, [`E2E-R0e-${token}-cli`, `E2E-R0e-${token}-opsmcp`],
    "a case without the opt-out keeps its door suffix once the token is in front of it");
  const [cli, opsmcp] = refs.map((ref) => sigOf(R0E, ref));
  assert.notEqual(cli, opsmcp);

  recordMatter(q, { sig: cli, conversationId: "cli-submission", msgId: "<r0e-cli@e2e>", ts: NOW });
  assert.equal(findDuplicateMatter(q, { sig: opsmcp, conversationId: "opsmcp-submission", msgId: "<r0e-opsmcp@e2e>" }, NOW + 1_000), null,
    "R0e expects `delivered` at BOTH doors — a shared ref would park its second and break the doors-agree comparison");
});

test("the token lands BEFORE the |level: suffix, which is where sigLevel's end-anchor needs it", () => {
  // runner.mjs: `sigLevel(sig) { return String(sig).match(/\|level:([^|]*)$/)?.[1] || "prelim"; }` — anchored
  // at the END, and BOTH dedup dimensions read it. Anything appended AFTER the level suffix would make
  // every non-prelim signature read back as "prelim" with nothing thrown and nothing logged: R2 (prelim)
  // would look fine while R1 (prelim-jx) and the knockout scenarios all mis-read. The token rides the REF,
  // the field before the suffix, so the suffix stays last. Pinned as a literal AND behaviourally, because
  // a regex assertion alone cannot show that the dimension still works.
  const token = newRunToken();
  const ref = submittedRef(R0D, token, "cli", true);
  const sig = sigOf(R0D, ref);
  assert.equal(sig, `e2e|e2e duplicate probe|9||e2e-r0d-${token}|level:knockout-search`,
    "the token is inside the ref field, and |level: is still the tail");
  assert.match(sig, /\|level:knockout-search$/, "sigLevel's own pattern, asserted where it would silently stop matching");

  // The THREAD dimension is level-aware, and can only be level-aware if sigLevel parses. Same thread, same
  // mark, DIFFERENT level is the headline escalation (a knockout coming back HIGH), and it must never park
  // as a duplicate. Had the token broken the anchor, both sides would read "prelim", the levels would
  // "agree", and the escalation would be refused in silence.
  const q = freshQueue("siglevel");
  recordMatter(q, { sig, conversationId: "CONV-ESCALATE", msgId: "<knockout@e2e>", ts: NOW });
  const escalated = matterSignature({ ...R0D, ref }, { product: "multi-country-focus-search" });
  assert.equal(findDuplicateMatter(q, { sig: escalated, conversationId: "CONV-ESCALATE", msgId: "<escalation@e2e>" }, NOW + 1_000), null,
    "a level CHANGE in one thread is an escalation, not a duplicate — this passes only while sigLevel still parses a tokenized signature");
  assert.ok(findDuplicateMatter(q, { sig, conversationId: "CONV-ESCALATE", msgId: "<same-level-reply@e2e>" }, NOW + 1_000),
    "…and the same level in the same thread still parks, so the assertion above is not vacuous");
});

test("two rounds in one queue directory: a tokenized prefix reads ONE of them, the bare ref reads both", () => {
  // The token makes it possible to re-run a scenario the same day WITHOUT tearing down the round before
  // it — which is the point, since teardown purges the run directories that are the round's evidence. So
  // two rounds now coexist in one queue, and `report` must read the round it is reporting on. Unscoped,
  // R0d's set-level dedupe arithmetic counts both rounds' admissions and flags "2 doors ADMITTED the same
  // matter": an engine defect that never happened, in the one report that has to be trustworthy.
  const q = freshQueue("scope");
  const [tA, tB] = [newRunToken(), newRunToken()];
  for (const [round, token] of [["a", tA], ["b", tB]]) {
    writeFileSync(join(q, `cli-${round}.done`), JSON.stringify({ id: `cli-${round}`, ref: refForRun(R0D.ref, token) }));
    writeFileSync(join(q, `opsmcp-${round}.duplicate`), JSON.stringify({ id: `opsmcp-${round}`, ref: refForRun(R0D.ref, token) }));
  }

  const everyRound = queueOutcomes(R0D.ref, q);
  assert.equal(everyRound.length, 4, "the bare scenario ref matches BOTH rounds — which is why teardown uses it and report does not");
  assert.equal(dedupeAcrossDoors(everyRound.map((r) => r.terminal)).ranMoreThanOnce, true,
    "unscoped, two rounds read as one matter admitted twice — the false flag the scoping exists to stop");

  const roundB = queueOutcomes(refForRun(R0D.ref, tB), q);
  assert.deepEqual(roundB.map((r) => r.base).sort(), ["cli-b", "opsmcp-b"], "the tokenized prefix reads exactly one round");
  // widened the return with `undetermined` and `inFlight`: admissions are now counted by a
  // whitelist, so a door still `.processing` and a terminal that could not be read are each counted as
  // themselves rather than falling into "admitted" by exclusion.
  assert.deepEqual(dedupeAcrossDoors(roundB.map((r) => r.terminal)),
    { parked: 1, admitted: 1, undetermined: 0, inFlight: 0, ranMoreThanOnce: false, neverFired: false },
    "and inside that round the dedupe set property is what R0d orders: one admission, one park");
});

test("the token is random, never the clock", () => {
  // Two scenarios starting in the same second is normal on a fast round, so a clock-derived token would
  // collide intermittently — which reintroduces unpredictably instead of reliably, and is worse.
  // 1000 tokens minted inside a tight loop is the test a second- or millisecond-resolution clock fails.
  const started = Date.now();
  const seen = new Set();
  for (let i = 0; i < 1000; i++) seen.add(newRunToken());
  assert.equal(seen.size, 1000,
    `1000 back-to-back tokens are all distinct (the loop spanned ${Date.now() - started}ms — a clock-derived token collides here)`);
  for (const t of seen) assert.match(t, /^[0-9a-f]{8}$/, "four CSPRNG bytes, hex");
});

test("the harness composes the signature the live refusal recorded — the ref is the only field the token moves", () => {
  // Quoted verbatim from the.duplicate.reason: the ops-MCP door's R0e submission, refused on
  // 2026-08-04. A door-suffixed ref reaching matterSignature is therefore evidenced, not assumed.
  const observed = "e2e|e2e fallback probe|9||e2e-r0e-opsmcp|level:knockout-search";
  assert.equal(sigOf(R0E, "E2E-R0e-opsmcp"), observed,
    "the signature the harness's own submission produces, byte for byte as the live refusal wrote it");

  const token = newRunToken();
  const withToken = sigOf(R0E, submittedRef(R0E, token, "ops-mcp", false));
  assert.equal(withToken, `e2e|e2e fallback probe|9||e2e-r0e-${token}-opsmcp|level:knockout-search`,
    "the same submission one round later differs in the ref, and only in the ref");
  assert.notEqual(withToken, observed, "…which is exactly why it is no longer refused");
});
