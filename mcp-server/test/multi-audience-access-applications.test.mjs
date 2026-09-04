// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — F54. ONE ACCESS APPLICATION PER AUDIENCE, AND THE LINE BETWEEN STAFF AND CLIENT.
//
// A deployment runs an Access application per audience — the portal, the staff door, the client door —
// and the owner ran three for weeks while the product could only be configured for one. The verifier was
// never the limit: jose's `audience` takes a string OR an array and passes on any match. Every CALLER
// read the variable as a single string, so a valid token from any application but one was refused.
//
// FOUR call sites had that shape, not the two the finding named: portal-service, http-server,
// profile-service and recipe-service. Half-fixing gives a deployment where two surfaces accept three
// applications and two refuse everything but one — the same defect, on the surfaces nobody is watching.
//
// ── THE TWO RULES HERE UNDO INDEPENDENTLY, AND EACH FAILS SILENTLY WHEN UNDONE ──────────────────────
//
//   1. AN EMPTY ARRAY IS TRUTHY. Every call site guards with `!AUD` and refuses to start when it is
//      falsy; `makeAccessVerifier` refuses to build for the same reason. Returning `[]` for an unset
//      variable satisfies all four at once — every fail-closed check passing on a value that carries no
//      audience. That is why 0 and 1 values stay a STRING.
//      WHAT HAPPENS NEXT IS NOT WHAT IT LOOKS LIKE, and the arm below pins it because the guess is
//      wrong: jose refuses EVERY token against `audience: []`, including one the deployment expects.
//      `audience: undefined` is the fail-open value. So an empty list is not a widened door — it is a
//      door that starts and admits nobody, with the one message that would explain it suppressed by the
//      truthiness above. Denial of the whole surface, reported as nothing at all.
//   2. MEMBERSHIP, NOT EQUALITY. The client door asserts its audience differs from staff's, and did so
//      with `===`. Once staff is a list, a client audience of "ops" against staff "portal,ops" is `!==`
//      and the door starts sharing an audience the staff surface accepts. Making the staff side a list
//      is what creates that exposure, so the membership check ships in the same change.
//
// Real RS256 keys, real jose, tokens minted per application — the accept/refuse decisions below are the
// library's, not a fixture's.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet, jwtVerify } from "jose";
import { makeAccessVerifier, AuthError } from "../lib/cf-access.mjs";
import { accessAudience, audienceIncludes, audienceLabel } from "../../shared/access-audience.mjs";
import { trackedFiles, skipReason } from "../../shared/tracked-files.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const CORPUS_GUARD = "2180-F54 multi-audience access applications";
const NO_CORPUS = skipReason(CORPUS_GUARD);

/** The tracked .mjs corpus, or null off a checkout — a SKIP, never an empty walk read as clean. */
function sources({ tests = false } = {}) {
  const tracked = trackedFiles(CORPUS_GUARD, { root: REPO, pathspec: ["*.mjs"] });
  if (!tracked) return null;
  return tests ? tracked : tracked.filter((f) => !f.includes("/test/"));
}
const TEAM = "cordillera";
const ISS = `https://${TEAM}.cloudflareaccess.com`;
const KID = "f54-key";
const PORTAL = "aud-portal", OPS = "aud-ops", CLIENTS = "aud-clients", STRANGER = "aud-unrelated";

let priv, jwks;
before(async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  priv = privateKey;
  const pub = await exportJWK(publicKey);
  Object.assign(pub, { kid: KID, alg: "RS256", use: "sig" });
  jwks = createLocalJWKSet({ keys: [pub] });
});

/** A token as the named Access application would issue it. */
const mint = (aud) => new SignJWT({ email: "staff@example-firm.com" })
  .setProtectedHeader({ alg: "RS256", kid: KID }).setIssuedAt().setIssuer(ISS).setAudience(aud)
  .setExpirationTime(Math.floor(Date.now() / 1000) + 300).sign(priv);

/** A verifier configured exactly as a call site configures one, from the raw environment value. */
const verifierFor = (raw) => makeAccessVerifier({
  team: TEAM, aud: accessAudience(raw), allowedDomains: ["example-firm.com"], jwks,
});
const accepted = async (verify, token) => {
  try { await verify(token); return true; } catch (e) { if (e instanceof AuthError) return false; throw e; }
};

// ── the parser, including every shape that must stay FALSY ──────────────────────────────────────────

test("2180-F54 0 and 1 audiences stay a STRING, so the `!AUD` guards stay fail-closed", () => {
  // THE TRAP, asserted as the falsiness the call sites actually test rather than as a type. An arm that
  // checked `Array.isArray` would pass on `[]` — which is the bug.
  for (const raw of [undefined, null, "", "   ", ",", " , , "])
    assert.ok(!accessAudience(raw),
      `${JSON.stringify(raw)} produced a TRUTHY audience, so every "refusing to start (fail-closed)" `
      + `guard reading !AUD would now start. Got ${JSON.stringify(accessAudience(raw))}`);
  assert.equal(accessAudience("portal"), "portal");
  assert.equal(accessAudience("  portal  "), "portal", "envFrom trims, and this must not depend on that");
});

test("2180-F54 2 or more become an ARRAY, which is what jose accepts a list as", () => {
  assert.deepEqual(accessAudience("portal,ops"), ["portal", "ops"]);
  assert.deepEqual(accessAudience(" portal , ops , clients "), ["portal", "ops", "clients"]);
  // A trailing comma is an operator's typo, not a fourth empty audience.
  assert.deepEqual(accessAudience("portal,ops,"), ["portal", "ops"]);
});

test("2180-F54 the verifier itself refuses an EMPTY LIST — the guard the parser must never need", () => {
  // Belt and braces at the one place all five call sites funnel through — and the arm below this one
  // measures WHY, rather than restating the reason I first wrote here, which was wrong.
  assert.throws(() => makeAccessVerifier({ team: TEAM, aud: [], allowedDomains: ["x.com"], jwks }),
    /fail-closed/, "an empty audience array built a verifier that constrains nothing");
  assert.throws(() => makeAccessVerifier({ team: TEAM, aud: "", allowedDomains: ["x.com"], jwks }), /fail-closed/);
});

test("2180-F54 what an empty audience ACTUALLY does to jose — the reason above, measured not assumed", async () => {
  // The guard exists whichever way this goes, so this arm is not what makes it correct. It is here
  // because the reason a guard states is the thing the next reader trusts instead of re-deriving, and
  // this one was stated wrong first time: I wrote that jose reads `[]` as "no audience constraint" and
  // accepts every application's token. It does the opposite. Pinned against the real library so an
  // upgrade that changes it fails here rather than quietly making the comment true or truer.
  const ours = await mint(PORTAL);
  const theirs = await mint(STRANGER);
  const verdict = async (audience, token) => {
    try { await jwtVerify(token, jwks, { issuer: ISS, audience, algorithms: ["RS256"] }); return "accepted"; }
    catch { return "refused"; }
  };
  assert.equal(await verdict([], ours), "refused",
    "jose accepted a token against an EMPTY audience list — if this flips, an empty list is a widened "
    + "door rather than a closed one, and the guard's stated reason must be rewritten with it");
  assert.equal(await verdict([], theirs), "refused");
  // And the value that IS fail-open, so the distinction is recorded rather than remembered: no audience
  // option at all checks signature and issuer and nothing else.
  assert.equal(await verdict(undefined, theirs), "accepted",
    "jose stopped accepting an unconstrained audience — good news, and this arm should be revisited");
  // Which makes the empty-list state a door that comes up and admits NOBODY. The surface is down and
  // the startup line that would have named the cause never printed, because `[]` is truthy.
  assert.equal(await verdict(PORTAL, ours), "accepted", "the control: this token is otherwise valid");
});

// ── the decisions, made by jose against real tokens ─────────────────────────────────────────────────

test("2180-F54 ONE audience accepts its own application and refuses another", async () => {
  const verify = verifierFor(PORTAL);
  assert.equal(await accepted(verify, await mint(PORTAL)), true, "its own application must be accepted");
  assert.equal(await accepted(verify, await mint(OPS)), false,
    "THE DEFECT: a single-audience configuration refuses a valid token from any other application");
});

test("2180-F54 TWO audiences accept both applications", async () => {
  const verify = verifierFor(`${PORTAL},${OPS}`);
  assert.equal(await accepted(verify, await mint(PORTAL)), true);
  assert.equal(await accepted(verify, await mint(OPS)), true, "the second application must be accepted too");
});

test("2180-F54 THREE accept all three, and a token from an UNLISTED application is still refused", async () => {
  // The half that makes the widening safe: adding applications must not stop it being a whitelist.
  const verify = verifierFor(`${PORTAL},${OPS},${CLIENTS}`);
  for (const aud of [PORTAL, OPS, CLIENTS])
    assert.equal(await accepted(verify, await mint(aud)), true, `${aud} should be accepted`);
  assert.equal(await accepted(verify, await mint(STRANGER)), false,
    "a token from an application nobody listed was accepted — the list stopped being a whitelist");
});

// ── the client/staff line ────────────────────────────────────────────────────────────────────────────

test("2180-F54 membership, not equality — the rule the list would otherwise break", () => {
  assert.equal(audienceIncludes([PORTAL, OPS], OPS), true, "a list containing it must be a match");
  assert.equal(audienceIncludes(PORTAL, PORTAL), true, "the single-value case still works");
  assert.equal(audienceIncludes([PORTAL, OPS], CLIENTS), false);
  assert.equal(audienceIncludes("", CLIENTS), false, "no staff audience configured is not a collision");
  assert.equal(audienceIncludes([PORTAL], ""), false, "no client audience configured is not a collision");
  // What equality would have said, spelled out, because this is the whole reason the check changed.
  assert.notEqual(`${[PORTAL, OPS]}`, OPS, "`===` against a list is false, which is how the door would have started");
});

test("2180-F54 THE DOOR REFUSES TO START when its audience is one of the staff list — driven", async () => {
  // Not a source scan. The guard chain reaches this only when the door is neither token-only nor
  // auth-disabled and has a team and an audience, so the environment below is the one that gets there.
  const run = (staff) => new Promise((resolve) => {
    const child = spawn(process.execPath, [join(REPO, "mcp-server", "http-server-client.mjs")], {
      env: { PATH: process.env.PATH, HOME: "/nonexistent-f54", CLEAROTRON_NO_ENV_FILE: "1",
        CLIENT_MCP_HTTP_PORT: "18961", CF_ACCESS_TEAM: TEAM,
        CLEAROTRON_CLIENT_OIDC_AUDIENCE: OPS, CLEAROTRON_OIDC_AUDIENCE: staff },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    const timer = setTimeout(() => { try { process.kill(child.pid); } catch { /* gone */ } resolve({ code: null, out }); }, 8000);
    child.once("exit", (code) => { clearTimeout(timer); resolve({ code, out }); });
  });

  const collide = await run(`${PORTAL},${OPS}`);
  assert.equal(collide.code, 1,
    `the client audience is one of the staff list and the door started anyway:\n${collide.out}`);
  assert.match(collide.out, /one of the audiences/,
    `it exited, but not on the boundary check — this arm would pass on any startup failure:\n${collide.out}`);

  // THE CONTROL. Without it the arm above passes on a door that refuses every environment, which is a
  // different defect wearing the same exit code.
  const clear = await run(`${PORTAL},${CLIENTS}`);
  assert.doesNotMatch(clear.out, /one of the audiences/,
    `the client audience is NOT in the staff list and the boundary check fired anyway:\n${clear.out}`);
});

// ── the class, not the four instances ────────────────────────────────────────────────────────────────

test("2180-F54 EVERY reader of the staff audience goes through the parser — a fifth site cannot regress silently", (t) => {
  // The finding named two call sites and there were four. Nothing above would notice a fifth appearing,
  // or one of the four being edited back to a raw string: the arms test the parser and the verifier, and
  // a call site that stops calling the parser still passes all of them while refusing every application
  // but one. This is what makes those arms worth their green.
  //
  // The population is DISCOVERED rather than listed, for the reason the four-not-two mistake happened.
  const offenders = [];
  const walked = sources();
  if (!walked) return t.skip(NO_CORPUS);
  const files = walked.filter((f) => !f.startsWith("cut/"));
  assert.ok(files.length > 100, `expected the tracked source tree, found ${files.length} file(s)`);
  for (const f of files) {
    const src = readFileSync(join(REPO, f), "utf8");
    for (const [i, line] of src.split("\n").entries()) {
      // A READ of the staff audience out of the environment. Prose about the variable is how this change
      // explains itself, so the pattern is the call, not the name.
      if (!/envFrom\(\s*process\.env\s*,\s*"CLEAROTRON_OIDC_AUDIENCE"\s*\)/.test(line)) continue;
      if (/accessAudience\s*\(/.test(line)) continue;                     // routed correctly
      offenders.push(`${f}:${i + 1}  ${line.trim().slice(0, 100)}`);
    }
  }
  assert.deepEqual(offenders, [],
    "these read the staff audience without accessAudience(), so a deployment with more than one Access "
    + `application is refused everywhere but the first — the whole of F54:\n${offenders.join("\n")}`);
});

test("2180-F54 the four known readers are still there, so the arm above is not passing on an empty walk", (t) => {
  // — a discovered set that found nothing looks identical to a clean one. These four are the
  // population F54 was measured against; if one disappears, re-check this arm rather than deleting it.
  const files = sources({ tests: true });
  if (!files) return t.skip(NO_CORPUS);
  const readers = files.filter((f) => !f.includes("/test/")
    && /envFrom\(\s*process\.env\s*,\s*"CLEAROTRON_OIDC_AUDIENCE"\s*\)/.test(readFileSync(join(REPO, f), "utf8")));
  for (const f of ["driver/portal-service.mjs", "mcp-server/http-server.mjs",
    "driver/profile-service.mjs", "driver/recipe-service.mjs", "mcp-server/http-server-client.mjs"])
    assert.ok(readers.includes(f), `${f} no longer reads the staff audience — re-check this arm rather than deleting it`);
});

// ── the defect THIS CHANGE introduced, and the guard against its return ──────────────────────────────

test("2180-F54 the boot log truncates EACH audience — `slice` on a list takes elements, not characters", () => {
  // Found by asking what every existing use of AUD does with it, rather than only what the verifier
  // does. All four call sites logged `aud=${AUD.slice(0, 8)}…`, which is right for a string and quietly
  // wrong for a list: Array.prototype.slice takes ELEMENTS, so a two-audience deployment printed both
  // values IN FULL followed by one ellipsis that was no longer true — the opposite of the fragment the
  // line exists to give an operator.
  assert.equal(audienceLabel("aud-portal-abcdef"), "aud-port…");
  assert.equal(audienceLabel(["aud-portal-abcdef", "aud-ops-123456"]), "aud-port…,aud-ops-…");
  assert.equal(audienceLabel(""), "(none)");
  // The shape the old form produced, spelled out so the regression is recognisable rather than abstract.
  assert.notEqual(`${["aud-portal-abcdef", "aud-ops-123456"].slice(0, 8)}…`,
    audienceLabel(["aud-portal-abcdef", "aud-ops-123456"]),
    "the old expression and the new one agree, so this arm is not testing the difference");
});

test("2180-F54 no call site slices the audience itself — the string-only operation that broke", (t) => {
  // The class, not the four instances. Any string method on a value that is now sometimes an array is
  // the same defect in a different spelling, and `slice` is the one that was actually there.
  const offenders = [];
  const files = sources();
  if (!files) return t.skip(NO_CORPUS);
  assert.ok(files.length > 100, `expected the tracked source tree, found ${files.length} file(s)`);
  for (const f of files) {
    const src = readFileSync(join(REPO, f), "utf8");
    for (const [i, line] of src.split("\n").entries()) {
      // PROSE ABOUT THE DEFECT IS HOW THE FIX EXPLAINS ITSELF, and this arm caught its own module's
      // comment quoting the old expression on the first run. A pattern that matches the explanation is
      // one nobody can write around, so comment lines are skipped and the CODE shape is what is judged.
      const t = line.trim();
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue;
      if (/\bAUD\s*\.\s*(slice|trim|toLowerCase|startsWith|includes|padEnd|split)\s*\(/.test(line))
        offenders.push(`${f}:${i + 1}  ${t.slice(0, 100)}`);
    }
  }
  assert.deepEqual(offenders, [],
    "these call a string method on the staff audience, which is an array whenever a deployment runs more "
    + `than one Access application:\n${offenders.join("\n")}`);
});
