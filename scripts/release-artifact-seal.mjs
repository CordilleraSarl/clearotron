#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// release-artifact-seal.mjs — the published manifest is not this repository's manifest.
//
//   node scripts/release-artifact-seal.mjs --tarball <path>
//
// ── THE FIVE BROKEN RELEASES THIS EXISTS TO STOP ────────────────────────────────────────────────────
//
// `npm install clearotron` failed on every release from 0.1.1-beta.0 through 0.1.3 — five for five —
// with
//
//     npm error Unable to resolve reference $buffers
//
// before a single file was written. That is the exact string clearotron.ai's copy button puts on a
// visitor's clipboard and the first line of README.md, so the project's front door was shut for a day
// and a half and no product guard could see it: the failure happens before any of our code runs.
//
// The repository manifest carries `overrides: { "buffers": "$buffers" }` on purpose — it is what pins
// the clean-room replacement for the unlicensed `buffers@0.1.1` while resolving THIS tree. npm's
// `$name` syntax means "whatever the root project resolved for the sibling dependency `name`", and it
// resolves only in a root project's own manifest. A consumer installing this package as a dependency
// has nothing to resolve it against, so npm aborts the whole install.
//
// ── WHY THE SCRIPT THAT ALREADY DID THIS COULD NOT BE CALLED ────────────────────────────────────────
//
// `scripts/pack-publishable.mjs` has stripped exactly this key since 2026-08-23, and `0.1.0` — the
// last installable release — went out through it. It cannot run on the tree that publishes today. It
// imports `cut/packed-artifact.mjs` and exits 2 without it, saying "an exported tree is therefore not
// a tree a publishable tarball is packed from." That sentence was true until 2026-09-05 and false the
// moment the public repository became the working home: `cut/` is withheld from it. Measured on
// origin/main — zero files under `cut/`, and the script exits 2 on this tree.
//
// So the release workflow packed with a bare `npm pack` and published those bytes. No step was wrong
// about its own job. The one step that knew about `overrides` had been made unreachable by a
// repository move, and nothing anywhere said so.
//
// THE POLICY IS IMPORTED, NEVER RESTATED. `publishableManifest` and `STRIP_KEYS` come from
// `pack-publishable.mjs` unchanged, so the private tree's pack and the public tree's publish strip the
// same keys by construction. A second copy of that list is how the two come to disagree about one
// package, and this file would be the copy.
//
// ── WHAT IT DELIBERATELY DOES NOT DO ────────────────────────────────────────────────────────────────
//
// It does not reconcile against `cut/ships.mjs`, scan for private repository names or record keys, or
// check the portal bundle and the demo. Those are `pack-publishable.mjs`'s other four jobs and every
// one of them needs the withheld module. On the publish path the workflow already covers three by
// other means — gitleaks over the extracted tree, and `release-completeness-check.mjs --tarball` for
// the portal bundle and the demo — and the reconcile has nothing left to decide, because every file in
// a public tree is already public. Said here rather than left to be inferred from silence.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";
import { publishableManifest, STRIP_KEYS } from "./pack-publishable.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Rewrite the manifest inside a packed tarball, in place.
 *
 * @returns {{stripped: string[], name: string, version: string}}
 * @throws when the tarball has no `package/package.json` — a tarball npm would refuse anyway, and a
 *   silent success on one is how a caller concludes the seal ran.
 */
export function sealTarball(tarballPath) {
  const staging = mkdtempSync(join(tmpdir(), "clearotron-seal-"));
  try {
    execFileSync("tar", ["-xzf", tarballPath, "-C", staging]);
    const manifestPath = join(staging, "package", "package.json");
    if (!existsSync(manifestPath)) {
      throw new Error(`${tarballPath} carries no package/package.json — that is not an npm tarball`);
    }
    const before = JSON.parse(readFileSync(manifestPath, "utf8"));
    const stripped = STRIP_KEYS.filter((k) => k in before);
    writeFileSync(manifestPath, `${JSON.stringify(publishableManifest(before), null, 2)}\n`);
    execFileSync("tar", ["-czf", tarballPath, "-C", staging, "package"]);

    // THE POST-CONDITION IS READ BACK OFF THE SEALED BYTES, not asserted from the write above. The
    // whole defect being repaired here is a strip everybody believed was happening, so a seal that
    // reports success without re-reading the artefact is the same shape one layer up.
    const after = JSON.parse(
      execFileSync("tar", ["-xzOf", tarballPath, "package/package.json"], { encoding: "utf8" }));
    const survivors = STRIP_KEYS.filter((k) => k in after);
    if (survivors.length) {
      throw new Error(`the seal ran and ${survivors.join(", ")} is still in the sealed manifest`);
    }
    return { stripped, name: after.name, version: after.version };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function main() {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--tarball");
  const tarball = i >= 0 ? argv[i + 1] : null;
  if (!tarball) {
    console.error("usage: node scripts/release-artifact-seal.mjs --tarball <path>");
    process.exit(2);
  }
  // A path that is not there is a could-not-look, never a seal that found nothing to do. Exit 2 is
  // the house meaning and it keeps this distinguishable from a tarball that was sealed and was clean.
  if (!existsSync(tarball)) {
    console.error(`  REFUSING (exit 2, could-not-look): ${tarball} does not exist, so nothing was sealed.`);
    process.exit(2);
  }

  let result;
  try { result = sealTarball(tarball); }
  catch (e) {
    console.error(`  REFUSING: ${String(e?.message ?? e)}`);
    process.exit(1);
  }

  console.log(`sealed ${tarball} — ${result.name}@${result.version}`);
  console.log(result.stripped.length
    ? `  stripped from the PUBLISHED manifest only: ${result.stripped.join(", ")} (the repo manifest is untouched)`
    : "  nothing stripped — the packed manifest carried none of the publish-only keys");

  // AND A NOTHING-STRIPPED IS REPORTED AGAINST THE REPO MANIFEST, because on this tree it would be a
  // finding. `overrides` is in package.json and `files[]` cannot exclude a manifest, so a tarball
  // reaching here without it did not come from this repository.
  const repo = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const expected = STRIP_KEYS.filter((k) => k in repo);
  if (expected.length && !expected.every((k) => result.stripped.includes(k))) {
    console.error(`  REFUSING: this repository's manifest carries ${expected.join(", ")} and the packed `
      + `tarball did not. The tarball was not packed from this tree, so sealing it proves nothing.`);
    process.exit(1);
  }
}

if (isEntrypoint(import.meta.url)) main();
