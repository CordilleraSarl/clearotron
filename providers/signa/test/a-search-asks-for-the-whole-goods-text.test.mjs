// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-search-asks-for-the-whole-goods-text.test.mjs — every search asks the register for each goods statement whole.
//
// THE DEFECT. The register's default answer carries "the first 280 characters" of each goods statement and flags
// the ones it cut; `include: ["full_goods_services"]` returns the full text instead (docs.signa.so, Search
// Trademarks). The request never asked, so the band held each long statement cut, and the full record was fetched
// only at delivery, after the writer had written, so a cited record's classes could be written up as "cut and unread"
// while the run went on to fetch them whole.
//
// No vendor measurements and no mark live here; the server below is local and its bodies are invented.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "signa-whole-goods-"));
process.env.CLEAROTRON_REGISTER_CALL_LOG = join(TMP, "calls.jsonl");
const { buildSearchRequest, doSearch, normalizeSearchResponse } = await import("../src/core.js");
after(() => rmSync(TMP, { recursive: true, force: true }));

const TERM = "VELQUARIN";
const LONG = `Providing scientific research in the field of invented compounds; ${"providing information about invented compounds; ".repeat(12)}all of the foregoing for invented uses`;
const answer = () => ({
  object: "list", has_more: false,
  pagination: { cursor: null, total_count: 1, total_count_approximate: false },
  search_meta: { search_id: "srch_invented", similarity_applied: ["identical"] },
  data: [{ id: "tm_invented", jurisdiction_code: "US", mark_text: TERM,
    classifications: [{ nice_class: 42, goods_services_text: LONG, goods_services_text_truncated: false }] }],
});

/** A local register: answers every request with `answer()`, and records what it was sent. */
async function register() {
  const seen = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      seen.push(JSON.parse(raw || "{}"));
      res.writeHead(200, { "Content-Type": "application/json", "x-credits-charged": "10" });
      res.end(JSON.stringify(answer()));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${server.address().port}`, seen, close: () => new Promise((r) => server.close(r)) };
}

test("every search request asks for the whole goods text, at the top level, beside the total", () => {
  const body = buildSearchRequest({ query: TERM });
  assert.deepEqual(body.include, ["full_goods_services"]);
  assert.equal(body.options.include_total, true, "the total is still asked for");
  assert.equal(body.options.include, undefined, "the register reads `include` at the top level, not under `options`");
});

test("the rows of an answer to that request say they were asked for it; rows of any other answer do not", async () => {
  const reg = await register();
  try {
    const out = await doSearch("k", reg.base, { query: TERM }, null);
    assert.deepEqual(reg.seen[0].include, ["full_goods_services"], "the request the register received asked for the whole text");
    const rows = JSON.parse(out.text).results;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].goods_whole, true);
    assert.equal(rows[0].raw.classifications[0].goods_services_text.length > 280, true, "precondition: a statement past the default cut");
  } finally { await reg.close(); }
  // An answer read without the request beside it (a fixture, an older saved answer) makes no such claim.
  assert.equal(normalizeSearchResponse(answer(), TERM).results[0].goods_whole, undefined);
});
