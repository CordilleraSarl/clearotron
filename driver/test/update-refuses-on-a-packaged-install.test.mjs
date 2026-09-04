// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — `clearotron update` runs git in a directory that was never a repository.
//
// The verb runs `git pull --ff-only` then `npm ci`. A PACKAGED INSTALL — `npm install -g` from a
// tarball, which is what every registry user has — is neither: there is no git repository, and
// `package-lock.json` is not in the archive, so `npm ci` could not run even if the pull did.
//
// Before this, the pull ran anyway and the operator was told `git pull --ff-only did not succeed`.
// True, useless, and pointing at the wrong thing. `update` is the verb a stranger reaches for first,
// so the install most people will have must not be answered with a git error about a directory that
// was never a repository.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { isGitCheckout } from "../../bin/update.mjs";
import { packagedBuild } from "../../bin/onboard.mjs";
import { main as writeBuildInfoMain } from "../../scripts/write-build-info.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("#1929 a directory that is not a checkout is told apart from one that is", () => {
  // THE POSITIVE CONTROL FIRST. Without it, a predicate that answered `false` to everything would
  // satisfy the negative case and look correct — the shape that has cost this repo two rules today.
  assert.equal(isGitCheckout(ROOT), true,
    "this repository IS a checkout; if this reads false the predicate answers false to everything and "
    + "the negative case below proves nothing");

  // TMPDIR is forced to /tmp: a bare mkdtemp lands on /mnt here and a containment guard refuses it.
  const notARepo = mkdtempSync(join(tmpdir(), "packaged-install-"));
  assert.equal(isGitCheckout(notARepo), false, "a packaged install has no repository to pull from");
});

test("#1929 the verb ASKS before it pulls, and names the packaged remedy", () => {
  // The arm above drives the predicate. This one holds the WIRING — that the predicate is consulted
  // before the pull rather than merely existing — because a helper nothing calls is the failure this
  // repository keeps finding. Read from source, since driving the whole verb needs a tarball install.
  const src = readFileSync(join(ROOT, "bin", "update.mjs"), "utf8");
  const guard = src.indexOf("if (!isGitCheckout())");
  const pull = src.indexOf('runInCheckout("git", ["pull"');
  assert.ok(guard > 0, "the verb must consult the checkout test at all");
  assert.ok(pull > 0, "the pull must still be there — if this fails the anchor moved and so did the proof");
  assert.ok(guard < pull, "the checkout test must run BEFORE the pull, or the git error still lands first");
  assert.match(src, /npm install -g clearotron@latest/,
    "the refusal must name how a packaged install IS updated — a refusal that only says no leaves the "
    + "operator exactly as stuck as the git error did");
});

// ── — a packaged install can NAME the code it ran ──────────────────────────────
//
// `doctor` on a packaged install said "the engine directory is not a readable git checkout — this run's
// code cannot be named, which is not the same as it being fine". Honest, and the PERMANENT state of
// every registry install: no checkout, so never a commit. A clearance whose code cannot be named is not
// one anyone can audit afterwards, and that install is the one every real customer will have.
//
// npm does NOT stamp `gitHead` on pack — measured, absent from the packed manifest — so `prepack` writes
// it and the archive carries it.
test("#1929 the packaged commit is read from the archive's own stamp, and refused when malformed", () => {
  const good = JSON.stringify({ commit: "a".repeat(40), version: "0.1.0" });
  assert.deepEqual(packagedBuild("/x", () => good), { commit: "a".repeat(40), version: "0.1.0" });

  // A SHORT OR MISSING SHA IS NOT A COMMIT. Naming the wrong thing confidently is worse than the
  // silence this replaces, so anything that is not a full sha reads as absent.
  for (const bad of ['{"commit":"abc123"}', '{"commit":null}', "{}", "not json at all"])
    assert.equal(packagedBuild("/x", () => bad), null, `must refuse ${bad}`);
  assert.equal(packagedBuild("/x", () => { throw new Error("ENOENT"); }), null,
    "a checkout has no such file, and that is not an error — git is the answer there");
});

test("#1929 the stamper refuses rather than shipping an archive that cannot name itself", () => {
  // The pack hook must STOP when it cannot read a commit. A nameless archive is the artefact the whole
  // stamp exists to prevent, so producing one quietly would defeat it.
  assert.equal(writeBuildInfoMain("/x", { run: () => { throw new Error("not a repo"); } }), 1,
    "no commit must exit non-zero, which fails the pack");
  let written = null;
  assert.equal(writeBuildInfoMain("/x", {
    run: () => "b".repeat(40) + "\n",
    write: (_p, body) => { written = body; },
    read: () => JSON.stringify({ version: "9.9.9" }),
  }), 0);
  assert.match(written, /"commit": "b{40}"/);
  assert.match(written, /"version": "9\.9\.9"/);
  // NO CLOCK IN IT: two packs of one tree must produce identical bytes, or the tree-hash dedupe and
  // every reproducibility claim in this repo stop being true of the archive.
  assert.doesNotMatch(written, /\d{4}-\d{2}-\d{2}T/, "a timestamp would make two packs of one tree differ");
});

test("#1929 doctor CONSULTS the stamp on the not-a-checkout branch, and says which evidence it had", () => {
  // The arms above drive the readers. This holds the WIRING — that `doctor` asks — because a helper
  // nothing calls is the failure this repository keeps finding, and the branch itself cannot be driven
  // from here: this tree IS a checkout, so `deploymentCurrency` never reaches that arm.
  const src = readFileSync(join(ROOT, "bin", "onboard.mjs"), "utf8");
  const branch = src.indexOf('cur.state === "not-a-checkout"');
  const call = src.indexOf("packagedBuild()");
  assert.ok(branch > 0 && call > branch, "the stamp must be consulted INSIDE the not-a-checkout branch");
  assert.match(src, /named from the .*build-info\.json rather than from a checkout/s,
    "and it must say WHICH evidence it had — a commit read from a shipped file is not a commit read "
    + "from a live checkout, and a reader who cannot tell them apart cannot tell a stamped archive "
    + "from a verified tree");
});

test("#1929 the install ASKS about the report URL by name, and says what empty costs", () => {
  // Nothing in the documented install required CLEAROTRON_REPORTS_URL, so a packaged install completed,
  // ran and DELIVERED carrying "no report URL (pool URL unset)" — the report produced, the links into it
  // absent. An operator who was never asked cannot know they answered wrong, and the first person to
  // find out is a client opening a notification with nothing to click.
  const src = readFileSync(join(ROOT, "bin", "onboard.mjs"), "utf8");
  assert.match(src, /askValue\("Public base URL for the pool/,
    "the wizard must ASK — the criterion's other half, a doc that mentions it, leaves the operator "
    + "reading rather than answering");
  assert.match(src, /CLEAROTRON_REPORTS_URL/, "and by name, so the answer is findable afterwards");
  // ASKED, NOT REQUIRED: a local install with no web front is a real shape.
  assert.match(src, /empty for none/i, "empty must be a legitimate answer, not a refusal");
  assert.match(src, /left unset — runs will deliver, and their notifications will carry no link/,
    "and the consequence of empty must be said out loud, or the silence is the same silence as before");
});
