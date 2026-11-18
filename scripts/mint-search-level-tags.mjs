#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// mint-search-level-tags.mjs — write the short name of each search the product sells, from the registry.
//
// The Clearances list prints a tag under each name, one per kind of search behind it, and offers the same
// tags as a filter: "KO", "Prelim", "Multi", "Full". Each tag lives on its product's own row in
// driver/search-policy.mjs (`report.tag`, beside the `identity` the report's masthead prints), so a product
// cannot ship without naming its own. The browser cannot import the registry, so this writes the part it
// needs, in the registry's order, to shared/search-level-tags.json, which the page imports.
//
// The page never keeps a list of its own. The portal once held its own table from product to label, and it
// listed only the retired products, so every new run showed a blank label. A retired product has no tag
// and is left out here: its runs show no tag and appear only under All.
//
//   node scripts/mint-search-level-tags.mjs           write the file
//   node scripts/mint-search-level-tags.mjs --check   exit 1 if the committed file disagrees with the registry

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(REPO, "shared", "search-level-tags.json");

/** The file's content, derived fresh: one `{product, tag, name}` per orderable product, in the registry's order. */
export async function deriveSearchLevelTags() {
  const { PRODUCT_POLICIES, ORDERABLE_PRODUCTS } = await import("../driver/search-policy.mjs");
  const levels = ORDERABLE_PRODUCTS.map((product) => {
    const report = PRODUCT_POLICIES[product]?.report ?? {};
    // Refuse rather than write a blank: a product with no tag would show nothing under its names and have no
    // button, which reads as "no searches of this kind" rather than as a missing name.
    if (typeof report.tag !== "string" || !report.tag.trim()) throw new Error(`${product}: the registry gives it no report.tag`);
    if (typeof report.identity !== "string" || !report.identity.trim()) throw new Error(`${product}: the registry gives it no report.identity`);
    return { product, tag: report.tag, name: report.identity };
  });
  return {
    _generated: "by scripts/mint-search-level-tags.mjs from driver/search-policy.mjs PRODUCT_POLICIES — do not edit; re-mint",
    levels,
  };
}

const render = (doc) => JSON.stringify(doc, null, 2) + "\n";

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const next = render(await deriveSearchLevelTags());
  if (process.argv.includes("--check")) {
    let current;
    try { current = readFileSync(OUT, "utf8"); }
    catch { console.error(`mint-search-level-tags: ${OUT} is missing — run without --check to mint it.`); process.exit(1); }
    if (current === next) {
      console.log(`search-level-tags: current, ${JSON.parse(current).levels.length} level(s).`);
      process.exit(0);
    }
    console.error("search-level-tags: the committed file disagrees with the registry — re-mint: node scripts/mint-search-level-tags.mjs");
    process.exit(1);
  }
  writeFileSync(OUT, next);
  console.log(`search-level-tags: wrote ${JSON.parse(next).levels.length} level(s) to ${OUT}`);
}
