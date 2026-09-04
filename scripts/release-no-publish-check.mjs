// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// release-no-publish-check.mjs —: prove nothing reaches npm.
//
// The issue names this failure rather than leaving it to be discovered: "a green pipeline that has
// quietly become able to publish is the worst outcome available here." A pipeline acquires that ability
// by one line — a `publish:` input, a registry token in the environment, an `npm publish` in a run
// block — and every one of those is a small, plausible-looking edit that no test would otherwise notice,
// because the pipeline goes on being green either way.
//
// So this reads the workflow and the manifests and refuses on any of them. It runs FIRST in the release
// job, before anything can act.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const WORKFLOW = ".github/workflows/release.yml";

/** Every way this tree could publish, as a named refusal. Empty means it cannot. */
export function refusals({ workflow, rootPkg }) {
  const out = [];
  const add = (what) => out.push(what);

  // Comments are stripped first: this file and the workflow both DISCUSS publishing at length, and a
  // scanner that reads its own prose as a finding is the shape 's audit was bitten by.
  const live = workflow.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

  if (/\bnpm\s+publish\b/.test(live)) add("the release workflow runs `npm publish`");
  if (/\byarn\s+publish\b|\bpnpm\s+publish\b/.test(live)) add("the release workflow runs a package-manager publish");
  if (/^\s*publish:/m.test(live)) add("the release action is given a `publish:` command");
  for (const tok of ["NPM_TOKEN", "NODE_AUTH_TOKEN", "NPM_CONFIG_TOKEN", "npm_config__auth"]) {
    if (live.includes(tok)) add(`the release workflow carries a registry credential (${tok})`);
  }
  if (/registry-url:/.test(live)) add("the release workflow configures a registry to authenticate against");

  // THE TWO GUARDS 2055's Depends-on SAYS MUST NOT WEAKEN. Named separately from the workflow because
  // they protect a publish from ANY source, including a laptop.
  if (rootPkg.private !== true) add('the root package is no longer `"private": true`');
  if (!rootPkg.scripts?.prepublishOnly) add("the root package has lost its `prepublishOnly` guard");

  return out;
}

function main() {
  const wPath = join(ROOT, WORKFLOW);
  // A FILE THAT CANNOT BE READ IS NOT A PASS — exit 2, could-not-look, never 0.
  if (!existsSync(wPath)) {
    console.error(`release-no-publish-check: ${WORKFLOW} is not there. This check's whole claim is that `
      + "it read the release pipeline; without it there is no claim.");
    process.exitCode = 2;
    return;
  }
  let workflow, rootPkg;
  try {
    workflow = readFileSync(wPath, "utf8");
    rootPkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  } catch (e) {
    console.error(`release-no-publish-check: could not read what it must read (${e.message})`);
    process.exitCode = 2;
    return;
  }
  const found = refusals({ workflow, rootPkg });
  if (found.length) {
    console.error("release-no-publish-check: this pipeline can publish, and it must not.\n");
    for (const f of found) console.error("  ✕ " + f);
    console.error("\nOwner ruling 2026-08-26, restated 2026-08-31: publishing stays a human act and no "
      + "registry token comes near this repository. If that has changed, the ruling moves first.");
    process.exitCode = 1;
    return;
  }
  console.log("release-no-publish-check: the pipeline versions, tags and releases — it cannot publish");
}

if (isEntrypoint(import.meta.url)) main();
