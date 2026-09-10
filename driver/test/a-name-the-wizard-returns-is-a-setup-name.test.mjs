// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A name the install wizard writes is a setup name, however the wizard writes it.
//
// `scripts/env-classify.mjs` tells what the wizard writes at install from what nobody sets, and the second
// is the population a configuration cleanup deletes from. The sign-in step hands back the `.env` keys it
// wants written, and the wizard merges them in with `Object.assign(candidate, …)`. The classifier read
// every other way the wizard writes a name and not that one, so both names the step writes fell through to
// a shape: the organisation's name to `tuning`, the residual bucket, and the signing-in address to
// `deployment` by its listed audience. Measured 2026-09-10 over both contract files: the setup population
// was 24 names and is 26 with the merge read, those two, and no other catalogued name changed class.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupNames, classify } from "../../scripts/env-classify.mjs";
import { askSignIn } from "../../bin/onboard.mjs";

const NOBODY = { prod: new Set(), test: new Set(), config: new Set(), ci: new Set(), e2e: new Set(), docs: new Set() };

/** A root holding a planted wizard, and the table file `setupNames` refuses without. */
function plantWizard(lines) {
  const root = mkdtempSync(join(tmpdir(), "env-setup-"));
  mkdirSync(join(root, "bin"));
  mkdirSync(join(root, "driver"));
  writeFileSync(join(root, "bin", "onboard.mjs"), lines.join("\n") + "\n");
  writeFileSync(join(root, "driver", "driver.config.mjs"), "export const ENGINES = [];\n");
  return root;
}

test("every key the sign-in step returns is a name the classifier knows the wizard writes", async () => {
  // DRIVEN, not read: the step is called and its answer's keys are the population, so a key added to its
  // return later is held here without anybody listing it.
  const written = await askSignIn({ askValue: async () => "Example Sàrl" }, { localAccount: "someone" });
  const keys = Object.keys(written);
  assert.ok(keys.length >= 2, `the sign-in step returned ${keys.length} key(s), so this arm would check almost nothing`);
  const setup = setupNames();
  assert.deepEqual(keys.filter((k) => !setup.has(k)), [],
    "the wizard writes these at install and the classifier does not know it, so each falls to a shape");
});

test("the organisation's name and the signing-in address classify as setup, and neither is a knob", () => {
  // NAMED as well as driven: a refactor that moves the return where the reader cannot see it has to red
  // here, rather than shrink the population by two and leave the arm above passing over nothing.
  const setup = setupNames();
  const names = ["CLEAROTRON_ORGANISATION_NAME", "PORTAL_LOCAL_USER"];
  const { rows, buckets } = classify({ catalogue: names, sources: NOBODY, setup, readSites: () => null });
  for (const r of rows) assert.equal(r.class, "setup", `${r.name} is written by the wizard and classified ${r.class}`);
  assert.deepEqual(buckets["deletable-number"], [], "a name the wizard writes is on the deletion population");
  // A FLOOR ON THE POPULATION, not only on its members. Measured 26 on 2026-09-10. Below 24 a reader has
  // lost more than a retirement explains, and every name it lost has fallen to a shape.
  assert.ok(setup.size >= 24, `the setup population is ${setup.size} names; a reader has stopped reading`);
});

test("the reader follows the merge, not a spelling: another helper, another call, every return", () => {
  const setup = setupNames(plantWizard([
    "const candidate = {};",
    "const LABELS = { NOT_WRITTEN_BY_ANYONE: 'a table the wizard never merges' };",
    "function pickPlace(io, { base = '{' } = {}) {",
    "  // return { IN_A_COMMENT: 1 } is prose",
    "  if (io.remote) return { PLANTED_REMOTE_DIR: io.remote, \"PLANTED_QUOTED\": 'x, y' };",
    "  const note = 'return { IN_A_STRING: 1 }';",
    "  return { PLANTED_LOCAL_DIR: `${base}/here`, PLANTED_NESTED: { NOT_A_NAME: 1 } };",
    "}",
    "Object.assign(candidate, pickPlace(io));",
  ]));
  for (const n of ["PLANTED_REMOTE_DIR", "PLANTED_QUOTED", "PLANTED_LOCAL_DIR", "PLANTED_NESTED"])
    assert.ok(setup.has(n), `${n} is returned into what the wizard writes and was not read`);
  for (const n of ["NOT_WRITTEN_BY_ANYONE", "IN_A_COMMENT", "IN_A_STRING", "NOT_A_NAME"])
    assert.ok(!setup.has(n), `${n} is not written by the wizard and was read as though it were`);
});

test("a merged helper the wizard does not define refuses, rather than reading as no names", () => {
  const root = plantWizard([
    "import { askElsewhere } from './elsewhere.mjs';",
    "const candidate = {};",
    "Object.assign(candidate, await askElsewhere());",
  ]);
  assert.throws(() => setupNames(root), /askElsewhere\(\) returns, and no function askElsewhere is defined there/);
});

test("a merged helper whose returns name no key refuses too", () => {
  const root = plantWizard([
    "const candidate = {};",
    "function build() { const o = {}; o.PLANTED = 1; return o; }",
    "Object.assign(candidate, build());",
  ]);
  assert.throws(() => setupNames(root), /build\(\) returns, and none of its returns is an object literal naming a key/);
});
