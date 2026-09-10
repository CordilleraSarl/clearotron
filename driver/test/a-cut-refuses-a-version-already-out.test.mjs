// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A CUT REFUSES A VERSION THAT IS ALREADY OUT, before it stamps anything. The pre-release line keeps no
// record of its last number, so after a stable release a beta cut counts again from package.json and can
// compute a version that is already tagged and published. Measured 2026-09-10 on a tree at 0.2.4, which
// computed 0.3.0-beta.0. The decision is driven here over a table; the one call that makes it is pinned.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { alreadyOut, registryHas } from "../../scripts/release-version.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("a version tagged here, or on the registry, is out; one that is neither is new", () => {
  const tags = ["v0.2.4", "v0.3.0-beta.0", "v0.3.0-beta.1"];
  assert.deepEqual(alreadyOut({ version: "0.3.0-beta.2", tags, published: false }), [], "the next beta is new");
  assert.deepEqual(alreadyOut({ version: "0.3.0-beta.0", tags, published: true }),
    ["tagged here as v0.3.0-beta.0", "published on the registry"]);
  assert.deepEqual(alreadyOut({ version: "0.3.0-beta.3", tags, published: true }), ["published on the registry"],
    "published and never tagged is still out");
  assert.deepEqual(alreadyOut({ version: "0.3.0-beta.1", tags, published: false }), ["tagged here as v0.3.0-beta.1"],
    "tagged and not yet published is still out");
});

test("the registry's answer: its version is yes, E404 is no, and any other failure is a failure to look", () => {
  const err = (stderr) => Object.assign(new Error("Command failed: npm view"), { stderr });
  assert.equal(registryHas("clearotron", "0.3.0-beta.1", { run: () => "0.3.0-beta.1\n" }), true);
  assert.equal(registryHas("clearotron", "0.3.0-beta.2", {
    run: () => { throw err("npm error code E404\nnpm error 404 No match found for version 0.3.0-beta.2\n"); } }), false);
  assert.equal(registryHas("clearotron", "0.3.0-beta.2", { run: () => "" }), false, "an empty answer names no version");
  assert.equal(registryHas("clearotron", "0.3.0-beta.2", {
    run: () => { throw err("npm error code ENOTFOUND\nnpm error request to https://registry.npmjs.org failed\n"); } }), null,
    "a network failure is a failure to look, never a no");
  let asked;
  registryHas("clearotron", "0.3.0-beta.2", { run: (a) => { asked = a; return ""; } });
  assert.deepEqual(asked, ["view", "clearotron@0.3.0-beta.2", "version"], "it asks for the exact version, not a range");
});

test("the version step asks before the root version is stamped, and a failure to look is a refusal", () => {
  const src = readFileSync(join(ROOT, "scripts", "release-version.mjs"), "utf8");
  const main = src.slice(src.indexOf("function main()"));
  const computed = main.indexOf("const version = groupVersion();");
  const asked = main.indexOf("alreadyOut({ version, tags, published })");
  const firstWrite = main.indexOf("writeFileSync(pkgPath");
  assert.ok(computed > 0 && asked > computed && firstWrite > asked,
    "the check must sit between computing the version and the first thing the step writes");
  assert.match(main, /if \(!tags\.length\)[\s\S]{0,300}process\.exitCode = 2/, "a checkout with no tags must refuse");
  assert.match(main, /if \(published === null\)[\s\S]{0,300}process\.exitCode = 2/, "an unanswered registry must refuse");
});

test("the job that runs the version step fetches the tags the check reads", () => {
  const wf = readFileSync(join(ROOT, ".github", "workflows", "release.yml"), "utf8");
  const at = wf.indexOf("version-script: node scripts/release-version.mjs");
  const job = wf.lastIndexOf("\n  version:", at);
  assert.ok(at > 0 && job > 0, "the version step, or the job it sits in, has moved");
  assert.match(wf.slice(job, at), /fetch-depth: 0/, "that job's checkout brings no tags, so every number would read as new");
});
