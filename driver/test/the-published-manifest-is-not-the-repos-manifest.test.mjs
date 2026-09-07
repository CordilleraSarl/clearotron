// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The published manifest is not this repository's manifest — tracker issue 180.
//
// ── the outage these arms are made of ───────────────────────────────────────────────────────────────
//
// `npm install clearotron` failed on every release from 0.1.1-beta.0 through 0.1.3 — five for five —
// with `npm error Unable to resolve reference $buffers`, before a single file was written. That string
// is what clearotron.ai's copy button puts on a visitor's clipboard and the first line of README.md.
//
// Nothing was red anywhere. The failure happens in npm's resolver before any of this product's code
// runs, so no product guard could see it; and every check in the release job passed, because each
// asked a question ABOUT the tarball and none of them installed it.
//
// ── WHY IT WAS NOT ONE RELEASE BUT FIVE ─────────────────────────────────────────────────────────────
//
// Two instruments existed and neither could speak. `scripts/pack-publishable.mjs` strips `overrides`
// and has since 2026-08-23 — it cannot run on the public tree, because it imports the withheld
// `cut/packed-artifact.mjs` and exits 2 without it. `scripts/verify-publishable.mjs` names this exact
// failure by its exact error string in its own header — and is invoked by no workflow and no npm
// script on main. Measured: every reference to it in the tree is prose or a comment.
//
// That is the same shape twice over — an instrument that exists, has stopped being reachable, and whose silence is indistinguishable from a pass, which is why these arms are placed where they are: the
// two that matter most read the WORKFLOW, because a correct script nothing calls is what shipped five
// broken releases.
//
// ── WHAT IS DRIVEN AND WHAT IS NOT, SAID RATHER THAN LEFT TO BE COUNTED ─────────────────────────────
//
// Three of the install check's four refusal branches are driven against real npm here: npm refusing,
// a declared command that never reached `.bin`, and the passing case. The fourth — npm exiting 0 with
// nothing under `node_modules` — is not, because producing it means lying to npm about a tarball's own
// name. It is two lines and it is stated here rather than counted as covered.
//
// The `$buffers` refusal itself is not reproduced in this suite: it needs a package with real
// dependencies and therefore a registry, and these arms run offline. It was measured on the real
// published bytes instead, and that measurement is what the release job now repeats on every publish:
//
//     the published 0.1.3 tarball, installed as a dependency      exit 1   Unable to resolve reference $buffers
//     the same tarball with its manifest sealed                   exit 0   added 96 packages, bin present

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { publishableManifest, STRIP_KEYS } from "../../scripts/pack-publishable.mjs";
import { sealTarball } from "../../scripts/release-artifact-seal.mjs";
import { installsAsADependency, manifestOf, binNames, looksLikeCouldNotLook }
  from "../../scripts/release-install-check.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RELEASE_YML = readFileSync(join(REPO, ".github", "workflows", "release.yml"), "utf8");
const CI_YML = readFileSync(join(REPO, ".github", "workflows", "ci.yml"), "utf8");

/** A real npm tarball, built on disk, from a manifest and a file list. */
function packTarball(dir, manifest, files = { "index.js": "module.exports = 1;\n" }) {
  const pkg = join(dir, "src", "package");
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const [rel, body] of Object.entries(files)) {
    const p = join(pkg, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  const tgz = join(dir, `${manifest.name}-${manifest.version}.tgz`);
  execFileSync("tar", ["-czf", tgz, "-C", join(dir, "src"), "package"]);
  return tgz;
}

/**
 * Run `fn` with npm held offline.
 *
 * These packages declare no dependencies, so an offline install is the same install — and the suite
 * must not need a registry to answer a question about packaging. `npm_config_offline` is how npm reads
 * the flag from the environment, which is the only way to reach the child this check spawns without
 * putting a test-shaped argument into the production one.
 */
function offline(fn) {
  const had = Object.hasOwn(process.env, "npm_config_offline");
  const saved = process.env.npm_config_offline;
  process.env.npm_config_offline = "true";
  try { return fn(); }
  finally { if (had) process.env.npm_config_offline = saved; else delete process.env.npm_config_offline; }
}

const scratch = () => mkdtempSync(join(tmpdir(), "manifest-arms-"));

test("the strip is one policy, and the repo manifest still carries what it strips", () => {
  const before = { name: "x", version: "1.0.0", overrides: { buffers: "$buffers" }, private: true, files: ["a"] };
  const after = publishableManifest(before);
  for (const k of STRIP_KEYS) {
    assert.equal(k in after, false, `${k} survived the published manifest`);
    assert.equal(k in before, true, "publishableManifest mutated its argument rather than copying it");
  }
  assert.deepEqual(after.files, ["a"], "the strip took something it was not asked for");
  assert.equal(after.name, "x");

  // AND THE REASON THE KEY IS THERE AT ALL. `overrides` pins the clean-room replacement for the
  // unlicensed `buffers@0.1.1` while resolving THIS tree. If it ever leaves package.json this arm
  // should be the thing that says so, because the fix for tracker issue 180 would then look like
  // deleting the key from the repository — which throws away the licence substitution to fix the
  // packaging, and both problems come back.
  const repo = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
  assert.ok(repo.overrides?.buffers,
    "package.json no longer pins `buffers`, so either the clean-room substitution went away or "
    + "somebody repaired the published manifest by breaking the repository's own resolution");
});

test("the seal rewrites the manifest inside real packed bytes", () => {
  const dir = scratch();
  try {
    const tgz = packTarball(dir, { name: "sealed-probe", version: "1.2.3",
      overrides: { buffers: "$buffers" }, dependencies: {}, keepMe: "yes" });
    assert.equal(manifestOf(tgz).overrides.buffers, "$buffers", "the fixture did not carry the key");

    const r = sealTarball(tgz);
    assert.deepEqual(r.stripped, ["overrides"]);
    assert.equal(r.name, "sealed-probe");

    // READ BACK OFF THE ARTEFACT, not off the return value. The defect being repaired here is a strip
    // everybody believed was happening; an arm that trusts the reporter has the same shape.
    const after = manifestOf(tgz);
    assert.equal("overrides" in after, false, "the key is still in the sealed tarball");
    assert.equal(after.keepMe, "yes", "the seal took a field that was not on the list");
    assert.equal(after.version, "1.2.3");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a tarball that is not an npm tarball is refused, not quietly sealed", () => {
  const dir = scratch();
  try {
    mkdirSync(join(dir, "src", "notpackage"), { recursive: true });
    writeFileSync(join(dir, "src", "notpackage", "a.txt"), "x\n");
    const tgz = join(dir, "wrong.tgz");
    execFileSync("tar", ["-czf", tgz, "-C", join(dir, "src"), "notpackage"]);
    assert.throws(() => sealTarball(tgz), /no package\/package\.json/,
      "a tarball with no manifest was sealed successfully, so the caller reads 0 as `the strip ran`");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the install check refuses in npm's own words when npm refuses", () => {
  const dir = scratch();
  try {
    // A manifest npm rejects without a registry, so this arm is a real npm refusal rather than a
    // stubbed one — the branch exists to carry npm's message out to a reader, and a stub cannot show
    // that it does.
    const tgz = packTarball(dir, { name: "refusing-probe", version: "1.0.0",
      dependencies: { "left-pad": "not a range at all" } });
    const r = offline(() => installsAsADependency(tgz));
    assert.equal(r.ok, false, "npm exited non-zero and the check called it an install that works");
    assert.match(r.why, /npm refused to install the packed artefact as a dependency/);
    assert.match(r.why, /EINVALIDTAGNAME|Invalid tag name/,
      "npm's own message did not reach the reader, so the failure arrives with no cause attached");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an install that exits 0 with the command missing is not a pass", () => {
  // MEASURED, and it is why this branch exists: npm exits 0 and creates no `.bin` at all when a
  // declared command's file did not travel. `npx clearotron demo` resolves through `.bin`, so that is
  // the front door still shut behind a green install — the same shape as the release this repairs.
  const dir = scratch();
  try {
    const tgz = packTarball(dir, { name: "ghost-probe", version: "1.0.0", bin: { "ghost-cmd": "bin/nope.mjs" } });
    const r = offline(() => installsAsADependency(tgz));
    assert.equal(r.ok, false, "the package installed, its command did not, and the check said yes");
    assert.deepEqual(r.missingBins, ["ghost-cmd"]);
    assert.match(r.why, /\.bin/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("and it passes an artefact that really installs, with its command in place", () => {
  const dir = scratch();
  try {
    const tgz = packTarball(dir,
      { name: "good-probe", version: "2.3.4", bin: { "good-cmd": "bin/cli.mjs" } },
      { "bin/cli.mjs": "#!/usr/bin/env node\nconsole.log('ok')\n" });
    const r = offline(() => installsAsADependency(tgz));
    assert.equal(r.ok, true, `a working artefact was refused: ${r.why}`);
    assert.equal(r.installed.version, "2.3.4", "the check reported on something other than these bytes");
    assert.deepEqual(r.missingBins, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("`bin` is read in both of its shapes, because one of them has no names in it", () => {
  assert.deepEqual(binNames({ name: "x", bin: { a: "a.js", b: "b.js" } }), ["a", "b"]);
  assert.deepEqual(binNames({ name: "clearotron", bin: "bin/clearotron.mjs" }), ["clearotron"],
    "the string form of `bin` takes its command name from the package name, and that name is what a "
    + "visitor types");
  assert.deepEqual(binNames({ name: "@scope/thing", bin: "x.js" }), ["thing"], "the scope reached .bin");
  assert.deepEqual(binNames({ name: "x" }), []);
});

test("every publishing job seals BEFORE anything measures the artefact", () => {
  // Order is the design and it is invisible in the file unless somebody asks. A seal after the scans
  // would publish bytes that nothing scanned, which is the invariant the pack step's own comment states
  // — and it is the kind of comment that stays true only because an arm holds it.
  //
  // ── ASKED OF EVERY PUBLISHING JOB, NOT OF THE FILE (tracker issue 208) ──────────────────────────
  //
  // This read the anchors from the whole workflow and required each to be UNIQUE — a sound way to be
  // sure a position belonged to the step it was named for, in a file that is mostly prose. A second
  // publishing job was added on 2026-09-06 and every anchor appeared twice, so the arm fired on the
  // duplication rather than on any ordering fault.
  //
  // Widening it to "somewhere in the file, pack comes before seal" would have made it pass and measure
  // nothing: with two jobs, the first job's pack precedes the second job's seal no matter how badly the
  // second job is ordered. So the uniqueness requirement moves INSIDE each job, where it still means
  // what it meant, and the ordering is asserted once per job that publishes.
  const jobs = [...RELEASE_YML.matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_-]*):$/gm)];
  const blocks = jobs.map((m, i) => [m[1], RELEASE_YML.slice(m.index, i + 1 < jobs.length ? jobs[i + 1].index : RELEASE_YML.length)])
    .filter(([, text]) => /\bnpm\s+publish\b/.test(text) && /release-install-check\.mjs/.test(text));
  assert.ok(blocks.length >= 1, "no job in the release workflow publishes — this arm could not look");

  for (const [id, job] of blocks) {
    const at = (label, needle) => {
      const first = job.indexOf(needle);
      assert.ok(first > 0, `job \`${id}\` has no ${label} step — the anchor moved or the step is gone`);
      assert.equal(job.indexOf(needle, first + 1), -1,
        `${label}'s anchor ${JSON.stringify(needle)} appears more than once inside job \`${id}\`, so its position is not a step's`);
      return first;
    };
    const pack = at("pack", "- name: Pack the exact bytes that will be published");
    const seal = at("seal", "node scripts/release-artifact-seal.mjs");
    const scan = at("secret scan", "- name: No secret leaves in the packed bytes");
    const complete = at("completeness", "node scripts/release-completeness-check.mjs --tarball");
    const check = at("install check", "node scripts/release-install-check.mjs");
    const publish = at("publish", "- name: Publish to npm through Trusted Publishing");
    assert.ok(pack < seal && seal < scan,
      `in job \`${id}\` the seal does not sit between the pack and the scan, so the bytes that are `
      + "scanned are not the bytes that are published");
    assert.ok(complete < check && check < publish,
      `in job \`${id}\` the install check does not run before the publish, which is the only placement `
      + "that can stop a broken release — five went out with every other check green");
  }
});

test("every step handles the one artefact, and the check never runs a rehearsal", () => {
  // ONE TARBALL. A step that packs or names its own would certify bytes nobody publishes, which is
  // exactly how a correct strip came to be applied to nothing.
  const publishJob = RELEASE_YML.slice(RELEASE_YML.indexOf("  publish:"));
  assert.ok(publishJob.length > 500, "the publish job's anchor moved, so this arm is reading the wrong text");
  for (const script of ["release-artifact-seal.mjs", "release-completeness-check.mjs", "release-install-check.mjs"]) {
    const line = publishJob.split("\n").find((l) => l.includes(script));
    assert.ok(line, `${script} is not invoked by the publish job`);
    assert.match(line, /--tarball "\$\{\{ steps\.what\.outputs\.tarball \}\}"/,
      `${script} is pointed at something other than the artefact this run publishes`);
  }

  // AND NOT `--dry-run`, WHICH IS THE CHEAP WAY TO MAKE THIS CHECK FAST AND WRONG. Measured on the
  // real published 0.1.3: `npm install clearotron@0.1.3 --dry-run` exits 0 and the same command
  // without it exits 1. A gate carrying the flag is green on all five broken releases.
  const checkSrc = readFileSync(join(REPO, "scripts", "release-install-check.mjs"), "utf8");
  const flagged = checkSrc.split("\n")
    .filter((l) => l.includes("--dry-run") && !l.trimStart().startsWith("//"));
  assert.deepEqual(flagged, [],
    "the install check passes --dry-run to npm, which does not perform the resolution that aborts");
});

test("the gate is asked on the pull request too, not only at the release", () => {
  // A CHECK ABSENT FROM EXACTLY THE RUN THAT NEEDED IT (tracker issue 189). Wired into the release
  // workflow alone, this gate would first speak on the release that carries the fault — after the
  // author has moved on, and where the only remedy is another release. CI already packs a tarball for
  // the completeness check one line above, so asking there costs one more install and reaches the
  // person still holding the change. It is also what would have turned the pull request that
  // introduced the release pipeline red, instead of five published packages nobody could install.
  const lines = CI_YML.split("\n").filter((l) => !/^\s*#/.test(l));
  const at = (needle) => lines.findIndex((l) => l.includes(needle));
  const pack = at("npm pack --pack-destination ./packed");
  const seal = at("node scripts/release-artifact-seal.mjs");
  const check = at("node scripts/release-install-check.mjs");
  assert.ok(pack >= 0, "CI no longer packs a tarball, so there is nothing for these two to read");
  assert.ok(seal > pack,
    "CI does not seal the tarball it packed. `overrides` resolves only in this tree, so the packed "
    + "bytes are expected to refuse an install until the seal runs — without it the check below reds "
    + "on every pull request and gets deleted for being wrong");
  assert.ok(check > seal,
    "CI never installs the artefact it packed, which is the one question none of the other checks ask "
    + "and the reason five releases went out uninstallable");

  // THE SAME TARBALL. A second pack here would certify bytes the step above never saw.
  for (const script of ["release-artifact-seal.mjs", "release-install-check.mjs"]) {
    const line = lines.find((l) => l.includes(script));
    assert.match(line, /--tarball "\.\/packed\/\$\{TARBALL\}"/,
      `${script} in ci.yml is pointed at something other than the tarball that step packed`);
  }
});

test("a relative tarball path is the caller's, not the install's", () => {
  // THE MEMBER EVERY ARM ABOVE MISSED, and CI caught it on the first run. Each of them handed the
  // check an absolute temp path; ci.yml hands it `./packed/clearotron-<version>.tgz`. npm resolves a
  // file path against ITS OWN cwd, which is the throwaway consumer project, so it looked for `packed/`
  // in there and reported ENOENT — a working artefact refused, in the vocabulary of one that will not
  // install. An arm that quantifies over "a tarball" has to be given a different SHAPE of path, not
  // another tarball.
  const dir = scratch();
  const cwd = process.cwd();
  try {
    const tgz = packTarball(dir,
      { name: "relative-probe", version: "1.0.0", bin: { "rel-cmd": "bin/cli.mjs" } },
      { "bin/cli.mjs": "#!/usr/bin/env node\nconsole.log('ok')\n" });
    process.chdir(dir);
    const r = offline(() => installsAsADependency(`./${tgz.split("/").pop()}`));
    assert.equal(r.ok, true,
      `a tarball named by a path relative to the CALLER was refused: ${r.why}`);
    assert.equal(r.installed.name, "relative-probe");
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  }
});

// THE ARM THAT WAS HERE IS DELETED RATHER THAN KEPT AS COVERAGE. It drove `sealTarball` with a relative
// path and asserted the same property as the one above. Planted against — `resolve()` removed from the
// seal — it stayed GREEN, because that function never changes directory, so a relative path reaches
// `tar` unharmed either way. There is no failure mode there to arm today. The `resolve()` in the seal
// stays as the one-line closure of a class that IS live one file over; it is defensive and unarmed, and
// that is said here rather than implied by a test that cannot fail.

test("a registry it could not reach is not a broken package", () => {
  // THREE-VALUED, BECAUSE THIS RUNS ON EVERY PULL REQUEST. npm exits non-zero for a DNS failure, a
  // registry timeout, a 503, a full disk — none of them a fact about these bytes. Reported as "this is
  // what a visitor gets", each one accuses the artefact of a fault it does not have, and a gate that
  // cries wolf on infrastructure is a gate somebody deletes. The first real CI run proved the risk
  // rather than the theory: an ENOENT caused by the CALLER came out as a refusal about the package.
  //
  // The strings are npm's own, measured rather than guessed.
  assert.equal(looksLikeCouldNotLook("npm error code ENOTCACHED\nnpm error request to "
    + "https://registry.npmjs.org/left-pad failed: cache mode is 'only-if-cached'"), true);
  for (const said of ["npm error code ENOTFOUND", "npm error code ETIMEDOUT", "npm error code ECONNRESET",
    "npm error code EAI_AGAIN", "npm error code ENOSPC", "npm error syscall open\nnpm error code ENOENT"]) {
    assert.equal(looksLikeCouldNotLook(said), true, `${said} was read as a verdict about the artefact`);
  }

  // AND THE ONES THAT REALLY ARE ABOUT THE BYTES STAY REFUSALS. Widening this predicate until a broken
  // package reads as could-not-look is the failure in the other direction, and it publishes.
  for (const said of ['npm error code EINVALIDTAGNAME\nnpm error Invalid tag name "not a range at all"',
    "npm error code EINTEGRITY", "npm error TAR_BAD_ARCHIVE: Unrecognized archive format",
    "npm error Unable to resolve reference $buffers"]) {
    assert.equal(looksLikeCouldNotLook(said), false,
      `${said} was excused as a could-not-look, so a package that genuinely will not install publishes`);
  }
});

test("and it answers could-not-look on a real npm that cannot reach anything", () => {
  // DRIVEN, not asserted from the predicate above: the branch has to be reachable from the install
  // path, and a classifier nothing routes to is the same as no classifier. `npm_config_offline` with a
  // dependency that is not in the cache is npm genuinely unable to look.
  const dir = scratch();
  try {
    const tgz = packTarball(dir, { name: "unreachable-probe", version: "1.0.0",
      dependencies: { "a-package-no-cache-here-holds": "1.0.0" } });
    const r = offline(() => installsAsADependency(tgz));
    assert.equal(r.ok, false);
    assert.equal(r.couldNotLook, true,
      `npm could not reach the registry and the check called the artefact broken: ${r.why}`);
    assert.match(r.why, /not about these bytes/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("and npm's own refusal is still a refusal, not an excuse", () => {
  // The pair to the arm above, on the same code path: the EINVALIDTAGNAME case must come back as a
  // verdict about the bytes. Without this, widening the could-not-look predicate would go unnoticed —
  // and a package that refuses to install would publish with the gate green.
  const dir = scratch();
  try {
    const tgz = packTarball(dir, { name: "still-refusing-probe", version: "1.0.0",
      dependencies: { "left-pad": "not a range at all" } });
    const r = offline(() => installsAsADependency(tgz));
    assert.equal(r.ok, false);
    assert.equal(r.couldNotLook, false, "a malformed manifest was excused as an unreachable registry");
    assert.match(r.why, /npm refused to install the packed artefact/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the exit codes CI reads carry the house meanings", () => {
  // THE THREE ANSWERS AS A CALLER SEES THEM. Everything above tests the function; the workflow reads
  // the process's status, and a branch that returns the right object under an exit code nobody set is
  // the same silence one layer down. Driven through the command line, which is how CI invokes it.
  const dir = scratch();
  const run = (args, env = {}) => {
    try {
      execFileSync(process.execPath, [join(REPO, "scripts", "release-install-check.mjs"), ...args],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } });
      return { code: 0, said: "" };
    } catch (e) { return { code: e.status, said: `${e.stdout ?? ""}${e.stderr ?? ""}` }; }
  };
  try {
    assert.equal(run(["--tarball", join(dir, "not-there.tgz")]).code, 2,
      "a tarball that is not there exited something other than 2 — a could-not-look read as a verdict");

    const unreachable = packTarball(dir, { name: "exit-probe-unreachable", version: "1.0.0",
      dependencies: { "a-package-no-cache-here-holds": "1.0.0" } });
    const cnl = run(["--tarball", unreachable], { npm_config_offline: "true" });
    assert.equal(cnl.code, 2, `an unreachable registry exited ${cnl.code}: ${cnl.said.slice(-300)}`);
    assert.match(cnl.said, /COULD NOT LOOK/);

    const good = packTarball(dir, { name: "exit-probe-good", version: "1.0.0" },
      { "index.js": "module.exports = 1;\n" });
    assert.equal(run(["--tarball", good], { npm_config_offline: "true" }).code, 0,
      "an artefact that installs did not exit 0");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an install this gave up waiting for is a could-not-look too", () => {
  // THE MEMBER THE CLASSIFIER WAS NOT WRITTEN FOR, and does carry. A check that only read npm's message
  // would blame the artefact for a slow network or a loaded machine, so this was first repaired with a
  // second branch reading `e.signal` — which planted GREEN, because Node hands back `spawnSync npm
  // ETIMEDOUT` and the predicate already matches it. The branch went; this arm stayed, because what it
  // pins is real and was not pinned before: a fifteen-minute hang takes exactly this path.
  const dir = scratch();
  try {
    const tgz = packTarball(dir, { name: "timeout-probe", version: "1.0.0" });
    const r = offline(() => installsAsADependency(tgz, { timeoutMs: 1 }));
    assert.equal(r.ok, false);
    assert.equal(r.couldNotLook, true,
      `npm was killed before it could answer and the check blamed the artefact: ${r.why}`);
    assert.match(r.why, /not about these bytes/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── TWO INSTRUMENTS THAT COULD NOT SPEAK ────────────────────────────────────────
//
// `scripts/verify-publishable.mjs` is the most thorough instrument this repository has for the packaged
// artefact: it installs the tarball into a tree that has never seen this checkout, types every verb, and
// holds the clean-room licence substitution end to end. It was invoked by NOTHING — no workflow, no npm
// script, every other mention of its name a comment — while five uninstallable releases shipped past it.
// That is the shape where an instrument exists, stops being reachable, and its silence reads as a pass.
//
// AND IT COULD NOT HAVE RUN IF WIRED, because the pack it shells out to needs a table the cut withheld.
// Reviving that reconcile on a public tree is explicitly out of this issue's scope, so the fix is that
// the script SAYS SO — an absence with a reason beside it is a different thing from a gap.
//
// BREAK MATRIX:
//   · the script refuses rather than passing when it cannot pack  → break: exit 0, arm 1 red
//   · the refusal is could-not-look, not failure                  → break: exit 1, arm 1 red
//   · it names what is missing and what stays unproven            → break: a bare message, arm 1 red
//   · the strip invariant asks only about keys actually stripped  → break: read STRIP_KEYS, arm 2 red
test("196 verify-publishable REFUSES on a tree it cannot pack, and says so as a could-not-look", (ctx) => {
  const script = join(REPO, "scripts", "verify-publishable.mjs");
  assert.ok(existsSync(script), "the instrument this arm is about is gone");
  const r = spawnSync(process.execPath, [script], { encoding: "utf8", timeout: 120_000 });
  const said = `${r.stdout ?? ""}${r.stderr ?? ""}`;

  // A TREE THAT CAN PACK IS NOT THIS ARM'S SUBJECT — and the bail is a SKIP, not a bare `return`.
  //
  // `node:test` counts a bare return as a PASS, so the first cut of this reported its subject clean
  // having measured none of it. `driver/test/a-bail-on-an-unmeetable-precondition-is-a-skip.test.mjs`
  // caught it in CI, correctly, and this is the shape it exists for: an arm that cannot look must say so
  // rather than go quiet. Same rule the script under test now follows one layer down.
  //
  // When the cut table arrives, or the pack stops needing it, this script becomes runnable and this arm
  // should be deleted with the block it guards — said here rather than left for a reader to infer.
  if (existsSync(join(REPO, "cut", "packed-artifact.mjs")))
    return ctx.skip("this tree carries cut/packed-artifact.mjs, so the pack does not refuse and this "
      + "arm's subject — a script declaring why it cannot run — does not exist here");

  assert.equal(r.status, 2,
    `a checker that cannot look must exit 2, the house meaning — 0 is the silence this issue is about, `
    + `1 would claim a failure it did not measure. Got ${r.status}:\n${said.slice(0, 600)}`);
  // IT NAMES WHAT IS MISSING, so a reader is not sent looking.
  assert.match(said, /cut[/\\]packed-artifact\.mjs/, `the refusal does not name the table it needs:\n${said}`);
  // AND WHAT STAYS UNPROVEN, which is the half that makes this a finding rather than a shrug. A refusal
  // that says only "I cannot run" invites the reader to conclude nothing is at stake.
  assert.match(said, /NOT a pass/, `the refusal does not say it is not a pass:\n${said}`);
  assert.match(said, /verb|substitution/, `the refusal does not say what is left unproven:\n${said}`);
});

test("196 the strip invariant asks about keys it actually stripped, not about a policy list", () => {
  // `STRIP_KEYS` is the POLICY — what to remove from the published manifest IF PRESENT — and it still
  // carries `private` so that a tree reintroducing that flag produces a publishable tarball. The
  // invariant underneath it read the same list as a list of keys the REPOSITORY must HOLD, and `private`
  // has not been in the manifest since publishing moved into CI. So the pack refused on every tree that
  // got past the cut check, over a key the product deliberately no longer carries.
  //
  // "Strip this if you find it" and "refuse unless this exists" are different claims; one list was
  // answering both.
  const src = readFileSync(join(REPO, "scripts", "pack-publishable.mjs"), "utf8");
  assert.match(src, /const lost = stripped\.filter/,
    "the invariant reads a policy list again — a key the manifest legitimately lacks will refuse the pack");
  assert.ok(!/const lost = STRIP_KEYS\.filter/.test(src),
    "the invariant is back to demanding every policy key be present in the repo manifest");
  // THE POLICY ITSELF DID NOT SHRINK, which is the half a fix could get wrong in the tidy direction:
  // dropping `private` from STRIP_KEYS would make a tree that reintroduced the flag unpublishable.
  assert.ok(STRIP_KEYS.includes("private"),
    "`private` left the strip policy — a tree that reintroduces the flag would now pack an unpublishable tarball");
  assert.ok(STRIP_KEYS.includes("overrides"),
    "`overrides` left the strip policy — this is the key whose presence made five releases uninstallable");
});
