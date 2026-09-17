// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sarl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE RESIDUE CENSUS MEASURES WHAT IS PUBLISHED, NOT WHAT IS SITTING AT THE PATH.
//
// `publishedOf` asks whether a PATH is in HEAD and never whose bytes are at it. A withheld-corpus file laid
// at a NEW path is correctly excluded and reported; one that SHADOWS a published path passes that filter,
// and the census then measures the private file as though the public tree carried it.
//
// Measured on the beta-8 overlay: the private `report-print-check` lays over the published one, carries two
// bare references in its comments where the published file carries none, and the residue census reported
// `0 → 2` against the public tree. Three of that run's nine reds were this one cause — the floor arm, its
// zero-classes twin, and the generated-files check going stale against a table minted from private bytes.
//
// The same hole swallows an ordinary uncommitted edit, which is the everyday version: mint a backlog with
// unsaved work in the tree and it records prose nobody has published.
//
// Ruled 2026-09-17: measure HEAD's bytes. These arms drive that in both directions, because a reader that
// answered HEAD for everything would be just as wrong — it would stop the minters seeing the tree at all on
// a checkout with no differences, and would spawn a process per file to learn nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { publishedReader } from "../../shared/reference-guard-classes.mjs";

/** A throwaway repository. Hooks off: a global `core.hooksPath` reaches into this one too. */
function repo() {
  const dir = mkdtempSync(join(tmpdir(), "pubread-"));
  const git = (...args) => execFileSync("git", ["-c", "core.hooksPath=", "-C", dir, ...args],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.invalid");
  git("config", "user.name", "t");
  const write = (rel, body) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  };
  return { dir, git, write };
}

const PUBLISHED = "// the published bytes, carrying nothing\n";
const LAID = "// the private bytes, carrying a reference nobody published\n";

test("a path whose bytes differ from HEAD is measured as HEAD publishes it", () => {
  // The defect exactly: the path IS in HEAD, so every path-based filter admits it, and what sits there is
  // the private file.
  const r = repo();
  r.write("scripts/shadowed.mjs", PUBLISHED);
  r.git("add", "-A"); r.git("commit", "-q", "-m", "publish the file");
  r.write("scripts/shadowed.mjs", LAID);          // the overlay lays the private copy over it

  const read = publishedReader(r.dir, (f) => { throw new Error(`fell through to disk for ${f}`); });
  const got = read("scripts/shadowed.mjs");
  assert.equal(got, PUBLISHED,
    "the census must see what the public tree publishes at that path, not the bytes laid over it");
  assert.doesNotMatch(got, /private bytes/, "…and must not carry a line of the private file");
  rmSync(r.dir, { recursive: true, force: true });
});

test("a path whose bytes MATCH HEAD is read from disk, not fetched", () => {
  // The other direction, and it is not a nicety. A reader that went to git for every file would spawn a
  // process per file across the whole corpus to learn what was already in front of it. The sentinel proves
  // the cheap path is actually taken rather than merely available.
  const r = repo();
  r.write("scripts/same.mjs", PUBLISHED);
  r.git("add", "-A"); r.git("commit", "-q", "-m", "publish the file");

  let fellThrough = false;
  const read = publishedReader(r.dir, (f) => { fellThrough = true; return `sentinel for ${f}`; });
  const got = read("scripts/same.mjs");
  assert.equal(fellThrough, true, "an unchanged file must be read from disk");
  assert.match(got, /^sentinel/, "…and the supplied reader is what answers, not git");
  rmSync(r.dir, { recursive: true, force: true });
});

test("a staged shadowing file is caught too, not just an unstaged one", () => {
  // The overlay STAGES what it lays. A reader keyed on unstaged changes alone would admit the private bytes
  // in exactly the situation this was built for, and would pass the arm above while failing in practice.
  const r = repo();
  r.write("scripts/shadowed.mjs", PUBLISHED);
  r.git("add", "-A"); r.git("commit", "-q", "-m", "publish the file");
  r.write("scripts/shadowed.mjs", LAID);
  r.git("add", "-A");                              // staged, as the private control stages its corpus

  const read = publishedReader(r.dir, (f) => { throw new Error(`fell through to disk for ${f}`); });
  assert.equal(read("scripts/shadowed.mjs"), PUBLISHED,
    "staging the laid file must not hide it from the published reader");
  rmSync(r.dir, { recursive: true, force: true });
});

test("a differing file that cannot be read out of HEAD throws rather than falling back to disk", () => {
  // The permissive answer here reinstates the defect: falling back to the working tree for a file we could
  // not publish-read means measuring the laid bytes again, silently. `censusOf` skips a file it cannot
  // read, which undercounts a floor — the safe direction — rather than miscounting it.
  const r = repo();
  r.write("scripts/gone.mjs", PUBLISHED);
  r.git("add", "-A"); r.git("commit", "-q", "-m", "publish the file");
  r.git("rm", "-q", "--cached", "scripts/gone.mjs");   // differs from HEAD, and HEAD still has it
  r.write("scripts/gone.mjs", LAID);

  const read = publishedReader(r.dir, () => LAID);
  // It is in HEAD, so this one resolves — the arm below is the one that cannot.
  assert.equal(read("scripts/gone.mjs"), PUBLISHED);

  const r2 = repo();
  r2.write("keep.mjs", PUBLISHED);
  r2.git("add", "-A"); r2.git("commit", "-q", "-m", "one commit");
  r2.write("never-published.mjs", LAID);
  r2.git("add", "-A");                                  // in the index, never in HEAD
  const read2 = publishedReader(r2.dir, () => LAID);
  assert.throws(() => read2("never-published.mjs"),
    "a path HEAD does not carry has no published bytes, and answering with the laid ones is the defect");
  rmSync(r.dir, { recursive: true, force: true });
  rmSync(r2.dir, { recursive: true, force: true });
});
