// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// release-completeness-check.mjs — what a stranger installs is complete.
//
// THE TWO THINGS THAT GO MISSING WITHOUT ANYTHING TURNING RED. The npm tarball is assembled from
// `files[]`, and both of these are selected by a pattern rather than named file by file:
//
//   · a demo product whose run directory did not travel. `npm run demo` then lists three products where
//     the repository holds four, or offers one that cannot be opened. This already happened once, in the
//     other direction (the knockout demo shipped and the player could not list it) — which is why the
//     rule for "a demo is usable" lives in ONE file, `driver/demo-container.mjs`, and is imported here
//     rather than restated.
//   · the portal bundle. `portal-ui/dist/` is built, not committed, so a pack that runs before the build
//     ships a portal with no bundle. The install then starts, reports healthy, and serves nothing.
//
// Both produce a tarball npm accepts and a publish that reads as a success.
//
// TWO MODES, ONE RULE. With no arguments it reads a working tree — that is the `prepublishOnly` hook,
// the last thing between a person publishing from a laptop and an incomplete package. With `--tarball`
// it reads the packed bytes, which is what CI publishes; there the demo set must match the tree's,
// because "every demo present is complete" is satisfied by a tarball carrying one of them.
import { existsSync, readdirSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { demoChildren, entryFile } from "../driver/demo-container.mjs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Directory children of `demo/`, complete or not. The set the frozen ones are measured against. */
/**
 * The floor on how many packages the notices file may list.
 *
 * NOT the exact count, deliberately: the exact number moves with every dependency change and an arm
 * asserting it would red on an ordinary bump, which is how a check gets deleted. This catches the two
 * shapes that matter — the file absent, and the file truncated to a fraction of the tree. Whether the
 * list MATCHES the tree is a different question and a different check, because answering it needs the
 * installed tree rather than the packed bytes.
 *
 * Set from the measured tree on 2026-09-05: 187 packages, floored well below it so a removal does not
 * red this. It rises when somebody finds it too low, never to chase the true count.
 */
export const MIN_NOTICE_ENTRIES = 150;

export function demoDirectories(root) {
  try {
    return readdirSync(join(root, "demo"), { withFileTypes: true })
      .filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

/**
 * Everything wrong with this tree or unpacked tarball, as named refusals. Empty means complete.
 *
 * `expectDemos` is the set a tarball must carry — the tree's, when checking a tarball. Omitted for a
 * tree, which is measured against itself.
 */
export function refusals(root, { expectDemos } = {}) {
  const out = [];
  const present = demoDirectories(root);
  const frozen = demoChildren(join(root, "demo"));

  if (!present.length) out.push("there are no demo products at all — `demo/` is empty or absent");
  for (const name of present) {
    if (!frozen.includes(name)) {
      out.push(`the demo product \`${name}\` is incomplete: it needs meta.json and its lane's entry file `
        + "(run/report.md for a clearance, run/knockout-findings.json for a knockout), and carries "
        + (entryFile(join(root, "demo", name)) ? "no manifest" : "neither entry file"));
    }
  }
  if (expectDemos) {
    for (const name of expectDemos) {
      if (!frozen.includes(name)) out.push(`the demo product \`${name}\` is in the repository and not in the package`);
    }
  }

  // ── THE LICENCE RECORD HAS TO BE IN THE PACKAGE, NOT JUST IN THE REPOSITORY ─────────────────────
  //
  // MEASURED ON THE PUBLISHED ARTEFACT, 2026-09-05: `THIRD-PARTY-NOTICES.md` was not short, it was
  // ABSENT. `files[]` never named it, so npm packed everything except the one file that records what
  // the bundled dependencies are licensed under — and every artefact shipped so far, 0.1.0 and the
  // first pre-release included, went out without it. Nothing was red; the file was correct in the
  // repository and simply never travelled.
  //
  // Counted rather than merely found, and compared against the copy in the tree: a packed file that
  // has fallen behind the repository's is the same failure one release later.
  const notices = join(root, "THIRD-PARTY-NOTICES.md");
  if (!existsSync(notices)) {
    out.push("the third-party licence notices are not in the package (THIRD-PARTY-NOTICES.md) — check "
      + "`files[]` names it, because npm ships LICENSE and README on its own and this file only if asked");
  } else {
    const entries = readFileSync(notices, "utf8").split("\n").filter((l) => /^## /.test(l)).length;
    if (entries < MIN_NOTICE_ENTRIES) {
      out.push(`the third-party licence notices list ${entries} package(s), fewer than the `
        + `${MIN_NOTICE_ENTRIES} this package is known to bundle — the file is stale or was truncated`);
    }
  }

  const dist = join(root, "portal-ui", "dist");
  if (!existsSync(join(dist, "index.html"))) {
    out.push("the portal bundle is not there (portal-ui/dist/index.html) — run `npm run build:ui` before packing");
  } else {
    const assets = existsSync(join(dist, "assets")) ? readdirSync(join(dist, "assets")) : [];
    if (!assets.some((f) => f.endsWith(".js"))) {
      out.push("the portal bundle has an index.html and no script — the build did not finish");
    }
  }
  return out;
}

/** Unpack a tarball and return the directory its `package/` root landed in. Caller removes it. */
function unpack(tarball) {
  const dir = mkdtempSync(join(tmpdir(), "clearotron-pack-"));
  execFileSync("tar", ["-xzf", tarball, "-C", dir], { stdio: "pipe" });
  return dir;
}

function main() {
  const i = process.argv.indexOf("--tarball");
  const tarball = i === -1 ? null : process.argv[i + 1];
  if (i !== -1 && !tarball) {
    console.error("release-completeness-check: --tarball needs the path of the packed file");
    process.exitCode = 2;
    return;
  }
  if (tarball && !existsSync(tarball)) {
    // NOT A PASS. A missing tarball is the shape where the pack step failed and the scan reported clean.
    console.error(`release-completeness-check: ${tarball} is not there, so nothing was checked.`);
    process.exitCode = 2;
    return;
  }

  let root = ROOT, temp = null, expectDemos;
  if (tarball) {
    try {
      temp = unpack(tarball);
    } catch (e) {
      console.error(`release-completeness-check: could not unpack ${tarball} (${e.message})`);
      process.exitCode = 2;
      return;
    }
    root = join(temp, "package");
    if (!existsSync(root)) {
      console.error(`release-completeness-check: ${tarball} has no package/ root — it is not an npm tarball.`);
      rmSync(temp, { recursive: true, force: true });
      process.exitCode = 2;
      return;
    }
    expectDemos = demoChildren(join(ROOT, "demo"));
    if (!expectDemos.length) {
      console.error("release-completeness-check: this repository has no complete demo product to compare "
        + "the package against, so the comparison would pass on anything.");
      rmSync(temp, { recursive: true, force: true });
      process.exitCode = 2;
      return;
    }
  }

  const found = refusals(root, { expectDemos });
  const where = tarball ? `the package ${tarball}` : "this working tree";
  if (temp) rmSync(temp, { recursive: true, force: true });

  if (found.length) {
    console.error(`release-completeness-check: ${where} is incomplete.\n`);
    for (const f of found) console.error("  ✕ " + f);
    console.error("\nPublishing it would hand a user a product with a piece missing and no error to read.");
    process.exitCode = 1;
    return;
  }
  const n = tarball ? expectDemos.length : demoChildren(join(root, "demo")).length;
  console.log(`release-completeness-check: ${where} carries ${n} complete demo product(s) and a built portal bundle`);
}

if (isEntrypoint(import.meta.url)) main();
