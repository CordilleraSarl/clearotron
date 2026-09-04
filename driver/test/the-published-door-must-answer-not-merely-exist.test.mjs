// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//, acceptance 2 — "doctor reports the door's REACHABILITY, not its
// configuration ... An address set to a host nobody can reach reads as 'not set up' with the reason,
// never as green."
//
// WHY THAT INVERSION IS THE WHOLE POINT. Every surface that advertises the connector renders from the
// address being present and nothing else — portal-service gates the page on `enabled: !!url`, and the
// report's Ask-AI block reads the same value. So "it is set" is precisely what those surfaces already
// believe, and a check that concluded the same thing from the same evidence would agree with the thing
// it exists to contradict. A value typed against the wrong host lights up the page and hands a client
// an address that fails on first use, while the box reports itself configured.

import { test } from "node:test";
import assert from "node:assert/strict";
import { clientDoorReachability } from "../../shared/client-door.mjs";

test("1959 SET IS NOT REACHABLE — an unprobed address is reported as unprobed, never as green", () => {
  // The branch the criterion forbids. If this ever returns "pass", the check has become decoration.
  const v = clientDoorReachability({ url: "https://mcp.example.com/mcp" });
  assert.equal(v.state, "unprobed");
  assert.notEqual(v.state, "pass", "being configured must never satisfy a reachability question");
  assert.match(v.message, /NOBODY ASKED/, "and it says which half did not run");
});

test("1959 a configured address that does not answer is a FAULT that names the reason", () => {
  const refused = clientDoorReachability({ url: "https://mcp.example.com/mcp", probe: { ok: false, error: "ENOTFOUND" } });
  assert.equal(refused.state, "fail");
  assert.match(refused.message, /ENOTFOUND/, "the reason travels — a reader must know what to fix");

  // A SERVER THAT ANSWERS THE WRONG THING IS ALSO NOT REACHABLE. A 502 from an ingress that exists but
  // proxies nowhere is the shape a hand-provisioned tunnel fails in, and it is not a connection error.
  const bad = clientDoorReachability({ url: "https://mcp.example.com/mcp", probe: { ok: false, status: 502 } });
  assert.equal(bad.state, "fail");
  assert.match(bad.message, /502/);
});

test("1959 an UNSET address is the ordinary state of a local install, not a problem", () => {
  // The disk route needs no address at all, so most installs never publish one. Reporting that as a
  // fault would redden every laptop and train a reader to skim the arm that catches a broken deployment.
  const v = clientDoorReachability({ url: null });
  assert.equal(v.state, "unset");
  for (const empty of ["", "   "]) {
    assert.equal(clientDoorReachability({ url: empty }).state, "unset", `${JSON.stringify(empty)} is unset`);
  }
});

test("1959 a published address over plain http is refused before anything is probed", () => {
  // A key travels over this. An assistant will refuse the address anyway, so probing first would spend
  // a round trip to arrive at a worse message.
  const v = clientDoorReachability({ url: "http://mcp.example.com/mcp", probe: { ok: true, status: 200 } });
  assert.equal(v.state, "fail", "a 200 over http is still not a publishable door");
  assert.match(v.message, /https/);

  // LOOPBACK IS THE EXCEPTION AND MUST STAY ONE. The shape-2 deployment the owner was in — an editor
  // forwarding a port to a VM — is http on 127.0.0.1 by construction, and refusing it would refuse the
  // configuration this product tells people to use.
  for (const local of ["http://127.0.0.1:18821/mcp", "http://localhost:18821/mcp"]) {
    assert.equal(clientDoorReachability({ url: local, probe: { ok: true, status: 200 } }).state, "pass", local);
  }
});

test("1959 a malformed address is named as malformed rather than probed", () => {
  const v = clientDoorReachability({ url: "not a url", probe: { ok: true, status: 200 } });
  assert.equal(v.state, "fail");
  assert.match(v.message, /not a URL/);
});
