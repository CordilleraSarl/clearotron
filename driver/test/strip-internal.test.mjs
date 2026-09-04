// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// T6 (H7) — the ONE internal-note choke point, table-driven with the exact copper-spire leak
// shapes: bold-wrapped bullets that dodged the old line-strip, mid-line markers the old indexOf cut
// once, multiple occurrences, and whole-internal bullets that must disappear on the client export.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stripInternal, plain, stripEngineInternals } from "../publish/parse.mjs";

test("stripInternal: client export — internal tails drop, whole-internal bullets disappear, nothing raw survives", () => {
  assert.equal(stripInternal("- **::p:: Use-check status.**", { client: true }), "", "the bold-wrapped copper-spire shape dies entirely");
  assert.equal(stripInternal("public head ::p:: internal tail", { client: true }), "public head");
  assert.equal(stripInternal("- ::p:: whole internal bullet", { client: true }), "");
  assert.equal(stripInternal("line one\n- ::p:: internal\nline three", { client: true }), "line one\nline three");
  for (const [inp, opts] of [["a ::p:: b ::p:: c", { client: true }], ["- *::p:: italic-wrapped*", { client: true }]])
    assert.ok(!stripInternal(inp, opts).includes("::p::"), `no raw token: ${inp}`);
});

test("stripInternal: internal surfaces — markers consumed, tails labelled once each, multiple occurrences handled", () => {
  assert.equal(stripInternal("- **::p:: Use-check status.**", { client: false }), "- [internal] Use-check status.");
  assert.equal(stripInternal("public head ::p:: internal tail", { client: false }), "public head [internal] internal tail");
  assert.equal(stripInternal("a ::p:: b ::p:: c", { client: false }), "a [internal] b [internal] c", "GLOBAL — the old indexOf cut only the first");
  assert.ok(!stripInternal("x ::p:: y", { client: false }).includes("::p::"));
});

test("plain (xlsx cells) routes through the choke point", () => {
  assert.equal(plain("**bold** ::p:: note"), "bold [internal] note");
});

// ---- stripEngineInternals: whole sentences, not whole lines --------------------------------------

test("stripEngineInternals: a soft-wrapped internal sentence goes entirely — no leak, no stump", () => {
  // VERBATIM shape from the delivered ION client report (copper-foundry, 2026-07-22): the sentence
  // wrapped mid-way, so the line-based filter dropped the half holding the vendor name and kept the
  // rest — publishing the internal fact AND a garbled legal sentence ("(server not" … "the dedicated
  // adapter."). Both halves must go, and the surrounding legal prose must not.
  const wrapped = [
    'No TTAB or CAFC authority specific to "ION"-formative marks or the AI-software field',
    'was located before the Legal Data Hunter daily quota was exhausted; CourtListener itself',
    'was unavailable this session (server not reachable) via the dedicated adapter.',
    '',
    'General Court authority (*Ionfarma, SL v. EUIPO*, Case T-229/25) supports the cumulative test.',
  ].join('\n');
  const out = stripEngineInternals(wrapped);
  assert.ok(!/legal ?data ?hunter/i.test(out), "the retrieval vendor must not reach a client");
  assert.ok(!/courtlistener/i.test(out), "nor its sibling");
  assert.ok(!/server not\s*$/m.test(out), "no truncated stump left behind");
  assert.ok(!/^\s*(?:reachable|via the dedicated)/m.test(out), "and no orphaned continuation");
  assert.match(out, /Ionfarma/, "real case-law citations are the client's product — they stay");
});

test("stripEngineInternals: content with nothing to remove is byte-identical (the render freeze depends on it)", () => {
  const clean = '## Heading\n\n- item one that wraps\n  onto a second line.\n- item two.\n\nA plain paragraph\nwrapped across lines.\n';
  assert.equal(stripEngineInternals(clean), clean);
});

test("stripEngineInternals: list structure survives — one bad item does not swallow its neighbours", () => {
  const md = '- clean item one.\n- the MCP server was unavailable.\n- clean item three.';
  const out = stripEngineInternals(md);
  assert.match(out, /clean item one/);
  assert.match(out, /clean item three/);
  assert.ok(!/MCP server/i.test(out));
  assert.equal(out.split('\n').length, 3, "the removed item leaves its own empty line, not a merged blob");
});

test("stripEngineInternals: a client's own vocabulary is not deleted (the bound-token doctrine)", () => {
  // model names are plausible MARKS — the reason every one of them is vendor/version-bound
  for (const keep of ['The SONNET mark, US Reg 123, is registered.', 'HAIKU brand energy drinks.', 'OPUS is the applicant.']) {
    assert.equal(stripEngineInternals(keep), keep, `must survive: ${keep}`);
  }
  assert.equal(stripEngineInternals('We ran claude-4 for this.'), '', 'but a vendor-bound model name is engine internals');
});
