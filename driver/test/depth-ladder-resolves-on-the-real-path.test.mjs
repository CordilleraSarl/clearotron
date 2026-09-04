// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — the ladder resolves THROUGH attachSearchPolicy, which is the only way a run ever gets one.
//
// THIS FILE EXISTS BECAUSE THE LADDER SHIPPED DEAD AND EVERY OTHER ARM STAYED GREEN.
//
// `depthFor` read `policy.product`. The frozen policy attachSearchPolicy actually writes is
// {schema, level, pipeline, stageLabel, …} — the product key lands in `level`, and `origins.level` says
// so: "job.product". So `ctx.searchPolicy` resolved to `default-ungraded` on EVERY run, every rung
// returned "", and the whole ladder ran at one-country depth. Nothing threw. The table test passed, the
// rung tests passed, and the reach test passed — because all of them called `depthFor({product})`
// directly and never once went through the resolver a run uses.
//
// The lesson is the shape of the arms below: resolve the way production resolves, then read.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { attachSearchPolicy } from "../pipeline.mjs";
import { STAGES, variantRungDirective } from "../stages.mjs";
import { PRODUCT_POLICIES } from "../search-policy.mjs";

const EXPECTED_SOURCE = {
  "global-preliminary-search": "global-preliminary-search",
  "multi-country-focus-search": "multi-country-focus-search",
  "full-country-search": "full-country-search",
  "knockout-search": "ungraded:knockout-search",
};

/** Resolve exactly as a run does: mint the frozen sidecar cold, then read it back as a repair would. */
function resolve(product) {
  const runDir = mkdtempSync(join(tmpdir(), "depth-real-"));
  mkdirSync(join(runDir, "_driver"), { recursive: true });
  const job = { product, mark: "TESTMARK", classes: [25], territories: ["CH"] };
  const cold = { profile: { key: "demo" }, paths: { runDir } };
  attachSearchPolicy(cold, job, { write: true });
  const warm = { profile: { key: "demo" }, paths: { runDir } };
  attachSearchPolicy(warm, job, { write: false });   // reconstructCtx / --experiment / repairStale
  return { cold, warm };
}

test("#1503 every product resolves to ITS OWN row through the real attach path", () => {
  for (const product of Object.keys(PRODUCT_POLICIES)) {
    const { cold } = resolve(product);
    assert.ok(cold.depth, `${product} attached no depth at all`);
    assert.equal(cold.depth.source, EXPECTED_SOURCE[product],
      `${product} resolved to "${cold.depth.source}". If that is default-ungraded, the ladder is dead on `
      + "the real path and every direct-call test in this suite will still be green.");
  }
});

test("#1503 the graded products really are graded AFTER resolution — not just in the table", () => {
  const oneCountry = resolve("full-country-search").cold.depth;
  for (const product of ["global-preliminary-search", "multi-country-focus-search"]) {
    const graded = resolve(product).cold.depth;
    const differs = Object.keys(PRODUCT_POLICIES["full-country-search"].depth)
      .filter((k) => graded[k] !== oneCountry[k]);
    assert.ok(differs.length > 0,
      `${product} resolved to something identical to one-country in every field. The table may grade it, `
      + "but nothing a run can see does.");
  }
});

test("#1503 a REPAIR or --experiment dispatch resolves identically to the cold pass", () => {
  for (const product of Object.keys(PRODUCT_POLICIES)) {
    const { cold, warm } = resolve(product);
    assert.deepEqual({ ...warm.depth }, { ...cold.depth },
      `${product}'s reconstructed depth differs from its cold one. A stale-repair or --experiment arm `
      + "would dispatch a different prompt than the run it is repairing, and the run record would not say so.");
  }
});

test("#1503 THE PROMPT a resolved ctx builds carries the rung — end to end, no hand-built depth", () => {
  const paths = new Proxy({}, { get: (_t, k) => (typeof k === "string" ? `<${k}>` : undefined) });
  const message = (product) => {
    const { cold } = resolve(product);
    return STAGES["prelim-variants"].message({
      ...cold, paths, job: { mark: "TESTMARK", classes: [25], territories: ["CH"] }, profile: { key: "demo" },
    });
  };
  const baseline = message("full-country-search");
  const graded = message("global-preliminary-search");
  assert.notEqual(graded, baseline,
    "a fully resolved worldwide ctx produced the same prompt as a one-country one. This is the arm that "
    + "fails when the ladder is wired, tested, green and dead.");
  assert.ok(graded.includes(variantRungDirective(resolve("global-preliminary-search").cold.depth)),
    "the prompt changed, but not by the rung's own text");
  assert.equal(message("knockout-search"), baseline,
    "an ungraded product's prompt moved — the fallback must be one-country's, byte for byte");
});

test("#1503 the frozen policy's field name is PINNED — this is the fact the bug turned on", () => {
  const { cold } = resolve("global-preliminary-search");
  assert.equal(cold.searchPolicy.level, "global-preliminary-search",
    "the frozen policy stopped carrying the product key in `level`");
  assert.equal(cold.searchPolicy.product, undefined,
    "the frozen policy grew a `product` field. That is fine, but depthFor's fallback order now decides "
    + "which one wins — read it before assuming they agree.");
});
