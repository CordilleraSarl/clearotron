// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A REGISTER'S FLOOR IS TOO MANY TO READ, NOT A FAILED SEARCH (ruled 2026-10-02).
//
// A very broad question can be answered "at least 10,000": the register counted and gave a floor instead
// of a figure. The search ran. It was treated as failed: asked once more, recorded as a provider error,
// and written down as 0 hits. Now it is a crowd too large to read, carrying the register's own figure,
// through both doors a question takes: a listing (the enumerate kernel) and a count-only question (the
// executor's count descriptor). No second call, no error stamp, no zero. An answer with no total and no
// floor is still what it was: a provider error, unknown, never a zero.
//
// Driven through the real enumerate kernel inside the real plan executor, against a stand-in register;
// every request that reaches it is recorded. Invented names only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeEnumerate } from "../enumerate.mjs";
import { makeExecutePlan } from "../execute-plan.mjs";

const ok = (obj) => ({ type: "text", text: JSON.stringify(obj) });
const rows = (n) => Array.from({ length: n }, (_, i) => ({ record_id: `/mark/zz/${i}`, mark_text: "QZXV LABS" }));
const LISTING = { qid: "primary-sweep:contains:qzxv", axis: "primary-sweep", predicate: "default", term: "QZXV",
  nice_classes: [9], regions: [], expected_kind: "enumerate" };
const COUNT = { qid: "primary-sweep:count:qzxv", axis: "primary-sweep", predicate: "default", term: "QZXV",
  nice_classes: [], regions: [], expected_kind: "count" };
// The register's two answers to a question it would not count: a floor, or nothing at all.
const FLOOR = (limit) => ({ total_hits: null, total_approximate: true, total_floor: 10000, results: rows(Math.min(limit ?? 100, 100)), has_more: true });
const NOTHING = () => ({ total_hits: null, total_approximate: false, total_floor: null, results: [], has_more: false });

async function run(answer) {
  const dir = mkdtempSync(join(tmpdir(), "register-floor-"));
  try {
    const planPath = join(dir, "register-plan.json");
    const outPath = join(dir, "band.json");
    writeFileSync(planPath, JSON.stringify({ regions: [], entries: [LISTING, COUNT] }));
    const asked = [];
    const search = async (_a, p) => { asked.push(p.limit === 1 ? "count" : "listing"); return ok(answer(p.limit)); };
    const { enumerate } = makeEnumerate({ search, capabilities: { countProbe: "cheap", screenSource: "search-row", ceilingDefault: 600 },
      rowScreen: () => ({ screen_verdict: "live" }) });
    const executePlan = makeExecutePlan({ search, enumerate, capabilities: { id: "stand-in" }, countParams: { limit: 1 } });
    await executePlan("auth", { plan_path: planPath, axis: "primary-sweep", output_path: outPath }, {});
    const band = JSON.parse(readFileSync(outPath, "utf8"));
    const blocks = Array.isArray(band) ? band : band.blocks;
    return { asked, blocks, at: (qid) => blocks.find((b) => b.qid === qid) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("a listing the register answered with a floor is a crowd with the register's figure: one call, no error, no zero", async () => {
  const { asked, at } = await run(FLOOR);
  const b = at(LISTING.qid);
  assert.equal(b.state, "incomplete");
  assert.equal(b.total_hits, null, "the floor became a count");
  assert.equal(b.total_floor, 10000);
  assert.equal(b.crowd_basis, "register-floor");
  assert.notEqual(b.error, true, "a floor was stamped an error");
  assert.doesNotMatch(String(b.reason), /provider error/i);
  assert.match(String(b.reason), /more than 10,000/);
  assert.ok((b.sample ?? []).length > 0, "the first page's rows did not ride with the crowd");
  assert.equal(asked.filter((a) => a === "listing").length, 1, `the listing was asked again: ${asked.join(", ")}`);
});

test("a count-only question the register answered with a floor keeps a null total and the figure, never 0", async () => {
  const { at, blocks } = await run(FLOOR);
  const b = at(COUNT.qid);
  assert.equal(b.total_hits, null);
  assert.equal(b.total_floor, 10000);
  assert.notEqual(b.error, true);
  assert.doesNotMatch(JSON.stringify(blocks), /"total_hits":\s*0\b/, "a zero stands where the register gave a floor");
});

test("CONTROL — an answer with no total and no floor still takes today's path: a provider error, asked once more", async () => {
  const { asked, at } = await run(NOTHING);
  const b = at(LISTING.qid);
  assert.equal(b.error, true);
  assert.match(String(b.reason), /provider error/i);
  assert.equal(asked.filter((a) => a === "listing").length, 2, "the in-tool retry no longer runs for a real non-answer");
  assert.equal("total_floor" in b, false);
});
