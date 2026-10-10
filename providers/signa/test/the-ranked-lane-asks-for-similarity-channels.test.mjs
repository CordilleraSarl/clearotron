// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE RANKED LANE ASKS FOR SIMILARITY CHANNELS, AND THE TERM RIDES `q`.
//
// The register retired both request parameters this connector used for a ranked search — the term's field
// and the strategy list — and announced the retirement on every response that still used them. This is
// that migration, asserted on the request the connector builds.
//
// WHY A RENAME WOULD HAVE BEEN WRONG. A strategy does not become a channel of the same name. One of them
// expands to four channels, and one has no channel of its own at all, so reading the two vocabularies
// across would have sent a narrower question than the plan asked for and been answered 200. Each row of
// the table was read off the register's own report of what it applied for the old parameter, and then
// confirmed by sending the new form and comparing what came back — for the exact lane, by comparing the
// returned records rather than the totals.
//
// THE CHANNELS ARE WRITTEN OUT HERE rather than imported from the module under test. A test that reads its
// expectation out of the code it is testing agrees with that code by construction and cannot catch a wrong
// mapping, which is the only thing this file exists to catch.
//
// No vendor measurements and no mark live here: the figures, their date and the term they were taken on
// are on the tracker, which is private. This directory is public.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSearchRequest, similarityFor } from "../src/core.js";

const RETIRED = ["query", "strategies", "match"];
const CHANNELS = {
  exact: ["identical", "lookalike"],
  phonetic: ["identical", "phonetic"],
  fuzzy: ["identical", "fuzzy", "embedded", "lookalike"],
  prefix: ["identical", "embedded"],
};

test("the term rides `q`, and neither retired parameter is sent", () => {
  const body = buildSearchRequest({ query: "ZYTHERMO", strategies: ["exact"] });
  assert.equal(body.q, "ZYTHERMO");
  for (const name of RETIRED)
    assert.equal(name in body, false, `the request still carries the retired \`${name}\``);
});

test("each ranked strategy asks for ITS channels, which are not its name", () => {
  for (const [strategy, channels] of Object.entries(CHANNELS)) {
    const body = buildSearchRequest({ query: "ZYTHERMO", strategies: [strategy] });
    assert.deepEqual(body.similarity, channels, `${strategy} asked for the wrong channels`);
  }
});

test("THE CONTROL: the four mappings are distinct, so one of them cannot stand in for another", () => {
  const seen = Object.values(CHANNELS).map((c) => c.join("+"));
  assert.equal(new Set(seen).size, seen.length,
    "two strategies map to the same channels — then an arm above would pass with the mapping swapped");
});

test("several strategies in one call union their channels", () => {
  const body = buildSearchRequest({ query: "ZYTHERMO", strategies: ["exact", "phonetic"] });
  assert.deepEqual(body.similarity, ["identical", "phonetic", "lookalike"],
    "a combination must ask for every channel its members ask for, and no more");
});

test("no strategy at all is the exact lane, as it was before", () => {
  assert.deepEqual(buildSearchRequest({ query: "ZYTHERMO" }).similarity, CHANNELS.exact);
  assert.deepEqual(buildSearchRequest({ query: "ZYTHERMO", strategies: [] }).similarity, CHANNELS.exact);
});

test("an unknown strategy is not forwarded verbatim — the register refuses a channel it does not know", () => {
  // Forwarding would 4xx the call, at run time, for whichever plan asked. The vocabulary is closed and
  // the register names it in the refusal, so an unknown name falls back to the exact channels instead.
  assert.deepEqual(similarityFor(["no-such-strategy"]), CHANNELS.exact);
  const body = buildSearchRequest({ query: "ZYTHERMO", strategies: ["no-such-strategy"] });
  assert.ok(body.similarity.every((c) => ["identical", "fuzzy", "embedded", "phonetic", "lookalike"].includes(c)),
    "a channel outside the register's closed vocabulary reached the request");
});

test("a deterministic match carries no channels, because sending both is refused", () => {
  const body = buildSearchRequest({ query: "ZYTHERMO", match: "contains", strategies: ["exact"] });
  assert.deepEqual(body.filters?.mark_text, { contains: ["ZYTHERMO"] });
  assert.equal("q" in body, false);
  assert.equal(body.similarity, undefined);
  for (const name of RETIRED) assert.equal(name in body, false);
});

test("a LIST in the term field is sent only on the channel sets the register answers term for term", () => {
  // A list ranks all its terms together. The register answers it term for term on the exact channels and
  // the sound-alike channels, each up to its list width (ruled 2026-10-09 for the second); every other list
  // is refused.
  for (const strategies of [["exact"], ["phonetic"]]) {
    const ok = buildSearchRequest({ query: ["ZYTHERMO", "ZYTHERMA"], strategies });
    assert.deepEqual(ok.q, ["ZYTHERMO", "ZYTHERMA"]);
    assert.deepEqual(ok.similarity, CHANNELS[strategies[0]]);
  }
  for (const strategies of [["fuzzy"], ["prefix"], ["exact", "phonetic"]])
    assert.throws(() => buildSearchRequest({ query: ["ZYTHERMO", "ZYTHERMA"], strategies }), /list/i,
      `a ${strategies.join("+")} list reached the wire`);
  assert.throws(() => buildSearchRequest({ query: ["ZYTHERMO", "ZYTHERMA"], match: "contains" }), /list/i);
  assert.throws(() => buildSearchRequest({ query: Array.from({ length: 101 }, (_, i) => `ZYTHERM${i}`), strategies: ["exact"] }), /list/i,
    "a list past the register's width reached the wire");
});

test("an owner-only request carries no term field under either spelling", () => {
  const body = buildSearchRequest({ owner: "AN INVENTED HOLDING COMPANY", strategies: ["exact"] });
  assert.equal("q" in body, false);
  for (const name of RETIRED) assert.equal(name in body, false);
});
