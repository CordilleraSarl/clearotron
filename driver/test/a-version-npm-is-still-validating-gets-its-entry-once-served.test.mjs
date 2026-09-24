// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A version npm is still validating gets its release entry once npm serves it.
//
// Measured on the 0.3.3 stable, 2026-09-23: npm accepted the publish and showed the version as
// "Validating" on npmjs.com for close to an hour. The publish job's wait for a stranger to get the bytes
// ended first, the job failed, and nothing ran again, so the version was published and tagged with no
// release entry, and the releases page went on naming 0.3.2 as the latest. The entry was written by hand.
//
// The scheduled `entry` job now finishes it. This file drives what it decides, what it runs against a
// fake `gh` and a stubbed registry check, and the arms that keep it a job that publishes nothing.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";
import { decide } from "../../scripts/release-entry-catch-up.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKFLOW = readFileSync(join(ROOT, ".github", "workflows", "release.yml"), "utf8");
const DIR = mkdtempSync(join(tmpdir(), "entry-catch-up-test-"));
after(() => rmSync(DIR, { recursive: true, force: true }));

const HOUR = 3600;
const BOUND = 6 * HOUR;
const NOTES = "**Searches**\n\n- Two-letter marks now search.\n";

// ── WHAT IT DECIDES ─────────────────────────────────────────────────────────────────────────────────

test("an untagged version, or one that already has its entry, is left alone", () => {
  assert.deepEqual(
    [decide({ tagged: false, entryExists: false, keptBytes: false, visibleExit: null, ageSec: null, boundSec: BOUND }).action,
     decide({ tagged: true, entryExists: true, keptBytes: false, visibleExit: null, ageSec: null, boundSec: BOUND }).action],
    ["none", "none"]);
});

test("a tagged version with no entry gets one only when the registry serves the kept bytes", () => {
  const base = { tagged: true, entryExists: false, keptBytes: true, ageSec: HOUR, boundSec: BOUND };
  assert.deepEqual(decide({ ...base, visibleExit: 0 }), { action: "create", exit: 0, why: "the registry serves the published bytes" });
  const young = decide({ ...base, visibleExit: 1 });
  assert.equal(young.action, "wait", "a version npm is still validating inside the bound must wait, not fail");
  assert.equal(young.exit, 0);
});

test("still not served past the bound is red, and a check that could not look is never a pass", () => {
  const base = { tagged: true, entryExists: false, keptBytes: true, boundSec: BOUND };
  const old = decide({ ...base, visibleExit: 1, ageSec: 7 * HOUR });
  assert.deepEqual([old.action, old.exit], ["report", 1]);
  assert.match(old.why, /7 h ago/);
  for (const visibleExit of [2, null, 137]) {
    const blind = decide({ ...base, visibleExit, ageSec: HOUR });
    assert.deepEqual([blind.action, blind.exit], ["report", 2], `a registry check that ended ${visibleExit} was read as an answer`);
  }
});

test("a registry serving different bytes is red at once, however young the tag", () => {
  const d = decide({ tagged: true, entryExists: false, keptBytes: true, visibleExit: 3, ageSec: 60, boundSec: BOUND });
  assert.deepEqual([d.action, d.exit], ["report", 1], "different bytes were read as pending, which waits six hours on a wrong tarball");
  assert.match(d.why, /DIFFERENT BYTES/);
});

test("a tagged version with no kept bytes is reported, never created on a guess", () => {
  const d = decide({ tagged: true, entryExists: false, keptBytes: false, visibleExit: null, ageSec: HOUR, boundSec: BOUND });
  assert.deepEqual([d.action, d.exit], ["report", 1]);
  assert.match(d.why, /by hand/);
});

// ── WHAT IT RUNS ────────────────────────────────────────────────────────────────────────────────────

/** A zip of `[name, data]` files, stored uncompressed: the shape a downloaded artifact arrives in. */
function zipOf(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, data] of files) {
    const n = Buffer.from(name), crc = crc32(data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, n, data); centrals.push(central, n);
    offset += local.length + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const REPO_ID = 1357491783;
const TAG_SHA = "d571d0ee" + "0".repeat(32);

/**
 * One kept artifact and the run that made it. The default is the release run's own: the release workflow
 * on this repository's main, scheduled, at the tagged commit. `bytes` is what its tarball holds.
 */
const keptBy = (id, over = {}) => ({ id, fork: false, branch: "main", path: ".github/workflows/release.yml", event: "schedule",
  relation: "identical", bytes: null, ...over });

/** The arms below drive the script against a fake `gh`, which only a POSIX machine can run. */
const FAKE_GH_IS_POSIX = process.platform === "win32"
  && "the fake `gh` is a `#!/bin/sh` script put first on a `:`-separated PATH; Windows runs neither, and would reach the real GitHub CLI instead";

/**
 * Run the real script in a tree of its own: main's package.json at `version`, the registry check and the
 * notes stubbed, and a fake `gh` on PATH that answers as the arm says GitHub did and logs every call.
 * `kept` lists the `published-<version>` artifacts GitHub holds, highest id first, as GitHub lists them.
 */
function driveCatchUp({ version, tag = true, entry = false, kept = [keptBy(7)], sbom = false, visibleExit = 0, ageHours = 1, args = [] }) {
  const dir = mkdtempSync(join(DIR, "run-"));
  for (const d of ["scripts", "shared", "bin", "zips"]) mkdirSync(join(dir, d));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "clearotron", version }));
  copyFileSync(join(ROOT, "scripts", "release-entry-catch-up.mjs"), join(dir, "scripts", "release-entry-catch-up.mjs"));
  copyFileSync(join(ROOT, "shared", "is-entrypoint.mjs"), join(dir, "shared", "is-entrypoint.mjs"));
  const log = join(dir, "gh.log"), asked = join(dir, "visible.log"), notesSeen = join(dir, "notes.seen"), sbomSeen = join(dir, "sbom.seen");
  writeFileSync(join(dir, "scripts", "release-visible-check.mjs"),
    `import { appendFileSync, readFileSync } from "node:fs";\nconst a = process.argv.slice(2);\n`
    + `const t = a[a.indexOf("--tarball") + 1];\n`
    + `appendFileSync(${JSON.stringify(asked)}, a.join(" ") + " BYTES=" + readFileSync(t, "utf8") + "\\n");\n`
    + `process.exit(${visibleExit});\n`);
  writeFileSync(join(dir, "scripts", "release-notes-for.mjs"), `process.stdout.write(${JSON.stringify(NOTES)});\n`);
  const when = new Date(Date.now() - ageHours * HOUR * 1000).toISOString();
  const tagAnswer = tag === true ? `printf '%s\\n' refs/tags/v${version}; exit 0`
    : tag === "error" ? `echo 'HTTP 502: Bad Gateway' >&2; exit 1` : `echo 'gh: Not Found (HTTP 404)' >&2; exit 1`;
  const viewAnswer = entry === true ? "exit 0" : entry === "error" ? `echo 'HTTP 502: Bad Gateway' >&2; exit 1` : `echo 'release not found' >&2; exit 1`;
  const api = "api repos/CordilleraSarl/clearotron";
  const answers = [];
  const listed = kept.map((k) => {
    const runId = k.id * 10, headSha = `run${k.id}`.padEnd(40, "0"), headRepo = k.fork ? 99 : REPO_ID;
    const files = [[`clearotron-${version}.tgz`, Buffer.from(k.bytes ?? `bytes of ${version}`)]];
    if (sbom) files.push([`clearotron-${version}.cdx.json`, Buffer.from(`{"bomFormat":"CycloneDX","from":${k.id}}`)]);
    writeFileSync(join(dir, "zips", `${k.id}.zip`), zipOf(files));
    const run = { id: runId, path: k.path, event: k.event, head_branch: k.branch, head_sha: headSha, head_repository: { id: headRepo } };
    answers.push(`  "${api}/actions/artifacts/${k.id}/zip") cat ${JSON.stringify(join(dir, "zips", `${k.id}.zip`))}; exit 0 ;;`,
      `  "${api}/actions/runs/${runId}") printf '%s' '${JSON.stringify(run)}'; exit 0 ;;`,
      `  "${api}/compare/${headSha}...${TAG_SHA}") printf '%s\\n' ${k.relation}; exit 0 ;;`);
    return { id: k.id, name: `published-${version}`, expired: false,
      workflow_run: { id: runId, repository_id: REPO_ID, head_repository_id: headRepo, head_branch: k.branch, head_sha: headSha } };
  });
  // GitHub's pages of 100, each carrying the whole count, and an empty page past the end.
  const pages = [];
  for (let i = 0; i === 0 || i < listed.length; i += 100) pages.push(listed.slice(i, i + 100));
  pages.push([]);
  const pageAnswers = pages.map((p, n) =>
    `  "${api}/actions/artifacts?name=published-${version}&per_page=100&page=${n + 1}") printf '%s' '${JSON.stringify({ total_count: listed.length, artifacts: p })}'; exit 0 ;;`);
  writeFileSync(join(dir, "bin", "gh"),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(log)}\n`
    + `if [ "$1" = release ] && [ "$2" = create ]; then\n`
    + `  prev=; for a in "$@"; do [ "$prev" = --notes-file ] && cat "$a" > ${JSON.stringify(notesSeen)}; case "$a" in *.cdx.json) cat "$a" > ${JSON.stringify(sbomSeen)} ;; esac; prev=$a; done; exit 0\nfi\n`
    + `case "$1 $2" in\n`
    + `  "release view") ${viewAnswer} ;;\n`
    + `  "${api}") printf '%s\\n' ${REPO_ID}; exit 0 ;;\n`
    + `  "${api}/git/ref/tags/v${version}") ${tagAnswer} ;;\n`
    + `${pageAnswers.join("\n")}\n`
    + `${answers.join("\n")}\n`
    + `  "${api}/commits/v${version}") printf '%s %s\\n' ${TAG_SHA} ${when}; exit 0 ;;\n`
    + `esac\necho "fake gh: nothing answers $*" >&2\nexit 1\n`, { mode: 0o755 });
  const res = spawnSync(process.execPath, [join(dir, "scripts", "release-entry-catch-up.mjs"), ...args], {
    cwd: dir, encoding: "utf8",
    env: { PATH: `${join(dir, "bin")}:${process.env.PATH}`, HOME: dir, TMPDIR: dir, GITHUB_REPOSITORY: "CordilleraSarl/clearotron" },
  });
  const read = (f) => (existsSync(f) ? readFileSync(f, "utf8") : "");
  return { status: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}`, log: read(log), asked: read(asked), notes: read(notesSeen), sbom: read(sbomSeen) };
}

const creates = (log) => log.split("\n").filter((l) => l.startsWith("release create"));

test("a beta npm now serves gets a pre-release entry from the changelog, checked against the bytes its publish kept", { skip: FAKE_GH_IS_POSIX }, () => {
  const run = driveCatchUp({ version: "9.9.9-beta.3" });
  assert.equal(run.status, 0, run.out);
  assert.match(run.asked, /--version 9\.9\.9-beta\.3 --tag beta --tarball \S+clearotron-9\.9\.9-beta\.3\.tgz .* BYTES=bytes of 9\.9\.9-beta\.3/,
    `the registry check was not handed the kept bytes of this version\n${run.asked}`);
  const made = creates(run.log);
  assert.equal(made.length, 1, run.log);
  assert.match(made[0], /^release create v9\.9\.9-beta\.3 --repo CordilleraSarl\/clearotron --verify-tag --title v9\.9\.9-beta\.3 --notes-file \S+ --prerelease$/);
  assert.equal(run.notes, NOTES, "the entry does not carry the changelog's section for the version");
});

test("the parts list kept beside the bytes rides on the entry as an asset", { skip: FAKE_GH_IS_POSIX }, () => {
  const run = driveCatchUp({ version: "9.9.9-beta.3", sbom: true });
  assert.equal(run.status, 0, run.out);
  const made = creates(run.log);
  assert.equal(made.length, 1, run.log);
  assert.match(made[0], /^release create v9\.9\.9-beta\.3 \S+\/clearotron-9\.9\.9-beta\.3\.cdx\.json --repo /,
    `the entry was written without the parts list its publish kept:\n${made[0]}`);
});

test("a stable npm now serves gets an ordinary entry, and asks the registry for `latest`", { skip: FAKE_GH_IS_POSIX }, () => {
  const run = driveCatchUp({ version: "9.9.9" });
  assert.equal(run.status, 0, run.out);
  assert.match(run.asked, /--version 9\.9\.9 --tag latest /);
  const made = creates(run.log);
  assert.equal(made.length, 1, run.log);
  assert.doesNotMatch(made[0], /--prerelease/, "a stable was flagged as a pre-release, so GitHub would never name it latest");
});

test("not served yet inside the bound waits green, and past the bound fails red, with no entry either way", { skip: FAKE_GH_IS_POSIX }, () => {
  const young = driveCatchUp({ version: "9.9.9", visibleExit: 1, ageHours: 1 });
  assert.equal(young.status, 0, young.out);
  assert.match(young.out, /::notice::v9\.9\.9: npm has not served it yet/);
  const old = driveCatchUp({ version: "9.9.9", visibleExit: 1, ageHours: 7 });
  assert.equal(old.status, 1, old.out);
  assert.match(old.out, /::error::v9\.9\.9: tagged 7 h ago and the registry still does not serve these bytes/);
  assert.deepEqual([creates(young.log), creates(old.log)], [[], []]);
});

test("an entry that exists, or a version never tagged, is left alone without reading any bytes", { skip: FAKE_GH_IS_POSIX }, () => {
  for (const arm of [{ entry: true }, { tag: false }]) {
    const run = driveCatchUp({ version: "9.9.9", ...arm });
    assert.equal(run.status, 0, run.out);
    assert.doesNotMatch(run.log, /actions\/artifacts/, `${JSON.stringify(arm)}: it went looking for bytes it has no use for\n${run.log}`);
    assert.deepEqual(creates(run.log), []);
  }
});

test("a tagged version whose bytes were not kept is red and names the hand step", { skip: FAKE_GH_IS_POSIX }, () => {
  const run = driveCatchUp({ version: "9.9.9", kept: [] });
  assert.equal(run.status, 1, run.out);
  assert.match(run.out, /::error::v9\.9\.9: tagged with no release entry, and no kept bytes/);
  assert.equal(run.asked, "", "the registry check ran with no bytes to compare against");
  assert.deepEqual(creates(run.log), []);
});

test("a fork's artifact of the same name is refused, even when it is the newer one, and the release run's own is used", { skip: FAKE_GH_IS_POSIX }, () => {
  const run = driveCatchUp({ version: "9.9.9-beta.3", sbom: true,
    kept: [keptBy(9, { fork: true, bytes: "a stranger's bytes" }), keptBy(7)] });
  assert.equal(run.status, 0, run.out);
  assert.match(run.asked, /BYTES=bytes of 9\.9\.9-beta\.3\n$/, `the registry check was handed bytes the release run did not keep\n${run.asked}`);
  assert.doesNotMatch(run.log, /artifacts\/9\/zip|runs\/90/, "the fork's artifact was downloaded, or its run read, although the list already said where it came from");
  assert.match(run.out, /::warning::release-entry-catch-up: refused artifact 9 named published-9\.9\.9-beta\.3: it was made by a run from another repository/);
  assert.equal(creates(run.log).length, 1, run.log);
  assert.match(run.sbom, /"from":7\}/, `the entry carries a parts list the release run did not keep: ${run.sbom}`);
});

test("an artifact is used only when the release workflow made it on this repository's main, at the tagged commit or behind it", { skip: FAKE_GH_IS_POSIX }, () => {
  const refused = {
    "a fork's pull request": [{ fork: true }, /made by a run from another repository/],
    "a run on another branch": [{ branch: "feature" }, /made by a run on `feature`, not on main/],
    "another workflow": [{ path: ".github/workflows/ci.yml" }, /made by \.github\/workflows\/ci\.yml, not the release workflow/],
    "a pull-request run": [{ event: "pull_request" }, /made by a pull_request run, which never publishes/],
    "a commit off the tag's line": [{ relation: "diverged" }, /not the tagged commit or behind it \(diverged\)/],
    "a commit after the tag": [{ relation: "behind" }, /not the tagged commit or behind it \(behind\)/],
  };
  for (const [arm, [over, why]] of Object.entries(refused)) {
    const run = driveCatchUp({ version: "9.9.9", kept: [keptBy(7, over)] });
    assert.equal(run.status, 1, `${arm}\n${run.out}`);
    assert.match(run.out, why, `${arm}: not refused, or refused for another reason\n${run.out}`);
    assert.match(run.out, /::error::v9\.9\.9: tagged with no release entry, and no kept bytes/, arm);
    assert.equal(run.asked, "", `${arm}: the registry check was handed bytes a run other than the release run kept`);
    assert.doesNotMatch(run.log, /actions\/artifacts\/7\/zip/, `${arm}: the refused artifact was downloaded`);
    assert.deepEqual(creates(run.log), [], arm);
  }
});

test("a hundred uploads under the same name do not push the release run's own artifact out of reach", { skip: FAKE_GH_IS_POSIX }, () => {
  const flood = Array.from({ length: 100 }, (_, i) => keptBy(1000 - i, { fork: true, bytes: "a stranger's bytes" }));
  const run = driveCatchUp({ version: "9.9.9-beta.3", kept: [...flood, keptBy(7)] });
  assert.equal(run.status, 0, run.out.slice(-2000));
  assert.match(run.log, /per_page=100&page=2/, "the second page of the list was never read");
  assert.match(run.asked, /BYTES=bytes of 9\.9\.9-beta\.3\n$/, "the registry check was not handed the release run's bytes");
  assert.equal((run.out.match(/::warning::release-entry-catch-up: refused artifact/g) ?? []).length, 100);
  assert.doesNotMatch(run.log, /artifacts\/(9\d\d|1000)\/zip/, "an upload from a fork was downloaded");
  assert.equal(creates(run.log).length, 1, run.log.slice(-2000));
});

test("a cut's publish, which runs on the commit before the version commit it tags, is the release run", { skip: FAKE_GH_IS_POSIX }, () => {
  const run = driveCatchUp({ version: "9.9.9-beta.3", kept: [keptBy(7, { event: "workflow_dispatch", relation: "ahead" })] });
  assert.equal(run.status, 0, run.out);
  assert.equal(creates(run.log).length, 1, run.log);
});

test("GitHub failing to answer is a check that could not look (exit 2), never 'no entry' and never 'past the bound'", { skip: FAKE_GH_IS_POSIX }, () => {
  for (const arm of [{ tag: "error" }, { entry: "error" }]) {
    const run = driveCatchUp({ version: "9.9.9", ...arm });
    assert.equal(run.status, 2, `${JSON.stringify(arm)}\n${run.out}`);
    assert.deepEqual(creates(run.log), [], `${JSON.stringify(arm)}: an entry was written over a read that failed`);
  }
});

test("--dry-run runs the check and writes no entry", { skip: FAKE_GH_IS_POSIX }, () => {
  const run = driveCatchUp({ version: "9.9.9", args: ["--dry-run"] });
  assert.equal(run.status, 0, run.out);
  assert.notEqual(run.asked, "");
  assert.deepEqual(creates(run.log), []);
});

// ── THE JOB'S ARMS ──────────────────────────────────────────────────────────────────────────────────

/** A job's text, from its key to the next job's key. */
function job(name) {
  const start = WORKFLOW.indexOf(`\n  ${name}:\n`);
  assert.ok(start > 0, `the release workflow has no \`${name}\` job`);
  const rest = WORKFLOW.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][a-z-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

test("the entry job runs only on the schedule, only in the product repository, and runs the catch-up", () => {
  const entry = job("entry");
  assert.match(entry, /\n {4}if: github\.repository == 'CordilleraSarl\/clearotron' && github\.event_name == 'schedule'\n/);
  assert.match(entry, /run: node scripts\/release-entry-catch-up\.mjs\n/);
  assert.match(entry, /ref: \$\{\{ github\.sha \}\}/, "the job must read the version on the commit the schedule fired for");
});

test("the entry job can write an entry and read artifacts, and nothing else: no publish, no install, no id-token", () => {
  const entry = job("entry");
  const perms = entry.match(/\n {4}permissions:\n((?: {6}.+\n)+)/);
  assert.ok(perms, entry);
  assert.deepEqual(perms[1].trim().split("\n").map((l) => l.trim()).sort(), ["actions: read", "contents: write"]);
  assert.doesNotMatch(entry, /id-token|npm (ci|install|publish)|NODE_AUTH_TOKEN/,
    "the entry job gained a way to publish or to run a package's install scripts beside its write token");
});

test("each publishing job keeps the exact bytes it published, under the name the entry job asks for", () => {
  for (const name of ["publish", "publish-awaited"]) {
    const text = job(name);
    const pub = text.indexOf("- name: Publish to npm through Trusted Publishing");
    const keep = text.indexOf("- name: Keep the published bytes for the scheduled entry job");
    assert.ok(pub > 0 && keep > pub, `${name}: the bytes are not kept after the publish`);
    const step = text.slice(keep, text.indexOf("\n\n", keep));
    assert.match(step, /name: published-\$\{\{ steps\.what\.outputs\.version \}\}/, `${name}\n${step}`);
    assert.match(step, /path: \|\n\s+\$\{\{ steps\.what\.outputs\.tarball \}\}\n/, `${name}: the kept file is not the tarball the publish step published`);
    assert.match(step, /if-no-files-found: error/, `${name}: a missing tarball would upload nothing and say nothing`);
    assert.match(text.slice(pub, keep), /npm publish "\.\/\$\{\{ steps\.what\.outputs\.tarball \}\}"/, `${name}: the publish step no longer publishes that tarball`);
  }
});
