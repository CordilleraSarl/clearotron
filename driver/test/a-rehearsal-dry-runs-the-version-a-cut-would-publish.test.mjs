// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A rehearsal dry-runs the version a cut would publish, not the one already out.
//
// Measured 2026-09-23 on 0.3.3: a `cut: rehearse` dispatch on main packed main's version and ran `npm
// publish --dry-run` on it. npm checks the registry even on a dry run, the version was already out, and the
// run went red with nothing wrong. It could pass only between a cut and its publish, when nobody rehearses.
//
// A rehearsal now stamps its checkout the way a `cut: beta` dispatch does and dry-runs that version. With no
// note pending there is nothing to cut, so it skips only the publish dry run and says so. This file drives
// the script against stand-in version scripts, and the workflow's own step, lifted from both publishing
// jobs, down each path, including a real cut, which must not be touched by any of it.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { rehearsalPlan } from "../../scripts/release-rehearsal-version.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKFLOW = readFileSync(join(ROOT, ".github", "workflows", "release.yml"), "utf8");
const DIR = mkdtempSync(join(tmpdir(), "rehearsal-version-test-"));
after(() => rmSync(DIR, { recursive: true, force: true }));

const MAIN_VERSION = "9.9.9-beta.3";
const NEXT_BETA = "9.9.9-beta.4";

/**
 * A tree of its own holding the real script and the real note counter, main's package.json, `notes`
 * pending release notes, and a stand-in version script that stamps NEXT_BETA or refuses.
 */
function tree({ notes, versionScript = "stamps" }) {
  const dir = mkdtempSync(join(DIR, "tree-"));
  for (const d of ["scripts", "shared", ".changeset"]) mkdirSync(join(dir, d));
  copyFileSync(join(ROOT, "scripts", "release-rehearsal-version.mjs"), join(dir, "scripts", "release-rehearsal-version.mjs"));
  copyFileSync(join(ROOT, "scripts", "release-pre-gate.mjs"), join(dir, "scripts", "release-pre-gate.mjs"));
  copyFileSync(join(ROOT, "shared", "is-entrypoint.mjs"), join(dir, "shared", "is-entrypoint.mjs"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "clearotron", version: MAIN_VERSION }));
  writeFileSync(join(dir, ".changeset", "README.md"), "the contract, not a note\n");
  for (let i = 0; i < notes; i++) writeFileSync(join(dir, ".changeset", `note-${i}.md`), "---\n\"clearotron-driver\": patch\n---\n\nFixed: a thing.\n");
  const called = join(dir, "version-script.called");
  writeFileSync(join(dir, "scripts", "release-version.mjs"),
    `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(called)}, process.argv.slice(2).join(" "));\n`
    + (versionScript === "stamps"
      ? `writeFileSync(${JSON.stringify(join(dir, "package.json"))}, JSON.stringify({ name: "clearotron", version: ${JSON.stringify(NEXT_BETA)} }));\nconsole.log("stamped");\n`
      : `console.error("release-version: this cut computed a version that is already out.");\nprocess.exit(1);\n`));
  return { dir, called };
}

function runScript(t) {
  const r = spawnSync(process.execPath, [join(t.dir, "scripts", "release-rehearsal-version.mjs")], { cwd: t.dir, encoding: "utf8" });
  const version = JSON.parse(readFileSync(join(t.dir, "package.json"), "utf8")).version;
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, version, calledWith: existsSync(t.called) ? readFileSync(t.called, "utf8") : null };
}

// ── THE SCRIPT ─────────────────────────────────────────────────────────────────────────────────────

test("the plan: pending notes stamp the next beta, none means nothing to cut, and a count it cannot read is not a plan", () => {
  assert.deepEqual(rehearsalPlan({ pendingNotes: 3 }), { action: "stamp-next-beta" });
  assert.deepEqual(rehearsalPlan({ pendingNotes: 0 }), { action: "nothing-to-cut" });
  for (const pendingNotes of [undefined, null, -1, 1.5, NaN]) {
    assert.deepEqual(rehearsalPlan({ pendingNotes }), { action: "could-not-look" }, `${pendingNotes} was read as a count`);
  }
});

test("with notes pending it stamps the version a beta cut would publish, and prints only the one output line", () => {
  const r = runScript(tree({ notes: 2 }));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "publish_dry_run=true\n", "stdout carries more than the line the workflow appends to its outputs");
  assert.equal(r.calledWith, "--cut=beta", "the version script was not asked for the beta cut a dispatch makes");
  assert.equal(r.version, NEXT_BETA, "the checkout still names the version already out");
});

test("with no note pending there is nothing to cut: main's version stays, and the dry run is off", () => {
  const r = runScript(tree({ notes: 0 }));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "publish_dry_run=false\n");
  assert.equal(r.calledWith, null, "the version script ran with nothing to cut, and a real cut would have refused");
  assert.equal(r.version, MAIN_VERSION);
  assert.match(r.stderr, /nothing to cut/);
});

test("a pending note that still cannot be cut fails the rehearsal, as it would fail the cut", () => {
  const r = runScript(tree({ notes: 1, versionScript: "refuses" }));
  assert.equal(r.status, 1, r.stderr);
  assert.equal(r.stdout, "", "a refused rehearsal still told the workflow what to publish");
  assert.match(r.stderr, /already out/, "the version script's own refusal is not in the log");
});

// ── THE WORKFLOW'S STEP, IN BOTH PUBLISHING JOBS ───────────────────────────────────────────────────

function job(name) {
  const start = WORKFLOW.indexOf(`\n  ${name}:\n`);
  assert.ok(start > 0, `the release workflow has no \`${name}\` job`);
  const rest = WORKFLOW.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][a-z-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

/** The `run:` block of one named step, dedented back to a script. */
function stepScript(jobText, stepName) {
  const at = jobText.indexOf(`- name: ${stepName}`);
  assert.ok(at >= 0, `no step called "${stepName}" — this arm could not look, which is not a pass`);
  const rest = jobText.slice(at);
  const runAt = rest.indexOf("        run: |\n");
  assert.ok(runAt >= 0, "the step has no run block — this arm could not look");
  const body = [];
  for (const line of rest.slice(runAt + "        run: |\n".length).split("\n")) {
    if (line.trim() === "") { body.push(""); continue; }
    if (!line.startsWith("          ")) break;
    body.push(line.slice(10));
  }
  return body.join("\n").trimEnd();
}

/** Run the lifted step with the event, the cut and the ref filled in, against stand-in scripts. */
function driveWhatStep(script, { event, cut, ref = "refs/heads/main", plan }) {
  const filled = script.replaceAll("${{ github.event_name }}", event).replaceAll("${{ inputs.cut }}", cut).replaceAll("${{ github.ref }}", ref);
  assert.ok(!filled.includes("${{"), `the step reads an expression this arm does not fill: ${filled.match(/\$\{\{[^}]*\}\}/)?.[0]}`);
  const dir = mkdtempSync(join(DIR, "step-"));
  mkdirSync(join(dir, "scripts"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "clearotron", version: MAIN_VERSION }));
  const called = join(dir, "rehearsal.called");
  writeFileSync(join(dir, "scripts", "release-rehearsal-version.mjs"),
    `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(called)}, "yes");\n`
    + (plan === "stamp" ? `writeFileSync("package.json", JSON.stringify({ name: "clearotron", version: ${JSON.stringify(NEXT_BETA)} }));\nconsole.log("publish_dry_run=true");\n`
      : plan === "nothing" ? `console.log("publish_dry_run=false");\n`
      : plan === "stray" ? `console.log("publish_dry_run=true");\nconsole.log("dry_flag=");\n` : `process.exit(1);\n`));
  writeFileSync(join(dir, "scripts", "release-dist-tag.mjs"), `console.log(process.argv.includes("--prerelease") ? "true" : "beta");\n`);
  writeFileSync(join(dir, "step.sh"), filled);
  const out = join(dir, "github-output");
  writeFileSync(out, "");
  const r = spawnSync("bash", [join(dir, "step.sh")], { cwd: dir, encoding: "utf8", env: { PATH: process.env.PATH, GITHUB_OUTPUT: out, HOME: dir } });
  const outputs = Object.fromEntries(readFileSync(out, "utf8").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  return { status: r.status, log: `${r.stdout}${r.stderr}`, outputs, rehearsalRan: existsSync(called) };
}

const PUBLISHING = ["publish", "publish-awaited"].map((name) => [name, job(name)]);
const WHAT = "What is being published, and whether this run may publish it";

test("a rehearsal with notes pending dry-runs the next beta, in each publishing job", () => {
  for (const [name, text] of PUBLISHING) {
    const r = driveWhatStep(stepScript(text, WHAT), { event: "workflow_dispatch", cut: "rehearse", plan: "stamp" });
    assert.equal(r.status, 0, `${name}\n${r.log}`);
    assert.equal(r.outputs.version, NEXT_BETA, `${name}: the rehearsal still packs the version already out`);
    assert.equal(r.outputs.tarball, `release-artefacts/clearotron-${NEXT_BETA}.tgz`, `${name}: the tarball is named for another version`);
    assert.equal(r.outputs.dry_flag, "--dry-run", `${name}: a rehearsal lost its dry-run flag`);
    assert.equal(r.outputs.publish_dry_run, "true", name);
  }
});

test("a rehearsal with nothing to cut keeps main's version, turns the dry run off, and says why", () => {
  for (const [name, text] of PUBLISHING) {
    const r = driveWhatStep(stepScript(text, WHAT), { event: "workflow_dispatch", cut: "rehearse", plan: "nothing" });
    assert.equal(r.status, 0, `${name}\n${r.log}`);
    assert.equal(r.outputs.version, MAIN_VERSION, name);
    assert.equal(r.outputs.dry_flag, "--dry-run", name);
    assert.equal(r.outputs.publish_dry_run, "false", name);
    assert.match(r.log, /::notice::Nothing to cut/, `${name}: the skipped dry run is not announced`);
  }
});

test("a rehearsal whose version script refuses fails the step", () => {
  for (const [name, text] of PUBLISHING) {
    const r = driveWhatStep(stepScript(text, WHAT), { event: "workflow_dispatch", cut: "rehearse", plan: "refuses" });
    assert.notEqual(r.status, 0, `${name}: a refused rehearsal went on to pack\n${r.log}`);
  }
});

test("an answer in any other shape is refused whole, so a stray line cannot become an output of the step", () => {
  for (const [name, text] of PUBLISHING) {
    const r = driveWhatStep(stepScript(text, WHAT), { event: "workflow_dispatch", cut: "rehearse", plan: "stray" });
    assert.notEqual(r.status, 0, `${name}: a two-line answer was accepted\n${r.log}`);
    assert.equal(r.outputs.publish_dry_run, undefined, `${name}: part of a malformed answer was kept`);
    assert.equal(r.outputs.dry_flag, "--dry-run", `${name}: a stray line overwrote the dry-run flag`);
    assert.match(r.log, /::error::The rehearsal's version script did not answer/, name);
  }
});

test("a real cut never runs the rehearsal script and never sets the output that could skip its publish", () => {
  for (const [name, text] of PUBLISHING) {
    for (const [event, cut] of [["workflow_dispatch", "beta"], ["schedule", ""], ["push", ""]]) {
      const r = driveWhatStep(stepScript(text, WHAT), { event, cut, plan: "nothing" });
      assert.equal(r.status, 0, `${name} ${event}\n${r.log}`);
      assert.equal(r.rehearsalRan, false, `${name} ${event}: a real publish stamped a rehearsal version`);
      assert.equal(r.outputs.publish_dry_run, undefined, `${name} ${event}: a real publish carries publish_dry_run`);
      assert.equal(r.outputs.dry_flag, "", `${name} ${event}`);
      assert.equal(r.outputs.version, MAIN_VERSION, `${name} ${event}`);
    }
  }
});

test("the publish step is skipped only by that output, and nothing else in the workflow writes it", () => {
  for (const [name, text] of PUBLISHING) {
    const step = text.slice(text.indexOf("- name: Publish to npm through Trusted Publishing"));
    const head = step.slice(0, step.indexOf("\n        run: "));
    assert.match(head, /\n {8}if: steps\.what\.outputs\.publish_dry_run != 'false'$/, `${name}: the publish step's condition is not the rehearsal's alone`);
  }
  const writers = WORKFLOW.split("\n").filter((l) => !l.trim().startsWith("#") && /publish_dry_run/.test(l));
  const perJob = [
    'publish_dry_run=true|publish_dry_run=false) echo "$PLAN" >> "$GITHUB_OUTPUT" ;;',
    '*) echo "::error::The rehearsal\'s version script did not answer publish_dry_run=true or publish_dry_run=false, so nothing it printed is kept."; exit 1 ;;',
    'if [ "$PLAN" = "publish_dry_run=false" ]; then',
    "if: steps.what.outputs.publish_dry_run != 'false'",
  ];
  assert.deepEqual(writers.map((l) => l.trim()), [...perJob, ...perJob],
    "publish_dry_run is read or written somewhere other than the rehearsal branch and the publish step");
});
