// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// queue-door-coherence.test.mjs —. One subsystem, one story:
//
//   every job's record says HOW IT ARRIVED, WHAT IT CARRIES, and THAT IT EXISTS.
//
// Each of the three is a provenance surface answering less than it appears to. A field that names the
// door and gives the same answer for two doors; a field on a real manifest that no schema names, so no
// gate can rule on it and every assembler drops it in silence; and a printout enumerating half the jobs
// it just created. All three read as complete, which is what makes them worth a test rather than a note.

import { test } from "node:test";
import assert from "node:assert/strict";
import { DECLARED_JOB_FIELDS, undeclaredJobFields, undeclaredFieldsWarning, validateJob } from "../enqueue-schema.mjs";
import { buildJob, enqueuedViaFor, PORTAL_TOKEN_SUB } from "../../mcp-server/lib/ops.mjs";
import { idFromDoorAnswer } from "../../scripts/e2e.mjs";
import { PROSE_PARTS } from "../queue-markers.mjs";

// A job that passes validateJob, so the assertions below are about the field under test and not about
// some unrelated refusal. Invented identity throughout.
const RUNNABLE = Object.freeze({
  id: "j1", msgId: "<j1@x>", forwarder: "ops", markName: "VOLTMAX", classes: [9], goods: "game software",
});

// ── — the field whose job is to say the door says the door ────────────────────────────────────

test("#1086 a portal-minted key stamps the PORTAL door, not the MCP door", () => {
  const job = buildJob({ ...RUNNABLE }, { scope: { sub: PORTAL_TOKEN_SUB } });
  assert.equal(job.enqueuedVia, "portal/start_run",
    "portal traffic recorded itself as MCP-door traffic — the two production portal-* jobs carry exactly that");
  // The attribution field keeps doing its own job. The point of is that these are TWO questions,
  // and reading them together to answer one is how the collapse survived.
  assert.equal(job.enqueuedBy, PORTAL_TOKEN_SUB);
});

test("#1086 every other verified principal still stamps the MCP door", () => {
  for (const sub of ["clawdi", "aurora-connector", "staff-key", ""]) {
    const job = buildJob({ ...RUNNABLE }, { scope: { sub } });
    assert.equal(job.enqueuedVia, "mcp/start_run", `sub ${JSON.stringify(sub)} changed the door`);
  }
  // No scope at all is still the MCP door — this function names doors, and an unauthenticated caller
  // never reaches it.
  assert.equal(buildJob({ ...RUNNABLE }, {}).enqueuedVia, "mcp/start_run");
});

test("#1086 the door is derived from the VERIFIED sub — a caller cannot name its own door", () => {
  // The trust boundary is unchanged, and that is the argument for deriving it here: `enqueuedBy` already
  // reads this same server-verified claim, at this same moment. A body that names a door is ignored,
  // exactly as portal-service.mjs's own field note says it must be ("a door that let a body name another
  // door would erase its own trail").
  const job = buildJob({ ...RUNNABLE, enqueuedVia: "portal/start_run", enqueuedBy: "portal" },
    { scope: { sub: "some-connector" } });
  assert.equal(job.enqueuedVia, "mcp/start_run", "a caller-supplied door survived into the record");
  assert.equal(job.enqueuedBy, "some-connector", "a caller-supplied attribution survived into the record");
  assert.equal(enqueuedViaFor({ sub: "some-connector" }), "mcp/start_run");
});

test("#1086 enqueuedVia stays a bounded token — pipeline.mjs clamps it and a slash-free word is not one", () => {
  // pipeline.mjs's `enqueuedVia` clamp holds this to /^[a-z0-9][a-z0-9/_.-]{0,63}$/i before it reaches
  // meta.json, and a value that fails the clamp is recorded as null — a door name that silently becomes
  // "no door". Cited by SYMBOL, not by line: the line number this comment used to carry was already
  // ~93 lines adrift of the clamp on main, and only became visible when an import above it moved that
  // number onto a brace. A symbol cannot be staled by an edit above it.
  const clamp = /^[a-z0-9][a-z0-9/_.-]{0,63}$/i;
  for (const sub of [PORTAL_TOKEN_SUB, "anything-else"]) {
    assert.match(enqueuedViaFor({ sub }), clamp, `${enqueuedViaFor({ sub })} would be nulled by the clamp`);
  }
});

// ── — what a job carries that nobody declared ─────────────────────────────────────────────────

test("#1085 an undeclared field is NAMED, where it was silently dropped before", () => {
  // THE EXAMPLE CHANGED AND THE MECHANISM DID NOT. `promptParts` was this check's specimen — the field
  // on production manifests that appeared in this repo only as a fixture nothing consumed — and it is
  // now DECLARED, because it turned out to mean something: it is the requester saying the prose rides as
  // sidecar files. Nothing read it because `assembleJob` detects the sidecars structurally, so the
  // declaration went redundant when the overlay became presence-driven, not because it was noise.
  // A specimen that graduates is what this check is FOR, so the arm keeps its shape with a field that is
  // genuinely undeclared.
  assert.deepEqual(undeclaredJobFields({ ...RUNNABLE, promptParts: true }), [],
    "promptParts is declared now — see DECLARED_JOB_FIELDS and the sidecar arms below");
  assert.deepEqual(undeclaredJobFields({ ...RUNNABLE, mysteryField: true }), ["mysteryField"]);
  const w = undeclaredFieldsWarning(["mysteryField"]);
  assert.match(w, /mysteryField/);
  assert.match(w, /#1085/, "the warning must carry the issue, or the next reader has a name and no story");
  assert.match(w, /Declare them|stop writing/i, "and both remedies, because which one is right is not decided here");
});

test("#1085 it WARNS and never refuses — the writer is live and unidentified", () => {
  const v = validateJob({ ...RUNNABLE, mysteryField: true });
  assert.equal(v.ok, true, "a hard refusal would start breaking an unknown live writer, loudly, in production");
  assert.equal(v.classify, "run");
  assert.ok(v.warnings.some((x) => /mysteryField/.test(x)), `the warning did not reach validateJob's caller: ${JSON.stringify(v.warnings)}`);
  // Refusal is the stated follow-up on once the writer census is real. If this ever flips to an
  // error, that decision wants to be visible here rather than inferred from a red suite.
});

test("#1085 every declared field passes clean, and the list is what decides", () => {
  const everything = Object.fromEntries(DECLARED_JOB_FIELDS.map((k) => [k, "x"]));
  assert.deepEqual(undeclaredJobFields(everything), [],
    "a DECLARED field was flagged — this check and DECLARED_JOB_FIELDS have drifted apart");
  // And an underscore-prefixed key is a writer's own bookkeeping, not job vocabulary. Flagging it would
  // make this noisy about the one thing it is not for.
  assert.deepEqual(undeclaredJobFields({ ...RUNNABLE, _internalNote: "x" }), []);
});

test("#1085 the check never throws on a shape that is not a job", () => {
  for (const x of [null, undefined, "a string", 42, []]) assert.deepEqual(undeclaredJobFields(x), []);
});

test("#1085 THE ROUTE THAT MATTERS: a hand-written queue file reaches the wall carrying it", () => {
  // The MCP door assembles from a named allow-list, so nothing undeclared can survive it — that door is
  // the one that genuinely strips. The routes where an undeclared field DOES survive are the CLI's
  // `--job <file>` overlay and a hand-written `<id>.json` (a documented intake route, INTAKE.md), and
  // both are read by validateJob — the CLI at its door, the runner at claim. That is where a field that
  // came in around every allow-list is named, per claim, in the runner's own log.
  const onDisk = { ...RUNNABLE, mysteryField: true, someOtherThing: 7 };
  const v = validateJob(onDisk, { atClaim: true });
  assert.equal(v.ok, true, "an already-accepted job must not become unrunnable because of this");
  const w = v.warnings.find((x) => /no door declares/.test(x));
  assert.ok(w, `nothing named the undeclared fields at claim: ${JSON.stringify(v.warnings)}`);
  assert.match(w, /"mysteryField", "someOtherThing"/, "both are named, sorted, so a census can be read off the logs");

  // And the MCP door's assembler really does drop an undeclared field — the premise the paragraph above
  // rests on. `promptParts` is dropped there TOO, and that is correct rather than incidental now that it
  // is declared: the MCP door assembles from structured input and emits no sidecars, so a job it built
  // must not claim the sidecar shape.
  assert.equal(buildJob({ ...RUNNABLE, mysteryField: true }, { scope: { sub: "x" } }).mysteryField, undefined);
  assert.equal(buildJob({ ...RUNNABLE, promptParts: true }, { scope: { sub: "x" } }).promptParts, undefined,
    "the MCP door emits no sidecars, so a job it assembles may not declare the sidecar shape");
});

// ── — the declared shape, held to ─────────────────────────────────────────────────────────────
//
// `promptParts: true` is the requester declaring "the prose rides as SIDECAR files, not inline". It
// exists because the hand-emitting email-loop agent can only `write` files, and an unescaped quote inside
// inline `brief` prose once made JSON.parse throw at intake and parked a job with nothing searched.
// Declaring the field is what lets a door ask whether the thing it declared actually arrived.

test("#1085 THE DEFECT: a manifest declaring sidecars that carries no prose says so, naming the files", () => {
  // Today this is accepted in silence and surfaces three steps later as "missing mark name(s)" — the
  // symptom, naming neither the declaration nor the files. The forwarding agent's observed failure is
  // exactly this shape: a manifest mis-named `<id>.manifest.json` leaves the bare-base sidecars unmatched.
  const v = validateJob({ id: "j1", msgId: "<j1@x>", forwarder: "ops", classes: [9], promptParts: true });
  const w = v.warnings.find((x) => /SIDECAR files and none arrived/.test(x));
  assert.ok(w, `nothing named the missing sidecars: ${JSON.stringify(v.warnings)}`);
  assert.match(w, /<base>\.markName\.md/, "the expected file names must be IN the message — a reader who has to "
    + "go and look up which sidecars exist is a reader who will not");
  assert.match(w, /BARE base/, "…and the observed cause, because a mis-named manifest is how this actually happens");

  // Where the job is unrunnable anyway, the ERROR carries the cause with it rather than leaving the
  // reader to join a symptom to a declaration three steps apart.
  const err = v.errors.find((e) => /missing mark name/.test(e));
  assert.ok(err, "the job is still refused for the reason it was always refused");
  assert.match(err, /SIDECAR files and none arrived/, "…and the refusal now says WHY the name is missing");
});

test("#1085 CONTROL: a manifest whose sidecars DID arrive is silent", () => {
  // The discriminating control. If this ever reds, the check has degraded into "warn whenever
  // promptParts is set", which fires on every correct hand-emitted job and teaches readers to skip it.
  const v = validateJob({ ...RUNNABLE, promptParts: true });
  assert.equal(v.ok, true);
  assert.equal(v.warnings.filter((x) => /SIDECAR files and none arrived/.test(x)).length, 0,
    "a job carrying its prose was warned about anyway — an alarm that fires on correct behaviour buries the real ones");
});

test("#1085 CONTROL: a job that never declared sidecars keeps its plain refusal", () => {
  // The other direction: the cause clause must not attach itself to every missing name.
  const v = validateJob({ id: "j1", msgId: "<j1@x>", forwarder: "ops", classes: [9] });
  const err = v.errors.find((e) => /missing mark name/.test(e));
  assert.equal(err, "missing mark name(s)", "an ordinary missing name must not be explained by a declaration nobody made");
  assert.equal(v.warnings.filter((x) => /SIDECAR/.test(x)).length, 0);
});

test("#1085 the sidecar list comes from PROSE_PARTS, never a copy", () => {
  // Two lists that must agree, and the message is where they would drift: a tenth prose field added to
  // PROSE_PARTS must appear in this warning the day it lands, not the day someone remembers to retype it.
  const v = validateJob({ id: "j1", msgId: "<j1@x>", forwarder: "ops", classes: [9], promptParts: true });
  const w = v.warnings.find((x) => /SIDECAR files and none arrived/.test(x));
  assert.ok(w, 'the warning is gone entirely — this arm cannot compare two lists when one of them is absent, and '
    + 'a TypeError here would read as a broken test rather than a missing guard');
  for (const suffix of Object.values(PROSE_PARTS))
    assert.ok(w.includes(`<base>${suffix}`), `the warning omits ${suffix} — it is holding its own copy of the sidecar list`);
});

// ── — the harness prints every job it enqueues ─────────────────────────────────────────────────

test("#1088 the enqueued job id is read from the door's own answer", () => {
  // Both doors answer with JSON carrying `id`. The CLI adds `queued`/`queuePath`; start_run adds a note.
  assert.equal(idFromDoorAnswer('{"ok":true,"id":"e2e-r0a-cli","queued":true,"queuePath":"/q/e2e-r0a-cli.json"}'), "e2e-r0a-cli");
  assert.equal(idFromDoorAnswer('  {"ok":true,"id":"j-2"}  \n'), "j-2", "the CLI's stdout carries whitespace");
});

test("#1088 an unreadable answer yields null — never an invented id", () => {
  // A harness that guessed would send a watcher to a queue file that does not exist, which is worse than
  // admitting it does not know. The caller prints the admission rather than skipping the line.
  for (const bad of ["", "not json", "{}", '{"ok":true}', '{"ok":true,"id":""}', '{"ok":true,"id":7}', null, undefined]) {
    assert.equal(idFromDoorAnswer(bad), null, `${JSON.stringify(bad)} produced an id`);
  }
});
