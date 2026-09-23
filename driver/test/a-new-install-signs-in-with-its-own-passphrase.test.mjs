// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A NEW INSTALL SIGNS IN WITH ITS OWN PASSPHRASE, AND A DEMO ALWAYS HAS A WAY IN.
//
// Every install used to sign in with one shared file under the operator's home. An install made on a
// machine that had held another adopted that install's digest, and its first start told the person who had
// just installed that the passphrase "was minted on an earlier start and is NOT reprinted": no passphrase,
// and no way to learn one. A demo re-run on a machine where an earlier demo had left its credential did the
// same to a visitor. Both reported from real machines, 2026-09-10.
//
// What decides the file is `installCredential`, which `clearotron start` and `clearotron passphrase` both
// ask, so the file the verb resets is the file the portal reads. What a start that minted nothing says is
// `laterStartLines`, and the way back in is its first line.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  installCredential, defaultInstallBase, laterStartLines, demoCredentialToReplace,
  establishCredential, credentialPathFor, passphraseResetCommand, INSTALL_CREDENTIAL_FILE,
} from "../portal-local-auth.mjs";
import { withFreePorts, saidPortWasTaken } from "./helpers/free-port.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const VERB = join(REPO, "bin", "passphrase.mjs");

// ── THE DECISION, DRIVEN OVER EVERY SHAPE ──────────────────────────────────────────────────────────

test("which credential an install signs in with, over every shape it can meet", () => {
  const base = "/srv/op/trademark", own = join(base, INSTALL_CREDENTIAL_FILE);
  const shared = credentialPathFor({}, "/srv/op");
  const on = (...present) => (p) => present.includes(p);
  const ask = (o) => installCredential({ base, home: "/srv/op", env: {}, firstStart: false, exists: on(), ...o });

  assert.deepEqual(ask({ env: { PORTAL_LOCAL_CREDENTIAL: "/srv/mine.json" }, exists: on(own, shared) }),
    { path: "/srv/mine.json", source: "configured" }, "the operator's own setting wins over everything");
  assert.deepEqual(ask({ exists: on(own, shared) }), { path: own, source: "install" },
    "an install that has its own file signs in with it, whatever the shared file holds");
  assert.deepEqual(ask({ firstStart: true, exists: on(shared) }), { path: own, source: "install" },
    "THE REPORTED CASE: a first start on a machine where another install left the shared file mints its own");
  assert.deepEqual(ask({ exists: on(shared) }), { path: shared, source: "shared" },
    "an install that has started before and signs in with the shared file keeps it: moving it locks out its operator");
  assert.deepEqual(ask({ exists: on() }), { path: own, source: "install" },
    "with no shared file to keep, there is nothing to protect, and the install gets its own");
});

test("the install's own file is the one installPaths names, and the verb's default install is start's", async () => {
  const { installPaths, defaultGrantsPath } = await import("../../bin/start.mjs");
  for (const b of ["/srv/a/trademark", "/srv/x/elsewhere"])
    assert.equal(installCredential({ base: b, env: {}, firstStart: true }).path, installPaths(b).credential,
      "the file start chooses and the file the install's layout names must be one file");
  // Driven against start's own default rather than a shared literal: the verb and start must name the same
  // install when neither is told which.
  assert.equal(installPaths(defaultInstallBase()).grants, defaultGrantsPath({ env: {} }));
  assert.equal(installPaths(defaultInstallBase({ demo: true })).grants, defaultGrantsPath({ env: {}, demo: true }));
});

// ── WHAT A START THAT MINTED NOTHING SAYS ───────────────────────────────────────────────────────────

test("a later start names the way back in first, then which file, when and for whom", () => {
  const record = { email: "op@localhost", createdAt: "2026-08-21T09:14:00.000Z" };
  const reset = "clearotron passphrase --reset";

  const shared = laterStartLines({ user: "op@localhost", reset, credentialPath: "/h/.cordillera/portal-local-credential.json", source: "shared", record });
  assert.match(shared[0], /^  Sign in as op@localhost\. No passphrase for it\? Run  clearotron passphrase --reset  to mint a new one/,
    "the recovery command must be the FIRST thing said — it used to be the last words of the paragraph");
  const s = shared.join("\n");
  assert.match(s, /shared credential \/h\/\.cordillera\/portal-local-credential\.json \(created 2026-08-21, for op@localhost\)/,
    "a reused credential must say which file, when it was written and for whom");
  assert.match(s, /an earlier install on this machine may have written it/, "and that it may not be this install's");
  assert.match(s, /minted on an earlier start and is NOT reprinted/);

  const own = laterStartLines({ user: "op@localhost", reset, credentialPath: "/h/trademark/portal-local-credential.json", source: "install", record }).join("\n");
  assert.match(own, /Its credential is \/h\/trademark\/portal-local-credential\.json \(created 2026-08-21\)/);
  assert.doesNotMatch(own, /shared|earlier install/, "an install's own file is not described as somebody else's");

  const undated = laterStartLines({ user: "op@localhost", reset, credentialPath: "/x", source: "install" }).join("\n");
  assert.match(undated, /no creation date recorded/, "a record with no date says so rather than printing nothing");
});

// ── THE DEMO ──────────────────────────────────────────────────────────────────────────────────────

test("a demo replaces only its own credential, and only the demo's address", () => {
  const dir = mkdtempSync(join(tmpdir(), "demo-cred-"));
  try {
    const own = join(dir, INSTALL_CREDENTIAL_FILE);
    establishCredential({ path: own, email: "demo@localhost", passphrase: "an earlier demo's passphrase" });
    assert.equal(demoCredentialToReplace({ path: own, ownPath: own, user: "demo@localhost" }), own,
      "THE REPORTED CASE: an earlier demo's credential is replaced, so this demo mints and prints one that works");
    assert.equal(demoCredentialToReplace({ path: own, ownPath: own, user: "someone@localhost" }), null,
      "a credential for another address is not the demo's to replace");
    assert.equal(demoCredentialToReplace({ path: own, ownPath: join(dir, "elsewhere.json"), user: "demo@localhost" }), null,
      "a credential anywhere but the demo's own file is left where it is");
    const broken = join(dir, "broken", INSTALL_CREDENTIAL_FILE);
    mkdirSync(dirname(broken));
    writeFileSync(broken, "{ not json");
    assert.equal(demoCredentialToReplace({ path: broken, ownPath: broken, user: "demo@localhost" }), null,
      "one that cannot be read is left for the portal's boot to name");
    assert.equal(demoCredentialToReplace({ path: join(dir, "absent.json"), ownPath: join(dir, "absent.json"), user: "demo@localhost" }), null,
      "and an absent one needs nothing replaced");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── THE WIRING IN `clearotron start` ─────────────────────────────────────────────────────────────

test("start reads its first-start signal before it writes either file, and asks installCredential once", () => {
  const src = readFileSync(join(REPO, "bin", "start.mjs"), "utf8");
  const signal = src.indexOf(`const firstStartOfThisInstall = !existsSync(paths.grants) && !existsSync(join(paths.configStore, ".git"));`);
  assert.ok(signal > 0, "the first-start signal is gone");
  for (const [what, at] of [["the grants write", src.indexOf("atomicWrite(paths.grants,")],
    ["the config store's git init", src.indexOf(`execFileSync("git", ["-C", paths.configStore, "init"`)]])
    assert.ok(at > signal, `${what} now comes before the signal, so a first start reads as a later one`);
  assert.equal(src.split("installCredential(").length - 1, 1, "one decision, made once");
  assert.match(src, /installCredential\(\{[^}]*firstStart: firstStartOfThisInstall/,
    "the first-start signal must reach the decision, or a first start adopts the shared file again");
  assert.match(src, /credential: signIn && signIn\.source !== "shared" \? signIn\.path : null/,
    "the decision must reach the portal's environment, and the shared default must be left to its own default");
  const capture = src.indexOf("const credentialExisted = existsSync(");
  const demo = src.indexOf("demoCredentialToReplace({");
  assert.ok(demo > 0 && demo < capture, "the demo's replacement must come before the capture that decides whether to mint");
});

// ── THE VERB, DRIVEN AT ITS OWN DOOR ─────────────────────────────────────────────────────────────

function verb(home, ...args) {
  const r = spawnSync(process.execPath, [VERB, ...args], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home } });
  // The reset prints a passphrase; nothing below puts raw output into a message.
  return { code: r.status, out: String(r.stdout ?? ""), err: String(r.stderr ?? "") };
}

test("`clearotron passphrase` reports and resets the credential the install's portal reads", () => {
  const home = mkdtempSync(join(tmpdir(), "verb-home-"));
  try {
    const shared = join(home, ".cordillera", INSTALL_CREDENTIAL_FILE);
    const own = join(home, "trademark", INSTALL_CREDENTIAL_FILE);
    establishCredential({ path: shared, email: "earlier@localhost", passphrase: "an earlier install's" });

    let r = verb(home);
    assert.equal(r.code, 0);
    assert.ok(r.out.includes(`credential: ${shared}`) && /the shared default/.test(r.out),
      "with no credential of its own, the install signs in with the shared file, and the verb says so");

    establishCredential({ path: own, email: "op@localhost", passphrase: "this install's" });
    r = verb(home);
    assert.ok(r.out.includes(`credential: ${own}`) && /this install's own/.test(r.out),
      "once the install has its own file, that is the one reported — not the shared file another install wrote");

    const sharedBefore = readFileSync(shared, "utf8");
    const ownBefore = readFileSync(own, "utf8");
    r = verb(home, "--reset");
    assert.equal(r.code, 0, "the reset must succeed");
    assert.notEqual(readFileSync(own, "utf8"), ownBefore, "the reset must rewrite the install's own file");
    assert.equal(readFileSync(shared, "utf8"), sharedBefore, "and must leave the shared file another install uses untouched");

    const elsewhere = join(home, "elsewhere");
    establishCredential({ path: join(elsewhere, INSTALL_CREDENTIAL_FILE), email: "op@localhost", passphrase: "moved" });
    r = verb(home, "--base", elsewhere);
    assert.ok(r.out.includes(`credential: ${join(elsewhere, INSTALL_CREDENTIAL_FILE)}`), "--base names the install, as it does for start");
    assert.match(r.out, /--reset --base /, "and the command it offers carries the same --base");

    assert.equal(verb(home, "--base").code, 2, "--base with no directory is refused, not read as the default");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

// ── THE PRINTED RECOVERY LINE, RUN AS PRINTED ───────────────────────────────────────────────────────
//
// Printed from a checkout the line was `PORTAL_LOCAL_CREDENTIAL=<file> cd <repo> && npx clearotron …`, and
// a POSIX shell binds that assignment to `cd`: the verb ran without it and reset the shared file instead.
// So the line is run through a real shell here, with a directory change in front, and the arm reads which
// file was rewritten. `clearotron` is replaced by this tree's verb only because no package is installed.

test("the recovery line runs as printed, directory change and all, and resets the file it names", { skip: process.platform === "win32" }, () => {
  const home = mkdtempSync(join(tmpdir(), "reset-line-"));
  try {
    const shared = join(home, ".cordillera", INSTALL_CREDENTIAL_FILE);
    establishCredential({ path: shared, email: "earlier@localhost", passphrase: "an earlier install's" });
    const run = (line) => spawnSync("sh", ["-c", line.replace("clearotron passphrase", `${JSON.stringify(process.execPath)} ${JSON.stringify(VERB)}`)],
      { encoding: "utf8", env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home } });
    const cases = [
      ["an install's own file, in a directory other than the default", join(home, "elsewhere", INSTALL_CREDENTIAL_FILE)],
      ["an operator's own file", join(home, "ops", "creds.json")],
    ];
    for (const [what, file] of cases) {
      establishCredential({ path: file, email: "op@localhost", passphrase: "the current one" });
      const before = readFileSync(file, "utf8"), sharedBefore = readFileSync(shared, "utf8");
      const line = passphraseResetCommand({ prefix: `cd ${home} && `, credentialPath: file, home });
      const r = run(line);
      assert.equal(r.status, 0, `${what}: the printed line did not run (exit ${r.status})`);
      assert.notEqual(readFileSync(file, "utf8"), before, `${what}: the printed line did not reset the file it names`);
      assert.equal(readFileSync(shared, "utf8"), sharedBefore, `${what}: the printed line reset the shared file instead`);
    }
  } finally { rmSync(home, { recursive: true, force: true }); }
});

// ── THE REPORTED CASE, AT ITS OWN DOOR: A REAL FIRST START ──────────────────────────────────────────
//
// A machine where another install left the shared credential, and a new install that has never started.
// This runs the real `clearotron start` in a throwaway home, reads what it wrote, and stops it. The
// passphrase it prints is never put into a message here.

// THE FRAME'S PASSPHRASE LINE: 24 base64url characters, and the line ends where the passphrase does. Not `\b`:
// a passphrase whose last character is `-` has no word boundary after it, and one in 64 ends that way, so a
// `\b` here failed this test one run in 64 while the frame had handed the passphrase over (measured on two
// failing runs, 2026-09-10). The lookahead says what was meant: no further passphrase character follows.
const FRAME_PASSPHRASE = /│  Passphrase  [A-Za-z0-9_-]{24}(?![A-Za-z0-9_-])/;

test("the frame's passphrase pattern holds for a passphrase ending in any base64url character", () => {
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  assert.equal(new Set(ALPHABET).size, 64, "the alphabet is base64url's own 64 characters");
  for (const last of ALPHABET) {
    assert.match(`  │  Passphrase  ${"a".repeat(23)}${last}\n`, FRAME_PASSPHRASE, `a passphrase ending in "${last}" was not recognised`);
  }
  assert.doesNotMatch(`  │  Passphrase  ${"a".repeat(25)}\n`, FRAME_PASSPHRASE, "a value longer than a passphrase was taken for one");
  assert.doesNotMatch(`  │  Passphrase  ${"a".repeat(23)}\n`, FRAME_PASSPHRASE, "a value shorter than a passphrase was taken for one");
});

test("the frame's line breaker keeps every line within the width and never splits a word", async () => {
  const { fitTo } = await import("../../bin/start.mjs");
  const sentence = "The passphrase is NOT printed here: stdout is not a terminal, so this line would outlive the moment \u2014 a journal, a CI log, or a test's captured output.";
  const out = fitTo(64, sentence);
  assert.ok(out.length > 1, "a sentence longer than the width must be broken");
  for (const l of out) assert.ok(l.length <= 64, `longer than the width: ${l}`);
  assert.equal(out.join(" "), sentence, "breaking at spaces must not change a single word");
  assert.deepEqual(fitTo(10, "averyveryverylongword x"), ["averyveryverylongword", "x"], "a word wider than the line keeps its own line");
  assert.deepEqual(fitTo(64, ""), []);
});

test("a real first start, where another install left the shared credential, mints its own and leaves that one alone", { timeout: 120000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), "first-start-"));
  const shared = join(home, ".cordillera", INSTALL_CREDENTIAL_FILE);
  const stop = async ({ child, closed }) => {
    child.kill("SIGINT");
    await Promise.race([closed, new Promise((r) => setTimeout(r, 20000))]);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  };
  // Ports free at the moment it starts, and nothing inherited: the store, the pool and the credential all
  // land under `home`. Not fixed ports: a port something else holds would red this test for a reason that
  // has nothing to do with its name. `start` refuses port 0 itself, so the ports are picked here.
  //
  // Free when read is not free when a door binds, so the start runs under `withFreePorts`: one that never
  // reached its summary and said a port was taken is stopped, `home` is emptied, and a fresh first start
  // runs on fresh numbers, the shared credential planted again first.
  const firstStart = async (ports) => {
    establishCredential({ path: shared, email: "op@localhost", passphrase: "an earlier install's" });
    const sharedBefore = readFileSync(shared, "utf8");
    const child = spawn(process.execPath, [join(REPO, "bin", "start.mjs"), "--no-worker"], {
      env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, CLEAROTRON_NO_ENV_FILE: "1", PORTAL_LOCAL_USER: "op@localhost",
        PORTAL_SERVICE_PORT: String(ports.portal), TRADEMARK_MCP_HTTP_PORT: String(ports.mcp),
        CLIENT_MCP_HTTP_PORT: String(ports.client) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let said = "";
    child.stdout.on("data", (c) => { said += c; });
    child.stderr.on("data", (c) => { said += c; });
    // `close`, not `exit`: it fires once the output is read to the end.
    const closed = new Promise((resolve) => child.on("close", resolve));
    const deadline = Date.now() + 90000;
    while (!/Sign in as/.test(said) && child.exitCode === null && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
    if (child.exitCode !== null) await closed;
    return { child, closed, sharedBefore, said: () => said };
  };
  const run = await withFreePorts(["portal", "mcp", "client"], firstStart, {
    busy: (r) => !/Sign in as/.test(r.said()) && saidPortWasTaken(r),
    discard: async (r) => { await stop(r); rmSync(home, { recursive: true, force: true }); mkdirSync(home); },
  });
  const { sharedBefore } = run;
  const said = run.said();
  try {
    assert.match(said, /Sign in as/, "start never reached its sign-in summary, so nothing below would be measured");
    assert.ok(existsSync(join(home, "trademark", INSTALL_CREDENTIAL_FILE)),
      "THE REPORTED CASE: the first start did not mint the install's own credential, so it adopted the shared one");
    assert.equal(readFileSync(shared, "utf8"), sharedBefore, "the first start changed the shared credential another install uses");
    // HANDED OVER ONLY ON A TERMINAL. This start's output is a pipe, the shape of a service manager's
    // journal or a `> start.log`, so the frame must withhold the value and say how to mint one where it
    // can be seen. It used to print it here, into exactly the log the portal's own line kept it out of.
    assert.doesNotMatch(said, FRAME_PASSPHRASE, "the frame printed the new passphrase into output that is not a terminal");
    assert.doesNotMatch(said, /PASSPHRASE: \S/, "the portal printed the new passphrase into output that is not a terminal");
    assert.match(said, /│  The passphrase is NOT printed here: stdout is not a terminal/,
      "the frame must say the passphrase was withheld, and why");
    assert.match(said, /│    \S*.*passphrase --reset/, "and name the command that mints one on a terminal");
    // INSIDE THE FRAME. The withheld sentences come from the portal's composer, written for a log line,
    // and ran twice the width of the rule drawn around them until they were broken to it.
    const lines = said.split("\n");
    const from = lines.findIndex((l) => /│  Sign in as/.test(l));
    const to = lines.findIndex((l, i) => i > from && /^  │    \S/.test(l));
    const withheld = lines.slice(from + 1, to);
    assert.ok(from >= 0 && withheld.length >= 2, `the withheld lines were not found between the sign-in line and the reset command:\n${lines.slice(from, from + 8).join("\n")}`);
    for (const l of withheld) assert.ok(l.length <= "  │  ".length + 64, `a withheld line runs past the frame's width: ${l}`);
    assert.doesNotMatch(said, /minted on an earlier start/, "a first start must not claim an earlier one");
  } finally {
    await stop(run);
    rmSync(home, { recursive: true, force: true });
  }
});
