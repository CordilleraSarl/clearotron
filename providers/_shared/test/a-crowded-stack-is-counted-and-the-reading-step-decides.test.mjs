// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A CROWDED STACK OF SPELLINGS IS COUNTED, NOT READ, AND THE READING STEP IS HANDED EACH SPELLING'S COUNT.
//
// Ruled 2026-09-26: the reading step sees each spelling's count and decides what to narrow or read, with
// no budget. The stack rescue used to read every spelling under the ceiling itself, cheapest first, until
// one ceiling of records was merged, so the ceiling decided which spellings were read. Measured on a test
// run of 2026-09-25: 78 spellings holding 17,498 records were left unread on that budget, and the reading
// step set them aside on counts it had never seen.
//
// Driven through the real enumerate kernel inside the real plan executor, against a stand-in register
// whose count endpoint answers per spelling; every request that reaches the register is recorded.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeEnumerate } from "../enumerate.mjs";
import { makeExecutePlan } from "../execute-plan.mjs";

const ok = (obj) => ({ type: "text", text: JSON.stringify(obj) });
const COUNTS = { LANTERNWICK: 12, LANTRENWICK: 0, LANTERNWIK: 340, LANTERN: 2100 };
const STACK = { qid: "primary-sweep:form:lanternwick", axis: "primary-sweep", predicate: "exact",
  terms: Object.keys(COUNTS), nice_classes: [9], regions: [], expected_kind: "enumerate" };

async function run({ counts = COUNTS, countFails = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "stack-counted-"));
  try {
    const planPath = join(dir, "register-plan.json");
    const outPath = join(dir, "band.json");
    const stack = { ...STACK, terms: Object.keys(counts) };
    writeFileSync(planPath, JSON.stringify({ regions: [], entries: [stack] }));
    const searched = [];
    const counted = [];
    const register = {
      search: async (_a, p) => { searched.push((p.names ?? []).join("+")); return ok({ total_hits: 0, results: [], has_more: false }); },
      count: async (_a, p) => {
        const names = p.names ?? [];
        counted.push(names.join("+"));
        // The whole-stack probe always answers: it is what puts the stack over the ceiling in the first
        // place. `countFails` fails only the PER-SPELLING probes, which is the shape of a register that
        // answers a broad question and errors on the narrow ones.
        if (names.length > 1) return { ok: true, total: 2452 };
        if (countFails) return { ok: false, reason: "the register did not answer this count" };
        return { ok: true, total: counts[names[0]] };
      },
      screen: async (_a, p) => ok({ rows: p.uris.map((u) => ({ uri: u })) }),
      capabilities: { countProbe: "endpoint", screenSource: "billed-record-fetch", ceilingDefault: 600 },
    };
    const { enumerate } = makeEnumerate(register);
    const executePlan = makeExecutePlan({ search: register.search, enumerate, capabilities: { id: "stand-in" } });
    const res = await executePlan("auth", { plan_path: planPath, axis: "primary-sweep", output_path: outPath }, {});
    return { reply: JSON.parse(res.text), band: JSON.parse(readFileSync(outPath, "utf8")), searched, counted };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("a crowded stack comes back counted per spelling, with nothing read", async () => {
  const { band, searched, counted } = await run();
  const block = band.find((b) => b.qid === STACK.qid);
  assert.equal(block.state, "incomplete");
  assert.deepEqual(block.records ?? [], [], "a spelling was read without the reading step deciding to");
  assert.deepEqual(block.term_counts, {
    LANTERNWICK: { total_hits: 12, disposition: "unenumerated" },
    LANTRENWICK: { total_hits: 0, disposition: "verified-zero" },
    LANTERNWIK: { total_hits: 340, disposition: "unenumerated" },
    LANTERN: { total_hits: 2100, disposition: "crowd" },
  });
  assert.deepEqual(searched, [], "the register was asked for records, where only counts were owed");
  assert.deepEqual(counted, [Object.keys(COUNTS).join("+"), ...Object.keys(COUNTS)], "one count for the stack, then one per spelling");
});

test("the plan tool's reply hands the reading step each spelling's count", async () => {
  const { reply } = await run();
  assert.deepEqual(reply.spelling_counts, { [STACK.qid]: { LANTERNWICK: 12, LANTRENWICK: 0, LANTERNWIK: 340, LANTERN: "crowd 2100" } });
  assert.equal(reply.states[STACK.qid], "incomplete");
});

// ── THE TWO STACKS THIS RULE EXISTS FOR, and the reply used to carry nothing for either ────────────────
//
// The hand-off was gated on at least one spelling being `unenumerated` — counted and under the ceiling. A
// stack where EVERY spelling is itself over the ceiling has none, and neither does one where every count
// failed, so both were dropped from the reply while carrying a full `term_counts` on the band. The first
// is the owner's own case for this rule: it should never read 17,000 records, because it has seen there is
// a lot and decides. Handing it nothing is the rule shipped without its main instance.
//
// A step told nothing and a step told there is nothing read identically, which is why these are arms and
// not a comment.
test("every spelling over the ceiling: the reading step is still handed every count", async () => {
  const CROWDS = { LANTERNWICK: 4200, LANTRENWICK: 3100, LANTERNWIK: 1700 };
  const { reply, band } = await run({ counts: CROWDS });
  const block = band.find((b) => b.qid === STACK.qid);
  assert.deepEqual(Object.values(block.term_counts).map((v) => v.disposition), ["crowd", "crowd", "crowd"],
    "guard: the case under test is a stack with nothing but crowds");
  assert.deepEqual(reply.spelling_counts, { [STACK.qid]: { LANTERNWICK: "crowd 4200", LANTRENWICK: "crowd 3100", LANTERNWIK: "crowd 1700" } });
});

test("every count failed: the reading step is told so, not told nothing", async () => {
  const { reply, band } = await run({ countFails: true });
  const block = band.find((b) => b.qid === STACK.qid);
  assert.deepEqual(Object.values(block.term_counts).map((v) => v.disposition), ["error", "error", "error", "error"],
    "guard: the case under test is a stack whose every count failed");
  assert.deepEqual(reply.spelling_counts,
    { [STACK.qid]: { LANTERNWICK: "error", LANTRENWICK: "error", LANTERNWIK: "error", LANTERN: "error" } },
    "a count that failed must reach the reading step as a failure, never as an absence");
});

test("a stack whose every spelling verified zero is resolved, so it carries no counts to decide", async () => {
  const { reply } = await run({ counts: { LANTERNWICK: 0, LANTRENWICK: 0, LANTERNWIK: 0, LANTERN: 0 } });
  // DELIBERATELY ABSENT, and this arm is what stops the gate being widened to "any term_counts at all":
  // nobody has filed any of these spellings, so there is nothing to read, narrow or leave.
  assert.equal(reply.spelling_counts, undefined, "an all-zero stack has nothing for the reading step to decide");
});
