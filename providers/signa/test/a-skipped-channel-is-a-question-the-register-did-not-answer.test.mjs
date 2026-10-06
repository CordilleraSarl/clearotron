// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-skipped-channel-is-a-question-the-register-did-not-answer.test.mjs — and what each call cost.
//
// THE DEFECT. The register runs a term through the similarity channels a request names, and when one of
// them cannot run on that term it answers 200 with a `<channel>_skipped` warning and what the other
// channels found. This connector carried the warning onto the run and acted on nothing, so a sound-alike
// search answered by `identical` alone read as a searched sound-alike band. It is now refused as an
// answer, naming the channel, so the band is left incomplete instead.
//
// ALSO HERE: each ledger row carries the credits the register says the call cost, read from its
// `X-Credits-Charged` header, with the endpoint it answered — null, never 0, when the header is missing.
//
// No vendor measurements and no mark live here; the server below is local and its bodies are invented.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "signa-skipped-"));
process.env.CLEAROTRON_REGISTER_CALL_LOG = join(TMP, "calls.jsonl");
const { doSearch, doCountHits, skippedChannels } = await import("../src/core.js");
after(() => rmSync(TMP, { recursive: true, force: true }));

const TERM = "ZYTHERMO";
const answer = (warnings, extra = {}) => ({
  object: "list", has_more: false,
  pagination: { cursor: null, total_count: 1, total_count_approximate: false },
  search_meta: { search_id: "srch_invented", similarity_applied: ["identical"], ...(warnings ? { warnings } : {}) },
  data: [{ id: "tm_invented", jurisdiction_code: "US", mark_text: TERM }],
  ...extra,
});

/** A local register: answers every request with `respond()`, and records what it was sent. */
async function register(respond, headers = { "x-credits-charged": "10" }) {
  const seen = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      seen.push(JSON.parse(raw || "{}"));
      res.writeHead(200, { "Content-Type": "application/json", ...headers });
      res.end(JSON.stringify(respond()));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${server.address().port}`, seen, close: () => new Promise((r) => server.close(r)) };
}

test("a skipped channel the search asked for is not taken as the search's answer", async () => {
  const reg = await register(() => answer([{ code: "phonetic_skipped", channel: "phonetic", message: "invented" }]));
  try {
    const out = await doSearch("k", reg.base, { query: TERM, strategies: ["phonetic"] }, null);
    assert.deepEqual(reg.seen[0].similarity, ["identical", "phonetic"], "precondition: the sound-alike channel was asked for");
    assert.match(out.text, /^ERROR/, "a sound-alike question answered without its sound-alike channel read as answered");
    assert.match(out.text, /phonetic/, "the refusal must name the channel the register skipped");
  } finally { await reg.close(); }
});

test("the count lane takes the same refusal, so a skipped channel cannot become a count", async () => {
  const reg = await register(() => answer([{ code: "phonetic_skipped", channel: "phonetic" }]));
  try {
    const out = await doCountHits("k", reg.base, { query: TERM, strategies: ["phonetic"] }, null);
    assert.match(out.text, /^ERROR/);
  } finally { await reg.close(); }
});

test("CONTROL: a skipped channel nobody asked for changes nothing, and neither does no warning", async () => {
  const reg = await register(() => answer([{ code: "phonetic_skipped", channel: "phonetic" }]));
  try {
    const out = await doSearch("k", reg.base, { query: TERM, strategies: ["exact"] }, null);
    assert.doesNotMatch(out.text, /^ERROR/, "the exact search asked for no sound-alike channel");
    assert.equal(JSON.parse(out.text).results.length, 1);
  } finally { await reg.close(); }
  const quiet = await register(() => answer(null));
  try {
    const out = await doSearch("k", quiet.base, { query: TERM, strategies: ["phonetic"] }, null);
    assert.doesNotMatch(out.text, /^ERROR/);
  } finally { await quiet.close(); }
});

test("the channel is read from the code when the warning does not name it", () => {
  const body = { search_meta: { warnings: [{ code: "fuzzy_skipped" }, { code: "expanded_fallback" }, { code: "lookalike_skipped", channel: "lookalike" }] } };
  assert.deepEqual(skippedChannels(body, ["identical", "fuzzy", "embedded", "lookalike"]), ["fuzzy", "lookalike"]);
  assert.deepEqual(skippedChannels(body, ["identical", "phonetic"]), []);
  assert.deepEqual(skippedChannels({}, ["identical"]), []);
});

const ledgerRows = () => (existsSync(process.env.CLEAROTRON_REGISTER_CALL_LOG)
  ? readFileSync(process.env.CLEAROTRON_REGISTER_CALL_LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
  : []);

test("each ledger row carries the credits the register charged and the endpoint that answered", async () => {
  const before = ledgerRows().length;
  const reg = await register(() => answer(null), { "x-credits-charged": "10" });
  try { await doSearch("k", reg.base, { query: TERM, strategies: ["exact"] }, { kind: "search" }); }
  finally { await reg.close(); }
  const row = ledgerRows().slice(before).at(-1);
  assert.equal(row.credits_charged, 10);
  assert.equal(row.endpoint, "POST /v1/trademarks");
});

test("CONTROL: a response with no credits header records null, never a free call", async () => {
  const before = ledgerRows().length;
  const reg = await register(() => answer(null), {});
  try { await doSearch("k", reg.base, { query: TERM, strategies: ["exact"] }, { kind: "search" }); }
  finally { await reg.close(); }
  const row = ledgerRows().slice(before).at(-1);
  assert.equal(row.credits_charged, null);
});

// ── A TERM THAT MIXES ALPHABETS ON A TEXT FILTER ────────────────────────────────────────────────────
// The text filters compare letters as written, so such a term matches nothing and the register answers
// zero rows with an `info`-level `mixed_script` warning. That zero would be the containing count.
const MIXED = "ZYTHЕRMO";   // a Cyrillic capital E among Latin letters
const mixedAnswer = (filter) => ({ ...answer([{ code: "mixed_script", severity: "info", affected_filter: filter, message: "invented" }]),
  data: [], pagination: { cursor: null, total_count: 0, total_count_approximate: false } });

test("a containing count on a term that mixes alphabets is not an exact zero", async () => {
  const reg = await register(() => mixedAnswer("mark_text_contains"));
  try {
    const out = await doCountHits("k", reg.base, { query: MIXED, match: "contains" }, null);
    assert.deepEqual(reg.seen[0].filters?.mark_text, { contains: [MIXED] }, "precondition: the containing filter was sent");
    assert.match(out.text, /^ERROR/, "the register's zero for a term it cannot read reached the count as a real zero");
    assert.match(out.text, /contains/);
  } finally { await reg.close(); }
});

test("CONTROL: a ranked search is not refused for the same term, and a filter with no warning answers", async () => {
  const ranked = await register(() => answer(null));
  try {
    const out = await doSearch("k", ranked.base, { query: MIXED, strategies: ["exact"] }, null);
    assert.doesNotMatch(out.text, /^ERROR/);
  } finally { await ranked.close(); }
  const plain = await register(() => answer(null));
  try {
    const out = await doSearch("k", plain.base, { query: TERM, match: "contains" }, null);
    assert.doesNotMatch(out.text, /^ERROR/, "a containing search with no warning is an answer");
  } finally { await plain.close(); }
});
