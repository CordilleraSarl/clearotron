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

/** A repository with one commit on `base`, then one commit per entry, oldest first. */
function repoWithCommits(list) {
  const dir = mkdtempSync(join(tmpdir(), "ctnote-"));
  const git = (...a) => execFileSync("git", ["-c", "user.email=a@b.c", "-c", "user.name=t", ...a],
    { cwd: dir, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  writeFileSync(join(dir, "seed.txt"), "seed\n");
  git("add", "-A"); git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD").trim();
  const shas = [];
  for (const { changes, message } of list) {
    for (const [path, body] of Object.entries(changes)) {
      mkdirSync(join(dir, dirname(path)), { recursive: true });
      writeFileSync(join(dir, path), body);
    }
    git("add", "-A"); git("commit", "-qm", message);
    shas.push(git("rev-parse", "--short=7", "HEAD").trim());
  }
  return { dir, base, shas, clean: () => rmSync(dir, { recursive: true, force: true }) };
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
    ".changeset/a-note.md": '---\n"clearotron-driver": patch\n---\n\nFixed: Something a reader can see.\n',
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
    "driver/package.json": '{"name":"clearotron-driver","version":"0.1.5"}\n',
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
test("replayed against the bundle that landed with no note, it refuses", (ctx) => {
  // THIS ARM WAS ASSERTING NOTHING, and the way it failed is the thing worth keeping. It ran the check
  // with `--base 14e3822^` and no head, so the range ran from that merge's parent to whatever branch the
  // suite was on — which reaches the branch's OWN notes and passes, correctly, having answered a
  // different question. The only assertion was `status !== 2`, a could-not-look it could not have hit.
  // So an arm named for the acceptance test would have reported it met for the life of the branch.
  // `--head` exists so the range can actually be named; the assertion is now the refusal itself.
  const has = spawnSync("git", ["cat-file", "-e", "14e3822^{commit}"], { cwd: ROOT }).status === 0;
  if (!has) return ctx.skip("this clone's history does not reach 14e3822^, so the range this check was "
    + "written against cannot be read here — a shallow clone, and not a pass");
  const r = spawnSync(process.execPath, [CHECK, "--base", "14e3822^", "--head", "14e3822"],
    { cwd: ROOT, encoding: "utf8", timeout: 60_000, env: { ...process.env } });
  const said = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  assert.notEqual(r.status, 2, `the check could not read that range:\n${said}`);
  assert.equal(r.status, 1,
    `the check does not refuse the range it was written for — sixteen files that ship as code and not `
    + `one note between them:\n${said}`);
  assert.match(said, /owe a release note/);
  assert.match(said, /14e3822 /, `the refusal does not name the commit that owes the note:\n${said}`);
  assert.match(said, /0 release note\(s\) in the range/,
    `the replay found notes in a range that had none, so it is not reading the range it names:\n${said}`);
});

// ── PER COMMIT, NOT PER RANGE ─────────────────────────────────────────────────────────────────────────
//
// The arm that stood here passed this branch's own range as the control for the refusal above. Its range
// ran from 14e3822 to wherever the suite was, so under a per-commit rule it asked every commit since about
// its own note. The arms below are the control now, each on a range it builds and can name.
const NOTE = '---\n"clearotron-driver": patch\n---\n\nFixed: Something a reader can see.\n';

test("a declination answers for its own commit: fourteen that decline do not carry a fifteenth that ships a change", () => {
  const list = Array.from({ length: 14 }, (_, n) => ({
    changes: { [`bin/internal-${n}.mjs`]: `export const n = ${n};\n` },
    message: `internal ${n}\n\nRelease-note: none — plumbing ${n} that no reader sees.\n`,
  }));
  list.splice(7, 0, { changes: { "bin/visible.mjs": "export const seen = true;\n" }, message: "a change a reader sees" });
  const repo = repoWithCommits(list);
  try {
    const r = run(repo);
    assert.equal(r.code, 1, `fourteen declinations carried a fifteenth commit with no note:\n${r.said}`);
    assert.match(r.said, new RegExp(`${repo.shas[7]} a change a reader sees`), `the refusal does not name the commit:\n${r.said}`);
    assert.match(r.said, /bin\/visible\.mjs/);
    assert.match(r.said, /^1 commit\(s\) that ship as code owe a release note/m, `it refused more than the one commit:\n${r.said}`);
  } finally { repo.clean(); }
});

test("a range where every commit that ships code declines with its own reason passes, and prints each reason", () => {
  const repo = repoWithCommits([1, 2, 3].map((n) => ({
    changes: { [`bin/internal-${n}.mjs`]: `export const n = ${n};\n` },
    message: `internal ${n}\n\nRelease-note: none — reason number ${n}.\n`,
  })));
  try {
    const r = run(repo);
    assert.equal(r.code, 0, `a range that declined commit by commit was refused:\n${r.said}`);
    for (const n of [1, 2, 3]) assert.match(r.said, new RegExp(`reason number ${n}`));
  } finally { repo.clean(); }
});

test("a note the range adds answers for a commit that ships code and says nothing", () => {
  const repo = repoWithCommits([
    { changes: { "bin/a.mjs": "export const a = 1;\n" }, message: "the change" },
    { changes: { ".changeset/the-change.md": NOTE }, message: "its note" },
  ]);
  try {
    const r = run(repo);
    assert.equal(r.code, 0, `a change with its note in the same range was refused:\n${r.said}`);
  } finally { repo.clean(); }
});

test("a Release-note line with a sentence in it is refused and named, even when another commit adds a note", () => {
  // The owner's-walk shape: seven such lines and one note, and the seven reached no reader.
  const repo = repoWithCommits([
    { changes: { "bin/stop.mjs": "export const stop = 1;\n" }, message: "stop\n\nRelease-note: The Stop button now stops the run.\n" },
    { changes: { ".changeset/other.md": NOTE }, message: "a note for something else" },
  ]);
  try {
    const r = run(repo);
    assert.equal(r.code, 1, `a release note written only in a commit message was accepted:\n${r.said}`);
    assert.match(r.said, new RegExp(`${repo.shas[0]} stop`));
    assert.match(r.said, /reaches no\s+reader/);
  } finally { repo.clean(); }
});

test("a commit that adds its own note may say so in a Release-note line too", () => {
  const repo = repoWithCommits([
    { changes: { "bin/a.mjs": "export const a = 1;\n", ".changeset/a.md": NOTE }, message: "a\n\nRelease-note: Fixed the thing, see the note.\n" },
  ]);
  try {
    const r = run(repo);
    assert.equal(r.code, 0, `a commit carrying its own note was refused for describing it:\n${r.said}`);
  } finally { repo.clean(); }
});

test("a Release-note line may name the note that answers for it, and naming one the range does not add is refused", () => {
  const good = repoWithCommits([
    { changes: { "bin/a.mjs": "export const a = 1;\n" }, message: "a\n\nRelease-note: .changeset/shared.md\n" },
    { changes: { "bin/b.mjs": "export const b = 1;\n", ".changeset/shared.md": NOTE }, message: "b, and the note both answer to" },
  ]);
  const bad = repoWithCommits([
    { changes: { "bin/a.mjs": "export const a = 1;\n" }, message: "a\n\nRelease-note: .changeset/nowhere.md\n" },
    { changes: { ".changeset/shared.md": NOTE }, message: "a note by another name" },
  ]);
  try {
    assert.equal(run(good).code, 0, "a commit naming the note the range adds was refused");
    const r = run(bad);
    assert.equal(r.code, 1, `a commit naming a note the range does not add was accepted:\n${r.said}`);
    assert.match(r.said, /nowhere\.md/);
  } finally { good.clean(); bad.clean(); }
});
