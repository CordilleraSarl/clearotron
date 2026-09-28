// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A MARK NAMED ONLY INSIDE A REFERENCE SENTENCE IS STILL A MARK THE SCORER PRINTS.
//
// The prose set withholds a sentence whole, which is right for the sentence and does nothing for a
// fragment lifted out of it. `scoreStatements` lifts: it runs the mark extractor over every assertion
// and control and reports each mark it names with the bucket that mark landed in. A mark that appears
// nowhere but inside that sentence was never a value of a name field, so it is in no name set and the
// boundary redactor has nothing to match. On a real score one printed in clear beside a mark that was
// correctly withheld.
//
// THIS IS A THIRD CAUSE, not the width case and not the fused case. In both of those the set holds the
// name and the match fails, so a better matcher fixes them. Here the set never held it.
//
// WHY IT IS FIXED AT THE PRINT SITE. Collecting what the extractor finds into the protected set was
// tried first and measured on a real page: that extractor is a floor rather than a sound extraction, it
// reads capitals, lawyers emphasise in capitals, and the redactor is case-insensitive — so an emphasised
// `REFERENCE` in one gold sentence tokenised every lowercase "reference" on the page. 34 more tokens, 17
// of them from that one word, and a bucket table that read `88% of 8 in-scope «name» marks`. The arms
// below drive the narrow fix; the wide one is recorded here so nobody re-proposes it as an obvious
// improvement.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnvAll } from "../../shared/env-aliases.mjs";   // a spread carries EVERY spelling, so an override must clear every spelling

const SCORE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "score.mjs");

// Invented throughout. ONLYPROSE is the case: it is named in a control sentence and in no field of any
// record, so nothing but that sentence knows it exists.
const ONLY_PROSE = "ONLYPROSE";
const IN_A_FIELD = "TARVELLO";
const ALSO_PROSE = "SECONDPROSE";

function fixture() {
  const store = mkdtempSync(join(tmpdir(), "prose-store-"));
  const run = mkdtempSync(join(tmpdir(), "prose-run-"));
  mkdirSync(join(store, "baselines"));
  writeFileSync(join(store, "baselines", "PR1.gold.json"), JSON.stringify({
    schema_version: 1, scenario: "PR1", mark: IN_A_FIELD,
    source: "synthetic fixture, this test — never a real matter",
    register: [{ mark: IN_A_FIELD, owner: "Dunmarra Holdings", jurisdictions: ["FR"], classes: [42] }],
    // The mark exists here and nowhere else: inside a sentence, in a key that is classified as prose.
    //
    // TWO CONTROLS, because the `why` line only fires when EVERY mark a statement names is unclassified.
    // The first names a reference entry as well, so it reports states and no `why`; the second names
    // prose-only marks alone, which is the shape that produces the UNEVALUATED line.
    controls: [
      `The delivered run of this matter separated ${IN_A_FIELD} from ${ONLY_PROSE} on the register.`,
      `Neither ${ONLY_PROSE} nor ${ALSO_PROSE} was raised by the lawyer as a register conflict.`,
    ],
  }));
  writeFileSync(join(run, "findings.json"), JSON.stringify({ findings: [] }));
  return { store, run };
}

function score(extra = []) {
  const { store, run } = fixture();
  try {
    const r = spawnSync("node", [SCORE, "PR1", "--run", run, ...extra], {
      encoding: "utf8",
      env: pinEnvAll({ ...process.env }, { CLEAROTRON_E2E_DIR: store, CLEAROTRON_WORK_DIR: "" }),
    });
    assert.equal(r.status, 0, `score.mjs refused the fixture:\n${r.stderr}`);
    return `${r.stdout}${r.stderr}`;
  } finally {
    rmSync(store, { recursive: true, force: true });
    rmSync(run, { recursive: true, force: true });
  }
}

test("a mark named only inside a control sentence does not print in clear", () => {
  const out = score();
  assert.ok(!out.includes(ONLY_PROSE), `a mark lifted out of withheld prose reached the page:\n${out}`);
});

test("CONTROL: --names carries it, so the arm above is withholding and not silence", () => {
  const out = score(["--names"]);
  assert.ok(out.includes(ONLY_PROSE), `--names did not carry the mark:\n${out}`);
});

test("the sentence it came from is withheld either way — the row is not a second door onto it", () => {
  const out = score();
  assert.ok(!out.includes("separated"), `the control sentence itself reached the page:\n${out}`);
});

test("the BUCKET STATE is never withheld — it is the finding, the mark is the detail", () => {
  // Without this, withholding the mark could quietly take the row's meaning with it, and a reader would
  // not be able to tell a statement the run answered from one it did not.
  const out = score();
  assert.match(out, /not-in-this-run/,
    `the state must survive the withholding, or the row says nothing:\n${out}`);
});

test("the UNEVALUATED line withholds the marks it lists too", () => {
  // `why` names the same marks in a sentence of its own. Left alone it is the same leak one line down.
  const out = score();
  const line = out.split("\n").find((l) => l.includes("UNEVALUATED")) ?? "";
  assert.ok(line, `the fixture stopped producing an UNEVALUATED line, so this arm proves nothing:\n${out}`);
  assert.ok(!line.includes(ONLY_PROSE), `the why line carried the mark: ${line}`);
  assert.ok(!line.includes(ALSO_PROSE), `the why line carried the other mark: ${line}`);
});

test("CONTROL: --names carries the UNEVALUATED line in full", () => {
  const out = score(["--names"]);
  const line = out.split("\n").find((l) => l.includes("UNEVALUATED")) ?? "";
  assert.ok(line.includes(ONLY_PROSE) || line.includes(ALSO_PROSE),
    `--names did not carry the why line's marks: ${line}`);
});
