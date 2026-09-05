// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// tracker issue 97 — the release pipeline, held at the four places it can fail silently:
//   · it acquires a way to publish that is not the one the owner authorised
//   · a pre-release lands on `latest` and becomes what every new user installs
//   · a package ships with a demo or the portal bundle missing, and npm accepts it
//   · a changelog line reaches a reader who cannot act on it
//
// Every guard here is PLANTED against a member it was not written from. An arm that only proves the
// current tree is clean cannot tell a working guard from one that stopped looking.
//
// NOTHING HERE ASSERTS THE STATE OF THIS WORKING TREE'S `portal-ui/dist`. The bundle is built, not
// committed, and the CI job that runs this suite does not build it — an arm reading it would be green
// by the box that ran it and red on the runner. The completeness arms drive synthetic trees instead.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { findings, BANNED_WORDS } from "../../scripts/changelog-plain-language.mjs";
import { refusals as publishRefusals, WORKFLOW, CREDENTIAL_TOKENS } from "../../scripts/release-publish-guard.mjs";
import { distTag, isPrerelease, STABLE, UNNAMED_PRERELEASE } from "../../scripts/release-dist-tag.mjs";
import { refusals as completenessRefusals } from "../../scripts/release-completeness-check.mjs";
import { notesFor } from "../../scripts/release-notes-for.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const rootPkg = () => JSON.parse(read("package.json"));

/** A tree that satisfies the completeness check, so each arm can break exactly one thing about it. */
function completeTree() {
  const dir = mkdtempSync(join(tmpdir(), "release-complete-"));
  for (const [child, entry] of [["global-preliminary-search", "report.md"], ["knockout-search", "knockout-findings.json"]]) {
    mkdirSync(join(dir, "demo", child, "run"), { recursive: true });
    writeFileSync(join(dir, "demo", child, "meta.json"), "{}");
    writeFileSync(join(dir, "demo", child, "run", entry), "x");
  }
  mkdirSync(join(dir, "portal-ui", "dist", "assets"), { recursive: true });
  writeFileSync(join(dir, "portal-ui", "dist", "index.html"), "<!doctype html>");
  writeFileSync(join(dir, "portal-ui", "dist", "assets", "index-abc123.js"), "//");
  return dir;
}

test("tracker 97 the release pipeline publishes the way it was authorised to, and the check that says so can fail", () => {
  assert.deepEqual(publishRefusals({ workflow: read(WORKFLOW), rootPkg: rootPkg() }), [],
    "the release pipeline as shipped does not satisfy its own guard");

  // THE PLANTS. Each is a different route to publishing outside the OIDC exchange the owner configured,
  // because a check that catches one spelling and not the others is the uniform-fix defect.
  nonEmpty(CREDENTIAL_TOKENS, "the credential spellings");
  const plants = [
    ["a registry credential in an env block", "        env:\n          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}\n"],
    ["a second spelling of the same thing", "        env:\n          NPM_CONFIG_TOKEN: xxx\n"],
    ["an auth token written into .npmrc", "      - run: echo '//registry.npmjs.org/:_authToken=x' > .npmrc\n"],
    ["a registry to authenticate against", "          registry-url: https://registry.npmjs.org\n"],
    ["a publish with no provenance", "      - run: npm publish --access public\n"],
  ];
  for (const [what, line] of plants) {
    const got = publishRefusals({ workflow: read(WORKFLOW) + "\n" + line, rootPkg: rootPkg() });
    assert.ok(got.length, `the guard passed a workflow carrying ${what}`);
  }

  // And the two halves of the registry's own configuration, which no test can read from npmjs.com. A
  // workflow that loses either is refused HERE rather than by the registry on release day.
  for (const [what, gone] of [["the OIDC permission", /id-token:\s*write/], ["the npm environment", /environment:\s*npm\b/]]) {
    const stripped = read(WORKFLOW).replace(gone, "removed-by-this-arm");
    assert.ok(publishRefusals({ workflow: stripped, rootPkg: rootPkg() }).length,
      `the guard passed a workflow that had lost ${what}`);
  }

  // The last thing between a person publishing from a laptop and an incomplete package.
  const noGuard = { ...rootPkg(), scripts: { ...rootPkg().scripts } };
  delete noGuard.scripts.prepublishOnly;
  assert.ok(publishRefusals({ workflow: read(WORKFLOW), rootPkg: noGuard }).length,
    "the guard passed a root package that has lost prepublishOnly");
});

test("tracker 97 the guard reads the workflow's PROSE without refusing on it", () => {
  // The workflow explains what it must never carry, and this guard's own file names every credential
  // spelling in its comments. A scanner that reads its own prose as a finding refuses the thing it is
  // describing — which is how an audit of this same class was bitten before.
  const commentary = "# A registry credential (NPM_TOKEN or NODE_AUTH_TOKEN) must never appear here.\n"
    + "  # and never a registry-url: either\n";
  assert.deepEqual(publishRefusals({ workflow: read(WORKFLOW) + "\n" + commentary, rootPkg: rootPkg() }), [],
    "a comment naming what is forbidden was read as the forbidden thing");
});

test("tracker 97 the shipped workflow publishes on a channel it derived, never a defaulted one", () => {
  const workflow = read(WORKFLOW);
  const publishLine = workflow.split("\n").find((l) => /^\s*run:\s*npm publish\b/.test(l.trim()) || /-\s*run:\s*npm publish\b/.test(l));
  assert.ok(publishLine, "the workflow no longer has a publish command on one line — the guard reads it line by line");
  assert.match(publishLine, /--tag\b/, "the publish does not pass --tag, so npm would put it on `latest`");
  assert.match(publishLine, /dist_tag/, "the publish passes a --tag that was not derived from the version");
  // The registry's trusted publisher is registered against this FILENAME. Renaming the file is a rename
  // nothing else in the repository would notice, and the registry refuses the publish when it happens.
  assert.equal(WORKFLOW, ".github/workflows/release.yml",
    "npm's trusted publisher names this workflow file; renaming it breaks the publish, not a test");
});

test("tracker 97 a pre-release goes to its own channel, and a stable one to latest", () => {
  assert.equal(distTag("0.1.1"), STABLE);
  assert.equal(distTag("1.0.0"), STABLE);
  assert.equal(distTag("0.1.1-beta.0"), "beta");
  assert.equal(distTag("0.2.0-rc.1"), "rc");
  assert.equal(distTag("0.2.0-next.3"), "next");
  // Semver allows a numeric-only pre-release identifier, which names no channel. It must not fall
  // through to `latest` — that is the whole failure this file exists to prevent.
  assert.equal(distTag("1.0.0-0"), UNNAMED_PRERELEASE);
  assert.notEqual(distTag("1.0.0-0"), STABLE);
  // Build metadata is not a pre-release.
  assert.equal(distTag("1.0.0+build.5"), STABLE);

  assert.equal(isPrerelease("0.1.1-beta.0"), true);
  assert.equal(isPrerelease("0.1.1"), false);

  // A version this cannot read REFUSES. Guessing would produce `latest` by default.
  for (const bad of ["v0.1.1", "", "0.1", "latest", null]) {
    assert.throws(() => distTag(bad), /not a version this can read/,
      `distTag(${JSON.stringify(bad)}) returned a channel instead of refusing`);
  }
});

test("tracker 97 an incomplete package is refused, one broken thing at a time", () => {
  const dir = completeTree();
  try {
    assert.deepEqual(completenessRefusals(dir), [], "a complete tree was refused");

    // A demo child present but missing its lane's entry file — the shape where `npm run demo` offers a
    // product that cannot be opened.
    const halfDemo = completeTree();
    rmSync(join(halfDemo, "demo", "knockout-search", "run", "knockout-findings.json"));
    assert.ok(completenessRefusals(halfDemo).some((r) => r.includes("knockout-search")),
      "a demo product with no entry file was accepted");
    rmSync(halfDemo, { recursive: true, force: true });

    // A demo the repository has and the package does not. "Every demo present is complete" is satisfied
    // by a package carrying one of four, so the tarball is measured against the tree.
    assert.ok(completenessRefusals(dir, { expectDemos: ["global-preliminary-search", "multi-country-focus-search"] })
      .some((r) => r.includes("multi-country-focus-search")),
      "a package missing one of the repository's demo products was accepted");

    // No demos at all — an empty container must not read as "nothing wrong here".
    const noDemos = completeTree();
    rmSync(join(noDemos, "demo"), { recursive: true, force: true });
    assert.ok(completenessRefusals(noDemos).length, "a package with no demo products at all was accepted");
    rmSync(noDemos, { recursive: true, force: true });

    // The bundle that is built rather than committed: pack before the build and the portal serves
    // nothing while the install reports healthy.
    const noBundle = completeTree();
    rmSync(join(noBundle, "portal-ui", "dist", "index.html"));
    assert.ok(completenessRefusals(noBundle).some((r) => r.includes("portal bundle")),
      "a package with no portal bundle was accepted");
    rmSync(noBundle, { recursive: true, force: true });

    // An index.html with no script: a build that started and did not finish.
    const noScript = completeTree();
    rmSync(join(noScript, "portal-ui", "dist", "assets"), { recursive: true, force: true });
    assert.ok(completenessRefusals(noScript).length, "a bundle with no script was accepted");
    rmSync(noScript, { recursive: true, force: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tracker 97 a tarball that is not there is a could-not-look, never a pass", () => {
  const script = join(ROOT, "scripts", "release-completeness-check.mjs");
  let code = 0;
  try {
    execFileSync(process.execPath, [script, "--tarball", join(tmpdir(), "no-such-package-4f2a.tgz")], { stdio: "pipe" });
  } catch (e) {
    code = e.status;
  }
  assert.equal(code, 2, "a missing tarball exited something other than 2 — the shape where the pack "
    + "failed and the scan reported clean");
});

test("tracker 97 the GitHub release says what the changelog says, and stays silent when there is nothing to say", () => {
  const changelog = "# Changelog\n\nWhat changed.\n\n## 0.2.0\n\n- A clearance now names the registers it searched.\n\n## 0.1.0\n\n- The first release.\n";
  assert.equal(notesFor("0.2.0", changelog), "- A clearance now names the registers it searched.");
  // The LAST section of the file, which is the one a "to the next heading or end of file" lookahead
  // silently returns nothing for.
  assert.equal(notesFor("0.1.0", changelog), "- The first release.");
  assert.equal(notesFor("9.9.9", changelog), "", "a version with no section must return empty, not the whole file");
});

test("tracker 97 the plain-language gate refuses each kind it exists to refuse", () => {
  nonEmpty(BANNED_WORDS, "the banned-word list");
  assert.deepEqual(findings("- A clearance now says which registers it searched, so an empty result reads "
    + "differently from a search that never ran."), [],
    "clean prose was refused — the gate is too eager to be usable");
  for (const line of ["- Refactored the queue.", "- The queue now drains, see stages.mjs.", "- Now calls parseVerdict() first."]) {
    assert.ok(findings(line).length, `"${line}" passed the gate — it must not`);
  }
  assert.deepEqual(findings("- The report complements the search."), [],
    '"complements" contains "implements" — a substring match would refuse this and the gate would be noise');
});
