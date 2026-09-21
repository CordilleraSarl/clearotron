// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-skipped-question-is-not-an-answer.test.mjs — `null` and `[]` are different answers.
//
// THIS IS WHY A NARROWING SHIPPED INERT FOR A WEEK. The variants stage could not send `goods_words` at
// all — the tool's schema had no such property — so every manifest carried an empty list, the compiler
// minted no narrowed entry, and the run was indistinguishable from a matter that genuinely had no
// goods words to narrow by. Nobody could tell "the stage was never able to answer" from "the stage
// answered, and none applied". It took a person reading a 27,000-character stage output by hand.
//
// So the two are now distinct all the way through: `null` is asked-and-unanswered, `[]` is
// answered-none-apply, and the plan records which one it got. A skipped question is a fact about the
// RUN; an empty answer is a fact about the MATTER.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseVariantManifestModel } from "../variant-manifest-model.mjs";
import { compileRegisterPlan } from "../register-plan.mjs";
import { CAPABILITIES as CLARIVATE } from "../../providers/clarivate/src/capabilities.js";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");
const BASE = { schema_version: 1, mark: "INVENTEDMARK", dominant_element: "INVENTEDMARK",
  elements: [{ value: "INVENTEDMARK", kind: "distinctive" }],
  variants: [{ value: "INVENTEDMARK", category: "core" }], incumbent_classes: [] };
const JOB = { jobKey: "t", classes: ["9"], jurisdictions: [] };

test("the parser keeps the two apart", () => {
  assert.equal(parseVariantManifestModel(BASE).goods_words, null,
    "an absent key parses to an empty list — a stage that never answered reads as one that answered none");
  assert.deepEqual(parseVariantManifestModel({ ...BASE, goods_words: [] }).goods_words, [],
    "an explicit empty answer was thrown away");
  assert.deepEqual(parseVariantManifestModel({ ...BASE, goods_words: ["headphones"] }).goods_words, ["headphones"]);
});

test("the plan says which one it got, and only when it is the bad one", () => {
  const plan = (goods_words) => compileRegisterPlan({ manifest: { ...BASE, goods_words }, job: JOB, capabilities: CLARIVATE });

  assert.equal(plan(null).goods_words_unanswered, true,
    "a stage that never answered leaves no trace on the plan — the run cannot say the question was skipped");
  // An answered "none" is a fact about the matter, not about the run, so the plan says nothing.
  assert.ok(!("goods_words_unanswered" in plan([])),
    "an answered `none` was recorded as a skipped question");
  assert.ok(!("goods_words_unanswered" in plan(["headphones"])));
});

test("both compile no narrowed entry — the distinction is the record, not the search", () => {
  // There is nothing to narrow BY in either case, so neither mints an entry. What differs is whether
  // the run can say why. A reader must not have to infer a skipped question from an absence.
  for (const goods_words of [null, []]) {
    const p = compileRegisterPlan({ manifest: { ...BASE, goods_words }, job: JOB, capabilities: CLARIVATE });
    assert.equal(p.entries.filter((e) => Array.isArray(e.goods_text) && e.goods_text.length).length, 0);
  }
  const answered = compileRegisterPlan({ manifest: { ...BASE, goods_words: ["headphones"] }, job: JOB, capabilities: CLARIVATE });
  assert.equal(answered.entries.filter((e) => Array.isArray(e.goods_text) && e.goods_text.length).length, 1);
});

test("a plan whose stage answered is byte-identical to before", () => {
  // The new field must not appear on the ordinary plan, or every stored plan re-mints for a fact that
  // was always true of it.
  const p = compileRegisterPlan({ manifest: { ...BASE, goods_words: ["headphones"] }, job: JOB, capabilities: CLARIVATE });
  assert.ok(!("goods_words_unanswered" in p));
});

test("the model is told the two are different, where it answers and where it reads", () => {
  // A distinction the code keeps and the instruction does not state is a distinction the model cannot
  // honour: it would go on omitting the key when it means "none apply", and every such run would
  // record a skipped question that was not skipped.
  const manual = readFileSync(join(ROOT, "driver", "skills", "clearance-variants", "SKILL.md"), "utf8");
  assert.match(manual, /empty list/, "the manual does not tell the model to answer `none` explicitly");
  assert.match(manual, /different answers/, "the manual does not say the two differ");

  const server = readFileSync(join(ROOT, "driver", "engine", "mcp", "recording-server.mjs"), "utf8");
  const near = server.slice(server.indexOf("goods_words:"), server.indexOf("goods_words:") + 1600);
  assert.match(near, /EMPTY\s+"\s*\+\s*"\s*LIST|EMPTY LIST/, "the tool's own description does not state the distinction");
});
