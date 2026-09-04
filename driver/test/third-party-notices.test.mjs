// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — resolves the whole production tree through npm
//
// — THE ATTRIBUTIONS FILE CANNOT DRIFT FROM THE TREE IT DESCRIBES.
//
// MIT, BSD and ISC all oblige a distributor to reproduce the copyright and permission notice. A
// hand-maintained list meets that obligation until the first dependency moves, and then stops meeting
// it with nothing saying so — the failure is silent, which is the only kind worth a guard.
//
// The check lives HERE rather than in a CI step of its own, deliberately: enforcement that has to be
// remembered when someone edits a workflow is enforcement that eventually lives nowhere (,).
// A test runs on every tier that runs tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";
import {
  collect, render, OUTPUT, npmTree, undeclaredProblems, staleDeclarations, overbroadDeclarations, DECLARED_LS_PROBLEMS,
} from "../../scripts/third-party-notices.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// ONE `npm ls` for the whole file, and collect() called INSIDE the arms rather than here. A throw at
// module top level takes the whole FILE — which is exactly how presented: TAP printed the filename,
// no reason, and every licence arm went with it. Memoised, so it still resolves the tree once.
const tree = npmTree(ROOT);
let collected = null;
const rows = () => (collected ??= collect(ROOT, tree));

test("#854 THIRD-PARTY-NOTICES.md is exactly what the installed production tree generates", () => {
  assert.ok(existsSync(OUTPUT), "THIRD-PARTY-NOTICES.md is gone — the licence obligations it carried "
    + "are unmet and nothing else records them");
  assert.equal(readFileSync(OUTPUT, "utf8"), render(rows()),
    "the attributions file no longer matches the production tree — regenerate it with "
    + "`node scripts/third-party-notices.mjs`");
});

test("#854 no production dependency ships without a licence — the state #854 was filed about", () => {
  // `buffers@0.1.1` was exactly this: no `license` field, no LICENSE file, all rights reserved by
  // default, four levels down a chain nobody reads. It is ours now, and this is what stops the next one
  // arriving unnoticed.
  const unlicensed = rows().filter((r) => r.installed && !r.licence);
  assert.deepEqual(unlicensed.map((r) => `${r.name}@${r.version}`), [],
    "a production dependency declares no licence. Unlicensed is not permissive — it is all rights "
    + "reserved by default, against a repository that ships AGPL-3.0-only");
});

test("#854 our own workspaces are not credited to us as third parties", () => {
  // The first run of the generator listed two of them, because their names were guessed rather than
  // read: it looked for `trademark-mcp-server` and `oauth-mcp-bridge`, and the real names are
  // `trademark-artifacts-mcp` and `trademark-oauth-mcp-bridge`. Nothing failed; the file was just wrong.
  const rootPkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const ours = new Set([rootPkg.name, "buffers"]);
  for (const w of rootPkg.workspaces ?? [])
    ours.add(JSON.parse(readFileSync(join(ROOT, w, "package.json"), "utf8")).name);
  const listed = rows().filter((r) => ours.has(r.name)).map((r) => r.name);
  assert.deepEqual(listed, [], "a package of ours is listed as a third-party attribution");
  assert.ok(ours.size >= 5, `only ${ours.size} names resolved as ours — the workspace list did not read`);
});

test("#854 a package with no licence TEXT is recorded, not skipped", () => {
  // The interesting half of this file is what it admits. A generator that quietly omitted the packages
  // it could not fully attribute would read as complete coverage.
  const noText = rows().filter((r) => r.installed && r.licence && !r.text);
  const doc = readFileSync(OUTPUT, "utf8");
  for (const r of noText)
    assert.ok(doc.includes(`${r.name}@${r.version}`),
      `${r.name} declares ${r.licence} and ships no licence file, and the notices file does not say so`);
  // And the not-installed case, which is derived rather than listed by hand.
  for (const r of rows().filter((x) => !x.installed))
    assert.match(doc, new RegExp(`NOT INSTALLED[\\s\\S]{0,400}${r.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
      `${r.name} is declared but not installed, and the notices file does not record it`);
});

// ── A NON-ZERO `npm ls` THAT STILL PRODUCED THE TREE ────────────────────────────────────────────────
//
// `npm ls` exits non-zero for ANY tree problem (`ELSPROBLEMS`), and an INVALID resolution is one. It
// still writes the complete tree to stdout — only the status is unhappy — but `execFileSync` throws on
// the status, so this file used to die before comparing anything.
//
// It took two changes and a COLD install to appear, which is why neither PR's own CI caught it:
// pinned `uuid` to ^11.1.1 through `overrides` while `exceljs` declares ^8.3.2, and promoted
// exceljs to a production dependency so `--omit=dev` finally walked it. On a warm cache the tree still
// held uuid 8.3.2 and npm exited 0.
//
//     npm error code ELSPROBLEMS
//     npm error invalid: uuid@11.1.1 …/node_modules/uuid
//
// That state is DELIBERATE here — the override is the point of — and it must not take the
// attributions file down with it. The licence obligation does not depend on every range being
// satisfiable. `npmTree` is imported at the head of this file with the rest of the module's exports.

test("#854 a non-zero `npm ls` that still emitted the tree is READ, not treated as failure", () => {
  const TREE = JSON.stringify({ name: "root", dependencies: { exceljs: { version: "4.4.0" } } });
  const elsproblems = () => {
    const e = new Error("Command failed: npm ls --omit=dev --all --json");
    e.status = 1; e.stdout = TREE;
    throw e;
  };
  assert.deepEqual(npmTree("/nonexistent", elsproblems).dependencies, { exceljs: { version: "4.4.0" } });
});

test("#854 it does NOT swallow a real npm failure — three ways, all rethrown", () => {
  // THE BUG THE OBVIOUS FIX WOULD HAVE INTRODUCED. A bare try/catch returning `{}` turns npm falling
  // over into an EMPTY production tree, and an empty tree generates an attributions file naming nobody
  // — which reads as a clean bill of health and satisfies no licence at all.
  const shapes = {
    "empty stdout": Object.assign(new Error("npm not found"), { status: 127, stdout: "" }),
    "unparseable stdout": Object.assign(new Error("Command failed"), { status: 1, stdout: "not json" }),
    "parses but carries no tree": Object.assign(new Error("Command failed"), { status: 1, stdout: '{"error":"x"}' }),
  };
  for (const [label, err] of Object.entries(shapes)) {
    assert.throws(() => npmTree("/nonexistent", () => { throw err; }), /npm|Command failed/, `${label} must rethrow`);
  }
});

// ── — DECLARED, NOT TOLERATED, AND CHECKED BOTH WAYS ───────────────────────────────────────────
//
// npmTree above reads a tree npm was unhappy about. That is right, and on its own it accepts any problem
// whose tree parses — including a package that failed to install. These arms are the other half: the
// problems we accept are named, anything else fails, and a name that stops matching fails too.
//
// The pure arms drive an INJECTED table and assert LITERALS. An earlier draft compared
// `staleDeclarations([])` against `DECLARED_LS_PROBLEMS.map(…)`; empty the real table and both sides
// become `[]` and the arm goes green over nothing. Two exports of one module agreeing with each other is
// not a test of either.
const FIXTURE_DECLARED = [{ match: /^invalid: uuid@/, reason: "fixture" }];

test("#1764 a problem nothing declares is a failure, not a tolerated line", () => {
  const planted = ["invalid: uuid@11.1.1 /x/node_modules/uuid", "missing: left-pad@1.3.0, required by x"];
  assert.deepEqual(undeclaredProblems(planted, FIXTURE_DECLARED), ["missing: left-pad@1.3.0, required by x"],
    "the declared problem must pass and the undeclared one must not — a filter returning both or neither "
    + "is not reading the declarations");
  assert.deepEqual(undeclaredProblems([], FIXTURE_DECLARED), [], "no problems is not a problem");
  assert.deepEqual(undeclaredProblems(null, FIXTURE_DECLARED), [],
    "npm omits `problems` entirely on a clean tree; absent must read as none, not throw");
});

test("#1764 a declaration that matches nothing npm reports is stale and says so", () => {
  assert.deepEqual(staleDeclarations(["invalid: uuid@11.1.1 /x"], FIXTURE_DECLARED), [],
    "the declaration matches, so nothing is stale");
  assert.deepEqual(staleDeclarations([], FIXTURE_DECLARED), ["^invalid: uuid@"],
    "with npm reporting nothing, the declaration is excusing a condition that has ended");
  assert.deepEqual(staleDeclarations(["missing: left-pad@1.3.0"], FIXTURE_DECLARED), ["^invalid: uuid@"],
    "npm reporting a DIFFERENT problem leaves this declaration matching nothing — still stale");
});

test("#1764 the shipped table is not empty — the live arms below need something to check", () => {
  assert.ok(DECLARED_LS_PROBLEMS.length > 0,
    "DECLARED_LS_PROBLEMS is empty, so the live arms below assert over no declarations at all");
});

test("#1764 every declaration still describes THIS tree — the excuse cannot outlive its condition", () => {
  assert.deepEqual(staleDeclarations(tree.problems), [],
    "a declared npm-ls problem no longer occurs. That is good news, and it must not be found by someone "
    + "reading this file in a year: delete the declaration in scripts/third-party-notices.mjs.");
  assert.deepEqual(undeclaredProblems(tree.problems), [],
    "npm reports a problem with the production tree that nothing declares");
});

test("#1764 the row set is never empty — an attributions file over nothing is not compliance", () => {
  assert.ok(rows().length > 0,
    "collect() returned no rows, so the licence arms above assert over an empty set and pass");
});

// ── — THE THIRD DIRECTION: DOES THE DECLARATION STILL APPLY *NARROWLY*? ───────────────────────
//
// Measured by scruffy, 2026-08-23: widening this file's shipped matcher from `/^invalid: uuid@/` to
// `/^invalid:/` leaves this suite at 11 pass / 0 fail. Not stale — it still matches what npm reports.
// Not empty — the table has an entry. And now silently accepting every future invalid resolution in the
// tree, which is exactly what a named exception is supposed to prevent.
//
// Both existing directions check that the exception still APPLIES. Neither checks that it still applies
// NARROWLY, and overwatch ruled the answer once for both homes it appeared in: a declaration carries a
// NEAR-MISS — a canonical instance one step broader than what it was written for — asserted NOT to match.
//
// THE CONTROL IS A FIELD, NOT AN ARM. A hand-written case covers the entry that existed when it was
// typed; the next declaration is added without one and nothing says so. The guard walks the table, so an
// entry with no `nearMiss` fails by name.

test("#1764 every declaration carries a near-miss, and does not match it", () => {
  const table = nonEmpty(DECLARED_LS_PROBLEMS, "DECLARED_LS_PROBLEMS");
  for (const d of table)
    assert.equal(typeof d.nearMiss, "string",
      `/${d.match.source}/ has no \`nearMiss\`. Without one, widening it is invisible: the entry stays `
      + "un-stale and non-empty while accepting everything the widening admits.");
  assert.deepEqual(overbroadDeclarations(), [],
    "a declaration matches its own near-miss, so it now accepts more than it was written for");
});

test("#1764 the near-miss is what a WIDENED matcher trips on", () => {
  // The plant, run in-process so it needs no edit to the shipped table: the exact widening measured on
  // this file. Both existing directions still pass on it, which is the point.
  const widened = [{ match: /^invalid:/, nearMiss: "invalid: other@1.2.3", reason: "widened, for this arm" }];
  const reported = ["invalid: uuid@11.1.1 /x/node_modules/uuid"];

  assert.deepEqual(undeclaredProblems(reported, widened), [],
    "the widened matcher still covers what npm reports — this is why `undeclaredProblems` cannot see it");
  assert.deepEqual(staleDeclarations(reported, widened), [],
    "the widened matcher is not stale either — this is why `staleDeclarations` cannot see it");

  assert.equal(overbroadDeclarations(widened).length, 1,
    "the near-miss check is the only one of the three that catches a widening, and it did not");
});

test("#1764 a problem one step broader than the declaration is still UNDECLARED", () => {
  // The shipped table, unmodified. `invalid: other@x.y.z` is a real shape npm emits and this repo has
  // declared nothing about it — a failed install or a workspace that stopped resolving looks like this.
  assert.deepEqual(undeclaredProblems(["invalid: other@1.2.3"]), ["invalid: other@1.2.3"],
    "a problem nobody declared passed as declared, so the attributions would be generated from a tree "
    + "nobody looked at — a licence obligation quietly unmet");
});
