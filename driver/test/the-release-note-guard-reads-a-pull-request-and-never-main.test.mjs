// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE RELEASE-NOTE GUARD IS A GATE ONLY ON A PULL REQUEST'S OWN COMMITS, AND THIS FILE MAKES THAT HOLD.
//
// The guard asks each commit that ships code for its note. A squash commit adds every note its branch
// carried, so it "carries its own note", and a prose release line it inherited from a folded commit is
// excused. Measured on a simulated squash of an integration branch whose one offending commit the guard
// refused commit by commit: over the squash it passed. Nothing is broken while the guard runs where CI
// runs it, on the pull request's range, before the squash. These arms keep it there: the two readings
// side by side, the guard naming main's own line whenever it reads it, and the one place CI calls it.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { commitVerdicts } from "../../scripts/release-note-required.mjs";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");
const CHECK = join(ROOT, "scripts", "release-note-required.mjs");
const FILES = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).files;
const PROSE = "Release-note: A goods description sent under the older field name now reaches the search.";

test("the same change, read commit by commit, is refused; read as its squash, it is excused", () => {
  // THE LIMITATION, pinned so nobody mistakes the squash reading for a gate. The branch: one commit ships
  // code with its release note written as prose in the message, a later one adds a note file for
  // something else. The squash is those two folded into one commit.
  const branch = [
    { sha: "a".repeat(40), subject: "ship a fix", message: `ship a fix\n\n${PROSE}\n`, paths: ["driver/x.mjs"], added: [] },
    { sha: "b".repeat(40), subject: "note another change", message: "note another change\n",
      paths: [".changeset/other.md"], added: [".changeset/other.md"] },
  ];
  const squash = [{ sha: "c".repeat(40), subject: "the branch", message: `the branch\n\n${PROSE}\n`,
    paths: ["driver/x.mjs", ".changeset/other.md"], added: [".changeset/other.md"] }];
  const perCommit = commitVerdicts({ commits: branch, files: FILES });
  assert.deepEqual(perCommit.owed.map((o) => [o.sha[0], o.why]), [["a", "prose"]], "the pull request's reading must refuse the prose line");
  const folded = commitVerdicts({ commits: squash, files: FILES });
  assert.deepEqual(folded.owed, [], "if this reading ever refuses, the header's limitation is out of date — rewrite it, then this arm");
});

/** A repository whose `origin/main` carries a squash-shaped commit, and a branch off it. */
function repo() {
  const dir = mkdtempSync(join(tmpdir(), "ctnote-main-"));
  const git = (...a) => execFileSync("git", ["-c", "user.email=a@b.c", "-c", "user.name=t", ...a], { cwd: dir, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  writeFileSync(join(dir, "seed.txt"), "seed\n");
  git("add", "-A"); git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD").trim();
  mkdirSync(join(dir, "driver"), { recursive: true }); mkdirSync(join(dir, ".changeset"), { recursive: true });
  writeFileSync(join(dir, "driver", "x.mjs"), "export const x = 1;\n");
  writeFileSync(join(dir, ".changeset", "other.md"), "---\n\"clearotron-driver\": patch\n---\n\nFixed: something.\n");
  git("add", "-A"); git("commit", "-qm", `the branch\n\n${PROSE}`);
  const squash = git("rev-parse", "HEAD").trim();
  git("update-ref", "refs/remotes/origin/main", squash);
  return { dir, base, squash, clean: () => rmSync(dir, { recursive: true, force: true }) };
}
const run = (cwd, ...args) => spawnSync(process.execPath, [CHECK, ...args], { cwd, encoding: "utf8" });

test("pointed at main's own line, a pass comes with the sentence that says it is not the gate's reading", () => {
  // The squash here carries an inherited prose line and a note, which is exactly the shape that passes.
  // It is not refused, because reading main's squashes still catches one that shipped with no note at
  // all. But a pass over main's line must never be silent.
  const r = repo();
  try {
    const out = run(r.dir, "--base", r.base, "--head", "origin/main");
    assert.equal(out.status, 0, `${out.stdout}${out.stderr}`);
    assert.match(out.stdout, /NOT THE GATE'S READING: 1 commit\(s\) read here are on main's own line/);
    assert.match(out.stdout, /cannot find a prose release line the squash inherited/);
  } finally { r.clean(); }
});

test("on main itself the range is empty, and the guard says it read nothing rather than passing quietly", () => {
  const r = repo();
  try {
    const out = run(r.dir, "--base", "origin/main");
    assert.equal(out.status, 0, `${out.stdout}${out.stderr}`);
    assert.match(out.stdout, /nothing here to read/);
    assert.match(out.stdout, /main's history is never read/);
  } finally { r.clean(); }
});

test("CI runs the guard on the pull request's range in exactly one place, and no workflow runs it over main", () => {
  const dir = join(ROOT, ".github", "workflows");
  const workflows = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
  assert.ok(workflows.includes("ci.yml") && workflows.includes("release.yml"), "the workflows this arm reads have moved");
  const calls = workflows.flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n")
    .filter((l) => /release-note-required\.mjs/.test(l) && !/^\s*#/.test(l)).map((l) => ({ f, l: l.trim() })));
  assert.equal(calls.length, 1, `the guard is invoked ${calls.length} time(s): ${calls.map((c) => `${c.f}: ${c.l}`).join(" | ")}`);
  assert.equal(calls[0].f, "ci.yml");
  assert.match(calls[0].l, /--base "\$\{\{ github\.event\.pull_request\.base\.sha \|\| 'origin\/main' \}\}"/,
    "the one call must read the pull request's own range");
  assert.doesNotMatch(calls[0].l, /--head/, "a --head would let it read a range other than the pull request's");
});
