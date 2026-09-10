// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A source the classifier could not read is not a source that is empty.
//
// `scripts/env-classify.mjs` decides which variables nobody sets, and that list is what a configuration
// cleanup removes from. Every one of its sources is a file read, and every file read has two ways to
// return nothing: the file said nothing, or the file was not there. Conflating them turns a failure to
// look into a finding, in the one artifact a reviewer reads to authorise a deletion.
//
// It happened twice, in two sources, for the same reason — a read helper that answers "" on ENOENT:
//
//   the CI source     read one workflow by name, so the release workflow was invisible and the two
//                     variables it alone sets reported "never set" and became deletion candidates
//   the production    is withheld from the public tree, so on a public checkout all 72 names production
//   source            sets reported "never set" too
//
// Neither printed anything. These arms hold the distinction open in both.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gather, setupNames } from "../../scripts/env-classify.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PROD = join(REPO, "docs/architecture/env-set-in-production.txt");

/**
 * A root with whatever workflows are named, and by default the shipped files `gather` refuses without.
 *
 * `viable: false` leaves those out, which is how the arms below drive their absence. Defaulting to
 * present is deliberate: an arm about the CI source should not have to know which OTHER sources exist,
 * or it fails for a reason that has nothing to do with what it asserts — the shape that turned six
 * unrelated arms red in the merge gate's own suite the same evening this was written.
 */
function plantRoot(workflows, { viable = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "env-classify-"));
  if (workflows) {
    mkdirSync(join(root, ".github/workflows"), { recursive: true });
    for (const [name, body] of Object.entries(workflows)) writeFileSync(join(root, ".github/workflows", name), body);
  }
  if (viable) {
    mkdirSync(join(root, "scripts"), { recursive: true });
    for (const f of ["scripts/e2e.mjs", "scripts/test-run.mjs"]) writeFileSync(join(root, f), "// planted\n");
  }
  return root;
}

test("the production source says whether it was READ, not merely whether it was empty", () => {
  // Asserted against the tree rather than pinned to one answer: the file is withheld from the public
  // checkout and present when the withheld half is laid over it, so an arm demanding either value would
  // be wrong on one of the two trees this suite runs in. What must hold on both is that the flag tells
  // the truth about the tree it ran on.
  const s = gather();
  assert.equal(s.prodRead, existsSync(PROD),
    `gather reports prodRead=${s.prodRead} while the production list is ${existsSync(PROD) ? "present" : "absent"} — `
    + "the flag has stopped describing the read, which is the only thing it is for");
  if (!s.prodRead) assert.equal(s.prod.size, 0, "an unread source must not also claim to have found names");
});

test("a production list PASSED IN counts as read — the caller's claim, not this file's guess", () => {
  const s = gather({ prodList: "# a comment\nCLEAROTRON_PLANTED_ONE\n\nCLEAROTRON_PLANTED_TWO\n" });
  assert.equal(s.prodRead, true, "a caller that supplied the list knows its own provenance");
  assert.ok(s.prod.has("CLEAROTRON_PLANTED_ONE") && s.prod.has("CLEAROTRON_PLANTED_TWO"));
  assert.ok(!s.prod.has("#"), "comment lines are not names");
});

test("an EMPTY production list passed in is read, and empty — the two are not the same fact", () => {
  const s = gather({ prodList: "" });
  assert.equal(s.prodRead, true, "the caller looked and found nothing; that is an answer");
  assert.equal(s.prod.size, 0);
});

test("the CI source reads EVERY workflow, not one of them by name", () => {
  const root = plantRoot({
    "ci.yml": "jobs:\n  x:\n    env:\n      CLEAROTRON_ONLY_IN_CI: '1'\n",
    "release.yml": "jobs:\n  y:\n    env:\n      CLEAROTRON_ONLY_IN_RELEASE: '1'\n",
  });
  const s = gather({ root, prodList: "" });
  assert.ok(s.ci.has("CLEAROTRON_ONLY_IN_CI"), "the workflow this source used to read by name");
  assert.ok(s.ci.has("CLEAROTRON_ONLY_IN_RELEASE"),
    "a variable set by a workflow other than ci.yml is invisible again — that is the defect, restored");
});

test("the END-TO-END source refuses when its files are gone, rather than reporting nobody sets them", () => {
  const root = plantRoot({ "ci.yml": "jobs:\n  x:\n    env:\n      CLEAROTRON_X: '1'\n" }, { viable: false });
  assert.throws(() => gather({ root, prodList: "" }), /scripts\/e2e\.mjs is absent/,
    "the end-to-end surface read as empty, so every name it alone sets reported as never set");
});

test("a file that EXISTS and cannot be read refuses too — absence is not the only silence", () => {
  // The narrower half of the same defect. Separating absent from present with `existsSync` AFTER a read
  // that swallowed its own error tells the two apart only by accident of which case the second call can
  // see: a permission, a truncated mount, or — as here — a directory standing where a file belongs, all
  // come back empty and pass through as though the file held nothing.
  //
  // Driven with a directory rather than a permission, because a test that chmods is a test that behaves
  // differently for root and leaves the tree dirty if it fails between the two calls.
  const root = plantRoot({ "ci.yml": "jobs:\n  x:\n    env:\n      CLEAROTRON_X: '1'\n" }, { viable: false });
  mkdirSync(join(root, "scripts", "e2e.mjs"), { recursive: true });
  writeFileSync(join(root, "scripts", "test-run.mjs"), "// planted\n");
  assert.throws(() => gather({ root, prodList: "" }), /e2e\.mjs exists and could not be read \(EISDIR\)/,
    "an unreadable file read as empty, which is the same silence the absent case was fixed for");
});

test("the SETUP population refuses when the wizard is gone — the worst source to lose quietly", () => {
  // Empty, every setup name falls through the shape tests to `tuning`, and `tuning` with no recorded
  // set-site is the deletion population. A missing wizard would propose the whole install surface for
  // removal, and nothing in the output would say the file was not there.
  const root = plantRoot({ "ci.yml": "jobs:\n  x:\n    env:\n      CLEAROTRON_X: '1'\n" }, { viable: false });
  assert.throws(() => setupNames(root), /bin\/onboard\.mjs is absent/,
    "the wizard read as empty, so the install surface reported as set by nobody");
});

test("an ABSENT workflow directory refuses; it does not report that nothing sets anything", () => {
  const root = plantRoot(null);
  assert.throws(() => gather({ root, prodList: "" }), /cannot read .*\.github\/workflows/,
    "a missing directory answered as an empty source, which is a failure to look wearing a finding's clothes");
});

test("a workflow directory holding NO workflows refuses too", () => {
  const root = plantRoot({});
  assert.throws(() => gather({ root, prodList: "" }), /holds no \.yml files/,
    "an empty directory is the same silence as a missing one, and must read the same way");
});
