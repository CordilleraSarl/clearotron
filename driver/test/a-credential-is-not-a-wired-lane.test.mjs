// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The owner's 502, 2026-09-02 — and the class behind it.
//
// He submitted a clearance and got a 502 on a box where EVERY health surface was green: the engine
// probe, live-surface-check, the portal's own health endpoint, and a boot log printing "trigger lane:
// ops token…" on the token's PRESENCE alone. The lane was dead because PORTAL_MCP_URL was never set.
//
// A health check that does not walk the client's own path certifies a dead product. So the arms below
// are mostly about the ways this check could be green while the lane is dead — a credential mistaken
// for a lane, a listener mistaken for a lane, a configured value mistaken for a walked hop.

import { test } from "node:test";
import assert from "node:assert/strict";
import { triggerLaneVerdict, HOSTED, SUPERVISED } from "../../shared/trigger-lane.mjs";

const ORIGIN = "http://127.0.0.1:18790";
const ANSWERS = { ok: true, status: 200 };

test("2126 a HOSTED box with no PORTAL_MCP_URL is the incident, and it is a fault", () => {
  // bin/start.mjs is the only thing in the product that ever sets this name — not the wizard, not
  // render-units.mjs, not .env.example, not any shipped unit. So a box installed the documented hosted
  // way has an unwired lane, and until now nothing said so.
  const v = triggerLaneVerdict({ posture: HOSTED });
  assert.equal(v.state, "fail");
  assert.match(v.message, /502/, "the message names the symptom the operator will actually see");
});

test("2126 a SUPERVISED box with no PORTAL_MCP_URL is NOT a fault — the value never enters a shell", () => {
  // `start` derives it and hands it to the portal child; it is not in the operator's environment even
  // on a perfectly healthy laptop. Reddening that would red every laptop and teach a reader to skim
  // the hosted case, which is the one that carries the incident.
  const v = triggerLaneVerdict({ posture: SUPERVISED });
  assert.equal(v.state, "info");
  assert.notEqual(v.state, "fail");
});

test("2126 A CREDENTIAL IS NOT A LANE — a token with no address is half-wired, and says so", () => {
  // The boot line that made the incident invisible printed on the token's presence. Asserting the same
  // thing here would reproduce the defect one surface further along.
  const noAddr = triggerLaneVerdict({ url: null, hasToken: true, posture: HOSTED });
  assert.equal(noAddr.state, "fail", "a token cannot stand in for an address");
  const noTok = triggerLaneVerdict({ url: ORIGIN, hasToken: false, posture: HOSTED, probe: ANSWERS });
  assert.equal(noTok.state, "fail", "and an address cannot stand in for a token");
  assert.match(noTok.message, /half-wired/);
});

test("2126 A CONFIGURED VALUE IS NOT A WALKED HOP — unprobed is reported as unprobed", () => {
  // Configuration is exactly what every surface that missed the incident already checked. If this ever
  // returns pass, the check has rejoined the surfaces it was written to correct.
  const v = triggerLaneVerdict({ url: ORIGIN, hasToken: true, posture: HOSTED });
  assert.equal(v.state, "unprobed");
  assert.notEqual(v.state, "pass");
  assert.match(v.message, /NOBODY WALKED THE HOP/);
});

test("2126 an origin carrying a path is refused — the client appends /mcp itself", () => {
  // The failure is a 404 at submit time and nothing wrong anywhere else, which is this issue's whole
  // shape: correct-looking configuration, dead lane, green everything.
  const v = triggerLaneVerdict({ url: `${ORIGIN}/mcp`, hasToken: true, posture: HOSTED, probe: ANSWERS });
  assert.equal(v.state, "fail", "a 200 from a doubled path is still a dead submit lane");
  assert.match(v.message, /ORIGIN/);
  assert.equal(triggerLaneVerdict({ url: ORIGIN, hasToken: true, posture: HOSTED, probe: ANSWERS }).state, "pass",
    "and the bare origin is the shape that passes, or the arm above proves nothing");
});

test("2126 a configured lane whose door does not answer is a fault naming the reason", () => {
  const v = triggerLaneVerdict({ url: ORIGIN, hasToken: true, posture: HOSTED, probe: { ok: false, error: "ECONNREFUSED" } });
  assert.equal(v.state, "fail");
  assert.match(v.message, /ECONNREFUSED/);
  assert.match(v.message, /health endpoint stays 200/, "and it names why the other surfaces disagree");
});

// ── both directions (the owner's "Stop now" unavailable, 2026-09-02) ────────────────────────────────

test("2127 a token that can start and cannot stop is a FAULT — a lane is both directions", () => {
  // He found Stop unavailable against his own running clearance. A client committed to a run they
  // cannot recall is not a working install, and the refusal arrives from upstream looking like an
  // engine fault rather than a scope decision made at mint time.
  const v = triggerLaneVerdict({ url: ORIGIN, hasToken: true, verbs: ["start_run"], posture: HOSTED, probe: ANSWERS });
  assert.equal(v.state, "fail");
  assert.match(v.message, /cannot STOP it/, "the message says what a client experiences");
  assert.match(v.message, /--verbs start_run,stop_run/, "and carries the remedy, not just the condition");
});

test("2127 an ABSENT verbs claim is full ops and must not red", () => {
  // THE INVERSION THAT WOULD MAKE THIS ARM HARMFUL. `verbs: null` means the claim is absent, and an
  // absent scope claim is the WIDEST posture, not the narrowest. Reading it as "cannot stop" would red
  // every uncapped token on every box — noise on exactly the deployments that can stop fine. Narrowness
  // is a separate concern with its own boot warning.
  const v = triggerLaneVerdict({ url: ORIGIN, hasToken: true, verbs: null, posture: HOSTED, probe: ANSWERS });
  assert.equal(v.state, "pass");
});

test("2127 both verbs present is the shape the default install mints", () => {
  // bin/start.mjs mints ["start_run", "stop_run"]. This arm is the control: it pins that the shape the
  // documented install produces is the shape this check calls healthy, so the two cannot drift into
  // disagreeing about what a good install looks like.
  const v = triggerLaneVerdict({ url: ORIGIN, hasToken: true, verbs: ["start_run", "stop_run"], posture: HOSTED, probe: ANSWERS });
  assert.equal(v.state, "pass");
});

test("2127 a missing address outranks a narrow token — the bigger fault is reported first", () => {
  // Both wrong at once is the realistic state of a hand-configured box, and reporting the verb problem
  // while the lane has no address at all would send a reader to re-mint a token that still could not
  // reach anything.
  const v = triggerLaneVerdict({ url: null, hasToken: true, verbs: ["start_run"], posture: HOSTED });
  assert.match(v.message, /PORTAL_MCP_URL/, "the address is the first thing to fix");
});
