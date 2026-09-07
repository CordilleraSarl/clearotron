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

test("the shared verdict calls the outage's own door shape a PASS", () => {
  // The measurement the wiring is built around, pinned so it cannot drift underneath it. If this ever
  // stops being a pass, the portal's extra branch is dead weight and should go — and somebody should
  // find out from this arm rather than from a boot line that quietly stopped appearing.
  const bearer = verdictFor({ status: 401, ok: true, challenge: 'Bearer realm="OAuth"', error: null });
  assert.equal(bearer.state, "pass",
    "the shared verdict no longer calls a Bearer-challenged door a pass, so the portal's own branch for "
    + "that case is describing a state that cannot happen");

  // And the two it gets unambiguously right, which is why it is still the authority for those.
  assert.equal(verdictFor({ status: 302, ok: true, challenge: "Cloudflare-Access", error: null }).state, "fail");
  // A REFUSED CONNECTION MOVED TO `unsettled` (tracker issue 222) — see the arms at the foot of this
  // file. It is not a `fail` because at boot it is far more often a startup race than an outage, and
  // the old branch stated the outage in the present tense with a 502 attached.
  assert.equal(verdictFor({ status: null, ok: false, challenge: null, error: "ECONNREFUSED" }).state, "unsettled");
  // A door that ANSWERED something wrong is still a fail — waiting does not fix a 500.
  assert.equal(verdictFor({ status: 500, ok: false, challenge: null, error: null }).state, "fail");
  assert.equal(verdictFor(null).state, "unprobed", "no probe was read as a verdict");
  assert.equal(verdictFor({ status: 401, ok: true, challenge: null, error: null }).state, "pass");
});

test("asking about the door is not answered with a fact about the token", () => {
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

test("the portal asks the door at boot, through the one authority", () => {
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

test("a boot diagnostic never stops the portal coming up", () => {
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

// ── 222 · A STARTUP RACE IS NOT AN OUTAGE ───────────────────────────────────────────────────────────
//
// On a simultaneous restart of the unit set the portal binds before the engine door — the units carried
// no ordering between them — and the boot probe logged an outage in the present indicative with a
// client-facing consequence: "a clearance ordered from the portal returns 502 while the portal's own
// health endpoint stays 200."
//
// That sentence is false twice. It is false seconds later, once the door finishes binding. And it is
// false as a prediction at any time: the submit path makes a fresh upstream call per request inside its
// own try/catch and never consults this verdict, so nothing about a boot-time refusal determines what a
// clearance does. It printed on every reboot and cost a diagnostic detour during the 0.1.6 upgrade.

test("222 nothing listening yet does not claim a clearance returns 502", () => {
  const v = verdictFor({ status: null, ok: false, challenge: null, error: "ECONNREFUSED" });
  assert.equal(v.state, "unsettled");
  assert.doesNotMatch(v.message, /502/,
    "the boot probe still predicts a 502 from a connection nothing answered — the submit path re-probes "
    + "per request and never reads this verdict, so it cannot know that");
  assert.doesNotMatch(v.message, /DOES NOT ANSWER/,
    "the message still states an outage in the present indicative about a box that is probably starting");
  assert.match(v.message, /BOOT-TIME OBSERVATION, NOT A VERDICT/,
    "the message does not say what kind of claim it is, which is the whole finding");
  // AND IT STILL SAYS WHAT TO DO IF IT PERSISTS. Softening a message into saying nothing would trade
  // one useless line for another.
  assert.match(v.message, /still true after the box has settled/,
    "a reader whose door is genuinely down is left with no next step");
});

test("222 a door that ANSWERED wrongly keeps the full warning — the fix is not a mute", () => {
  // The same branch emits the real thing, and that is exactly why the split has to be on evidence
  // rather than on tone. A 500 is a fault no amount of waiting repairs.
  for (const probe of [{ status: 500, ok: false, challenge: null, error: null },
                       { status: 404, ok: false, challenge: null, error: null }]) {
    const v = verdictFor(probe);
    assert.equal(v.state, "fail", `a door answering ${probe.status} stopped being reported as a failure`);
    assert.match(v.message, /DOES NOT ANSWER/);
  }
});

test("222 only `fail` is logged as a WARNING, so the word still means something", () => {
  const src = readFileSync(join(REPO, "driver", "portal-service.mjs"), "utf8");
  assert.match(src, /if \(lane\.state === "fail"\) log\(`WARNING: trigger lane/,
    "a real lane failure no longer announces itself as a warning");
  assert.match(src, /lane\.state === "unsettled" \|\| lane\.state === "unprobed"/,
    "the unsettled state is not handled at the log site, so it falls through to the branch that reports "
    + "a door which answered — and prints a status of `?` for a probe that got nothing");
});

test("222 the portal unit is ordered after the engine door it calls", () => {
  const unit = readFileSync(join(REPO, "driver", "systemd", "clearotron-portal.service"), "utf8");
  assert.match(unit, /^After=clearotron-mcp-face\.service$/m,
    "the portal carries no ordering against the engine door, so a simultaneous restart races them");
  // `Wants=` WOULD BE A DIFFERENT CHANGE. A portal serving with no engine door is a supported state —
  // the pages work, only the Start button's upstream is missing — so pulling the door in as a
  // dependency would change what installing this unit means.
  assert.doesNotMatch(unit, /^Wants=clearotron-mcp-face\.service$/m,
    "the ordering became a dependency, which changes what installing the portal unit does");
});
