// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// a remedy whose only route is a command its reader cannot run.
//
// `clearotron start --background`, engine values unset, ended: "Set these where this command can see
// them — `clearotron install` writes them". Both halves fail the one reader who gets here. This product
// has two environment files with different jobs and the sentence named neither; and `install` is an
// interactive wizard that REFUSES a non-terminal, which is exactly what a scripted or hosted install is.
// The last arm here drives that refusal rather than quoting it, because the whole issue rests on it.
//
// THE INVARIANT IS AGREEMENT WITH WHAT THIS PROCESS READ, not the presence of a path — the same
// invariant established for the port refusals, and the reason both sites take the
// path from `envFileRead()` instead of composing one. A service started by systemd reads its
// EnvironmentFile and no file of its own, and naming the CLI's file there would replace a vague address
// with a wrong one. That branch is planted, not reasoned about.
//
// AND THE CLASS IS TWO SITES ON ONE SCREEN. The pool-root refusal that `--background` prints as a
// warning carried the same defect — `install` as its entire remedy — and is checked here beside the one
// the issue was filed against, in both branches. An arm that watched only the site named in the issue
// would be green through the same defect two lines higher up.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { handRunEnv, assertReadItsEnvFile } from "./drive-env.mjs";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");
const START = join(ROOT, "bin", "start.mjs");
const ONBOARD = join(ROOT, "bin", "onboard.mjs");

/** An ephemeral port, taken and released — this drive must get PAST the port probe to reach its subject. */
async function freePort() {
  return await new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

/**
 * Drive the REAL command into its missing-values refusal, in a HOME of its own.
 *
 * State IS written before this refusal — the env file, the data directories, the grants roster — which
 * is the evidence the issue turns on: at the moment it declines to name a file, this run has just
 * written one. Everything it writes is under `home`, and `clean()` removes it.
 */
function driveStart(ports, extra = {}) {
  const home = mkdtempSync(join(tmpdir(), "ct202-"));
  mkdirSync(join(home, ".config", "clearotron"), { recursive: true });
  const envFile = join(home, ".config", "clearotron", ".env");
  // A file with something real in it, so the loader has a variable to report applying. The three engine
  // values are NOT here: their absence is this drive's subject.
  //
  // THE PORTS GO IN THE ENVIRONMENT, NOT IN THIS FILE, and the first version of this had them in the
  // file — which worked for the drive that reads it and sent the opted-out drive into a collision with
  // whatever holds the built-in 18802 on the machine running the suite. Both arms about the opted-out
  // branch failed saying "this drive met a PORT collision", which is what that guard is for. A drive
  // whose two branches differ in whether a file is read cannot take anything it needs in both from
  // that file.
  writeFileSync(envFile, "PORTAL_LOCAL_USER=drive@localhost\n");
  // A hand-run environment from the one definition: `handRunEnv` clears CLEAROTRON_NO_ENV_FILE and
  // INVOCATION_ID, either of which would make this drive read no .env and take built-in defaults with
  // no error, and `extra` lands after it so the arm ABOUT the service-managed path sets one back
  // deliberately. The engine values go with them: a developer's shell or a CI
  // secret carrying one would clear the refusal, and the arms would measure a run that never refused.
  const env = handRunEnv({ HOME: home, PORTAL_SERVICE_PORT: String(ports.portal),
    TRADEMARK_MCP_HTTP_PORT: String(ports.mcp), CLIENT_MCP_HTTP_PORT: String(ports.client),
    CLEAROTRON_DATABASE: undefined, CLEAROTRON_AI: undefined, CLEAROTRON_CLAUDE_PATH: undefined,
    CLEAROTRON_REPORTS_DIR: undefined,
    ...extra });
  const r = spawnSync(process.execPath, [START, "--background"],
    { encoding: "utf8", timeout: 180_000, env });
  return { home, envFile, homeEnv: join(home, ".env"), said: `${r.stdout ?? ""}${r.stderr ?? ""}`,
    code: r.status, clean: () => rmSync(home, { recursive: true, force: true }) };
}

/**
 * Did this drive reach its subject at all? Asked BEFORE anything about wording.
 *
 * Two ways it could not, and they read as different failures than the one they are. A held port sends
 * the command into the PORT refusal, which names a file correctly and would look like a pass to a
 * loose assertion; and a run that cleared the requirements never refuses at all. Either is a
 * could-not-look, and it has to say so in those words.
 */
function reachedTheRefusal(d) {
  assert.ok(!/cannot start — 127\.0\.0\.1:\d+ is already in use/.test(d.said),
    `this drive met a PORT collision and never reached the missing-values refusal these arms are about — `
    + `nothing below could be measured:\n${d.said.slice(0, 900)}`);
  // THE SUBJECT MOVED FROM A REFUSAL TO AN ANNOUNCEMENT, on the same screen. An
  // install now comes up without these values (owner ruling 2026-09-06) and every run is refused at order
  // time instead, so what proves this drive reached its subject is the announcement naming them.
  //
  // STILL A POSITIVE CHECK, and that is the whole job of this function: without it every assertion below
  // would pass over a drive that printed nothing at all, which is how "the arms are green" comes to mean
  // "the arms never looked".
  assert.ok(/This install is not configured to run a search yet/.test(d.said),
    `this drive never announced the missing values, so there was nothing here to read:\n${d.said.slice(0, 900)}`);
  return d.said;
}

/**
 * The REMEDY BLOCK alone — from "Nothing has been installed" to the end of the refusal.
 *
 * Scoped rather than searching the whole screen, and the scope is the point. This run WRITES the CLI's
 * env file on its way here and says so ("wrote PORTAL_SECRET, … to <path>"), so a whole-screen search
 * for that path finds it whatever the remedy says — and the opted-out arm below, which must find it
 * ABSENT, failed on that write line rather than on anything a reader is told to do. A "names the file"
 * assertion satisfied by a line that is not the remedy is the false pass this arm exists to catch.
 */
function remedy(said) {
  // ── WHERE THIS BLOCK LIVES NOW ─────────────────────────────────────────────────────────────────────
  //
  // These values used to REFUSE the start, and this scoper opened at "Nothing has been installed". The
  // owner ruled on 2026-09-06 that an install comes up without them and every run is refused at ORDER
  // time instead, so `start --background` no longer refuses over them at all — it announces them, on the
  // same screen, with the same remedy, composed by the same function.
  //
  // THE ARMS WERE RE-POINTED RATHER THAN DELETED, and the distinction matters. 202's property is that a
  // message about a value names the file that sets it, and that property is not about which gate printed
  // the message. Deleting these would have retired a live guard because its subject moved one screen.
  //
  // `lastIndexOf`, not `indexOf`: this phrase can appear in the refusal above on a run that reaches
  // both, and the announcement is the one being measured.
  const from = said.lastIndexOf("Nothing has been installed");
  assert.notEqual(from, -1, `no remedy block in this output:\n${said.slice(0, 900)}`);
  // BOUNDED AT BOTH ENDS, and this file's own history is why: an unbounded window here already lied
  // once, running off the end of one message and into the next so a reverted site stayed green. The
  // announcement ends where the narrowing warnings begin, and everything after it — including the
  // two-environment-files explainer, which names the CLI's path legitimately — belongs to other
  // messages. An arm that read those would report a remedy naming a file the remedy never named.
  const ends = [said.indexOf("\n  ⚠ ", from), said.indexOf("This run had already written state", from)]
    .filter((i) => i !== -1);
  const to = ends.length ? Math.min(...ends) : -1;
  return said.slice(from, to === -1 ? undefined : to);
}

/**
 * The POOL-ROOT WARNING alone — the one line, bounded at both ends.
 *
 * BOUNDED BECAUSE AN UNBOUNDED WINDOW ALREADY LIED. This took `said.slice(indexOf(…))` and read the
 * first 1200 characters of it, which runs off the end of the warning and into the refusal below — so
 * reverting the pool-root site to its wizard-only text left this arm GREEN, matching the CLI's path in
 * the OTHER site's remedy. The plant that was supposed to prove the arm proved the arm instead. One
 * line, ended where the product ends it.
 */
function poolWarning(said) {
  const m = /the configuration snapshot could not be written \((.*)\)\.$/m.exec(said);
  assert.ok(m,
    `this drive never printed the pool-root warning, so there was nothing here to measure:\n`
    + said.slice(0, 900));
  return m[1];
}

/** The file this process reports READING, taken off its own loader line — never composed by this test. */
function readItsEnvFile(d) {
  return assertReadItsEnvFile(d.said, d.envFile);
}

let PORTS = null;
let READ = null;      // a drive that read its own .env
let UNREAD = null;    // the same drive, opted out of .env files

test.before(async () => {
  PORTS = { portal: await freePort(), mcp: await freePort(), client: await freePort() };
  READ = driveStart(PORTS);
  UNREAD = driveStart(PORTS, { CLEAROTRON_NO_ENV_FILE: "1" });
});
test.after(() => { READ?.clean(); UNREAD?.clean(); });

test("202 the refusal names the file this command actually read, and that file is the one it reported reading", () => {
  const block = remedy(reachedTheRefusal(READ));
  const file = readItsEnvFile(READ);
  assert.ok(block.includes(file), `the refusal named no path this command read. It said:\n${block}`);
});

test("202 it names the units' file too, because at THIS site a value set there also reaches the check", () => {
  const said = reachedTheRefusal(READ);
  // Not the issue's proposed sentence, and this arm is why. That text — "`~/.env` is loaded by the
  // units and is not read here" — is true at the port refusals and FALSE here: `start --background`
  // reads `~/.env` into `already` and merges it into what it checks, so a value set there clears this
  // refusal on the next run. Shipping the proposed wording would have replaced a vague sentence with a
  // confident wrong one.
  assert.ok(remedy(said).includes(READ.homeEnv),
    `the refusal did not name ${READ.homeEnv}:\n${remedy(said)}`);
  assert.notEqual(READ.homeEnv, READ.envFile,
    "the two files resolved to the same path, so 'both are named' proves nothing about either");
});

test("202 the sentence that named no file is gone", () => {
  const said = reachedTheRefusal(READ);
  assert.ok(!/Set these where this command can see them/.test(said),
    `the refusal still tells the reader to set them "where this command can see them" — the one thing `
    + `they cannot work out, and the reason this issue exists:\n${said.slice(0, 900)}`);
});

test("202 `install` is still offered, and is described as the terminal-only route it is", () => {
  const block = remedy(reachedTheRefusal(READ));
  assert.ok(/clearotron install/.test(block),
    "the wizard is the right primary remedy for an operator at a terminal and must not have been dropped");
  assert.match(block.replace(/\s+/g, " "), /interactive wizard and refuses when stdin is not one/,
    `the offer does not say the wizard refuses a non-terminal, so a scripted install still reads it as a `
    + `route it has:\n${block}`);
});

test("202 a command that read no env file of its own names none — it does not compose one", () => {
  // THE PLANT FOR THE OTHER BRANCH. `envFileRead()` exists so a systemd-started service, configured by
  // its EnvironmentFile, names nothing rather than naming the CLI's file. CLEAROTRON_NO_ENV_FILE=1 is
  // the same state reached the other way, and it is the state this suite's own runner puts children in.
  const block = remedy(reachedTheRefusal(UNREAD));
  assert.ok(!block.includes(UNREAD.envFile),
    `this command read no environment file and named one anyway — a wrong address in place of a vague `
    + `one, which is the failure envFileRead() was written to make impossible:\n${block}`);
  assert.ok(block.includes(UNREAD.homeEnv),
    `it named no file at all. The units' file is still an honest address here and must be given:\n${block}`);
});

test("202 the pool-root refusal on the same screen names the file too — the class is not one site", () => {
  // THE DIFFERENT MEMBER. This message comes from `driver.config.mjs`, not from `start`, and reaches
  // this screen as a warning two lines above the refusal the issue names. It offered `install` and
  // nothing else, so its reader had the identical dead end.
  const warn = poolWarning(reachedTheRefusal(READ));
  assert.ok(warn.includes(READ.envFile),
    `the pool-root refusal still offers only the wizard, which its reader here cannot run:\n${warn}`);
});

test("202 and it names none of its own when the process read no file", () => {
  const warn = poolWarning(reachedTheRefusal(UNREAD));
  assert.ok(!warn.includes(UNREAD.envFile),
    `it named a file this process never read:\n${warn}`);
});

test("202 the load-bearing premise, driven: `clearotron install` refuses when stdin is not a terminal", () => {
  // Everything above rests on this. If the wizard ran headless, "set it by hand" would be a convenience
  // rather than the only route, and the issue would be a wording preference. Driven, not quoted — the
  // sentence naming the wizard's limitation is now shipped product text and must not be able to go
  // stale against the wizard.
  const home = mkdtempSync(join(tmpdir(), "ct202w-"));
  try {
    const r = spawnSync(process.execPath, [ONBOARD], { encoding: "utf8", timeout: 120_000,
      stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, HOME: home } });
    const said = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    assert.notEqual(r.status, 0, `the wizard did NOT refuse a non-terminal:\n${said.slice(0, 700)}`);
    assert.match(said, /stdin is not a terminal/,
      `it refused, but not for the reason the shipped text gives:\n${said.slice(0, 700)}`);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
