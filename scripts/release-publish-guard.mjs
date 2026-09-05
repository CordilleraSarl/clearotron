// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// release-publish-guard.mjs — the release pipeline publishes through OIDC, and carries no credential.
//
// THIS FILE REPLACES `release-no-publish-check.mjs`, WHICH ENFORCED A RULING THAT HAS MOVED. That check
// refused any `npm publish`, any `publish:` input and a root manifest that was not `"private": true`,
// because publishing was a human act (owner, 2026-08-26, restated 2026-08-31). Two later rulings
// replaced it: 2026-09-04, tag-triggered npm publish from CI approved; 2026-09-05, npm Trusted
// Publishing configured for this repository — publisher GitHub Actions, workflow `release.yml`,
// environment `npm`. The old check's own words were "if that has changed, the ruling moves first". It
// has, and this is the check the new ruling needs.
//
// WHAT IS STILL TRUE, AND IS WHAT THIS READS FOR. Trusted publishing means the registry trusts a short
// lived token this workflow exchanges for itself. A long-lived credential in the repository would
// publish just as well, from anywhere, forever, with nothing tying the artefact to a commit — and it
// would look identical in a green log. So the property is not "cannot publish" any more; it is
// "publishes ONLY the way the owner configured, and holds nothing that could publish another way".
//
// Every refusal below is a route to breaking that, and each is one plausible-looking edit away.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const WORKFLOW = ".github/workflows/release.yml";

/** Credential spellings that would let this repository publish without the OIDC exchange. */
export const CREDENTIAL_TOKENS = Object.freeze([
  "NPM_TOKEN",
  "NODE_AUTH_TOKEN",
  "NPM_CONFIG_TOKEN",
  "npm_config__auth",
  "_authToken",
]);

/** Every way this pipeline could publish other than the way it is meant to, as a named refusal. */
export function refusals({ workflow, rootPkg }) {
  const out = [];
  const add = (what) => out.push(what);

  // Comments are stripped first: this file and the workflow both DISCUSS credentials at length, and a
  // scanner that reads its own prose as a finding refuses the thing it is describing.
  const live = workflow.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

  for (const tok of CREDENTIAL_TOKENS) {
    if (live.includes(tok)) add(`the release workflow carries a registry credential (${tok})`);
  }
  // `registry-url:` on setup-node writes an .npmrc that authenticates with NODE_AUTH_TOKEN. Trusted
  // publishing needs no registry configured at all, so its presence means somebody is wiring a token.
  if (/registry-url:/.test(live)) add("the release workflow configures a registry to authenticate against");

  // A publish without provenance is a publish nobody can trace back to a commit — which is the whole
  // reason the owner's ruling moved from a human publish to a CI one.
  for (const line of live.split("\n")) {
    if (/\bnpm\s+publish\b/.test(line) && !/--provenance\b/.test(line)) {
      add("the release workflow publishes without `--provenance`");
    }
  }
  // Both halves of the trusted-publisher configuration, which lives on npmjs.com where no test can read
  // it: the OIDC token the exchange needs, and the environment name the publisher is registered under.
  // Either one missing makes the registry refuse at release time, which is the most expensive moment
  // available to discover it.
  if (!/id-token:\s*write/.test(live)) add("the release workflow cannot request an OIDC token (`id-token: write` is gone)");
  if (!/environment:\s*npm\b/.test(live)) add("the release workflow no longer runs in the `npm` environment the publisher is registered under");

  // The last thing that runs before a publish from a working tree. It is not what protects CI — CI
  // publishes a tarball and npm runs no lifecycle script for one — it is what a laptop still hits.
  if (!rootPkg.scripts?.prepublishOnly) add("the root package has lost its `prepublishOnly` guard");

  return out;
}

function main() {
  const wPath = join(ROOT, WORKFLOW);
  // A FILE THAT CANNOT BE READ IS NOT A PASS — exit 2, could-not-look, never 0.
  if (!existsSync(wPath)) {
    console.error(`release-publish-guard: ${WORKFLOW} is not there. This check's whole claim is that it `
      + "read the release pipeline; without it there is no claim.");
    process.exitCode = 2;
    return;
  }
  let workflow, rootPkg;
  try {
    workflow = readFileSync(wPath, "utf8");
    rootPkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  } catch (e) {
    console.error(`release-publish-guard: could not read what it must read (${e.message})`);
    process.exitCode = 2;
    return;
  }
  const found = refusals({ workflow, rootPkg });
  if (found.length) {
    console.error("release-publish-guard: this pipeline does not publish the way it was authorised to.\n");
    for (const f of found) console.error("  ✕ " + f);
    console.error("\nOwner rulings 2026-09-04 and 2026-09-05: publishing happens in CI, on a tag, through "
      + "npm Trusted Publishing — no registry credential comes near this repository. If that has changed, "
      + "the ruling moves first.");
    process.exitCode = 1;
    return;
  }
  console.log("release-publish-guard: the pipeline publishes with provenance through OIDC, and carries no credential");
}

if (isEntrypoint(import.meta.url)) main();
