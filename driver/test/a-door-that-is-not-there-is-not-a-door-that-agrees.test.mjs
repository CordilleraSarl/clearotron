// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// the audience the EDGE issues, compared against the one this install is configured
// with. The half of the recreation trap that has no symptom of its own: recreate an Access application,
// fix the sign-in, and the challenge reads healthy while the stale audience stays invisible until a real
// request is rejected.
//
// THE CRITERION THIS SUITE EXISTS FOR, above all the others: a hostname that is NOT Access-fronted must
// be its own verdict and never a pass. A check that can succeed by failing to find an edge is the exact
// shape of the defect it was written to catch.
//
// NOT VERIFIED AGAINST A REAL EDGE HERE, and that is stated rather than glossed. A hand-written Access
// application with an authored discovery document produced both the original over-claim on this question
// and the later over-correction that closed it. These arms drive the DECODE and the VERDICTS, which are
// pure; whether the `meta` token's shape is what a real edge serves is a reading only a real
// Access-fronted hostname can give, and it is recorded as outstanding on the issue.
import test from "node:test";
import assert from "node:assert/strict";
import { readAudience, audienceVerdict, probeAudience, ACCESS_LOGIN_PATH } from "../../shared/access-audience.mjs";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { handRunEnv } from "./drive-env.mjs";   // names the two variables that would make the drive read no file at all

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const ONBOARD = join(REPO, "bin", "onboard.mjs");

const AUD = "0a70d440ea1f4e0f9c2d8b6e5a4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6a";
const OTHER = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

/** The owner's measured field set, encoded the way the edge encodes it. */
const metaToken = (over = {}) => {
  const payload = {
    type: "meta", aud: AUD, hostname: "mcp.cordillera.ch", redirect_url: "/mcp",
    auth_status: "NONE", service_token_status: false, ...over,
  };
  const b64 = (o) => Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.c2ln`;
};

const loginUrl = ({ kid = AUD, meta = metaToken(), team = "cordillera" } = {}) => {
  const u = new URL(`https://${team}.cloudflareaccess.com${ACCESS_LOGIN_PATH}mcp.cordillera.ch`);
  if (kid) u.searchParams.set("kid", kid);
  if (meta) u.searchParams.set("meta", meta);
  u.searchParams.set("redirect_url", "/mcp");
  return u.toString();
};

test("the audience is read from the redirect an unauthenticated caller is handed", () => {
  const r = readAudience({ status: 302, location: loginUrl() });
  assert.equal(r.kind, "read", `the audience was not read out of a well-formed Access challenge: ${r.why}`);
  assert.equal(r.aud, AUD, "the audience read is not the one the token carries");
  assert.equal(r.kid, AUD, "the `kid` cross-check value was not captured");
  assert.equal(r.hostname, "mcp.cordillera.ch", "the hostname the edge named was dropped");
});

test("the two sources are cross-checked, and a disagreement is reported rather than resolved", () => {
  const r = readAudience({ status: 302, location: loginUrl({ kid: OTHER }) });
  assert.equal(r.kind, "disagree",
    "the `kid` and the token's `aud` named different audiences and one of them was silently believed — "
    + "which throws away the only free integrity check on this read");
  assert.equal(r.aud, AUD);
  assert.equal(r.kid, OTHER);
  const v = audienceVerdict({ configured: AUD, read: r });
  assert.equal(v.ok, false, "an edge whose own two answers disagree was reported as agreement");
  assert.match(v.message, new RegExp(OTHER), "the disagreeing values are not both named");
  assert.match(v.message, new RegExp(AUD), "the disagreeing values are not both named");
});

// ── THE ONE THAT MATTERS MOST ────────────────────────────────────────────────────────────────────
test("a hostname that is not Access-fronted is its own verdict, and never a pass", () => {
  for (const [what, probe] of [
    ["a plain 200 with no redirect", { status: 200, location: "" }],
    ["a redirect somewhere else entirely", { status: 302, location: "https://example.test/sign-in?kid=" + AUD }],
    ["a redirect to the same host's own page", { status: 302, location: "https://mcp.cordillera.ch/login" }],
  ]) {
    const r = readAudience(probe);
    assert.equal(r.kind, "not-fronted", `${what} did not read as an absent edge`);
    const v = audienceVerdict({ configured: AUD, read: r });
    assert.equal(v.ok, false, `${what} reported the audience as fine. A check that can SUCCEED by failing `
      + "to find an edge is the defect this exists to catch, wearing the name of its own fix");
    assert.equal(v.kind, "not-fronted", `${what} was folded into some other verdict`);
  }
});

test("an edge that could not be asked is a could-not-look, never agreement", () => {
  const r = readAudience({ error: new Error("no answer within 5000ms") });
  assert.equal(r.kind, "unreachable");
  const v = audienceVerdict({ configured: AUD, read: r });
  assert.equal(v.ok, false, "an unreachable edge was reported as agreement");
  assert.equal(v.kind, "could-not-look");
  assert.match(v.message, /failure to look, not agreement/,
    "the message does not say which of the two happened, which is the whole distinction");
});

test("a challenge whose audience cannot be read is a could-not-look, not a pass", () => {
  for (const [what, location] of [
    ["no meta token at all", loginUrl({ meta: "" })],
    ["a meta that is not a JWT", loginUrl({ meta: "not-a-jwt" })],
    ["a payload that is not base64", loginUrl({ meta: "aaa.!!!!.bbb" })],
    ["a payload with no aud", loginUrl({ meta: metaToken({ aud: undefined }) })],
    ["an aud that is not a string", loginUrl({ meta: metaToken({ aud: { v: AUD } }) })],
    ["no kid to cross-check against", loginUrl({ kid: "" })],
    ["a redirect that is not a URL", "://nonsense"],
  ]) {
    const r = readAudience({ status: 302, location });
    assert.equal(r.kind, "unreadable", `${what} did not read as a could-not-look (got ${r.kind})`);
    const v = audienceVerdict({ configured: AUD, read: r });
    assert.equal(v.ok, false, `${what} reported the audience as fine`);
    assert.equal(v.kind, "could-not-look", `${what} was folded into some other verdict`);
  }
});

test("a mismatch names BOTH values, because a reader told only that two things differ has to go and find them", () => {
  const r = readAudience({ status: 302, location: loginUrl() });
  const v = audienceVerdict({ configured: OTHER, read: r });
  assert.equal(v.kind, "mismatch");
  assert.equal(v.ok, false);
  assert.match(v.message, new RegExp(OTHER), "the configured audience is not named");
  assert.match(v.message, new RegExp(AUD), "the audience the edge issues is not named");
  assert.match(v.message, /mcp\.cordillera\.ch/, "the hostname the mismatch is about is not named");
  assert.ok(!/audience mismatch\.?$/i.test(v.message), "the verdict is the bare phrase this arm exists to forbid");
});

test("a deployment configured with SEVERAL audiences is not a mismatch when the edge issues one of them", () => {
  // THE F54 LESSON, WHICH THIS FILE'S OWN MODULE ALREADY LEARNED ONCE. A deployment runs one Access
  // application per audience — portal, staff door, client door — and `CLEAROTRON_OIDC_AUDIENCE` may
  // name all of them. The edge issues ONE for the hostname being asked. Equality against the list
  // reports every correct multi-application deployment as a stale audience, which is how a check that
  // cries wolf gets deleted by the next person who meets it.
  const r = readAudience({ status: 302, location: loginUrl() });
  const many = audienceVerdict({ configured: `${OTHER}, ${AUD}`, read: r });
  assert.equal(many.kind, "agree",
    `an install configured with two audiences, one of which the edge issues, was reported as ${many.kind}`);
  assert.equal(many.ok, true);
  // And membership must still be able to FAIL, or the arm above proves only that nothing refuses.
  const none = audienceVerdict({ configured: `${OTHER}, ${OTHER.replace(/f/g, "e")}`, read: r });
  assert.equal(none.kind, "mismatch", "a list containing neither audience was reported as agreement");
  assert.match(none.message, new RegExp(AUD), "the audience the edge issues is not named");
  assert.match(none.message, new RegExp(OTHER), "the audiences this install expects are not named");
});

test("an unset audience against a real edge is a finding, not a pass", () => {
  const r = readAudience({ status: 302, location: loginUrl() });
  const v = audienceVerdict({ configured: "  ", read: r });
  assert.equal(v.kind, "not-configured");
  assert.equal(v.ok, false, "a door checking every request against nothing was reported as fine");
  assert.match(v.message, new RegExp(AUD), "the audience the edge issues is not named, so nobody can set it");
});

test("agreement is the ONLY verdict that reads as ok", () => {
  const ok = audienceVerdict({ configured: AUD, read: readAudience({ status: 302, location: loginUrl() }) });
  assert.equal(ok.kind, "agree");
  assert.equal(ok.ok, true, "a matching audience was not reported as matching");
  // EVERY OTHER KIND, INCLUDING ONE THIS FILE DOES NOT KNOW. A kind added later that forgot to set
  // `ok: false` would be a silent pass, which is this whole issue in one field.
  for (const kind of ["unreachable", "not-fronted", "unreadable", "disagree", "something-invented-later", undefined]) {
    const v = audienceVerdict({ configured: AUD, read: { kind, aud: AUD, kid: AUD } });
    assert.equal(v.ok, false, `the verdict for \`${kind}\` reads as ok, so a door nobody checked passes`);
  }
});

test("the probe asks once, does not follow the redirect, and hands back failure rather than throwing", async () => {
  const seen = [];
  const res = await probeAudience({
    url: "https://mcp.cordillera.ch/mcp",
    fetchImpl: async (u, opts) => { seen.push({ u, redirect: opts.redirect }); return { status: 302, headers: { get: () => loginUrl() } }; },
  });
  assert.equal(seen.length, 1, "the probe asked more than once");
  // FOLLOWING IT FETCHES THE LOGIN PAGE AND THROWS AWAY THE ONLY THING BEING READ.
  assert.equal(seen[0].redirect, "manual", "the probe follows the redirect, which discards the answer");
  assert.equal(res.status, 302);
  assert.match(res.location, /cdn-cgi\/access\/login/);

  const failed = await probeAudience({ url: "https://mcp.cordillera.ch/mcp", fetchImpl: async () => { throw new Error("ECONNREFUSED"); } });
  assert.ok(failed.error, "a fetch that threw did not come back as an error the caller can report");
  assert.equal(readAudience(failed).kind, "unreachable", "a failed probe does not read as a could-not-look");

  const nowhere = await probeAudience({ url: "" });
  assert.ok(nowhere.error, "no configured hostname read as a successful probe");
  assert.equal(audienceVerdict({ configured: AUD, read: readAudience(nowhere) }).ok, false);
});

test("the probe is bounded, and the bound is the caller's to set", async () => {
  const started = Date.now();
  const res = await probeAudience({
    url: "https://mcp.cordillera.ch/mcp",
    timeoutMs: 40,
    fetchImpl: (u, opts) => new Promise((_, rej) => opts.signal.addEventListener("abort", () => rej(opts.signal.reason ?? new Error("aborted")))),
  });
  assert.ok(res.error, "a probe that never answered did not come back as an error");
  assert.ok(Date.now() - started < 4000, "the probe waited far longer than the bound it was given");
  assert.equal(readAudience(res).kind, "unreachable", "a timed-out probe does not read as a could-not-look");
});

// ── AND DOES `doctor` ACTUALLY SAY IT? ───────────────────────────────────────────────────────────
//
// Everything above holds a pure function. A verdict nobody prints is a check that reports to nobody,
// and this repository has shipped that shape before: an unskippable detector wired to no output. So
// this drives the real command against a real socket serving the redirect a real edge would serve, and
// asserts the SENTENCE a reader would see.

const NODE_BIN = (() => {
  const d = mkdtempSync(join(tmpdir(), "aud-node-"));
  symlinkSync(process.execPath, join(d, "node"));
  return d;
})();

const UNITS = await (async () => {
  const { BACKGROUND_UNITS } = await import(pathToFileURL(join(REPO, "bin", "start.mjs")).href);
  return BACKGROUND_UNITS;
})();

function homeWith(envText) {
  const home = mkdtempSync(join(tmpdir(), "aud-home-"));
  const unitDir = join(home, ".config", "systemd", "user");
  mkdirSync(unitDir, { recursive: true });
  for (const u of UNITS) writeFileSync(join(unitDir, u), "[Service]\nEnvironmentFile=%h/.env\nExecStart=/bin/true\n");
  writeFileSync(join(home, ".env"), envText);
  return home;
}

/** A socket that answers like an Access-fronted hostname does to a caller with no session. */
async function edgeServing(location) {
  const srv = createServer((_req, res) => { res.writeHead(302, { location }); res.end(); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${srv.address().port}/mcp`, close: () => srv.close() };
}

// ASYNC ON PURPOSE. `execFileSync` blocks this process's event loop, so the socket below — which lives
// in this process — never accepts the connection `doctor` opens, and every drive reads as a timed-out
// edge. The feature looks broken and the harness is what is broken. `execFile` keeps the loop turning.
async function runDoctor(home) {
  try {
    const { stdout } = await execFileP(process.execPath, [ONBOARD, "--check"], {
      encoding: "utf8", timeout: 120_000,
      // `handRunEnv` over an EMPTY base: `CLEAROTRON_NO_ENV_FILE` and `INVOCATION_ID` each make the
      // command ignore the file this test just wrote, silently, and inheriting the real environment
      // would let the fixture's own values arrive by a second route.
      env: handRunEnv({ HOME: home, PATH: [NODE_BIN, "/usr/bin", "/bin"].join(":"), CLEAROTRON_DOCTOR_ASSUME_PINNED: "1" }, {}),
    });
    return stdout;
  } catch (e) { return `${e.stdout ?? ""}${e.stderr ?? ""}`; }
}

test("doctor reports a stale audience to the reader, naming both values", async () => {
  const edge = await edgeServing(loginUrl());
  try {
    const out = await runDoctor(homeWith(
      `CLEAROTRON_CLIENT_MCP_URL=${edge.url}\nCLEAROTRON_OIDC_AUDIENCE=${OTHER}\nPORTAL_AUTH_MODE=auth-proxy\n`));
    assert.match(out, new RegExp(OTHER),
      `doctor never named the audience this install is configured with. The check can be perfect and `
      + `report to nobody.\n${out.slice(-2500)}`);
    assert.match(out, new RegExp(AUD),
      `doctor never named the audience the edge issues, so a reader cannot act on the line\n${out.slice(-2500)}`);
    assert.match(out, /recreating an Access application changes the audience/,
      "doctor states the mismatch without the cause, which is the one thing a reader needs to know");
  } finally { edge.close(); }
});

test("doctor does not call a stale audience healthy when the two agree", async () => {
  const edge = await edgeServing(loginUrl());
  try {
    const out = await runDoctor(homeWith(
      `CLEAROTRON_CLIENT_MCP_URL=${edge.url}\nCLEAROTRON_OIDC_AUDIENCE=${AUD}\nPORTAL_AUTH_MODE=auth-proxy\n`));
    assert.ok(!/recreating an Access application changes the audience/.test(out),
      `doctor reported a mismatch on an audience that matches — a check that cries wolf is one that gets `
      + `deleted\n${out.slice(-2500)}`);
    assert.match(out, /audience matches the one the edge issues/,
      `doctor said nothing at all about an audience it successfully read and agreed with\n${out.slice(-2500)}`);
  } finally { edge.close(); }
});

// ── THREE DOORS, NOT ONE ───────────────────────────────────────────────────────────────────────────
//
// `not-fronted` was returned for every response with no redirect. Measured against production's four
// configured hostnames, that one label covered three materially different states — and called the
// install's main MCP door "not fronted" when it is fronted and working.
//
// The responses below are RECORDED from those real hostnames, not authored: a hand-written Access
// stand-in is what produced both the over-claim and the over-correction this family has already paid for.
const REAL = {
  // trademark.cordillera.ch — the browser-facing portal
  browser: { status: 302, location: "https://cordillera-ch.cloudflareaccess.com/cdn-cgi/access/login/trademark.cordillera.ch?kid=abc&meta=x.y.z", wwwAuthenticate: "", viaEdge: true },
  // mcp.cordillera.ch/mcp — Managed OAuth on an API path, RFC 9728 style
  api: { status: 401, location: "", viaEdge: true,
    wwwAuthenticate: 'Bearer realm="OAuth", error="invalid_token", error_description="Missing or invalid access token", resource_metadata="https://mcp.cordillera.ch/.well-known/cloudflare-access-protected-resource/mcp"' },
  // agent-mcp.cordillera.ch/mcp — the legacy door whose origin is gone
  originDown: { status: 502, location: "", wwwAuthenticate: "", viaEdge: true },
  // a hostname genuinely behind nothing
  bare: { status: 200, location: "", wwwAuthenticate: "", viaEdge: false },
};

test("an Access-fronted API path is FRONTED, not `not-fronted`", () => {
  const r = readAudience(REAL.api);
  assert.equal(r.kind, "fronted-api",
    "a 401 naming a cloudflare-access-protected-resource document is a door that is present and answering "
    + "— saying nothing fronts this hostname sends a reader hunting a configuration that exists");
  const v = audienceVerdict({ configured: "aaa", read: r });
  assert.equal(v.ok, false, "it is still not a pass — the audience was never compared");
  assert.match(v.message, /IS fronted/);
  assert.match(v.message, /could-not-look about the audience and not a finding about the door/);
});

test("a 5xx through the edge is the ORIGIN failing, not an absent door", () => {
  const r = readAudience(REAL.originDown);
  assert.equal(r.kind, "origin-failed");
  const v = audienceVerdict({ configured: "aaa", read: r });
  assert.equal(v.ok, false);
  assert.match(v.message, /the edge is up and the origin behind it is not/);
  assert.match(v.message, /it says the service is down/,
    "and it must not be read as anything about the audience");
});

test("a hostname genuinely behind nothing keeps the old wording and the old verdict", () => {
  const r = readAudience(REAL.bare);
  assert.equal(r.kind, "not-fronted", "narrowing the label must not empty it");
  assert.equal(audienceVerdict({ configured: "aaa", read: r }).ok, false);
});

test("the marker is Cloudflare's, not any OAuth resource's", () => {
  // `Bearer` alone is sent by every OAuth-protected resource on the internet. Keying on it would file
  // any 401 as an Access door.
  const genericOAuth = { status: 401, location: "", viaEdge: false,
    wwwAuthenticate: 'Bearer realm="example", error="invalid_token"' };
  assert.equal(readAudience(genericOAuth).kind, "not-fronted",
    "a generic Bearer challenge is not evidence of Cloudflare Access");
});

test("the browser path is untouched — the case that WORKS must not move", () => {
  const r = readAudience(REAL.browser);
  assert.notEqual(r.kind, "fronted-api");
  assert.notEqual(r.kind, "origin-failed");
  assert.ok(["read", "unreadable", "disagree"].includes(r.kind),
    `a redirect must still be read as a challenge, got ${r.kind}`);
});

test("probeAudience CARRIES the two headers, or the reader can never see the difference", () => {
  // The distinction is made from headers already on the response. A probe that drops them makes the
  // reader's three outcomes unreachable — the fully-composed-and-unreachable shape.
  const src = readFileSync(join(HERE, "..", "..", "shared", "access-audience.mjs"), "utf8");
  assert.match(src, /wwwAuthenticate:\s*res\.headers/, "the probe must return www-authenticate");
  assert.match(src, /viaEdge:\s*Boolean\(res\.headers/, "and whether the edge answered at all");
});

test("a client door with no Access in front is REPORTED, never raised — owner ruling 2026-09-08", () => {
  // SCOPED TO THE BLOCK, not the file. A whole-file search for `not-fronted` and `info` would pass on
  // any source that mentions both anywhere, which is how an assertion ends up satisfied by a neighbour.
  // The block is the one that consumes `audienceVerdict` in the client-connector section.
  const src = readFileSync(ONBOARD, "utf8");
  const at = src.indexOf("const v = audienceVerdict(");
  assert.ok(at > 0, "the client-connector audience block moved — this arm is reading the wrong place");
  const block = src.slice(at, src.indexOf("CAN AN ASSISTANT ACTUALLY SIGN IN", at));
  assert.ok(block.length > 0 && block.length < 4000, "the block bounds moved; re-anchor before trusting this");

  // How a client reaches its own door is the client's decision, so an absent Access front is a posture.
  // Raised, it made `doctor` exit 1 on a healthy deployment.
  assert.match(block, /v\.kind === "not-fronted"/,
    "the client door's not-fronted case must be handled on its own");
  const branch = block.slice(block.indexOf('v.kind === "not-fronted"'));
  assert.match(branch.slice(0, 600), /info\(/,
    "not-fronted must be SAID — a state the reader is told, not a problem counted against the box");

  // AND IT MUST STILL SAY WHAT WAS NOT ESTABLISHED. A state that quietly implies agreement is the
  // failure this whole file exists to keep out: an audience nobody compared is not an audience that
  // agreed, and dropping that sentence would trade one wrong reading for another.
  assert.match(branch.slice(0, 600), /not compared|nothing here says the two agree/i,
    "the state must still record that the configured audience was never compared");

  // THE FAULTS ARE UNTOUCHED. A configured audience that DISAGREES with the edge is still a problem,
  // and so is everything else the verdict can return.
  assert.match(block, /else problem\(v\.message\)/,
    "every other unhappy verdict must still be raised");
});
