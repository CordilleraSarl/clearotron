// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A registration refusal means nothing without its control.
//
// 149 makes this an acceptance criterion rather than a nicety: *"The check must distinguish 'wrong'
// from 'could not look.' A registration refusal means nothing without the localhost control passing
// first; without it, a broken endpoint reads as a policy refusal."*
//
// The failure that criterion prevents is specific and expensive. An endpoint that is down, rate-limited
// or behind something that eats POSTs refuses EVERY registration — and each refusal then reads as a
// setting the operator forgot, sending them to edit a list that was never the problem. The probe would
// be confidently wrong, in the same direction, on every vendor at once.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { probeRegistration, describeRegistration, registrationEndpointFrom, registrationAccepted,
  registrationBody, VENDOR_REDIRECTS, CONTROL_REDIRECT } from "../../shared/connector-signin-probe.mjs";

/** A `post` that answers by redirect URI, and records the order it was asked in. */
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function stub(answers, seen = []) {
  return async (_endpoint, body) => {
    const uri = body.redirect_uris[0];
    seen.push(uri);
    const a = answers[uri] ?? answers.default;
    return typeof a === "number" ? { status: a, error: null } : a;
  };
}

test("a dead endpoint reports could-not-look, and asks no vendor at all", async () => {
  const seen = [];
  const r = await probeRegistration({ post: stub({ default: 503 }, seen), endpoint: "https://x/reg" });
  assert.equal(r.looked, false, "an endpoint that refuses everything was read as a verdict about the vendors");
  assert.deepEqual(r.vendors, [],
    "vendors were probed after the control failed — every one of those refusals is uninterpretable, and "
    + "reporting them sends the reader to edit a redirect list that is not the problem");
  assert.deepEqual(seen, [CONTROL_REDIRECT], "something other than the control was asked");
  const said = describeRegistration(r, { host: "mcp.example" });
  assert.equal(said.length, 1);
  assert.equal(said[0].state, "unknown", "a could-not-look was rendered as a finding");
  assert.match(said[0].text, /would not mean what it looks like/);
});

test("the control is asked FIRST, before any vendor", async () => {
  // Order is the whole design and it is invisible in the result, so it is driven rather than assumed.
  // A probe that asked the vendors first and the control afterwards would produce the same object on a
  // healthy endpoint and would already have sent three uninterpretable requests on a broken one.
  const seen = [];
  await probeRegistration({ post: stub({ default: 201 }, seen), endpoint: "https://x/reg" });
  assert.equal(seen[0], CONTROL_REDIRECT, "the control was not the first request");
  assert.deepEqual(seen.slice(1), VENDOR_REDIRECTS.map((v) => v.uri));
});

test("with the control passing, a refusal is a finding that names the address to add", async () => {
  const answers = { [CONTROL_REDIRECT]: 201, default: 201,
    "https://chatgpt.com/connector_platform_oauth_redirect": 400 };
  const r = await probeRegistration({ post: stub(answers), endpoint: "https://x/reg" });
  assert.equal(r.looked, true);
  const said = describeRegistration(r, { host: "mcp.example" });
  const bad = said.filter((s) => s.state === "fail");
  assert.equal(bad.length, 1, "exactly one vendor was refused and the description did not say so");
  // THE REMEDY HAS TO CARRY THE ADDRESS. A reader told "registration was refused" has nothing to type;
  // 149's whole complaint about this half is that the failure has no symptom a reader can interpret.
  assert.match(bad[0].text, /https:\/\/chatgpt\.com\/connector_platform_oauth_redirect/);
  assert.match(bad[0].text, /after the browser opens/,
    "the symptom is not named, so the reader cannot recognise the failure they are looking at");
  // Provider-agnostic first, worked example second — 149's judging criterion.
  const general = bad[0].text.indexOf("Every provider");
  const example = bad[0].text.indexOf("Cloudflare");
  assert.ok(general > 0 && example > general,
    "the remedy leads with the vendor instead of the rule, which re-narrows an interface widened on purpose");
});

test("a vendor address is a dated, sourced fact and not a remembered one", () => {
  // These are not ours and they change without telling us. A reader acts on one by typing it into their
  // own console, so an entry nobody can re-check is worse than an absent one.
  assert.ok(VENDOR_REDIRECTS.length >= 3, "the vendor table shrank — say so deliberately if that is right");
  for (const v of VENDOR_REDIRECTS) {
    assert.match(v.measured, /^\d{4}-\d{2}-\d{2}$/, `${v.vendor} carries no date, so nobody can tell whether it is stale`);
    assert.ok(String(v.source ?? "").length > 20, `${v.vendor} carries no source for how it was learnt`);
    assert.match(v.uri, /^https:\/\//, `${v.vendor}'s address is not an https URL`);
    assert.ok(v.uri.includes(v.vendor), `${v.vendor}'s address does not name it — one of the pair is wrong`);
  }
});

test("the endpoint is READ from discovery, and a missing document is not a refusal", () => {
  const unread = registrationEndpointFrom({ error: "ECONNREFUSED" });
  assert.equal(unread.looked, false);
  assert.equal(unread.endpoint, null);

  const wrongChallenge = registrationEndpointFrom({ status: 302 });
  assert.equal(wrongChallenge.looked, false,
    "a door that redirects a browser instead of serving discovery was read as a provider that refuses "
    + "registrations — two different faults with two different remedies");

  const noSupport = registrationEndpointFrom({ status: 200, document: { issuer: "https://x" } });
  assert.equal(noSupport.looked, true,
    "a document that was read and carries no registration endpoint IS an answer, not a blind spot");
  assert.equal(noSupport.endpoint, null);
  assert.match(noSupport.why, /created by hand/);

  const ok = registrationEndpointFrom({ status: 200, document: { registration_endpoint: " https://x/reg " } });
  assert.equal(ok.endpoint, "https://x/reg", "the endpoint was not read, or not trimmed");
});

test("only a created client counts as a yes", () => {
  assert.equal(registrationAccepted(201), true);
  assert.equal(registrationAccepted(200), true, "providers have been seen to answer 200 with the client document");
  for (const s of [400, 401, 403, 404, 429, 500, 502, null, undefined]) {
    assert.equal(registrationAccepted(s), false, `${s} was read as a successful registration`);
  }
});

test("the registration body carries no credential", () => {
  // This probe must work without provider credentials — 149 says so in as many words — and a body that
  // grew a secret would make `doctor` a command that needs one.
  const body = registrationBody("https://example/cb");
  assert.equal(body.token_endpoint_auth_method, "none");
  assert.deepEqual(body.redirect_uris, ["https://example/cb"]);
  // VALUES, not keys. `token_endpoint_auth_method` is a field name RFC 7591 defines and its presence is
  // the opposite of a credential — it declares that this client holds none. A substring scan over the
  // whole JSON reads that as a secret, which is the arm being wrong about the code rather than the code
  // being wrong; it was written that way first and is recorded here because the shape recurs.
  const values = Object.values(body).flatMap((v) => (Array.isArray(v) ? v : [v])).map((v) => String(v).toLowerCase());
  for (const v of values) {
    for (const w of ["secret", "password", "api_key", "bearer "]) {
      assert.equal(v.includes(w), false, `the registration body carries a value that looks like a credential: ${v}`);
    }
  }
  assert.equal(Object.keys(body).some((k) => /^(client_secret|access_token|authorization)$/.test(k)), false,
    "the registration body grew a credential field, so this probe now needs one to run");
});

test("the probe is opt-in, and the document that promises so names the flag", () => {
  // `doctor` promises in INSTALL.md that it writes nothing, and that sentence is why a reader runs it on
  // a production box without thinking about it. This probe creates OAuth clients, so it can only ever
  // run when asked for by name — and the flag has to be discoverable, or an opt-in nobody can find is
  // the same as a check that does not exist.
  const src = readFileSync(join(REPO, "bin", "onboard.mjs"), "utf8");
  const gate = src.indexOf("if (PROBE_CONNECTOR");
  const use = src.indexOf("connector-signin-probe");
  assert.ok(gate > 0, "the flag's branch is gone, so the probe is either unreachable or unconditional");
  assert.ok(use > gate,
    "the probe module is reached outside the flag's branch — a `doctor` run that nobody asked would "
    + "create OAuth clients on the operator's account, against what INSTALL.md promises");
  assert.equal(src.slice(0, gate).includes("connector-signin-probe"), false,
    "the probe is imported at the top of the file, so importing doctor pulls it in unconditionally");

  const usage = execFileSync(process.execPath, [join(REPO, "bin", "onboard.mjs"), "--help"], { encoding: "utf8" });
  assert.match(usage, /--probe-connector/, "the flag is not in the command's own usage, so nobody can find it");
  const install = readFileSync(join(REPO, "INSTALL.md"), "utf8");
  assert.match(install, /--probe-connector/,
    "the install document does not name the flag it needs, and this section is the only place a reader "
    + "meets the setting it checks");
  assert.match(install, /https:\/\/chatgpt\.com\/connector_platform_oauth_redirect/,
    "the vendor redirect addresses are not in the document — a reader without a terminal has nothing to add");
});
