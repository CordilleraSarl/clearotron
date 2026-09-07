// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// E12 — one contract, one authoritative statement.
//
// The tests are in three groups and the middle one is the point:
//
//   1. the SCANNER, because a scanner that desynchronises reports zero and reads as a pass
//   2. the PLANTED DIVERGENCE, in a file that does not exist in this repository — 's judgment
//      criterion is "plant a divergence in a NEW authoring layer; the check must find it structurally,
//      not because the layer was enumerated", and a corpus passed as an argument is the only way to
//      test that without writing into the working tree
//   3. the TREE, which must be clean, and the two named scope rules, which must each still be earning
//      their exclusion — E2 arm 1's "no exemption is redundant" ported across, because an exclusion
//      list nobody re-checks is the whitelist  forbids wearing a different coat

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  stringLiterals, servedUnits, isProse, scopeOf, SCOPE_RULES, dictationViolations, fieldContract, toolOrderContract,
} from "../contract-dictation.mjs";
import { contracts, TOOL_ORDER_BACKLOG, doctrineReaders, grantedToolsFor, knownToolNames } from "../contract-dictation-registry.mjs";
import { scan, servedCorpus, GUARD } from "../../scripts/contract-dictation-scan.mjs";
import { skipReason } from "../../shared/tracked-files.mjs";

/** The scope-rule arm builds its own corpus, so it reports under its own name. */
const SCOPE_GUARD = "contract-dictation scope rules";

// ── 1 · the scanner ─────────────────────────────────────────────────────────────────────────────────

test("a regex literal containing a quote does not desynchronise the scan", () => {
  // The failure this pins is silent and total: read as a string opener, that `"` swallows the rest of
  // the file and every literal after it disappears. The check then reports zero — a pass, in the exact
  // files most likely to carry a dictated contract, since contract-audit.mjs itself has patterns of
  // this shape.
  const src = [
    'const RE = /["\'`][^"\'`\\n]{0,90}</;',
    'const after = "this literal is on the far side of that pattern";',
  ].join("\n");
  const lits = stringLiterals(src).map((l) => l.text);
  assert.ok(lits.includes("this literal is on the far side of that pattern"),
    `the scanner lost everything after the regex: ${JSON.stringify(lits)}`);
});

test("comments are not served text — neither line nor block", () => {
  const src = [
    '// set `receipt_id` to the candidate you ruled on, exactly as written',
    '/* set `receipt_id` to the candidate you ruled on, exactly as written */',
    'const real = "set `receipt_index` to the position of the candidate you ruled on";',
  ].join("\n");
  const texts = stringLiterals(src).map((l) => l.text);
  assert.equal(texts.length, 1, `only the literal is served: ${JSON.stringify(texts)}`);
  assert.match(texts[0], /receipt_index/);
});

test("A `+` CHAIN IS ONE STATEMENT — measured, not assumed", () => {
  // This is not a nicety. gateway.mjs's cite_absent hint wraps as `…On each named row set ` +
  // "`receipt_id` to one of the ids…", so per-fragment units put the order in one and the field in the
  // next. The first version of this check ran green over that live defect.
  const src = 'const hint = "On each named row set " +\n  "`receipt_id` to one of the ids listed under that row";';
  const units = stringLiterals(src);
  assert.equal(units.length, 1, "the two fragments are one statement");
  assert.match(units[0].text, /set .*receipt_id/s);
});

test("an interpolated expression is code, not dictation", () => {
  const src = 'const m = `the form ${dispositionFormNameFor(files)} needs every row ruled`;';
  assert.deepEqual(stringLiterals(src).map((l) => l.text), ["the form   needs every row ruled"]);
});

test("a bare key name is not an instruction to anybody", () => {
  assert.equal(isProse("receipt_id"), false);
  assert.equal(isProse('{ "receipt_id": null }'), false, "three words, but under the character floor");
  assert.equal(isProse("set receipt_index to the candidate's position"), true);
});

test("a markdown unit is a paragraph, because that is how a seat reads a skill file", () => {
  const md = "first line\nsecond line\n\nlater paragraph\n";
  assert.deepEqual(servedUnits("driver/skills/x/SKILL.md", md),
    [{ line: 1, text: "first line\nsecond line" }, { line: 4, text: "later paragraph" }]);
});

test("the E1 declaration block is stripped — the audit that describes the contract is not an instance of it", () => {
  // stages.mjs's contractElements carries `why:` strings quoting the retired contract verbatim
  // ("disposition form `receipt_id` — copy one of that row's own candidate ids"). Left in, E12 fires on
  // 's own audit, and the only way to green it would be to stop writing the audit down.
  const src = [
    '  "some-stage": {',
    "    contractElements: {",
    '      "disposition form `receipt_id` — copy one of that row\'s own candidate ids": {',
    '        class: "mechanical:pre-bound", why: "set `receipt_id` to the candidate you ruled on",',
    "      },",
    "    },",
    '    message: "a real dispatch line that says nothing about receipts at all",',
    "  },",
  ].join("\n");
  const texts = servedUnits("driver/stages.mjs", src).map((u) => u.text);
  assert.deepEqual(texts, ["a real dispatch line that says nothing about receipts at all"]);
});

// ── 2 · the planted divergence, in a layer that does not exist ──────────────────────────────────────

const RECEIPTS = () => contracts().find((c) => c.id === "receipt-binding");

test("A SEVENTH AUTHORING LAYER IS CAUGHT STRUCTURALLY — the file is not in this repository", () => {
  // 's judgment criterion, literally. `driver/some-new-dispatch-surface.mjs` does not exist and is
  // named nowhere in the checker, the registry or the scan script. It is found because the corpus is
  // "every tracked .mjs and .md under driver/", not a list.
  const planted = [{
    file: "driver/some-new-dispatch-surface.mjs",
    text: 'export const hint = "on every row set `receipt_id` to the id of the candidate you ruled on";',
  }];
  const found = dictationViolations(planted, [RECEIPTS()]);
  assert.equal(found.length, 1);
  assert.equal(found[0].file, "driver/some-new-dispatch-surface.mjs");
  assert.equal(found[0].line, 1, "the report names file AND line");
  assert.match(found[0].why, /M1|POSITION/, "and says which contract it diverges from");
});

test("…and in a NEW SKILL FILE, which is the layer that carried instance 5", () => {
  const planted = [{
    file: "driver/skills/some-new-doctrine/SKILL.md",
    text: "Intro paragraph.\n\nOn each row, name the `receipt_id` of the candidate you ruled on.\n",
  }];
  const found = dictationViolations(planted, [RECEIPTS()]);
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 3, "the paragraph's own line, not the file's first");
});

test("naming the live field in the same statement is the remedy, and it passes", () => {
  const ok = [{
    file: "driver/some-new-dispatch-surface.mjs",
    text: 'export const hint = "set `receipt_index` to the position; leave `receipt_id` to the driver, always";',
  }];
  assert.deepEqual(dictationViolations(ok, [RECEIPTS()]), []);
});

test("a THIRD tool-order mismatch goes red — #865's acceptance, on an invented stage", () => {
  const contract = toolOrderContract({
    toolNames: ["perplexity_research", "band_lookup"],
    grantedFor: () => new Set(["band_lookup"]),
    stagesOf: () => ["some-tool-free-stage"],
    backlog: TOOL_ORDER_BACKLOG,
  });
  const planted = [{
    file: "driver/skills/some-new-doctrine/SKILL.md",
    text: "Run one perplexity_research query over the owner's trading history before you rule.",
  }];
  const found = dictationViolations(planted, [contract]);
  assert.equal(found.length, 1);
  assert.match(found[0].why, /some-tool-free-stage/);
  assert.match(found[0].why, /perplexity_research/);
});

test("the backlog excuses ONLY its own pairs, never the tool or the stage on its own", () => {
  // TAKEN FROM THE LIVE BACKLOG, not named. This asserts a property of the EXCUSING MECHANISM, and it
  // used to name 's seed pair — so resolving that pair turned a correct fix into a red, and the
  // cheapest way back to green was to put the excuse row back. A ratchet whose own test rewards
  // re-adding a row is not a ratchet. Whichever pair is first today exercises the same property, and
  // when the backlog finally empties the guard above it (`length > 0`) is the one that speaks.
  const [pair] = TOOL_ORDER_BACKLOG;
  const OTHER = "some-stage-that-holds-nothing";
  const contract = toolOrderContract({
    toolNames: [pair.tool],
    grantedFor: () => new Set(),
    stagesOf: (f) => (f === pair.site ? [pair.stage] : [OTHER]),
    backlog: TOOL_ORDER_BACKLOG,
  });
  const text = `Run one ${pair.tool} query before you rule.`;
  assert.deepEqual(dictationViolations([{ file: pair.site, text }], [contract]), [],
    `the excused pair stays excused (${pair.stage} / ${pair.tool})`);
  assert.equal(dictationViolations([{ file: "driver/skills/somewhere-else/SKILL.md", text }], [contract]).length, 1,
    "the SAME tool, a different stage — not excused");
});

// ── 3 · the tree, and the exclusions ────────────────────────────────────────────────────────────────

test("THE TREE IS CLEAN — no served text dictates a retired contract", (ctx) => {
  const { skipped, files, violations } = scan();
  // — SKIP, not a bare return. The helper prints its marker to stderr and CI greps for it, but
  // node:test counts a bare return as a PASS, so this arm reported a clean tree having read none.
  if (skipped) return ctx.skip(skipReason(GUARD));
  assert.ok(files > 150, `expected the whole served corpus, got ${files} files — the reader is broken, not the tree`);
  assert.deepEqual(violations.map((v) => `${v.contract} ${v.file}:${v.line}`), [],
    violations.map((v) => `\n${v.file}:${v.line}\n  ${v.text.slice(0, 140)}\n  → ${v.why}`).join(""));
});

test("the corpus reaches every layer the six instances came from", (ctx) => {
  const corpus = servedCorpus();
  if (corpus == null) return ctx.skip(skipReason(GUARD));
  const files = new Set(corpus.map((c) => c.file));
  for (const f of ["driver/stages.mjs", "driver/gateway.mjs", "driver/connotation-search.mjs",
    "driver/disposition-union.mjs", "driver/skills/prelim-common-law/SKILL.md"])
    assert.ok(files.has(f), `${f} is not in the scanned corpus — the check cannot see the layer it was built for`);
});

test("NO SCOPE RULE IS REDUNDANT — each excluded file would still fire if it were in scope", async (ctx) => {
  // E2 arm 1's rule, ported. A rule that has stopped excluding anything is a rule nobody may keep,
  // because the next reader cannot tell it from a whitelist — and rejects the whitelist route to
  // green by name. Asserted against each excluded file's REAL text, under a pretend in-scope name.
  const { readFileSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const cs = contracts();

  for (const rule of SCOPE_RULES) {
    assert.ok(rule.why.length > 120, "an exclusion whose reason fits on one line is a path filter with a comment");
  }

  // EVERY rule is asked to justify itself against the tracked tree, not against a filename written
  // here — a hand-picked witness is the same rot one level up. For each rule: find a file it excludes
  // that WOULD fire if it were in scope. None found means the rule has stopped protecting anything and
  // should be deleted, and the assertion says so in those words.
  const { trackedFiles } = await import("../../shared/tracked-files.mjs");
  const tracked = trackedFiles(SCOPE_GUARD, { root, pathspec: ["driver"] });
  if (tracked == null) return ctx.skip(skipReason(SCOPE_GUARD));

  for (const rule of SCOPE_RULES) {
    const covered = tracked.filter((f) => (f.endsWith(".mjs") || f.endsWith(".md")) && rule.match(f));
    assert.ok(covered.length > 0, `a scope rule that excludes no tracked file: ${rule.why.slice(0, 60)}…`);
    const witness = covered.find((f) => {
      let text;
      try { text = readFileSync(join(root, f), "utf8"); } catch { return false; }
      // dictationViolations skips out-of-scope files, so ask under an in-scope name to prove the point.
      return dictationViolations([{ file: "driver/pretend-in-scope.mjs", text }], cs).length > 0;
    });
    assert.ok(witness,
      `this rule now excludes ${covered.length} file(s) and NONE of them would fire — the exclusion has `
      + `gone stale and should be deleted rather than carried: ${rule.why.slice(0, 90)}…`);
  }
});

test("A ZERO MUST MEAN SOMETHING — the registry is not empty and the scanner is not silent", (ctx) => {
  // Two ways this check reports a clean tree while checking nothing, and neither one throws:
  // an empty contract list, and a scanner that desynchronised on the biggest file and returned no
  // units. Both are asserted directly, because "0 divergences" is what this suite treats as a pass.
  assert.deepEqual(contracts().map((c) => c.id).sort(),
    ["closing-line", "proof-of-reading", "receipt-binding", "tool-order"],
    "a contract silently dropped from the registry reads as a clean tree");

  const corpus = servedCorpus();
  if (corpus == null) return ctx.skip(skipReason(GUARD));
  for (const f of ["driver/gateway.mjs", "driver/stages.mjs", "driver/connotation-search.mjs"]) {
    const row = corpus.find((c) => c.file === f);
    assert.ok(servedUnits(f, row.text).length > 50,
      `${f} yielded almost no served units — the scanner lost its place, and a lost scanner reports zero`);
  }
});

test("the closing line has exactly ONE author, and it is writeReturn", () => {
  const planted = [{
    file: "driver/some-other-dispatch.mjs",
    text: 'const tail = "Write your output to this ABSOLUTE path (create parent dirs if needed): " + out;',
  }];
  const c = contracts().find((x) => x.id === "closing-line");
  const found = dictationViolations(planted, [c]);
  assert.equal(found.length, 1, "a second authoring of the closing line is a second author, right or wrong");
  assert.match(found[0].why, /mock|ABSOLUTE path/, "and the report names the consumer that re-parses it");
  assert.deepEqual(dictationViolations([{ file: "driver/stages.mjs", text: planted[0].text }], [c]), [],
    "…while stages.mjs, which composes it, is the one place it may live");
});

test("the backlog is explicit, named, and each entry says which move removes it", () => {
  assert.ok(TOOL_ORDER_BACKLOG.length > 0, "an empty backlog would mean #865's two members were silently fixed here");
  for (const b of TOOL_ORDER_BACKLOG) {
    assert.match(b.closes, /#865/, "every excused pair names the issue that closes it");
    assert.ok(b.stage && b.tool && b.site);
    assert.ok(!grantedToolsFor(b.stage).has(b.tool),
      `${b.stage} now HOLDS ${b.tool} — the backlog entry is stale and must be deleted, not carried`);
  }
});

test("the authority is read live, not transcribed — the grant table and STAGES are the sources", () => {
  const readers = doctrineReaders();
  assert.ok(readers.get("driver/skills/narrative-refutation/SKILL.md")?.includes("narrative-refutation"),
    "doctrine readers come from STAGES' own skillReads");
  assert.ok(knownToolNames().includes("perplexity_research"), "the tool universe comes from the grant table");
  assert.ok(grantedToolsFor("synthesis").has("perplexity_research"));
  // — INVERTED WHEN THE SEED INSTANCE WAS RESOLVED. This asserted the mismatch was still the grant
  // table's live answer, which was the right assertion while it was true and becomes a pin on the defect
  // the moment it is fixed. The live-read property it was written to prove is unchanged: the answer still
  // comes from the grant table rather than from a transcription, and it now reads the other way.
  assert.ok(grantedToolsFor("narrative-refutation").has("perplexity_research"),
    "#865's seed instance: the stage's doctrine orders the probe, so the grant must carry it");
});
