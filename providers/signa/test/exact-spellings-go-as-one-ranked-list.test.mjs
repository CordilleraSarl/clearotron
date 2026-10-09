// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// exact-spellings-go-as-one-ranked-list.test.mjs — an exact spelling band is one request per 100 spellings.
//
// THE CHANGE. The register takes a list in `q` as a ranked search over every spelling, through the
// channels the request names, and says on each record which spellings found it. On the exact channels it
// takes up to 100 spellings, and measured against one search per spelling it returned the same records.
// So an exact spelling band no longer costs one request per spelling: the kernel sends each stack of up to
// 100 as one request. The sound-alike band followed (ruled 2026-10-09): up to 10 spellings and 30 words per
// request. Every other band (typo, starts-with, wildcard, owner) stays at one term per request.
//
// No vendor measurements and no mark live here; the server is local and its bodies are invented.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "signa-list-"));
process.env.CLEAROTRON_REGISTER_CALL_LOG = join(TMP, "calls.jsonl");
const { doEnumerate, doExecutePlan, namesChunkFor, buildSearchRequest } = await import("../src/core.js");
after(() => rmSync(TMP, { recursive: true, force: true }));

const spellings = (n) => Array.from({ length: n }, (_, i) => `ZYTHERM${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26)}`);

/** A register that answers each request with one record per term it was sent, tagged with that term. */
async function register({ total = null } = {}) {
  const seen = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      seen.push(body);
      const terms = Array.isArray(body.q) ? body.q : [body.q];
      const data = body.limit === 1 ? [] : terms.map((t) => ({ id: `tm_${t}`, jurisdiction_code: "US", mark_text: t,
        status: { primary: "active" }, match: { tier: "identical", via: ["identical"], terms: Array.isArray(body.q) ? [t] : [] } }));
      res.writeHead(200, { "Content-Type": "application/json", "x-credits-charged": "10" });
      res.end(JSON.stringify({ object: "list", has_more: false, data,
        pagination: { cursor: null, total_count: total ?? terms.length, total_count_approximate: false },
        search_meta: { similarity_applied: body.similarity ?? [] } }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${server.address().port}`, seen, close: () => new Promise((r) => server.close(r)) };
}

test("an exact band of 30 spellings is ONE request, and every spelling's record comes back", async () => {
  const reg = await register();
  try {
    const names = spellings(30);
    const out = JSON.parse((await doEnumerate("k", reg.base, { names, match_mode: "exact", nice_classes: [9] }, null)).text);
    assert.equal(reg.seen.length, 1, "an exact band went to the register one spelling at a time");
    assert.deepEqual(reg.seen[0].q, names);
    assert.deepEqual(reg.seen[0].similarity, ["identical", "lookalike"]);
    assert.equal(out.state, "enumerated");
    assert.equal(out.records.length, 30);
    assert.deepEqual(out.records.find((r) => r.mark_text === names[7]).match.terms, [names[7]], "each record keeps which spelling found it");
  } finally { await reg.close(); }
});

test("250 exact spellings go as 100, 100 and 50", async () => {
  const reg = await register();
  try {
    await doEnumerate("k", reg.base, { names: spellings(250), match_mode: "exact" }, null);
    assert.deepEqual(reg.seen.map((b) => b.q.length), [100, 100, 50]);
  } finally { await reg.close(); }
});

test("a sound-alike band goes as lists of 10 on the sound-alike channels", async () => {
  const reg = await register();
  try {
    const names = spellings(12);
    const out = JSON.parse((await doEnumerate("k", reg.base, { names, match_mode: "phonetic", nice_classes: [9] }, null)).text);
    assert.deepEqual(reg.seen.map((b) => b.q), [names.slice(0, 10), names.slice(10)]);
    assert.ok(reg.seen.every((b) => b.similarity.join() === "identical,phonetic"));
    assert.equal(out.state, "enumerated");
    assert.equal(out.records.length, 12);
  } finally { await reg.close(); }
});

test("CONTROL: a typo band and a starts-with band stay one term per request", async () => {
  for (const shape of [{ strategies: ["fuzzy"] }, { match_mode: "prefix" }]) {
    const reg = await register();
    try {
      await doEnumerate("k", reg.base, { names: spellings(3), ...shape }, null);
      assert.equal(reg.seen.length, 3, `${JSON.stringify(shape)} went as a list`);
      assert.ok(reg.seen.every((b) => typeof b.q === "string"));
    } finally { await reg.close(); }
  }
});

test("a list keeps to the register's 30 words: ten three-word spellings are one list, ten four-word ones are not", () => {
  const words = (n) => (t) => Array.from({ length: n }, (_, k) => `${t}${k}`).join(" ");
  assert.equal(namesChunkFor({ names: spellings(10).map(words(3)), match_mode: "phonetic" }), 10);
  assert.equal(namesChunkFor({ names: spellings(10).map(words(4)), match_mode: "phonetic" }), 7);
  assert.equal(namesChunkFor({ names: spellings(30), match_mode: "phonetic" }), 10);
});

test("the request builder refuses a list outside the shapes the register answers term for term", () => {
  assert.throws(() => buildSearchRequest({ query: spellings(11), strategies: ["phonetic"] }), /Send one term per request/);
  assert.throws(() => buildSearchRequest({ query: spellings(3), strategies: ["fuzzy"] }), /Send one term per request/);
  assert.throws(() => buildSearchRequest({ query: spellings(3), strategies: ["prefix"] }), /Send one term per request/);
  assert.deepEqual(buildSearchRequest({ query: spellings(10), strategies: ["phonetic"] }).q, spellings(10));
});

test("through the plan executor, a crowded list's per-spelling counts each ask one spelling", async () => {
  // The executor shapes the request once and the kernel shapes it again for every count. A list written by
  // the first pass used to survive the second, so each spelling was "counted" by sending the whole list,
  // and every spelling was recorded with the list's total.
  const seen = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      seen.push(body);
      const total = Array.isArray(body.q) ? 5000 : body.q === "ZYTHERMB" ? 7 : 0;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ object: "list", has_more: total > 0, data: [],
        pagination: { cursor: null, total_count: total, total_count_approximate: false }, search_meta: { similarity_applied: body.similarity ?? [] } }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const dir = mkdtempSync(join(TMP, "plan-"));
  try {
    const names = ["ZYTHERMA", "ZYTHERMB", "ZYTHERMC"];
    writeFileSync(join(dir, "plan.json"), JSON.stringify({ regions: ["US"], entries: [{ qid: "q-stack", axis: "primary-sweep",
      predicate: "exact", terms: names, nice_classes: ["9"], regions: ["US"], expected_kind: "enumerate" }] }));
    await doExecutePlan({ apiKey: "k", base: `http://127.0.0.1:${server.address().port}` },
      { plan_path: join(dir, "plan.json"), axis: "primary-sweep", output_path: join(dir, "band.json") }, null);
    assert.deepEqual(seen.map((b) => b.q), [names, ...names], "a spelling's count sent the whole list");
    const band = JSON.parse(readFileSync(join(dir, "band.json"), "utf8"));
    assert.deepEqual(band.find((b) => b.qid === "q-stack").term_counts, {
      ZYTHERMA: { total_hits: 0, disposition: "verified-zero" },
      ZYTHERMB: { total_hits: 7, disposition: "unenumerated" },
      ZYTHERMC: { total_hits: 0, disposition: "verified-zero" },
    });
  } finally { await new Promise((r) => server.close(r)); }
});

test("a crowded list falls back to one count per spelling, so a rare spelling is not lost in the crowd", async () => {
  const reg = await register({ total: 5000 });
  try {
    const names = spellings(4);
    const out = JSON.parse((await doEnumerate("k", reg.base, { names, match_mode: "exact" }, null)).text);
    assert.equal(out.state, "incomplete");
    assert.ok(out.term_counts, "the crowd carries per-spelling accounting");
    assert.deepEqual(Object.keys(out.term_counts).sort(), [...names].sort());
    assert.ok(reg.seen.slice(1).every((b) => typeof b.q === "string" && b.limit === 1), "the rescue counts each spelling alone");
  } finally { await reg.close(); }
});

test("the list width respects the register's body limit, and a short spelling keeps the band one per request", () => {
  assert.equal(namesChunkFor({ names: spellings(300), match_mode: "exact" }), 100);
  assert.ok(namesChunkFor({ names: ["X".repeat(190), "ZYTHERMO"], match_mode: "exact" }) < 100, "long spellings must not overflow the body");
  assert.equal(namesChunkFor({ names: ["Q", "ZYTHERMO"], match_mode: "exact" }), null, "a spelling below the ranked floor cannot ride a ranked list");
  assert.equal(namesChunkFor({ names: spellings(5), match_mode: "exact", owner: "AN INVENTED HOLDER" }), null);
  assert.equal(namesChunkFor({ names: spellings(5), match_mode: "prefix" }), null);
});
