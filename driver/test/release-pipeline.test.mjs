// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// the release pipeline, held at the four places it can fail silently:
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
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { findings, BANNED_WORDS } from "../../scripts/changelog-plain-language.mjs";
import { refusals as publishRefusals, WORKFLOW, CREDENTIAL_TOKENS, REPOSITORY, publishingJobs } from "../../scripts/release-publish-guard.mjs";
import { distTag, isPrerelease, preModeFrom, STABLE, UNNAMED_PRERELEASE } from "../../scripts/release-dist-tag.mjs";
import { cutDecision, versionAtHead } from "../../scripts/release-cut-decision.mjs";
import { checksVerdict, waitForChecks, RUNNING, NOTHING_STARTED, WAITING_FOR_A_PERSON, exitCodeFor, CHECKS_WINDOW_MS, CHECKS_JOB_MARGIN_MS } from "../../scripts/release-version-pr-checks.mjs";
import { refusals as completenessRefusals } from "../../scripts/release-completeness-check.mjs";
import { notesFor } from "../../scripts/release-notes-for.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";
import { assembleRoot, writeRootChangelog, group } from "../../scripts/release-version.mjs";
import { unreachableBareSites, sentenceFor } from "../../shared/root-doc-commands.mjs";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const rootPkg = () => JSON.parse(read("package.json"));

/**
 * The release workflow's JOB names.
 *
 * SCOPED TO THE `jobs:` SECTION, and that is not fussiness: `on:` has two-space keys of its own, so a
 * naive scan of the whole file returns `push` and `schedule` as jobs and every count derived from it is
 * wrong by two. The colon comes off, because an arm asking `includes("pending")` of `["pending:"]` is an
 * arm that answers no about a job that is right there.
 */
function releaseJobs(workflow) {
  const jobs = workflow.slice(workflow.indexOf("\njobs:\n"));
  return jobs.split("\n").filter((l) => /^  [a-z][a-z-]*:$/.test(l)).map((l) => l.trim().replace(/:$/, ""));
}

/**
 * The same YAML with its comment lines removed — what the runner actually executes.
 *
 * EVERY ARM ASSERTING WHAT A JOB DOES WANTS THIS, NOT THE RAW TEXT (tracker issue 298). The workflow's
 * comments are long by design and they name the scripts, jobs and settings they discuss, so a raw-text
 * assertion is answered by prose. It fails in both directions and both were live here:
 *
 *   · an arm requiring a name found it in a comment and stayed GREEN after the step was deleted;
 *   · three arms requiring a name to be ABSENT, or to come after another, went RED when a comment
 *     mentioned it — a correct workflow, reddened by documenting it.
 *
 * The second kind is worse than it looks. It does not just cost a cycle: it teaches whoever hits it that
 * the way to get green is to say less in the comments of the one file whose comments are load-bearing.
 *
 * This was already the house habit — seven arms hand-rolled this exact filter before it had a name.
 * Having a name is what lets the next arm find it.
 */
function executableText(yaml) {
  return yaml.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
}

/** A tree that satisfies the completeness check, so each arm can break exactly one thing about it. */
function completeTree() {
  const dir = mkdtempSync(join(tmpdir(), "release-complete-"));
  for (const [child, entry] of [["global-preliminary-search", "report.md"], ["knockout-search", "knockout-findings.json"]]) {
    mkdirSync(join(dir, "demo", child, "run"), { recursive: true });
    writeFileSync(join(dir, "demo", child, "meta.json"), "{}");
    writeFileSync(join(dir, "demo", child, "run", entry), "x");
  }
  // The licence record is part of a complete package now — see the notices arms. Written at the floor so
  // an arm about something else does not fail for this reason.
  writeFileSync(join(dir, "THIRD-PARTY-NOTICES.md"),
    Array.from({ length: 200 }, (_, i) => `## package-${i}`).join("\n"));
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
  for (const [what, gone] of [["the OIDC permission", /id-token:\s*write/g], ["the npm environment", /environment:\s*npm\b/g]]) {
    // GLOBAL. Without `g` this removed ONE of two occurrences once a second publishing job existed, the
    // guard still found the other, and the arm went green over a workflow that would fail at the
    // registry mid-run. The weakened guard was the finding; this was only how it surfaced.
    const stripped = read(WORKFLOW).replace(gone, "removed-by-this-arm");
    assert.ok(publishRefusals({ workflow: stripped, rootPkg: rootPkg() }).length,
      `the guard passed a workflow that had lost ${what}`);

    // AND LOSING IT IN ONE PUBLISHING JOB IS ENOUGH. This is the case a file-wide check cannot see: the
    // first version publishes, the second reaches the registry with no token, and the run fails after
    // something irreversible has already happened.
    const wf = read(WORKFLOW);
    const at = wf.indexOf("  publish-awaited:");
    assert.ok(at > 0, "the second publishing job is gone — this plant could not be placed");
    const got = publishRefusals({ workflow: wf.slice(0, at) + wf.slice(at).replace(gone, "removed-by-this-arm"), rootPkg: rootPkg() });
    assert.ok(got.some((r) => /publish-awaited/.test(r)),
      `the guard passed a workflow where only the SECOND publishing job had lost ${what} — it checks the `
      + `file, not the job that publishes. Refusals were: ${JSON.stringify(got)}`);
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

test("tracker 230 a pre-release goes to `beta` and a stable to `latest` — the channel is the version's", () => {
  // REPLACES THE 2026-09-05 RULING ("latest has all our fixes"), which was right while nothing installed
  // the package and wrong once things did: nine versions reached the npm page in two days, three of them
  // broken, and every one was what a plain `npm install clearotron` handed a stranger.
  //
  // `preMode` NO LONGER CHANGES THE ANSWER, and that is the property worth pinning. The override was
  // deleted rather than inverted: Changesets already produces `0.2.1-beta.0` in pre mode, and the label
  // is read straight out of it, so the version carries its own channel. Writing `if (preMode) return
  // BETA` would hardcode a name that `changeset pre enter <tag>` chooses, and the two would disagree the
  // first time anybody entered pre mode under another name.
  for (const preMode of [true, false]) {
    assert.equal(distTag("0.2.1-beta.0", { preMode }), "beta",
      `a beta reached ${distTag("0.2.1-beta.0", { preMode })} with preMode=${preMode} — a pre-release on `
      + "`latest` is what a stranger gets from a plain `npm install`");
    assert.equal(distTag("1.0.0-rc.1", { preMode }), "rc");
    assert.equal(distTag("0.2.0", { preMode }), STABLE);
    assert.equal(distTag("0.1.9", { preMode }), STABLE);
  }

  // AN UNREADABLE VERSION STILL REFUSES IN PRE MODE, and that matters more here rather than less: the
  // answer would be `latest` for the right reason and by accident.
  assert.throws(() => distTag("v0.1.1", { preMode: true }), /not a version this can read/);

  // THE GITHUB RELEASE'S FLAG COMES FROM THE VERSION, never from the channel — and this matters MORE
  // under the two-channel rule, not less. While pre mode forced `latest`, deriving the flag from the
  // channel produced a visibly wrong answer that this arm caught. Now channel and flag agree for a beta,
  // so the same wrong derivation would give the right answer by coincidence and nothing would notice —
  // until the first version whose channel is not its channel-shaped label.
  //
  // THE WORKFLOW DID EXACTLY THAT. `PRERELEASE=""; if [ "$DIST_TAG" != "latest" ]` — with the inversion
  // in place, `DIST_TAG` is `latest` for `0.1.1-beta.0`, so the flag was never passed and the first beta
  // would have gone up as the stable release. The function existed, was exported, was asserted here, and
  // the pipeline never called it: a check present at one stage and absent at the next.
  const workflow = read(WORKFLOW);
  assert.match(workflow, /release-dist-tag\.mjs "\$VERSION" --prerelease/,
    "the pipeline does not ask the VERSION whether it is a pre-release");
  // COMMENTS DROPPED FIRST. The workflow explains the old form in prose right beside the new one, and an
  // arm that reads the whole file refuses the explanation — the same way an earlier arm here matched
  // `/PAT/i` against `--pack-destination`. A guard that fires on ordinary English is a guard people delete.
  const executable = executableText(workflow);
  assert.ok(!/DIST_TAG" != "latest"/.test(executable),
    "the GitHub release's prerelease flag is derived from the CHANNEL again, so a beta on `latest` goes "
    + "up as the stable release");
  assert.match(workflow, /PRERELEASE_FLAG" = "true"/, "the flag the step computed is not the one it reads");

  // THE TWO ARE COMPUTED FROM THE VERSION BY DIFFERENT ROUTES, and the arm says so rather than relying
  // on them disagreeing somewhere. `isPrerelease` reads the version's own suffix; `distTag` reads the
  // label inside that suffix. They now agree for every ordinary version, which is why the coupling is
  // asserted here instead of being left to a case that no longer exists.
  assert.equal(isPrerelease("0.2.1-beta.0"), true);
  assert.equal(distTag("0.2.1-beta.0", { preMode: true }), "beta");
  assert.equal(isPrerelease("0.2.0"), false);
  assert.equal(distTag("0.2.0", { preMode: true }), STABLE);

  // AND A VERSION IT CANNOT READ REFUSES rather than answering `false`, which is the unsafe answer: it
  // marks the release stable — the state a reader trusts most — off a string nobody could parse.
  for (const bad of ["v0.1.1", "", "0.1", "latest", null]) {
    assert.throws(() => isPrerelease(bad), /not a version this can read/,
      `isPrerelease(${JSON.stringify(bad)}) called it stable instead of refusing`);
  }

  // `pre exit` LEAVES THE FILE BEHIND with mode "exit". Reading the file's existence as the answer would
  // keep publishing stable versions as though they were pre-releases, for ever.
  assert.equal(preModeFrom('{"mode":"pre","tag":"beta"}'), true);
  assert.equal(preModeFrom('{"mode":"exit","tag":"beta"}'), false);
  assert.equal(preModeFrom(null), false);
  // And a file it cannot read is not "not in pre mode" — that answer publishes silently onto whatever
  // the version implies.
  assert.throws(() => preModeFrom("{not json"), /unreadable/);
});

test("tracker 97 the version pull request merges itself, because main will not take a direct push", () => {
  // Full automation with no bypass credential. `main` is protected with required checks, so a workflow
  // pushing the version commit straight to it is a push the protection rejects — and without the bump
  // landing, the notes stay pending and the next merge tries to publish a version already on the
  // registry. Auto-merge is what gets it onto the branch through the rules rather than past them.
  const workflow = read(WORKFLOW);
  assert.match(workflow, /gh pr merge .*--auto/,
    "the standing version pull request no longer merges itself — the pipeline deadlocks rather than stopping");
  // The credential names, whole-word and case-sensitive where they are acronyms. The first draft of this
  // matched /PAT/i, which is "patch" and "path" — it refused the workflow for containing the word
  // `--pack-destination`. A guard that fires on ordinary English is a guard people delete.
  for (const spelling of ["ADMIN_TOKEN", "GH_PAT", "PERSONAL_ACCESS_TOKEN", "BYPASS_TOKEN"]) {
    assert.ok(!workflow.includes(spelling),
      `a credential that can write past branch protection appeared in the release workflow (${spelling})`);
  }
  // And the guard that reads for credentials generally is still the one that runs first in both jobs.
  // Counted as INVOCATIONS, not mentions: the file names itself in a comment as well, and an arm that
  // counts the string goes red the day somebody explains the guard in prose.
  // COUNTED PER JOB, not against a number. This was `=== 2`, and the day a third job was added the arm
  // said "two, correct" about a workflow where one job now published unguarded. Every job that checks
  // out this repository runs it, so the count is derived from the jobs rather than typed here.
  const jobNames = releaseJobs(workflow);
  assert.ok(jobNames.length >= 3, `only ${jobNames.length} job(s) found in the release workflow — the scan is not reading it`);
  assert.equal((workflow.match(/run: node scripts\/release-publish-guard\.mjs/g) ?? []).length, jobNames.length,
    `the credential guard runs in ${(workflow.match(/run: node scripts\/release-publish-guard\.mjs/g) ?? []).length} `
    + `of the release workflow's ${jobNames.length} jobs`);
});

test("tracker 97 the branch is checked explicitly, because these guards are the whole gate", () => {
  // The approval environment is gone by the owner's ruling: nothing human stands between a merge and a
  // publish. What stands there is this list, so it is asserted as a list.
  const workflow = read(WORKFLOW);
  for (const [what, re] of [
    ["the event", /github\.event_name.*=.*"push"/],
    ["the repository", /github\.repository == 'CordilleraSarl\/clearotron'/],
    ["the branch", /refs\/heads\/main\) ;;/],
    ["the version, from the commit", /release-cut-decision\.mjs/],
  ]) {
    assert.match(workflow, re, `the publish path no longer checks ${what}`);
  }
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
  // THE FIXTURE IS BUILT BY THE GENERATOR, not typed here. This used to be a hand-written string with a
  // two-line head, and the pipeline's own head is four lines with an install sentence in it — so the arm
  // would have gone on passing over a shape the release no longer writes. What a customer reads on the
  // releases page is cut out of this file by this function; a fixture that cannot drift with the
  // generator is a fixture that has stopped testing.
  const dir = mkdtempSync(join(tmpdir(), "release-notes-"));
  let changelog;
  try {
    writeRootChangelog({ version: "0.1.0", ...group(["New: The first release."]) }, dir);
    const p = writeRootChangelog({ version: "0.2.0", ...group(["Fixed: A clearance now names the registers it searched."]) }, dir);
    changelog = readFileSync(p, "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.match(changelog, /npm install -g clearotron/, "the fixture is no longer what the pipeline writes");
  // THE RELEASE BODY CARRIES THE GROUPING, because it is the same text as the changelog section — the
  // owner's ruling is that both are generated from the notes and grouped New / Fixed / For operators.
  assert.equal(notesFor("0.2.0", changelog),
    "### Fixed\n\n- A clearance now names the registers it searched.");
  // THE HEAD IS NOT RELEASE NOTES. It sits above every version heading, and a reader of the releases page
  // has already installed — telling them how again, inside the notes for one version, is noise.
  assert.ok(!notesFor("0.2.0", changelog).includes("npm install -g"),
    "the changelog's head is bleeding into the GitHub release body");
  // The LAST section of the file, which is the one a "to the next heading or end of file" lookahead
  // silently returns nothing for.
  assert.equal(notesFor("0.1.0", changelog), "### New\n\n- The first release.");
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


test("tracker 97 the cut decision reads the commit, not the tree the version step just rewrote", () => {
  // THE DEFECT THIS CLOSES SHIPPED AND FIRED. `changeset version` runs in place: it rewrites every
  // manifest on disk and hands the result to a pull request for somebody to merge. The decision that
  // followed it read `package.json` from disk, saw `0.1.1-beta.0`, found no tag for it, and reported
  // that the push had cut it — on a branch that still carried 0.1.0 with nobody having merged anything.
  // The publish job started. It failed for an unrelated reason, and that is the only thing that stopped
  // a publish nobody had authorised.
  //
  // So the version comes from the COMMIT. Driven here against a fake git that answers differently for
  // the tree and the commit, which is exactly the state that produced the failure.
  const commitVersion = "0.1.0";
  const treeVersion = "0.1.1-beta.0";
  const run = (args) => {
    assert.deepEqual(args.slice(0, 2), ["show", "HEAD:package.json"],
      "the version must be read out of the commit — reading a file is what caused this");
    return JSON.stringify({ version: commitVersion });
  };
  assert.equal(versionAtHead({ run }), commitVersion,
    `the decision read ${treeVersion} from disk instead of the commit's version`);

  // And the decision itself: released means tagged.
  assert.deepEqual(cutDecision({ version: "0.1.0", tags: ["v0.1.0"] }), { version: "0.1.0", cut: false });
  assert.deepEqual(cutDecision({ version: "0.1.1-beta.0", tags: ["v0.1.0"] }), { version: "0.1.1-beta.0", cut: true });

  // A version it cannot read REFUSES rather than deciding. The safe answer to an unreadable version is
  // never "publish it".
  for (const bad of ["", "v0.1.0", "latest", null, undefined]) {
    assert.throws(() => cutDecision({ version: bad, tags: [] }), /is not a version/);
  }
});

test("tracker 97 the published artefact is named as a file, not as a repository", () => {
  // npm read `release-artefacts/clearotron-0.1.0.tgz` as the `owner/repo` shorthand for a git dependency
  // and refused the release: "Refusing to fetch github:release-artefacts/clearotron-0.1.0.tgz". A
  // relative path with a directory in it is ambiguous to npm's spec parser; a leading `./` is what makes
  // it a file. This is a one-character defect that can only appear on a release.
  const workflow = read(WORKFLOW);
  const publishLine = workflow.split("\n").find((l) => /npm publish/.test(l) && !/^\s*#/.test(l));
  assert.ok(publishLine, "the workflow no longer has a publish command to read");
  assert.match(publishLine, /npm publish "\.\//,
    "the tarball is passed to npm without a leading `./`, so npm reads it as a git repository and refuses");
});

test("tracker 97 a version pull request whose checks never started is a refusal, not a wait", async () => {
  // MEASURED HERE, 2026-09-05. The fork-approval policy counted `github-actions[bot]` as an external
  // contributor, so the run for the version pull request was created in `action_required`. The pull
  // request carried ZERO check runs, auto-merge had nothing to wait for and nothing to refuse on, and
  // nothing anywhere was red. The version sat unmerged with the release notes still pending.

  // Something is running: the pull request will merge or it will not, and either is an answer.
  const running = checksVerdict({
    checkRuns: [{ name: "The offline suites", status: "in_progress", conclusion: null }],
    workflowRuns: [{ name: "CI", status: "in_progress", conclusion: null }],
  });
  assert.equal(running.state, RUNNING);

  // Nothing at all. The empty list that reads as a pass.
  assert.equal(checksVerdict({ checkRuns: [], workflowRuns: [] }).state, NOTHING_STARTED);
  assert.equal(checksVerdict({}).state, NOTHING_STARTED);

  // ── THE ARM THAT DECIDES THE DESIGN ──────────────────────────────────────────────────────────────
  // The shape actually met: a workflow run parked on an approval, and ZERO check runs beside it, because
  // a parked run publishes none. A guard that only asked "is the check-run count above zero" would call
  // this "nothing started" — true, useless, and it sends the next reader hunting a broken trigger
  // instead of a policy setting. `action_required` is read FIRST, and off the surface that carries it.
  const parkedAlone_input = {
    checkRuns: [],
    workflowRuns: [{ name: "CI", status: "action_required", conclusion: null }],
  };
  const parkedAlone = checksVerdict(parkedAlone_input);
  assert.equal(parkedAlone.state, WAITING_FOR_A_PERSON);
  assert.notEqual(parkedAlone.state, NOTHING_STARTED);
  assert.deepEqual(parkedAlone.blocked, ["CI"]);
  assert.match(parkedAlone.reason, /fork-pull-request approval policy/);

  // AND THE REFUSAL CAN BE ACTED ON WITHOUT A HUNT. This fires on every version pull request, and is
  // read by whoever is on shift rather than by whoever built it. The run id is the only thing not
  // already in the sentence, so the sentence carries it and the command that clears it.
  const actionable = checksVerdict({
    checkRuns: [],
    workflowRuns: [{ name: "CI", status: "action_required", conclusion: null, id: 33978066181 }],
    repo: "CordilleraSarl/clearotron",
  });
  assert.match(actionable.reason,
    /gh api -X POST repos\/CordilleraSarl\/clearotron\/actions\/runs\/33978066181\/approve/,
    "the refusal names the park but not the one command that clears it");

  // And with nothing to name it says nothing rather than printing half a command.
  assert.ok(!/gh api/.test(parkedAlone.reason),
    "a command was composed from a run with no id, which would print a broken instruction");

  // THE POLICY IS READ, NOT REMEMBERED. It was changed three times on 2026-09-05 — all external
  // contributors, then first-time contributors, then first-time contributors new to GitHub — and the bot
  // parked under two of them. A guard naming a stale value sends the next reader to check a setting that
  // has already moved, which is worse than naming none.
  assert.match(checksVerdict({ ...parkedAlone_input, policy: "first_time_contributors_new_to_github" }).reason,
    /policy is `first_time_contributors_new_to_github`/);
  // And it no longer sends the reader off to tune that setting: it is already at its narrowest value and
  // the bot parked under every one of the three tried. Naming the setting is useful; naming it as the
  // fix is the afternoon this arm exists to save.
  assert.match(checksVerdict({ ...parkedAlone_input, policy: "first_time_contributors_new_to_github" }).reason,
    /Narrowing it further is not available/);
  // And when it cannot be read, it says so rather than quoting a value it does not have.
  assert.match(parkedAlone.reason, /could not be read from here/);

  // And parked BESIDE green ones — the second run of a two-workflow repository — is still a refusal.
  // This is the member a count-based arm passes cleanly: the count is not zero.
  const parkedBeside = checksVerdict({
    checkRuns: [{ name: "Lint", status: "completed", conclusion: "success" }],
    workflowRuns: [
      { name: "CI", status: "completed", conclusion: "success" },
      { name: "Release", status: "completed", conclusion: "action_required" },
    ],
  });
  assert.equal(parkedBeside.state, WAITING_FOR_A_PERSON);
  assert.deepEqual(parkedBeside.blocked, ["Release"]);

  // ── AND PARKED BESIDE A GREEN RUN OF THE SAME WORKFLOW, WHICH LOOKS LIKE A RESCUE AND IS NOT ─────
  // The version job dispatches `ci.yml` on the version branch, because a dispatch is not a fork event
  // and needs no approval. Its run turns both required checks green on the pull request's head commit.
  // It reads like the park has been routed around, and this arm exists because it was read that way and
  // the exemption was built.
  //
  // MEASURED ON PULL REQUEST 32, 2026-09-05, AND THE TWO SURFACES DISAGREE:
  //
  //   commits/{sha}/check-runs   both required checks, success, 16:37:29Z
  //   the pull request's rollup  EMPTY
  //   mergeStateStatus           BLOCKED, unchanged for four minutes
  //
  // Then the parked run was approved by hand and the rollup filled with the same two names. One
  // intervention between two readings of the same pull request at the same commit. A dispatched run's
  // checks are not credited to the pull request; only the `pull_request` run's are, and that is the run
  // sitting parked. The commit that claimed otherwise checked `check-runs` and never opened the
  // pull request.
  //
  // So a park is a refusal whatever else is green on the commit, and this arm pins the shape that
  // argued otherwise so the next reader finds the measurement instead of rebuilding the reasoning.
  const parkedBesideItsOwnWorkflow = checksVerdict({
    checkRuns: [
      { name: "Lint, licences, tokens and the built bundle", status: "completed", conclusion: "success" },
      { name: "The offline suites", status: "completed", conclusion: "success" },
    ],
    workflowRuns: [
      { name: "CI", status: "completed", conclusion: "success" },
      { name: "CI", status: "completed", conclusion: "action_required" },
    ],
  });
  assert.equal(parkedBesideItsOwnWorkflow.state, WAITING_FOR_A_PERSON,
    "a dispatched run of the same workflow going green does not unblock the pull request — its checks "
    + "never enter the rollup that auto-merge reads, which was measured on pull request 32");
  assert.deepEqual(parkedBesideItsOwnWorkflow.blocked, ["CI"]);

  // A check RUN can carry it too, and the verdict reads both surfaces rather than trusting one.
  assert.equal(checksVerdict({
    checkRuns: [{ name: "The offline suites", status: "completed", conclusion: "action_required" }],
  }).state, WAITING_FOR_A_PERSON);
});

test("tracker 97 the wait for checks gives up loudly, and never waits out a person", async () => {
  // A check row can land minutes after the event that fired it. The window is what separates a slow
  // start from one that is not coming, so the poll has to actually poll — and then actually stop.
  const slept = [];
  const sleep = async (ms) => { slept.push(ms); };

  // Nothing, every time: it exhausts the window and returns the refusal rather than hanging.
  let reads = 0;
  const never = await waitForChecks({
    read: () => { reads += 1; return { checkRuns: [], workflowRuns: [] }; },
    sleep, attempts: 4, everyMs: 15000,
  });
  assert.equal(never.state, NOTHING_STARTED);
  assert.equal(reads, 4, "the poll did not use its whole window before refusing");
  assert.equal(slept.length, 3, "the poll slept after its last look, which wastes the window's last read");

  // Late, but it arrives: that is a pass, and it is why this waits at all.
  slept.length = 0;
  let n = 0;
  const late = await waitForChecks({
    read: () => (++n < 3
      ? { checkRuns: [], workflowRuns: [] }
      : { checkRuns: [{ name: "CI", status: "queued", conclusion: null }], workflowRuns: [] }),
    sleep, attempts: 8, everyMs: 15000,
  });
  assert.equal(late.state, RUNNING);
  assert.equal(late.attempts, 3);

  // A PERSON IS NOT WAITED OUT. An approval is resolved by somebody clicking, never by a job sleeping,
  // so a parked run returns on the first look and burns none of the window.
  slept.length = 0;
  const parked = await waitForChecks({
    read: () => ({ checkRuns: [], workflowRuns: [{ name: "CI", status: "action_required" }] }),
    sleep, attempts: 8, everyMs: 15000,
  });
  assert.equal(parked.state, WAITING_FOR_A_PERSON);
  assert.equal(parked.attempts, 1);
  assert.deepEqual(slept, [], "the job slept waiting for an approval that only a person can give");

  // Driving it with no way to look is a could-not-look, not an empty answer.
  await assert.rejects(() => waitForChecks({ sleep }), /needs a read\(\)/);
});

test("tracker 97 the pipeline asks whether the version pull request's checks started, and a rehearsal stays a rehearsal", () => {
  const workflow = read(WORKFLOW);
  // The auto-merge step and the assertion that its checks exist are a pair: enabling auto-merge without
  // it is how a pull request waits for ever on a check nobody created.
  assert.match(workflow, /run: node scripts\/release-version-pr-checks\.mjs/,
    "the pipeline enables auto-merge without checking that anything will ever run for it to wait on");
  const lines = workflow.split("\n");
  // AND THE TOKEN CAN ACTUALLY SEE THOSE SURFACES. Spelling out any permission in a job sets every
  // other one to `none`, so the two read scopes are what stand between the step and a 403 from both
  // endpoints — `checks: read` for `commits/{sha}/check-runs`, `actions: read` for `actions/runs`, which
  // is the only one that carries `action_required`. The step would fail loudly rather than pass
  // vacuously, but it would fail on every push, and only on main.
  // THE VERSION JOB, NOT FOUR OF THEM (tracker issue 298). This sliced from `version:` to `publish:`,
  // which spans `stranded`, `pending` and `awaited` as well — so a permission granted by any of
  // them answered a question asked about this one.
  const versionJob = jobText("version");
  // AND NOT `administration: read`, which is not a permission a job may request. Asking for it does not
  // fail the job — GitHub refuses to parse the whole workflow, and reports it as a run named after the
  // file with no jobs and no log. On main that would have stopped every release with nothing legible to
  // say why. The policy read is best-effort instead, and fails soft.
  const executableJob = executableText(versionJob);
  assert.ok(!/administration:/.test(executableJob),
    "the version job asks for `administration` scope, which GitHub does not accept in a job's "
    + "permissions — the whole workflow becomes unparseable and stops running");
  // OFF THE EXECUTABLE TEXT, AND `write` SATISFIES `read` (tracker issue 298). This read the raw job
  // and asked for the literal `actions: read`, which appears in this job ONLY in the comment above —
  // the job grants `actions: write`, a superset. So the check was answered by prose and would have
  // stayed green with the permission deleted outright, on a job where an unnamed permission is
  // `none`. It is the same defect the line above it had already been fixed for.
  for (const scope of ["checks", "actions"]) {
    assert.match(executableJob, new RegExp(`^\\s+${scope}: (read|write)\\s*(#.*)?$`, "m"),
      `the version job does not grant \`${scope}\` read or write, so the step that reads whether its `
      + "checks started gets a 403 — and naming any permission sets every unnamed one to `none`");
  }
  // THE AUTO-MERGE WRITES ITS OWN MESSAGE. Left to GitHub's default, the squash headline gains `(#23)` —
  // the bare `#NNN` this project bans from commit messages, put into public history by our own
  // automation. Measured on the first version pull request that merged itself.
  const merge = workflow.slice(workflow.indexOf("gh pr merge"), workflow.indexOf("The checks it waits for"));
  assert.match(merge, /--subject "Release \$VERSION"/,
    "the auto-merge takes GitHub's default headline, which appends `(#N)` to it");
  assert.match(merge, /--body "\$NOTES"/, "the auto-merge leaves the body to GitHub, which composes it from the pull request");
  assert.ok(!/\(#\$?\{?\w*\}?\)/.test(merge), "a `(#N)` shape appeared in the message the workflow writes");

  // THE VERSION PULL REQUEST CHECKS ITSELF. Its author is `github-actions[bot]`, and every fork-approval
  // policy this repository has tried counts that as a contributor needing approval — it parked four
  // times in one day, producing ZERO check runs each time, so auto-merge waited on checks that never
  // started. A dispatch is not a fork event and needs no approval.
  assert.match(workflow, /gh workflow run ci\.yml --ref changeset-release\//,
    "the version pull request no longer dispatches its own checks, so it waits for somebody to approve them");
  assert.match(workflow, /actions: write/,
    "the version job cannot dispatch a workflow without `actions: write` — and note this IS a permission "
    + "a job may request, unlike the `administration` scope that made this file unparseable");
  // The dispatch has to come BEFORE the assertion that checks started, or the guard refuses the pull
  // request it was about to fix.
  const dispatchesCi = lines.findIndex((l) => /gh workflow run ci\.yml/.test(l));
  const asks2 = lines.findIndex((l) => /release-version-pr-checks\.mjs/.test(l) && /run:/.test(l));
  assert.ok(dispatchesCi > -1 && asks2 > dispatchesCi,
    "the checks-started assertion runs before the dispatch that creates them");

  // AND THE DISPATCHED WORKFLOW MUST ACCEPT ONE. A dispatch of a workflow with no `workflow_dispatch`
  // trigger fails the step; a dispatch of one that gates jobs on the event runs a subset and satisfies
  // nothing. Both jobs here are ungated, and their names are the two contexts protection requires.
  const ci = read(".github/workflows/ci.yml");
  assert.match(ci, /^  workflow_dispatch:$/m, "ci.yml no longer accepts a dispatch, so the version pull request cannot check itself");
  // Comments dropped, for the fifth time in this file: ci.yml now EXPLAINS in prose that its jobs are
  // ungated, and an arm reading the whole file refuses the sentence saying the thing it wants.
  const ciExecutable = executableText(ci);
  assert.ok(!/github\.event_name/.test(ciExecutable),
    "a job in ci.yml is now gated on the event, so a dispatched run may not produce every required check");

  const auto = lines.findIndex((l) => /gh pr merge/.test(l));
  const asks = lines.findIndex((l) => /release-version-pr-checks\.mjs/.test(l) && /run:/.test(l));
  assert.ok(auto > -1 && asks > auto,
    "the checks assertion no longer follows the auto-merge it exists to protect");

  // THE REHEARSAL. `workflow_dispatch` is forced to --dry-run, and the branch check must not reach it:
  // a rehearsal that refuses to run anywhere but main rehearses nothing.
  //
  // ASSERTED AS NESTING, NOT AS ORDER, and the difference is the whole arm. The first draft of this
  // checked that the branch case appeared after the `elif push` line — which stays true when the case is
  // hoisted back out to the top of the step, one indentation level up, where it applies to a dispatch
  // again. Planted exactly that way, the arm passed. So the closing `fi` is what bounds it: the case has
  // to sit BETWEEN the push arm and the end of the conditional, and be indented inside it.
  const dispatch = lines.findIndex((l) => /if \[ "\$\{\{ github\.event_name \}\}" = "workflow_dispatch" \]/.test(l));
  assert.ok(dispatch > -1, "the rehearsal arm is gone from the publish gate");
  const indent = (i) => lines[i].length - lines[i].trimStart().length;
  const opens = indent(dispatch);
  const push = lines.findIndex((l, i) => i > dispatch && /elif \[ "\$\{\{ github\.event_name \}\}" = "push" \]/.test(l));
  assert.ok(push > -1, "the push arm of the publish gate is gone");
  const closes = lines.findIndex((l, i) => i > push && l.trim() === "fi" && indent(i) === opens);
  assert.ok(closes > -1, "the event conditional in the publish gate no longer closes where it opened");
  const branchCase = lines.findIndex((l) => /refs\/heads\/main\) ;;/.test(l));
  assert.ok(branchCase > -1, "the explicit branch check is gone");
  assert.ok(push < branchCase && branchCase < closes,
    "the branch check no longer sits inside the push arm, so a dispatched rehearsal now fails instead of rehearsing");
  assert.ok(indent(branchCase) > opens,
    "the branch check is indented at the conditional's own level, which is outside every arm of it");
});

test("tracker 97 the workflow does not describe an approval gate it no longer has", () => {
  // The class, not the instance: a file whose comments contradict its code teaches the next reader to
  // trust the comment. The `npm` environment kept its NAME — npm's trusted publisher is registered
  // against it — and lost the reviewer and the protected-branches policy on 2026-09-05. Measured that
  // day: the repository has zero environments at all.
  const workflow = read(WORKFLOW);
  assert.match(workflow, /^\s*environment: npm$/m,
    "the environment name npm's trusted publisher is registered against is gone; the registry will refuse the publish");
  for (const stale of [
    /PAUSES in the Actions UI/,
    /until\s+#?\s*he approves it/,
    /required reviewer plus a protected-branches policy, added after/,
  ]) {
    assert.ok(!stale.test(workflow),
      `the workflow still describes the approval gate that was removed: ${stale}`);
  }
  // And it says what carries the removed protected-branches half instead of leaving the gap silent.
  assert.match(workflow, /explicit ref check in the step below is what carries that/,
    "the workflow no longer says what replaced the environment's protected-branches policy");
});

test("tracker 97 the changelog the pipeline writes is a root document its own reader can run", async () => {
  // THE RELEASE STOPPED HERE, 2026-09-05. The first version pull request the pipeline ever opened went
  // red on `the-readmes-commands-run-as-written`, over the note in the generated CHANGELOG.md reading
  // "`clearotron doctor` now says how long the portal key has left" — exactly how a note should be
  // written. (No line number: that file does not exist in this tree, which is the whole finding.)
  // The generated file had not told the reader how the binary got on `PATH`, so the bare form was
  // command-not-found for anyone who cloned. A red on the version pull request blocks auto-merge, and
  // main has no CHANGELOG.md at all — no branch could have seen it coming.
  //
  // Asked of the SAME function the root documents are asked of, not a second copy of the rule here.
  const dir = mkdtempSync(join(tmpdir(), "release-changelog-"));
  try {
    const notes = [
      "`clearotron doctor` now says how long the portal key has left and refuses when it has lapsed.",
      "Asking the demo for a search it has no example of now explains what happened.",
    ];
    const p1 = writeRootChangelog({ version: "0.1.1-beta.0", ...group(notes.map((n) => `Fixed: ${n}`)) }, dir);
    const first = readFileSync(p1, "utf8");
    assert.deepEqual(unreachableBareSites([{ file: "CHANGELOG.md", text: first }]).map(sentenceFor), [],
      "the generated changelog shows a command its own reader cannot run, and it fails on the version "
      + "pull request where nothing else can see it");

    // A SECOND RELEASE KEEPS ONE HEAD. The head used to be stripped by matching its exact text, so
    // editing it would have left the old one buried above the new — and the install line would then sit
    // BELOW a version section, protecting nothing above it.
    const p2 = writeRootChangelog({ version: "0.1.2", ...group(["Fixed: `clearotron demo` runs a shorter example."]) }, dir);
    const second = readFileSync(p2, "utf8");
    assert.equal((second.match(/^# Changelog$/gm) ?? []).length, 1, "the changelog grew a second title");
    assert.equal((second.match(/npm install -g clearotron/g) ?? []).length, 1,
      "the install line was duplicated or lost when the second version was prepended");
    assert.ok(second.indexOf("npm install -g clearotron") < second.indexOf("## 0.1.2"),
      "the install line no longer sits above every version section, so the notes below it are unreachable again");
    assert.deepEqual(unreachableBareSites([{ file: "CHANGELOG.md", text: second }]).map(sentenceFor), []);
    // And the older release is still in the file: prepending must not eat what it prepends to.
    assert.match(second, /## 0\.1\.1-beta\.0/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tracker 97 the release note a customer reads is the sentence, not the commit that carried it", () => {
  // Changesets' default generator prefixes every bullet with the commit sha. A squashed release puts the
  // SAME seven characters at the head of every line — `- f7c1570:` seven times in the first cut — in the
  // one file a customer opens to decide whether to upgrade. The commit they can act on is named once, by
  // the tag and the release page.
  const dir = mkdtempSync(join(tmpdir(), "release-assemble-"));
  try {
    mkdirSync(join(dir, "driver"), { recursive: true });
    writeFileSync(join(dir, "driver", "CHANGELOG.md"),
      "# clearotron-driver\n\n## 0.1.1-beta.0\n\n- f7c1570: Fixed: The demo offers the two example accounts it ships with.\n"
      + "- 0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b: Fixed: A clearance now names the registers it searched.\n");
    const { groups } = assembleRoot("0.1.1-beta.0", dir);
    assert.deepEqual(groups.Fixed, [
      "The demo offers the two example accounts it ships with.",
      "A clearance now names the registers it searched.",
    ]);
    // A sentence that merely CONTAINS a colon keeps every word of itself.
    writeFileSync(join(dir, "driver", "CHANGELOG.md"),
      "# clearotron-driver\n\n## 0.2.0\n\n- Fixed: Removing the demo is one directory again: nothing it writes lands outside it.\n");
    assert.deepEqual(assembleRoot("0.2.0", dir).groups.Fixed,
      ["Removing the demo is one directory again: nothing it writes lands outside it."]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


test("tracker 97 a version that merged itself still publishes, because that merge fires nothing", async () => {
  // THE DEADLOCK THIS EXISTS FOR, measured 2026-09-05 on commit `65e634a6`. The version pull request
  // merged itself and the version landed on main — and GitHub performed that merge with the built-in
  // `GITHUB_TOKEN`, a push made with which starts NO workflow run. No CI, no release, no error. Five
  // Dependabot runs arrived on the same commit within seconds as the control, so the suppression is on
  // the token rather than on the repository, and nothing that waits for that push can ever fire.
  //
  // The workflow's own header states this rule for TAGS. The auto-merge rebuilt it one step earlier.
  const workflow = read(WORKFLOW);

  assert.match(workflow, /^\s*schedule:$/m, "the cron that notices a self-merged cut is gone, so a version "
    + "that merges itself sits on main unpublished for ever");
  assert.match(workflow, /cron: '\*\/5 \* \* \* \*'/, "the cron interval changed — deliberate or not, say so here");
  // IT HAS FIRED NOW, and the arm changed with the fact rather than outliving it. The previous version
  // asserted the workflow still said the cron had NEVER fired, and said in its own message that the
  // sentence was the reader's to replace once they had seen a scheduled run. Run 33973623236 is that
  // run. What the file must keep saying is the part that is still true and still surprising: it fired
  // once and then not again for an hour, so it is a floor rather than a clock.
  assert.match(workflow, /33973623236/, "the workflow no longer cites the scheduled run that proves the cron works");
  assert.match(workflow, /floor, not a clock/,
    "the workflow no longer warns that the cron is unpunctual — a reader will design around it as though "
    + "`*/5` meant every five minutes, and a cut version may wait an hour");
  assert.ok(!/NEVER FIRED ON THIS REPOSITORY/.test(workflow),
    "the workflow still says the cron has never fired, which stopped being true at 15:03Z on 2026-09-05");

  // The reason has to travel WITH it, or the next reader deletes a cron that looks like polling for
  // nothing. This asserts the explanation is present, not merely the trigger.
  assert.match(workflow, /GITHUB_TOKEN`? — a push made with that token starts\s*\n?\s*#?\s*NO workflow run/,
    "the cron no longer says why it exists, so the next reader will simplify it away");

  const jobs = releaseJobs(workflow);
  // FOUR NOW. `stranded` joined on 2026-09-06 for tracker issue 229: the job that notices a cut sitting
  // on main unpublished used to be `pending`, which is downstream of the version gate on the push path
  // and skipped whenever that gate failed — so it could not run in the one state it exists to detect.
  // The new job has no `needs:` at all, which is the whole of its design and has its own arm.
  // SIX NOW. `awaited` and `publish-awaited` joined on 2026-09-06: a push routinely publishes a version
  // already stranded AND cuts a new one, and publishing only the older one is what left a version
  // stranded after every merge.
  assert.deepEqual(jobs, ["version", "stranded", "pending", "awaited", "publish", "publish-awaited"],
    "the release workflow's jobs are not the six this file is written about");

  // IT DECIDES WITH THE SAME FUNCTION THE PUSH PATH USES. Two answers to one question is how a pipeline
  // publishes on one path what it refuses on the other.
  const pendingJob = workflow.slice(workflow.indexOf("  pending:"), workflow.indexOf("  publish:"));
  assert.match(pendingJob, /node scripts\/release-cut-decision\.mjs/,
    "the scheduled job decides whether to publish by some means other than the cut decision");
  assert.match(pendingJob, /fetch-depth: 0/,
    "the scheduled job checks out without tags, and a checkout with no tags reads every version as never released");
  assert.match(pendingJob, /ref: main/, "the scheduled job does not pin its checkout to main");
  // It must not be able to publish anything itself.
  assert.match(pendingJob, /permissions:\s*\n\s*contents: read\s*\n/,
    "the scheduled probe has more than read access; it decides, it does not publish");
  assert.ok(!/id-token: write/.test(pendingJob), "the scheduled probe can mint a publish credential");

  // AND THE PUBLISH JOB ACTS ON IT. Both deciders are needed and either may be skipped on any given run,
  // which is exactly why the condition cannot rely on the default needs behaviour.
  assert.match(workflow, /needs: \[version, pending\]/, "the publish job no longer waits on both deciders");
  assert.match(workflow, /needs\.pending\.outputs\.cut == 'true'/,
    "the publish job ignores the scheduled decider, so the cron notices and nothing happens");
  assert.match(workflow, /!failure\(\) && !cancelled\(\)/,
    "a skipped decider would now block the publish job rather than reading as `not this path`");

  // The event gate has to let the cron through, or `pending` decides `true` and the gate refuses it.
  assert.match(workflow, /github\.event_name \}\} " = "schedule"|= "schedule" \]/,
    "the publish gate refuses a scheduled run, so the cron can notice a cut and never publish it");

  // AND IT IS STILL NOT A REHEARSAL. A scheduled run publishes for real; only `workflow_dispatch` is dry.
  const gate = workflow.slice(workflow.indexOf('id: what'), workflow.indexOf("- run: npm run build:ui"));
  const dryLines = executableText(gate).split("\n").filter((l) => /dry_flag=--dry-run/.test(l));
  assert.equal(dryLines.length, 1, "more than one path sets the dry-run flag, or none does");
  const dispatchArm = gate.indexOf('"workflow_dispatch"');
  const scheduleArm = gate.indexOf('"schedule"');
  assert.ok(dispatchArm > -1 && scheduleArm > -1 && gate.indexOf("dry_flag=--dry-run") < scheduleArm,
    "the dry-run flag is set on a path that includes the cron, which would make every scheduled release a rehearsal");
});

test("tracker 97 the action and the CLI agree about what a pre-release has already consumed", () => {
  // MEASURED 2026-09-05. `changesets/action@v1` decides which notes a pre-release has consumed by reading
  // `preState.changesets`. `@changesets/cli@3.0.1` does not write that key — its `enterPre` writes
  // `{mode, tag}` and nothing else, and its `migratePreState` deletes the key and MOVES consumed notes
  // into `.changeset/pre/`. So on the first push after a pre-release cut, `@v1` saw seven notes it
  // believed were pending and its reader treated the leftover directory as an old-format changeset,
  // opening a `changes.md` that has never existed there. The version job died on that ENOENT and took
  // the publish with it. `@v2` filters on `!id.startsWith("pre/")` instead.
  const workflow = read(WORKFLOW);
  // COMMENTS DROPPED FIRST, and this file has now made the same mistake four times in a day: the
  // workflow explains each rename in prose beside the code, so an arm reading the whole file passes on
  // its own explanation and reports a change that is not there.
  const executable = executableText(workflow);

  // PINNED TO A COMMIT. `v1` and `v2` are BRANCHES on that repository — there is no tag `v1` at all — so
  // a floating ref is whatever was last pushed to it, on the step that opens a pull request with a token.
  const pin = /uses: changesets\/action@([0-9a-f]{40})\b/.exec(executable);
  assert.ok(pin, "the changesets action is not pinned to a commit; `@v1`/`@v2` are branches, not tags");
  assert.ok(!/uses: changesets\/action@v\d/.test(executable), "a floating action ref came back");

  // THE INPUT AND OUTPUT NAMES MOVED WITH THE VERSION, and v2 shims the old input spellings — so a
  // workflow can be on v2, read correctly, and still say `version:`, which teaches the next reader that
  // the version did not matter. The output has no shim: `pullRequestNumber` is simply empty on v2, and
  // an empty number makes both steps that depend on it skip in silence.
  assert.ok(!/pullRequestNumber/.test(executable),
    "the workflow still reads `pullRequestNumber`, which is empty on v2 — both steps that gate on it "
    + "would skip silently, and the version pull request would never merge itself");
  const uses = (name) => assert.match(executable, new RegExp(`\\b${name}:`), `the v2 input \`${name}\` is not used`);
  for (const input of ["version-script", "pr-title", "commit-message"]) uses(input);
  // COUNTED FROM THE FILE, not typed: a step added later that gates on this output would otherwise make
  // a correct workflow fail a number nobody remembered to bump. What matters is that NO site reads the
  // old name, which the assertion above already fixes; this one only proves the new name is in use.
  assert.ok((executable.match(/steps\.changesets\.outputs\.pr-number/g) ?? []).length >= 4,
    "fewer sites read the renamed output than the four that gated on the old one");

  // One variable at a time: v2's new default pushes through the GitHub API. Keeping the CLI is the same
  // behaviour v1 had, and it is stated rather than left to a default that changed under us.
  assert.match(executable, /push-with-git-cli: true/,
    "the push method is left to v2's new default, which is a second change riding on this one");
});

test("tracker 97 the manifest names the repository provenance will be attested for", () => {
  // MEASURED 2026-09-05, at the most expensive moment available. The OIDC exchange succeeded, provenance
  // was generated, the tarball was built and scanned and checked — and the registry refused the PUT:
  //
  //   npm error 422 Unprocessable Entity - PUT https://registry.npmjs.org/clearotron
  //   Error verifying sigstore provenance bundle: Failed to validate repository information:
  //   package.json: "repository.url" is "", expected to match "https://github.com/CordilleraSarl/clearotron"
  //
  // `--provenance` makes npm attest the repository the build came from, and the registry checks that
  // attestation against the manifest. The field was simply absent, and nothing anywhere looked at it.
  const pkg = rootPkg();
  const workflow = read(WORKFLOW);

  assert.ok(pkg.repository, "the root package names no repository, and the registry refuses a provenance "
    + "bundle it cannot match against the manifest");
  const url = typeof pkg.repository === "string" ? pkg.repository : pkg.repository.url;
  assert.ok(url, "`repository` is present but names no url");
  assert.equal(/github\.com[/:]([^/]+\/[^/.]+)/.exec(url)?.[1], REPOSITORY,
    "the manifest's repository is not the one the workflow publishes from");

  // The workflow gates on the same repository. Two spellings of one fact drift; this asserts they agree.
  assert.ok(workflow.includes(`github.repository == '${REPOSITORY}'`),
    "the workflow's repository guard and the manifest's repository no longer name the same thing");

  // THE GUARD REFUSES EACH SHAPE, and refuses them BEFORE anything is built rather than after
  // everything is. Driven, not asserted: each of these is a manifest the registry would 422.
  const withField = publishRefusals({ workflow, rootPkg: pkg });
  assert.deepEqual(withField, [], withField.join("\n"));
  const { repository, ...absent } = pkg;
  assert.match(publishRefusals({ workflow, rootPkg: absent }).join("\n"), /names no `repository.url`/);
  assert.match(
    publishRefusals({ workflow, rootPkg: { ...pkg, repository: { type: "git", url: "git+https://github.com/someone/else.git" } } }).join("\n"),
    /names someone\/else/);
  assert.match(
    publishRefusals({ workflow, rootPkg: { ...pkg, repository: { type: "git", url: "" } } }).join("\n"),
    /names no `repository.url`/);
  // npm accepts the bare-string form too, and a guard that refused it would refuse a correct manifest.
  assert.deepEqual(publishRefusals({ workflow, rootPkg: { ...pkg, repository: `https://github.com/${REPOSITORY}` } }), []);
  // As do the `.git` suffix and the ssh spelling: the comparison is on owner/name, not on the string.
  assert.deepEqual(publishRefusals({ workflow, rootPkg: { ...pkg, repository: { type: "git", url: `git@github.com:${REPOSITORY}.git` } } }), []);

  // And what a reader of the package page gets, which is the other half of the same field.
  assert.match(pkg.homepage ?? "", new RegExp(REPOSITORY), "the package page links nowhere");
  assert.match(pkg.bugs?.url ?? "", new RegExp(REPOSITORY), "the package page offers nowhere to report a bug");
});

// ── A CUT THAT MERGED ITSELF WAITS ON A CLOCK THAT IS NOT ONE ────────────────────
//
// The version pull request merges itself, GitHub takes that merge with the built-in `GITHUB_TOKEN`, and
// a push made with that token starts no workflow run. The `*/5` cron is the standing net and the
// workflow's own header calls it "a floor, not a clock": measured 2026-09-06, a version sat cut and
// unpublished for 74 minutes, and every stable release before it published on an unrelated human merge.
//
// The version branch's CI COMPLETING is the moment auto-merge is waiting on, so `workflow_run` on it is
// the closest signal to the merge that exists — and it needs no credential, which is what rules out the
// two options that would.
//
// BREAK MATRIX:
//   · the loop answers the moment main carries a cut   → break: sleep first, arm 1 red
//   · it gives up rather than hanging a runner         → break: unbounded loop, arm 2 red
//   · giving up is NOT reported as a cut               → break: return cut:true, arm 2 red
//   · the wait fires only on the version branch's CI   → break: drop `branches`, arm 4 red
//   · the rehearsal path is untouched                  → break: let dispatch publish, arm 5 red
import { awaitCut, WAIT_MS, STEP_MS, MIN_JOB_MARGIN_MS, waitBudget, readMain, versionBumpCommit } from "../../scripts/release-await-cut.mjs";
import { cutRef } from "../../scripts/release-cut-decision.mjs";

/** This repository's root, and the workflow this section reads. Named here rather than reusing a
 *  constant from another section, because a constant that moves under an arm is how a guard comes to
 *  measure a file nobody ships. `WORKFLOW` is the guard's own path for the same file. */
const REPO = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");
const RELEASE_YML = readFileSync(join(REPO, WORKFLOW), "utf8");

/** A fake clock and a fake main, so the loop is DRIVEN rather than asserted about. Ten real minutes of
 *  waiting is a loop nobody checks. */
function world({ cutAfter = 0, version = "0.1.7" } = {}) {
  let clock = 0, passes = 0;
  return {
    now: () => clock,
    passes: () => passes,
    refresh: async () => { passes++; },
    read: () => ({ cut: passes > cutAfter, version }),
    sleep: async (ms) => { clock += ms; },
  };
}

test("208 a merge already taken costs no wait at all — the common case, not the exception", async () => {
  const w = world({ cutAfter: 0 });
  const r = await awaitCut(w);
  assert.equal(r.cut, true, "main carried an untagged version and the loop did not say so");
  assert.equal(r.gaveUp, false);
  assert.equal(r.waitedMs, 0, "the loop slept before asking — a merge taken while CI finished paid for nothing");
  assert.equal(w.passes(), 1, "it re-read main more than once for an answer it already had");
});

test("208 it gives up rather than hanging a runner, and giving up is not a cut", async () => {
  // Every version branch CI run fires this, INCLUDING the ones whose pull request never merges — checks
  // failed, a merge dismissed, a re-cut mid-flight. An unbounded wait would hold a runner on each.
  const w = world({ cutAfter: Infinity });
  const r = await awaitCut(w);
  assert.equal(r.gaveUp, true, "the loop did not stop — this is the arm between a bounded wait and a hung runner");
  assert.equal(r.cut, false,
    "giving up reported a cut. That publishes a version nobody merged, which is the one outcome this "
    + "pipeline cannot afford");
  assert.ok(r.waitedMs <= WAIT_MS, `the loop waited ${r.waitedMs}ms, past its own budget of ${WAIT_MS}ms`);
  assert.ok(r.waitedMs + STEP_MS > WAIT_MS,
    `the loop gave up at ${r.waitedMs}ms with a whole step of budget left — it is quitting early, not bounding`);
});

test("208 a merge taken mid-wait is caught, and costs only the steps it took", async () => {
  // The arm that separates a real wait from a loop that answers once and returns.
  const w = world({ cutAfter: 3 });
  const r = await awaitCut(w);
  assert.equal(r.cut, true, "the loop gave up on a merge that landed inside its budget");
  assert.equal(r.gaveUp, false);
  assert.equal(w.passes(), 4, "it did not re-read main on each pass — a cached answer never becomes true");
  assert.equal(r.waitedMs, 3 * STEP_MS, `it waited ${r.waitedMs}ms for a merge that landed after three steps`);
});

test("208 the wait rides the run a PERSON started, and the dead trigger is gone", () => {
  // FIRST ATTEMPT, MEASURED DEAD. The wait hung off `workflow_run` on the version branch's CI, on the
  // reasoning that the completion auto-merge waits for fires regardless of who pushed. It does not:
  // 2026-09-06, trigger live on main, version pull request 58 self-merged at 16:12:48Z as "Release
  // 0.1.8", both CI completions on changeset-release/main fired nothing, and across sixty runs of every
  // workflow there was not one `workflow_run` event. The suppression that swallows the merge push
  // swallows the event its CI would raise, because that CI was itself GITHUB_TOKEN-started.
  //
  // SO THE TRIGGER IS ASSERTED ABSENT. A trigger that has never fired reads like a net and is not one,
  // and leaving it would leave every arm here green over a release path that is cron-only again.
  const on = RELEASE_YML.slice(RELEASE_YML.indexOf("\non:"), RELEASE_YML.indexOf("\nconcurrency:"));
  assert.ok(!/workflow_run:/.test(on),
    "the workflow_run trigger is back. It was measured to fire zero times while live on main, so it "
    + "cannot be what carries the publish — and its presence makes the cron-only path look covered");
  // AND THE REHEARSAL IS UNTOUCHED. This file's header states that `workflow_dispatch` cannot publish,
  // and changing the event gate is exactly where that contract gets lost by accident.
  assert.match(on, /workflow_dispatch:/, "the rehearsal trigger is gone");
  assert.match(on, /schedule:/, "the cron floor is gone — it is what catches everything the wait gives up on");

  // THE WAIT IS IN THE JOB A HUMAN PUSH STARTS, and scoped to the only case with something to wait for.
  // THE WAIT MOVED OUT OF THIS JOB and has its own arms below. Inside `version` it was conditioned on
  // nothing being stranded, which made it unreachable in the ordinary rhythm.
  const version = jobText("version");
  assert.match(version, /pr_number: \$\{\{ steps\.changesets\.outputs\.pr-number \}\}/,
    "the version job does not report the pull request it cut, so nothing downstream can wait for it");
  assert.ok(!/release-await-cut\.mjs/.test(executableText(version)),
    "the wait is back inside the version job, where it cannot arm on a push that also publishes a stranded version");
});

test("208 the job's budget can contain its own longest step", () => {
  // A `timeout-minutes` below the wait cancels the job at the moment it was about to publish, and a
  // cancelled run reads as neither success nor failure to anybody scanning the list — the release goes
  // missing with nothing red. The two numbers live in different files, so nothing else couples them.
  // AGAINST THE WAIT THIS JOB ACTUALLY RUNS (tracker issue 247). This arm used to compare the version
  // job's budget to `WAIT_MS`, which belongs to `release-await-cut.mjs` and runs in a DIFFERENT job that
  // this one never invokes. It held by coincidence: two unrelated numbers that happened to be ordered
  // the right way, and it would have gone red the moment the other one was raised, about a job whose
  // behaviour had not changed. What this job waits on is `release-version-pr-checks.mjs`'s own window,
  // and BOTH numbers on the right-hand side come from that file — the margin too. Reaching across for
  // the other job's margin would have been the same defect in a smaller size.
  const version = jobText("version");
  const budget = Number(/timeout-minutes:\s*(\d+)/.exec(version)?.[1]);
  assert.ok(Number.isFinite(budget), "the version job declares no timeout — this arm could not look");
  // EXECUTABLE TEXT AND THE RUN STEP, NOT THE BARE NAME (tracker issue 298). This asked for the
  // filename anywhere in the job's raw text, so a comment naming the script answered it and the arm
  // stayed green with the step deleted — proven by planting exactly that. The sibling arm on the
  // `stranded` detector already anchored on the run step; this one now matches it.
  assert.match(executableText(version), /run: node scripts\/release-version-pr-checks\.mjs/,
    "the version job no longer runs the wait this arm is about — check which budget now bounds it");
  assert.ok(budget * 60_000 > CHECKS_WINDOW_MS + CHECKS_JOB_MARGIN_MS,
    `the version job is capped at ${budget} minutes; its own wait for the checks to start is `
    + `${CHECKS_WINDOW_MS / 60_000} and it needs ${CHECKS_JOB_MARGIN_MS / 60_000} more for the work `
    + "around it. The job is cancelled while waiting for the merge it set in motion");
});

test("208 both deciders answer the same question, and a skipped one cannot answer for the other", () => {
  // The `version` job now has two steps and exactly one answers: `cut` on the push that IS the merge,
  // `awaited` on the push that cut the pull request and waited. An unset output from a skipped step is
  // the empty string; reading only one would report "not this path" on the event that did answer.
  const version = jobText("version");
  // ONE DECIDER PER JOB NOW. `version` answers about the version already on main; the `awaited` job
  // answers about the one this push cut. Different versions, different publishing jobs.
  assert.match(version, /cut: \$\{\{ steps\.cut\.outputs\.cut \}\}/,
    "the version job's decider changed shape — check which version its `cut` output is now about");
  // AND `pending` IS THE CRON ALONE AGAIN. It carried the second entry while the trigger existed.
  const pending = jobText("pending");
  assert.match(pending, /if: github\.event_name == 'schedule' &&/, "the cron job answers to some other event too");
  assert.ok(!/steps\.awaited/.test(pending), "the waiting step is still wired into the cron job, where there is nothing to wait for");
  // THE DECISION ITSELF IS STILL ONE FUNCTION. Two paths asking one question in two ways is how a
  // pipeline comes to publish something nobody merged.
  const src = readFileSync(join(REPO, "scripts", "release-await-cut.mjs"), "utf8");
  assert.match(src, /import \{ cutDecision, versionAtHead, tagsHere \}/,
    "the waiting path decides for itself instead of asking the one authority");
  // THE READERS ARE INJECTABLE NOW, so this asks the same question in two halves: that the DEFAULT is
  // the one authority, and that it is asked about the commit. An arm matching the old inline call would
  // have gone red on a refactor that changed nothing it cares about, and been widened rather than fixed.
  assert.match(src, /versionAt = versionAtHead/,
    "the waiting path's default version reader is no longer the one authority, so it can decide for itself");
  assert.match(src, /versionAt\(\{ ref: "origin\/main" \}\)/,
    "the waiting path reads the working tree rather than the commit — the defect release-cut-decision.mjs was written for");
  assert.match(src, /tags = tagsHere/,
    "the waiting path's default tag reader is no longer the one authority");
});

test("208 the stranded-cut detector does not sit downstream of the gate that strands a cut", () => {
  // MEASURED ON A REAL STRANDING, 2026-09-06, by the lane holding the next pull request. 0.1.7 merged
  // itself onto main and was not published: the release run on that push failed at "The checks it waits
  // for actually started", and BOTH downstream jobs were skipped — including the one whose entire job is
  // to notice a cut sitting on main unpublished. The detector was downstream of the gate that stranded
  // the cut, so it did not run in exactly the state it exists to catch.
  //
  // `pending` therefore takes no `needs`, and that is load-bearing rather than incidental: a `needs` on
  // `version` would reintroduce this on the very run where it matters. The `workflow_run` path added for
  // this issue is a SEPARATE run in which `version` is skipped rather than failed — and a skipped job is
  // not a failure, so `publish` still reaches `pending`'s answer.
  const jobs = RELEASE_YML.slice(RELEASE_YML.indexOf("\njobs:"));
  // SLICED BY THE ONE HELPER. This ended at `publish:`, a job was later inserted between the two, and
  // the slice swallowed it — so this arm read that job's `needs:` as `pending`'s and failed on a
  // neighbour moving rather than on the property it guards.
  const pending = jobText("pending");
  assert.ok(pending.length > 200, "the pending job could not be sliced out — this arm measured nothing");
  assert.ok(!/^\s{4}needs:/m.test(pending),
    "the stranded-cut detector now depends on another job. A failure in that job skips this one, which is "
    + "precisely the state a stranded cut is in — measured on 0.1.7, 2026-09-06");
  // AND THE PUBLISH GATE STILL TOLERATES A SKIPPED DECIDER, which is the other half: one of the two
  // deciders is always skipped, because they run on different events.
  const publish = jobText("publish");
  assert.match(publish, /!failure\(\) && !cancelled\(\)/,
    "the publish gate no longer opens with !failure() — a skipped decider would read as a blocked path "
    + "rather than as 'not this route'");
});

// ── 208 / 229 · A CONDITION THAT CLEARS ITSELF MUST NOT STRAND A RELEASE ────────────────────────────
//
// MEASURED 2026-09-06, and it cost two versions at once. A merge cut version pull request 59; its CI run
// parked awaiting approval, as EVERY version branch's run does under the fork-approval policy; the step
// that reports that FAILED the job; and both downstream jobs were skipped. One of them was the publish —
// which would have released the 0.1.8 already sitting cut and untagged on main from the previous merge.
//
// So a state that resolves in minutes, on its own, by a person clicking approve, stranded a second
// version behind the first. Three strandings by then, and not one of them self-reported.

test("208 a parked run is recorded and the release proceeds — it clears itself", () => {
  assert.equal(exitCodeFor(WAITING_FOR_A_PERSON), 0,
    "a version branch waiting for an approval fails the job again. Auto-merge is still waiting when the "
    + "approval arrives, and a cut already sitting on main goes unpublished in the meantime");
});

test("208 THE PLANT — checks that will never arrive still fail, because nothing clears that", () => {
  // The distinction is the fix. A parked run has somebody to approve it; no check runs at all means the
  // trigger will never fire, and waiting does not repair it.
  const nothing = checksVerdict({ checkRuns: [], workflowRuns: [] });
  assert.notEqual(nothing.state, WAITING_FOR_A_PERSON, "the two states collapsed into one");
  assert.equal(exitCodeFor(nothing.state), 1,
    "a commit with no checks at all stopped being a failure — that one does not clear on its own");
});

test("208 a parked run is still SEEN, or the fix is a mute", () => {
  // Not failing is not the same as not noticing. The verdict must still name what is parked and how to
  // clear it, because somebody has to act on it even though the release does not stop for them.
  const v = checksVerdict({ workflowRuns: [{ name: "CI", status: "action_required" }], repo: "o/r" });
  assert.equal(v.state, WAITING_FOR_A_PERSON);
  assert.match(v.reason, /approve/i, "the parked run no longer says what would clear it");
  assert.deepEqual(v.blocked, ["CI"], "the parked run is not named, so a reader cannot act on it");
});

test("229 the stranded-cut detector does not depend on the job that strands cuts", () => {
  // Every stranding so far was invisible for the same reason: the detector was downstream of the gate.
  // `needs:` is what made it skippable, so its absence is the property.
  const job = RELEASE_YML.slice(RELEASE_YML.indexOf("\n  stranded:"), RELEASE_YML.indexOf("\n  pending:"));
  assert.ok(job.length > 100, "the independent detector job is gone — this arm could not look");
  assert.ok(!/^\s+needs:/m.test(job),
    "the detector took a `needs:`, so a failure upstream skips it in exactly the state it exists to catch");
  assert.match(job, /run: node scripts\/release-cut-decision\.mjs/,
    "the detector does not ask the one authority, so it can disagree with the deciders about what is cut");
  // READ-ONLY, DELIBERATELY. Making the detector reachable must not widen the publish gate.
  assert.match(job, /permissions:\n\s+contents: read/,
    "the detector asks for more than read — it reports a stranding, it does not publish one");
});

test("229 the detector SAYS SO — reachable is not the same as heard", () => {
  // `release-cut-decision.mjs` prints its answer and exits 0. That is right for its other callers, which
  // read the output and decide; here it would mean a green, silent job in exactly the state this one
  // exists to surface — the log would carry "v0.1.8 has no tag" and nothing would carry it anywhere a
  // reader looks. Being unskippable and saying nothing is the same defect one step along.
  const job = RELEASE_YML.slice(RELEASE_YML.indexOf("\n  stranded:"), RELEASE_YML.indexOf("\n  pending:"));
  assert.match(job, /if: steps\.ask\.outputs\.cut == 'true'/,
    "nothing in the detector branches on the answer, so it reports the same amount either way: none");
  assert.match(job, /::warning title=A version is cut and unpublished::/,
    "a stranded version raises no annotation, so the job is green and silent in the state it detects");
  assert.match(job, /GITHUB_STEP_SUMMARY/,
    "the finding lives only in a log somebody has to open on purpose");
});

test("229 the cut decision is recorded BEFORE the gate that can fail", () => {
  // Order is the fix. The decision that notices a stranded cut used to run after the checks gate, so a
  // gate failure meant it was never even asked.
  // ORDER IS A CLAIM ABOUT STEPS, so it is read off the executable text (tracker issue 298). On the
  // raw text a comment mentioning the gate ahead of the step reverses this comparison and reds a
  // workflow whose order is correct.
  const version = executableText(
    RELEASE_YML.slice(RELEASE_YML.indexOf("\n  version:"), RELEASE_YML.indexOf("\n  stranded:")));
  const cutAt = version.indexOf("id: cut");
  const gateAt = version.indexOf("release-version-pr-checks.mjs");
  assert.ok(cutAt > 0 && gateAt > 0, "one of the two steps is gone — this arm could not look");
  assert.ok(cutAt < gateAt,
    "the cut decision runs after the checks gate again, so a gate failure strands a cut without ever "
    + "asking whether one was sitting there");
});

// ── 230 · THE CHANNELS ARE ONLY REAL IF A READER CAN FIND THEM ──────────────────────────────────────
//
// The mechanism above decides where a version lands. It tells nobody. A stranger typing `npm install
// clearotron` has no way to know there is a second channel, and — this is the half that bit — no way to
// know that what they just installed IS the tested one. The pattern is enshrined in the repository, per
// the ruling, rather than in anybody's memory.

const RELEASES_DOC = join(REPO, "docs", "RELEASES.md");

test("230 the release doc states both install commands and what each channel promises", () => {
  assert.ok(existsSync(RELEASES_DOC), "docs/RELEASES.md is gone — the doc every other surface points at");
  const doc = readFileSync(RELEASES_DOC, "utf8");
  assert.match(doc, /npm install -g clearotron\b(?!@)/, "the stable install command is not in the doc");
  assert.match(doc, /npm install -g clearotron@beta/, "the beta install command is not in the doc");
  // WHAT EACH PROMISES, not merely that two exist. "There are two channels" tells a reader nothing they
  // can decide on; what was proved before each publish is the whole of the decision.
  assert.match(doc, /clearance run|real clearance/i,
    "the doc does not say what a stable had to pass, so a reader cannot tell the channels apart");
  assert.match(doc, /provenance/i, "the doc drops that both channels publish with provenance");
});

test("230 the two places a reader starts both point at it", () => {
  // README is where a stranger lands; INSTALL.md is where somebody deploying lands. A channel section in
  // one and not the other sends half the readers to the wrong default.
  for (const [name, file] of [["README.md", join(REPO, "README.md")], ["INSTALL.md", join(REPO, "INSTALL.md")]]) {
    const text = readFileSync(file, "utf8");
    assert.match(text, /clearotron@beta/, `${name} does not mention the beta channel at all`);
    assert.match(text, /docs\/RELEASES\.md/, `${name} does not link the release doc, so its summary is the last word and will drift`);
  }
});

test("230 the notes contract tells a note's author which reader it is written for", () => {
  // A note ships to beta readers in minutes and to stable readers when the next stable is cut — so it is
  // read alongside a fortnight of other notes by somebody deciding whether to upgrade. That is a fact
  // about who to write for, and it belongs where notes are written.
  const contract = readFileSync(join(REPO, ".changeset", "README.md"), "utf8");
  assert.match(contract, /beta/i, "the notes contract does not mention the channel a note reaches first");
  assert.match(contract, /docs\/RELEASES\.md/, "the contract restates the channels instead of pointing at the one doc");
});

/**
 * One job's text, ending at the NEXT job whatever that is.
 *
 * Arms here used to slice from one named job to another named job, and every one of them broke — silently,
 * by reading a NEIGHBOUR's text as the subject's — the first time a job was inserted between the two. One
 * of them then asserted that `pending` had a `needs:` it did not have. An arm that fails when something
 * moves next door is an arm people delete rather than fix.
 */
function jobText(id) {
  const at = RELEASE_YML.indexOf(`\n  ${id}:`);
  assert.ok(at >= 0, `there is no job called \`${id}\` — this arm could not look, which is not a pass`);
  const rest = RELEASE_YML.slice(at + 1);
  const nextLine = rest.slice(1).search(/^ {2}[A-Za-z_][A-Za-z0-9_-]*:$/m);
  return nextLine < 0 ? rest : rest.slice(0, nextLine + 1);
}

// THIS ARM SAID "arms on any push that cut a version" UNTIL 2026-09-07, and it was right while a push
// was what armed auto-merge. The cadence change made a requested cut the only thing that merges the
// version pull request, so keying the wait off a push left it waiting for an event that cannot occur.
// Rewritten rather than deleted: the next reader needs to see that the trigger moved on purpose.
test("208 the wait is its own job, and it arms on the cut that can actually merge", () => {
  const job = jobText("awaited");
  assert.ok(job.length > 200, "the waiting job is gone — this arm could not look");
  assert.match(job, /github\.event_name == 'workflow_dispatch'/,
    "the wait no longer keys off the dispatch, which is now the only thing that merges the version pull "
    + "request — so a requested cut would publish nothing");
  assert.ok(!/needs\.version\.outputs\.cut != 'true'/.test(job),
    "the wait is gated on nothing being stranded again — that is the condition that made it unreachable, "
    + "because a push routinely publishes a stranded version and cuts a new one in the same run");
  // AND IT IS NOT STILL SITTING IN THE version JOB. Two waits would be two answers to one question.
  const version = jobText("version");
  assert.ok(!/release-await-cut\.mjs/.test(executableText(version)),
    "the version job still runs the wait, so a push has two of them and they can disagree");
});

test("208 the wait runs AFTER the first publish, or it answers about the wrong version", () => {
  // `release-await-cut.mjs` asks whether main carries a version with no tag. Run beside the first
  // publish it would find the STRANDED version still untagged and answer about that one — and the job
  // behind it would publish the same version twice.
  const job = jobText("awaited");
  assert.match(job, /needs: \[version, publish\]/,
    "the wait does not run behind the first publish, so it can read the version that publish is still tagging");
});

test("208 the second publish proves its OWN bytes — it does not reuse the first artefact", () => {
  // Founding's requirement, and the reason this is a duplicated job rather than a promotion step: a
  // second publish that reused the first tarball would ship the previous version's bytes under a new
  // number, and every check that passed did so on the wrong content.
  const second = RELEASE_YML.slice(RELEASE_YML.indexOf("\n  publish-awaited:"));
  for (const [what, pattern] of [
    ["packs its own bytes", /npm pack --pack-destination/],
    ["seals the published manifest", /release-artifact-seal\.mjs/],
    ["scans those bytes for secrets", /gitleaks dir packed/],
    ["proves a stranger's install", /release-install-check\.mjs|npm install clearotron/],
    ["publishes with provenance", /npm publish .*--provenance/],
    ["derives the channel rather than defaulting", /release-dist-tag\.mjs/],
    ["checks the branch it publishes from", /refs\/heads\/main\) ;;/],
  ]) assert.match(second, pattern, `the second publish no longer ${what}`);
});

test("208 the second publish takes the NEW main, and tags the commit it actually published", () => {
  const second = RELEASE_YML.slice(RELEASE_YML.indexOf("\n  publish-awaited:"));
  // NOT `ref: main` ANY MORE (tracker issue 238). The branch name was right about the first half of the
  // problem — it does pick up a version that landed after the run began — and wrong about the second:
  // between the wait's last read and this checkout the name can move on to a commit that changes no
  // version, and the tip check below compares versions, so it passes.
  assert.match(second, /ref: \$\{\{ needs\.awaited\.outputs\.sha \}\}/,
    "the second publish checks out a branch NAME rather than the commit the wait decided about, so a "
    + "commit that lands in between and moves no version is published under a number whose changelog "
    + "never described it");
  assert.ok(!/\n {10}ref: main\n/.test(second),
    "the second publish still checks out `main` by name somewhere");
  // THE TARGET IS RESOLVED ONCE AND USED BY BOTH PATHS. It was written inline on each `gh release
  // create` until the pre-release branch landed and needed the same commit for the tag it writes
  // directly, so this reads the variable and the uses of it, not one literal.
  assert.ok(!/TARGET="\$GITHUB_SHA"/.test(second),
    "the release is tagged against the commit this run started on, not the one that was published");
  assert.match(second, /TARGET="\$\(git rev-parse HEAD\)"/, "the tag does not name the published commit");
  assert.ok(!/--target "(?!\$TARGET")/.test(second),
    "the second publish still names a commit inline somewhere, so one of its two paths can tag a "
    + "different commit from the other");
  assert.match(second, /-f sha="\$TARGET"/,
    "the tag the pre-release path writes does not name the commit this job resolved");
});

test("208 the two publish jobs carry the same steps, so they cannot drift apart", () => {
  // DUPLICATED ON PURPOSE — the registry's trusted publisher is bound to this workflow FILE, and
  // extracting the sequence into a reusable workflow would publish from a different one. Trusted
  // Publishing cannot be exercised from a test, so converting a just-proven publish path into an
  // unproven shape is the one risk not worth taking on an action that cannot be undone.
  //
  // The cost of duplication is drift, and this is what pays it: the same steps, in the same order.
  const names = (block) => [...block.matchAll(/^      - name: (.+)$/gm)].map((m) => m[1].trim());
  const first = names(jobText("publish"));
  const second = names(RELEASE_YML.slice(RELEASE_YML.indexOf("\n  publish-awaited:")));
  assert.ok(first.length >= 10, `only ${first.length} steps found in the first publish — this arm could not look`);

  // EVERY STEP OF THE FIRST APPEARS IN THE SECOND, IN ORDER. A subsequence rather than equality, because
  // the second job legitimately has work the first cannot have — it publishes a tip that landed after
  // the run began, so it must prove that tip is the one it awaited. Requiring equality would have made a
  // correct addition look like drift, which is how an arm gets loosened to `ok(true)` by the next person.
  //
  // The direction that matters is preserved exactly: a check added to `publish` and not to
  // `publish-awaited` breaks the subsequence, and that is the failure this exists for — a version
  // published without a check the other version got.
  // BOTH OF THESE EXIST BECAUSE THIS JOB PUBLISHES A TIP THAT LANDED AFTER THE RUN BEGAN, which the
  // first publish never does. `publish` packs the commit its run started on and has nothing to check.
  const EXTRA_BY_DESIGN = [
    "The wait named a commit to publish",
    "The tip this packs is the version this run awaited",
  ];
  let i = 0;
  const missing = [];
  for (const step of first) {
    const at = second.indexOf(step, i);
    if (at < 0) missing.push(step); else i = at + 1;
  }
  assert.deepEqual(missing, [],
    `these steps run in \`publish\` and not, in order, in \`publish-awaited\`: ${missing.join(" | ")}. `
    + "The awaited version would be published without them");
  const extras = second.filter((n) => !first.includes(n));
  assert.deepEqual(extras, EXTRA_BY_DESIGN,
    `\`publish-awaited\` carries steps the first publish does not, and they are not the ones this arm `
    + `knows about: ${extras.join(" | ")}. Either the first version publishes without them, or this list `
    + "is stale — say which in the arm rather than widening it");
});

test("208 the rehearsal exercises both publishes, and waits for nothing while doing it", () => {
  const job = jobText("awaited");
  const second = RELEASE_YML.slice(RELEASE_YML.indexOf("\n  publish-awaited:"));
  assert.match(job, /workflow_dispatch/, "a rehearsal never reaches the wait, so its wiring is unrehearsed");
  assert.match(second, /workflow_dispatch/, "a rehearsal never reaches the second publish");
  assert.match(job, /CLEAROTRON_RELEASE_WAIT_MS/,
    "a rehearsal would hold a runner for the full wait to establish that nothing is coming");
});

test("298 the workflow does not restate the wait's duration, it names the constant", () => {
  // WHY THIS EXISTS. `WAIT_MS` was raised from fifteen to twenty-five and four sentences in the workflow
  // carried the figure. Two were repaired when the constant moved and two were not, so the file gave a
  // reader both numbers and no way to tell which was current — and the second pair was found only after
  // the first pair had been fixed and the change declared done. A prose number cannot be checked against
  // the constant it describes; the repair is to have no prose number at all.
  //
  // NARROW ON PURPOSE. It fails only on a spelled duration, so it cannot redden a comment for being
  // long or for discussing the wait. The one exclusion is the cron's own cadence, and it is anchored
  // to `every five minutes` rather than `five minutes` — the loose form swallows `twenty-five
  // minutes`, which is the spelling this arm most needs to catch. Found by planting it.
  const durations = /\b(fifteen|twenty[- ]five|twenty[- ]?five|\d{1,3})[- ]?minutes?\b/gi;
  const offenders = [];
  for (const [i, line] of RELEASE_YML.split("\n").entries()) {
    if (!/^\s*#/.test(line)) continue;
    if (!/\bwait\b|WAIT_MS/i.test(line)) continue;
    if (/every five minutes/i.test(line)) continue;   // the cron's cadence, not this wait
    const hit = line.match(durations);
    if (hit) offenders.push(`line ${i + 1}: ${hit.join(", ")} — ${line.trim().slice(0, 90)}`);
  }
  assert.deepEqual(offenders, [],
    "a comment about the wait spells its duration instead of naming `WAIT_MS`. That number lives in "
    + "release-await-cut.mjs and has already gone stale in this file twice — name the constant:\n"
    + offenders.join("\n"));
});

test("208 the waiting job's budget contains the wait", () => {
  const job = jobText("awaited");
  const budget = Number(/timeout-minutes:\s*(\d+)/.exec(job)?.[1]);
  assert.ok(Number.isFinite(budget), "the waiting job declares no timeout — this arm could not look");
  // MARGIN, NOT MERELY ORDER (tracker issue 247). `>` is satisfied by one second of headroom, which
  // cancels the job during the checkout and install that surround the wait — and the prose above
  // `WAIT_MS` claimed a job budget of 30 while the job said 25 for exactly as long as nothing checked.
  assert.ok(budget * 60_000 >= WAIT_MS + MIN_JOB_MARGIN_MS,
    `the job is capped at ${budget} minutes, its wait alone is ${WAIT_MS / 60_000}, and it needs `
    + `${MIN_JOB_MARGIN_MS / 60_000} more for the checkout and install around it. It is cancelled at the `
    + "moment it was about to answer, and a cancelled job reads as neither a pass nor a failure");
});

test("208 an unreadable wait budget refuses rather than guessing in either direction", () => {
  assert.equal(waitBudget({}), WAIT_MS, "the default bound is no longer the file's own");
  assert.equal(waitBudget({ CLEAROTRON_RELEASE_WAIT_MS: "0" }), 0, "the rehearsal cannot ask for a single pass");
  for (const bad of ["soon", "-1", "1.5", "15m"])
    assert.throws(() => waitBudget({ CLEAROTRON_RELEASE_WAIT_MS: bad }), /not a whole number/,
      `"${bad}" was accepted — a real run would take it as 0 and give up without waiting at all`);
});

test("208 no job output is read through a hyphenated name", () => {
  // `needs.await-the-cut.outputs.cut` does not read an output: the expression parser takes the hyphens
  // as subtraction, the condition never equals 'true', and the job it guards silently never runs.
  const executable = executableText(RELEASE_YML);
  const bad = [...executable.matchAll(/needs\.([A-Za-z0-9_]*-[A-Za-z0-9_-]*)\./g)].map((m) => m[1]);
  assert.deepEqual(bad, [], `these job outputs are read through a hyphenated name and evaluate to nothing: ${bad.join(", ")}`);
});

// ── 208 · THE DECISION IS ASKED OF THE PUSH, NOT OF WHATEVER HEAD BECAME ────────────────────────────
//
// Measured on run 34050690448. In the `version` job the changesets action has already run `changeset
// version` AND COMMITTED the bump before the cut decision runs, so HEAD carries the version branch's
// number. The step said `v0.1.11 has no tag — this push cut it` in the same run where the independent
// detector, checking out main, said `v0.1.10 is already released`. One tree, two answers.
//
// `cut` was therefore true on essentially every push, which is why the wait — conditioned on
// `cut != 'true'` — never armed, and why `publish` ran with nothing stranded and failed on
// `cannot publish over the previously published versions: 0.1.10`.

test("208 the version job asks its cut decision about the commit that was pushed", () => {
  const version = jobText("version");
  assert.match(version, /CLEAROTRON_CUT_REF: \$\{\{ github\.sha \}\}/,
    "the cut decision is asked of whatever HEAD has become after the changesets action committed the "
    + "bump — it answers about the version branch, and `cut` is then true on every push");
  // AND THE STEP IT SCOPES IS THE ONE THAT DECIDES. An env on the wrong step is a variable nothing reads.
  const at = version.indexOf("CLEAROTRON_CUT_REF");
  const decides = version.indexOf("release-cut-decision.mjs", at);
  assert.ok(decides > at && decides - at < 200,
    "CLEAROTRON_CUT_REF is set somewhere other than the step that runs the cut decision");
});

test("208 an unnamed ref still means HEAD, which is right for the cron and a hand run", () => {
  // The cron checks out main and nothing has moved under it, so HEAD is the question there. This must
  // not become a variable every caller has to remember.
  assert.equal(cutRef({}), "HEAD");
  assert.equal(cutRef({ CLEAROTRON_CUT_REF: "   " }), "HEAD");
  assert.equal(cutRef({ CLEAROTRON_CUT_REF: "d534f531" }), "d534f531");
});

test("208 a wait that could not LOOK is not a wait that found nothing", () => {
  // Giving up quietly is the ordinary outcome and stays exit 0 — red checks, a dismissed pull request,
  // a re-cut mid-flight. A fetch that failed is a different thing, and reporting it as "nothing to
  // publish" hands the job below a verdict this never reached.
  const src = readFileSync(join(REPO, "scripts", "release-await-cut.mjs"), "utf8");
  assert.match(src, /process\.exitCode = 2/,
    "a failure to read main no longer exits 2, so it is indistinguishable from finding nothing merged");
  assert.match(src, /looked=false/, "the two negatives are not separated in the output the job reads");
  assert.match(src, /looked=true/, "a successful look does not say it looked, so `looked` proves nothing");
});

test("208 the loop propagates a read failure rather than answering with it", async () => {
  // Driven: the catch that turns this into exit 2 lives in main(), and it can only do that if the loop
  // itself refuses to invent an answer.
  await assert.rejects(
    () => awaitCut({ refresh: async () => { throw new Error("fetch died"); }, read: () => ({ cut: false, version: "0.0.0" }),
      sleep: async () => {}, waitMs: 0, stepMs: 1, now: () => 0 }),
    /fetch died/, "a refresh that threw was swallowed into a 'nothing merged' verdict");
});

test("208 the second publish refuses a tip that is not the one it awaited", () => {
  const second = RELEASE_YML.slice(RELEASE_YML.indexOf("\n  publish-awaited:"));
  assert.match(second, /needs\.awaited\.outputs\.version/,
    "the second publish never compares what it checked out against what it awaited, so a merge landing "
    + "inside the wait is published by a run that reported awaiting something else");
  assert.match(second, /exit 2/, "an absent awaited version is not treated as a could-not-look");
  assert.match(second, /Refusing to publish either/,
    "a tip that moved is resolved in favour of one of the two numbers — neither is safe once they differ");
  // BEFORE ANYTHING IS PACKED. A check after the pack certifies bytes it did not gate.
  const guard = second.indexOf("The tip this packs is the version this run awaited");
  const pack = second.indexOf("- name: Pack the exact bytes that will be published");
  assert.ok(guard > 0 && pack > guard, "the tip check does not run before the pack, so it gates nothing");
});

// ── the Releases page carries stable versions only (owner's ruling, 2026-09-06) ──────────────────
//
// A pre-release is tagged and gets no release entry; a stable keeps its entry AND its changelog.
//
// THESE ARMS RUN THE STEP'S SHELL RATHER THAN READING IT. Every earlier arm over this workflow
// asserted that some text was present, and a text arm cannot tell "the beta branch is there" from
// "the beta branch is there and never taken". The script is lifted out of the job and driven against
// a stub `gh`, once per publishing job, because the step is DUPLICATED — `publish` and
// `publish-awaited` each carry a copy, and a change made to one of them is the shape of defect this
// pipeline has already shipped once.

/** The `run:` block of one NAMED step, lifted out of a job's text and dedented back to a script. */
function namedStepScript(jobBody, stepName, jobName = stepName) {
  const at = jobBody.indexOf(`- name: ${stepName}`);
  assert.ok(at >= 0, `${jobName} has no step called "${stepName}" — this arm could not look, which is not a pass`);
  const rest = jobBody.slice(at);
  const runAt = rest.indexOf("        run: |\n");
  assert.ok(runAt >= 0, `${jobName}'s tag step has no run block — this arm could not look`);
  const lines = rest.slice(runAt + "        run: |\n".length).split("\n");
  const body = [];
  for (const line of lines) {
    if (line.trim() === "") { body.push(""); continue; }
    if (!line.startsWith("          ")) break;
    body.push(line.slice(10));
  }
  return body.join("\n").trimEnd();
}

/** The tag/release step, with the assertion that the lift actually caught it. */
function tagStepScript(jobBody, jobName) {
  const script = namedStepScript(jobBody, "Tag it, and say what changed", jobName);
  assert.ok(/gh release create/.test(script), `${jobName}'s lifted script never creates a release — the lift is wrong`);
  return script;
}

const KNOWN_NOTES = "New: the thing the reader came for.";

/**
 * Drive one lifted script against a stub `gh`, in a throwaway git repository.
 *
 * The repository is real because one of the two jobs resolves its target with `git rev-parse HEAD`;
 * `release-notes-for.mjs` is real, and NON-EMPTY, because the ruling's stable half is "keeps the
 * release WITH the folded changelog" — that is the `--notes-file` branch, and a stub that returned
 * nothing would leave it undriven and the arm green with the notes generator deleted.
 */
function driveTagStep({ script, version, prerelease, existingTagRef = null }) {
  const dir = mkdtempSync(join(tmpdir(), "tag-step-"));
  try {
    execFileSync("git", ["init", "-q", "-b", "main", dir], { stdio: "pipe" });
    writeFileSync(join(dir, "seed"), "x\n");
    execFileSync("git", ["-C", dir, "add", "seed"], { stdio: "pipe" });
    execFileSync("git", ["-C", dir, "-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "-qm", "seed"], { stdio: "pipe" });

    mkdirSync(join(dir, "scripts"), { recursive: true });
    writeFileSync(join(dir, "scripts", "release-notes-for.mjs"),
      `console.log(${JSON.stringify(KNOWN_NOTES)});\n`);

    const bin = join(dir, "bin");
    mkdirSync(bin);
    const log = join(dir, "gh.log");
    // The read answers with `existingTagRef` when one is given — including a ref that is a PREFIX
    // MATCH rather than the ref asked for, which is the answer the plural endpoint gives.
    const found = existingTagRef ? `printf '%s\\n' ${JSON.stringify(existingTagRef)}; exit 0` : "exit 1";
    writeFileSync(join(bin, "gh"),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(log)}\n`
      + `case "$1" in\n`
      + `  release) case "$2" in view) exit 1 ;; create) exit 0 ;; esac ;;\n`
      + `  api) case "$2" in *"/git/ref/tags/"*) ${found} ;; *"/git/refs") exit 0 ;; esac ;;\n`
      + `esac\nexit 0\n`, { mode: 0o755 });

    const scriptPath = join(dir, "step.sh");
    writeFileSync(scriptPath, script);
    const sha = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const out = execFileSync("bash", [scriptPath], {
      cwd: dir,
      encoding: "utf8",
      stdio: "pipe",
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        HOME: dir,
        GH_TOKEN: "not-a-token",
        GITHUB_REPOSITORY: "CordilleraSarl/clearotron",
        GITHUB_SHA: sha,
        VERSION: version,
        PRERELEASE_FLAG: prerelease,
      },
    });
    return {
      out,
      log: existsSync(log) ? readFileSync(log, "utf8") : "",
      notesFile: existsSync(join(dir, "release-notes.md")) ? readFileSync(join(dir, "release-notes.md"), "utf8") : null,
      sha,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const PUBLISHING = publishingJobs(RELEASE_YML);

test("230 every job that publishes carries the tag/release step, and there is more than one", () => {
  assert.ok(PUBLISHING.length >= 2,
    `the workflow has ${PUBLISHING.length} publishing job(s); this suite drives the step in each of them, `
    + "and finding fewer than two means the splitter stopped seeing one — an arm that could not look");
  for (const [name, body] of PUBLISHING) tagStepScript(body, name);
});

// THIS TEST ASSERTED THE OPPOSITE UNTIL 2026-09-07, and the reversal is deliberate (tracker issue 264,
// reversing his 2026-09-06 ruling). It read "a pre-release is tagged and yields no GitHub release
// entry". Left as it was, it would hold the code to a rule that no longer stands — which is why it is
// rewritten here rather than deleted: the next reader needs to see that the behaviour flipped
// deliberately, not that a test quietly went missing.
test("264 a pre-release is tagged AND gets an entry marked Pre-release", () => {
  for (const [name, body] of PUBLISHING) {
    const run = driveTagStep({ script: tagStepScript(body, name), version: "9.9.9-beta.3", prerelease: "true" });
    assert.match(run.log, /api repos\/CordilleraSarl\/clearotron\/git\/refs .*refs\/tags\/v9\.9\.9-beta\.3/,
      `${name}: the pre-release was not tagged. The tag is what tells the next run this version is `
      + `already published — without it the pipeline cuts it again, forever.\n${run.log}`);
    assert.match(run.log, /-f sha=[0-9a-f]{40}/,
      `${name}: the tag was written at no resolvable commit\n${run.log}`);
    assert.match(run.log, /release create v9\.9\.9-beta\.3 .*--prerelease/,
      `${name}: a beta got no entry, or got one that is not marked as a pre-release. Unmarked is worse `
      + `than absent: GitHub shows the latest NON-prerelease as the release, so an unmarked beta `
      + `displaces the stable somebody came for.\n${run.log}`);
    assert.equal(run.notesFile, `${KNOWN_NOTES}\n`,
      `${name}: the pre-release entry was created from notes that are not the ones the generator produced`);
  }
});

test("230 a stable keeps its release entry, and the entry carries the changelog", () => {
  for (const [name, body] of PUBLISHING) {
    const run = driveTagStep({ script: tagStepScript(body, name), version: "9.9.9", prerelease: "false" });
    assert.match(run.log, /release create v9\.9\.9 .*--notes-file release-notes\.md/,
      `${name}: a stable version made no release entry from its notes\n${run.log}`);
    assert.equal(run.notesFile, `${KNOWN_NOTES}\n`,
      `${name}: the release entry was created from notes that are not the ones the generator produced`);
    assert.ok(!/--prerelease/.test(run.log),
      `${name}: a stable was marked as a pre-release on the page\n${run.log}`);
  }
});

test("230 an existing beta tag does not stop the stable that follows it from being tagged", () => {
  // `git/refs/tags/v0.2.0` — plural — answers with `v0.2.0-beta.1`. A step that treats any answer as
  // "already tagged" skips the tag for exactly the promotion this ruling exists to serve.
  for (const [name, body] of PUBLISHING) {
    const run = driveTagStep({
      script: tagStepScript(body, name),
      version: "9.9.9-beta.4",
      prerelease: "true",
      existingTagRef: "refs/tags/v9.9.9-beta.1",
    });
    assert.match(run.log, /-f ref=refs\/tags\/v9\.9\.9-beta\.4/,
      `${name}: a DIFFERENT tag whose name starts the same way read as this one already existing, so `
      + `this version was never tagged\n${run.log}`);
  }
});

// THE TAG AND THE ENTRY ARE TWO QUESTIONS NOW, and this test is why the step asks them separately.
// Every beta cut before 2026-09-07 has a tag and no entry, so a step that exited on seeing the tag would
// leave those betas permanently unlisted. The no-double-tag half is unchanged.
test("264 an already-tagged pre-release is not tagged again, and still gets its entry", () => {
  for (const [name, body] of PUBLISHING) {
    const run = driveTagStep({
      script: tagStepScript(body, name),
      version: "9.9.9-beta.4",
      prerelease: "true",
      existingTagRef: "refs/tags/v9.9.9-beta.4",
    });
    assert.ok(!/-f ref=/.test(run.log), `${name}: a tag that already exists was written again\n${run.log}`);
    // NOT MERELY THE ABSENCE OF A SECOND TAG — a job with no pre-release path at all writes no tag
    // either, and would read as a pass here. This is the step SAYING it looked and found one.
    assert.match(run.out, /The tag v9\.9\.9-beta\.4 already exists\./,
      `${name}: nothing reported an existing tag, so the absence of a second one proves nothing\n${run.out}`);
    assert.match(run.log, /release create v9\.9\.9-beta\.4 .*--prerelease/,
      `${name}: an existing tag stopped the entry being written. A beta cut before the ruling changed has `
      + `a tag and no entry, and this is the path that gives it one.\n${run.log}`);
  }
});

// THE PLANTS. Each mutates ONE job and drives it: a mutation applied to the whole file is how a
// weakening hid here before, when a `.replace` without `/g` left the second publishing job untouched
// and the arm passed on the one it had already broken.
test("230 planted: a job that ignores the pre-release flag is caught, in each job separately", () => {
  for (const [name, body] of PUBLISHING) {
    const script = tagStepScript(body, name);
    const broken = script.replace('if [ "$PRERELEASE_FLAG" = "true" ]; then', "if false; then");
    assert.notEqual(broken, script, `${name}: the plant changed nothing, so it proves nothing`);
    const run = driveTagStep({ script: broken, version: "9.9.9-beta.3", prerelease: "true" });
    assert.match(run.log, /release create/,
      `${name}: the tree was broken so that every version takes the release-entry path, and the drive `
      + "still produced no release entry — the arm above cannot see the defect it exists for");
  }
});

test("230 planted: a job that compares the tag read by prefix is caught, in each job separately", () => {
  for (const [name, body] of PUBLISHING) {
    const script = tagStepScript(body, name);
    const broken = script.replace('if [ "$EXISTING" = "refs/tags/v$VERSION" ]; then', 'if [ -n "$EXISTING" ]; then');
    assert.notEqual(broken, script, `${name}: the plant changed nothing, so it proves nothing`);
    const run = driveTagStep({
      script: broken, version: "9.9.9-beta.4", prerelease: "true", existingTagRef: "refs/tags/v9.9.9-beta.1",
    });
    assert.ok(!/-f ref=/.test(run.log),
      `${name}: the tree was broken so that any answer reads as "already tagged", and the drive still `
      + "wrote the tag — the exact-match arm above cannot see the defect it exists for");
  }
});

// ── the awaited publish packs the commit it decided about (tracker issue 238) ────────────────────
//
// The wait watched a version pull request merge itself, then the job below checked out `main` BY NAME.
// A commit landing in between that moves no version — an instrument fix with no note — was packed and
// published under a number whose changelog never described it, and nothing could see it: the tip check
// compares VERSIONS, and the version had not moved.

test("238 the wait reports the commit that MOVED the version, not the tip that still carries it", () => {
  // Newest first, as `git rev-list` prints them. c2 is the version pull request's merge; c4 and c3
  // landed after it and change no version — an instrument fix with no note is the ordinary case, and
  // publishing either of them ships bytes the changelog for 0.2.1 never described.
  const versions = { c4: "0.2.1", c3: "0.2.1", c2: "0.2.1", c1: "0.2.0" };
  const got = versionBumpCommit({
    version: "0.2.1",
    run: () => "c4\nc3\nc2\nc1\n",
    versionAt: ({ ref }) => versions[ref],
  });
  assert.equal(got, "c2",
    `the wait reported ${got}, which carries 0.2.1 but is not the commit that moved it there. The tip `
    + "check downstream compares VERSIONS, so it passes on exactly this mistake");
});

test("238 when the bump IS the tip — the ordinary case — the tip is what is reported", () => {
  const versions = { c2: "0.2.1", c1: "0.2.0" };
  assert.equal(versionBumpCommit({ version: "0.2.1", run: () => "c2\nc1\n", versionAt: ({ ref }) => versions[ref] }),
    "c2", "the common case, where nothing landed after the merge, no longer publishes the merge");
});

test("238 a version whose bump cannot be found in the walk answers nothing, and is not guessed at", () => {
  const got = versionBumpCommit({
    version: "0.2.1",
    run: () => "c3\nc2\nc1\n",
    // every commit in reach carries it, so the bump is beyond the walk and this cannot say which it is
    versionAt: () => "0.2.1",
  });
  assert.equal(got, null,
    "a walk that never saw the version change still named a commit. The oldest one it happened to reach "
    + "is not the bump, and publishing it would ship a tree from before the release");
});

/**
 * `readMain` with every reader supplied, so the arm answers about the code and not about this box.
 *
 * THE FIRST VERSION OF THIS ARM INJECTED ONLY `run`. It passed here, where `main` is tagged and the
 * reader returned early, and failed on the runner, where the checkout has neither `origin/main` nor
 * tags and it took the other path. Green by the box that ran it — the exact shape this file's header
 * warns about, written into this file anyway. CI caught it; the local suite could not.
 */
const readingMain = ({ tip = "a".repeat(40), cut, version, history = [], versions = {} }) => {
  const calls = [];
  const r = readMain({
    run: (args) => { calls.push(args.join(" ")); return args[0] === "rev-list" ? `${history.join("\n")}\n` : `${tip}\n`; },
    versionAt: ({ ref }) => (ref === "origin/main" ? version : versions[ref]),
    tags: () => [],
    decide: () => ({ cut, version }),
  });
  return { r, calls };
};

test("238 the wait reports the tip it read, and reads it from the same ref as the version", () => {
  const tip = "a".repeat(40);
  const { r, calls } = readingMain({ tip, cut: false, version: "0.2.0" });
  assert.equal(calls[0], "rev-parse origin/main",
    "the commit is not read from the same ref the version is read from, in one pass");
  for (const k of ["cut", "version", "sha", "tip"]) {
    assert.ok(k in r, `the reader stopped answering \`${k}\`, so the loop above it cannot decide`);
  }
  assert.equal(r.tip, tip, "the wait no longer records which tip it looked at");
  // NOTHING TO PUBLISH: the tip is what a reader wants recorded, and there is no bump to look for.
  assert.equal(r.sha, tip, "with nothing cut, the wait reported something other than the tip it read");
});

test("238 with something to publish, the wait reports the bump and NOT the tip", () => {
  const tip = "c".repeat(40);
  const bump = "b".repeat(40);
  const { r } = readingMain({
    tip, cut: true, version: "0.2.1",
    history: [tip, bump, "d".repeat(40)],
    versions: { [tip]: "0.2.1", [bump]: "0.2.1", ["d".repeat(40)]: "0.2.0" },
  });
  assert.equal(r.sha, bump,
    `the wait reported ${r.sha}. The tip carries 0.2.1 too — every commit after the bump does — so `
    + "reporting it publishes bytes the changelog for 0.2.1 never described");
  assert.equal(r.tip, tip, "the tip it looked at is no longer recorded alongside");
});

test("238 a cut whose bump cannot be found refuses rather than falling back to the tip", () => {
  assert.throws(() => readingMain({
    tip: "c".repeat(40), cut: true, version: "0.2.1",
    history: ["c".repeat(40), "b".repeat(40)],
    versions: { ["c".repeat(40)]: "0.2.1", ["b".repeat(40)]: "0.2.1" },
  }), /no commit in the last 100/,
    "a version whose bump is out of reach was published against the branch tip, which is a tree the "
    + "changelog does not describe");
});

test("238 a name the wait cannot resolve refuses rather than being handed on", () => {
  // `git rev-parse` PRINTS THE NAME BACK when it cannot resolve it, so this failure arrives looking
  // like a value. A checkout would then take it as a ref and land somewhere.
  for (const answer of ["origin/main\n", "\n", "abc123\n", `${"a".repeat(39)}\n`, `${"a".repeat(41)}\n`, "A".repeat(40)]) {
    assert.throws(() => readMain({ run: () => answer }), /not a commit/,
      `the wait accepted ${JSON.stringify(answer)} as the commit to publish`);
  }
});

test("238 the commit reported is the one from the pass that found the cut, not an earlier or later read", async () => {
  const seen = [];
  let n = 0;
  const read = () => {
    n += 1;
    const d = { cut: n === 3, version: "9.9.9", sha: `${n}`.repeat(40) };
    seen.push(d.sha);
    return d;
  };
  const r = await awaitCut({
    refresh: async () => {}, read, sleep: async () => {}, waitMs: 10_000, stepMs: 1, now: () => 0,
  });
  assert.equal(r.cut, true, "the loop never saw the cut this arm staged");
  assert.equal(r.sha, "3".repeat(40),
    `the wait reported ${r.sha} but the pass that found the cut read ${seen[2]} — the publish would `
    + "check out a tree the verdict was not about");
});

test("238 the second publish checks out the commit the wait named, and the wait publishes it", () => {
  const awaited = jobText("awaited");
  assert.match(awaited, /sha: \$\{\{ steps\.awaited\.outputs\.sha \}\}/,
    "the wait no longer publishes the commit it decided about, so the job below has nothing to check out");
  const second = RELEASE_YML.slice(RELEASE_YML.indexOf("\n  publish-awaited:"));
  const co = second.indexOf("actions/checkout@v7");
  const guard = second.indexOf("The wait named a commit to publish");
  assert.ok(guard > 0, "nothing refuses an absent commit — this arm could not look");
  // BEFORE THE CHECKOUT. `ref:` with an empty value checks out the default branch rather than failing,
  // so a guard after it would certify a tree that was already wrong.
  assert.ok(guard < co,
    "the refusal runs after the checkout it protects, so an absent commit has already been resolved to "
    + "the default branch by the time anything asks");
});

test("238 the refusal is driven, not read: an absent or partial commit stops the publish", () => {
  const second = RELEASE_YML.slice(RELEASE_YML.indexOf("\n  publish-awaited:"));
  const script = namedStepScript(second, "The wait named a commit to publish", "publish-awaited");
  const drive = (sha) => {
    const dir = mkdtempSync(join(tmpdir(), "awaited-sha-"));
    try {
      const f = join(dir, "step.sh");
      writeFileSync(f, script);
      try {
        const out = execFileSync("bash", [f], { encoding: "utf8", stdio: "pipe", env: { PATH: process.env.PATH, AWAITED_SHA: sha } });
        return { code: 0, out };
      } catch (e) { return { code: e.status, out: `${e.stdout ?? ""}${e.stderr ?? ""}` }; }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  for (const bad of ["", "main", "abc123", "a".repeat(39), "a".repeat(41), "A".repeat(40), "../../etc"]) {
    const r = drive(bad);
    assert.equal(r.code, 2,
      `the publish accepted ${JSON.stringify(bad)} as the commit to check out (exit ${r.code}). Exit 2 is `
      + `this repository's could-not-look, and an unresolvable ref must not read as one that resolved.\n${r.out}`);
  }
  const good = drive("b".repeat(40));
  assert.equal(good.code, 0, `a full commit was refused\n${good.out}`);
  assert.match(good.out, new RegExp("b".repeat(40)), "the step does not say which commit it is publishing");
});

test("238 planted: a refusal that only checks for emptiness is caught", () => {
  const second = RELEASE_YML.slice(RELEASE_YML.indexOf("\n  publish-awaited:"));
  const script = namedStepScript(second, "The wait named a commit to publish", "publish-awaited");
  // The shape somebody writes when they think "empty" is the only bad answer. `main` is the exact value
  // this issue is about, and it is not empty.
  const broken = script.replace(/case "\$AWAITED_SHA" in[\s\S]*?esac\n/, "").replace(/if \[ "\$\{#AWAITED_SHA\}" -ne 40 \][\s\S]*?fi\n/, "");
  assert.notEqual(broken, script, "the plant changed nothing, so it proves nothing");
  const dir = mkdtempSync(join(tmpdir(), "awaited-plant-"));
  try {
    const f = join(dir, "step.sh");
    writeFileSync(f, broken);
    let code = 0;
    try { execFileSync("bash", [f], { encoding: "utf8", stdio: "pipe", env: { PATH: process.env.PATH, AWAITED_SHA: "main" } }); }
    catch (e) { code = e.status; }
    assert.equal(code, 0,
      "the tree was broken so that only an empty answer refuses, and `main` was still rejected — the "
      + "arm above cannot see the defect it exists for");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── THE REHEARSAL RUNS THE CODE UNDER REVIEW (tracker issue 245) ───────────────────────────────────
//
// Three jobs checked out `ref: main` and then ran scripts from that checkout. The workflow YAML comes
// from the ref the run started on, so a `workflow_dispatch` from a branch ran the BRANCH's workflow file
// against MAIN's copy of the scripts — and `workflow_dispatch` is this pipeline's rehearsal, the one
// mechanism whose whole purpose is to exercise a change before it lands.
//
// Measured while building the awaited-publish fix: a dispatch from that branch would have run main's
// `release-await-cut.mjs`, which emits no `sha`, and the branch's new refusal would have exited 2 — a red
// that says nothing about the change under review.
//
// THE DISTINCTION THESE ARMS PIN is the one the issue draws: the tree a job QUESTIONS and the code it
// RUNS are two statements, not one accident.
test("245 no job checks out a moving branch name and then runs scripts from it", () => {
  const yml = RELEASE_YML;
  const lines = executableText(yml).split("\n");
  const moving = lines.filter((l) => /^\s+ref:\s*main\s*$/.test(l));
  assert.deepEqual(moving, [],
    "`ref: main` re-resolves at checkout time and, on a dispatch, is not the ref under review. Pin to "
    + "`github.sha` and name main as the subject instead.");
});

test("245 every checkout that runs release scripts pins to the ref the run started on", () => {
  const yml = RELEASE_YML;
  // Count the pinned checkouts rather than asserting a total: a new job that runs these scripts must
  // make the same statement, and a job added with a moving ref is caught by the arm above.
  const pinned = (yml.match(/^\s+ref:\s*\$\{\{\s*github\.sha\s*\}\}\s*$/gm) ?? []).length;
  assert.ok(pinned >= 3,
    `expected the three deciding jobs to pin to github.sha; found ${pinned}`);
});

test("245 a pinned checkout FETCHES origin/main, because the scripts refuse without it", () => {
  const yml = RELEASE_YML;
  const fetches = (yml.match(/refs\/remotes\/origin\/main/g) ?? []).length;
  assert.ok(fetches >= 3,
    "`origin/main` does not exist in a checkout pinned to a sha, and readMain refuses by name when it is "
    + `absent — so each pinned job must fetch it. Found ${fetches} fetch(es).`);
});

test("245 the jobs that ASK about main name main as the subject, so the pin did not move the question", () => {
  const yml = RELEASE_YML;
  // `cutRef()` defaults to HEAD. With the checkout pinned, HEAD is the run's own ref — so a job that is
  // supposed to decide about main must say so, or the pin silently changes what it decides.
  const named = (yml.match(/CLEAROTRON_CUT_REF:\s*origin\/main/g) ?? []).length;
  assert.equal(named, 2,
    "`stranded` and `pending` ask about main as it is now; both must name it. The `version` job is "
    + "deliberately different — it decides about the commit that was pushed.");
  assert.match(yml, /CLEAROTRON_CUT_REF:\s*\$\{\{\s*github\.sha\s*\}\}/,
    "and the version job still decides about the pushed commit, which is its own correct subject");
});

// ── a beta is cut on demand, and a merge publishes nothing ─────────────────────
//
// The cadence is the whole subject here. Before this, turning on auto-merge for the version pull
// request happened on every push, so every merge cut and published a beta. These tests hold the three
// properties that replaced it: a merge publishes nothing, one dispatch cuts one beta, and a dispatch
// with nothing to cut refuses and says why.
//
// Each one is checked against a mutated copy of the workflow as well as the real one. A test that only
// passes on the current file cannot tell a working check from one that stopped looking.

/** One job's block, by name, sliced the same way the publish guard slices them. */
function jobBlock(name) {
  const jobs = RELEASE_YML.slice(RELEASE_YML.indexOf("\njobs:"));
  const starts = [...jobs.matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_-]*):$/gm)];
  const i = starts.findIndex((m) => m[1] === name);
  assert.ok(i >= 0, `the workflow has no job named ${name} — this test cannot look at what it is about`);
  const to = i + 1 < starts.length ? starts[i + 1].index : jobs.length;
  return jobs.slice(starts[i].index, to);
}

/** The `on:` section alone: `jobs:` has keys that look like triggers and vice versa. */
function triggers() {
  return RELEASE_YML.slice(RELEASE_YML.indexOf("\non:"), RELEASE_YML.indexOf("\nconcurrency:"));
}

test("264 the dispatch offers two modes and defaults to the one that cannot publish", () => {
  const on = triggers();
  assert.match(on, /workflow_dispatch:\s*\n\s+inputs:\s*\n\s+cut:/,
    "the release can no longer be started on demand: the dispatch carries no `cut` input");
  assert.match(on, /default:\s*rehearse/,
    "the dispatch defaults to something other than `rehearse`. Whoever opens the Run workflow dialog and "
    + "presses the button without reading it would publish a release.");
  for (const option of ["rehearse", "beta"]) {
    assert.match(on, new RegExp(`^\\s+- ${option}$`, "m"), `the \`cut\` input offers no \`${option}\` option`);
  }
});

test("264 a merge to main publishes nothing, because auto-merge is turned on only by a dispatched cut", () => {
  const version = jobBlock("version");
  const step = version.slice(version.indexOf("- name: Let it merge itself once its checks pass"));
  const condition = step.slice(step.indexOf("if:"), step.indexOf("\n        env:"));
  assert.match(condition, /inputs\.cut != 'rehearse'/,
    "the version pull request is set to merge itself without asking whether this run is a requested cut. "
    + "That is the behaviour tracker issue 264 removed: it publishes a pre-release on every merge.\n"
    + condition);
  assert.match(condition, /github\.event_name == 'workflow_dispatch'/,
    `the merge step does not require a dispatch, so a push could still reach it\n${condition}`);
});

test("264 the version commit answers the signature check, on every push and never for a fork", () => {
  // WHY THIS EXISTS. `cla` is a required check on `main`. `cla.yml` runs only on fork pull requests, and
  // this branch is pushed with the built-in token, which starts no workflow — so nothing reported on the
  // version pull request, not even a skip, and it could never merge. Measured 2026-09-07: a stable cut
  // computed its version, armed auto-merge, and waited out its whole budget on four green checks and a
  // fifth that could not arrive. The run finished GREEN having published nothing.
  const version = jobBlock("version");
  const step = version.slice(version.indexOf("- name: Say that an organisation-authored version commit"));
  assert.ok(step.length > 200, "the step that answers the signature check is gone — the version pull request cannot merge");

  // The context has to be the one protection requires. A status under any other name satisfies nothing.
  assert.match(step, /-f context=cla\b/, "the status is posted under a context that is not `cla`");
  assert.match(step, /-f state=success\b/, "the status is not a passing one");

  // THE SHA COMES FROM THE REF, NOT FROM THE PULL REQUEST OBJECT. Measured 2026-09-07: the version
  // commit landed at 17:04:00Z, this step read the pull request at 17:04:03Z, and the API handed back
  // the PREVIOUS head — so the status went onto a commit that was no longer the head and the pull
  // request stayed blocked. `head.sha` is a cached view of the branch; `git/ref/heads/<branch>` is the
  // branch. Reading provenance and the branch NAME from the pull request is safe because neither moves.
  assert.match(step, /git\/ref\/heads\//,
    "the sha is not read from the branch ref — a cached `head.sha` lags the push this job just made, "
    + "and the status then lands on a commit that is no longer the head");
  // SCOPED TO THE COMMAND, not the step text. A bare negative over the whole step reds on prose: a
  // sentence writing "the pull request's .head.sha field" would trip it, and today it passes only
  // because the surrounding comment happens to spell it with a backtick. What must not come back is the
  // FIELD being read, so the assertion is about the read.
  assert.ok(!/--jq[^\n]*\.head\.sha/.test(step),
    "the step still reads `head.sha` from the pull request object, which is the stale read this replaced");

  // AND IT CHECKS THE BRANCH DID NOT MOVE UNDER IT. Which surface is authoritative is a mechanism I
  // cannot prove from here, so the step does not depend on it: it re-reads after posting and refuses if
  // the tip changed. Without this the failure mode is silent — exit zero with a sha in the log — which
  // is how the first version survived a green run.
  const post = step.slice(step.indexOf("-X POST"));
  assert.match(post, /git\/ref\/heads\//,
    "the step does not re-read the ref after posting, so a branch that moved mid-step is not noticed");
  assert.match(post, /exit 1/,
    "the step notices a moved branch and does not fail on it — the status is then on the wrong commit, silently");

  // ON EVERY PUSH, not only a dispatched cut. Provenance is true the moment the commit exists; gating
  // this on the dispatch would leave the same commit answered or unanswered according to history, and
  // the standing pull request would show four of five until somebody asked for a cut.
  const condition = step.slice(step.indexOf("if:"), step.indexOf("\n        env:"));
  assert.ok(!/workflow_dispatch/.test(condition),
    `the signature status is gated on a dispatch, so the standing pull request sits incomplete between cuts\n${condition}`);
  assert.match(condition, /steps\.changesets\.outputs\.pr-number != ''/,
    `the step runs with no pull request to answer for\n${condition}`);

  // THE FORK TEST IS THE ONE `cla.yml` MAKES: head repository against base repository, never the author's
  // name. Without it this workflow would wave through a signature it has no standing to answer for.
  assert.match(step, /head\.repo\.full_name/,
    "the step does not check that the pull request's head is on this repository, so it could answer for a fork");
  assert.match(step, /exit 1/, "the fork case does not refuse — it would post the status anyway");

  // And the permission, which is not decoration: naming any permission sets every unnamed one to `none`.
  const perms = version.slice(version.indexOf("permissions:"), version.indexOf("steps:"));
  assert.match(perms, /statuses: write/,
    "the version job cannot post a status — the step 403s and the pull request stays blocked");
});

test("264 mutated: a merge step that lost its dispatch condition is caught", () => {
  // The mutation is the exact regression this replaced: the condition the file carried before.
  const before = "if: steps.changesets.outputs.pr-number != ''";
  const passes = (text) => /inputs\.cut != 'rehearse'/.test(text);
  assert.ok(!passes(before),
    "the check above would pass on the pre-2026-09-07 condition, so it cannot see the regression it exists for");
});

test("264 a dispatched cut with nothing to cut refuses, and the message says what to do", () => {
  const version = jobBlock("version");
  assert.match(version, /- name: A cut needs something to cut/,
    "a dispatched cut with no accumulated release notes would exit 0 having published nothing, which "
    + "reads exactly like a cut that happened");
  const step = version.slice(version.indexOf("- name: A cut needs something to cut"));
  assert.match(step, /steps\.changesets\.outputs\.pr-number == ''/,
    "the refusal does not key on there being no version pull request, so it cannot tell empty from full");
  assert.match(step, /::error::/, "the refusal does not surface as an error annotation on the run");
  assert.match(step, /\.changeset\//,
    "the refusal does not tell the reader where a release note goes, which is the one thing they need next");
  assert.match(step, /exit 1/, "the refusal reports and then exits 0, so the run reads as a success");
});

test("264 a rehearsal still cannot publish, and a requested cut can — in each publishing job", () => {
  for (const [name, body] of PUBLISHING) {
    assert.match(body, /if \[ "\$\{\{ github\.event_name \}\}" = "workflow_dispatch" \] && \[ "\$\{\{ inputs\.cut \}\}" = "rehearse" \]; then/,
      `${name}: the dry-run branch does not distinguish a rehearsal from a requested cut, so either every `
      + `dispatch publishes for real or none of them can`);
    assert.match(body, /dry_flag=--dry-run/, `${name}: the rehearsal no longer runs npm publish with --dry-run`);
    // The branch check is what stops a cut being dispatched from a feature branch. A rehearsal is
    // deliberately allowed anywhere, which is only safe while it cannot publish.
    assert.match(body, /refs\/heads\/main\) ;;/,
      `${name}: the publish path no longer checks the branch, so a requested cut could publish from anywhere`);
  }
  assert.ok(PUBLISHING.length >= 2,
    `only ${PUBLISHING.length} publishing job(s) were found; this test checks each separately and a `
    + "count below two means the splitter stopped seeing one");
});

test("264 the wait is real on a requested cut and instant on a rehearsal", () => {
  const awaited = jobBlock("awaited");
  const line = awaited.split("\n").find((l) => l.includes("CLEAROTRON_RELEASE_WAIT_MS"));
  assert.ok(line, "the wait job sets no budget, so a rehearsal would hold a runner for the full wait");
  assert.match(line, /inputs\.cut == 'rehearse'/,
    "the wait is zeroed on every dispatch, including a requested cut — so the cut would stop waiting "
    + `before the version pull request could merge, and publish nothing\n${line}`);
});

test("264 the cron is still there, because removing it is how every release stops", () => {
  // The cadence ruling says no scheduled beta, and the schedule cuts nothing: it asks main whether a
  // version is sitting there untagged. Deleting it was a plausible way to read that ruling, and it
  // would strand every release whose wait gave up.
  assert.match(triggers(), /schedule:\s*\n\s+- cron: '\*\/5 \* \* \* \*'/,
    "the scheduled trigger is gone. Nothing publishes a version whose wait timed out, and the version "
    + "pull request's own merge raises no event to catch it.");
  assert.match(jobBlock("pending"), /github\.event_name == 'schedule'/,
    "the job the cron drives no longer answers to it");
});

test("264 pushing a tag cannot publish, because tags are also how this pipeline remembers", () => {
  // Deleting a tag is silent. RECREATING one used to start a real release run for the version at it —
  // and recreating a tag is exactly what you do to repair the pipeline's memory of what was released.
  // Restoring a fact attempted a release. Three of them did, on 2026-09-07, and only the registry
  // refusing to overwrite a published version stopped them.
  assert.ok(!/^\s+tags:/m.test(triggers()),
    "the release workflow runs on a tag push again. `release-cut-decision.mjs` decides whether a version "
    + "was released by asking whether its tag exists, so with this trigger present, restoring a deleted "
    + "tag publishes the version at it.");
  for (const [name, body] of PUBLISHING) {
    assert.ok(!/startsWith\(github\.ref, 'refs\/tags\/v'\)/.test(body),
      `${name}: the job still arms on a tag ref, which it can now only reach if the trigger comes back`);
  }
  // AND THE PATHS THAT ONLY A TAG RUN COULD REACH ARE GONE WITH IT. A check that cannot fire reads as
  // protection to the next person who greps for one.
  assert.ok(!/TAG_VERSION/.test(RELEASE_YML),
    "the tag-versus-manifest check is still here, and no run can arrive on a tag ref to exercise it");
});

test("271 a merge to main starts no wait job — the wait belongs to a requested cut", () => {
  // This job waits for the standing version pull request to merge itself. Only a requested cut arms
  // auto-merge, so on a push the wait can only run its budget out — twenty five minutes of a runner per
  // merge, for an event that cannot happen. It does not go red either: expiry here is a deliberate quiet
  // success, so the waste never announces itself in a verdict.
  const awaited = jobBlock("awaited");
  const condition = awaited.slice(awaited.indexOf("if: >-"), awaited.indexOf("runs-on:"));
  assert.ok(!/event_name == 'push'/.test(condition),
    "the wait arms on a push again. Nothing merges the version pull request on a push any more, so this "
    + `holds a runner for the full budget waiting for something that cannot occur.\n${condition}`);
  assert.match(condition, /github\.event_name == 'workflow_dispatch'/,
    `the wait no longer arms on a dispatch, so a requested cut would publish nothing\n${condition}`);
  // AND THE REHEARSAL MUST STILL REACH IT — a step nobody rehearses is one whose first real run is the
  // day it matters. The zero budget is what makes that free.
  const wait = awaited.slice(awaited.indexOf("CLEAROTRON_RELEASE_WAIT_MS"));
  assert.match(wait.split("\n")[0], /inputs\.cut == 'rehearse'/,
    "the rehearsal no longer gets its zero budget, so it would hold a runner for the full wait");
});

// ── the input decides the channel, and the artefact confirms it ────────────────────
//
// After the 0.2.1 stable, `changeset version` DELETED `.changeset/pre.json` rather than leaving it saying
// "exit". In that state a `cut: beta` dispatch would have computed a stable version and published it to
// `latest` — a stable release out of a button marked beta, with nothing in the run saying so.

test("279 the cut input offers a stable, and still defaults to the mode that cannot publish", () => {
  const on = triggers();
  for (const option of ["rehearse", "beta", "stable"]) {
    assert.match(on, new RegExp(`^\\s+- ${option}$`, "m"), `the cut input offers no \`${option}\``);
  }
  assert.match(on, /default:\s*rehearse/,
    "the dispatch defaults to something other than `rehearse`, so pressing the button without reading it "
    + "would publish");
});

test("279 no condition keys on a CHANNEL where it means 'is this a real cut'", () => {
  // THE REGRESSION THIS EXISTS FOR. Every one of these read `inputs.cut != 'beta'` when `beta` was the
  // only real cut, so adding `stable` silently made a stable dispatch behave as a rehearsal — a publish
  // path that quietly does nothing, which is the failure that looks most like success.
  const yml = RELEASE_YML;
  const lines = yml.split("\n")
    .map((l, i) => ({ l, n: i + 1 }))
    .filter(({ l }) => /inputs\.cut\s*[!=]=\s*'beta'/.test(l));
  assert.deepEqual(lines.map(({ l, n }) => `${n}: ${l.trim()}`), [],
    "a condition still compares the cut input against `beta`. Where the question is whether this run is a "
    + "real cut, the test is `!= 'rehearse'`; naming a channel there breaks the moment another is added.");
});

test("279 the tree is put in the mode the chosen channel needs, before the version is computed", () => {
  const version = jobBlock("version");
  const at = version.indexOf("- name: Put the tree in the mode this cut needs");
  assert.ok(at >= 0, "nothing puts the tree in pre-release mode, so the input cannot decide the channel");
  const step = version.slice(at, version.indexOf("- name: Open or update the standing version pull request"));
  assert.ok(at < version.indexOf("- name: Open or update the standing version pull request"),
    "the mode is set AFTER the version is computed, which is too late to affect it");
  assert.match(step, /changeset pre enter beta/, "a beta cut does not enter pre-release mode");
  assert.match(step, /changeset pre exit/, "a stable cut does not leave pre-release mode");
  // Both directions must be no-ops when the tree is already right, or an ordinary second cut fails.
  assert.match(step, /already in pre-release mode/, "entering when already in pre mode is not handled");
  assert.match(step, /not in pre-release mode/, "exiting when already out of pre mode is not handled");
});

test("279 the refusal asks the VERSION, not the arrangement that produced it", () => {
  const version = jobBlock("version");
  const at = version.indexOf("- name: The version this cut computed is the channel that was asked for");
  assert.ok(at >= 0, "nothing checks that the computed version matches the channel that was asked for");
  const step = version.slice(at, at + 2200);
  assert.match(step, /release-dist-tag\.mjs "\$VERSION" --prerelease/,
    "the check does not ask the version whether it is a pre-release — anything else is trusting the mechanism");
  assert.match(step, /inputs\.cut \}\}" = "beta" \] && \[ "\$PRE" != "true"/,
    "a beta input that computed a stable version is not refused");
  assert.match(step, /inputs\.cut \}\}" = "stable" \] && \[ "\$PRE" = "true"/,
    "a stable input that computed a pre-release is not refused");
  // AND IT MUST NOT JUDGE A VERSION NOBODY CUT. With no version pull request there is no new version.
  const nothingToCut = version.indexOf("- name: A cut needs something to cut");
  assert.ok(nothingToCut >= 0 && nothingToCut < at,
    "the version check runs before the nothing-to-cut refusal, so it would judge the version already on main");
});
