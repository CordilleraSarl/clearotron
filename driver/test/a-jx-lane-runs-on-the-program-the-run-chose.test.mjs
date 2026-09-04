// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-jx-lane-runs-on-the-program-the-run-chose.test.mjs — /, the DRIVER half.
//
// The provider half (turn-envelope, the three lanes) is driven from jx-p4-cores and jx-units. This file
// drives `readJxTuple`, which is the other side of that seam: the engine's normalized tuple, read into
// the shape the lanes consume.
//
// IT IS ASSERTED FROM LITERAL TUPLES, SHAPED BY engine/CONTRACT.md §1 AND §2 — deliberately, and this is
// the whole reason the file exists. The lane tests hand `judgeHits` an object shaped like what
// `readJxTuple` RETURNS, so they agree with the reader because one author wrote both and neither of them
// touches a real tuple. A fixture that agrees with its own accessor proves the accessor's author knew
// what they meant, and nothing else.
//
// Run:  cd driver && node ../scripts/test-run.mjs node --test test/a-jx-lane-runs-on-the-program-the-run-chose.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readJxTuple, turnText, JX_TIER } from "../engine/jx-turn.mjs";

const WHO = { vendor: "anthropic", authMode: "subscription", engine: "anthropic-agent" };
const CODEX = { vendor: "openai", authMode: "api-key", engine: "openai-agent" };

/** A clean tuple in the contract's own shape (§1), with canonical Usage (§2). */
const tuple = (over = {}) => ({
  code: 0, killed: false, wall: 2.1, stdout: "", stderr: "", laneWaitMs: 0,
  json: { status: "ok", result: { meta: { agentMeta: {} }, payloads: [{ text: '{"candidates":[]}' }] },
    summary: "success", runId: "s1", stopReason: "end_turn" },
  usage: { input: 120, output: 40, cacheRead: 900, cacheWrite: 0, total: 1060 },
  sessionRef: "s1", modelWire: "claude-haiku-4-5-20251001", signals: { thought: null },
  ...over,
});

test("#1209 a clean turn yields the answer text, the SERVED model, and who paid for it", () => {
  const r = readJxTuple(tuple(), WHO);
  assert.equal(r.ok, true);
  assert.equal(r.text, '{"candidates":[]}', "the payload text, not stdout — that is where an adapter puts it");
  assert.equal(r.model, "claude-haiku-4-5-20251001",
    "#1210 criterion 4: the receipt names the model that DID the work. modelWire, never the alias we asked for");
  assert.notEqual(r.model, JX_TIER, "…and the alias is not a model id");
  assert.equal(r.vendor, "anthropic");
  assert.equal(r.authMode, "subscription");
});

test("#1209 canonical Usage survives whole — dropping cache tokens under-counts the lanes we just metered", () => {
  const r = readJxTuple(tuple(), WHO);
  assert.deepEqual(r.usage, { input: 120, output: 40, cacheRead: 900, cacheWrite: 0, total: 1060 },
    "engine/CONTRACT.md §2 is five fields; the old Messages-API rows carried two because that is all the API returned");
});

test("#1209 `usage: null` stays null — it means no tokens were accounted, not zero tokens", () => {
  // CONTRACT.md §1 says so in place. A zeroed object here would be a measurement nobody took, and
  // isLaneWedge reads a four-field zero as a WEDGE — inventing one would be worse than reporting none.
  const r = readJxTuple(tuple({ usage: null, killed: true, signals: { stalled: true } }), WHO);
  assert.equal(r.ok, false);
  assert.equal(r.usage, null);
});

test("#1209 a killed, wedged or unclean turn is never an answer", () => {
  for (const [over, why] of [
    [{ killed: true, signals: { stalled: true } }, /killed before it answered/],
    [{ signals: { rateLimited: true } }, /rate-limited/],
    [{ code: 137 }, /did not complete cleanly/],
    [{ json: { status: "error" } }, /did not complete cleanly/],
    [{ json: null }, /did not complete cleanly/],
  ]) {
    const r = readJxTuple(tuple(over), WHO);
    assert.equal(r.ok, false, `${JSON.stringify(over)} was read as an answer`);
    assert.match(r.cause, why);
    assert.equal(r.vendor, "anthropic", "a failed turn still spent, and still says who spent it");
  }
});

test("#1209 truncation is observable on anthropic and is a DEGRADE", () => {
  const r = readJxTuple(tuple({ json: { ...tuple().json, stopReason: "max_tokens" } }), WHO);
  assert.equal(r.ok, true, "the turn itself completed — truncation is the LANE's degrade, not the tuple's");
  assert.equal(r.truncated, true);
  assert.equal(r.truncationObservable, true);
});

test("#1210 on codex truncation is NOT observable, and the flag says so rather than saying false", () => {
  // The residue, stated. `openai-agent` carries no stopReason at all, so a codex turn that hit its
  // ceiling after emitting a complete-but-short object reads as short. The only truncation evidence
  // there is that a cut-off JSON object fails to parse, which the lane's envelope check already
  // degrades on. `truncationObservable: false` is what lets a reader tell the two kinds of ok apart.
  const r = readJxTuple(tuple({ modelWire: "gpt-5-codex", json: { ...tuple().json, stopReason: undefined } }), CODEX);
  assert.equal(r.ok, true);
  assert.equal(r.truncated, false);
  assert.equal(r.truncationObservable, false);
  assert.equal(r.model, "gpt-5-codex", "and the receipt still names who did the native-language work");
});

test("#1209 the observability flag is keyed on the ADAPTER, not on a key the adapter always writes", () => {
  // anthropic-agent writes `stopReason: r?.stop_reason` unconditionally, so `"stopReason" in json` is
  // true on every one of its turns whether or not the wire said anything. A guard built on key presence
  // would report observability the turn never had — this asserts the discriminator is the engine.
  const withKeyButCodex = tuple({ json: { ...tuple().json, stopReason: "max_tokens" } });
  const r = readJxTuple(withKeyButCodex, CODEX);
  assert.equal(r.truncationObservable, false, "the key is present and codex still cannot observe it");
  assert.equal(r.truncated, false, "…so a stopReason arriving on a codex tuple is not trusted");
});

test("#1209 turnText falls back to stdout rather than inventing an empty answer", () => {
  assert.equal(turnText({ json: null, stdout: "raw" }), "raw");
  assert.equal(turnText({}), "", "and an absent everything is the empty string, which the lane reads as unreadable");
});
