// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// compose-read.test.mjs — reading a brief into a composed search.
//
// The whole feature's safety argument is that it fills a form and does nothing else, so what these
// tests care about is: the model's answer cannot arrive unbounded, a missing field cannot quietly
// downgrade someone's search, and the button cannot be pressed in a loop.
//
// Offline: the client is a stub. Nothing here reaches a provider.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { boundRead, makeComposeReader, makeReadBudget, systemPrompt, READ_SCHEMA, PROMPT_TERRITORIES, MAX_BRIEF,
  readShapeErrors, jsonFromTurnText } =
  await import("../compose-read.mjs");

const FULL = {
  names: ["AQUAPLUS"], classes: [32], goods: "energy drinks", territories: ["United States"],
  worldwide: false, product: "knockout-search", ref: "M-4471", deadline: "2026-07-24", notes: [],
};

const stub = (payload, extra = {}) => ({
  messages: {
    create: async () => ({ content: [{ type: "text", text: JSON.stringify(payload) }], stop_reason: "end_turn", ...extra }),
  },
});

// ── bounding ───────────────────────────────────────────────────────────────────────────────────────
test("boundRead: caps every list and string, drops classes outside 1..45, de-duplicates", () => {
  const out = boundRead({
    names: Array.from({ length: 50 }, (_, i) => `NAME${i}`),
    classes: [32, 32, 0, 46, "9", 45, -1, 3.5],
    goods: "x".repeat(5000),
    territories: Array.from({ length: 40 }, (_, i) => `T${i}`),
    registers: true, marketplace: true, caseLaw: true, ref: "y".repeat(5000), deadline: "2026-01-02",
    notes: Array.from({ length: 30 }, (_, i) => `n${i}`),
  });
  assert.equal(out.names.length, 20, "names capped");
  assert.deepEqual(out.classes, [32, 9, 45], "1..45 only, de-duplicated, order preserved");
  assert.ok(out.goods.length <= 600 && out.ref.length <= 600, "strings capped");
  assert.equal(out.territories.length, 20, "territories capped");
  assert.equal(out.notes.length, 8, "notes capped");
});

test("boundRead: a missing PRODUCT is null, and null is a real answer — never a guess in either direction", () => {
  // The defaults used to read `!== false`: a dropped boolean became a full clearance, on the grounds
  // that it must not "silently downgrade someone's search to a knockout". That reasoning had no answer
  // for the other direction, and the offering makes the other direction expensive — a defaulted product
  // is a search nobody chose. Null leaves the choice on the screen, which is where it belongs.
  const out = boundRead({});
  assert.equal(out.product, null);
  assert.equal(out.worldwide, false, "and 'everywhere' is positive-only: silence is not a claim");
  assert.deepEqual(out.names, []);
  assert.equal(out.goods, "");
  // a product the offering does not list is dropped rather than passed through to a door that refuses it
  assert.equal(boundRead({ product: "prelim" }).product, null);
  assert.equal(boundRead({ product: "knockout-search" }).product, "knockout-search");
});

test("boundRead: a deadline is an ISO date or nothing — never free text", () => {
  assert.equal(boundRead({ deadline: "2026-07-24" }).deadline, "2026-07-24");
  // The redesign replaced a free-text deadline box with a date field. Accepting prose here would put
  // the old box straight back, one layer down where nobody would look for it.
  assert.equal(boundRead({ deadline: "next Friday" }).deadline, "");
  assert.equal(boundRead({ deadline: "24/07/2026" }).deadline, "");
});

test("boundRead: total on junk — an array, a string, null all produce the empty read", () => {
  for (const junk of [null, undefined, "a string", [1, 2, 3], 42]) {
    const out = boundRead(junk);
    assert.deepEqual(out.names, [], `${JSON.stringify(junk)} produces no names`);
    assert.equal(out.product, null);
    assert.equal(out.worldwide, false);
  }
});

// ── the schema and the prompt ──────────────────────────────────────────────────────────────────────
test("READ_SCHEMA: every property is required and nothing extra is allowed", () => {
  // Structured output is not a hint. A partial object would leave the UI unable to tell "the brief
  // said nothing about territories" from "the model forgot to answer".
  const props = Object.keys(READ_SCHEMA.properties);
  assert.deepEqual([...READ_SCHEMA.required].sort(), props.sort());
  assert.equal(READ_SCHEMA.additionalProperties, false);
  // `scripts` is ABSENT on purpose: a native-script deep dive is the most expensive lever on the
  // screen and must never be inferred from prose. See the module header.
  assert.ok(!("scripts" in READ_SCHEMA.properties));
});

test("READ_SCHEMA: uses ONLY the keywords structured output accepts", () => {
  // Both of these were live 400s, on every press, invisible to every other test in this file — a
  // stubbed client accepts any schema you hand it:
  //   For 'array' type, property 'maxItems' is not supported
  //   For 'integer' type, properties maximum, minimum are not supported
  // So the dialect gets walked rather than trusted. Adding a rejected keyword back is a red test here
  // instead of a feature that is broken for everyone the moment it ships.
  const ALLOWED = new Set(["type", "properties", "items", "required", "additionalProperties", "description", "enum"]);
  const walk = (node, path) => {
    if (!node || typeof node !== "object") return;
    for (const k of Object.keys(node)) {
      assert.ok(ALLOWED.has(k), `${path}.${k} is not a keyword this API's json_schema accepts`);
    }
    if (node.properties) for (const [k, v] of Object.entries(node.properties)) walk(v, `${path}.${k}`);
    if (node.items) walk(node.items, `${path}[]`);
  };
  walk(READ_SCHEMA, "schema");
});

test("1917 the reader no longer chooses a model, or builds a client — it is handed a turn", async () => {
  // It used to construct an @anthropic-ai/sdk client from a raw ANTHROPIC_API_KEY and pick the model
  // itself. Both are gone: the model and the billing mode are the ENGINE DOOR's, resolved once where the
  // portal boots, so the button runs on whatever the box is already authenticated as.
  assert.equal(makeComposeReader({}), null, "no turn, no reader — the capability reports unavailable");
  assert.equal(makeComposeReader({ turn: "not a function" }), null);

  let prompt = null;
  const read = makeComposeReader({ turn: async (a) => { prompt = a.prompt; return { ok: true, text: JSON.stringify(FULL) }; } });
  const out = await read("quick check on AQUAPLUS");
  assert.equal(out.ok, true);
  assert.deepEqual(out.read.names, ["AQUAPLUS"]);
  assert.equal(out.read.product, "knockout-search", "the brief asked for a knockout and that survives");

  // THE SCHEMA HAS TO RIDE IN THE PROMPT NOW. `output_config` is a Messages-API parameter and there is
  // no equivalent on a spawned CLI turn, so what the server used to guarantee is now a request — and
  // that is precisely why readShapeErrors exists.
  assert.match(prompt, /ONE JSON object and nothing else/);
  for (const k of READ_SCHEMA.required) assert.ok(prompt.includes(`"${k}"`), `the prompt must carry ${k}`);
  assert.match(prompt, /quick check on AQUAPLUS/, "and the brief itself");
});

test("1917 an engine failure is a NAMED refusal, and the route still answers 502", async () => {
  // It used to throw, and portal-service's catch turned that into a 502. The engine door is total — it
  // returns { ok: false, cause } rather than throwing — so the refusal has to carry enough for the route
  // to keep saying 502 rather than 422. 422 would tell the user their brief was unprocessable when the
  // engine was merely unreachable.
  let calls = 0;
  const read = makeComposeReader({ turn: async () => { calls += 1; return { ok: false, cause: "the engine turn was rate-limited" }; } });
  const out = await read("x");
  assert.equal(out.ok, false);
  assert.equal(out.error, "engine", "the route keys its 502 on exactly this word");
  assert.match(out.cause, /rate-limited/, "and the operator-facing cause survives for the audit line");
  assert.match(out.message, /set the search up below/, "while the client sentence stays a client sentence");
  assert.equal(calls, 1, "one press, one attempt — a retry loop on an outage is how a free button gets expensive");
});

test("systemPrompt: names the territory vocabulary and today's date", () => {
  const p = systemPrompt({ today: "2026-07-22" });
  assert.match(p, /2026-07-22/, "the model cannot resolve 'Friday' without today");
  for (const t of ["United States", "African Regional (ARIPO)"]) assert.ok(p.includes(t), `${t} offered`);
  assert.ok(!p.split("TERRITORIES")[1].split("CLASSES")[0].includes("Worldwide"),
    "worldwide is a MODE and left the territory list — teaching the model to write a token the form then strips is how the two states became one");
  assert.match(p, /EMPTY list when the brief does not say/i);
});

test("systemPrompt: the model can SAY worldwide, which is not the same as saying nothing", () => {
  // The composer spells worldwide as the EMPTY territory list, so an empty answer had to carry two
  // different meanings — "the brief says everywhere" and "the brief does not say" — and the UI could
  // only act on the second. A brief explicitly asking for a worldwide search over a draft naming
  // France was therefore dropped with no receipt. The model needs a way to state it; this is it.
  const p = systemPrompt({ today: "2026-07-22" });
  assert.match(p, /set `worldwide` true and\s+leave this list empty/, "the claim has its own field now");
  assert.match(p, /clear the countries already on it/i, "and what it does to the form is stated");
  assert.match(p, /never set `worldwide` alongside named territories/i,
    "the hedge is still forbidden — 'everywhere, France' resolves to France, and that rule is unchanged");
  // AND THE FOUR PRODUCTS, computed from the offering rather than typed here.
  for (const id of ["knockout-search", "global-preliminary-search", "multi-country-focus-search", "full-country-search"])
    assert.ok(p.includes(id), `${id} offered to the reader`);
  assert.match(p, /AN EMPTY STRING IS A REAL ANSWER/, "and not choosing is stated as the right outcome");
});

test("READ_SCHEMA: the territories description carries both meanings of an empty list", () => {
  // The prompt is instruction; the schema description is what the model reads beside the field it is
  // filling in. They must not disagree — a description still saying "empty means worldwide" would
  // teach exactly the ambiguity this pair of changes removes.
  const d = READ_SCHEMA.properties.territories.description;
  assert.match(d, /Empty when the brief does not say/i);
  assert.match(d, /set the `worldwide` field instead/);
  assert.doesNotMatch(d, /Empty means worldwide/i);
  assert.match(READ_SCHEMA.properties.worldwide.description, /different things and the form treats them differently/);
});

test("PROMPT_TERRITORIES mirrors the composer's Where field — pinned by NAME, not by count", () => {
  // A DUPLICATE of REGIONS + COUNTRIES in portal-ui/src/contract/composerProduct.ts, and the pin used to
  // be `length === 37` plus three spot checks. A count passes a SWAP: rename a territory on one side and
  // the two vocabularies drift apart with every assertion still green, which is the drift this arm is
  // named for. The comparison is now the whole ordered list against the whole ordered list.
  const uiSrc = readFileSync(new URL("../../portal-ui/src/contract/composerProduct.ts", import.meta.url), "utf8");
  const arrayNamed = (name) => {
    const m = uiSrc.match(new RegExp(`export const ${name}[^=]*=\\s*\\[([\\s\\S]*?)\\]`));
    // AN ABSENCE IS A FINDING. A renamed export or a reformatted file would otherwise yield an empty
    // list, and an empty list compares equal to nothing while reporting that it checked something.
    assert.ok(m, `portal-ui composerProduct.ts no longer exports an array named ${name} in a shape this arm can read`);
    const names = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    assert.ok(names.length, `${name} parsed to an EMPTY list — the extraction broke, so this comparison proves nothing`);
    return names;
  };

  assert.deepEqual([...PROMPT_TERRITORIES], [...arrayNamed("REGIONS"), ...arrayNamed("COUNTRIES")],
    "the composer's territory vocabulary and the picker's have drifted — a name added, removed or "
    + "renamed on one side only. The UI discards what it cannot place, so the drop is silent to a client.");
  assert.ok(!PROMPT_TERRITORIES.includes("Worldwide"), "worldwide is a mode, and it is not a territory in either list");
});

// ── the reader ─────────────────────────────────────────────────────────────────────────────────────
test("1917 an empty or over-long brief is refused before the engine is touched", async () => {
  let calls = 0;
  const read = makeComposeReader({ turn: async () => { calls += 1; return { ok: true, text: "{}" }; } });
  assert.equal((await read("   ")).error, "empty");
  assert.equal((await read("x".repeat(MAX_BRIEF + 1))).error, "too_long");
  assert.equal(calls, 0, "neither spends a token");
});

test("1917 an unparseable answer is a refusal, not a throw", async () => {
  const read = makeComposeReader({ turn: async () => ({ ok: true, text: "{oh no" }) });
  const out = await read("anything");
  assert.equal(out.ok, false);
  assert.equal(out.error, "unreadable");
  assert.match(out.message, /set the search up below/);
});

// ── — THE PAYLOAD THAT PARSES AND IS STILL WRONG ──────────────────────────────────
//
// This is the arm the whole change turns on. Until now `output_config: { json_schema }` made the server
// guarantee the shape, so "it parsed" and "it conformed" were the same fact. The engine door has no
// output_config, so they come apart — and `boundRead` is a TOTAL normaliser: hand it {} and it returns a
// complete, empty read. Without the check below, a model that answered `{"names":[]}` would produce a
// blank form the composer presents as an authoritative reading of the brief.
//
// A malformed-JSON test alone would never see this. That one was always green.

test("1917 a payload that PARSES but is missing keys fails loudly, and never becomes an empty read", async () => {
  const read = makeComposeReader({ turn: async () => ({ ok: true, text: JSON.stringify({ names: ["AQUAPLUS"] }) }) });
  const out = await read("quick check on AQUAPLUS");
  assert.equal(out.ok, false, "it must NOT arrive as a successful read");
  assert.equal(out.error, "shape");
  assert.match(out.cause, /did not match the read schema/);
  for (const k of ["classes", "goods", "territories", "worldwide"]) {
    assert.match(out.cause, new RegExp(`missing "${k}"`), `the cause must name ${k} — "it failed" is not diagnosable`);
  }
  assert.equal(out.read, undefined, "and no read is handed on at all");
});

test("1917 a payload with a WRONG-TYPED key is caught too, not coerced", async () => {
  const bad = { ...FULL, classes: "9, 12" };   // a string where the schema says array
  const read = makeComposeReader({ turn: async () => ({ ok: true, text: JSON.stringify(bad) }) });
  const out = await read("x");
  assert.equal(out.ok, false);
  assert.match(out.cause, /"classes" should be array, got string/);
});

test("1917 THE CONTROL — a conforming payload still passes, and the check is not just refusing everything", () => {
  // Three arms above assert a refusal. A validator that rejected every payload would satisfy all three
  // and break the feature completely, which is a worse outcome than the bug being fixed.
  assert.deepEqual(readShapeErrors(FULL), [], "the fixture the happy-path arm uses must be accepted");
  assert.deepEqual(readShapeErrors({ ...FULL, extra: 1 }), ['unexpected "extra"'],
    "additionalProperties:false is part of the schema, so a key nobody asked for is a shape error");
});

test("1917 the JSON survives a chatty turn — a fence or a sentence around it", () => {
  assert.deepEqual(jsonFromTurnText('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(jsonFromTurnText('Here is the object:\n{"a":1}\nHope that helps.'), { a: 1 });
  assert.equal(jsonFromTurnText("no object here"), null, "and nothing at all is null, not a throw");
  assert.equal(jsonFromTurnText(""), null);
});

test("1917 the portal asks the door for SONNET WITH THINKING OFF, never the jx lanes' haiku/low", () => {
  // The shared runner defaults to the jx lanes' own tier and thinking, and inheriting them here would
  // break the owner's ruling AND walk into a measured 400: compose-read.mjs records that Haiku 4.5
  // refuses a thinking block outright, so the jx constants would have been a failure on every press.
  //
  // Source-level because the construction happens at portal boot behind an env-dependent adapter load;
  // what is pinned is the REQUEST, which is the part a future edit would get wrong.
  const src = readFileSync(new URL("../portal-service.mjs", import.meta.url), "utf8");
  const at = src.indexOf("makeJxTurnRunner({");
  assert.notEqual(at, -1, "the portal must build its reader through the shared engine door");
  const call = src.slice(at, at + 200);
  assert.match(call, /thinking:\s*"off"/, "thinking OFF is the ruling, and haiku 400s on a thinking block");
  assert.match(call, /model/, "and the model is passed rather than inherited");
  assert.doesNotMatch(call, /JX_TIER|JX_THINKING/, "the jx constants must not be what this lane runs on");

  // And the raw-key construction is gone rather than merely bypassed — a second path that still reads
  // ANTHROPIC_API_KEY would reopen the mixed-billing question the ruling closed.
  assert.doesNotMatch(src, /new Anthropic\(/, "no SDK client is constructed in the portal any more");
  assert.doesNotMatch(src, /process\.env\.ANTHROPIC_API_KEY/, "and the portal reads no model credential of its own");
});

test("1917 the disabled sentence stopped promising a switch nobody flipped", () => {
  const src = readFileSync(new URL("../portal-service.mjs", import.meta.url), "utf8");
  // ANCHORED ON THE CONSTANT, not on the file. A whole-file scan for the old wording redded on the
  // COMMENT that quotes it while explaining why it went — the same shape as a guard that reads a skip
  // call out of the paragraph describing it. The history is worth keeping in the file; what must not
  // survive is the live string.
  const decl = src.match(/const READ_OFF_NOTE = "([^"]*)"/);
  assert.ok(decl, "READ_OFF_NOTE must still be declared in one place");
  assert.doesNotMatch(decl[1], /switched on here yet/,
    "the owner read that as a toggle somebody forgot; it was a billing posture the feature could not run under");
  // The client sentence stays a CLIENT sentence — naming our plumbing to a client serves nobody.
  assert.doesNotMatch(decl[1], /ANTHROPIC|API_KEY|credential/i, "the client note must not name our plumbing");
  assert.match(decl[1], /set the search up below/, "and must still say what the reader CAN do");
});


// ── RESTORED ────────────────────────────────────────────────────────────────────
//
// These three were deleted by accident while rewriting the reader's arms — an edit that replaced a span
// running to the end of the file took them with it. None of them is about the engine door, and nothing
// failed when they went: the arms simply stopped existing, which no run can report. The census's LOSS
// check is what caught it, which is the whole reason that gate refuses a shrink without a stated reason.

test("budget: per person, per hour, and it forgets", () => {
  const b = makeReadBudget({ perHour: 3 });
  const t0 = 1_000_000;
  assert.ok(b.take("a@x", t0) && b.take("a@x", t0) && b.take("a@x", t0));
  assert.equal(b.take("a@x", t0), false, "fourth press in the hour is refused");
  assert.equal(b.take("b@x", t0), true, "a different person is unaffected");
  assert.equal(b.take("a@x", t0 + 3_600_001), true, "an hour later the window has rolled");
});

test("reader: today is read per call, so a long-lived process does not freeze the date", async () => {
  // Same property, through the door instead of a client: the prompt carries the date, and it is read
  // per call rather than captured once when the reader was built.
  const days = [];
  const read = makeComposeReader({
    turn: async ({ prompt }) => { days.push(prompt.match(/today is (\d{4}-\d{2}-\d{2})/)[1]); return { ok: true, text: JSON.stringify(FULL) }; },
    now: () => new Date(days.length === 0 ? "2026-07-22T09:00:00Z" : "2026-08-01T09:00:00Z"),
  });
  await read("a"); await read("b");
  assert.deepEqual(days, ["2026-07-22", "2026-08-01"]);
});

test("stub sanity: the reader passes the brief through, trimmed", async () => {
  let prompt;
  const read = makeComposeReader({ turn: async (a) => { prompt = a.prompt; return { ok: true, text: JSON.stringify(FULL) }; } });
  await read("  the brief  ");
  assert.match(prompt, /the brief/, "the brief reaches the model");
  assert.doesNotMatch(prompt, /  the brief  /, "and it is trimmed, as it always was");
});
