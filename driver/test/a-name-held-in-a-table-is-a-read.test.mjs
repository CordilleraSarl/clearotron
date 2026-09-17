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
import { namesRead, auditEnv, auditCatalogue, declaredEffects } from "../../scripts/env-audit.mjs";
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
