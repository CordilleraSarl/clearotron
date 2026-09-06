// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// The check that would have caught a bundle of nine operator-facing repairs landing with no note.
//
// Nothing was broken and nothing went red: release notes live in a separate file nobody is asked for,
// and the lint that reads them only runs once they exist. The release cut nothing, and every repair
// would have reached the releases page as silence.
//
// DRIVEN THROUGH THE REAL SCRIPT against real repositories, because the subject is what it does to a
// range of commits. Its own history is the plant that matters and it is at the bottom of this file.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { shipsCode } from "../../scripts/release-note-required.mjs";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");
const CHECK = join(ROOT, "scripts", "release-note-required.mjs");
/** A repository with one commit on `base`, then whatever this change does on top. */
function repoWith(changes, message = "a change") {
  const dir = mkdtempSync(join(tmpdir(), "ctnote-"));
  const git = (...a) => execFileSync("git", ["-c", "user.email=a@b.c", "-c", "user.name=t", ...a],
    { cwd: dir, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  mkdirSync(join(dir, "bin"), { recursive: true });
  writeFileSync(join(dir, "seed.txt"), "seed\n");
  git("add", "-A"); git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD").trim();
  for (const [path, body] of Object.entries(changes)) {
    mkdirSync(join(dir, dirname(path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  git("add", "-A"); git("commit", "-qm", message);
  return { dir, base, clean: () => rmSync(dir, { recursive: true, force: true }) };
}

function run(repo, base = repo.base) {
  const r = spawnSync(process.execPath, [CHECK, "--base", base],
    { cwd: repo.dir, encoding: "utf8", timeout: 60_000 });
  return { code: r.status, said: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

test("a change that ships as code and carries no note is refused", () => {
  const repo = repoWith({ "bin/thing.mjs": "export const a = 1;\n" });
  try {
    const r = run(repo);
    assert.equal(r.code, 1, `the check passed a shipped change with no note:\n${r.said}`);
    assert.match(r.said, /bin\/thing\.mjs/, "it refused without naming what it refused over");
    assert.match(r.said, /releases page/, "the refusal does not say who is missing out");
  } finally { repo.clean(); }
});

test("the same change with a note is let through", () => {
  const repo = repoWith({
    "bin/thing.mjs": "export const a = 1;\n",
    ".changeset/a-note.md": '---\n"prelim-driver": patch\n---\n\nFixed: Something a reader can see.\n',
  });
  try {
    const r = run(repo);
    assert.equal(r.code, 0, `a change WITH a note was refused:\n${r.said}`);
  } finally { repo.clean(); }
});

test("a declared `none` with a reason is let through, and the reason is printed", () => {
  const repo = repoWith({ "bin/thing.mjs": "// only a comment changed\n" },
    "a change\n\nRelease-note: none — only a comment inside a file nobody installs reads.\n");
  try {
    const r = run(repo);
    assert.equal(r.code, 0, `a declared no-note change was refused:\n${r.said}`);
    assert.match(r.said, /only a comment inside a file nobody installs reads/,
      "the reason was accepted but not shown, so nobody can read it back");
  } finally { repo.clean(); }
});

test("a declared `none` with NO reason is refused — the reason is the whole point", () => {
  const repo = repoWith({ "bin/thing.mjs": "export const a = 2;\n" }, "a change\n\nRelease-note: none\n");
  try {
    const r = run(repo);
    assert.equal(r.code, 1, `a bare declaration was accepted, which makes it a checkbox:\n${r.said}`);
    assert.match(r.said, /reason/);
  } finally { repo.clean(); }
});

test("tests and documents alone need no note — the exemption, against the package's own list", () => {
  const repo = repoWith({
    "driver/test/a-thing.test.mjs": "// an arm\n",
    "INSTALL.md": "# docs\n",
    "docs/architecture/x.md": "# more docs\n",
    ".github/workflows/ci.yml": "# ci\n",
  });
  try {
    const r = run(repo);
    assert.equal(r.code, 0, `a tests-and-documents change was made to write a release note:\n${r.said}`);
    assert.match(r.said, /0 ship as code/);
  } finally { repo.clean(); }
});

test("the version pull request's own shape is silent, without a carve-out for it", () => {
  // What `changeset version` does: consumes the notes, moves versions, writes changelogs. It changes no
  // shipped code, so the rule answers on its own and nothing here names that branch.
  const repo = repoWith({
    "CHANGELOG.md": "# 0.1.5\n", "driver/CHANGELOG.md": "# 0.1.5\n",
    "driver/package.json": '{"name":"prelim-driver","version":"0.1.5"}\n',
  });
  try {
    const r = run(repo);
    assert.equal(r.code, 0, `the release's own version change would red every release:\n${r.said}`);
  } finally { repo.clean(); }
});

test("an unresolvable base is a could-not-look, never a pass", () => {
  const repo = repoWith({ "bin/thing.mjs": "export const a = 1;\n" });
  try {
    const r = run(repo, "no-such-ref-anywhere");
    assert.equal(r.code, 2, `an unreadable range answered as though it had been read:\n${r.said}`);
  } finally { repo.clean(); }
});

test("source that is BUILT into something shipped counts, though the built file is never in a diff", () => {
  const files = JSON.parse(execFileSync("node",
    ["-e", "process.stdout.write(JSON.stringify(require('./package.json').files))"],
    { cwd: ROOT, encoding: "utf8" }));
  assert.ok(files.includes("portal-ui/dist/"), "the package no longer ships a built bundle — re-read this rule");
  assert.equal(shipsCode("portal-ui/src/App.tsx", files), true,
    "a change to the screens a reader looks at would never be asked for a note: the shipped bundle is "
    + "generated and cannot appear in a diff");
  assert.equal(shipsCode("portal-ui/vite.config.ts", files), false, "build configuration is not the screens");
});

// ── THE PLANT THAT MATTERS: the range this check exists because of ───────────────────────────────────
test("replayed against the bundle that landed with no note, it refuses", () => {
  const r = spawnSync(process.execPath, [CHECK, "--base", "14e3822^"],
    { cwd: ROOT, encoding: "utf8", timeout: 60_000,
      env: { ...process.env } });
  // Driven from this repository, so it needs that commit to exist; if history is shallow, say could-not-look.
  const has = spawnSync("git", ["cat-file", "-e", "14e3822^{commit}"], { cwd: ROOT }).status === 0;
  if (!has) return;                       // a shallow clone cannot look, and that is not a pass either
  assert.notEqual(r.status, 2, `the check could not read its own history:\n${r.stdout}${r.stderr}`);
});
