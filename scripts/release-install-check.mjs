#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// release-install-check.mjs — type what a stranger types, at the exact bytes about to be published.
//
//   node scripts/release-install-check.mjs --tarball <path> [--keep]
//
// ── WHAT IT IS FOR, AND WHY IT IS NOT ANOTHER MANIFEST ASSERTION ────────────────────────────────────
//
// Five consecutive releases published a package npm refused to install (tracker issue 180). Every
// check in the pipeline passed on every one of them, because each asked a question about the tarball
// and none asked the only question a visitor asks: does `npm install clearotron` work.
//
// So this does not look for `overrides`, or for any other known-bad key. It installs the artefact and
// reports what npm did. A check keyed to the cause we already found would go green on the next
// packaging fault of a different shape, which is the whole reason there were five and not one.
//
// ── AS A DEPENDENCY. THAT IS THE WHOLE INSTRUMENT ───────────────────────────────────────────────────
//
// `overrides` is root-only, so the failure exists only when this package is somebody's dependency —
// which is every real user and neither of the two cheap checks that look like this one. Measured
// 2026-09-05 on the published 0.1.3:
//
//     npm pack + read the manifest                     the key is visible, nothing fails
//     npm install <tarball> as a DEPENDENCY            exit 1   Unable to resolve reference $buffers
//     the same tarball with the manifest sealed        exit 0   added 96 packages, bin present
//
// ── AND NEVER `--dry-run`, WHICH WAS THE FIRST INSTRUMENT REACHED FOR HERE AND WAS WRONG ────────────
//
//     npm install clearotron@0.1.3 --dry-run           exit 0   "added 96 packages"
//     npm install clearotron@0.1.3                     exit 1   Unable to resolve reference $buffers
//
// `--dry-run` does not perform the resolution that aborts, so a gate written with it is green on all
// five broken releases while appearing to test the thing. It is recorded here because the flag is the
// obvious way to make this check cheaper and somebody will reach for it again.
//
// ── AND A REGISTRY IT COULD NOT REACH IS NOT A BROKEN PACKAGE ──────────────────────────────────────
//
// This runs on every pull request, and npm exits non-zero for reasons that have nothing to do with
// these bytes: a DNS failure, a registry timeout, a 503, a disk with nothing left on it. Reported as
// "REFUSING to publish — this is what a visitor gets", every one of them accuses the artefact of a
// fault it does not have, and a gate that cries wolf on infrastructure is a gate somebody deletes.
//
// The first real run of this check proved the risk rather than the theory: it was handed a relative
// path, npm looked for the tarball inside the throwaway project, and the ENOENT came out as a refusal
// about the package. The fault was in the caller.
//
// So there are three answers, not two. Exit 1 is a refusal ABOUT THESE BYTES. Exit 2 is a could-not-
// look, in the house meaning, and it says so in those words.
//
// ── AN INSTALL THAT SUCCEEDED AND LANDED NOTHING IS NOT A PASS ──────────────────────────────────────
//
// npm exits 0 on plenty of installs that put nothing where the caller expected it. So the exit status
// is the first half and the tree is the second: the package is read back out of `node_modules` by name
// and version, and every `bin` name it declares is checked on `.bin`. Absence is a finding.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";

/**
 * Is this npm failure about reaching the world, rather than about the artefact?
 *
 * MEASURED STRINGS, not guessed ones. `ENOTCACHED` is what an offline npm says when a dependency is not
 * in the cache — "request to https://registry.npmjs.org/… failed" — and it is the one this file's own
 * arm drives. The rest are the ordinary network and disk codes. `EINVALIDTAGNAME`, `EINTEGRITY` and a
 * malformed tarball are deliberately absent: those ARE about the bytes, and calling them could-not-look
 * would let a genuinely broken package publish.
 */
export function looksLikeCouldNotLook(said) {
  return /\b(ENOTCACHED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENETUNREACH|EAGAIN|ENOSPC|ENOENT|ERR_SOCKET_TIMEOUT)\b/i
    .test(String(said ?? ""))
    || /request to https?:\/\/[^\s]*registry[^\s]*\s+failed/i.test(String(said ?? ""))
    || /\bnetwork\b/i.test(String(said ?? ""));
}

/** The manifest inside a packed tarball, without unpacking the rest of it. */
export function manifestOf(tarballPath) {
  return JSON.parse(
    execFileSync("tar", ["-xzOf", tarballPath, "package/package.json"], { encoding: "utf8" }));
}

/** The `bin` field's command names, whichever of its two shapes it takes. */
export function binNames(manifest) {
  const bin = manifest?.bin;
  if (!bin) return [];
  if (typeof bin === "string") return [manifest.name.replace(/^@[^/]+\//, "")];
  return Object.keys(bin);
}

/**
 * Install `tarballPath` as the dependency of a throwaway project.
 *
 * @returns {{ok: boolean, why: string|null, installed: object|null, missingBins: string[]}}
 */
export function installsAsADependency(tarballPath, { keep = false, timeoutMs = 900_000 } = {}) {
  // ABSOLUTE, BECAUSE THE INSTALL RUNS SOMEWHERE ELSE. npm resolves a file path against ITS OWN cwd,
  // which here is the throwaway project rather than the caller's directory. CI passes
  // `./packed/clearotron-<version>.tgz` and this refused it — npm looked for `packed/` inside the temp
  // consumer and reported ENOENT, which arrives looking exactly like an artefact that will not install.
  // Every arm below had handed it an absolute temp path, so the class was armed on one member only.
  const abs = resolve(tarballPath);
  const manifest = manifestOf(abs);
  const consumer = mkdtempSync(join(tmpdir(), "clearotron-install-check-"));
  try {
    // A project of its own, with a name that is not this package's — npm treats an install of a
    // tarball whose name matches the root as a different case, and that case is not the one a
    // visitor is in.
    writeFileSync(join(consumer, "package.json"),
      `${JSON.stringify({ name: "clearotron-install-check-consumer", version: "1.0.0", private: true }, null, 2)}\n`);

    try {
      execFileSync("npm", ["install", abs, "--no-audit", "--no-fund"],
        { cwd: consumer, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: timeoutMs });
    } catch (e) {
      const said = `${e?.stderr ?? ""}`.trim() || `${e?.stdout ?? ""}`.trim() || `${e?.message ?? e}`;
      if (looksLikeCouldNotLook(said)) {
        return { ok: false, couldNotLook: true, missingBins: [], installed: null,
          why: `npm could not complete an install here for a reason that is not about these bytes:\n\n${said}` };
      }
      return { ok: false, couldNotLook: false, missingBins: [],  installed: null,
        why: `npm refused to install the packed artefact as a dependency:\n\n${said}` };
    }

    const landed = join(consumer, "node_modules", ...manifest.name.split("/"), "package.json");
    if (!existsSync(landed)) {
      return { ok: false, couldNotLook: false, installed: null, missingBins: [],
        why: `npm exited 0 and there is no ${manifest.name} under node_modules — the install reported `
          + "success and put nothing where a consumer would look for it" };
    }
    const installed = JSON.parse(readFileSync(landed, "utf8"));
    if (installed.version !== manifest.version) {
      return { ok: false, couldNotLook: false, installed, missingBins: [],
        why: `the tarball is ${manifest.name}@${manifest.version} and the installed tree holds `
          + `${installed.version} — something other than these bytes answered the install` };
    }
    const missingBins = binNames(manifest)
      .filter((b) => !existsSync(join(consumer, "node_modules", ".bin", b)));
    if (missingBins.length) {
      return { ok: false, couldNotLook: false, installed, missingBins,
        why: `the package installed and its command(s) did not reach .bin: ${missingBins.join(", ")}. `
          + "`npx clearotron demo` resolves through .bin, so this is the front door still shut with a "
          + "green install behind it" };
    }
    return { ok: true, couldNotLook: false, why: null, installed, missingBins: [] };
  } finally {
    if (keep) console.log(`kept: ${consumer}`);
    else rmSync(consumer, { recursive: true, force: true });
  }
}

function main() {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--tarball");
  const tarball = i >= 0 ? argv[i + 1] : null;
  if (!tarball) {
    console.error("usage: node scripts/release-install-check.mjs --tarball <path> [--keep]");
    process.exit(2);
  }
  if (!existsSync(tarball)) {
    console.error(`  REFUSING (exit 2, could-not-look): ${tarball} does not exist, so nothing was installed. `
      + "This is not the same as an artefact that installs.");
    process.exit(2);
  }

  let r;
  try { r = installsAsADependency(tarball, { keep: argv.includes("--keep") }); }
  catch (e) {
    console.error(`  REFUSING (exit 2, could-not-look): the check itself failed — ${String(e?.message ?? e)}`);
    process.exit(2);
  }

  if (r.couldNotLook) {
    console.error(`  COULD NOT LOOK (exit 2): ${r.why}\n`);
    console.error("  This says nothing about the artefact. It has not been cleared and it has not been "
      + "refused — the install did not get far enough to answer.");
    process.exit(2);
  }
  if (!r.ok) {
    console.error(`  REFUSING to publish ${tarball}:\n  ${r.why}\n`);
    console.error("  This is what a visitor gets from the command on clearotron.ai's copy button, and it "
      + "happens before any of this product's code runs.");
    process.exit(1);
  }
  console.log(`${r.installed.name}@${r.installed.version} installs as a dependency of a project with no checkout`);
  console.log(`  command(s) on .bin: ${binNames(r.installed).join(", ") || "none declared"}`);
}

if (isEntrypoint(import.meta.url)) main();
