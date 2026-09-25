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
import { shipsCode, NO_NOTE } from "../../scripts/release-note-required.mjs";

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
      if (body === null) { rmSync(join(dir, path)); continue; }   // null deletes the file
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

test("a bare `none` is bare even when another line follows it: the reason is read from its own line", () => {
  const repo = repoWith({ "bin/thing.mjs": "export const a = 3;\n" },
    "a change\n\nRelease-note: none\n\nCo-Authored-By: A Name <a@b.c>\n");
  try {
    const r = run(repo);
    assert.equal(r.code, 1, `the line after a bare \`none\` was read as its reason:\n${r.said}`);
    assert.match(r.said, /gives no reason/);
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

const NOTE_BODY = (says) => `---\n"clearotron-driver": patch\n---\n\nFixed: ${says}\n`;

test("a note the range only DELETES, or only edits, answers for no commit in it", () => {
  // `diff-tree` lists deletions and edits beside additions. Read as notes, a range whose only note was one it
  // removed answered for every code commit in it, and editing another change's note counted as carrying
  // one. Neither reaches a reader of this range. Found in review, 2026-09-10.
  const OLD = ".changeset/an-older-change.md";
  const deleted = repoWithCommits([
    { changes: { [OLD]: NOTE_BODY("an older change.") }, message: "An older change's note" },
    { changes: { [OLD]: null }, message: "Remove a note" },
    { changes: { "bin/thing.mjs": "export const a = 1;\n" }, message: "A change a reader sees" },
  ]);
  try {
    const r = run(deleted, deleted.shas[0]);
    assert.equal(r.code, 1, `a note the range deletes answered for it:\n${r.said}`);
    assert.match(r.said, new RegExp(`${deleted.shas[2]} A change a reader sees`));
  } finally { deleted.clean(); }
  const edited = repoWithCommits([
    { changes: { [OLD]: NOTE_BODY("an older change.") }, message: "An older change's note" },
    { changes: { [OLD]: NOTE_BODY("an older change, said better."), "bin/thing.mjs": "export const a = 1;\n" },
      message: "A change a reader sees, and a touch to another change's note" },
  ]);
  try {
    const r = run(edited, edited.shas[0]);
    assert.equal(r.code, 1, `editing another change's note counted as carrying one:\n${r.said}`);
    assert.match(r.said, new RegExp(`${edited.shas[1]} A change a reader sees`));
  } finally { edited.clean(); }
});

test("a note the range adds and then removes answers for nothing; one it adds and keeps still answers", () => {
  const NOTE = ".changeset/this-change.md";
  const gone = repoWithCommits([
    { changes: { [NOTE]: NOTE_BODY("this change."), "bin/thing.mjs": "export const a = 1;\n" }, message: "A change a reader sees" },
    { changes: { [NOTE]: null }, message: "Remove the note again" },
  ]);
  try {
    const r = run(gone);
    assert.equal(r.code, 1, `a note the head no longer carries answered:\n${r.said}`);
  } finally { gone.clean(); }
  // THE CONTROL: the same range with the note kept, and edited afterwards, passes. Without it the two arms
  // above would pass on a check that refused every range.
  const kept = repoWithCommits([
    { changes: { [NOTE]: NOTE_BODY("this change."), "bin/thing.mjs": "export const a = 1;\n" }, message: "A change a reader sees" },
    { changes: { [NOTE]: NOTE_BODY("this change, said better.") }, message: "Say it better" },
  ]);
  try {
    const r = run(kept);
    assert.equal(r.code, 0, `a note the range adds and the head keeps must answer:\n${r.said}`);
  } finally { kept.clean(); }
});

test("a note the range withdraws, saying why, still answers for the commits that wrote and named it", () => {
  // The shape a ruling makes, and the whole of it: a note is written beside its change, CONSUMED into
  // `.changeset/pre/` by the beta cut that ships it, and then removed from there when the owner rules the
  // change back out — so the stable changelog never announces a limit the stable release does not have.
  // Before this, both commits were refused for naming a note the range no longer carried, and the only
  // fix the check offered was editing commits already pushed. Measured on beta-9, 2026-09-18.
  const NAME = "no-ceiling-on-any-query.md";
  const NOTE = `.changeset/${NAME}`, CONSUMED = `.changeset/pre/${NAME}`;
  const repo = repoWithCommits([
    { changes: { "bin/cap.mjs": "export const ceiling = 200;\n", [NOTE]: NOTE_BODY("a ceiling on each query.") },
      message: "A ceiling on each query" },
    { changes: { "bin/plan.mjs": "export const plan = 1;\n" },
      message: `The other half of the same guardrail\n\nRelease-note: ${NOTE}\n` },
    { changes: { [NOTE]: null, [CONSUMED]: NOTE_BODY("a ceiling on each query.") }, message: "Release 0.0.1-beta.1" },
    { changes: { [CONSUMED]: null },
      message: "Remove the beta's note for the ceiling\n\nRelease-note: none — the ceiling went out with the owner's ruling; its beta note goes with it so the stable changelog does not announce one.\n" },
  ]);
  try {
    const r = run(repo);
    assert.equal(r.code, 0, `a note the range withdrew with a reason answered for nobody:\n${r.said}`);
    for (const i of [0, 1]) {
      assert.match(r.said, new RegExp(`${repo.shas[i]} answered with ${NAME}, which ${repo.shas[3]}`),
        `the pass is silent about which commit withdrew the note it was reached through:\n${r.said}`);
    }
    assert.match(r.said, /the stable changelog does not announce one/, `the withdrawing commit's reason is not printed:\n${r.said}`);
  } finally { repo.clean(); }
});

test("a withdrawal that gives no reason refuses, and names the commit that can still give one", () => {
  // THE HALF THAT MAKES THE OTHER ONE SAFE. Without it, deleting a note is a way to excuse every commit
  // that answered with it, and the reader loses the sentence with nothing written down about why.
  const NAME = "the-note.md";
  const repo = repoWithCommits([
    { changes: { "bin/thing.mjs": "export const a = 1;\n", [`.changeset/${NAME}`]: NOTE_BODY("the thing.") },
      message: "A change a reader sees" },
    { changes: { [`.changeset/${NAME}`]: null }, message: "Remove the note" },
  ]);
  try {
    const r = run(repo);
    assert.equal(r.code, 1, `a note deleted with no reason given excused the commit that wrote it:\n${r.said}`);
    assert.match(r.said, new RegExp(`${repo.shas[0]} A change a reader sees`));
    assert.match(r.said, new RegExp(`${repo.shas[1]} deletes in this range without saying why`),
      `the refusal does not say where the reason goes:\n${r.said}`);
  } finally { repo.clean(); }
});

test("a note already gone before a commit names it is no answer for that commit", () => {
  // A withdrawal answers only for what came BEFORE it. A commit naming a note the range disposed of
  // earlier is naming nothing, whatever reason the disposal gave.
  const NAME = "an-older-note.md";
  const repo = repoWithCommits([
    { changes: { [`.changeset/${NAME}`]: NOTE_BODY("something else.") }, message: "An older note" },
    { changes: { [`.changeset/${NAME}`]: null },
      message: "Drop it\n\nRelease-note: none — it described something that never shipped.\n" },
    { changes: { "bin/late.mjs": "export const late = 1;\n" },
      message: `A later change\n\nRelease-note: .changeset/${NAME}\n` },
  ]);
  try {
    const r = run(repo);
    assert.equal(r.code, 1, `a commit was excused by a deletion that happened before it:\n${r.said}`);
    assert.match(r.said, new RegExp(`${repo.shas[2]} A later change`));
  } finally { repo.clean(); }
});

test("`none.` is followed by its reason, not by the full stop", () => {
  assert.equal(NO_NOTE.exec("Release-note: none. The docs only.")?.groups.reason, "The docs only.");
  assert.equal(NO_NOTE.exec("Release-note: none — the docs only.")?.groups.reason, "the docs only.");
  assert.equal(NO_NOTE.exec("Release-note: none.")?.groups.reason, undefined, "a full stop alone is still a bare none");
});

test("a note a PRE-RELEASE has consumed still answers for the commit that wrote it", () => {
  // changesets in pre mode does not delete the note it publishes. It MOVES it, from
  // `.changeset/<name>.md` into `.changeset/pre/<name>.md`, and re-applies every one of them when the
  // pre range is exited — so the note reaches a reader twice, once in the pre-release and once in the
  // stable cut it rolls into.
  //
  // THE SHAPE HAS TO BE THE REAL ONE, and the first version of this arm was not. The move happens on
  // MAIN, before the range: a branch writes the note, main cuts a beta and consumes it, the branch
  // merges main and the merge resolves the note to main's consumed copy. So the range ADDS the note at
  // its normal path, the head carries it only under `pre/`, and nothing in the range adds the `pre/`
  // copy. Putting the move inside the range instead lets the old code pass for an unrelated reason —
  // the commit doing the moving counts as adding a note — and the arm certifies nothing. Measured: the
  // first version passed with the fix reverted.
  const NOTE = ".changeset/this-change.md";
  const CONSUMED = ".changeset/pre/this-change.md";
  const cut = repoWithCommits([
    { changes: { [CONSUMED]: NOTE_BODY("this change.") }, message: "A beta cut consumed this note" },
    { changes: { [NOTE]: NOTE_BODY("this change."), "bin/thing.mjs": "export const a = 1;\n" }, message: "A change a reader sees" },
    { changes: { [NOTE]: null }, message: "Merge main, resolving the note to the consumed copy" },
  ]);
  try {
    const r = run(cut, cut.shas[0]);
    assert.equal(r.code, 0, `a note a pre-release consumed no longer answered for its commit:\n${r.said}`);
  } finally { cut.clean(); }

  // THE CONTROL, and it is the half that matters: matching on the NAME must not turn "the note is
  // gone" into "the note is somewhere". Nothing of that name anywhere under .changeset/ is still
  // refused, or this fix would green-light every range that removes its own note.
  const deleted = repoWithCommits([
    { changes: { "seed2.txt": "x\n" }, message: "Nothing to do with notes" },
    { changes: { [NOTE]: NOTE_BODY("this change."), "bin/thing.mjs": "export const a = 1;\n" }, message: "A change a reader sees" },
    { changes: { [NOTE]: null }, message: "Remove the note outright" },
  ]);
  try {
    const r = run(deleted, deleted.shas[0]);
    assert.equal(r.code, 1, `a note deleted outright answered for its commit:\n${r.said}`);
  } finally { deleted.clean(); }
});

// ── A LATER COMMIT MAY ANSWER A BARE `none` FOR ONE NAMED COMMIT ──────────────────────────────────────
// A bare `none` merged into an integration branch that a second branch was already built on: the only fix
// the check offered was a rewrite of the shared branch. The answer is a later commit's
// `Release-note-for: <sha> none — <reason>`, held to the rules in the script's header.

/** Steps on top of a base commit; a message may be a function of the shas so far; `empty` commits nothing. */
function repoWithSteps(steps) {
  const dir = mkdtempSync(join(tmpdir(), "ctnote-"));
  const git = (...a) => execFileSync("git", ["-c", "user.email=a@b.c", "-c", "user.name=t", ...a],
    { cwd: dir, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  writeFileSync(join(dir, "seed.txt"), "seed\n");
  git("add", "-A"); git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD").trim();
  const shas = [];
  for (const step of steps) {
    if (step.checkout) { git("checkout", "-q", ...step.checkout); continue; }
    if (step.merge) { git("merge", "-q", "--no-ff", "-m", "merge", step.merge); continue; }
    for (const [path, body] of Object.entries(step.changes ?? {})) {
      mkdirSync(join(dir, dirname(path)), { recursive: true });
      writeFileSync(join(dir, path), body);
    }
    const message = typeof step.message === "function" ? step.message(shas) : step.message;
    git("add", "-A"); git("commit", "-q", ...(step.empty ? ["--allow-empty"] : []), "-m", message);
    shas.push(git("rev-parse", "HEAD").trim());
  }
  return { dir, base, shas, git, clean: () => rmSync(dir, { recursive: true, force: true }) };
}
const BARE = { changes: { "bin/thing.mjs": "export const a = 1;\n" }, message: "A change\n\nRelease-note: none\n" };
const answering = (i, reason = "only a comment's wording changed; nothing a user sees.") =>
  ({ empty: true, message: (s) => `Answer the note owed by the change\n\nRelease-note-for: ${s[i].slice(0, 7)} none — ${reason}\n` });

test("a later commit answers a bare `none` for the commit it names, prints who answered, and owes nothing itself", () => {
  const repo = repoWithSteps([BARE, answering(0)]);
  try {
    const r = run(repo);
    assert.equal(r.code, 0, `a named answer from a later commit was not taken:\n${r.said}`);
    assert.match(r.said, new RegExp(`${repo.shas[0].slice(0, 7)} said a bare \`none\`, which ${repo.shas[1].slice(0, 7)} answers: only a comment's wording changed`),
      `the pass is silent about which commit answered:\n${r.said}`);
    assert.doesNotMatch(r.said, /owe a release note/, "the empty answering commit was asked for a note of its own");
  } finally { repo.clean(); }
});

test("an answer naming a commit outside the range is refused, and names the commit that carries it", () => {
  const repo = repoWithSteps([BARE, { empty: true, message: "Answer\n\nRelease-note-for: PLACEHOLDER none — a reason.\n" }]);
  try {
    // re-point the answer at the base commit, which is outside base..head
    repo.git("commit", "-q", "--amend", "--allow-empty", "-m", `Answer\n\nRelease-note-for: ${repo.base.slice(0, 9)} none — a reason.\n`);
    const r = run(repo);
    assert.equal(r.code, 1, `an answer naming a commit outside the range was taken:\n${r.said}`);
    assert.match(r.said, /is not a commit in this range/);
    assert.match(r.said, /owe a release note/, "the bare commit is still owed");
  } finally { repo.clean(); }
});

test("an answer with no reason, or only a dash, is refused, read by the same rule as an inline `none`", () => {
  for (const tail of ["none", "none —", "none -"]) {
    const repo = repoWithSteps([BARE, { empty: true, message: (s) => `Answer\n\nRelease-note-for: ${s[0].slice(0, 7)} ${tail}\n` }]);
    try {
      const r = run(repo);
      assert.equal(r.code, 1, `"${tail}" was taken as an answer:\n${r.said}`);
      assert.match(r.said, /gives no reason/);
    } finally { repo.clean(); }
  }
});

test("an answer from a commit the named one is not an ancestor of is refused: ancestry, never order", () => {
  // the bare commit sits on a side branch; the answer is on main before the side branch is merged in
  const repo = repoWithSteps([
    { checkout: ["-b", "side"] }, BARE,
    { checkout: ["main"] },
    { empty: true, message: (s) => `Answer early\n\nRelease-note-for: ${s[0].slice(0, 7)} none — a reason given too soon.\n` },
    { merge: "side" },
  ]);
  try {
    const r = run(repo);
    assert.equal(r.code, 1, `an answer from off the named commit's history was taken:\n${r.said}`);
    assert.match(r.said, /not an earlier commit on this commit's own history/);
  } finally { repo.clean(); }
});

test("one line answers one commit, and one commit takes one answer", () => {
  const two = repoWithSteps([BARE, { ...BARE, changes: { "bin/other.mjs": "export const b = 1;\n" } },
    { empty: true, message: (s) => `Answer both\n\nRelease-note-for: ${s[0].slice(0, 7)} ${s[1].slice(0, 7)} none — a reason.\n` }]);
  try {
    const r = run(two);
    assert.equal(r.code, 1, `one line answered two commits:\n${r.said}`);
    assert.match(r.said, /one line answers one commit/);
  } finally { two.clean(); }
  const twice = repoWithSteps([BARE, answering(0, "the first reason."), answering(0, "the first reason.")]);
  try {
    const r = run(twice);
    assert.equal(r.code, 1, `two answers for one commit were taken:\n${r.said}`);
    assert.match(r.said, /one of 2 answers naming/);
  } finally { twice.clean(); }
  const one = repoWithSteps([BARE, { ...BARE, changes: { "bin/other.mjs": "export const b = 2;\n" } }, answering(0)]);
  try {
    const r = run(one);
    assert.equal(r.code, 1, `one answer covered two bare commits:\n${r.said}`);
    assert.match(r.said, new RegExp(`${one.shas[1].slice(0, 7)} A change`), "the unanswered commit is not the one named as owing");
    assert.match(r.said, new RegExp(`${one.shas[0].slice(0, 7)} said a bare`), "the answered one is not printed as answered");
  } finally { one.clean(); }
});

test("an answer naming a commit that owes none is refused as stale, never ignored", () => {
  const reasoned = { changes: { "bin/thing.mjs": "export const a = 3;\n" }, message: "A change\n\nRelease-note: none — only a comment.\n" };
  const quiet = { changes: { "docs/notes.txt": "words\n" }, message: "A document" };
  for (const named of [reasoned, quiet]) {
    const repo = repoWithSteps([named, answering(0)]);
    try {
      const r = run(repo);
      assert.equal(r.code, 1, `an answer to a commit that owed none passed in silence:\n${r.said}`);
      assert.match(r.said, /which owes no answer/);
    } finally { repo.clean(); }
  }
});

test("an answer naming a commit that owes a note of another kind is refused, and says what it owes", () => {
  const silent = { changes: { "bin/thing.mjs": "export const a = 4;\n" }, message: "A change" };
  const prose = { changes: { "bin/thing.mjs": "export const a = 5;\n" }, message: "A change\n\nRelease-note: things got better.\n" };
  for (const named of [silent, prose]) {
    const repo = repoWithSteps([named, answering(0)]);
    try {
      const r = run(repo);
      assert.equal(r.code, 1, `an answer excused a commit that owes a note:\n${r.said}`);
      assert.match(r.said, /owes a note this line cannot give: an answer covers only a bare `none`/);
      assert.doesNotMatch(r.said, /owes no answer/, "the refusal says the commit owes nothing when it owes a note");
    } finally { repo.clean(); }
  }
});

// ── …AND A LATER COMMIT MAY ANSWER A LINE THAT PROMISED A NOTE, BY NAMING THE NOTE THE RANGE ADDS ─────────

const PROMISED = { changes: { "bin/thing.mjs": "export const a = 6;\n" }, message: "A change\n\nRelease-note: to follow\n" };
const naming = (i, name = "drop.md", adds = true) => ({
  ...(adds ? { changes: { [`.changeset/${name}`]: "---\n\"clearotron\": patch\n---\n\nFixed: Reports read better.\n" } } : { empty: true }),
  message: (s) => `Add the note the change promised\n\nRelease-note-for: ${s[i].slice(0, 7)} .changeset/${name}\n`,
});

test("a later commit answers a line that promised a note by naming the note the range adds", () => {
  const repo = repoWithSteps([PROMISED, naming(0)]);
  try {
    const r = run(repo);
    assert.equal(r.code, 0, `a promised note, added and named by a later commit, was not taken:\n${r.said}`);
    assert.match(r.said, new RegExp(`${repo.shas[0].slice(0, 7)} said "to follow", which ${repo.shas[1].slice(0, 7)} answers with drop\\.md`),
      `the pass is silent about which commit answered, and with what:\n${r.said}`);
  } finally { repo.clean(); }
  // …and a bare `none` may be answered the same way.
  const bare = repoWithSteps([BARE, naming(0)]);
  try { assert.equal(run(bare).code, 0, "a note named by a later commit did not answer a bare `none`"); } finally { bare.clean(); }
});

test("a named note the range does not add answers nothing, and says which commit named it", () => {
  const repo = repoWithSteps([PROMISED, naming(0, "never-added.md", false)]);
  try {
    const r = run(repo);
    assert.equal(r.code, 1, `a note that is not in the range answered for a commit:\n${r.said}`);
    assert.match(r.said, new RegExp(`is answered by ${repo.shas[1].slice(0, 7)} with never-added\\.md, and this range adds no note by that name`));
  } finally { repo.clean(); }
});

test("a note named for a commit that says nothing is refused as stale: any note in the range already answers it", () => {
  const silent = { changes: { "bin/thing.mjs": "export const a = 7;\n" }, message: "A change" };
  const repo = repoWithSteps([silent, naming(0)]);
  try {
    const r = run(repo);
    assert.equal(r.code, 1, `a note answer to a silent commit passed in silence:\n${r.said}`);
    assert.match(r.said, /which owes no answer/);
  } finally { repo.clean(); }
});

test("an ambiguous prefix is refused against the range's own commits only", async () => {
  const { readAnswers } = await import("../../scripts/release-note-required.mjs");
  const commits = [
    { sha: "abcdef1000000000000000000000000000000000", subject: "one", message: "one" },
    { sha: "abcdef1999999999999999999999999999999999", subject: "two", message: "two" },
    { sha: "0123456789012345678901234567890123456789", subject: "answer", message: "Release-note-for: abcdef1 none — a reason.\n" },
  ];
  const { answers, refused } = readAnswers(commits);
  assert.equal(answers.size, 0);
  assert.match(refused[0].problem, /matches 2 commits in this range/);
  const unique = readAnswers([commits[0], { ...commits[2], message: "Release-note-for: abcdef10 none — a reason.\n" }]);
  assert.equal(unique.answers.get(commits[0].sha)?.reason, "a reason.", "a longer prefix that is unique in the range resolves");
});

test("on an empty range the answer form changes nothing: it still says there is nothing to read", () => {
  const repo = repoWithSteps([BARE, answering(0)]);
  try {
    const r = run(repo, repo.shas[1]);
    assert.equal(r.code, 0, r.said);
    assert.match(r.said, /nothing here to read/);
  } finally { repo.clean(); }
});
