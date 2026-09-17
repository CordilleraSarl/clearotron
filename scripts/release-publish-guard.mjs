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

/** The repository npm attests provenance for. It is in the workflow's job conditions too. */
export const REPOSITORY = "CordilleraSarl/clearotron";

/**
 * Every job in the workflow that actually publishes, as [id, text].
 *
 * TEXT, NOT YAML. This guard is deliberately a string reader — it must keep working on a workflow whose
 * YAML is malformed, because "the file no longer parses" is not a reason to let a publish through, and a
 * parser would throw before reaching a single check.
 *
 * A job is "publishing" if its own block runs `npm publish`. Comments are already stripped by the caller.
 */
export function jobBlocks(live) {
  const out = new Map();
  const starts = [...live.matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_-]*):$/gm)];
  for (let i = 0; i < starts.length; i++) {
    const from = starts[i].index;
    const to = i + 1 < starts.length ? starts[i + 1].index : live.length;
    out.set(starts[i][1], live.slice(from, to));
  }
  return out;
}

export function publishingJobs(live) {
  return [...jobBlocks(live)].filter(([, block]) => /\bnpm\s+publish\b/.test(block));
}

/**
 * The ONE job permitted to hold a registry credential, and the secret it must come from.
 *
 * Owner ruling 2026-09-17. Deprecating a published version is a write the OIDC exchange cannot make: the
 * short-lived credential npm mints for a trusted publish is scoped to publishing, and eleven deprecations
 * attempted with it came back 404 while reads succeeded. So this one job reads a granular token, created
 * by hand and held as a repository secret, into NODE_AUTH_TOKEN for its own step.
 *
 * WHAT THE RULING DID NOT CHANGE, and what the checks below hold: publishing stays credential-less. A
 * credential anywhere else in this file is the thing this guard was written for and is still refused. The
 * exemption is one named job, it may not publish, its credential must come from the named secret, and it
 * must be scoped to a step rather than to the job — a job-level `env:` would hand the token to every step
 * in it, including this guard.
 */
export const CREDENTIALLED_JOB = "deprecate";
export const DEPRECATE_SECRET = "NPM_DEPRECATE_TOKEN";

/** The only two lines in this file permitted to name a credential or a registry, spelled exactly. */
export const PERMITTED_CREDENTIAL_LINE = `NODE_AUTH_TOKEN: \${{ secrets.${DEPRECATE_SECRET} }}`;
export const PERMITTED_REGISTRY_LINE = "registry-url: https://registry.npmjs.org";

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

  // THE EXEMPTION IS TWO EXACT LINES, NOT A REGION, and the difference is not pedantry — it was measured.
  // Exempting the whole `deprecate` job looked equivalent and was not: that job is the LAST in the file,
  // so its block runs to end-of-file, and every plant this guard's own arms append at the end landed
  // inside the exemption. Four credential spellings went from refused to accepted in one edit, and the
  // arm caught it. So one occurrence of each permitted line is removed and everything else is scanned:
  // a second copy, a different spelling, or the same line in another job all stay in what is scanned.
  const deprecateBlock = jobBlocks(live).get(CREDENTIALLED_JOB) ?? "";
  let rest = live;
  for (const line of [PERMITTED_CREDENTIAL_LINE, PERMITTED_REGISTRY_LINE]) {
    if (!deprecateBlock.includes(line)) continue;   // permitted only where the ruling put it
    const at = rest.indexOf(line);
    if (at !== -1) rest = rest.slice(0, at) + rest.slice(at + line.length);
  }

  for (const tok of CREDENTIAL_TOKENS) {
    if (rest.includes(tok)) add(`the release workflow carries a registry credential (${tok})`);
  }
  // `registry-url:` on setup-node writes an .npmrc that authenticates with NODE_AUTH_TOKEN. Trusted
  // publishing needs no registry configured at all, so its presence means somebody is wiring a token.
  if (/registry-url:/.test(rest)) add("the release workflow configures a registry to authenticate against");

  // ── AND THE PERMITTED JOB IS HELD TO THE TERMS OF ITS OWN EXEMPTION ─────────────────────────────
  //
  // An exemption nobody checks is a hole. These are the conditions the ruling was given under, and each
  // one is a way the exemption could quietly become general.
  if (deprecateBlock) {
    if (/\bnpm\s+publish\b/.test(deprecateBlock)) {
      add(`job \`${CREDENTIALLED_JOB}\` publishes, and it is the one job allowed to hold a credential — `
        + "the two must never be the same job");
    }
    if (deprecateBlock.includes("NODE_AUTH_TOKEN") && !deprecateBlock.includes(`secrets.${DEPRECATE_SECRET}`)) {
      add(`job \`${CREDENTIALLED_JOB}\` takes its credential from something other than \`secrets.${DEPRECATE_SECRET}\``);
    }
    // Job-level `env:` sits at four spaces; a step's sits at eight. The distinction is the whole point:
    // a job-level block hands the token to every step, this guard included.
    if (/^ {4}env:/m.test(deprecateBlock) && deprecateBlock.includes("NODE_AUTH_TOKEN")) {
      add(`job \`${CREDENTIALLED_JOB}\` holds its credential at job level, so every step in it gets the token; `
        + "it belongs on the one step that deprecates");
    }
  }

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

  // ── AND EVERY PUBLISHING JOB CARRIES BOTH, not merely the file somewhere ────────────────────────────
  //
  // The two checks above ask whether the strings appear ANYWHERE. That was sufficient while one job
  // published. It stopped being sufficient the moment a second publishing job was added: a workflow
  // where one job holds `id-token: write` and the other does not passes both lines above and then fails
  // at the registry, mid-run, after the first version has already gone out and cannot be recalled.
  //
  // Found by an arm going green that should not have — the mutation that strips the permission used a
  // regex with no `g`, so it removed one of two occurrences and the guard still passed. The weakened
  // guard was the finding; the arm was only how it surfaced.
  for (const [id, block] of publishingJobs(live)) {
    if (!/id-token:\s*write/.test(block))
      add(`job \`${id}\` publishes but does not request an OIDC token (\`id-token: write\`), so its publish fails at the registry`);
    if (!/environment:\s*npm\b/.test(block))
      add(`job \`${id}\` publishes but does not run in the \`npm\` environment the publisher is registered under`);
  }

  // The last thing that runs before a publish from a working tree. It is not what protects CI — CI
  // publishes a tarball and npm runs no lifecycle script for one — it is what a laptop still hits.
  if (!rootPkg.scripts?.prepublishOnly) add("the root package has lost its `prepublishOnly` guard");

  // ── THE MANIFEST HAS TO NAME WHERE THE PACKAGE COMES FROM ───────────────────────────────────────
  //
  // `--provenance` makes npm attest the repository the build came from, and the registry then checks
  // that attestation AGAINST `repository.url` in the manifest. A missing or mismatched field is a 422 at
  // the registry — after the OIDC exchange has succeeded, after the tarball is built and scanned, at the
  // last possible moment and from the one place no local check looks. Measured 2026-09-05:
  //
  //   npm error 422 Unprocessable Entity - PUT https://registry.npmjs.org/clearotron
  //   Error verifying sigstore provenance bundle: Failed to validate repository information:
  //   package.json: "repository.url" is "", expected to match "https://github.com/CordilleraSarl/clearotron"
  //
  // Everything else in the release was correct, including the trusted publisher. This is here so the
  // next empty field is a refusal before anything is built rather than a rejection after everything is.
  const repoUrl = typeof rootPkg.repository === "string" ? rootPkg.repository : rootPkg.repository?.url;
  if (!repoUrl) {
    add("the root package names no `repository.url`, and `--provenance` makes the registry refuse a "
      + "manifest whose repository does not match the one it attested");
  } else {
    // Compared the way npm compares it: the scheme, the `git+` prefix and a `.git` suffix are all
    // spellings of the same repository, so the check is on owner/name rather than on the string.
    const slug = /github\.com[/:]([^/]+\/[^/.]+)/.exec(repoUrl)?.[1];
    if (slug !== REPOSITORY) {
      add(`the root package's \`repository.url\` names ${slug ?? "no GitHub repository"}, and provenance `
        + `will be attested for ${REPOSITORY} — the registry refuses that mismatch`);
    }
  }

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
