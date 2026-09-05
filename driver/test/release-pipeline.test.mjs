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
import { refusals as publishRefusals, WORKFLOW, CREDENTIAL_TOKENS, REPOSITORY } from "../../scripts/release-publish-guard.mjs";
import { distTag, isPrerelease, preModeFrom, STABLE, UNNAMED_PRERELEASE } from "../../scripts/release-dist-tag.mjs";
import { cutDecision, versionAtHead } from "../../scripts/release-cut-decision.mjs";
import { checksVerdict, waitForChecks, RUNNING, NOTHING_STARTED, WAITING_FOR_A_PERSON } from "../../scripts/release-version-pr-checks.mjs";
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

test("tracker 97 during the pre-release phase `latest` is the pre-release, and that is a decision", () => {
  // Owner ruling, 2026-09-05, in his words: "latest has all our fixes." While the repository is in pre
  // mode every cut publishes as `latest`, so a friendly early user typing `npm i clearotron` gets the
  // newest build. This arm exists because the same file refuses that outcome OUTSIDE pre mode, and the
  // two rules are one character apart in the code and opposite in meaning.
  assert.equal(distTag("0.1.1-beta.0", { preMode: true }), STABLE);
  assert.equal(distTag("1.0.0-rc.1", { preMode: true }), STABLE);
  assert.equal(distTag("0.2.0", { preMode: true }), STABLE);

  // And outside it the original rule stands, for the original reason.
  assert.equal(distTag("1.0.0-rc.1"), "rc");
  assert.equal(distTag("0.1.1-beta.0"), "beta");

  // AN UNREADABLE VERSION STILL REFUSES IN PRE MODE, and that matters more here rather than less: the
  // answer would be `latest` for the right reason and by accident.
  assert.throws(() => distTag("v0.1.1", { preMode: true }), /not a version this can read/);

  // THE GITHUB RELEASE'S FLAG COMES FROM THE VERSION, never from the channel. In pre mode the channel is
  // `latest` for a version that is very much a pre-release, and deriving the flag from the channel would
  // mark it stable on the releases page.
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
  const executable = workflow.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  assert.ok(!/DIST_TAG" != "latest"/.test(executable),
    "the GitHub release's prerelease flag is derived from the CHANNEL again, so a beta on `latest` goes "
    + "up as the stable release");
  assert.match(workflow, /PRERELEASE_FLAG" = "true"/, "the flag the step computed is not the one it reads");

  // The member that broke: channel and flag disagreeing, which only happens in pre mode.
  assert.equal(distTag("0.1.1-beta.0", { preMode: true }), STABLE);
  assert.equal(isPrerelease("0.1.1-beta.0"), true);
  assert.notEqual(isPrerelease("0.1.1-beta.0"), distTag("0.1.1-beta.0", { preMode: true }) !== STABLE);
  assert.equal(isPrerelease("0.1.1"), false);

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
    ["the branch", /refs\/heads\/main\|refs\/tags\/v\*/],
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

  // THE POLICY IS READ, NOT REMEMBERED. It was changed three times on 2026-09-05 — all external
  // contributors, then first-time contributors, then first-time contributors new to GitHub — and the bot
  // parked under two of them. A guard naming a stale value sends the next reader to check a setting that
  // has already moved, which is worse than naming none.
  assert.match(checksVerdict({ ...parkedAlone_input, policy: "first_time_contributors_new_to_github" }).reason,
    /currently `first_time_contributors_new_to_github`/);
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
  const versionJob = workflow.slice(workflow.indexOf("  version:"), workflow.indexOf("  publish:"));
  for (const scope of ["checks: read", "actions: read", "administration: read"]) {
    assert.ok(versionJob.includes(scope),
      `the version job does not grant \`${scope}\`, so the step that reads whether its checks started `
      + "gets a 403 — and naming any permission sets every unnamed one to `none`");
  }
  // THE AUTO-MERGE WRITES ITS OWN MESSAGE. Left to GitHub's default, the squash headline gains `(#23)` —
  // the bare `#NNN` this project bans from commit messages, put into public history by our own
  // automation. Measured on the first version pull request that merged itself.
  const merge = workflow.slice(workflow.indexOf("gh pr merge"), workflow.indexOf("The checks it waits for"));
  assert.match(merge, /--subject "Release \$VERSION"/,
    "the auto-merge takes GitHub's default headline, which appends `(#N)` to it");
  assert.match(merge, /--body "\$NOTES"/, "the auto-merge leaves the body to GitHub, which composes it from the pull request");
  assert.ok(!/\(#\$?\{?\w*\}?\)/.test(merge), "a `(#N)` shape appeared in the message the workflow writes");

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
  const branchCase = lines.findIndex((l) => /refs\/heads\/main\|refs\/tags\/v\*/.test(l));
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
      "# prelim-driver\n\n## 0.1.1-beta.0\n\n- f7c1570: Fixed: The demo offers the two example accounts it ships with.\n"
      + "- 0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b: Fixed: A clearance now names the registers it searched.\n");
    const { groups } = assembleRoot("0.1.1-beta.0", dir);
    assert.deepEqual(groups.Fixed, [
      "The demo offers the two example accounts it ships with.",
      "A clearance now names the registers it searched.",
    ]);
    // A sentence that merely CONTAINS a colon keeps every word of itself.
    writeFileSync(join(dir, "driver", "CHANGELOG.md"),
      "# prelim-driver\n\n## 0.2.0\n\n- Fixed: Removing the demo is one directory again: nothing it writes lands outside it.\n");
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
  // AND IT SAYS IT IS UNPROVEN. As of 2026-09-05 this schedule has never fired on this repository, and a
  // reader who assumes it works will design around a recovery that has never happened. When somebody
  // sees a `schedule` run publish, they delete this sentence — and this arm tells them it is theirs to
  // delete rather than leaving a stale warning in the file for ever.
  assert.match(workflow, /NEVER FIRED ON THIS REPOSITORY/,
    "the workflow no longer records that its cron is unproven — if that is because it has now fired, say "
    + "so with the run, and remove this assertion in the same change");

  // The reason has to travel WITH it, or the next reader deletes a cron that looks like polling for
  // nothing. This asserts the explanation is present, not merely the trigger.
  assert.match(workflow, /GITHUB_TOKEN`? — a push made with that token starts\s*\n?\s*#?\s*NO workflow run/,
    "the cron no longer says why it exists, so the next reader will simplify it away");

  const jobs = releaseJobs(workflow);
  assert.deepEqual(jobs, ["version", "pending", "publish"],
    "the release workflow's jobs are not the three this file is written about");

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
  const dryLines = gate.split("\n").filter((l) => !/^\s*#/.test(l) && /dry_flag=--dry-run/.test(l));
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
  const executable = workflow.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

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
  assert.equal((executable.match(/steps\.changesets\.outputs\.pr-number/g) ?? []).length, 4,
    "the renamed output is not read at every site that gated on the old one");

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
