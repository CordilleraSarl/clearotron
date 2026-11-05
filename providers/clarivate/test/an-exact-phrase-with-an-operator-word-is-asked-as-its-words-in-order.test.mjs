// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// AN EXACT PHRASE HOLDING AND, OR OR NOT IS ASKED AS ITS WORDS IN ORDER, NOT SET ASIDE.
//
// This register parses those words inside its exact field, so the phrase cannot be asked as written. It used to be
// deferred and disclosed. It is now minted as the contains form the engine already compiles, with the same classes,
// offices, goods words and owner, and the plan entry says so. Before it is sent it reads the run's answers: the same
// request, or a complete list that provably holds the phrase, answers it and nothing goes out. A crowd stays a crowd, and
// a term of nothing but operator words stays set aside. Driven through the real mint and executor with the network
// stubbed. Every mark is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { doExecutePlan, buildSearchRequest, MARK_FIELD } from "../src/core.js";
import { legMatches } from "../src/wider-list.js";
import { CAPABILITIES } from "../src/capabilities.js";
import { compileRegisterPlan, exactOperatorSubstitution, exactOperatorEntries, joinPlanToBands, notSearchedSentence, validatePlanFeasibility } from "../../../driver/register-plan.mjs";
import { mintSupplementalEntries } from "../../../driver/engine/mcp/supplemental.mjs";
import { PROVIDER_CAPABILITIES } from "../../../driver/register-capabilities.mjs";

const PHRASE = "MOSSEL AND FERNLY";
const IN_ORDER = "*MOSSEL ADJ2 FERNLY*";
const LINE_5 = "Not searched: the term contains the word AND, OR or NOT, which this register treats as a search command, so it cannot be searched as written. It was set aside and is disclosed here.";
const stamp = (term = PHRASE) => exactOperatorSubstitution(term, CAPABILITIES);
const inOrder = (extra = {}) => ({ qid: "q-phrase", axis: "primary-sweep", predicate: "default", term: PHRASE, nice_classes: [9], exact_substituted: stamp(), ...extra });

const manifestFor = (mark) => ({ schema_version: 1, mark, dominant_element: mark, elements: [{ value: mark, kind: "distinctive" }],
  variants: [{ value: mark, category: "core" }], incumbent_classes: [], goods_words: ["software"] });
const JOB = { jobKey: "t", classes: ["9", "42"], jurisdictions: [] };

// A stand-in for the register: every request is recorded, and each is answered with this count and no records.
async function runPlan(t, entries, { count = 0, band = null, qids = null, axis = "primary-sweep", files = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "words-in-order-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const real = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    sent.push({ url: String(url), body, mark: (body.searchFields ?? []).find((f) => f?.name === MARK_FIELD)?.value ?? null });
    const offices = body.registrationOfficeCodes ?? [];
    return new Response(JSON.stringify({ counts: Object.fromEntries(offices.map((o, i) => [o, i ? 0 : count])), ids: {}, totalResults: count }),
      { status: 200, headers: { "content-type": "application/json" } });
  };
  const plan = { regions: ["US", "GB"], entries };
  const planPath = join(dir, "register-plan.json"), outPath = join(dir, `${axis}-band.json`);
  writeFileSync(planPath, JSON.stringify(plan));
  if (band) writeFileSync(outPath, JSON.stringify(band));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), JSON.stringify(content));
  try {
    await doExecutePlan("k", "https://x", { plan_path: planPath, axis, output_path: outPath, ...(qids ? { qids } : {}) }, null);
  } finally { globalThis.fetch = real; }
  const blocks = JSON.parse(readFileSync(outPath, "utf8"));
  return { plan, blocks, sent, byQid: Object.fromEntries(blocks.map((b) => [b.qid, b])) };
}

const rec = (id, mark_text, extra = {}) => ({ record_id: id, guid: id, office: "US", mark_text, classes: [9], screen: { mark_text }, ...extra });
const WIDER = { qid: "q-wider", axis: "primary-sweep", predicate: "default", term: "MOSSEL", nice_classes: [9] };
const answered = (records, extra = {}) => [{ qid: "q-wider", query: "default MOSSEL", state: "enumerated", total_hits: records.length, count: records.length, records, ...extra }];

// ── THE MINT ───────────────────────────────────────────────────────────────────────────────────────────────────────

test("which terms move: a term holding the word, of any case and with single letters; not one of nothing but such words", () => {
  for (const t of [PHRASE, "mossel and fernly", "A AND B", "MOSSEL, NOT FERNLY", "OR MOSSEL"]) assert.ok(stamp(t), t);
  for (const t of ["MOSSEL", "ANDOVER FERNLY", "AND OR", "NOT", "ORNOT"]) assert.equal(stamp(t), null, t);
  assert.equal(exactOperatorSubstitution(PHRASE, null), null);
  // Only a register that declares such words: each other one is asked exact, as it always was.
  for (const [id, caps] of Object.entries(PROVIDER_CAPABILITIES)) if (id !== "clarivate") assert.equal(exactOperatorSubstitution(PHRASE, caps), null, id);
  assert.deepEqual(PROVIDER_CAPABILITIES.clarivate.exactOperatorWords, ["AND", "OR", "NOT"]);
});

test("in a stack only the phrase moves: the other names stay exact, and everything else about the question is unchanged", () => {
  const entry = { axis: "a", predicate: "exact", terms: ["LANTERNWICK", PHRASE, "ODRAVEL"], nice_classes: [9], goods_text: ["software"], owner: "Invented Ltd" };
  const [kept, moved, ...more] = exactOperatorEntries(entry, CAPABILITIES);
  assert.equal(more.length, 0);
  assert.deepEqual(kept, { axis: "a", predicate: "exact", terms: ["LANTERNWICK", "ODRAVEL"], nice_classes: [9], goods_text: ["software"], owner: "Invented Ltd" });
  assert.deepEqual(moved, { axis: "a", predicate: "default", term: PHRASE, nice_classes: [9], goods_text: ["software"], owner: "Invented Ltd", exact_substituted: stamp() });
  assert.deepEqual(exactOperatorEntries({ predicate: "exact", terms: ["LANTERNWICK", PHRASE] }, CAPABILITIES)[0], { predicate: "exact", term: "LANTERNWICK" });
  assert.equal(exactOperatorEntries({ predicate: "exact", term: "LANTERNWICK" }, CAPABILITIES), null);
  assert.equal(exactOperatorEntries({ predicate: "default", term: PHRASE }, CAPABILITIES), null);
  // The exact form strips parentheses and the contains form refuses them, so they come out of the moved term.
  const [paren] = exactOperatorEntries({ predicate: "exact", term: "MOSSEL (AND) FERNLY" }, CAPABILITIES);
  assert.equal(paren.term, "MOSSEL AND FERNLY");
  assert.equal(paren.exact_substituted.term, "MOSSEL (AND) FERNLY", "the plan keeps the term as it was planned");
});

test("the compiler's own plan asks the phrase in order, the plan says so, and nothing about it is refused at the freeze", () => {
  const plan = compileRegisterPlan({ manifest: manifestFor(PHRASE), job: JOB, capabilities: CAPABILITIES });
  assert.ok(plan.entries.length, "premise: the plan compiled");
  const named = (e) => (e.terms ?? [e.term]).includes(PHRASE);
  assert.deepEqual(plan.entries.filter((e) => e.predicate === "exact" && named(e)), [], "the phrase stayed exact somewhere in the plan");
  const moved = plan.entries.filter((e) => e.exact_substituted);
  assert.ok(moved.length >= 1, "no entry says it was asked in another form");
  for (const e of moved) {
    assert.equal(e.predicate, "default");
    assert.equal(e.term, PHRASE);
    assert.ok(e.qid.includes(":default:"), `the qid does not name the question asked: ${e.qid}`);
    assert.equal(e.unsupported, undefined);
  }
  assert.deepEqual(validatePlanFeasibility(plan, { capabilities: CAPABILITIES }).filter((i) => i.severity === "unexecutable"), []);
  assert.equal(new Set(plan.entries.map((e) => e.qid)).size, plan.entries.length, "two entries share a qid");
  // A term of nothing but such words stays exact, and is refused and disclosed as before.
  const bare = compileRegisterPlan({ manifest: manifestFor("AND OR"), job: JOB, capabilities: CAPABILITIES });
  assert.deepEqual(bare.entries.filter((e) => e.exact_substituted), []);
});

test("a proposal takes the same path: its qid names the question asked, and a stack leaves its other names exact", () => {
  const propose = (p) => mintSupplementalEntries("primary-sweep", [{ nice_classes: ["9"], rationale: "an invented reason", ...p }], { capabilities: CAPABILITIES });
  const one = propose({ predicate: "exact", term: PHRASE });
  assert.deepEqual(one.rejected, []);
  assert.equal(one.minted.length, 1);
  assert.equal(one.minted[0].predicate, "default");
  assert.deepEqual(one.minted[0].exact_substituted, stamp());
  assert.match(one.minted[0].qid, /^supp:primary-sweep:default:/);
  const stack = propose({ predicate: "exact", terms: ["LANTERNWICK", PHRASE, "ODRAVEL"] });
  assert.deepEqual(stack.rejected, []);
  assert.deepEqual(stack.minted.map((e) => [e.predicate, e.term ?? e.terms]), [["exact", ["LANTERNWICK", "ODRAVEL"]], ["default", PHRASE]]);
  // Without a register's contract the mint stays out of it, and a term of nothing but such words is not moved.
  assert.equal(mintSupplementalEntries("primary-sweep", [{ predicate: "exact", term: PHRASE, nice_classes: ["9"] }], {}).minted[0].predicate, "exact");
  assert.equal(propose({ predicate: "exact", term: "AND OR" }).minted[0]?.predicate ?? "exact", "exact");
});

// ── THE QUESTION THAT GOES OUT ─────────────────────────────────────────────────────────────────────────────────────

test("it is sent on the contains field with every other filter unchanged, and it counts as searched", async (t) => {
  const { plan, blocks, sent, byQid } = await runPlan(t, [inOrder({ goods_text: ["software"], nice_classes: [9, 42] })]);
  const marks = sent.map((s) => s.mark);
  assert.ok(marks.length >= 1 && marks.every((m) => m === IN_ORDER), JSON.stringify(marks));
  const fields = sent[0].body.searchFields.map((f) => f.name);
  assert.deepEqual(fields, buildSearchRequest({ names: ["X"], regions: ["US"], match_mode: "default", nice_classes: [9, 42], goods_text: ["software"] }).searchFields.map((f) => f.name));
  assert.deepEqual(sent[0].body.registrationOfficeCodes, ["US", "GB"], "the offices moved");
  const b = byQid["q-phrase"];
  assert.equal(b.state, "enumerated");
  assert.equal(b.error, undefined);
  assert.equal(b.deferred, undefined);
  assert.match(b.query, /^default MOSSEL AND FERNLY/, "the band says what was asked");
  const join_ = joinPlanToBands(plan, { "primary-sweep": blocks });
  assert.deepEqual(join_.deferred, [], "the ledger still reads it as set aside");
  assert.deepEqual(join_.missing, []);
  assert.deepEqual(join_.executed.map((e) => e.qid), ["q-phrase"]);
});

test("a phrase whose words are single letters is asked too, and keeps them in order", async (t) => {
  const { sent } = await runPlan(t, [inOrder({ term: "A AND B", exact_substituted: stamp("A AND B") })]);
  assert.ok(sent.every((s) => s.mark === "A ADJ2 B"), JSON.stringify(sent.map((s) => s.mark)));
});

test("a phrase that crowds is an ordinary crowd: counted, nothing listed, and never a clean answer", async (t) => {
  const { plan, blocks, sent, byQid } = await runPlan(t, [inOrder()], { count: 5000 });
  assert.ok(sent.length >= 1);
  const b = byQid["q-phrase"];
  assert.equal(b.state, "incomplete", JSON.stringify(b).slice(0, 300));
  assert.equal(b.total_hits, 5000);
  const row = joinPlanToBands(plan, { "primary-sweep": blocks }).executed.find((e) => e.qid === "q-phrase");
  assert.equal(row.state, "incomplete");
  assert.equal(row.total_hits, 5000);
});

test("an entry frozen before this keeps its exact question, and a term of nothing but such words keeps its sentence", async (t) => {
  const { plan, blocks, sent, byQid } = await runPlan(t, [
    { qid: "q-frozen", axis: "primary-sweep", predicate: "exact", term: PHRASE, nice_classes: [9] },
    { qid: "q-bare", axis: "primary-sweep", predicate: "exact", term: "AND OR", nice_classes: [9] },
  ]);
  assert.deepEqual(sent, [], "a refused slice reached the register");
  for (const qid of ["q-frozen", "q-bare"]) assert.equal(notSearchedSentence(byQid[qid].reason), LINE_5, qid);
  assert.deepEqual(joinPlanToBands(plan, { "primary-sweep": blocks }).deferred.map((d) => d.qid).sort(), ["q-bare", "q-frozen"]);
});

// ── THE ANSWERS THE RUN ALREADY HOLDS ──────────────────────────────────────────────────────────────────────────────

test("a complete wider list answers it: nothing is sent, the search it came from is named, and only its own records come across", async (t) => {
  const records = [rec("r1", "MOSSEL & FERNLY"), rec("r2", "MOSSEL AND FERNLY"), rec("r3", "MOSSEL WORKS"), rec("r4", "FERNLY AND MOSSEL"),
    rec("r5", "MOSSEL FERNLY", { office: "FR" }), rec("r6", "AMOSSEL & FERNLYS HOUSE"), rec("r7", "MOSSEL OF THE FAR FERNLY")];
  const { plan, blocks, sent, byQid } = await runPlan(t, [WIDER, inOrder()], { band: answered(records, { query: "default MOSSEL" }), qids: ["q-phrase"] });
  assert.deepEqual(sent, [], "the register was asked");
  const b = byQid["q-phrase"];
  assert.equal(b.state, "enumerated");
  assert.deepEqual(b.reused_from, { qid: "q-wider", query: "default MOSSEL" });
  assert.deepEqual(b.records.map((r) => r.record_id), ["r1", "r2", "r6"], "the wrong records came across");
  assert.equal(b.total_hits, 3);
  assert.match(b.query, /^default MOSSEL AND FERNLY/);
  assert.equal(byQid["q-wider"].records.length, records.length, "the list it drew on was changed");
  const row = joinPlanToBands(plan, { "primary-sweep": blocks }).executed.find((e) => e.qid === "q-phrase");
  assert.deepEqual(row.reused_from, b.reused_from, "the receipt does not say nothing was sent");
});

test("a complete list with nothing in it answers zero, and the phrase runs after what it can read, whatever the plan's order", async (t) => {
  const { sent, byQid } = await runPlan(t, [inOrder(), WIDER]);
  assert.deepEqual(sent.map((s) => s.mark).filter((m) => m === IN_ORDER), [], "the phrase was sent");
  assert.ok(sent.some((s) => s.mark === "*MOSSEL*"), "premise: the wider search was asked");
  assert.deepEqual(byQid["q-phrase"].reused_from?.qid, "q-wider");
  assert.deepEqual([byQid["q-phrase"].state, byQid["q-phrase"].records], ["enumerated", []]);
});

test("a list on another axis of the run answers it too, under that axis's own plan", async (t) => {
  const other = { qid: "q-other", axis: "incumbent-class", predicate: "default", term: "FERNLY", nice_classes: [9] };
  const { sent, byQid } = await runPlan(t, [inOrder()], { qids: ["q-phrase"], files: {
    "incumbent-class-supplemental-plan.json": { entries: [other] },
    "incumbent-class-band.json": [{ qid: "q-other", query: "default FERNLY", state: "enumerated", total_hits: 1, count: 1, records: [rec("r1", "MOSSEL AND FERNLY")] }],
  } });
  assert.deepEqual(sent, []);
  assert.equal(byQid["q-phrase"].reused_from.qid, "q-other");
  assert.equal(byQid["q-phrase"].records.length, 1);
});

for (const [name, wider, block] of [
  ["a crowded list", WIDER, answered([], { state: "incomplete", total_hits: 5000, count: 5000 })],
  ["a failed list", WIDER, answered([], { error: true })],
  ["a deferred list", WIDER, answered([], { deferred: true })],
  ["a list with a record whose mark cannot be read", WIDER, answered([rec("r1", "MOSSEL AND FERNLY"), { record_id: "r2", office: "US", classes: [9] }])],
  ["a list that left out one of its offices", { ...WIDER, regions: ["US", "GB"] }, answered([rec("r1", "MOSSEL AND FERNLY")], { offices_without_goods_field: ["GB"] })],
  ["a list narrower in classes", { ...WIDER, nice_classes: [9] }, null],
  ["a list narrowed by goods the question does not have", { ...WIDER, goods_text: ["software"] }, answered([rec("r1", "MOSSEL AND FERNLY")])],
  ["a list scoped to an owner", { ...WIDER, owner: "Invented Ltd" }, answered([rec("r1", "MOSSEL AND FERNLY")])],
  ["a phonetic list", { ...WIDER, predicate: "phonetic" }, answered([rec("r1", "MOSSEL AND FERNLY")])],
  ["an exact list", { ...WIDER, predicate: "exact", term: "MOSSEL" }, answered([rec("r1", "MOSSEL AND FERNLY")])],
  ["a list on another word", { ...WIDER, term: "LANTERNWICK" }, answered([rec("r1", "MOSSEL AND FERNLY")])],
  ["a one-word pattern with no wrapping wildcard", { ...WIDER, predicate: "wildcard", term: "MOSSEL*" }, answered([rec("r1", "MOSSEL AND FERNLY")])],
]) {
  test(`no answer, so it is sent: ${name}`, async (t) => {
    const question = block ? inOrder() : inOrder({ nice_classes: [9, 42] });
    const { sent, byQid } = await runPlan(t, [wider, question], { band: block ?? answered([rec("r1", "MOSSEL AND FERNLY")]), qids: ["q-phrase"] });
    assert.ok(sent.length >= 1 && sent.every((s) => s.mark === IN_ORDER), JSON.stringify(sent.map((s) => s.mark)));
    assert.equal(byQid["q-phrase"].reused_from, undefined);
  });
}

test("the same goods on both, and more classes on the list: the list answers, within the question's own classes", async (t) => {
  const list = answered([rec("r1", "MOSSEL AND FERNLY", { classes: [9] }), rec("r2", "MOSSEL AND FERNLY", { classes: [41] })]);
  const { sent, byQid } = await runPlan(t, [{ ...WIDER, nice_classes: [9, 41], goods_text: ["software"] }, inOrder({ goods_text: ["software"] })], { band: list, qids: ["q-phrase"] });
  assert.deepEqual(sent, []);
  assert.deepEqual(byQid["q-phrase"].records.map((r) => r.record_id), ["r1"]);
});

test("the same request already answered is not asked again, and a crowd stays a crowd", async (t) => {
  const same = { qid: "q-same", axis: "primary-sweep", predicate: "default", term: PHRASE, nice_classes: [9] };
  const crowd = [{ qid: "q-same", query: `default ${PHRASE}`, state: "incomplete", total_hits: 3337, count: 3337, sample: [], reason: "a crowd" }];
  const { sent, byQid } = await runPlan(t, [same, inOrder()], { band: crowd, qids: ["q-phrase"] });
  assert.deepEqual(sent, []);
  const b = byQid["q-phrase"];
  assert.deepEqual([b.state, b.total_hits, b.reused_from.qid], ["incomplete", 3337, "q-same"]);
  assert.match(b.query, /^default MOSSEL AND FERNLY/);
});

test("a question this comparison cannot read is sent rather than read as no match", async (t) => {
  const { sent } = await runPlan(t, [WIDER, inOrder({ term: "O'MOSSEL AND FERNLY", exact_substituted: stamp("O'MOSSEL AND FERNLY") })], { band: answered([rec("r1", "O'MOSSEL AND FERNLY")]), qids: ["q-phrase"] });
  assert.ok(sent.length >= 1, "punctuation in the question read as a zero from the list");
});

test("the match rules: words in order, within the gap, a wildcard within a word", () => {
  const w = (s) => s.split(" ");
  assert.equal(legMatches(IN_ORDER, w("MOSSEL AND FERNLY")), true);
  assert.equal(legMatches(IN_ORDER, w("MOSSEL FERNLY")), true);
  assert.equal(legMatches(IN_ORDER, w("THE AMOSSEL AND FERNLYS CO")), true);
  assert.equal(legMatches(IN_ORDER, w("THE MOSSELS AND FERNLY")), false, "the wildcard is on the outer end of each outer word");
  assert.equal(legMatches(IN_ORDER, w("FERNLY AND MOSSEL")), false, "out of order");
  assert.equal(legMatches(IN_ORDER, w("MOSSEL OF THE FERNLY")), false, "past the gap");
  assert.equal(legMatches("*MOSSEL*", w("A MOSSELS CO")), true);
  assert.equal(legMatches("A ADJ2 B", w("A AND B")), true);
  assert.equal(legMatches("A ADJ2 B", w("AX AND B")), false, "a single letter is matched whole");
  assert.equal(legMatches("MOSSEL OR FERNLY", w("MOSSEL")), null, "not a chain of words");
});
