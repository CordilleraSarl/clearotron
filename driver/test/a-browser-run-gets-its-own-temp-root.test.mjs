// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// The temp root a browser is launched under: that it fits, that it is exported, and that it goes.
//
// WHY THE BUDGET ARM MATTERS MOST. Over the limit the browser does not degrade and does not report —
// it aborts with a core dump and a fatal line about a socket path. Nothing about that names the cause,
// which is the length of the directory the run was started from. So the refusal is the product here,
// and these arms drive the boundary from both sides rather than asserting the constant equals itself:
// a check that reads MAX_ROOT_LENGTH and compares it to MAX_ROOT_LENGTH passes on any value.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SUN_PATH_MAX, LOCK_SUFFIX, MAX_ROOT_LENGTH, ROOT_PREFIX,
  rootRefusal, assertRootFits, browserEnv, browserRun, browserTempRoot,
} from "../../shared/browser-temp-root.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("the budget is the socket field minus what the lock adds, and both terms are real", () => {
  // Not a restatement of the arithmetic: these are the two measured quantities the limit is made of.
  assert.equal(SUN_PATH_MAX, 107, "a unix socket address field holds 108 bytes, the last a terminator");
  assert.equal(LOCK_SUFFIX, "/com.google.Chrome.XXXXXX/SingletonSocket");
  assert.equal(MAX_ROOT_LENGTH, SUN_PATH_MAX - LOCK_SUFFIX.length);
  // The boundary measured on a real browser: 66 starts, 67 aborts.
  assert.equal(MAX_ROOT_LENGTH, 66);
});

test("a root at the limit is accepted and one character more is refused", () => {
  const at = "/" + "x".repeat(MAX_ROOT_LENGTH - 1);
  const over = "/" + "x".repeat(MAX_ROOT_LENGTH);
  assert.equal(at.length, MAX_ROOT_LENGTH);
  assert.equal(over.length, MAX_ROOT_LENGTH + 1);
  assert.equal(rootRefusal(at), null, "a root exactly at the limit must be usable");
  assert.notEqual(rootRefusal(over), null, "one character past the limit must refuse");
});

test("the refusal names the length it measured, the limit and the path", () => {
  const over = "/" + "y".repeat(MAX_ROOT_LENGTH);
  const why = rootRefusal(over);
  assert.match(why, new RegExp(String(over.length)), "the measured length is what tells a reader how far over it is");
  assert.match(why, new RegExp(String(MAX_ROOT_LENGTH)), "the limit must be stated, not left to be looked up");
  assert.ok(why.includes(over), "the path is the thing the reader has to change");
  assert.throws(() => assertRootFits(over), /limit is 66/);
});

test("an empty or absent root is a refusal, not a pass", () => {
  // A zero-length path is shorter than the limit. Reading only the length would accept it.
  for (const bad of ["", null, undefined, 7]) {
    assert.notEqual(rootRefusal(bad), null, `${JSON.stringify(bad)} must not read as a usable root`);
  }
});

test("browserRun puts the profile inside the root and exports the root as TMPDIR", () => {
  const { root, profile, env } = browserRun("arm-run-");
  assert.ok(existsSync(profile), "the profile directory must exist before a browser is pointed at it");
  assert.ok(profile.startsWith(root + "/"), "the profile must be INSIDE the root, so one removal covers both");
  assert.equal(env.TMPDIR, root, "TMPDIR is the whole mechanism — the browser reads the lock location from it");
  assert.equal(rootRefusal(root), null, "a root this module made must itself fit the budget");
});

test("browserEnv MERGES into the environment rather than replacing it", () => {
  // `env:` on spawn and execFileSync REPLACES the child's environment; it does not merge. A browser
  // handed only TMPDIR loses HOME and PATH, and it does not fail by saying so — it fails as a render
  // fault, which is the hardest kind of failure to attribute to a change like this one.
  //
  // Measured while writing this: execFileSync with `env: { TMPDIR }` gives the child HOME=[] and a
  // fallback PATH. So the whole safety of every call site is the spread in this one function, one
  // module away from the spawns that depend on it, and nothing else here was asserting it.
  //
  // Raised in review of the sibling change that wires two more launchers — by a reader who checked
  // the merge before checking anything else, because it is the thing that breaks quietly.
  const root = browserTempRoot();
  const ambient = { PATH: "/probe/bin", HOME: "/probe/home", LANG: "C" };
  const env = browserEnv(root, ambient);
  assert.equal(env.TMPDIR, root);
  for (const [k, v] of Object.entries(ambient)) {
    assert.equal(env[k], v, `browserEnv dropped ${k}: a browser without it fails as a render fault, not as a missing variable`);
  }
  // And the default source is the real environment, or every call site that omits the second argument
  // gets an empty one.
  assert.equal(browserEnv(root).PATH, process.env.PATH,
    "browserEnv must default to this process's environment, not to an empty object");
});

test("browserEnv refuses a root that cannot work rather than handing it over", () => {
  const over = "/" + "z".repeat(MAX_ROOT_LENGTH);
  assert.throws(() => browserEnv(over), /limit is 66/);
});

test("the root is removed when the process exits normally", () => {
  const dir = mkdtempSync(join(tmpdir(), "arm-exit-"));
  const namefile = join(dir, "name");
  const src = join(dir, "child.mjs");
  writeFileSync(src, `
    import { writeFileSync } from "node:fs";
    import { browserRun } from ${JSON.stringify(join(ROOT, "shared/browser-temp-root.mjs"))};
    const { root } = browserRun("arm-exit-run-");
    writeFileSync(${JSON.stringify(namefile)}, root);
  `);
  execFileSync(process.execPath, [src], { stdio: "ignore" });
  const root = execFileSync("cat", [namefile], { encoding: "utf8" }).trim();
  assert.ok(root.length > 0, "the child must have reported the root it made");
  assert.equal(existsSync(root), false, `the root survived a normal exit: ${root}`);
});

test("the root is removed on SIGTERM — the exit a cancelled job produces", () => {
  const dir = mkdtempSync(join(tmpdir(), "arm-term-"));
  const namefile = join(dir, "name");
  const src = join(dir, "child.mjs");
  writeFileSync(src, `
    import { writeFileSync } from "node:fs";
    import { browserRun } from ${JSON.stringify(join(ROOT, "shared/browser-temp-root.mjs"))};
    const { root } = browserRun("arm-term-run-");
    writeFileSync(${JSON.stringify(namefile)}, root);
    setInterval(() => {}, 1000);
  `);
  // Driven through a shell so the child is signalled by a pid this arm recorded, never by name.
  execFileSync("bash", ["-c",
    `"$1" "$2" & p=$!; for i in $(seq 1 50); do [ -s "$3" ] && break; sleep 0.2; done; ` +
    `kill -TERM $p; for i in $(seq 1 50); do [ -d /proc/$p ] || break; sleep 0.2; done`,
    "bash", process.execPath, src, namefile], { stdio: "ignore" });
  const root = execFileSync("cat", [namefile], { encoding: "utf8" }).trim();
  assert.ok(root.length > 0, "the child must have reported the root before it was signalled");
  assert.equal(existsSync(root), false, `the root survived SIGTERM: ${root}`);
});

test("keep() leaves the root behind, which is what --keep promises", () => {
  // Four of these checks take a `--keep` flag so somebody can open the profile after a run that went
  // wrong. Moving the profile inside a swept root defeated that flag in every one of them, silently:
  // the flag still parsed, the removal it guarded still did not run, and the directory went at exit
  // anyway. A diagnostic that quietly stopped working is worse than the leak this module exists for,
  // because nobody knows to distrust it.
  const dir = mkdtempSync(join(tmpdir(), "arm-keep-"));
  const namefile = join(dir, "name");
  const src = join(dir, "child.mjs");
  writeFileSync(src, `
    import { writeFileSync } from "node:fs";
    import { browserRun } from ${JSON.stringify(join(ROOT, "shared/browser-temp-root.mjs"))};
    const { root, keep } = browserRun("arm-keep-run-");
    writeFileSync(${JSON.stringify(namefile)}, root);
    keep();
  `);
  execFileSync(process.execPath, [src], { stdio: "ignore" });
  const root = execFileSync("cat", [namefile], { encoding: "utf8" }).trim();
  assert.ok(root.length > 0, "the child must have reported the root it made");
  assert.equal(existsSync(root), true, `keep() did not keep the root: ${root} was removed anyway`);
  rmSync(root, { recursive: true, force: true });
});

test("the root prefix leaves room for a real ambient temp directory under the suite runner", () => {
  // THE MIDDLE ROW IS THE ONE THAT BITES, and it must be computed rather than measured HERE: under the
  // suite runner `tmpdir()` already IS this run's root, so reading it would price the nested case and
  // call it the single-level one. The first version of this arm did exactly that and failed on a
  // correct tree — the arm was wrong, not the fix.
  //
  // So the property is stated host-independently: how long may the machine's REAL temp directory be
  // and still leave a browser root that fits, on an ordinary single-level run?
  //
  //   ambient + /ct-testrun-XXXXXX (18) + /<ROOT_PREFIX>XXXXXX  <=  MAX_ROOT_LENGTH
  //
  // Naming each root after the check put a 22-character name in that last term and the answer came out
  // at 19. This machine's temp directory is 18. One character of headroom on an ordinary run, with
  // nothing nested — a host with /var/tmp/something, or this one renamed a level deeper, and every
  // browser check refuses at once while the tree looks broken.
  const RUNNER_LEVEL = 1 + "ct-testrun-".length + 6;          // the suite runner's own mkdtemp
  const OURS = 1 + ROOT_PREFIX.length + 6;                    // and ours inside it
  const maxAmbient = MAX_ROOT_LENGTH - RUNNER_LEVEL - OURS;
  assert.ok(maxAmbient >= 24,
    `ROOT_PREFIX leaves room for an ambient temp directory of only ${maxAmbient} characters under one `
    + `suite-runner level. Common ones are short, but this machine's is 18 — so that is a margin of `
    + `${maxAmbient - 18}, not a design. Shorten ROOT_PREFIX; the check's name belongs in the directory `
    + `INSIDE the root, where length is free.`);
});

test("the group is signalled BEFORE any root is removed", () => {
  // STRUCTURAL, AND DELIBERATELY SO. The defect this holds is a race: a removal that runs while the
  // browser's renderer and GPU children are still writing throws ENOTEMPTY and leaves the root behind.
  // Reproducing it on demand means winning a race on purpose, and an arm that only sometimes fails is
  // worse than none — it teaches a reader to re-run rather than to look. So this reads the order the
  // handler is WRITTEN in, which is the decision the comment beside it argues for.
  //
  // It was added because reversing the order deliberately left every other arm in this file passing.
  const src = readFileSync(join(ROOT, "shared/reap-on-exit.mjs"), "utf8");
  const body = src.slice(src.indexOf("function reapAll()"), src.indexOf("function install()"));
  assert.ok(body.length > 0, "reapAll must still be the function that does both");
  const kill = body.indexOf("groups.clear()");
  const remove = body.indexOf("rmSync(");
  assert.ok(kill !== -1, "reapAll must still signal the watched groups");
  assert.ok(remove !== -1, "reapAll must still remove the watched directories");
  assert.ok(kill < remove,
    "the process groups must be signalled before any directory is removed: a removal that runs first "
    + "races the browser's surviving children and throws ENOTEMPTY, leaving the root behind");
});

test("a root is rooted at the ambient temp directory, so it inherits a runner's own root", () => {
  // Under the suite runner TMPDIR is already this run's root, and a browser root must land INSIDE it
  // rather than beside it — that is what makes the runner's own cleanup carry it away.
  const root = browserTempRoot();
  assert.ok(root.startsWith(tmpdir() + "/"), `expected a root under ${tmpdir()}, got ${root}`);
});
