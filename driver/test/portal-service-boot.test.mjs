// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// portal-service-boot.test.mjs — what the portal REFUSES TO START WITHOUT, and what its trigger
// credential actually permits. Two hardening items that live in the bootstrap rather than the router,
// so neither is reachable from makePortalService() and neither was covered by portal-service.test.mjs.
//
// The grants guard is exercised by SPAWNING the real service. A pure extracted predicate would test the
// predicate; what has to be true is that this process, started with this environment, does not end up
// listening — and the only honest way to assert "does not end up listening" is to start it and look.
//
// SAFETY GUARD: env pinned before dynamic driver imports (driver.config freezes roots at import).
import { mkdtempSync as __mkdtemp } from "node:fs";
// The two dirs below are made BEFORE the file's real imports, to pin env — so the collector
// further down does not exist yet and cannot hold them. They get their own array, drained by the
// same `after`. Without this the file still leaks exactly two per run..
const __EARLY_TEMPS = [];
const __t = (prefix) => { const d = __mkdtemp(__join(__tmpdir(), prefix)); __EARLY_TEMPS.push(d); return d; };
import { pinEnvAll, pinEnv, envFrom } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling; the default is taken only when NO spelling holds one
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || __t("portal-boot-ws-"));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", envFrom(process.env, "CLEAROTRON_REPORTS_DIR") || __t("portal-boot-pool-"));
process.env.TRADEMARK_MCP_TOKEN_SECRET ||= "boot-test-token-secret";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";


// EVERY temp directory this file makes is removed — including ones created inside helpers, and ones
// made by a test that then failed. A `beforeEach` that cleans the PREVIOUS iteration leaves the last of
// every run, and a hook over named bindings cannot reach a helper's dir at all; this file makes them at
// 10 sites. So `mkdtempSync` is wrapped and the collector is the only way one gets made — a new call
// site cannot forget to register itself..
const TEMP_DIRS = [];
const tempDir = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); TEMP_DIRS.push(d); return d; };
after(() => { for (const d of [...__EARLY_TEMPS, ...TEMP_DIRS]) rmSync(d, { recursive: true, force: true }); });

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVICE = join(HERE, "..", "portal-service.mjs");

const { opsTokenPosture } = await import("../portal-service.mjs");
const { mintToken, verifyToken } = await import("../../shared/scope.mjs");
const { mintSession, readLocalCredential } = await import("../portal-local-auth.mjs");

// The signing secret every booted child below is given. — it signs BOTH the confirmation tokens
// and, in local mode, the session cookie, so a test that wants to talk to a booted portal can mint a
// session for it here without a browser.
const BOOT_SECRET = "boot-test-secret";

// ── the mandatory-grants guard ─────────────────────────────────────────────────────────────────────

/**
 * Start the real service and report how it ended: exited on its own, or reached the listening line.
 *
 * Killed as soon as it announces a listener — the question is only ever "did it get that far", and a
 * portal left running past the end of a test is a port leak into the next one. PORT=0 so nothing can
 * collide with a real instance on the box.
 */
function boot(overrides, { waitMs = 15000 } = {}) {
  // — pinEnvAll writes EVERY spelling of an aliased name, and deletes every spelling for
  // `undefined` — which is what the loop this replaced did for one spelling only.
  const env = pinEnvAll({ ...process.env }, overrides);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SERVICE], { env, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let done = false;
    const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } }, waitMs);
    child.stderr.on("data", (c) => {
      stderr += String(c);
      if (/listening on/.test(stderr)) { try { child.kill("SIGKILL"); } catch { /* gone */ } }
    });
    child.on("exit", (code, signal) => finish({ code, signal, stderr, listened: /listening on/.test(stderr) }));
    child.on("error", (e) => finish({ code: null, signal: null, stderr: stderr + String(e), listened: false }));
  });
}

/**
 * A LOCAL-MODE, loopback, otherwise-valid environment — everything present EXCEPT the roster.
 *
 * — this used to be `PORTAL_AUTH_DISABLED=1 PORTAL_DEV=1`, which was not a mode: it skipped
 * identity entirely and handed every caller one synthetic address. Both switches are deleted. Local
 * mode is the replacement and it is a real identity source, so the environment now names a user and a
 * credential file — under a fresh temporary directory per call, because a first boot MINTS a passphrase
 * and two tests sharing one path would have the second read the first's credential.
 *
 * CF_ACCESS_* are explicitly cleared. The suite may be run from a shell that has sourced a real
 * environment, and a stray CLEAROTRON_OIDC_AUDIENCE would not fail these tests — it would make them exercise a
 * different mode while still passing, which is worse.
 */

// — BOTH SPELLINGS, OR THE PARENT'S TRANSLATED COPY WINS IN THE CHILD. A child spawned with
// `{...process.env, ...ours}` inherits every name the PARENT holds, and this process now translates on
// import. Overriding only the old spelling leaves the parent's stale CLEAROTRON_* value beside it, and
// `applyEnvAliases` resolves that disagreement in favour of the NEW name by design. Derived through
// `currentName` so it tracks the alias table instead of a hand-written pair.
const bothSpellings = (env) => Object.fromEntries(
  Object.entries(env).flatMap(([k, v]) => [...new Set([k, k])].map((n) => [n, v])));

function bootEnv(extra = {}) {
  return bothSpellings({
    PORTAL_AUTH_MODE: "local",
    PORTAL_LOCAL_USER: "dev@local",
    PORTAL_LOCAL_CREDENTIAL: join(tempDir("portal-bootcred-"), "credential.json"),
    CF_ACCESS_TEAM: undefined, CLEAROTRON_OIDC_AUDIENCE: undefined, CLEAROTRON_OIDC_AUDIENCE: undefined,
    PORTAL_SERVICE_HOST: "127.0.0.1", PORTAL_SERVICE_PORT: "0",
    PORTAL_SECRET: BOOT_SECRET,
    // Set, and deliberately so: this is what the pre-existing `!staffDomains.length && !grants()` check
    // is satisfied by on every real deployment, which is why that check never caught the read-all.
    PORTAL_STAFF_DOMAINS: "example-firm.com",
    CLEAROTRON_REPORTS_DIR: tempDir("portal-bootpool-"),
    CLEAROTRON_WORK_DIR: tempDir("portal-bootws-"),
    CLEAROTRON_ACCESS_FILE: undefined,
    PORTAL_MCP_URL: undefined, PORTAL_OPS_TOKEN: undefined,
    ...extra,
  });
}

/** A CF-ACCESS-mode environment: the hosted shape, which must leave working byte-for-byte. */
function cfEnv(extra = {}) {
  return bootEnv({
    PORTAL_AUTH_MODE: undefined,                  // unset ⇒ cf-access, the default that must not have moved
    PORTAL_LOCAL_USER: undefined, PORTAL_LOCAL_CREDENTIAL: undefined,
    CF_ACCESS_TEAM: "example-team", CLEAROTRON_OIDC_AUDIENCE: "a", CLEAROTRON_OIDC_AUDIENCE: "a".repeat(64),
    MCP_ALLOWED_EMAIL_DOMAINS: "example-firm.com",
    MCP_ALLOWED_EMAILS: undefined,
    ...extra,
  });
}

/** A roster file on disk. Empty is legitimate; the guard demands a FILE, not a population. */
function grantsFile(tenants = {}) {
  const p = join(tempDir("portal-grants-"), "grants.json");
  writeFileSync(p, JSON.stringify({ tenants }));
  return p;
}

test("no CLEAROTRON_ACCESS_FILE ⇒ the portal REFUSES TO START — a missing roster is silent read-all", async () => {
  // shared/scope.mjs accountsForEmail: `if (!grants) return "*"`. Unset, every admitted identity becomes
  // { role: "client", accounts: "*" } and assertPrincipal approves any ?account= it is handed — one
  // signed-in customer reads every other customer's runs, held reports and configuration, with nothing
  // thrown and nothing logged. Before this guard the process below started and listened.
  const r = await boot(bootEnv());
  assert.equal(r.listened, false, "it must never reach a listening socket without a roster");
  assert.equal(r.code, 1, `expected a fail-closed exit(1); got code=${r.code} signal=${r.signal}\n${r.stderr}`);
  assert.match(r.stderr, new RegExp("CLEAROTRON_ACCESS_FILE"), "the operator is told which value is missing");
  assert.match(r.stderr, /refusing to start/i);
  // The reason has to name the CONSEQUENCE, not just the variable — "unset" invites someone to decide it
  // is optional, which is exactly the decision that produced this.
  assert.match(r.stderr, /read|every customer|accountsForEmail/i, "…and what it costs");
});

test("an EMPTY roster is a legitimate answer — the guard demands a file, not a population", async () => {
  // {"tenants":{}} admits staff by domain and grants no client anything: the correct starting state for a
  // fresh instance. A guard that also refused this would push whoever hits it toward deleting the guard.
  const dir = tempDir("portal-grants-");
  const grantsPath = join(dir, "grants.json");
  writeFileSync(grantsPath, JSON.stringify({ tenants: {} }));

  const r = await boot(bootEnv({ CLEAROTRON_ACCESS_FILE: grantsPath }));
  assert.equal(r.listened, true, `expected the service to start; code=${r.code} signal=${r.signal}\n${r.stderr}`);
  // …and this is the control for the test above: the failure there is the ROSTER, not some unrelated
  // breakage in the bootstrap that would make any spawn exit 1.
});

test("#769 LOCAL MODE DOES NOT GET TO SKIP THE ROSTER — a roster of one is still a roster", async () => {
  // The temptation with a single-user install is to say "there is only one person, so the grants file is
  // ceremony". It is not: accountsForEmail returns "*" for every identity when CLEAROTRON_ACCESS_FILE is
  // unset, so skipping it would make the one local user a read-all over every customer on the box. The
  // guard is unconditional and left it that way; this pins that the new mode is inside it.
  const r = await boot(bootEnv());
  assert.equal(r.listened, false, "local mode must not be a way past the roster guard");
  assert.equal(r.code, 1);
  assert.match(r.stderr, new RegExp("CLEAROTRON_ACCESS_FILE"));
});

// ──: the auth MODE ────────────────────────────────────────────────────────────────────────────
//
// The bypass (`PORTAL_AUTH_DISABLED` + `PORTAL_DEV`) is deleted and replaced by a named mode. What has
// to be true, in this order of importance:
//
//   1. The Cloudflare path is untouched — a hosted deployment authenticates through it, and every
//      fail-closed exit on that path still fires.
//   2. Local mode is a real identity source that boots.
//   3. Nothing can select a mode by ACCIDENT: an unset variable, a typo, or a missing CF value must
//      never be able to choose an identity source, because that is the failure that would look healthy.

test("#769 CF-ACCESS MODE STILL BOOTS — the hosted deployment's path, unchanged", async () => {
  // PORTAL_AUTH_MODE unset. This is the shape a hosted deployment's environment file and service unit
  // carry, and the one thing is not allowed to have moved.
  const r = await boot(cfEnv({ CLEAROTRON_ACCESS_FILE: grantsFile() }));
  assert.equal(r.listened, true, `the Cloudflare path must still reach a listening socket; code=${r.code}\n${r.stderr}`);
  // — the banner now leads with `issuer=`, taking the MCP face's exact shape
  // (`issuer=${OIDC_ISSUER || `CF Access team=${TEAM}`}`). With no issuer configured it still names the
  // Cloudflare team, so this arm's claim — the edge verifier, not anything new — is unchanged.
  assert.match(r.stderr, /auth ON — issuer=CF Access team=example-team/, "…through the edge verifier, not through anything new");
  assert.match(r.stderr, /auth ON \(CF Access\)/, "and the listening line says which door is open");
});

test("#769 cf-access mode's fail-closed exits ALL still fire", async () => {
  // Each of these refused to start before and must refuse identically after it. The mode branch is
  // the one place a new `if` could have swallowed them.
  const missingAud = await boot(cfEnv({ CLEAROTRON_OIDC_AUDIENCE: undefined, CLEAROTRON_OIDC_AUDIENCE: undefined, CLEAROTRON_ACCESS_FILE: grantsFile() }));
  assert.equal(missingAud.listened, false);
  assert.equal(missingAud.code, 1);
  assert.match(missingAud.stderr, new RegExp(`CLEAROTRON_OIDC_AUDIENCE plus CF_ACCESS_TEAM or PORTAL_OIDC_ISSUER are missing`));

  const missingTeam = await boot(cfEnv({ CF_ACCESS_TEAM: undefined, CLEAROTRON_ACCESS_FILE: grantsFile() }));
  assert.equal(missingTeam.code, 1);
  assert.match(missingTeam.stderr, new RegExp(`CLEAROTRON_OIDC_AUDIENCE plus CF_ACCESS_TEAM or PORTAL_OIDC_ISSUER are missing`));

  const noGate = await boot(cfEnv({ MCP_ALLOWED_EMAIL_DOMAINS: undefined, CLEAROTRON_ACCESS_FILE: grantsFile() }));
  assert.equal(noGate.listened, false);
  assert.equal(noGate.code, 1);
  assert.match(noGate.stderr, /neither MCP_ALLOWED_EMAIL_DOMAINS nor MCP_ALLOWED_EMAILS/);

  // …and an explicit PORTAL_AUTH_MODE=cf-access takes exactly the same branch as leaving it unset.
  const explicit = await boot(cfEnv({ PORTAL_AUTH_MODE: "cf-access", CLEAROTRON_ACCESS_FILE: grantsFile() }));
  assert.equal(explicit.listened, true, `naming the default must not change it; ${explicit.stderr}`);
  assert.match(explicit.stderr, /auth ON — issuer=CF Access/);   // — the banner leads with issuer=, MCP-face shape
});

test("#769 A MISSING CF VALUE CANNOT SELECT LOCAL MODE — it is still a refusal", async () => {
  // THE REASON local mode must be asked for by name. Under an inferred rule ("no CF variables and a
  // loopback host ⇒ local"), a deployment that lost CLEAROTRON_OIDC_AUDIENCE would start a portal reachable through
  // its tunnel with a passphrase nobody has ever seen printed — and look healthy. Loopback does not
  // discriminate: the test box and production both bind 127.0.0.1 behind a Cloudflare tunnel.
  const r = await boot(cfEnv({ CF_ACCESS_TEAM: undefined, CLEAROTRON_OIDC_AUDIENCE: undefined, CLEAROTRON_OIDC_AUDIENCE: undefined, CLEAROTRON_ACCESS_FILE: grantsFile() }));
  assert.equal(r.listened, false, "a missing value must never be able to choose an identity source");
  assert.equal(r.code, 1);
  assert.match(r.stderr, /refusing to start/i);
  assert.ok(!/local sign-in/.test(r.stderr), "…and certainly not by silently starting the local one");
});

test("#769 LOCAL MODE BOOTS, and says which door it opened", async () => {
  const r = await boot(bootEnv({ CLEAROTRON_ACCESS_FILE: grantsFile({ t1: { accounts: ["aurora"], users: { "dev@local": "*" } } }) }));
  assert.equal(r.listened, true, `local mode must reach a listening socket; code=${r.code}\n${r.stderr}`);
  assert.match(r.stderr, /auth ON — local sign-in, one user \(dev@local\), loopback only/);
  assert.match(r.stderr, /auth ON \(local sign-in\)/, "the listening line names the door, and never says AUTH OFF again");
  assert.ok(!/AUTH OFF/.test(r.stderr), "there is no third state where nothing is proven");
});

test("#769 / 1960 FIRST RUN mints a credential; off a terminal the passphrase is not printed at all", async () => {
  // ✕ THIS ARM ASSERTED THE OPPOSITE until, and was right to: printing once WAS the
  // handoff. What changed is who is reading. `boot()` spawns with a pipe, so this is the non-terminal
  // shape — the same one a systemd unit, a CI job and this harness all have, and the one where a
  // printed secret stops being a moment and becomes a record. The terminal branch still prints; both
  // sides of that decision are driven in portal-local-auth.test.mjs.
  //
  // NO ARM BOOTS THIS SERVICE ON A REAL TERMINAL. A pty could be borrowed from script(1), but its flags
  // differ across the platforms this suite runs on, and a platform-conditional arm is a code path in
  // disguise. An env override that forced the terminal branch would be worse still: a knob that makes
  // the service print a credential is the defect with a switch on it.
  const credential = join(tempDir("portal-bootcred-"), "credential.json");
  const grants = grantsFile({ t1: { accounts: ["aurora"], users: { "dev@local": "*" } } });

  const first = await boot(bootEnv({ PORTAL_LOCAL_CREDENTIAL: credential, CLEAROTRON_ACCESS_FILE: grants }));
  assert.equal(first.listened, true, first.stderr);
  assert.ok(!/PASSPHRASE:/.test(first.stderr),
    `a passphrase reached a non-terminal stderr, where it outlives the moment:\n${first.stderr}`);
  assert.match(first.stderr, /so one has been created for dev@local/,
    "the operator is still TOLD a credential exists — silence here is the install nobody can sign into");
  assert.ok(first.stderr.includes(credential), "…and the file is named, because that is what they act on");
  assert.match(first.stderr, /clearotron passphrase --reset/,
    "…and the recovery route is named: a credential nobody can obtain is not a credential");

  // It is a real credential for the configured user, and the plaintext is nowhere on disk.
  const rec = readLocalCredential(credential);
  assert.equal(rec.email, "dev@local");
  const onDisk = JSON.parse(readFileSync(credential, "utf8"));
  assert.ok(onDisk.hash && onDisk.salt, "the file stores a salted digest");
  assert.ok(!("passphrase" in onDisk) && !("secret" in onDisk), "…and never the secret itself");
  assert.equal(statSync(credential).mode & 0o777, 0o600);

  const second = await boot(bootEnv({ PORTAL_LOCAL_CREDENTIAL: credential, CLEAROTRON_ACCESS_FILE: grants }));
  assert.equal(second.listened, true, second.stderr);
  assert.ok(!/PASSPHRASE:/.test(second.stderr), "a restart must not print one either");
  assert.match(second.stderr, /credential for dev@local read from/, "it reports reading the existing one instead");
});

test("#769 A CORRUPT CREDENTIAL IS FATAL — it must never read as 'no user configured'", async () => {
  // The worst silent failure available here. "No credential" is answered by MINTING ONE, so a file that
  // cannot be parsed, read as an absence, would replace a working credential with a fresh passphrase
  // printed to a terminal nobody is watching — and lock out whoever holds the old one.
  const credential = join(tempDir("portal-bootcred-"), "credential.json");
  writeFileSync(credential, "}{ this was edited by hand");
  const r = await boot(bootEnv({ PORTAL_LOCAL_CREDENTIAL: credential, CLEAROTRON_ACCESS_FILE: grantsFile() }));
  assert.equal(r.listened, false);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /not valid JSON/);
  assert.ok(!/PASSPHRASE:/.test(r.stderr), "and it must NOT have minted a replacement");
  assert.equal(readFileSync(credential, "utf8"), "}{ this was edited by hand", "the file is left exactly as it was found");
});

test("#769 local mode's own fail-closed exits: no user, a non-address, a non-loopback host, an unknown mode", async () => {
  const grants = grantsFile({ t1: { accounts: ["aurora"], users: { "dev@local": "*" } } });

  const noUser = await boot(bootEnv({ PORTAL_LOCAL_USER: undefined, CLEAROTRON_ACCESS_FILE: grants }));
  assert.equal(noUser.listened, false);
  assert.equal(noUser.code, 1);
  assert.match(noUser.stderr, /PORTAL_LOCAL_USER/, "the operator is told which value to set…");
  assert.match(noUser.stderr, /grants file|CLEAROTRON_ACCESS_FILE|PORTAL_STAFF_DOMAINS/, "…and that setting it is not the whole job");

  // portal-access.mjs refuses a multi-@ identity outright, so this would sign in and then be denied at
  // the door — a login that works and a portal that does not is the worst of both.
  const multiAt = await boot(bootEnv({ PORTAL_LOCAL_USER: "x@firm.ch@evil.com", CLEAROTRON_ACCESS_FILE: grants }));
  assert.equal(multiAt.code, 1);
  assert.match(multiAt.stderr, /not a single email address/);

  // Off loopback the passphrase and the cookie are on the wire in clear, and the cookie cannot even be
  // marked Secure without TLS. The remedy in the message is a proxy, not a wider bind.
  const exposed = await boot(bootEnv({ PORTAL_SERVICE_HOST: "0.0.0.0", CLEAROTRON_ACCESS_FILE: grants }));
  assert.equal(exposed.listened, false);
  assert.equal(exposed.code, 1);
  assert.match(exposed.stderr, /plaintext/);
  assert.match(exposed.stderr, /proxy/, "the refusal names a way forward, not just a refusal");

  // A typo must not fall through to the default. "loca1" is not "local" and it is not cf-access either.
  const typo = await boot(bootEnv({ PORTAL_AUTH_MODE: "loca1", CLEAROTRON_ACCESS_FILE: grants }));
  assert.equal(typo.listened, false);
  assert.equal(typo.code, 1);
  assert.match(typo.stderr, /is not a mode this service has/);
  // …but surrounding whitespace and case are forgiven, because they are not a different intention.
  const shouty = await boot(bootEnv({ PORTAL_AUTH_MODE: " Local ", CLEAROTRON_ACCESS_FILE: grants }));
  assert.equal(shouty.listened, true, `" Local " is local; ${shouty.stderr}`);
});

test("#769 PORTAL_SECRET IS REQUIRED IN BOTH MODES — the shipped default secret is deleted", async () => {
  // `PORTAL_SECRET || (DEV ? "dev-secret-not-for-prod" : "")` shipped a signing key in the source tree
  // and the only thing between it and production was one variable being read correctly. It signs the
  // confirmation tokens and, now, the session cookie; there is no default for either.
  const grants = grantsFile({ t1: { accounts: ["aurora"], users: { "dev@local": "*" } } });
  for (const [what, env] of [["local", bootEnv({ PORTAL_SECRET: undefined, CLEAROTRON_ACCESS_FILE: grants })],
    ["cf-access", cfEnv({ PORTAL_SECRET: undefined, CLEAROTRON_ACCESS_FILE: grants })]]) {
    const r = await boot(env);
    assert.equal(r.listened, false, `${what} mode must not start without a signing secret`);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /PORTAL_SECRET is required/);
  }
  // Belt and braces, on the source: no EXECUTABLE line can reach the old default. Comment lines are
  // filtered the way deployment-hostnames.test.mjs filters them — the paragraph above the deletion
  // names the string it deleted, and a blanket scrub would either delete that history or fail on it.
  const live = readFileSync(SERVICE, "utf8").split("\n").filter((ln) => !/^\s*(\/\/|\*|\/\*)/.test(ln));
  assert.deepEqual(live.filter((ln) => ln.includes("dev-secret-not-for-prod")), [],
    "the default secret is still reachable from code");
});

test("#769 THE DELETED SWITCHES ARE UNREACHABLE — not merely unused", async () => {
  // Setting all three of the old names must change nothing: local mode is still selected by name, the
  // credential is still required, and no synthetic identity appears. A leftover read would show up here
  // as a boot that behaves differently for an environment nobody supports any more.
  const src = readFileSync(SERVICE, "utf8");
  for (const name of ["PORTAL_AUTH_DISABLED", "PORTAL_DEV", "PORTAL_DEV_EMAIL"])
    assert.ok(!src.includes(`process.env.${name}`), `${name} is still read by the bootstrap`);

  const r = await boot(bootEnv({
    PORTAL_AUTH_DISABLED: "1", PORTAL_DEV: "1", PORTAL_DEV_EMAIL: "ghost@nowhere.example",
    CLEAROTRON_ACCESS_FILE: grantsFile({ t1: { accounts: ["aurora"], users: { "dev@local": "*" } } }),
  }));
  assert.equal(r.listened, true, r.stderr);
  assert.match(r.stderr, /auth ON — local sign-in, one user \(dev@local\)/, "the old names buy nothing");
  assert.ok(!r.stderr.includes("ghost@nowhere.example"), "and cannot name the identity");
});

// ── what the trigger credential actually permits ───────────────────────────────────────────────────
// The header of portal-service.mjs used to describe this token as "ACCOUNTS-SCOPED" and the trigger blast
// radius as "the granted accounts". shared/scope.mjs authorize() only caps start_run
// `if (Array.isArray(scope?.accounts))`, and resolveScope defaults an absent claim to "*" — so a token
// minted without --accounts is capped by nothing, and the comment described a wall nobody had built.

test("opsTokenPosture reports the REAL posture of a real minted token, and agrees with the verifier", () => {
  // Real artifacts: minted through the one issuance path (mcp-server/mint-token.mjs calls exactly this),
  // not a hand-written blob that could encode a shape mintToken never produces.
  const capped = mintToken({ scope: "ops", sub: "portal", verbs: ["start_run"], accounts: ["aurora", "zephyr"] });
  const p = opsTokenPosture(capped);
  assert.equal(p.readable, true);
  assert.equal(p.scope, "ops");
  assert.equal(p.sub, "portal");
  assert.deepEqual(p.verbs, ["start_run"]);
  assert.deepEqual(p.accounts, ["aurora", "zephyr"]);
  assert.equal(p.accountCapped, true);

  // The posture is DECODED, never verified — so the thing that must be true is that it never claims a cap
  // the enforcing side would discard. verifyToken is what the MCP face actually runs.
  const v = verifyToken(capped);
  assert.deepEqual(p.accounts, v.accounts, "the decoded cap must equal the verified cap");
  assert.deepEqual(p.verbs, v.verbs);
  assert.equal(p.sub, v.sub);
});

test("a token minted WITHOUT --accounts reports UNCAPPED — absence means every account, not none", () => {
  // This is the token shape deployed today. `accounts: null` is the inversion that made the old comment
  // read as reassuring: it is not "no accounts", it is "all of them" (resolveScope: `accounts: t.accounts ?? "*"`).
  const uncapped = mintToken({ scope: "ops", sub: "portal", verbs: ["start_run"] });
  const p = opsTokenPosture(uncapped);
  assert.equal(p.readable, true);
  assert.equal(p.accounts, null);
  assert.equal(p.accountCapped, false, "the caller must be able to see that no cap is in force");
  assert.deepEqual(p.verbs, ["start_run"], "verb-scoping is real and is reported separately from the cap");
  assert.equal(verifyToken(uncapped).accounts, null, "and the verifier agrees there is no cap to enforce");
});

test("an unreadable or empty-claim token is never reported as capped", () => {
  // Fail closed on the SUMMARY too: anything this cannot read is reported as uncapped, because a boot line
  // that quietly omitted a token it could not parse would read as "fine" to the operator scanning it.
  for (const bad of [undefined, null, "", "garbage", "v2.abc.def", "v1..sig", "v1.!!!notbase64!!!.sig",
    `v1.${Buffer.from("[1,2,3]").toString("base64url")}.sig`]) {
    const p = opsTokenPosture(bad);
    assert.equal(p.readable, false, `${String(bad)} must not read as a usable token`);
    assert.equal(p.accountCapped, false);
    assert.equal(p.accounts, null);
  }
  // Claim shapes verifyToken DISCARDS (shared/scope.mjs: non-empty array of non-empty strings) must not
  // be reported as a cap here either — an empty accounts array enforces nothing upstream, so a posture
  // line calling it a cap would be the same false comfort in a different place. Hand-built rather than
  // minted because mintToken rejects both shapes at issuance, which is why they can only arrive corrupt.
  for (const claim of [[], [""], ["ok", 7]]) {
    const body = Buffer.from(JSON.stringify({ scope: "ops", sub: "portal", accounts: claim, exp: 1 })).toString("base64url");
    const p = opsTokenPosture(`v1.${body}.notachecked signature`);
    assert.equal(p.readable, true, "the payload parses…");
    assert.equal(p.accountCapped, false, `…but accounts=${JSON.stringify(claim)} is not a cap the MCP would enforce`);
  }
});

// ── the deadline nobody was counting ─────────────────────────────────────────────────────────────────

test("THE OPS TOKEN'S EXPIRY IS READ, because nothing else counts it down", () => {
  // This credential is minted with a multi-month TTL and sits in a systemd drop-in. When it lapses,
  // every Start fails — and it fails as an UPSTREAM REFUSAL, which reads like an engine fault, not like
  // an expired key card. The live token when this was written had 90 days left and no countdown
  // anywhere in the system.
  const at = (secs) => {
    const body = Buffer.from(JSON.stringify({ scope: "ops", sub: "portal", verbs: ["start_run"], exp: secs })).toString("base64url");
    return `v1.${body}.sig`;
  };
  const now = 1_800_000_000_000;              // fixed clock — a test that drifts with the date is not a test
  const day = 86_400;
  const inDays = (d) => opsTokenPosture(at(now / 1000 + d * day), { now });

  const healthy = inDays(90);
  assert.equal(healthy.daysLeft, 90);
  assert.equal(healthy.expired, false);
  assert.match(healthy.expiresAt, /^\d{4}-\d{2}-\d{2}T/);

  // The boundary the boot warning fires on. Asserted either side so the threshold cannot drift silently.
  assert.equal(inDays(22).daysLeft, 22, "22 days is quiet");
  assert.equal(inDays(21).daysLeft, 21, "21 days warns");

  const dead = inDays(-1);
  assert.equal(dead.expired, true, "a lapsed token reports as expired rather than as merely small");
  assert.ok(dead.daysLeft < 0);
});

test("AN ABSURD EXPIRY CANNOT TAKE DOWN THE PORTAL", () => {
  // The defect this test exists for, found by adversarial review after a first pass that probed odd
  // `exp` values but none large enough to leave the representable range.
  //
  // `new Date(x).toISOString()` throws RangeError beyond ±8.64e15 ms. opsTokenPosture is called from
  // the BOOTSTRAP with no try/catch around it, and its entire job is decoding an UNVERIFIED, FORGEABLE
  // payload — so one absurd number in a token nobody has verified yet stops the portal starting at all.
  // A credential whose expiry cannot be read must degrade to unknown. It must never be able to kill the
  // service that reads it.
  const mk = (exp) => `v1.${Buffer.from(JSON.stringify({ scope: "ops", sub: "p", exp })).toString("base64url")}.sig`;

  for (const exp of [1.79e15, 8.64e15, Number.MAX_SAFE_INTEGER, -8.64e15, 1e300]) {
    let p;
    assert.doesNotThrow(() => { p = opsTokenPosture(mk(exp)); }, `exp=${exp} must not throw`);
    assert.equal(p.expiresAt, null, `exp=${exp} reports no date rather than an invalid one`);
    assert.equal(p.daysLeft, null);
    assert.equal(p.implausibleExp, true, `exp=${exp} is FLAGGED, not silently swallowed`);
  }

  // A token minted in MILLISECONDS instead of seconds is the realistic version of this. It used to
  // print "expires=+058692-11-03" and no warning at all — reassuring, and wrong.
  const ms = opsTokenPosture(mk(Date.now()));
  assert.equal(ms.implausibleExp, true, "a millisecond exp is implausible, not a date in year 58692");
  assert.equal(ms.expiresAt, null);
});

test("a plausible expiry is still read normally", () => {
  // The guard must not swallow real tokens. The live one when this was written expires 2026-10-18.
  const real = Math.floor(new Date("2026-10-18T09:00:30Z").getTime() / 1000);
  const body = Buffer.from(JSON.stringify({ scope: "ops", sub: "portal-prod", exp: real })).toString("base64url");
  const p = opsTokenPosture(`v1.${body}.sig`, { now: Date.parse("2026-07-20T00:00:00Z") });
  assert.equal(p.implausibleExp, false);
  assert.equal(p.expiresAt.slice(0, 10), "2026-10-18");
  assert.equal(p.daysLeft, 90);
});

test("a token with no expiry claim reports UNKNOWN rather than fine", () => {
  // The dangerous default. A missing `exp` reported as "no expiry" would read as reassuring on the boot
  // line; it means the posture could not be established, which is a different thing.
  const body = Buffer.from(JSON.stringify({ scope: "ops", sub: "portal" })).toString("base64url");
  const p = opsTokenPosture(`v1.${body}.sig`);
  assert.equal(p.expiresAt, null);
  assert.equal(p.daysLeft, null);
  assert.equal(p.expired, false, "unknown is not expired — it must not trigger a false alarm either");
  assert.equal(p.implausibleExp, false, "absent is not the same as nonsensical — only the latter warns");
});

test("an unreadable token carries the expiry fields too, all null", () => {
  // Callers branch on these. Leaving them undefined on the failure path is how a boot line ends up
  // printing "expires=undefined".
  const p = opsTokenPosture("garbage");
  assert.equal(p.readable, false);
  assert.equal(p.expiresAt, null);
  assert.equal(p.daysLeft, null);
  assert.equal(p.expired, false);
});

// ── the queue wiring the counter depends on ────────────────────────────────────────────────────────
//
// serve() is the ONE production line that tells the allowance counter which queues the runner drains
// (`queueDirs: () => config.queueDirs`). Its parameter default is `() => []`, so deleting the line
// degrades silently into "count nothing, report blind" — and every other driver and mcp test still
// passes, because they all construct makePortalService directly and inject their own.
//
// So it is asserted the only way a bootstrap line can be: by starting the real process with a real
// standalone queue, asking it what the account has spent, and checking it answers from the ledger
// rather than from nowhere. This is the deployment shape was found on.

/** An ephemeral port, taken and released — PORT=0 never reaches the log line, so it cannot be read back. */
async function freePort() {
  const { createServer } = await import("node:net");
  return await new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

/**
 * Boot the real service and ask it ONE question. Unlike `boot` above, the child is kept alive past the
 * listening line — the question here is what the running process answers, not whether it got that far.
 */
function bootAndGet(overrides, path, { waitMs = 20000, headers = {} } = {}) {
  // — pinEnvAll writes EVERY spelling of an aliased name, and deletes every spelling for
  // `undefined` — which is what the loop this replaced did for one spelling only.
  const env = pinEnvAll({ ...process.env }, overrides);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SERVICE], { env, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "", asked = false, done = false;
    const finish = (r) => {
      if (done) return;
      done = true; clearTimeout(timer);
      try { child.kill("SIGKILL"); } catch { /* gone */ }
      resolve({ ...r, stderr });
    };
    const timer = setTimeout(() => finish({ status: null, json: null, error: "timed out before an answer" }), waitMs);
    child.stderr.on("data", async (c) => {
      stderr += String(c);
      if (asked || !/listening on/.test(stderr)) return;
      asked = true;
      try {
        const res = await fetch(`http://127.0.0.1:${overrides.PORTAL_SERVICE_PORT}${path}`, { headers });
        finish({ status: res.status, json: await res.json(), error: null });
      } catch (e) { finish({ status: null, json: null, error: String(e?.message ?? e) }); }
    });
    child.on("exit", () => finish({ status: null, json: null, error: "exited before answering" }));
    child.on("error", (e) => finish({ status: null, json: null, error: String(e) }));
  });
}

test("serve() hands the counter the queues the RUNNER drains — the allowance is read, not defaulted (#429)", async () => {
  const port = await freePort();
  // A standalone queue with the ledger beside it: CLEAROTRON_QUEUE_DIR, no agent workspace anywhere. This is
  // the layout that broke the counter, and the layout the product deploys.
  const inst = tempDir("portal-boot-inst-");
  const qdir = join(inst, "queue");
  mkdirSync(qdir, { recursive: true });
  // Stamped now and counted against the service's own now: a UTC midnight landing between the two would
  // move this row out of "today". A sub-millisecond window once a day, recorded rather than engineered
  // around — the wiring assertion below is `complete`, which no clock can move.
  writeFileSync(join(inst, ".matter-ledger.jsonl"),
    JSON.stringify({ profileKey: "aurora", ts: Date.now(), clientPrincipal: true, msgId: "boot-1" }) + "\n");

  // dev@local is a CLIENT: its domain is not in PORTAL_STAFF_DOMAINS, and the roster grants it one account.
  const grantsPath = join(tempDir("portal-boot-grants-"), "grants.json");
  writeFileSync(grantsPath, JSON.stringify({ tenants: { t1: { accounts: ["aurora"], users: { "dev@local": "*" } } } }));

  // — THE REQUEST NOW CARRIES A REAL SESSION, and that is an upgrade rather than a workaround.
  // This used to reach the route on the deleted bypass, which proved nothing about identity because
  // there was none. The cookie below is minted with the SAME PORTAL_SECRET the child is given and names
  // the SAME address the roster grants, so the answer it gets is proof that a local sign-in resolves a
  // principal and reads a scoped route over a real socket — the whole, end to end, in the test
  // that was already booting the real process.
  const session = mintSession({ email: "dev@local", secret: BOOT_SECRET });
  const r = await bootAndGet(
    bootEnv({ CLEAROTRON_ACCESS_FILE: grantsPath, CLEAROTRON_QUEUE_DIR: qdir, PORTAL_SERVICE_PORT: String(port) }),
    "/portal/api/usage?account=aurora",
    { headers: { cookie: `portal_session=${session}`, accept: "application/json" } });

  assert.equal(r.error, null, `the portal never answered: ${r.error}\n${r.stderr}`);
  assert.equal(r.status, 200, `expected an answer; got ${r.status}\n${JSON.stringify(r.json)}`);
  assert.equal(r.json.complete, true,
    "the booted portal counted from NOWHERE — serve() is not handing config.queueDirs to makePortalService");
  assert.equal(r.json.today, 1, "the ledger beside the configured queue was not the one it read");
});

test("#769 the same request WITHOUT the cookie is refused by the booted service", async () => {
  // The control for the test above: its 200 is bought by the session, not by a door that lets anything
  // through. Same process, same route, same account — no cookie.
  const port = await freePort();
  const grantsPath = join(tempDir("portal-boot-grants-"), "grants.json");
  writeFileSync(grantsPath, JSON.stringify({ tenants: { t1: { accounts: ["aurora"], users: { "dev@local": "*" } } } }));

  const r = await bootAndGet(
    bootEnv({ CLEAROTRON_ACCESS_FILE: grantsPath, PORTAL_SERVICE_PORT: String(port) }),
    "/portal/api/usage?account=aurora", { headers: { accept: "application/json" } });

  assert.equal(r.error, null, `the portal never answered: ${r.error}\n${r.stderr}`);
  assert.equal(r.status, 401, `a signed-out request must be refused; got ${r.status} ${JSON.stringify(r.json)}`);
  assert.deepEqual(r.json, { error: "not signed in" });
});

// ── item 1 — ANY LOGIN PROVIDER, NOT ONLY CLOUDFLARE ────────────────────────────────────────
//
// The portal shipped a Cloudflare-only door while the staff MCP face twenty files away was already
// provider-agnostic. These arms pin the four behaviours that change and the two that must NOT.

/** cfEnv, minus the Cloudflare team — the shape a non-Cloudflare deployment actually has. Built on the
 *  existing helper so these arms inherit PORTAL_SECRET and the rest of a valid environment rather than
 *  re-deriving one and drifting from it. */
const proxyEnv = (extra = {}) => cfEnv({
  CF_ACCESS_TEAM: undefined,
  PORTAL_OIDC_ISSUER: undefined, PORTAL_JWKS_URL: undefined,
  PORTAL_EMAIL_CLAIM: undefined, PORTAL_AUTH_HEADER: undefined,
  CLEAROTRON_ACCESS_FILE: grantsFile(),
  ...extra,
});

test("#1440-1 an ISSUER with no Cloudflare team STARTS — the deployment that could not start at all", async () => {
  // The whole point of the item. Before this, the boot guard demanded CF_ACCESS_TEAM *and*
  // CLEAROTRON_OIDC_AUDIENCE, so somebody self-hosting behind Entra could wire the API face and not the portal —
  // the half their users actually open.
  const r = await boot(proxyEnv({ PORTAL_OIDC_ISSUER: "https://login.example.test/v2.0" }));
  assert.equal(r.listened, true, `an issuer without a CF team must start; stderr:\n${r.stderr.slice(0, 700)}`);
});

test("#1440-1 …and missing BOTH a team and an issuer is still FATAL — the half that must not soften", async () => {
  const r = await boot(proxyEnv());
  assert.equal(r.listened, false, "auth with no identity source at all must refuse to start");
  assert.match(r.stderr, /FATAL/);
  assert.match(r.stderr, /CF_ACCESS_TEAM or PORTAL_OIDC_ISSUER/,
    "the refusal must name BOTH ways to satisfy it, or an operator cannot act on it");
});

test("#1440-1 the banner names the issuer, the claim and the HEADER actually in use", async () => {
  // A mis-set header is otherwise indistinguishable from a blanket 401 with a valid token in hand.
  const r = await boot(proxyEnv({ PORTAL_OIDC_ISSUER: "https://login.example.test/v2.0",
    PORTAL_EMAIL_CLAIM: "preferred_username", PORTAL_AUTH_HEADER: "X-Id-Token" }));
  assert.match(r.stderr, /issuer=https:\/\/login\.example\.test\/v2\.0/);
  assert.match(r.stderr, /claim=preferred_username/);
  // LOWERCASED. Node lowercases incoming header names, so a verbatim `X-Id-Token` would key nothing and
  // refuse every correctly authenticated user. The banner is where that becomes visible.
  assert.match(r.stderr, /header=x-id-token/, "the header must be lowercased before use, and shown lowercased");
  assert.doesNotMatch(r.stderr, /header=X-Id-Token/);
});

test("#1440-1 `cf-access` still boots and means the same thing — no deployment has to be edited", async () => {
  const r = await boot(proxyEnv({ PORTAL_AUTH_MODE: "cf-access", CF_ACCESS_TEAM: "someteam" }));
  assert.equal(r.listened, true, `the old mode word must keep working forever; stderr:\n${r.stderr.slice(0, 700)}`);
});

test("#1440-1 `auth-proxy` is the mode's name now, and an unknown word is still FATAL", async () => {
  const ok = await boot(proxyEnv({ PORTAL_AUTH_MODE: "auth-proxy", CF_ACCESS_TEAM: "someteam" }));
  assert.equal(ok.listened, true, `auth-proxy must boot; stderr:\n${ok.stderr.slice(0, 700)}`);

  const bad = await boot(proxyEnv({ PORTAL_AUTH_MODE: "cf-acess", CF_ACCESS_TEAM: "someteam" }));
  assert.equal(bad.listened, false, "a typo must never fall through to a default door");
  // ECHOES WHAT WAS SET, not the normalised value — an operator has to see their own typo back.
  assert.match(bad.stderr, /PORTAL_AUTH_MODE="cf-acess"/);
});

test("#1440-1 the UNION identity mode survives the refactor — it is load-bearing, not incidental", () => {
  // This population is a staff DOMAIN plus individually named CLIENT addresses. The verifier's default
  // combines the two lists with AND, which locked out every identity in production — staff failing the
  // email list while clients failed the domain list. A source assertion because the failure it prevents
  // is a runtime lockout of everyone, and no boot test can see the flag's value.
  const src = readFileSync(SERVICE, "utf8");
  const call = /makeAccessVerifier\(\{[\s\S]{0,400}?\}\)/.exec(src)?.[0] ?? "";
  assert.ok(call, "the makeAccessVerifier call is no longer shaped the way this arm reads it");
  assert.match(call, /identityMode:\s*"union"/, "identityMode:'union' was dropped — that locked out every user once");
  assert.match(call, /issuer:/, "the issuer is not passed through, so a non-Cloudflare provider cannot be configured");
  assert.match(call, /jwksUrl:/);
  assert.match(call, /emailClaim:/);
  assert.doesNotMatch(call, /allowAnyDomain/, "the portal must never pass allowAnyDomain — fail-closed is the point");
});
