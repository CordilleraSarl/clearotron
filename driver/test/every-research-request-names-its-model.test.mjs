// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// EVERY RESEARCH REQUEST NAMES ITS MODEL (providers/perplexity/src/core.js, RESEARCH_MODEL).
//
// Each research effort's default model is the vendor's to move, so the product names the model on every research
// request: questions at each product's pinned effort, the grids, the Knockout's sweep and owner lookups, and the meaning
// re-asks. The effort, tools and search scope stay the request's own. Setup's one-word key check, on `fast`, is left to
// its default, and a model a caller names explicitly wins.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRequestBody, researchModelFor, RESEARCH_MODEL } from "../../providers/perplexity/src/core.js";

test("each research effort names the model, and nothing else about the request changes", () => {
  assert.equal(RESEARCH_MODEL, "openai/gpt-6.2-sol");
  for (const preset of ["pro-search", "deep-research", "advanced-deep-research", "low", "medium", "high", "xhigh"]) {
    const named = buildRequestBody({ task: "Who sells QZORVEL candles?", preset, allowFetch: true, domainFilter: ["shop.example.com"] });
    assert.equal(named.model, RESEARCH_MODEL, preset);
    const { model, ...rest } = named;
    const bare = buildRequestBody({ task: "Who sells QZORVEL candles?", preset, allowFetch: true, domainFilter: ["shop.example.com"], modelOverride: "x" });
    delete bare.model;
    assert.deepEqual(rest, bare, `${preset}: only the model was added`);
  }
  const grid = buildRequestBody({ task: "run the grid", preset: "pro-search", enableSandbox: true, reasoning: { effort: "low" } });
  assert.deepEqual({ model: grid.model, preset: grid.preset, tools: grid.tools.map((t) => t.type), reasoning: grid.reasoning },
    { model: RESEARCH_MODEL, preset: "pro-search", tools: ["sandbox", "web_search"], reasoning: { effort: "low" } }, "a grid keeps its effort, tools and reasoning");
});

test("setup's key check keeps its effort's default, and an explicit model wins", () => {
  assert.equal(researchModelFor("fast-search"), null);
  assert.equal(researchModelFor("fast"), null);
  assert.equal("model" in buildRequestBody({ task: "Reply with the single word: ok.", preset: "fast-search" }), false);
  assert.equal(buildRequestBody({ task: "x", preset: "medium", modelOverride: "openai/gpt-6-luna" }).model, "openai/gpt-6-luna");
});
