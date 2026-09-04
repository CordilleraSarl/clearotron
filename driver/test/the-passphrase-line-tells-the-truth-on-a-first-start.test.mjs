// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── F22 — THE ONE UNRECOVERABLE VALUE, AND THE LINE THAT DISCARDED IT ────
//
// On the owner's first real `clearotron start`, two lines from the same run, fourteen apart:
//
//   [portal-service] local sign-in: no credential at …, so one has been created for clearotron@localhost.
//   [portal-service]   PASSPHRASE: <24 chars>
//   …
//   The passphrase was minted on an earlier start and is NOT reprinted — it is stored only as a digest.
//
// There had been no earlier start. The credential was created by that run and the value WAS printed —
// and the banner told him to disregard the one thing on the screen that nothing can recover.
//
// AN ORDERING BUG, NOT A WORDING ONE. Both sentences are correct; the wrong one was chosen, because the
// fact was read AFTER the portal spawned and the portal is what mints. A check made after the mint
// always answers "it existed", including on the run that created it.
//
// WHY THIS ARM READS THE SOURCE. The defect lives in the ORDER of two statements in one function, and
// the function spawns a portal, binds ports, and blocks on health checks. Driving it would measure a
// live portal; what is at issue is which side of the spawn a line sits on. So the arm asserts the
// ordering directly, over the shipped file, and says so rather than implying more.
//
// BREAK MATRIX:
//   · the check precedes the portal spawn      → break: move it back below, arm 1 red
//   · exactly one capture exists               → break: re-add a second read, arm 1 red
//   · both sentences survive                   → break: delete a branch, arm 2 red
//   · the first-run branch names the reset verb → break: drop it, arm 2 red
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = readFileSync(join(dirname(dirname(fileURLToPath(import.meta.url))), "..", "bin", "start.mjs"), "utf8");

test("the credential is checked BEFORE the portal that mints it is started", () => {
  const capture = SRC.indexOf("const credentialExisted = existsSync(");
  const spawn = SRC.indexOf('start("the portal", "driver/portal-service.mjs"');
  assert.ok(capture > 0, "the credential check is gone — the banner cannot know which sentence is true");
  assert.ok(spawn > 0, "the portal start moved; this arm can no longer see the seam it guards");
  assert.ok(capture < spawn,
    "the credential is checked AFTER the portal spawns, so a first start reads its own freshly minted "
    + "file as evidence of an earlier one — the defect this arm exists for");
  // — F10 renamed the branch. The supervisor now MINTS when no credential
  // existed, so the summary can print the value instead of pointing into the log; `mintedPassphrase`
  // is derived from `credentialExisted` and is what the two sentences branch on. The seam this arm
  // guards is unchanged and still the point: the fact must be read BEFORE the thing that changes it.
  const branch = SRC.indexOf("if (mintedPassphrase)");
  assert.ok(branch > spawn, "the branch that reads it moved above the spawn; the arm is measuring nothing");
  assert.match(SRC, /const mintedPassphrase = credentialExisted \? null : newPassphrase\(\)/,
    "the mint must be decided by the pre-spawn capture, not by a second look at the file after the mint");
  // EXACTLY ONE CAPTURE. A second read after the spawn would silently win at the branch, and the
  // ordering above would still look right.
  assert.equal(SRC.split("const credentialExisted = existsSync(").length - 1, 1,
    "the credential is captured more than once — a later read after the mint decides the sentence");
});

test("both sentences still exist, and the first-run one names how to recover", () => {
  assert.match(SRC, /minted on an earlier start and is NOT reprinted/,
    "the returning-operator sentence is gone — a real second start now claims the value was printed");
  // — F10 REPLACED the first-run sentence rather than deleting it. "printed
  // once, above" was the tell for that finding: a summary sending the reader back into eleven lines of
  // log for the one value that cannot be read back. The first-run branch now carries the VALUE, which
  // is strictly more than the sentence it replaced, so this asserts the branch exists and prints it.
  assert.match(SRC, /Passphrase\s+\$\{mintedPassphrase\}/,
    "the first-run branch is gone — a first start no longer hands the operator the value at all");
  // THE VALUE IS UNRECOVERABLE, so both branches have to name the one command that mints a new one.
  // Composed once as `reset` and referenced by both, which is why this counts references and pins the
  // definition rather than counting a literal that now appears once.
  const branchBlock = SRC.slice(SRC.indexOf("if (mintedPassphrase)"), SRC.indexOf("if (mintedPassphrase)") + 1400);
  assert.equal((branchBlock.match(/\$\{reset\}/g) ?? []).length, 2,
    "a branch stopped naming the reset command — a reader who lost the value is left with nothing to do");
  assert.match(SRC, /const reset = `\$\{invocationPrefix\(\)\}clearotron passphrase --reset`/,
    "and `reset` must be that command, or both branches now name something else");
});
