// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// every-surface-that-takes-the-manifest-asks-for-the-goods-words.test.mjs
//
// MEASURED ON A PRODUCTION RUN. The matter's goods wording was in the instructed scope, 25 words. The
// dispatch pointed the model at the manual that carries the instruction. The model read the goods and
// reasoned about them — "goods" eighteen times in its output, "products" four, "services" twice — and
// handed back no goods words at all.
//
// It was not disobedience and it was not delivery. The manual ASKED for the key in prose, and every
// surface that tells the model HOW to hand the manifest back omitted it: the recording tool's schema
// had no such property, and the dispatch's per-field imperatives named mark, dominant_element,
// elements, variants, incumbent_classes, watchlist_owners and scope_ledger, and stopped. A field with
// no slot in the thing you hand back is a field nobody fills, however clearly a manual asks.
//
// The arms hold every surface to the same question, because the previous arm — "does the manual
// mention it" — passed throughout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseVariantManifestModel, GOODS_WORDS_MAX } from "../variant-manifest-model.mjs";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");
const read = (...p) => readFileSync(join(ROOT, ...p), "utf8");

test("the stage's own tool call carries the words through to a narrowed search", async () => {
  // THE ARM THAT WOULD HAVE CAUGHT THIS, and the one the previous arms were not. They asked whether
  // the manual mentions the key. This drives what the model actually does: a typed call through the
  // real acceptor, the manifest that acceptor produces, and the plan the compiler mints from it.
  //
  // A typed call cannot carry a key its schema does not declare, and the acceptor REFUSES an
  // undeclared one — so before this fix the call below was not merely ignored, it could not be made.
  const { acceptClearanceVariants, refuseUndeclared } = await import("../clearance-variants-record.mjs");
  const { compileRegisterPlan } = await import("../register-plan.mjs");
  const { CAPABILITIES: CLARIVATE } = await import("../../providers/clarivate/src/capabilities.js");
  const { defaultBuildEntryQuery, planPredicateParams } = await import("../../providers/_shared/execute-plan.mjs");
  const { buildSearchRequest, GOODS_FIELD } = await import("../../providers/clarivate/src/core.js");

  // The call the stage makes, shaped as the tool's schema declares it.
  const call = {
    mark: "INVENTEDMARK", dominant_element: "INVENTEDMARK",
    elements: [{ value: "INVENTEDMARK", kind: "distinctive" }],
    variants: [{ value: "INVENTEDMARK", category: "core", rationale: "the mark itself" }],
    scope_ledger: [{ layer: "variant", item: "the mark", status: "applied", reason: "the mark under search" }],
    goods_words: ["headphones", "wireless headphones"],
  };

  assert.equal(refuseUndeclared(call), null,
    "the acceptor refuses goods_words as an undeclared key, so the stage cannot send it at all");

  const accepted = acceptClearanceVariants(call);
  assert.ok(accepted.ok, `the call was refused: ${accepted.reason}`);
  assert.deepEqual(accepted.model.goods_words, ["headphones", "wireless headphones"],
    "the words did not survive the transport that builds the manifest from the call");

  // …and the compiler mints the narrowed search from that manifest, not from a hand-built one.
  const plan = compileRegisterPlan({ manifest: accepted.model,
    job: { jobKey: "t", classes: ["9"], jurisdictions: [] }, capabilities: CLARIVATE });
  const narrowed = plan.entries.filter((e) => Array.isArray(e.goods_text) && e.goods_text.length);
  assert.equal(narrowed.length, 1, "the manifest carried the words and the plan minted no narrowed entry");

  // …down to the string that reaches the register.
  const query = defaultBuildEntryQuery(narrowed[0], planPredicateParams(narrowed[0]));
  const wire = buildSearchRequest({ ...query, name: "INVENTEDMARK", regions: ["US"] })
    .searchFields.find((f) => f.name === GOODS_FIELD).value;
  assert.equal(wire, "headphones OR wireless ADJ headphones");
});

test("a call that names no goods words still succeeds — the field is optional", async () => {
  const { acceptClearanceVariants } = await import("../clearance-variants-record.mjs");
  const accepted = acceptClearanceVariants({
    mark: "INVENTEDMARK", dominant_element: "INVENTEDMARK",
    elements: [{ value: "INVENTEDMARK", kind: "distinctive" }],
    variants: [{ value: "INVENTEDMARK", category: "core", rationale: "the mark itself" }],
    scope_ledger: [{ layer: "variant", item: "the mark", status: "applied", reason: "the mark under search" }],
  });
  assert.ok(accepted.ok, `a call with no goods words was refused: ${accepted.reason}`);
  // …and it parses to `null`, not `[]`: the stage did not answer. An explicit empty list is the model
  // saying it considered the goods and none apply, which is a different fact about a different thing.
  assert.equal(accepted.model.goods_words, null);
});

test("a repair that sends only part of the call does not delete the goods words", async () => {
  // The seat sends the corrected part; everything else must survive. A loss here reads as "this
  // matter has no goods" rather than as a partial call, which is the quiet direction.
  const { mergeClearanceVariantsCall } = await import("../clearance-variants-record.mjs");
  const stored = { goods_words: ["headphones"], watchlist_owners: ["An Owner"] };
  const merged = mergeClearanceVariantsCall(stored, { mark: "INVENTEDMARK" });
  assert.deepEqual(merged.goods_words, ["headphones"], "a partial repair deleted the goods words");
});

test("the tool the model hands the manifest back through has a slot for the words", () => {
  const server = read("driver", "engine", "mcp", "recording-server.mjs");
  assert.match(server, /goods_words: \{ type: "array", items: \{ type: "string" \}/,
    "the recording tool's schema has no goods_words property, so there is nowhere to put the answer");
});

test("the dispatch tells the model to send them, in its own sentence", () => {
  const stages = read("driver", "stages.mjs");
  assert.match(stages, /Send \\`goods_words\\`/,
    "the dispatch enumerates the fields to send and never names this one");
  // The other fields each carry their own imperative; this one must not be a clause on someone else's.
  assert.match(stages, /Send \\`incumbent_classes\\` and \\`watchlist_owners\\`/, "precondition: the sibling imperative moved");
});

test("the contract declaration lists it among the manifest's keys", () => {
  // Not dispatched, but it is what the contract audit reads: a key the declaration omits is a key
  // nothing checks the stage is being asked for.
  assert.match(read("driver", "stages.mjs"), /watchlist_owners\[\], goods_words\[\]/,
    "the stage contract enumerates the manifest's keys and omits this one");
});

test("the manual still carries the instruction, in the ruled words", () => {
  const manual = read("driver", "skills", "clearance-variants", "SKILL.md");
  assert.match(manual, /`goods_words`/);
  assert.match(manual, /at most 24/);
  assert.match(manual, /cannot read the words and, or, not, adj or near/);
});

test("the parser takes a written key and never drops it — the answer survives", () => {
  // The third thing a reader would want ruled out. It was never the cause, and it must stay that way.
  const base = { schema_version: 1, mark: "X", dominant_element: "X",
    elements: [{ value: "X", kind: "distinctive" }], variants: [{ value: "X", category: "core" }] };
  const words = ["headphones", "wireless headphones", "earphones"];
  assert.deepEqual(parseVariantManifestModel({ ...base, goods_words: words }).goods_words, words,
    "a written goods list did not survive the parse");
  // The bound the schema states is the bound the parser enforces — a model obeying the description
  // must not then fail the stage.
  const many = Array.from({ length: GOODS_WORDS_MAX }, (_, i) => `word${i}`);
  assert.equal(parseVariantManifestModel({ ...base, goods_words: many }).goods_words.length, GOODS_WORDS_MAX);
  assert.throws(() => parseVariantManifestModel({ ...base, goods_words: [...many, "one-too-many"] }),
    /goods_words_invalid/, "the parser accepts more words than the model is told it may send");
});

test("an omitted key and an empty answer are TOLD APART — the finding, closed", () => {
  // THIS ARM USED TO PIN THE DEFECT. It asserted that both arrive as `[]`, which is why a run whose
  // stage could not answer read exactly like a matter with no goods words, and why a narrowing shipped
  // inert for a week with every test green. It was written to fail on the day that changed.
  //
  // This is that day. `null` is asked-and-unanswered; `[]` is answered-none-apply.
  const m = "INVENTEDMARK";
  const base = { schema_version: 1, mark: m, dominant_element: m,
    elements: [{ value: m, kind: "distinctive" }], variants: [{ value: m, category: "core" }] };
  assert.equal(parseVariantManifestModel(base).goods_words, null,
    "an absent key reads as an answer again");
  assert.deepEqual(parseVariantManifestModel({ ...base, goods_words: [] }).goods_words, [],
    "an explicit `none` was thrown away");
  assert.notDeepEqual(parseVariantManifestModel(base).goods_words,
    parseVariantManifestModel({ ...base, goods_words: [] }).goods_words,
    "the two are the same value again — a skipped question would read as a considered one");
});
