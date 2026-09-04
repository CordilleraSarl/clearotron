#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// pack-publishable.mjs — produce the tarball that can actually be installed.
//
//   node scripts/pack-publishable.mjs [--out <dir>]
//
// ── WHY THIS EXISTS: `npm pack` ALONE PRODUCES A TARBALL THAT CANNOT BE INSTALLED ───────────────────
//
// The repo manifest carries `overrides: { "buffers": "$buffers" }`. That is what forces every
// transitive resolution of `buffers` onto the clean-room replacement for the unlicensed buffers@0.1.1
//, and it MUST stay in the repo manifest. `$buffers` is npm's reference syntax for "whatever
// this manifest's own dependencies.buffers says", which resolves inside this repo and nowhere else.
//
// Ship it and the install dies before it starts. Measured, 2026-08-23, plain `npm pack` output into a
// directory with no checkout:
//
//     npm error Unable to resolve reference $buffers
//
// So the published manifest must not carry it, and the repo manifest must never lose it.
//
// ── WHY IT REWRITES THE TARBALL RATHER THAN THE MANIFEST ────────────────────────────────────────────
//
// The obvious shape is a `prepack` that edits package.json and a `postpack` that puts it back. That
// stakes the clean-room substitution on a cleanup step running: a failed pack, a Ctrl-C, or a crash
// between the two leaves the working tree with NO overrides, and the next `npm install` in this repo
// silently resolves `buffers` to the unlicensed package on the registry. Nothing would report it —
// the tree still builds, the suite still passes, and the licence violation is back.
//
// This script never writes package.json. It packs, unpacks into a temp directory, strips the key
// there, and repacks. The repo manifest is read-only throughout, so there is no state to restore and
// nothing to leave behind on failure.
//
// ── WHAT STAYS, AND WHY STRIPPING IS SAFE ───────────────────────────────────────────────────────────
//
// `bundleDependencies` carries `buffers` INTO the tarball, so the consumer gets the clean-room copy
// from the bundle rather than resolving it. Verified in a tree with no checkout: both
// `node_modules/clearotron/node_modules/buffers` and `.../vendor/buffers` report
// `license: AGPL-3.0-only`, "Clean-room replacement for the unlicensed buffers@0.1.1". The override is
// what protects a RESOLUTION; the bundle is what protects the SHIPPED tree, and only the first is
// meaningless outside this repo.
//
// ── WHY `exceljs` IS BUNDLED TOO, WHICH THE MANIFEST CANNOT SAY ─────────────────────────────
//
// It is bundled for the same reason and it is NOT a problem to be undone. Measured, 2026-08-24:
//
//     exceljs@4.4.0 declares          uuid: ^8.3.0
//     `npm install exceljs` alone     uuid 8.3.2   — advisories
//     bundled from a fresh tree here  uuid 11.1.1  — clean, and the consumer gets exactly this
//
// `overrides` is root-only, so a consumer resolving `exceljs` themselves would apply OUR pin to
// nothing and land on 8.3.2 by its own range. Bundling is therefore what makes the fix reachable at
// all — unbundling would guarantee the vulnerability rather than remove it, which is the opposite of
// how it reads.
//
// THE COST IS A BUILD-ORDER RULE. A bundled tree ships PRE-RESOLVED and npm never re-resolves it, so
// whatever `uuid` sits in this repo's node_modules at pack time is the one every consumer gets,
// permanently. Pack from a stale tree and the same commit ships the vulnerable version. That rule is
// not left to memory: `scripts/verify-publishable.mjs` installs the tarball into a tree with no
// checkout and fails when its audit is worse than this checkout's.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
/**
 * Manifest keys that are meaningful in THIS repo and meaningless-or-fatal in a consumer's tree.
 *
 * `private` is here for the same reason and NOT because the repo should stop being private. The repo
 * manifest's `"private": true` is a live guard — `release-no-publish-check` refuses when it is gone, and
 * it is what stops an accidental `npm publish` from this tree. A tarball is the other direction: the
 * artefact exists to be installed, and npm refuses to publish a manifest carrying the flag, so a pack
 * that ships it produces a tarball that cannot become a package. Strip it from the PUBLISHED copy and
 * leave the repo's alone — which is exactly what this function does, and the refusal below proves the
 * repo manifest still has both keys on every pack.
 */
export const STRIP_KEYS = ["overrides", "private"];

/** The published manifest, given the repo one. PURE — this is the whole policy, and the test pins it. */
export function publishableManifest(repoManifest) {
  const out = { ...repoManifest };
  for (const k of STRIP_KEYS) delete out[k];
  return out;
}

function main() {
  const argv = process.argv.slice(2);
  const outIdx = argv.indexOf("--out");
  const outDir = outIdx >= 0 ? argv[outIdx + 1] : join(ROOT, "dist");
  mkdirSync(outDir, { recursive: true });

  const staging = mkdtempSync(join(tmpdir(), "clearotron-pack-"));
  try {
    execFileSync("npm", ["pack", "--pack-destination", staging], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
    const tgz = readdirSync(staging).find((f) => f.endsWith(".tgz"));
    if (!tgz) throw new Error("npm pack produced no tarball");

    const work = join(staging, "x");
    mkdirSync(work);
    execFileSync("tar", ["-xzf", join(staging, tgz), "-C", work]);

    const manifestPath = join(work, "package", "package.json");
    const before = JSON.parse(readFileSync(manifestPath, "utf8"));
    const stripped = STRIP_KEYS.filter((k) => k in before);
    writeFileSync(manifestPath, `${JSON.stringify(publishableManifest(before), null, 2)}\n`);

    const finalPath = join(outDir, tgz);
    execFileSync("tar", ["-czf", finalPath, "-C", work, "package"]);

    // Say what was removed. A strip nobody is told about is how the next reader concludes the key was
    // never there and deletes it from the repo manifest instead.
    console.log(`packed ${finalPath}`);
    console.log(stripped.length
      ? `  stripped from the PUBLISHED manifest only: ${stripped.join(", ")} (the repo manifest is untouched)`
      : "  nothing stripped — no publish-only keys were present");
    // Prove the repo manifest still has them, here, on every pack.
    const repo = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const lost = STRIP_KEYS.filter((k) => !(k in repo));
    if (lost.length) {
      console.error(`  REFUSING: the REPO manifest is missing ${lost.join(", ")}. Those are the clean-room`
        + " buffers substitution and the flag that stops an accidental publish, not packaging details."
        + " Restore them before publishing.");
      process.exit(1);
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

// / — the raw comparison is false under any symlinked invocation, and a packaging script that
// silently exits 0 having packed nothing is the worst possible member of that class: the caller reads
// the 0 as "the tarball is ready".
if (isEntrypoint(import.meta.url)) main();
