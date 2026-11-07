// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE PAGES SAY WHAT THE SERPAPI KEY SEARCHES, IN ONE SENTENCE, AND THE SENTENCE IS THE CODE'S.
//
// A newcomer on a beta met three accounts of SerpAPI (measured 2026-11-04). Setup asked for the key "for
// the open-web and marketplace grid", the provider table described it in the code's own words, and the
// README and the quickstart did not mention it at all ("One research key"). The code uses it for one
// thing: the Chinese-language search, which dials Baidu across Chinese marketplaces, and only where the
// native-language investigation covers a territory read in Chinese.
//
// EACH PART OF THE SENTENCE IS HELD TO THE TABLE IT RESTATES: the languages that have a search-engine
// grid, the engine that grid dials, and the territories read in Chinese. The place names are the one
// thing typed here, keyed by the territory codes the table holds, so a territory added there with no name
// here goes red rather than leaving the pages one place short.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SERP_LANES, JURISDICTION_ADAPTERS } from "../jx-lanes.mjs";
import { SERP_ENGINES } from "../../providers/serpapi/src/core.js";
import { SERP_PROVIDERS } from "../driver.config.mjs";
import { providerInventory } from "../config-inventory.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const flat = (f) => readFileSync(join(ROOT, f), "utf8").replace(/\s+/g, " ");
const PAGES = ["README.md", "QUICKSTART.md", "INSTALL.md", "providers/README.md"];
const PLACES = { CN: "China", HK: "Hong Kong", TW: "Taiwan", MO: "Macau" };

test("the only search-engine grid is the Chinese one, and it dials one engine", () => {
  assert.deepEqual(Object.keys(SERP_LANES), ["zh"], "a language other than Chinese now has a search-engine grid; the pages say Chinese only");
  assert.deepEqual(Object.keys(SERP_ENGINES), [SERP_LANES.zh.engine], "the grid dials an engine the pages do not name");
  assert.equal(SERP_PROVIDERS.serpapi.credEnv, "SERPAPI_API_KEY");
});

test("a missing key leaves a gap in the result, never a refusal", async () => {
  const saved = process.env.SERPAPI_API_KEY;
  delete process.env.SERPAPI_API_KEY;
  try {
    const r = await SERP_PROVIDERS.serpapi.search({ engine: SERP_LANES.zh.engine, term: "IRONWHISK", site: SERP_LANES.zh.platforms[0], count: 1 });
    assert.equal(r.ok, false);
    assert.match(r.cause, /SERPAPI_API_KEY absent/, "a missing key does not come back as a named gap");
  } finally {
    if (saved !== undefined) process.env.SERPAPI_API_KEY = saved;
  }
});

test("every page that lists the research keys says what the SerpAPI key searches, in the same words", () => {
  const codes = Object.entries(JURISDICTION_ADAPTERS).filter(([, a]) => a.lane === "zh").map(([code]) => code);
  assert.deepEqual([...codes].sort(), Object.keys(PLACES).sort(), "the territories read in Chinese are not the four the pages name");
  const names = codes.map((c) => PLACES[c]);
  const places = `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
  const engine = SERP_LANES.zh.engine[0].toUpperCase() + SERP_LANES.zh.engine.slice(1);
  for (const page of PAGES) {
    const text = flat(page);
    assert.ok(text.includes("SERPAPI_API_KEY"), `${page} does not name the SerpAPI key`);
    assert.ok(text.includes(`Only the native-language investigation of ${places}`), `${page} does not say which searches use the SerpAPI key`);
    assert.ok(text.includes(`the Chinese marketplaces through ${engine}`), `${page} does not say what the SerpAPI key searches`);
    assert.match(text, /those marketplaces come back as a disclosed gap/i, `${page} does not say what happens without the SerpAPI key`);
    assert.doesNotMatch(text, /open-web and marketplace grid|search-engine grid inside the CJK/, `${page} still describes the SerpAPI key the old way`);
  }
});

test("setup and the portal's settings list describe the SerpAPI key in the pages' words", () => {
  assert.equal(SERP_PROVIDERS.serpapi.absentMeans, "the Chinese marketplaces come back as a disclosed gap");
  const setup = flat("bin/onboard.mjs");
  assert.ok(setup.includes('["the Chinese marketplace search", SERP_PROVIDERS]'), "setup does not say what the SerpAPI key is used for");
  assert.doesNotMatch(setup, /open-web and marketplace grid/, "setup still describes the SerpAPI key the old way");
  const row = providerInventory({}).find((r) => r.provider === "serpapi");
  assert.equal(row?.label, "Chinese marketplace search", "the settings list does not name what the SerpAPI key searches");
});
