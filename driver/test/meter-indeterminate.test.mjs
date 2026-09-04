// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — SYNTHESIS LOST ELEVEN MINUTES TO ONE WORD, AND THE INSTRUCTION HAD ASKED FOR IT.
//
// Delivered R2 (round `b668c452`, engine `089399a`, CONDITIONAL in 2h31). `_driver/synthesis.jsonl`:
//
//     attempt 1  fresh       1066.7s  ok
//     attempt 1  followup     654.1s  invalid_file:narrative.md:finding_meter_token_invalid:
//                                     goods_proximity:unknown (must be one of: high, medium, low)
//     attempt 2  warm-patch    50.0s  ok
//
// 654 seconds of opus on the serial critical path, and a 50-second warm patch fixed it: the analysis was
// never in question. One word was. `unknown` is the honest English answer when goods proximity is
// genuinely indeterminate, and the closed set offered no way to say it — so the model wrote the natural
// word and the gate refused.
//
// The gate is RIGHT to refuse: a meter that silently accepts `unknown` produces an unrated finding
// wearing a rating. Two upstream faults produced it and both are fixed here:
//   1. the stage instruction stated three meters as ONE set and then made `unknown` legal in a trailing
//      parenthetical — `mark_similarity & goods_proximity & enforcer = high | medium | low (enforcer may
//      also be unknown)`. The word sat one clause from the meter it is illegal on.
//   2. `finding_meter_missing` ORDERED it, for all four meters: "use the \"unknown\" token when there is
//      no signal". Two of the four have no such token. The validator was instructing the failure.
//
// BREAK MATRIX:
//   · the token is forbidden BY NAME with a legal move   → break: drop the ban, arms 1 and 2 go red
//   · `unknown` never sits inside a 3-band meter's set   → break: recombine the sentence, arm 3
//   · the missing-meter message names each meter's set   → break: restore "use unknown", arm 2
//   · the closed sets themselves are unchanged           → break: admit unknown, arm 4
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { METERS, METER_TOKENS, parseFindingsJson } from "../findings-model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const STAGES = readFileSync(join(HERE, "..", "stages.mjs"), "utf8");

// The words a model reaches for when the closed set has no room for the honest answer. `unknown` is the
// one that was actually written and cost the 654 seconds; the rest are the same move in other clothes.
const INDETERMINATE = ["unknown", "n/a", "unclear", "tbd", "none"];
const CLOSED_3 = METERS.filter((m) => !METER_TOKENS[m].includes("unknown"));

// A schema_version 1 findings doc that PASSES today, so the only thing under test is the meter token.
// Borrowed in shape from findings-model.test.mjs' own fixture rather than re-derived: a fixture that
// fails for an unrelated missing field would make every assertion below vacuous.
const meter = (token, basis = "verified-from-record") => ({ token, basis });
const FINDING = {
  ordinal: 1,
  mark: "LUMENGARDE",
  owner: { name: "Plesner Advokatpartnerselskab", country: "DK",
    registrations: [{ uri: "/mark/eu/018553557", classes: ["09", "41"], status: "Registered", filed: "2021-09-07", expiry: "2031-09-07", jurisdiction: "EU" }] },
  composite: 4, level: "B", dispute_type: "paper-conflict",
  meters: {
    mark_similarity: meter("high"),
    goods_proximity: meter("medium", "inferred-from-signal"),
    use: meter("confirmed"),
    enforcer: meter("high"),
  },
  quadrant: { x: 0.72, y: 0.55 },
  source: { source_type: "register-vendor", resolved_link: "https://tm.example/mark/eu/018553557" },
};
const DOC = { schema_version: 1, findings: [FINDING], coverage: [{ area: "register / EU", state: "confirmed-clean", note: "" }] };

function meterError(meter_, token) {
  const meters = JSON.parse(JSON.stringify(FINDING.meters));
  if (token === undefined) delete meters[meter_]; else meters[meter_] = { token, basis: "inferred-from-signal" };
  try { parseFindingsJson(JSON.stringify({ ...DOC, findings: [{ ...FINDING, meters }] })); }
  catch (e) { return String(e.message); }
  return null;
}

test("#588 arm 1 — a 3-band meter refuses `unknown` AND says what to write instead", () => {
  assert.ok(CLOSED_3.includes("goods_proximity"), "premise: goods_proximity has no indeterminate token");
  for (const meter of CLOSED_3) {
    const msg = meterError(meter, "unknown");
    assert.ok(msg, `${meter} now ACCEPTS "unknown" — an unrated finding is wearing a rating`);
    assert.match(msg, new RegExp(`^finding_meter_token_invalid:${meter}:unknown`),
      "the offending token must lead the message — gateway routes on it");
    assert.match(msg, /never write "unknown"/,
      `${meter}'s rejection does not forbid the token BY NAME — this is the message the 654s retry read`);
    assert.match(msg, /pick the closest band/,
      `${meter}'s rejection offers no legal move, so the model has nowhere to go but back to "unknown"`);
  }
});

test("#588 arm 2 — the MISSING-meter message no longer orders the token that fails", () => {
  // The fault with the arrow reversed: this message told the model to write `unknown` when there was no
  // signal, for all four meters, two of which reject it.
  for (const meter of METERS) {
    const msg = meterError(meter, undefined) ?? "";
    assert.ok(msg.startsWith("finding_meter_token_invalid:") || msg.startsWith("finding_meter_missing:"),
      `unexpected message for ${meter}: ${msg}`);
  }
  const src = readFileSync(join(HERE, "..", "findings-model.mjs"), "utf8");
  const missing = src.match(/finding_meter_missing:\$\{m\}[^`]*/);
  assert.ok(missing, "the missing-meter throw moved — this assertion is pinned to its text");
  assert.ok(!/use the \\?"unknown\\?" token/.test(missing[0]),
    "the validator is again instructing the token it rejects on two of the four meters");
});

test("#588 arm 3 — `unknown` never sits inside a 3-band meter's stated set in the instruction", () => {
  // The exact shape that produced it: three meters stated as one set, `unknown` legalised for one of
  // them in a trailing parenthetical. Each set is now stated on its own, so the word is never adjacent
  // to a meter it is illegal on.
  for (const meter of CLOSED_3) {
    const at = STAGES.indexOf(`${meter} = `);
    assert.ok(at > 0, `the instruction no longer states ${meter}'s own closed set`);
    const stated = STAGES.slice(at, STAGES.indexOf(".", at));
    assert.ok(!/unknown/.test(stated),
      `"unknown" appears inside ${meter}'s own stated set: ${stated}`);
    for (const tok of METER_TOKENS[meter])
      assert.ok(stated.includes(tok), `${meter}'s set omits its own legal token ${tok}`);
  }
  // enforcer DOES carry it, and must keep saying so — this is a split, not a blanket ban.
  const enf = STAGES.slice(STAGES.indexOf("enforcer = "), STAGES.indexOf(".", STAGES.indexOf("enforcer = ")));
  assert.match(enf, /unknown/, "enforcer lost its indeterminate value — the split went one meter too far");
});

test("#588 arm 4 — the instruction forbids the word by name and leaves the closed sets unchanged", () => {
  for (const word of INDETERMINATE)
    assert.ok(STAGES.includes(`"${word}"`),
      `the instruction does not name "${word}" — a closed set stated positively is what produced this`);
  assert.match(STAGES, /goods proximity is genuinely open/,
    "the indeterminate case has no legal move in the instruction, so the honest answer is still unwritable");
  // The remedy is the PROMPT, not the enum (option 1 on the issue): the meter is preserved.
  assert.deepEqual(METER_TOKENS.goods_proximity, ["high", "medium", "low"]);
  assert.deepEqual(METER_TOKENS.mark_similarity, ["high", "medium", "low"]);
  assert.deepEqual(METER_TOKENS.enforcer, ["high", "medium", "low", "unknown"]);
  assert.deepEqual(METER_TOKENS.use, ["confirmed", "not-confirmed", "unknown"]);
});
