// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A variable whose NAME is held in a table as a value is read, and the catalogue sees it.
//
// `namesRead` in scripts/env-audit.mjs is the scanner every environment-catalogue check reads from. A
// generic resolver takes the name out of a row and reads it — `{ env: "CLEAROTRON_CODEX_PATH" }` — so the
// variable is read on every run and spelled nowhere the scanner was looking. Thirteen names were read
// exactly that way, needing no governance row, no catalogue row and no effect declaration, with every
// catalogue check green about all of them.
//
// This is the third time the shape has hidden a read here: the accessor family was the first, `envFrom`
// the second, and a name held as a value is those two one remove further on. The sibling file beside this
// one holds the same property for optional chaining.
//
// What the tests hold:
//   - a name under `env`, `envName` or `tokenEnv` is seen, single- or double-quoted;
//   - the rule matches the PROPERTY NAME and never the value's shape, so an uppercase string under any
//     other key is not a read — the reason the rule is written this way rather than more simply;
//   - what the scanner refuses stays refused: a comment line, and a key merely ending in `env`;
//   - on this tree, the two register ledgers are product reads and each is now documented;
//   - each is classified as its row declares, rather than falling to the class a cleanup deletes from.
import { test } from "node:test";
import assert from "node:assert/strict";
import { namesRead, auditEnv, auditCatalogue, declaredEffects, EFFECT_CLASSES } from "../../scripts/env-audit.mjs";
import { classify } from "../../scripts/env-classify.mjs";

const seen = (code) => [...namesRead(code)].sort();

test("a name held under one of the resolver's own keys is a read", () => {
  for (const code of [
    'const t = { "openai-agent": { env: "CLEAROTRON_PROBE", fallback: "codex" } };',
    "const t = { env: 'CLEAROTRON_PROBE' };",
    'const t = { envName: "CLEAROTRON_PROBE" };',
    'const t = { tokenEnv: "CLEAROTRON_PROBE" };',
    'const t = {env:"CLEAROTRON_PROBE"};',
  ]) assert.deepEqual(seen(code), ["CLEAROTRON_PROBE"], `not seen: ${code}`);
});

test("the rule reads the KEY, never the value's shape", () => {
  // The whole reason it is written this way. A rule that took any uppercase string literal would take
  // every message key, token name and enum member in the tree and bury the audit in names nothing reads
  // — and an audit swamped with false names is one nobody can use to find a real gap.
  for (const code of [
    'const t = { token: "CLEAROTRON_PROBE" };',
    'const t = { name: "CLEAROTRON_PROBE" };',
    'const t = { key: "CLEAROTRON_PROBE" };',
    'throw new Error("CLEAROTRON_PROBE is not set");',
    'const MESSAGES = { GREETING: "CLEAROTRON_PROBE" };',
  ]) assert.deepEqual(seen(code), [], `taken as a read, and it is not one: ${code}`);
});

test("what was not a read is still not one in a table", () => {
  assert.deepEqual(seen('// const t = { env: "CLEAROTRON_PROBE" };'), [], "a commented-out line is not a read");
  assert.deepEqual(seen('const t = { myenv: "CLEAROTRON_PROBE" };'), [], "a key merely ENDING in env is not the key");
  assert.deepEqual(seen('const t = { environment: "CLEAROTRON_PROBE" };'), [], "nor one merely beginning with it");
});

test("on this tree, the two register ledgers are product reads, and each is documented", () => {
  const audit = auditEnv();
  assert.ok(audit, "the audit read no corpus: this tree is not a git checkout");
  // A FLOOR, so an audit that read almost nothing cannot pass the lines below by absence.
  assert.ok(audit.rows.length > 300, `the audit saw only ${audit.rows.length} names`);
  const rows = new Map(audit.rows.map((r) => [r.name, r]));
  for (const name of ["CLEAROTRON_REGISTER_CALL_LOG", "CLEAROTRON_REGISTER_RECORD_LOG"]) {
    const r = rows.get(name);
    assert.ok(r, `${name} is not seen as read anywhere — the scanner has stopped reading tables`);
    assert.ok([...r.files].includes("providers/_shared/ledger-path.mjs"), `${name} has ${[...r.files].join(", ")}`);
    assert.equal(r.product, true, `${name} is read by code that ships`);
    assert.equal(r.documented, true, `${name} has no row in either governance document`);
  }
});

test("each ledger is classified as its row declares, not left in the bucket a cleanup deletes from", () => {
  // THE HALF THAT MATTERS TO A CLIENT, not to the audit's tidiness. Neither name matches a deployment
  // shape, and no deployed box sets either — the ledger module says so and resolves its default by
  // existence for that reason. So unlisted, each lands in `tuning` with an empty set-site list, which IS
  // the population a cleanup deletes from. Making these visible without listing them would have moved
  // the billing-grade call ledger and the record ledger a "verified from the record" claim joins against
  // from unseen to proposed for deletion, which is worse than the blindness this change removes.
  const declared = declaredEffects(auditCatalogue().rows);
  const NOBODY = { prod: new Set(), test: new Set(), config: new Set(), ci: new Set(), e2e: new Set(), docs: new Set() };
  const names = ["CLEAROTRON_REGISTER_CALL_LOG", "CLEAROTRON_REGISTER_RECORD_LOG"];
  for (const n of names) assert.equal(declared.get(n), "deployment", `${n}'s row no longer declares what this holds it to`);
  const { rows } = classify({ catalogue: names, sources: NOBODY, setup: new Set(), readSites: () => null });
  assert.equal(rows.length, 2, "the classifier did not answer for every name");
  for (const r of rows) assert.equal(r.class, "deployment", `${r.name} is declared deployment and classified ${r.class}`);
});

// ── A CLASS THE CLASSIFIER COMPUTES MUST BE A CLASS A ROW CAN DECLARE ────────────────────────────────
//
// The classifier has computed `setup` for as long as it has had a setup population, and the declared
// vocabulary had no such word. So the names the install wizard writes could not be declared truthfully:
// each was left undeclared, or declared as the nearest wrong thing and frozen with a note saying so.
// A declaration that cannot be true is worse than no declaration, because it reads as considered.
//
// Ruled 2026-09-17: add the word. These arms hold the two halves of that — the word exists, and the two
// names it was added for use it.
test("the vocabulary has a word for what the install wizard writes", () => {
  assert.ok(Object.prototype.hasOwnProperty.call(EFFECT_CLASSES, "setup"),
    "the classifier computes `setup`; without it in the declared vocabulary those names cannot declare truthfully");
  assert.match(EFFECT_CLASSES.setup, /install|set(s|ting)? (this )?machine up|wizard/i,
    "the class needs a definition a reader can apply, not just a slot in the set");
});

test("the two engine program paths declare the class they compute", () => {
  // The pair this was ruled for. Read through the catalogue's own parser rather than by grepping the
  // file, because the declaration's REACH is the thing that goes wrong: an `# effect:` marker runs to
  // the next blank line or comment, so one written in the wrong place silently declares its neighbour
  // too. That happened while this was being written and only the parser showed it.
  const declared = declaredEffects(auditCatalogue().rows);
  for (const name of ["CLEAROTRON_CLAUDE_PATH", "CLEAROTRON_CODEX_PATH"]) {
    assert.equal(declared.get(name), "setup", `${name} must declare the class the classifier computes for it`);
  }
  // THE NEIGHBOUR, so the reach failure above cannot come back unnoticed. It sits directly beneath the
  // codex row and carries no declaration of its own; a marker that over-reaches gives it one.
  assert.equal(declared.get("CLEAROTRON_WORK_DIR"), undefined,
    "a declaration reached a row it was not written for — the marker's run is not ended where it should be");
});

// ── AND NO CLASS THE CLASSIFIER CAN PRODUCE IS ONE A ROW CANNOT DECLARE ──────────────────────────────
//
// The general form of the two arms above, and the reason this one exists rather than a third pair for
// the next word. Two of these gaps were live at once: `setup`, which the install wizard's names
// computed, and `credential`, which provider credentials computed under the spelling
// `vendor-credential` while the vocabulary only ever offered `credential`. Both were invisible in the
// same way — a class is computed into an artifact nobody reads line by line, and the declaration that
// disagrees with it is a comment in a different file.
//
// Driven through the real classifier over a catalogue built to reach every branch of it, rather than
// over the live catalogue: the live one is a population that happens to contain what it contains, and
// an arm that reads it would go quiet for any class that momentarily has no members.
test("every class the classifier can compute is a class the vocabulary can declare", () => {
  const specimens = {
    "CLEAROTRON_CLAUDE_PATH": "the install wizard's population",
    "SERPAPI_KEY": "a vendor credential, by the vendor prefix",
    "CLEAROTRON_WORK_DIR": "a place input and output live",
    "CLEAROTRON_STAGE_TIMEOUT_MS": "the residual — how hard a run tries",
  };
  const catalogue = Object.keys(specimens);
  const { rows } = classify({ catalogue, sources: {}, setup: new Set(["CLEAROTRON_CLAUDE_PATH"]),
    readSites: () => null, declared: new Map() });

  // A FLOOR ON THE POPULATION, not a better matcher. Without it a classifier that answered one word to
  // everything would satisfy every assertion below while measuring nothing.
  const produced = [...new Set(rows.map((r) => r.class))].sort();
  assert.ok(produced.length >= 3,
    `the classifier answered ${produced.length} distinct class(es) over four specimens chosen to reach `
    + `four branches (${produced.join(", ")}) — it has stopped discriminating, and the check below `
    + "would pass over a population of one");

  for (const cls of produced) {
    assert.ok(Object.prototype.hasOwnProperty.call(EFFECT_CLASSES, cls),
      `the classifier computes "${cls}" and no catalogue row can declare it: the declared vocabulary is `
      + `${Object.keys(EFFECT_CLASSES).join(", ")}. Either the word joins the vocabulary or the classifier `
      + "computes the word already in it — what it may not do is compute a class nobody can say.");
  }
});
