// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The portal asks whether its engine door will take it — tracker issue 174, the half that is buildable now.
//
// ── the outage this is made of ──────────────────────────────────────────────────────────────────────
//
// The engine interface was switched to `cf-access` at 09:59:35Z so a desktop assistant could reach it.
// The portal's last successful `start_run` was 09:10:54Z the same morning. Every Start after that was a
// 401 upstream and a 502 to the client, and NOTHING ANYWHERE SAID SO: the portal logged `trigger lane:
// ops token sub=portal … expires=…` and the interface logged `auth ON — issuer=CF Access`. Both
// sentences were true. Neither was the one the operator needed. The owner found it by submitting a
// clearance.
//
// 174 names this as worth building even if its main design is deferred, and it is: the portal already
// holds both halves and never asked whether the door it is pointed at will accept a caller shaped like
// this one.
//
// ── THE INVERSION, WHICH IS WHY THIS ARM EXISTS AT ALL ──────────────────────────────────────────────
//
// `triggerLaneVerdict` is the one authority for this pair and is shared with `doctor` — but its `pass`
// answers the ASSISTANT'S question, "can a connector follow this challenge". Measured here rather than
// assumed: a `401` carrying `Bearer realm="OAuth"` comes back `pass`, and that is the exact shape the
// outage was made of, because the portal presents an ACCESS KEY and not a proxy identity.
//
// So reusing the verdict wholesale would have printed a confident tick on the incident. The two
// unambiguous states pass straight through; the ambiguous one is reported with its mechanism and NOT
// judged. Same shape as the 302 that is correct in front of a browser surface and a fault in front of
// an MCP route — one answer, two callers, opposite meanings.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { triggerLaneVerdict, HOSTED } from "../../shared/trigger-lane.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORTAL = join(REPO, "driver", "portal-service.mjs");
/** The boot block, bounded by its own heading and the token block that follows it. */
function bootBlock(src) {
  const from = src.indexOf("AND WHETHER THE DOOR WILL TAKE IT");
  assert.ok(from > 0, "the portal's engine-door boot check is gone");
  const to = src.indexOf("\n  if (OPS_TOKEN) {", from);
  assert.ok(to > from, "the boot block's end marker moved, so this arm is reading the wrong text");
  return src.slice(from, to);
}

const verdictFor = (probe, verbs = null) =>
  triggerLaneVerdict({ url: "http://127.0.0.1:18790", hasToken: true, verbs, posture: HOSTED, probe, invoke: "npx " });

test("tracker issue 174 — the shared verdict calls the outage's own door shape a PASS", () => {
  // The measurement the wiring is built around, pinned so it cannot drift underneath it. If this ever
  // stops being a pass, the portal's extra branch is dead weight and should go — and somebody should
  // find out from this arm rather than from a boot line that quietly stopped appearing.
  const bearer = verdictFor({ status: 401, ok: true, challenge: 'Bearer realm="OAuth"', error: null });
  assert.equal(bearer.state, "pass",
    "the shared verdict no longer calls a Bearer-challenged door a pass, so the portal's own branch for "
    + "that case is describing a state that cannot happen");

  // And the two it gets unambiguously right, which is why it is still the authority for those.
  assert.equal(verdictFor({ status: 302, ok: true, challenge: "Cloudflare-Access", error: null }).state, "fail");
  assert.equal(verdictFor({ status: null, ok: false, challenge: null, error: "ECONNREFUSED" }).state, "fail");
  assert.equal(verdictFor(null).state, "unprobed", "no probe was read as a verdict");
  assert.equal(verdictFor({ status: 401, ok: true, challenge: null, error: null }).state, "pass");
});

test("tracker issue 174 — asking about the door is not answered with a fact about the token", () => {
  // `verbs` short-circuits ahead of the probe, so passing it in answers a different question from the
  // one asked — and the boot block one screen below already reports the verbs, with the re-mint
  // command. Driven, because the short-circuit is invisible in the call.
  const doorIsBroken = { status: 302, ok: true, challenge: "Cloudflare-Access", error: null };
  const withVerbs = verdictFor(doorIsBroken, ["start_run"]);
  assert.match(withVerbs.message, /stop_run/,
    "the short-circuit is gone, which is good — but the portal's call passes null on the strength of it");
  const withoutVerbs = verdictFor(doorIsBroken, null);
  assert.match(withoutVerbs.message, /browser challenge/,
    "with verbs left out, the answer is still not about the door");
});

test("tracker issue 174 — the portal asks the door at boot, through the one authority", () => {
  const src = readFileSync(PORTAL, "utf8");
  assert.match(src, /triggerLaneVerdict/,
    "the portal starts without ever asking whether its engine door will accept it — which is the state "
    + "the outage happened in, and every line it printed was true");
  // ONE AUTHORITY. A challenge comparison written here would be a second reader of the same facts, and
  // the two would drift — which is how `doctor` and the portal would come to disagree about one door.
  const boot = bootBlock(src);
  const own = boot.match(/Cloudflare-Access|challengeVerdict|challengeSchemes/g) ?? [];
  assert.deepEqual(own, [],
    `the portal judges the challenge itself rather than asking the shared reader: ${own.join(", ")}`);
  assert.match(boot, /bearer/i,
    "the ambiguous case is not distinguished, so a door fronted by an identity proxy is reported as a "
    + "working lane — a confident tick on the exact configuration the incident was made of");
});

test("tracker issue 174 — a boot diagnostic never stops the portal coming up", () => {
  // A probe that can take the service down has made the product worse to tell it something. The catch
  // is what makes that true, and it says so rather than swallowing quietly.
  const src = readFileSync(PORTAL, "utf8");
  const block = bootBlock(src);
  assert.match(block, /catch \(e\)/, "the boot probe has no catch, so a diagnostic can refuse the portal");
  assert.match(block, /not a verdict either way/,
    "a probe that could not run reports nothing at all, which reads as a lane that was checked and passed");
  assert.match(block, /AbortSignal\.timeout/,
    "the boot probe has no timeout, so an unreachable door delays every start by however long the OS waits");
});
