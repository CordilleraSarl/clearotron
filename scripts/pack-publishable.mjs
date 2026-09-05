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
 * `private` STAYED ON THIS LIST AFTER THE MANIFEST STOPPED CARRYING IT. It was a live guard while
 * publishing was a human act: the repository manifest said `"private": true`, npm refuses to publish a
 * manifest carrying the flag, and the pack stripped it from the published copy alone. The owner's
 * rulings of 2026-09-04 and 2026-09-05 moved publishing into CI through Trusted Publishing, and a
 * package published from the tree cannot carry a flag that forbids publishing it — so the key is gone
 * from the manifest and this entry now strips nothing. It is kept because the list is the policy: a
 * tree that reintroduces the flag must still produce a publishable tarball.
 */
export const STRIP_KEYS = ["overrides", "private"];

/** The published manifest, given the repo one. PURE — this is the whole policy, and the test pins it. */
export function publishableManifest(repoManifest) {
  const out = { ...repoManifest };
  for (const k of STRIP_KEYS) delete out[k];
  return out;
}

async function main() {
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

    // ── THE ARTIFACT IS RECONCILED AND SCANNED BEFORE IT IS SEALED ────────
    //
    // HERE, AND NOT IN A LIFECYCLE HOOK. package.json carries a `prepublishOnly` that runs
    // publication-scan.mjs, and it does not fire for the way this artifact is actually published.
    // Measured 2026-09-04 with a throwaway package: `npm publish .` ran the hook, `npm publish
    // <tarball>` did not. The owner publishes a tarball path, so the only placement that cannot be
    // walked past is inside the step that produces it — a dirty artifact must be unconstructible,
    // not merely unpublishable-if-someone-uses-the-right-command.
    //
    // AND THE TABLE IS REQUIRED. cut/ is withheld from the public tree, so a checkout without it
    // cannot answer this question — which is a COULD-NOT-LOOK, never a pass. Exit 2, the house
    // meaning, and it names what is missing.
    let gate;
    try {
      ({ reconcileAndScan: gate } = await import("../cut/packed-artifact.mjs"));
    } catch (e) {
      console.error("  REFUSING (exit 2, could-not-look): cut/packed-artifact.mjs did not load —"
        + ` ${String(e?.message ?? e)}.\n`
        + "  That module carries the only rule that says which files may leave this repository, and a\n"
        + "  pack that cannot ask it produces an artifact nobody has checked. An exported tree does not\n"
        + "  carry cut/ and is therefore not a tree a publishable tarball is packed from.");
      process.exit(2);
    }
    const pkgRoot = join(work, "package");
    const report = gate(pkgRoot);
    const { portalBundleIn, demoIn, filesUnder } = await import("../cut/packed-artifact.mjs");
    const staged = filesUnder(pkgRoot);
    const portal = portalBundleIn(staged);
    const demo = demoIn(staged);

    console.log(`  reconciled against cut/ships.mjs: ${report.packed} packed, `
      + `${report.withheld.length} withheld and removed, ${report.remaining} shipped`);
    for (const w of report.withheld) console.log(`    - ${w}`);

    const refusals = [];
    if (report.privateNames.length) {
      refusals.push(`PRIVATE REPOSITORY NAMES survived the reconcile in ${report.privateNames.length} file(s):\n`
        + report.privateNames.map((h) => `      ${JSON.stringify(h)}`).join("\n"));
    }
    if (report.recordKeys.length) {
      refusals.push(`RECORD KEYS (client matter identifiers) in ${report.recordKeys.length} file(s):\n`
        + report.recordKeys.map((h) => `      ${JSON.stringify(h)}`).join("\n"));
    }
    // A tarball without a built portal installs, starts, and 503s at /portal — and the 503 prints a
    // remedy that cannot work in a published package. Refuse it here rather than ship it.
    // The stranger's first command. package.json's `files` is a different rule from cut/ships.mjs, and
    // this bundle's own rename proved it: `demo/` left `examples/` and the tarball silently carried no
    // demo at all while every git-side check stayed green.
    if (!demo.ok) {
      refusals.push(`NO COMPLETE PRODUCT DEMO in the tarball (demo/: ${demo.files} file(s), `
        + `product dir(s): ${demo.products.join(", ") || "none"}).\n`
        + "      `clearotron demo` is the first thing a new install runs and it would die naming a path\n"
        + "      that is not there. A child needs meta.json AND its lane's entry file:\n"
        + "      run/report.md for a clearance, run/knockout-findings.json for a knockout.\n"
        + "      Check package.json's `files` carries \"demo/\".");
    }
    if (!portal.ok) {
      refusals.push(`NO BUILT PORTAL in the tarball (portal-ui/dist: ${portal.files} file(s)).\n`
        + "      /portal would 503 after a global install, and its printed remedy\n"
        + "      `npm run build -w portal-ui` cannot run in a published package — it has no workspaces.\n"
        + "      Run `npm run build:ui` and pack again.");
    }
    // The release condition, asked for explicitly. See demoIn: every pull request packs a tarball
    // through verify-publishable, and those must not red because a product's demo has not been frozen
    // yet. The artefact that goes to the registry is packed with this flag.
    if (argv.includes("--all-products") && demo.missing.length) {
      refusals.push(`NOT ALL FOUR PRODUCTS HAVE A DEMO — missing: ${demo.missing.join(", ")}.\n`
        + "      Owner ruling 2026-09-04: four products, four demo examples. A published tarball\n"
        + "      showing one product tells a new reader the other three do not exist.");
    }
    if (refusals.length) {
      console.error(`  REFUSING to seal this tarball:\n    ${refusals.join("\n    ")}`);
      process.exit(1);
    }
    console.log(`  scans over the PACKED tree: 0 private repository names, 0 record keys`);
    console.log(`  built portal: ${portal.files} file(s) under portal-ui/dist, index.html + assets present`);
    console.log(`  demo: ${demo.files} file(s), complete product demo(s): ${demo.complete.join(", ") || "none"}`);
    if (demo.missing.length) {
      console.log(`  demo: NO DEMO YET for ${demo.missing.join(", ")}`
        + " — this tarball is not publishable under the 2026-09-04 ruling (four products, four demos).");
      console.log("        Pass --all-products to make that a refusal rather than a line to read.");
    }

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
if (isEntrypoint(import.meta.url)) await main();
