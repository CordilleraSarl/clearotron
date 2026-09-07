// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// variant-category-brief.test.mjs —, the six category names that were given without meanings.
//
// THE DEFECT. R2 BIOVELTRIN, delivered 2026-08-06, lost DELPHI SCIENTIFIC and DELFITY with
// `withheld: 0` — never retrieved, so no downstream judgment could have recovered them. The variant
// dispatch named a closed seven-token enum and defined none of it. The model inferred what the words
// meant and generated against its own inference: `composite` came out as the applicant's own sector
// vocabulary, and `phonetic` never reached an elided middle.
//
// WHAT IS PINNED HERE, AND WHY IT IS THE ENUM AND NOT THE PROSE. Asserting the wording would pin an
// essay nobody may edit; asserting nothing lets the next category ship undefined, which is this bug.
// So the property is the JOIN: every token in the dispatch's own enum carries a definition, read off
// the source rather than from a list retyped here. Add `"morphological"` to the enum and this file
// fails until it is briefed — which is the whole guarantee. It is the CONNOTATION_REASONS shape,
// applied to the other closed vocabulary in this stage.
//
// The two lost marks appear NOWHERE in this file. The ruling names them as tripwires for a re-run, not
// as a target: a definition written so those two strings appear is written to the answer sheet, and the
// ruling calls that a fail. The categories are tested for having a meaning, never for reaching a mark.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { STAGES, VARIANT_CATEGORY_BRIEF } from "../stages.mjs";
import { VARIANT_CATEGORIES } from "../variant-manifest-model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "stages.mjs"), "utf8");

/**
 * The category enum, RE-DERIVED (conversion 3).
 *
 * It used to be scraped out of the dispatch with a regex over the literal JSON skeleton
 * (`"category":"core"|"phonetic"|…`). That skeleton is gone — the seat sends typed values and
 * `record_prelim_variants`'s schema carries the enum — so this now reads the CANONICAL constant that both
 * the parser and the tool schema use. Re-derived, not deleted, exactly as the old assertion demanded:
 * the check is about the brief defining every category and no others, and that question did not change.
 */
function enumInSource() {
  assert.ok(Array.isArray(VARIANT_CATEGORIES) && VARIANT_CATEGORIES.length >= 5,
    "the variants[] category enum is no longer where this test reads it — re-derive it, do not delete the check");
  return [...VARIANT_CATEGORIES];
}

const P = { matterContext: "/m/matter-context.md", variantManifest: "/m/v.md", variantManifestModel: "/m/v.json" };
const JOB = { jobKey: "t", marks: [{ name: "VELTRA" }], classes: ["5"], jurisdictions: ["CH"] };

test("#445 every category the dispatch enumerates carries a definition — an undefined one is the whole defect", () => {
  const cats = enumInSource();
  assert.ok(cats.length >= 7, `expected the full enum, got ${cats.length}`);
  for (const c of cats) {
    assert.ok(VARIANT_CATEGORY_BRIEF.includes(`- "${c}":`),
      `category "${c}" is offered to the model with no definition — this is exactly what lost two marks at withheld:0`);
  }
});

test("#445 the brief defines nothing that is not in the enum — a definition for a dead token teaches a wrong family", () => {
  const cats = new Set(enumInSource());
  for (const m of VARIANT_CATEGORY_BRIEF.matchAll(/^- "([a-z]+)":/gm))
    assert.ok(cats.has(m[1]), `the brief defines "${m[1]}", which the model may not emit — the enum would refuse it`);
});

test("#445 each definition says what the category is DRAWN FROM, and carries a worked example", () => {
  for (const c of enumInSource()) {
    const body = new RegExp(`- "${c}":([\\s\\S]*?)(?=\\n- "|\\nCOVER EVERY)`).exec(VARIANT_CATEGORY_BRIEF)?.[1] ?? "";
    assert.ok(body.length > 80, `"${c}" has a stub, not a definition (${body.length} chars)`);
    // "what it is drawn from" is the half that makes a category generatable rather than nameable.
    assert.match(body, /[Dd]rawn from|the mark itself|none of the six/,
      `"${c}" never says what it is drawn from — a name with a gloss is still a name`);
  }
});

test("#445 every category carries a worked example — except the one that documents why it cannot", () => {
  for (const c of enumInSource()) {
    const body = new RegExp(`- "${c}":([\\s\\S]*?)(?=\\n- "|\\nCOVER EVERY)`).exec(VARIANT_CATEGORY_BRIEF)?.[1] ?? "";
    if (c === "other") {
      // The residual category is the one place an example would do harm — it would narrow the category
      // whose job is to stay open. That is a decision, so the brief has to STATE it rather than just
      // omit the example, and this asserts the statement is there.
      assert.match(body, /carries no worked example on purpose/,
        `"other" has no example and no reason given — indistinguishable from an oversight`);
      continue;
    }
    assert.match(body, /\([A-Z][A-Z0-9]* (→|scoped|in class)/,
      `"${c}" has no worked example; a paralegal copies the shape from the example, not the sentence`);
  }
});

test("#445 composite is briefed AWAY from the client's own sector — the ruled definition, not a paraphrase", () => {
  const body = /- "composite":([\s\S]*?)(?=\n- ")/.exec(VARIANT_CATEGORY_BRIEF)[1];
  // The ruling's own words: paired with a word that could plausibly follow it ON THE GOODS IN SCOPE,
  // NOT with the words the client's own sector uses. Both halves, because the second is the corrective
  // one — seven descriptors were generated and every one came from the applicant's own field.
  assert.match(body, /GOODS AND\s+SERVICES IN SCOPE/, "the positive half of the ruled definition is missing");
  assert.match(body, /not with the words your client's own sector uses/,
    "the corrective half is missing — this is the sentence the lost stem-plus-descriptor mark turns on");
});

test("#445 phonetic reaches an elided or shortened middle — read narrowly it is a search nobody runs", () => {
  const body = /- "phonetic":([\s\S]*?)(?=\n- ")/.exec(VARIANT_CATEGORY_BRIEF)[1];
  assert.match(body, /ELIDED MIDDLE SYLLABLE IS INSIDE THIS CATEGORY/,
    "nothing tells the stage how far phonetic reaches, which is how a fuzzy neighbour goes unsearched");
  assert.match(body, /sound and never from the spelling|sound and never|HEARS/,
    "phonetic must be drawn from the sound; read as a spelling rule it collapses into `visual`");
});

test("#445 the brief is DISPATCHED, not merely exported — an unwired constant briefs nobody", () => {
  const msg = STAGES["prelim-variants"].message({ paths: P, job: JOB, profile: {} });
  assert.ok(msg.includes(VARIANT_CATEGORY_BRIEF), "prelim-variants does not carry the category brief");
  // It must land AFTER the enum it defines: a definition the model reads before the field it applies to
  // is a definition it has to hold in mind, and this stage is already long.
  assert.ok(msg.indexOf(`"category":`) < msg.indexOf(VARIANT_CATEGORY_BRIEF),
    "the brief must follow the enum it defines, not precede it");
});

test("#445 the funnel got a brief, not a filter — no term list, no stem rule, no mark enumeration", () => {
  // The ruling rejects "a decomposition pass, a prefix list, a stem-expansion rule" by name. The check
  // that this stays a BRIEF is that code still mints no search term: every example is parenthesised and
  // attached to a coined illustration mark, and none of them is derived from the job.
  const msg = STAGES["prelim-variants"].message({ paths: P, job: JOB, profile: {} });
  assert.ok(!/VELTRA PHARMA["']?\s*\)/.test(msg.replace(VARIANT_CATEGORY_BRIEF, "")),
    "an example escaped the brief into the dispatch body");
  // The job's own mark must not appear inside the brief — that would be code minting this matter's terms.
  assert.ok(!VARIANT_CATEGORY_BRIEF.includes(JOB.marks[0].name.slice(0, 4) + " "),
    "the brief must be matter-independent; it is a definition, never a seed");
});
