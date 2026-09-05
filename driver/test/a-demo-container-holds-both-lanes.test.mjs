// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE FRONT DOOR OPENS BOTH LANES.
//
// `demo/` holds one frozen run per product, and the two lanes leave DIFFERENT files behind: a clearance
// run writes `run/report.md`, a knockout run never does — for that lane the markdown is an output of
// publishing rather than an input to it, and `run/knockout-findings.json` is what the publisher reads.
//
// `bin/example.mjs` demanded report.md of every child. `demo/knockout-search` therefore shipped in the git
// tree and in the npm tarball — all sixteen files, including the research payloads its receipts door reads
// — and could not be listed, selected or defaulted to; `--product knockout-search` exited 1 naming only the
// other three, in a sentence byte-identical to the one a typo gets. The pack gate had learned the shape a
// week earlier by refusing; the player had not, one stage later, in a second file.
//
// So this arm is about the CLASS and not the predicate: whatever decides "is this child a demo" must give
// the same answer for both lanes, and the answer must survive all the way to a rendered report.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ENTRY_FILES, entryFile, isFrozen, demoChildren } from "../demo-container.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const PLAYER = join(REPO, "bin", "example.mjs");
const DEMO = join(REPO, "demo");

/**
 * A container built by hand, holding one child of each lane plus two near-misses.
 *
 * THE PLANTS ARE NOT THE DEMOS IN THE TREE. The knockout demo this fix was developed against is one
 * member of the class; an arm that re-confirms it proves the predicate matches that directory, not that
 * it matches the lane. So the knockout planted here is a different member — a different product id, a
 * different mark, findings this repository has never published — and it carries NO report.md, which is
 * the whole property under test.
 */
function plantContainer() {
  const root = mkdtempSync(join(tmpdir(), "demo-container-"));
  const child = (name, files) => {
    mkdirSync(join(root, name, "run"), { recursive: true });
    for (const [f, body] of Object.entries(files)) writeFileSync(join(root, name, f), body);
  };
  child("planted-knockout", {
    "meta.json": JSON.stringify({ runId: "tmp8814-planted-knockout", template: "knockout" }),
    "run/knockout-findings.json": JSON.stringify({ schema_version: 1, marks: [] }),
  });
  child("planted-clearance", {
    "meta.json": JSON.stringify({ runId: "tmp8814-planted-clearance" }),
    "run/report.md": "---\ntype: prelim-clearance\n---\n\n# Marks\n",
  });
  // A run with neither entry file, and a manifest-less directory that has one. Both are the shapes an
  // existsSync on the container alone waves through, and neither is openable.
  child("planted-no-entry", { "meta.json": JSON.stringify({ runId: "tmp8814-planted-empty" }) });
  child("planted-no-manifest", { "run/report.md": "---\n---\n\n# Marks\n" });
  return root;
}

test("2193 both lanes list: the container rule accepts a knockout child with no report.md", () => {
  const root = plantContainer();
  try {
    // THE PLANT IS ASSERTED BEFORE IT IS TRUSTED. A knockout child that accidentally carried a report.md
    // would make every assertion below pass while testing the clearance rule twice.
    assert.equal(existsSync(join(root, "planted-knockout", "run", "report.md")), false,
      "the planted knockout must carry NO report.md — that is the property under test");
    assert.equal(entryFile(join(root, "planted-knockout")), "knockout-findings.json");
    assert.equal(entryFile(join(root, "planted-clearance")), "report.md");

    assert.deepEqual(demoChildren(root), ["planted-clearance", "planted-knockout"],
      "both lanes must list, and the two near-misses must not");

    assert.equal(isFrozen(join(root, "planted-no-entry")), false, "a manifest with no entry file is not a demo");
    assert.equal(isFrozen(join(root, "planted-no-manifest")), false, "an entry file with no manifest is not a demo");
    assert.equal(entryFile(join(root, "planted-no-entry")), null, "absent must answer null, never undefined-as-truthy");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("2193 the player uses the shared rule — the roster it prints is demoChildren's, not a second copy", () => {
  // The defect was one predicate existing in more than one place. An arm that only tested the module
  // would have been green through it, so this one pins the player to the module by its OUTPUT: the
  // refusal path prints the roster, and it must be exactly what the module says the container holds.
  const src = readFileSync(PLAYER, "utf8");
  assert.match(src, /from "\.\.\/driver\/demo-container\.mjs"/,
    "bin/example.mjs must import the rule rather than restate it");
  assert.doesNotMatch(src, /existsSync\(join\([^)]*"run", "report\.md"\)\)/,
    "no second copy of the entry-file rule may live in the player");

  let out = "";
  try {
    execFileSync(process.execPath, [PLAYER, "--once", "--product", "no-such-product-2193"],
      { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    assert.fail("the player must refuse an unknown product");
  } catch (e) { out = `${e.stdout ?? ""}${e.stderr ?? ""}`; assert.equal(e.status, 1); }

  const listed = /Products with a demo in this tree: (.+)/.exec(out);
  assert.ok(listed, `the refusal must name what the tree actually has — got:\n${out}`);
  assert.deepEqual(listed[1].trim().split(", "), demoChildren(DEMO),
    "the printed roster must be the shared rule's answer over the shipped container");
});

test("2193 both lanes render: every child the container lists replays to a report", () => {
  const children = demoChildren(DEMO);
  assert.ok(children.includes("knockout-search"),
    "the shipped container must list the knockout demo — it is one of the four the owner ruled");
  assert.equal(entryFile(join(DEMO, "knockout-search")), "knockout-findings.json",
    "and it must be listed BY THE KNOCKOUT RULE, not because someone added a report.md to it");

  // EACH CHILD IS COPIED AND DRIVEN AT THE COPY, and that is not squeamishness about the repo.
  // publish/knockout.mjs writes a `predelivery-lint.json` receipt back into the RUN DIRECTORY on every
  // publish — deliberately, and it says so in its own comment: the write records that this publish
  // happened, and where the run store is read-only it simply does not land. For an archived run that is
  // right. For a frozen demo living in the source tree it means republishing mutates a tracked file, so
  // an arm that drove `--product knockout-search` in place would leave `git status` dirty after every
  // suite run and eventually get that churn committed by someone in a hurry. It already did once here.
  //
  // The copy is byte-for-byte, so this still renders the real shipped artifact rather than a fixture —
  // which is the whole point of driving it — and the receipt lands in the temp copy where it belongs.
  const work = mkdtempSync(join(tmpdir(), "demo-render-"));
  try {
    for (const id of children) {
      const src = join(DEMO, id);
      const copy = join(work, id);
      cpSync(src, copy, { recursive: true });
      const out = execFileSync(process.execPath,
        [PLAYER, "--once", "--run-dir", copy, "--pool", join(work, "pool", id)],
        { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      const m = /report: (\S+report\.html)/.exec(out);
      assert.ok(m, `${id}: the player must name the report it published — got:\n${out}`);
      assert.ok(existsSync(m[1]), `${id}: the named report must exist on disk`);
      assert.ok(readFileSync(m[1], "utf8").length > 1000, `${id}: the report must have a body`);
      // A COUNT, OR A NAMED ABSENCE — never a bare "?". The two lanes report different metrics and this
      // line used to print the clearance one's placeholder at the knockout.
      assert.doesNotMatch(out, /\(\? finding/, `${id}: the summary must not print an unanswered "?"`);
    }
  } finally { rmSync(work, { recursive: true, force: true }); }
});

test("2193 the entry-file table is the disjunction the pack gate restates", () => {
  // cut/ does not travel, so it cannot import this module and this test cannot import cut/. The two are
  // held together by their shared content instead: if a lane is added here, the gate's copy is the next
  // thing to change, and this assertion is where that is written down.
  assert.deepEqual([...ENTRY_FILES], ["report.md", "knockout-findings.json"],
    "adding a lane means updating cut/packed-artifact.mjs's demoIn and scripts/pack-publishable.mjs's refusal message too");
});
