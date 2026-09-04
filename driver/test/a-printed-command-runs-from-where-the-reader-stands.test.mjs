// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — the product printed commands that only worked where it was standing.
//
// The owner was handed a command, typed it from his home directory, and got
//
//     npm error could not determine executable to run
//
// `npx` resolves a local package by walking UP from the current directory to find node_modules: inside
// the checkout it finds us, from anywhere else it finds nothing and reports a generic npm failure that
// names no product and suggests no fix. had taught the product to choose correctly
// between `clearotron` and `npx clearotron`; both are unrunnable from a home directory, so choosing
// well between them was never going to help.
//
// WHAT THESE ARMS ASSERT IS THE ROUND TRIP, NOT THE STRING. A printed command is taken out of the
// product's own stdout and RUN, from a directory that is not the install. An arm that compared the
// composed line against an expected line would have passed on every day this defect shipped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { invocationForm, invocationPrefix, invoke } from "../../shared/invocation.mjs";
import { INSTALL_DIR, inspectShim, installShim, shimBody, shimPath } from "../../shared/verb-shim.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const ONBOARD = join(REPO, "bin", "onboard.mjs");

/**
 * A directory holding the node toolchain a reader HAS — `node` and `npx` — so a hermetic PATH still
 * resolves both (see item 1, and for why `npx` had to be added).
 *
 * It held `node` alone, and the arms below still passed: PATH is `${NODE_DIR}:/usr/bin:/bin`, and on a
 * Debian runner `npx` is exactly what the node package puts in `/usr/bin` (where `/bin` is a symlink to
 * it besides). So the hermetic PATH was never hermetic — it borrowed `npx` from the box. Anywhere node
 * lives somewhere else — macOS, nvm, a hostedtoolcache — the in-place advice `cd <install> && npx
 * clearotron …` (shared/invocation.mjs) died on `npx: command not found` before reaching the product,
 * and the arm read that as the PRODUCT failing to be reachable. Reproduced on Linux by dropping
 * `/usr/bin` from the PATH: same error, same line.
 *
 * `npx` is not the thing under test — the advice is. A reader who has `node` has `npx` beside it, so
 * the fixture supplies both and the assertion is about our own output again. What must NOT go in here
 * is a `clearotron` of ours: the run would then resolve the verb from the fixture instead of from the
 * advice, and every form would look reachable. Nothing enforces that — measured: planting a recognised
 * shim here fails no arm, because what doctor PRINTS is decided by the environment doctor was handed,
 * not by this directory. It is a constraint on whoever edits the fixture, written where they will meet it.
 */
const NODE_DIR = mkdtempSync(join(tmpdir(), "reach-node-"));
symlinkSync(process.execPath, join(NODE_DIR, "node"));

/**
 * Where a tool the reader is guaranteed to have lives: beside the interpreter first — nvm, Homebrew, a
 * hostedtoolcache, and macOS generally keep `npx` there — then whatever PATH this process was given.
 *
 * A miss is NOT a skip and not a silent pass. `npx` ships with npm which ships with node, and `sh` is
 * on every POSIX box, so a machine running this suite without them has a broken toolchain and the arms
 * that need them say so by name rather than quietly asserting nothing.
 */
function findTool(name, firstLook = []) {
  const names = process.platform === "win32" ? [`${name}.cmd`, `${name}.exe`, name] : [name];
  for (const d of [...firstLook, ...(process.env.PATH ?? "").split(delimiter)]) {
    if (!d) continue;
    for (const n of names) {
      const p = join(d, n);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

// `sh` is here because `npx` SPAWNS IT to run the package's bin — measured, not assumed: with `sh`
// missing the command dies `npm error enoent spawn sh`, which is npm failing to describe npm. A reader
// who has node has a shell; the fixture supplies one so the PATH can carry nothing else.
const NPX = findTool("npx", [dirname(process.execPath)]);
const SH = findTool("sh", ["/bin", "/usr/bin"]);
for (const [name, src] of [["npx", NPX], ["sh", SH]]) if (src) symlinkSync(src, join(NODE_DIR, name));

/**
 * The PATH a printed command is RUN on: this install's shim if the case has one, plus `node`, `npx` and
 * `sh`, and nothing else.
 *
 * — the arms used to run the command on `${NODE_DIR}:/usr/bin:/bin`, and
 * `/usr/bin` is where a Debian box keeps `npx` (`/bin` is a symlink to it besides). So the advice
 * `cd <install> && npx clearotron …` was proved runnable by borrowing a tool from the runner, and where
 * node lives anywhere else — macOS, nvm, a hostedtoolcache — the same command died `npx: command not
 * found`. A PATH carrying only what the fixture put there is what makes THIS box able to catch that.
 *
 * Doctor itself still runs on the wider PATH: it shells out to `git`, and a doctor behaving unlike a
 * normal install would change the very output under test.
 */
const hermetic = (shimDir = null) => [shimDir, NODE_DIR].filter(Boolean).join(delimiter);

/** Called by every arm that runs a printed command: an absent `npx` is a could-not-look, said out loud. */
const requireToolchain = () => assert.ok(NPX && SH,
  `no ${NPX ? "`sh`" : "`npx`"} beside this node or anywhere on PATH, so the hermetic PATH cannot carry `
  + "one. Every command below in the `cd <install> && npx clearotron …` form would fail as `command not "
  + "found` and read as the PRODUCT being unreachable — which is the misreading Refs tracker issue 2099 "
  + "was filed about.");

const tmp = (tag) => mkdtempSync(join(tmpdir(), `reach-${tag}-`));

/** A home with our shim already in it, as `clearotron install` leaves one. */
function homeWithShim({ installDir = REPO } = {}) {
  const home = tmp("home");
  const r = installShim({ env: { HOME: home }, installDir, nodePath: process.execPath });
  assert.equal(r.ok, true, `the fixture could not write a shim: ${r.reason} ${r.detail}`);
  return { home, dir: r.dir, path: r.path };
}

// ── THE THREE FORMS, AND WHAT DECIDES BETWEEN THEM ─────────────────────────────────────────────────
//
// Every one of these drives a real shim on a real temp filesystem. The `exists` probe is injected only
// for the PATH walk, because manufacturing a shadowing `clearotron` on the machine running the suite
// would put a stray executable on a shared box.

/**
 * Run the printed advice the way a reader would — HERMETIC ON THE NETWORK TOO..
 *
 * THE DEFECT. These arms met `spawnSync /bin/sh ETIMEDOUT` after a full 60 seconds, on a clean tree,
 * with the npm registry measured healthy. `npx` makes a registry call it does not need — the advice
 * names a LOCAL install and the package resolves locally — and that call sometimes blocks instead of
 * failing. It produced zero bytes on both streams for the whole 60 seconds, so it was not prompting; it
 * was waiting on the network. Proved by pointing it at an unroutable registry: connection refused
 * instantly, and npx then resolved locally and printed the help.
 *
 * IT WAS NEVER DETERMINISTIC, which is the part worth keeping in mind. The same command in the same
 * environment completed at 01:06Z and hung at 01:12Z. That is why this file was green for months and
 * red tonight — nothing "flipped" and nothing "healed"; the arm was a coin weighted by whatever the
 * registry connection happened to do. Two rejected fixes, both measured rather than argued:
 * `npm_config_yes=false` left it red in 2 of 3 runs, and `npx --no-install` was red in 3 of 3.
 *
 * `npm_config_offline=true` is the fix and it is the honest one: this file already builds a hermetic
 * PATH so the command cannot borrow a toolchain from the box, and the network is the same borrowing.
 * The advice under test resolves an install that is already on disk, so it must never need a registry —
 * an arm that reaches one is testing the network as much as the product. The command string stays
 * exactly what doctor prints; only the environment around it is sealed.
 *
 * AND THE OUTPUT SURVIVES A FAILURE. `execFileSync` throws with the captured stdout/stderr attached and
 * the old call discarded both, so what reached the next reader was an errno naming nothing — including
 * which of the printed commands it was. Every lane that met this red began from zero.
 */
function runPrintedCommand(cmd, { cwd, env }) {
  try {
    return execFileSync("/bin/sh", ["-c", `${cmd} --help`], {
      encoding: "utf8", cwd, stdio: ["ignore", "pipe", "pipe"], timeout: 60_000,
      env: { ...env, npm_config_offline: "true" },
    });
  } catch (e) {
    const said = [e.stdout, e.stderr].map((x) => String(x ?? "").trim()).filter(Boolean).join("\n---\n");
    throw new Error(`\`${cmd} --help\` did not complete from ${cwd} (${e.code ?? e.message}).`
      + `${said ? `\nWhat it printed before it stopped:\n${said.slice(0, 1500)}` : "\nIt printed nothing at all before it stopped."}`);
  }
}

test("1916 the form is decided by the shim and the PATH, never by the working directory", () => {
  const { home, dir, path } = homeWithShim();
  const none = () => false;

  const onPath = invocationForm({ HOME: home, PATH: [dir, "/usr/bin"].join(delimiter) }, { exists: none });
  assert.equal(onPath.form, "bare", "our shim is first on PATH — the bare verb reaches this install");
  assert.equal(onPath.prefix, "");

  const offPath = invocationForm({ HOME: home, PATH: "/usr/bin:/bin" }, { exists: none });
  assert.equal(offPath.form, "shim-path",
    "a login profile adds ~/.local/bin only if it existed when the shell started, so the shim written "
    + "seconds ago is usually absent from THIS terminal's PATH — the absolute path is the only true form");
  assert.equal(offPath.prefix, `${dir}/`);

  // Shadowed: a `clearotron` earlier on PATH is somebody else's, and the bare name would reach it.
  const shadowed = invocationForm(
    { HOME: home, PATH: ["/opt/other/bin", dir].join(delimiter) },
    { exists: (p) => p === join("/opt/other/bin", "clearotron") });
  assert.equal(shadowed.form, "shim-path", "an earlier `clearotron` demotes the bare form, never confirms it");
  assert.equal(shadowed.shadowedBy, join("/opt/other/bin", "clearotron"));

  const noHome = invocationForm({ PATH: "/usr/bin" }, { exists: none });
  assert.equal(noHome.form, "in-place");
  assert.equal(noHome.prefix, `cd ${INSTALL_DIR} && npx `,
    "with no shim the advice names the directory — the issue's own first option, kept as the fallback");

  // ✕ THE CASE A `command -v` CHECK GETS WRONG, which is why the shim is READ and not merely found.
  const other = tmp("home");
  installShim({ env: { HOME: other }, installDir: "/opt/a-different-install", nodePath: process.execPath });
  const wrongInstall = invocationForm(
    { HOME: other, PATH: [join(other, ".local", "bin"), "/usr/bin"].join(delimiter) }, { exists: none });
  assert.equal(wrongInstall.form, "in-place",
    "a shim on PATH that names a DIFFERENT install must not license the bare name: it would send the "
    + "reader to somebody else's copy, which is the exact failure shared/invocation.mjs refuses to make");
  assert.equal(wrongInstall.otherInstall, "/opt/a-different-install");

  rmSync(home, { recursive: true, force: true });
  rmSync(other, { recursive: true, force: true });
  assert.equal(inspectShim(path).kind, "absent-or-unreadable", "the fixture cleaned up after itself");
});

test("1916 the reader who arrived by npx is told the bare verb once their own shim is on PATH", () => {
  // THE PAYOFF, stated as the one thing that must be different from before. 's arms
  // pin that this reader is never told the bare name; that was right when the bare name reached
  // nothing. The install now makes it reach this checkout, and the whole point of putting the verb on
  // PATH is that the advice stops carrying `npx` the moment it does.
  const { home, dir } = homeWithShim();
  const npxArrival = ["/opt/cache/_npx/a1b2/node_modules/.bin/clearotron", { npm_command: "exec" }];

  assert.equal(
    invocationPrefix(npxArrival[0], { ...npxArrival[1], HOME: home, PATH: [dir, "/usr/bin"].join(delimiter) },
      { exists: () => false }),
    "", "the shim is on PATH and names this install, so `npx` is now noise");

  assert.equal(
    invocationPrefix(npxArrival[0], { ...npxArrival[1], HOME: home, PATH: "/usr/bin:/bin" },
      { exists: () => false }),
    `${dir}/`, "…and off PATH it is the absolute shim, never a bare name the shell cannot resolve");

  rmSync(home, { recursive: true, force: true });
});

test("1916 arriving BY the bare name needs no filesystem at all", () => {
  // The strongest evidence there is about a reader's PATH is that they typed the bare name and it
  // reached this code — from wherever they were standing. That branch must not be reachable by a
  // missing HOME or an unreadable shim, so it is driven with a probe that throws if consulted.
  const explode = { exists: () => { throw new Error("invocationPrefix consulted the filesystem"); } };
  assert.equal(invocationPrefix("/usr/local/bin/clearotron", {}, explode), "");
  assert.equal(invocationPrefix("/opt/x/bin/onboard.mjs", { CLEAROTRON_INVOKED_AS: "/usr/local/bin/clearotron" }, explode), "");
  assert.equal(invoke("doctor", "/usr/local/bin/clearotron", {}, explode), "clearotron doctor");
});

// ── THE SHIM ITSELF ────────────────────────────────────────────────────────────────────────────────
test("1916 the shim the install writes is executable and reaches THIS install", () => {
  const { home, path } = homeWithShim();
  const elsewhere = tmp("cwd");

  // Run it from a directory that is neither the install nor the home — the reader's actual position.
  const out = execFileSync(path, ["--help"], {
    encoding: "utf8", cwd: elsewhere, stdio: ["ignore", "pipe", "pipe"],
    env: { PATH: `${NODE_DIR}:/usr/bin:/bin`, HOME: home, CLEAROTRON_NO_ENV_FILE: "1" },
  });
  assert.match(out, /clearotron <verb>/,
    "the shim did not reach the dispatcher — a shim that runs and lands somewhere else is worse than none");

  // NODE IS NAMED ABSOLUTELY: the shim is what a cron line or a unit file runs, and a service's PATH
  // is not your shell's. A bare `node` here works in the terminal that wrote it and nowhere else.
  const body = readFileSync(path, "utf8");
  assert.match(body, /^exec "\//m, "node must be named by absolute path in the shim");
  assert.ok(body.includes(join(REPO, "bin", "clearotron.mjs")), "the shim must name this install's dispatcher");

  rmSync(home, { recursive: true, force: true });
  rmSync(elsewhere, { recursive: true, force: true });
});

test("1916 a `clearotron` we did not write is reported, never overwritten", () => {
  // Somebody else's `clearotron` on this operator's PATH is a fact about their machine. Replacing it
  // silently would hijack a name we do not own — and would do it during an install they ran for an
  // unrelated reason.
  const home = tmp("home");
  const path = shimPath({ HOME: home });
  mkdirSync(dirname(path), { recursive: true });
  const foreign = "#!/bin/sh\necho somebody elses clearotron\n";
  writeFileSync(path, foreign, { mode: 0o755 });

  const r = installShim({ env: { HOME: home }, installDir: REPO });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "occupied");
  assert.equal(readFileSync(path, "utf8"), foreign, "the foreign file was rewritten");
  assert.equal(invocationForm({ HOME: home, PATH: dirname(path) }, { exists: () => false }).form, "in-place",
    "and the advice falls back to naming this install, rather than trusting a name that is not ours");

  rmSync(home, { recursive: true, force: true });
});

test("1916 a shim that cannot be written is a warning the install carries, not a failure it dies of", () => {
  // The install's deliverable is a working install. The verb on PATH is a convenience, and refusing a
  // finished configuration over a convenience turns a working install into no install at all.
  const home = tmp("home");
  const local = join(home, ".local");
  mkdirSync(local, { recursive: true });
  chmodSync(local, 0o500);                     // no write: mkdir of ./bin fails
  try {
    const r = installShim({ env: { HOME: home }, installDir: REPO });
    assert.equal(r.ok, false, "a read-only ~/.local must not yield a claimed-successful shim");
    assert.equal(r.reason, "unwritable");
    assert.ok(r.detail, "a refusal with no detail leaves the reader nothing to act on");
  } finally {
    chmodSync(local, 0o700);
    rmSync(home, { recursive: true, force: true });
  }
});

// ── THE ROUND TRIP ────────────────────────────────────────────────────────────────────────────────
//
// `doctor` is one of the three surfaces the issue names, and the one a reader reaches when something is
// already wrong — from wherever they happen to be. Its advice lines compose through invocationPrefix(),
// the same helper the wizard's closing screen composes through.
//
// THE CLOSING SCREEN ITSELF IS NOT DRIVEN HERE, and that is a stated limit rather than an oversight.
// The wizard refuses a non-terminal stdin, so reaching that screen live needs a PTY, and it writes
// `<repo>/.env` — inside the checkout the suite is running from, with no override for where. Driving it
// under `node --test`, which runs files concurrently, would have this arm writing a file other arms
// read. It was driven by hand instead and the transcript is on the pull request; what protects it here
// is onboard-wizard.test.mjs's arm on the screen's own `say()` arguments, which pins that those three
// lines compose through this helper, meeting the arms below in the middle.
/**
 * The commands in a block of doctor's output.
 *
 * HOISTED OUT OF `doctorAdvice` so it can be proved against a LITERAL rather than
 * against whatever the box running the suite happens to be missing. It used to be inline, and the arm's
 * anti-vacuity control asserted that a live doctor run always names the install verb — true only on a
 * machine with no `<repo>/.env`, which is every CI runner and no real installation. On a configured box
 * doctor correctly reports the pool as set, the advice correctly does not print, and the control fired
 * with "the extractor is broken, not the tree" about a healthy extractor and a healthy tree.
 *
 * A control that can only hold where the product is NOT installed is not a control.
 */
export function commandsIn(out) {
  // ── THE EXTRACTOR MATCHES A COMMAND SHAPE, NOT A DELIMITER ───────────────────────────────────
  //
  // Doctor prints its commands three ways — inside backticks, after `run: `, and as the subject of a
  // sentence — so keying on any one delimiter finds a third of them. Written first as "text between
  // backticks containing the word clearotron", it spanned from a closing backtick on one line to an
  // opening one six lines later and handed /bin/sh a paragraph.
  //
  // A VERB IS REQUIRED, which is what keeps prose out: "`clearotron` is on your PATH" has a backtick
  // after the name, not a verb, and is correctly not a command.
  const SHAPE = /(?:cd \S+ && )?(?:npx )?(?:\/\S*\/)?clearotron [a-z][a-z0-9-]*(?: --[a-z][a-z0-9-]*)*/g;
  return [...new Set([...String(out).matchAll(SHAPE)].map((m) => m[0]))];
}

function doctorAdvice(env) {
  // DOCTOR EXITS NON-ZERO WHEN THE INSTALL IS INCOMPLETE, and on a hermetic fixture it always is —
  // no .env, no engine, no register. That verdict is not this arm's subject: what is under test is
  // the advice it prints on the way past, which is the same on either exit. Swallowing the code is
  // safe only because the anti-vacuity check below refuses an empty extraction, so a doctor that
  // crashed before printing anything fails here rather than reading as a clean pass.
  let out;
  try {
    out = execFileSync(process.execPath, [ONBOARD, "--check"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], cwd: tmp("cwd"),
      env: { PATH: `${NODE_DIR}:/usr/bin:/bin`, CLEAROTRON_NO_ENV_FILE: "1", ...env },
    });
  } catch (e) {
    out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
  // ── THE EXTRACTOR MATCHES A COMMAND SHAPE, NOT A DELIMITER ───────────────────────────────────
  //
  // Doctor prints its commands three ways — inside backticks, after `run: `, and as the subject of a
  // sentence — so keying on any one delimiter finds a third of them. Written first as "text between
  // backticks containing the word clearotron", it spanned from a closing backtick on one line to an
  // opening one six lines later and handed /bin/sh a paragraph.
  //
  // A VERB IS REQUIRED, which is what keeps prose out: "`clearotron` is on your PATH" has a backtick
  // after the name, not a verb, and is correctly not a command.
  return { out, commands: commandsIn(out) };
}

test("1916 every command `doctor` prints RUNS from a directory that is not the install", () => {
  requireToolchain();
  const { home, dir } = homeWithShim();
  const elsewhere = tmp("cwd");

  for (const [name, pathEnv] of [
    ["shim first on PATH", [dir, NODE_DIR, "/usr/bin", "/bin"].join(delimiter)],
    ["shim written but not yet on PATH", `${NODE_DIR}:/usr/bin:/bin`],
  ]) {
    const { out, commands } = doctorAdvice({ HOME: home, PATH: pathEnv });
    // ── ANTI-VACUITY, AND IT NO LONGER DEPENDS ON WHAT THIS BOX IS MISSING ───
    //
    // An extractor that finds nothing makes every assertion below a pass, so something must refuse an
    // empty extraction. This used to be "doctor's unset-pool advice always names the install verb",
    // which held only where no `<repo>/.env` exists — every CI runner, and no real installation. On a
    // configured box the advice correctly does not print and the control fired about a healthy tree.
    //
    // The extractor's health is now proved against a LITERAL, in its own arm below, where it is a
    // deterministic fact rather than a property of the machine. What is left here is the thing this
    // arm is actually for: doctor RAN, and whatever it named is runnable.
    assert.ok(out.trim().length > 0,
      `${name}: doctor printed nothing at all — every assertion below would pass over silence`);
    assert.match(out, /clearotron/i,
      `${name}: doctor's output never mentions the product, so the extractor was handed nothing to find:\n${out.slice(0, 1200)}`);

    for (const cmd of commands) {
      // `--help` for the same reason the issue's own reproduction used it: nothing is mutated.
      //
      // RUN ON THE HERMETIC PATH, NOT ON DOCTOR'S. `pathEnv` carries
      // `/usr/bin:/bin` so that doctor itself behaves like a normal install — it shells out to `git`.
      // Handing the same PATH to the printed command let the command borrow whatever the box happened
      // to have there, and on a Debian runner that includes `npx`. The command is what is under test,
      // so it gets the toolchain a reader is GUARANTEED to have and nothing else: this install's shim
      // where one exists, and `node`/`npx`.
      const r = runPrintedCommand(cmd, {
        cwd: elsewhere,
        env: { PATH: hermetic(name === "shim first on PATH" ? dir : null), HOME: home, CLEAROTRON_NO_ENV_FILE: "1" },
      });
      assert.match(r, /clearotron/,
        `${name}: doctor printed \`${cmd}\`, and running it from ${elsewhere} did not reach this product`);
    }
  }
  rmSync(home, { recursive: true, force: true });
  rmSync(elsewhere, { recursive: true, force: true });
});

test("1916 with no shim, the advice names the directory — and that line runs too", () => {
  // The fallback, and the half of the issue's requirement that says "either states the directory, or is
  // a command that works from anywhere". A reader with no shim must still get something runnable.
  requireToolchain();
  const home = tmp("home");                       // no shim in it
  const elsewhere = tmp("cwd");
  const { out, commands } = doctorAdvice({ HOME: home, PATH: `${NODE_DIR}:/usr/bin:/bin` });

  assert.ok(commands.some((c) => c.endsWith("clearotron install")),
    `doctor's unset-pool advice always names the install verb, and the extractor did not find it:\n${out.slice(0, 1200)}`);
  const bare = commands.filter((c) => /^clearotron /.test(c));
  assert.deepEqual(bare, [],
    "doctor advertised a bare `clearotron` to a reader who has none — this is the shape the issue was "
    + "filed about, and `command not found` is the shell's error, not ours");
  for (const cmd of commands) {
    assert.ok(cmd.startsWith(`cd ${INSTALL_DIR} &&`),
      `\`${cmd}\` neither states the directory nor works from anywhere`);
    // AND IT IS RUN, not merely inspected. This arm asserted the shape of the string and executed
    // nothing — the title said "and that line runs too" and it did not, leaving the one form that
    // goes through `npx` proven nowhere in the suite. `npx` resolving the local package measures at
    // ~0.6s, which is what this costs.
    const r = runPrintedCommand(cmd, {
      cwd: elsewhere,
      env: { PATH: hermetic(), HOME: home, CLEAROTRON_NO_ENV_FILE: "1" },   
    });
    assert.match(r, /clearotron/,
      `doctor printed \`${cmd}\` to a reader with no shim, and running it from ${elsewhere} did not `
      + "reach this product — the fallback has to be runnable or it is the defect wearing a cd");
  }
  rmSync(home, { recursive: true, force: true });
  rmSync(elsewhere, { recursive: true, force: true });
});

// ── THE SITES THE SOURCE-TEXT GUARD CANNOT SEE ────────────────────────────────────────────────────
//
// invocation-prefix.test.mjs walks bin/ as TEXT and skips comment lines, with the stated reason that
// "source comments are not printed to anyone". Every verb whose `--help` is built by usageBlock()
// prints its own header comment, so for those files the reason is false: fifteen advice lines across
// `install`, `start` and `demo` hardcoded `npx clearotron …` and were exempt from the one guard
// written to prevent it. The portal's sign-in page carried a sixteenth in HTML — and that one is the
// command the owner actually typed when he found this.
//
// This arm reads the RENDERED output instead of the source, so no exemption reaches it.
test("1916 no verb's --help advertises a command form the reader cannot run", () => {
  const { home, dir } = homeWithShim();
  const onPath = [dir, NODE_DIR, "/usr/bin", "/bin"].join(delimiter);
  const verbs = ["install", "start", "demo", "doctor", "passphrase", "update"];
  let advisory = 0;

  for (const verb of verbs) {
    let out;
    try {
      out = execFileSync(process.execPath, [join(REPO, "bin", "clearotron.mjs"), verb, "--help"], {
        encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], cwd: tmp("cwd"), timeout: 60_000,
        env: { PATH: onPath, HOME: home, CLEAROTRON_NO_ENV_FILE: "1" },
      });
    } catch (e) { out = `${e.stdout ?? ""}${e.stderr ?? ""}`; }

    // ANTI-VACUITY: a verb printing nothing would satisfy every check below.
    assert.ok(/clearotron/.test(out), `\`${verb} --help\` printed no synopsis at all:\n${out.slice(0, 400)}`);

    const stale = out.split("\n").filter((l) => /(^|\s)npx\s+clearotron\b/.test(l));
    assert.deepEqual(stale, [],
      `\`${verb} --help\` prints \`npx clearotron\` at a reader whose PATH carries the verb. These lines `
      + "reach a reader through --help however they are spelled in the source, so they compose through "
      + `invocationPrefix() like every other printed command:\n  ${stale.join("\n  ")}`);
    advisory += out.split("\n").filter((l) => /(^|\s)clearotron\s[a-z]/.test(l)).length;
  }
  assert.ok(advisory >= verbs.length,
    `only ${advisory} command line(s) across ${verbs.length} verbs — the walk found no synopsis to judge`);
  rmSync(home, { recursive: true, force: true });
});

test("1916 the portal's sign-in page names a passphrase reset the reader can run", () => {
  // THE COMMAND THE OWNER TYPED. The sign-in page is where a reader who has lost their passphrase is
  // told what to do, and it carried a hardcoded `npx clearotron passphrase --reset` — unrunnable from
  // anywhere but the install directory, which is not where somebody reading a browser page is standing.
  const src = readFileSync(join(REPO, "driver", "portal-service.mjs"), "utf8");
  const hint = /Lost the passphrase\? Run <code>([^<]*)<\/code>/.exec(src);
  assert.ok(hint, "the sign-in page's passphrase hint is gone — re-point this arm rather than deleting it");
  assert.doesNotMatch(hint[1], /npx clearotron/,
    "the sign-in hint hardcodes the npx form again; it must compose through invoke() like every other "
    + "printed command, or a reader follows it from their home directory and gets npm's error");
  assert.match(hint[1], /\$\{[^}]*bareInvocation\("passphrase"\)[^}]*\}/,
    "the hint must come from the helper, not from a second treatment living in HTML");

  // ✕ AND IT MUST NOT NAME THIS MACHINE. The sign-in page is read by somebody who is not authenticated
  // and may not be on the box at all. Composed with invoke(), a shim-less install renders
  // `cd /srv/whatever && npx clearotron passphrase --reset` — the server's absolute path, its home
  // directory and its account name, on a page a stranger can load. This is the arm that keeps the
  // fix for issue 1916 from turning into a disclosure while satisfying its own criteria.
  assert.doesNotMatch(hint[1], /invocationPrefix|invoke\(|\/|cd /,
    "the sign-in hint carries a path or a directory-changing form; an unauthenticated reader must not "
    + "be handed this machine's filesystem layout to learn how to reset a passphrase");
});

test("1916 a shim whose interpreter is gone is reported, not ticked", () => {
  // THE FAILURE THIS ISSUE'S OWN FIX COULD HAVE INTRODUCED. The shim records the interpreter it was
  // written with, so an nvm upgrade — and `.nvmrc` ships in this package — removes that path while
  // leaving the shim, its marker and its install line untouched. It then dies in /bin/sh with
  // `exec: …/node: not found`: not our error, naming no product, one layer below the one the owner hit.
  const home = tmp("home");
  const r = installShim({ env: { HOME: home }, installDir: REPO, nodePath: "/nowhere/at/all/node" });
  assert.equal(r.ok, true);

  // It is still recognisably ours — the point is that "ours" is not the same question as "it runs".
  const found = inspectShim(r.path, { installDir: REPO });
  assert.equal(found.kind, "ours");
  assert.equal(found.interpreterMissing, true, "the recorded interpreter does not exist and must be reported");

  const onPath = invocationForm({ HOME: home, PATH: [r.dir, "/usr/bin"].join(delimiter) }, { exists: () => false });
  assert.equal(onPath.staleInterpreter, "/nowhere/at/all/node",
    "the form must carry the staleness, or doctor ticks a shim nobody checked can run");

  // ✕ AND THE ADVICE MUST NOT TRAVEL THE ROUTE IT IS REPAIRING. Driven and caught: doctor reported the
  // stale interpreter and then said to run `clearotron install` — through the very shim it had just
  // called broken. Unrunnable advice about an unrunnable command is this issue with an extra step.
  assert.notEqual(onPath.form, "bare",
    "a shim whose interpreter is gone is on PATH and cannot run; handing back the bare name makes every "
    + "line doctor prints — including the one that repairs it — go through the broken shim");
  assert.equal(onPath.prefix, `cd ${INSTALL_DIR} && npx `,
    "the repair advice has to go around the shim, and the in-place form is the one route that does");

  // The control: a shim written with THIS interpreter reports no staleness.
  const live = homeWithShim();
  assert.equal(invocationForm({ HOME: live.home, PATH: [live.dir, "/usr/bin"].join(delimiter) },
    { exists: () => false }).staleInterpreter, null,
    "a working shim must not be reported stale — this arm would pass on a check that always fires");

  rmSync(home, { recursive: true, force: true });
  rmSync(live.home, { recursive: true, force: true });
});

test("1916 the shim's body is the one this install recognises", () => {
  // The writer and the reader are one file on purpose. This is the arm that reds if only one of them
  // is changed — a marker edited in shimBody() and not in inspectShim() would leave every install
  // silently unable to recognise the shim it had just written.
  const body = shimBody({ installDir: "/opt/x", nodePath: "/usr/bin/node" });
  const home = tmp("home");
  const path = shimPath({ HOME: home });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, { mode: 0o755 });
  assert.equal(inspectShim(path, { installDir: "/opt/x" }).kind, "ours");
  assert.equal(inspectShim(path, { installDir: "/opt/y" }).kind, "ours-other-install");
  rmSync(home, { recursive: true, force: true });
});


test("2036 the extractor is proved against a LITERAL, not against what this box is missing", () => {
  // THE CONTROL THAT REPLACES THE AMBIENT ONE. Doctor prints commands three ways and the extractor has
  // to find all three; whether any PARTICULAR advice line prints is a property of the machine, which is
  // exactly what made the old control unpassable on a configured install.
  const sample = [
    "  ! CLEAROTRON_REPORTS_DIR is not set — run `cd /opt/thing && npx clearotron install` to fix it",
    "  run: npx clearotron doctor",
    "  You can start it with clearotron start --port 8080 at any time.",
    "  `clearotron` is on your PATH.",
    "  /usr/local/bin/clearotron update",
  ].join("\n");
  const found = commandsIn(sample);

  assert.ok(found.includes("cd /opt/thing && npx clearotron install"), "the backticked form, with its cd prefix");
  assert.ok(found.includes("npx clearotron doctor"), "the `run: ` form");
  assert.ok(found.some((c) => c.startsWith("clearotron start")), "the bare sentence-subject form");
  assert.ok(found.includes("/usr/local/bin/clearotron update"), "and an absolute path to the shim");

  // A VERB IS REQUIRED, and this is the half that keeps prose out of /bin/sh. "`clearotron` is on your
  // PATH" is a sentence about the product, not a command, and running it would be running nothing.
  assert.ok(!found.some((c) => c.trim() === "clearotron"), "a bare mention is not a command");
  assert.deepEqual(commandsIn("nothing here mentions the product"), [], "and no text means no commands");
});

test("2036 the extractor control FAILS when the extractor is broken — both directions", () => {
  // The old control could not distinguish "the extractor broke" from "this box has nothing to complain
  // about". This one can, because the input is fixed: the only variable left is the extractor.
  const sample = "run: npx clearotron doctor";
  assert.deepEqual(commandsIn(sample), ["npx clearotron doctor"], "the shape it must find");
  // The negative direction, stated as data rather than by editing the regex: text that LOOKS close but
  // carries no verb must not be extracted, or a paragraph reaches /bin/sh — the defect this arm's own
  // header records from the first cut.
  for (const notACommand of ["`clearotron` is installed", "clearotron", "npx clearotron", "the clearotron 2 way"]) {
    assert.deepEqual(commandsIn(notACommand), [], `"${notACommand}" is not a runnable command`);
  }
});
