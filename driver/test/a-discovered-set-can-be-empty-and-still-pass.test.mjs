// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — THE FIFTH MEMBER: assertions that can execute ZERO times.
//
// The four delivered members (DELETED, RENAMED, GUTTED, SKIPPED) are all satisfied by a loop over an
// empty discovered set: the file is present, its test count is unchanged, its assert-SITE count is
// unchanged, and no skip line is printed. The suite reports itself intact while the guard guards
// nothing. This arm is the member that sees it — see shared/vacuous-pass.mjs for the mechanism and for
// why the GATED member named in is not here.
//
// The remedy is one line at the site: assert the corpus is non-empty before you walk it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { discoveredLoops, DISCOVERY_RE, nonEmpty } from "../../shared/vacuous-pass.mjs";
import { trackedFiles } from "../../shared/tracked-files.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GUARD = "a-discovered-set-can-be-empty-and-still-pass (#1010)";

/**
 * Loops over a discovered set that is ALLOWED to be empty, because the set is the VIOLATIONS the test
 * hopes to find none of — not the CORPUS it is checking. Empty is the passing state there, and an
 * assertion demanding otherwise would invert the test.
 *
 * One rule for every site: assert the set non-empty, OR name it here with the reason. Each entry is
 * asserted REACHED below, so one that stops matching is deleted rather than carried.
 */
export const EMPTY_IS_THE_PASS = [
  {
    // — this entry USED to be a line number, and that is why it is not one now. `` added
    // eleven comment lines to an unrelated diagnostic above it, the site moved from :196 to :207, and
    // two arms went red in a pull request about environment spellings. CONTRIBUTING's rule from
    // ADR-0005 is cite the SYMBOL, not the line; the guard now reads one.
    file: "driver/test/preflight-engine-binary.test.mjs",
    symbol: "CLEAROTRON_CLAUDE_PATH=/nope refuses BEFORE any run dir exists \u203a walk",
    expr: "readdirSync(dir, { withFileTypes: true })",
    why: "a RECURSIVE walk looking for run directories that must not exist. Empty is the criterion, not "
       + "a lost corpus — the test asserts the collected list is `[]`, so demanding a non-empty directory "
       + "at every level of the recursion would invert exactly what the preflight promises.",
  },
  {
    file: "driver/test/preflight-free-space.test.mjs",
    symbol: "#773 a disk that cannot hold the run refuses BEFORE any run dir exists \u203a walk",
    expr: "readdirSync(dir, { withFileTypes: true })",
    why: "the same recursive walk for the same criterion (#773): a run dir left by a run that never "
       + "started is a resumable-looking husk, and the preflight's whole promise is that it produces none. "
       + "An empty tree is the pass.",
  },
];

/**
 * — THE THIRD ANSWER: the loop is one STEP of a recursive walk, and the corpus question is asked
 * once, on the walk's RESULT.
 *
 * A recursive walk reads every directory it descends into, and an empty LEAF is ordinary — a tree the
 * product itself writes into, a directory not populated yet. It is not the vacuity exists to
 * catch. Guarding each read turns one empty leaf into a throw before a single file has been read:
 * measured 2026-08-29, ONE empty `driver/profiles/projects/<key>/` — written by the
 * product, on every deployed box — reddened ten arms across five files for a reason with nothing to do
 * with what any of them check, and silently skipped a whole root in a sixth that swallows the throw.
 *
 * Git stores no empty directory, so no fresh clone has an empty leaf and CI is structurally blind to
 * all of it. The only place these guards could ever meet real deployment state is the only place they
 * were red.
 *
 * So this is not an exemption. It is asked where the answer means something, and the
 * entries below carry EMPTY_IS_THE_PASS's discipline — anchored by symbol, reached exactly once, a
 * reason in words, no line numbers — plus one tooth that table does not need:
 *
 *   `provedBy` names the arm IN THE DECLARED FILE that drives the empty-walk direction and asserts the
 *   aggregate still refuses. The table points at the proof; the table is not the proof. A rescoped
 *   guard and a deleted guard read identically on a healthy tree, and only that arm tells them apart.
 *
 * And a declared file may not take the guard back inside its recursion — asserted by text below,
 * because that spelling IS this defect returning.
 *
 * LIMIT, stated rather than discovered: that last check is a text match on `nonEmpty(readdirSync`. It
 * sees the spelling this defect actually had; it does not see `nonEmpty(readdirSync(d, o).filter(…))`
 * or a read hoisted to a const and wrapped on the next line. It is a cheap backstop against the exact
 * regression, and it is not what makes an entry safe. `provedBy` is: that arm runs the walk against an
 * empty tree, so it fails whatever spelling the guard came back in.
 */
export const GUARDED_AT_THE_WALK = [
  {
    file: "driver/test/you-can-sign-out-of-the-mode-you-signed-in-to.test.mjs",
    symbol: "walk",
    expr: "readdirSync(dir, { withFileTypes: true })",
    provedBy: "2179-F47 the population this walks is real, so an empty result means something",
    why: "the recursion step of the portal-and-driver source walk behind F47's class arm. That arm "
       + "asserts an ABSENCE — no surface links straight at Cloudflare's endpoint — and an absence found "
       + "in an empty population is the exact false pass 1010 exists for. An empty directory part-way "
       + "down a source tree is normal, so the guard belongs on the aggregate: the arm named above "
       + "requires the walk to return the whole corpus (measured 1203 files) before the class arm's "
       + "clean result is allowed to mean anything.",
  },
  {
    file: "driver/test/a-what-if-claims-only-what-the-manifest-shows.test.mjs",
    symbol: "walk",
    expr: "readdirSync(d, { withFileTypes: true })",
    provedBy: "2171 the manifest walk handles an empty tree rather than passing over it",
    why: "the recursion step of the sha manifest this issue's arms compare a canonical run against. The "
       + "aggregate is guarded — arm 1 refuses a fixture too thin to tell an untouched artifact from an "
       + "absent one — and the empty-walk direction is DRIVEN by the arm named above: an empty tree "
       + "manifests to an empty map, and an empty `_experiments/` leaf does not swallow the files beside it.",
  },
  {
    file: "driver/test/deployment-hostnames.test.mjs",
    symbol: "sourceFiles",
    expr: "readdirSync(dir)",
    provedBy: "#2018 #1010 still fires when the walk genuinely finds nothing",
    why: "the recursion step of the seven-root source walk. `driver/profiles/` is both a tracked source "
       + "tree and a runtime write target, so a deployed box grows an empty leaf under it and all six "
       + "arms threw before reading a file. guardedFiles() wraps the aggregate, and takes its roots as a "
       + "parameter so the empty-walk direction is driven rather than argued.",
  },
  {
    file: "driver/test/free-tier-credential-sites.test.mjs",
    symbol: "walk",
    expr: "readdirSync(dir, { withFileTypes: true })",
    provedBy: "tracker 2018 the walk refuses an empty corpus, and an empty leaf is not one",
    why: "the recursion step of the three-root sweep for USPTO_LOCAL_DB gates. sources() wraps the "
       + "aggregate of driver/, providers/ and bin/, and takes its roots as a parameter so an empty "
       + "tree can be handed to it.",
  },
  {
    file: "driver/test/provider-neutral-prose.test.mjs",
    symbol: "walk",
    expr: "readdirSync(dir)",
    provedBy: "tracker 2018 the walk refuses an empty corpus, and an empty leaf is not one",
    why: "the recursion step of the vendor-token sweep. Three arms walk three different trees, so the "
       + "guard sits on walked(), which wraps each walk's result and names the tree it walked.",
  },
  {
    file: "driver/test/register-provider-required.test.mjs",
    symbol: "DOOR 4 — a fetch receipt records NO provider rather than a guessed one \u203a driverModules",
    expr: "readdirSync(dir)",
    provedBy: "tracker 2018 the driver-module walk refuses an empty corpus, and an empty leaf is not one",
    why: "the recursion step of the blunt sweep for a defaulted register provider. The walk was hoisted "
       + "out of its arm so driverSources() can be handed an empty tree; it guards the aggregate.",
  },
  {
    file: "driver/test/seat-outputs-outside-driver-tree.test.mjs",
    symbol: "walk",
    expr: "readdirSync(dir, { withFileTypes: true })",
    provedBy: "tracker 2018 the stage-table walk refuses an empty tree, and an empty leaf is not one",
    why: "the recursion step of the discovered half of the stage-table guard — the half that sees a new "
       + "lane declaring its own stages. stageDeclaringFiles() guards what the walk collected and takes "
       + "its root as a parameter.",
  },
  {
    file: "driver/test/register-ledger-rename.test.mjs",
    symbol: "#1390 a config with NO register server still builds without a run — the refusal is scoped \u203a productModules",
    expr: "readdirSync(dir, { withFileTypes: true })",
    provedBy: "tracker 2018 the ledger walk refuses an empty tree and names the root it failed on",
    why: "the recursion step of the four-root product-module sweep, and the site this class was WORST "
       + "at: the call sat inside `catch { continue; }`, so an empty leaf under driver/ skipped 257 of "
       + "369 modules in silence on every deployed box. modulesUnder() guards each root's result, names "
       + "the root in its refusal, and the arm asserts all four roots were walked.",
  },

  {
    file: "driver/test/a-failed-run-tells-the-client-what-to-do.test.mjs",
    symbol: "walk",
    expr: "readdirSync(dir, { withFileTypes: true })",
    provedBy: "2179 the source walk refuses an empty corpus, and an empty leaf is not one",
    why: "the recursion step of the five-root client-facing source walk behind the owner's failed-run "
       + "ruling. The class arm it feeds asserts an ABSENCE — no shipping line says a retired claim — "
       + "and an absence found in an empty population is the false pass 1010 exists for. An empty leaf "
       + "part-way down is normal on a deployed box, so clientFacingSources() guards what the walk "
       + "returned and takes its base and roots as parameters, and the arm above drives both directions "
       + "against a real empty tree.",
  },
];

/**
 * — a site is matched by SYMBOL and expression, never by line.
 *
 * Both alone are ambiguous and were measured to be: the two declared sites are a `walk` helper running
 * the identical `readdirSync(dir, { withFileTypes: true })`, and one unrelated file repeats a single
 * expression five times. Together with the enclosing test title they are unique — and the arm below
 * asserts uniqueness rather than assuming it, so an anchor that starts matching two sites is a refusal
 * and not a silent second exemption.
 */
const matches = (row, d) => row.file === d.file && row.symbol === d.symbol && row.expr === d.expr;
const declared = (row) => EMPTY_IS_THE_PASS.find((d) => matches(row, d)) ?? null;
/** — the same anchor, resolved against the recursion-step table. */
const walkGuarded = (row) => GUARDED_AT_THE_WALK.find((d) => matches(row, d)) ?? null;

/**
 * This file's own fixtures ARE unguarded discovered loops — they have to be, to prove the detector sees
 * one. A guard that forbids a shape fires on its own explanation unless it excludes itself BY NAME, and
 * a self-exclusion nobody notices going stale is a permanent hole, so an arm below asserts it still
 * covers something.
 */
const SELF = "driver/test/a-discovered-set-can-be-empty-and-still-pass.test.mjs";

/** Every discovered-set loop in the collected driver tests, with the bucket it lands in. */
function survey() {
  const all = (trackedFiles(GUARD, { root: ROOT }) ?? []).filter((f) => /^driver\/test\/.*\.test\.mjs$/.test(f));
  const files = all.filter((f) => f !== SELF);
  assert.ok(all.includes(SELF), `${SELF} is no longer in the corpus — the self-exclusion covers nothing `
    + "and would hide a real site if this file were renamed. Update SELF.");
  assert.ok(files.length > 0, "no driver test files were collected — this is a SKIP dressed as a pass");
  const rows = [];
  for (const f of files) {
    let text;
    try { text = readFileSync(join(ROOT, f), "utf8"); } catch { continue; }
    for (const l of discoveredLoops(text)) rows.push({ file: f, ...l });
  }
  return { files, rows };
}

test("#1010 a loop over a DISCOVERED set asserts that set is not empty, or says why empty is correct", () => {
  const { rows } = survey();
  const open = rows.filter((r) => !r.guarded && !declared(r) && !walkGuarded(r));
  assert.deepEqual(open.map((r) => `${r.file}:${r.line}  ${r.expr}`), [],
    "these loops walk a set the tree decides the size of, and assert nothing when it is empty. The four "
    + "existing census members cannot see this: the file is present, the test count is unchanged, the "
    + "assert-SITE count is unchanged, and nothing prints a skip. Assert the set non-empty before the "
    + "loop — or, if empty is the PASSING state because the set is violations rather than corpus, add it "
    + "to EMPTY_IS_THE_PASS with that reason. If it is one STEP of a recursive walk whose RESULT is "
    + "guarded, add it to GUARDED_AT_THE_WALK with the arm that drives the empty-walk direction.");
});

test("#1010 the detector can still SEE a vacuous loop — a zero here is a broken instrument", () => {
  // A green above means nothing if the detector stopped matching. Two directions, both required.
  const { rows } = survey();
  assert.ok(rows.length >= 20,
    `only ${rows.length} discovered-set loop(s) found across the driver tests. 36 were measured on `
    + "2026-08-20; a collapse means DISCOVERY_RE or the loop pattern stopped matching, not that the "
    + "suite got safer.");
  const selfRows = discoveredLoops(readFileSync(join(ROOT, SELF), "utf8")).filter((r) => !r.guarded);
  assert.ok(selfRows.length > 0,
    "this file's own fixtures stopped reading as unguarded discovered loops, so the self-exclusion is "
    + "excluding nothing and the detector may have stopped seeing the shape it exists to find");
  const planted = discoveredLoops(`
    const files = readdirSync(dir);
    for (const f of files) { assert.ok(f, "x"); }
  `);
  assert.deepEqual(planted.map((p) => p.guarded), [false], "the detector no longer sees an unguarded discovered loop");
  const cured = discoveredLoops(`
    const files = readdirSync(dir);
    assert.ok(files.length > 0, "corpus");
    for (const f of files) { assert.ok(f, "x"); }
  `);
  assert.deepEqual(cured.map((p) => p.guarded), [true], "the detector no longer credits a real non-emptiness assertion");
});

test("#1010 every EMPTY_IS_THE_PASS entry is REACHED, exactly once, and carries its reason", () => {
  // The aggregate that hid a half-dead exemption on is not repeated: per entry, and REACHED
  // rather than well-formed.
  const { rows } = survey();
  for (const d of EMPTY_IS_THE_PASS) {
    const hits = rows.filter((r) => matches(r, d) && !r.guarded);
    assert.equal(hits.length, 1,
      `EMPTY_IS_THE_PASS names ${d.file} \u203a ${d.symbol}, which matches ${hits.length} unguarded `
      + "discovered loops. One is the only safe number: zero means the site is gone or guarded, so "
      + "delete the entry; more than one means the anchor exempts a site nobody declared.");
    assert.ok(d.why && d.why.length > 40, `the entry for ${d.file} carries no reason in words`);
    // — a line number survives no edit above it. Refusing the field is what stops the fragility
    // coming back one convenient entry at a time.
    assert.ok(!("line" in d), `the entry for ${d.file} carries a line number. Anchor it by symbol: a `
      + "line survives no edit above it, and this table went red twice for changes with nothing to do "
      + "with discovered sets.");
  }
});

test("#2018 every GUARDED_AT_THE_WALK entry is REACHED exactly once, names its proof, and has not taken the guard back", () => {
  const { rows } = survey();
  // THE TABLE ITSELF IS A POPULATION, and a loop over an emptied one passes while checking nothing —
  // which is the exact shape this whole file exists to catch, one level up. Empty the table and this
  // arm refuses; it does not quietly agree.
  for (const d of nonEmpty(GUARDED_AT_THE_WALK, "GUARDED_AT_THE_WALK")) {
    const hits = rows.filter((r) => matches(r, d) && !r.guarded);
    assert.equal(hits.length, 1,
      `GUARDED_AT_THE_WALK names ${d.file} \u203a ${d.symbol}, which matches ${hits.length} unguarded `
      + "discovered loops. One is the only safe number: zero means the site is gone or guarded inline, so "
      + "delete the entry; more than one means the anchor excuses a site nobody declared.");
    assert.ok(d.why && d.why.length > 40, `the entry for ${d.file} carries no reason in words`);
    assert.ok(!("line" in d), `the entry for ${d.file} carries a line number. Anchor it by symbol.`);

    const text = readFileSync(join(ROOT, d.file), "utf8");
    // THE PROOF IS AN ARM, NOT THIS TABLE. A guard moved onto the walk's result and a guard deleted
    // outright read identically on a healthy tree; only an arm that hands the walk an empty tree tells
    // them apart, and the entry has to point at one that exists.
    assert.ok(text.includes(`test("${d.provedBy}"`),
      `${d.file} carries no arm titled "${d.provedBy}" — the entry points at a proof that is not there, `
      + "so nothing in the suite drives the empty-walk direction for this site");
    // The corpus check moved; it did not leave.
    assert.match(text, /nonEmpty\(/,
      `${d.file} no longer calls nonEmpty at all — the corpus check was deleted rather than rescoped`);
    // And it has not crept back inside the recursion. That spelling IS the defect: one
    // empty leaf, written by the product, reds the file on every deployed box and nowhere else.
    assert.doesNotMatch(text, /nonEmpty\(\s*readdirSync/,
      `${d.file} wraps a readdirSync inside its walk again`);
  }
});

test("#1862 the anchor survives a move, and still dies with its site", () => {
  // Driven against the real file, not a hand-built row — the whole defect was that the declaration and
  // the thing it described could drift apart, so a fixture that cannot drift proves nothing.
  const d = EMPTY_IS_THE_PASS[0];
  const original = readFileSync(join(ROOT, d.file), "utf8");
  const rowsIn = (text) => discoveredLoops(text).map((r) => ({ file: d.file, ...r }));

  const before = rowsIn(original).filter((r) => matches(r, d));
  assert.equal(before.length, 1, "the entry does not resolve against its own file as committed");

  // MOVED: eleven comment lines above it, which is literally what did.
  const moved = rowsIn("// pushed down\n".repeat(11) + original).filter((r) => matches(r, d));
  assert.equal(moved.length, 1, "the entry stopped resolving when its site moved down the file");
  assert.notEqual(moved[0].line, before[0].line, "the site did not actually move — the plant is inert");

  // DELETED: the site is gone, and the entry must NOT resolve. An anchor that survives its own
  // target's deletion is an exemption that outlives what it excuses.
  const gone = original.split("\n").filter((l) => !l.includes(d.expr)).join("\n");
  assert.deepEqual(rowsIn(gone).filter((r) => matches(r, d)), [],
    "the entry still resolves after its site was deleted");
});

test("#1010 the comment-blanking keeps line numbers true", () => {
  // Dropping comment lines instead of blanking them would shift every reported line, and the report is
  // how a reader finds the site. Same inversion suite-census.mjs calls out for its own counter.
  const rows = discoveredLoops("// a comment\n// another\nfor (const f of readdirSync(d)) { assert.ok(f); }\n");
  assert.deepEqual(rows.map((r) => r.line), [3], "a reported line number no longer points at the loop");
});
