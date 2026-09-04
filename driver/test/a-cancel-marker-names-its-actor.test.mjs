// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — A CANCELLED CLIENT RUN THAT CANNOT SAY WHO STOPPED IT.
//
// `requestCancel` recorded `by: null` whenever a caller passed nothing, and the MCP stop path passed
// nothing. `via` records only the CHANNEL — "mcp/stop_run" is true of every UI stop ever made — so the
// run dir, which is the durable record and travels into the archived matter record, could answer how a
// run was stopped and not who stopped it.
//
// THE ARM THAT MATTERS IS THE ONE ABOUT THE TWO SENTINELS. The issue's own reasoning is that `null`
// "cannot distinguish 'nobody was identified' from 'the field was not passed', and those want different
// answers". A single replacement value would rebuild that collapse one word further along: the session
// question (nobody could be named) and the caller bug (nothing was passed) must stay separable, or the
// fix reproduces the defect it removes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readFileSync as readSrc } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { requestCancel, readCancel, isCancelled, UNATTRIBUTED, CANCEL_MARKER } from "../cancel.mjs";
import { attributionOf, UNIDENTIFIED } from "../../shared/scope.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const runDir = () => mkdtempSync(join(tmpdir(), "cancel-actor-"));

// ── the marker can no longer say nothing ──────────────────────────────────────────────────────────

test("a caller that passes no actor writes UNATTRIBUTED — never null", () => {
  const d = runDir();
  const rec = requestCancel(d, { via: "test" });
  assert.equal(rec.by, UNATTRIBUTED);
  assert.notEqual(rec.by, null, "the defect: a null actor reads as 'nobody was there'");
  const onDisk = JSON.parse(readFileSync(join(d, CANCEL_MARKER), "utf8"));
  assert.equal(onDisk.by, UNATTRIBUTED, "and it is the FILE that travels into the matter record");
});

test("a named actor is recorded verbatim", () => {
  const d = runDir();
  const rec = requestCancel(d, { via: "mcp/stop_run", by: "someone@example.test" });
  assert.equal(rec.by, "someone@example.test");
});

test("a blank or non-string actor is UNATTRIBUTED, not an empty string", () => {
  // An empty string is falsy in every reader that checks it, so it is null wearing a different type.
  for (const by of ["", "   ", null, undefined, 42, {}]) {
    const rec = requestCancel(runDir(), { via: "test", by });
    assert.equal(rec.by, UNATTRIBUTED, `by: ${JSON.stringify(by)}`);
  }
});

test("surrounding whitespace is trimmed rather than stored", () => {
  assert.equal(requestCancel(runDir(), { via: "test", by: "  ops:local  " }).by, "ops:local");
});

// ── the two sentinels stay separable ──────────────────────────────────────────────────────────────

test("THE POINT: 'nobody was identified' and 'nothing was passed' are DIFFERENT words", () => {
  const nothingPassed = requestCancel(runDir(), { via: "test" }).by;
  const nobodyNamed = attributionOf({ kind: "account", sub: null });
  const noSessionAtAll = attributionOf(undefined);

  assert.equal(nothingPassed, UNATTRIBUTED);
  assert.match(nobodyNamed, /^unidentified/);
  assert.notEqual(nothingPassed, nobodyNamed,
    "collapsing these re-creates the ambiguity #1378 exists to remove, one word further along");
  assert.equal(new Set([nothingPassed, nobodyNamed, noSessionAtAll]).size, 3,
    "a caller bug, an unnamed session, and no session are three different investigations");
});

test("attributionOf keeps the KIND when it cannot name the person", () => {
  assert.equal(attributionOf({ kind: "ops", sub: null }), `${UNIDENTIFIED}:ops`);
  assert.equal(attributionOf({ kind: "account", sub: "  " }), `${UNIDENTIFIED}:account`);
  assert.equal(attributionOf({}), UNIDENTIFIED, "no kind either — say that, do not invent one");
});

test("attributionOf prefers the verified sub, exactly as stampForwarder reads it", () => {
  assert.equal(attributionOf({ kind: "internal", sub: "staff@example.test" }), "staff@example.test");
  assert.equal(attributionOf({ kind: "ops", sub: "local" }), "local");
  assert.equal(attributionOf({ kind: "user", sub: "  padded@example.test  " }), "padded@example.test");
});

// ── the properties the marker already had, which this must not cost ───────────────────────────────

test("idempotence survives: the FIRST request's actor is the one that counts", () => {
  const d = runDir();
  const first = requestCancel(d, { via: "mcp/stop_run", by: "first@example.test" });
  const second = requestCancel(d, { via: "eggface-e2e", by: "second@example.test" });
  assert.equal(second.by, "first@example.test", "a second stop must not rewrite who stopped it");
  assert.equal(second.ts, first.ts);
  assert.equal(isCancelled(d), true);
});

test("the marker still carries ts and via, and is still readable back", () => {
  const d = runDir();
  requestCancel(d, { via: "mcp/stop_run", by: "someone@example.test" });
  const back = readCancel(d);
  assert.ok(back.ts && !Number.isNaN(Date.parse(back.ts)));
  assert.equal(back.via, "mcp/stop_run");
  assert.equal(back.by, "someone@example.test");
  assert.ok(existsSync(join(d, CANCEL_MARKER)));
});

// ──, THE NAMING HALF: the portal knows the human and the engine cannot see them ───────────────
//
// made `by: null` impossible. It could not make `by` a PERSON, because every UI stop reaches the
// engine on one shared ops token whose `sub` is "portal" — so the strongest thing the MCP could prove
// was the machine, and `portal` is as true of every UI stop ever made as `mcp/stop_run` was.
//
// The portal does hold a verified human: every audit line on that path already writes principal.email.
// It simply never forwarded it.

test("#1378 a delegated identity is recorded BESIDE the verified one, never instead of it", () => {
  assert.equal(attributionOf({ kind: "ops", sub: "portal" }, "alice@example.test"), "portal:alice@example.test");
  // THE POINT. An asserted name returned alone would be indistinguishable from a proved one, in a file
  // that travels into an archived matter record — and any holder of that ops token could then write any
  // name into a client's record. The compound answers both questions: who vouched, and for whom.
  assert.notEqual(attributionOf({ kind: "ops", sub: "portal" }, "alice@example.test"), "alice@example.test",
    "the delegate stands alone — an asserted identity is now indistinguishable from a verified one");
});

test("#1378 a delegate that is not a bare identifier is DROPPED, and the verified half stands alone", () => {
  // Counts and identifiers, not prose — the issue's own scope note, and this file is a matter record.
  // A colon would forge the compound form; whitespace or a newline would spill a sentence into the
  // archive. Refusing is the safe direction: the record loses a name it could not trust, not its shape.
  for (const bad of ["ops:someone@x", "alice smith", "a\nb", "x".repeat(129), "", "   ", null, undefined, 42, {}])
    assert.equal(attributionOf({ kind: "ops", sub: "portal" }, bad), "portal", `delegate: ${JSON.stringify(bad)}`);
});

test("#1378 with no delegate, every existing caller gets exactly what it got before", () => {
  assert.equal(attributionOf({ kind: "ops", sub: "portal" }), "portal");
  assert.equal(attributionOf({ kind: "ops", sub: null }), `${UNIDENTIFIED}:ops`);
  assert.equal(attributionOf(undefined), UNIDENTIFIED);
});

test("#1378 an unidentified session that names a human still says the session could not be named", () => {
  // Both sentinels survive the compound. 's whole point was that "nobody was identified" and
  // "nothing was passed" are different words; adding a delegate must not quietly answer the first.
  assert.equal(attributionOf({ kind: "ops", sub: null }, "alice@example.test"),
    `${UNIDENTIFIED}:ops:alice@example.test`);
});

test("#1378 WIRING — the engine reads the delegate and the portal actually sends it", () => {
  // A forwarded field that nobody forwards is the silent half of this defect class, and it is exactly
  // how survived: `requestCancel` took `by` all along and the caller passed nothing.
  const ops = readSrc(join(ROOT, "mcp-server", "lib", "ops.mjs"), "utf8");
  assert.match(ops, /attributionOf\(scope, args\.onBehalfOf\)/,
    "stop_run stopped reading the delegate — every UI stop goes back to naming the machine");

  const portal = readSrc(join(ROOT, "driver", "portal-service.mjs"), "utf8");
  // added `immediate` to this call, so the literal moved. The PROPERTY is what
  // this arm is for and it is unchanged: whatever else the stop lane forwards, it forwards the human the
  // portal verified — the engine sees one shared ops token, so this argument is the only thing that can
  // put a person in the run dir. Matched as "the runId call carries onBehalfOf" rather than as an exact
  // argument list, so the next field added here does not read as the delegate going missing.
  assert.match(portal, /stopRun\(\{ runId,[^}]*onBehalfOf: principal\.email \}\)/,
    "the portal's STOP lane stopped forwarding the human it verified");
  assert.match(portal, /stopRun\(\{ id, onBehalfOf: principal\.email \}\)/,
    "the portal's queue-CANCEL lane stopped forwarding the human it verified");

  const schema = readSrc(join(ROOT, "mcp-server", "server.mjs"), "utf8");
  assert.match(schema, /onBehalfOf: \{ type: "string"/,
    "the argument left the tool schema — an undocumented arg is folklore, and the next caller will not pass it");
});
