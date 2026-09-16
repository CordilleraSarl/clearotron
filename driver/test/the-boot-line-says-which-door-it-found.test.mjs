// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE BOOT LINE MUST DISTINGUISH THE TWO DOORS, because it was printed to prevent an outage and was
// byte-identical in the configuration that works and the one that cannot carry a Start. The portal probes
// the engine door unauthenticated and decided what it was talking to from `www-authenticate`. An identity
// proxy never sends one: an unauthenticated GET on a proxy-fronted door answers 401 with no challenge at
// all, so the branch never ran and the probe fell through to a confident line about an access key the door
// would refuse.
//
// THE PAIR IS THE CRITERION, NOT EITHER HALF. A test pinning only the proxy case would pass against a
// verdict that called every 401 a proxy, and one pinning only the key case would pass against the defect
// itself. So the two are asserted to DIFFER, and that assertion is the point of this file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { triggerLaneVerdict, doorCredential, HOSTED } from "../../shared/trigger-lane.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const URL_ = "http://127.0.0.1:18811";
const verdict = (probe) => triggerLaneVerdict({ url: URL_, hasToken: true, verbs: null, posture: HOSTED, probe });

// The sentences the two doors actually send, as the doors write them.
const PROXY_401 = '{"error":"missing auth-proxy JWT (e.g. Cf-Access-Jwt-Assertion)"}';
const KEY_401 = '{"error":"this address needs an access key — put it in your assistant\'s API-key field, or add ?token=<key> to the URL"}';
const probe401 = (body) => ({ ok: true, status: 401, error: null, challenge: null, body });

test("the two door configurations produce DIFFERENT boot lines — the pair, which is the criterion", () => {
  const proxy = verdict(probe401(PROXY_401));
  const key = verdict(probe401(KEY_401));

  assert.equal(proxy.state, "fail",
    "a proxy-fronted door cannot carry a Start from a portal holding a key, and must not read as working");
  assert.equal(key.state, "pass", "a door asking for the key this portal holds is the working configuration");

  // THE ASSERTION THE DEFECT WOULD FAIL. Before this, both of the above produced the same sentence, so an
  // operator could not tell the deployment that works from the one that cannot start a clearance.
  assert.notEqual(proxy.message, key.message,
    "the two configurations printed the same line, which is the defect: a line identical in both states "
    + "carries no information about either");
  assert.notEqual(proxy.state, key.state);
});

test("the proxy refusal says what an operator can act on — the credential, not the header", () => {
  const { message } = verdict(probe401(PROXY_401));
  assert.match(message, /identity proxy/i, "names what is in front of the door");
  assert.match(message, /access key/i, "names what this portal presents, which is the mismatch");
  assert.match(message, /whatever the key is/i,
    "an operator's first instinct is to re-mint the key; the line has to say that will not help");
});

test("a 401 that names no credential is REPORTED, not judged", () => {
  // The doctrine this block already follows for an ambiguous challenge: claiming more than was measured is
  // how a check starts refusing deployments that work. A proxy we have not met must not read as either.
  const unknown = verdict(probe401('{"error":"nope"}'));
  assert.equal(unknown.state, "unsettled");
  assert.notEqual(unknown.message, verdict(probe401(PROXY_401)).message);
  assert.notEqual(unknown.message, verdict(probe401(KEY_401)).message);

  // A door that answered 401 with NO readable body is the same state — did-not-say, not did-not-look.
  assert.equal(verdict({ ok: true, status: 401, error: null, challenge: null, body: null }).state, "unsettled");
});

test("a door nothing answered at boot is still unprobed rather than judged", () => {
  // Deliberate existing behaviour for a startup race: the portal routinely binds before the engine door.
  const race = verdict({ ok: false, status: null, error: "ECONNREFUSED", challenge: null, body: null });
  assert.equal(race.state, "unsettled");
  assert.match(race.message, /BOOT-TIME OBSERVATION, NOT A VERDICT/);
  assert.equal(verdict(null).state, "unprobed", "no probe at all stays unprobed");
});

// ── THE DRIFT GUARD ─────────────────────────────────────────────────────────────────────────────────
//
// The verdict recognises the doors by what they SAY, which is a spelling, and a spelling can move. If
// either door is reworded the verdict degrades to "did not say" — the reported state rather than a wrong
// confident one, which is the right direction to fail in, but it fails quietly. This reads the sentences
// out of the doors that send them, so a reword is named here instead of being discovered in production.
test("the sentences the doors actually send are still the ones the verdict recognises", () => {
  const cfAccess = readFileSync(join(REPO, "mcp-server", "lib", "cf-access.mjs"), "utf8");
  const handler = readFileSync(join(REPO, "mcp-server", "lib", "http-handler.mjs"), "utf8");

  // EXACTLY ONE SITE, THEN THE CAPTURE. `exec` takes the FIRST match, so a second 401 added above the real
  // one would silently move what this reads: the arm keeps passing and keeps printing reassuring text while
  // no longer being about the door at all. Counting first turns "there is a sentence here" into "there is
  // one sentence here and this is it", which is what everything below rests on.
  const proxySites = cfAccess.match(/throw new AuthError\(401,\s*"[^"]+"/g) ?? [];
  assert.equal(proxySites.length, 1,
    `the proxy door has ${proxySites.length} refusal sentences; this arm reads the first and would measure the wrong one`);
  const proxySentence = /throw new AuthError\(401,\s*"([^"]+)"/.exec(cfAccess)?.[1];
  assert.ok(proxySentence, "the proxy door's 401 sentence could not be read — this guard is measuring nothing");
  assert.equal(doorCredential({ body: proxySentence }), "proxy",
    `the proxy door now says ${JSON.stringify(proxySentence)}, which the verdict no longer recognises as a proxy`);

  // TWO SENTENCES NOW, AND EACH IS PINNED TO ITS OWN ANSWER. The handler refuses a request with no key
  // on the key door, and separately refuses a request that presents a key on the PROXY door — a
  // distinction added because the proxy door's old sentence talked only about an absent assertion and
  // sent operators to the proxy's configuration.
  //
  // COUNTING ALONE STOPPED BEING ENOUGH THE MOMENT THERE WAS MORE THAN ONE. The original arm read the
  // first match and asserted there was exactly one, which is the right guard while one is the truth. The
  // failure it was built to prevent is a second sentence silently becoming the one measured — so now
  // both are read, each is classified, and they must classify DIFFERENTLY. That is strictly stronger:
  // the old form could not have caught the first draft of the key-presented sentence, which contained
  // the words "access key" and therefore classified as a key door, and would have had the portal
  // announce that the network door takes the key it actually refuses.
  //
  // MATCHED BY SHAPE, NOT BY THE HELPER'S NAME. This read `send(res, 401, …)` until the handler began
  // auditing its refusals and those two sites became `refuse(res, 401, …)`. The property had not moved
  // — the two sentences were untouched and still classify differently — but the spelling had, so the
  // arm fired for the rename rather than for the defect, and the obvious repair is the one that quietly
  // re-points it at whatever the new spelling happens to be. Any call taking `(res, 401, { error: … })`
  // is this shape whatever it is called, and the floor below is what makes the widening safe: if a
  // future refactor puts these sentences somewhere this cannot see, the count goes to zero and says so
  // rather than passing over an empty population.
  const keySites = handler.match(/\w+\(res,\s*401,\s*\{\s*error:\s*"[^"]+"/g) ?? [];
  assert.equal(keySites.length, 2,
    `the handler has ${keySites.length} refusal sentences; this arm knows two and would measure the wrong one`);
  const sentences = [...handler.matchAll(/\w+\(res,\s*401,\s*\{\s*error:\s*"([^"]+)"/g)].map((m) => m[1]);
  const byVerdict = new Map(sentences.map((t) => [doorCredential({ body: t }), t]));
  assert.equal(byVerdict.size, 2,
    `both of the handler's refusals classify the same way (${[...byVerdict.keys()]}), so a caller cannot tell the doors apart: ${JSON.stringify(sentences)}`);
  const keySentence = byVerdict.get("key");
  assert.ok(keySentence, `no refusal in the handler reads as a key door — the verdict sees ${JSON.stringify(sentences)}`);
  assert.ok(byVerdict.get("proxy"),
    `the handler's key-presented refusal must read as a PROXY door, since that is what this listener wants; the verdict sees ${JSON.stringify(sentences)}`);

  // AND NEITHER REFUSAL HANDS AN UNAUTHENTICATED CALLER A FILESYSTEM PATH. This door answers the
  // internet before anyone has authenticated. The key door's location is something an operator reads
  // from the boot line; putting it in a refusal discloses a piece of the deployment's layout to a
  // stranger and buys the operator nothing they did not already have.
  //
  // THE COMPOSITION IS EVALUATED, NOT SCANNED, and two earlier drafts of this check prove why. The
  // first read only the opening quoted string, so a path appended after it was outside what was
  // measured. The second read the whole expression and still could not see it, because the path
  // arrives as `${keyDoorPath}` — a VARIABLE. There is no literal path in this file to find, on any
  // pattern, and both drafts passed against a deliberate reintroduction while reading as guards.
  //
  // So the expression is executed with a path substituted in, which is the only form of this check
  // that can fail. A refusal that interpolates the path produces it here; one that does not, cannot.
  // ANCHORED ON THE LITERAL-FIRST FORM, which is the population the classifier reads and the one this
  // arm is about. The file sends 401 from five places; the other three compose their body from a value
  // rather than opening with a quoted sentence, and a pattern loose enough to take them read five.
  // Matched by shape rather than by the sending helper's name, for the reason given above the count.
  const refusalExprs = [...handler.matchAll(/\w+\(res,\s*401,\s*\{\s*error:\s*("[\s\S]*?)\}\s*\)/g)].map((m) => m[1]);
  assert.equal(refusalExprs.length, 2, `expected two composed refusals opening with a sentence, read ${refusalExprs.length}`);

  const SECRET = "/run/clearotron/engine.sock";
  for (const expr of refusalExprs) {
    const body = new Function("keyDoorPath", `return (${expr});`)(SECRET);
    assert.equal(typeof body, "string", "a refusal body must compose to a string");
    assert.ok(!body.includes(SECRET),
      `a refusal sent before authentication carries the key door's path: ${JSON.stringify(body)}`);
    // THE FLOOR. If the substitution never reached the expression, the assertion above is vacuous —
    // it would hold for any sentence at all. At least one refusal must actually consult the path.
  }
  assert.ok(refusalExprs.some((e) => /keyDoorPath/.test(e)),
    "neither refusal consults keyDoorPath, so substituting one proves nothing about either");

  // And they are not both recognised as the same thing, which a loose pattern would do.
  assert.notEqual(doorCredential({ body: proxySentence }), doorCredential({ body: keySentence }));
});
