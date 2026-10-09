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
// floor is still a provider error on a listing; on a count-only question it is a total the register did
// not give. Unknown either way, never a zero.
//
// A floor takes the doors any crowd over the ceiling takes. A stack of spellings is counted spelling by
// spelling, so a rare spelling never vanishes inside the floor; an owner's sweep across several classes is
// counted class by class; a wide band asked one spelling at a time keeps the floor of the window that met
// it, where the sum of the other windows would have stood as the slice's total.
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
const rows = (n, tag = "zz") => Array.from({ length: n }, (_, i) => ({ record_id: `/mark/${tag}/${i}`, mark_text: "QZXV LABS" }));
const LISTING = { qid: "primary-sweep:contains:qzxv", axis: "primary-sweep", predicate: "default", term: "QZXV",
  nice_classes: [9], regions: [], expected_kind: "enumerate" };
const COUNT = { qid: "primary-sweep:count:qzxv", axis: "primary-sweep", predicate: "default", term: "QZXV",
  nice_classes: [], regions: [], expected_kind: "count" };
// The register's two answers to a question it would not count: a floor, or nothing at all.
const FLOOR = (limit) => ({ total_hits: null, total_approximate: true, total_floor: 10000, results: rows(Math.min(limit ?? 100, 100)), has_more: true });
const NOTHING = () => ({ total_hits: null, total_approximate: false, total_floor: null, results: [], has_more: false });
const EXACT = (n) => (limit) => ({ total_hits: n, total_approximate: false, total_floor: null, results: rows(Math.min(limit ?? 100, n, 100)), has_more: n > (limit ?? 100) });

// `answer(params)` decides each reply; `entries` is the plan; `capabilities` extends the stand-in's.
async function run(answer, { entries = [LISTING, COUNT], capabilities = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "register-floor-"));
  try {
    const planPath = join(dir, "register-plan.json");
    const outPath = join(dir, "band.json");
    writeFileSync(planPath, JSON.stringify({ regions: [], entries }));
    const asked = [];
    const search = async (_a, p) => {
      const what = p.names ?? (p.name != null ? [p.name] : p.owner != null ? [`owner:${p.owner}`] : []);
      asked.push({ kind: p.limit === 1 ? "count" : "listing", what: what.join("+"), classes: (p.nice_classes ?? []).join(",") });
      return ok(answer(p));
    };
    const { enumerate } = makeEnumerate({ search, capabilities: { countProbe: "cheap", screenSource: "search-row", ceilingDefault: 600, ...capabilities },
      rowScreen: () => ({ screen_verdict: "live" }) });
    const executePlan = makeExecutePlan({ search, enumerate, capabilities: { id: "stand-in" }, countParams: { limit: 1 } });
    const res = await executePlan("auth", { plan_path: planPath, axis: "primary-sweep", output_path: outPath }, {});
    const band = JSON.parse(readFileSync(outPath, "utf8"));
    const blocks = Array.isArray(band) ? band : band.blocks;
    return { asked, blocks, reply: JSON.parse(res.text), at: (qid) => blocks.find((b) => b.qid === qid) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const listings = (asked) => asked.filter((a) => a.kind === "listing");

test("a listing the register answered with a floor is a crowd with the register's figure: one call, no error, no zero", async () => {
  const { asked, at } = await run((p) => FLOOR(p.limit));
  const b = at(LISTING.qid);
  assert.equal(b.state, "incomplete");
  assert.equal(b.total_hits, null, "the floor became a count");
  assert.equal(b.total_floor, 10000);
  assert.equal(b.crowd_basis, "register-floor");
  assert.notEqual(b.error, true, "a floor was stamped an error");
  assert.doesNotMatch(String(b.reason), /provider error/i);
  assert.match(String(b.reason), /^the register answered "more than 10,000" for this question: a floor, not a count, so the set is too large to read\. This is a CROWD/);
  assert.ok((b.sample ?? []).length > 0, "the first page's rows did not ride with the crowd");
  assert.equal(listings(asked).filter((a) => a.what === "QZXV").length, 1, `the listing was asked again: ${JSON.stringify(asked)}`);
});

test("a count-only question the register answered with a floor keeps a null total and the figure, never 0", async () => {
  const { at, blocks } = await run((p) => FLOOR(p.limit));
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
  assert.equal(listings(asked).length, 2, "the in-tool retry no longer runs for a real non-answer");
  assert.equal("total_floor" in b, false);
  // The count-only question met the same answer. It is a count the register did not give: unknown, never
  // the number zero, and not a provider error either, because the call was answered.
  const c = at(COUNT.qid);
  assert.equal(c.total_hits, null, "a count-only question answered with no total was written down as a counted 0");
  assert.notEqual(c.error, true, "an answered count with no total was stamped a provider error");
  assert.equal("total_floor" in c, false, "no floor was given, so none may be carried");
});

test("CONTROL — an exact total over the ceiling keeps today's crowd sentence, byte for byte, and carries no floor", async () => {
  const { at } = await run((p) => EXACT(12000)(p.limit), { entries: [LISTING] });
  const b = at(LISTING.qid);
  assert.equal(b.total_hits, 12000);
  assert.equal(b.reason, "total_hits 12000 exceeds the enumerate ceiling 600 — this is a CROWD, not a named exact/near band. Record it as a count+sample descriptor and hand it up to judgment; the funnel does NOT narrow-and-retry a crowd here. Whether a narrower NAMED enumeration is warranted, and whether this slice is material, is judgment's call (Layer B) — never accept it as clean.");
  assert.equal("total_floor" in b, false);
  assert.equal("crowd_basis" in b, false);
});

// ── A floor takes the doors any crowd over the ceiling takes ────────────────────────────────────────────
const STACK = { qid: "primary-sweep:form:qzxv", axis: "primary-sweep", predicate: "exact",
  terms: ["QZXV", "QZXW", "QZXVY"], nice_classes: [9], regions: [], expected_kind: "enumerate" };
// The whole stack and its broad spelling answer with a floor; the rare spelling holds 3; the third none.
const STACK_ANSWER = (p) => {
  const names = p.names ?? (p.name != null ? [p.name] : []);
  if (names.length > 1 || names[0] === "QZXV") return FLOOR(p.limit);
  return EXACT(names[0] === "QZXW" ? 3 : 0)(p.limit);
};

test("a stack the register answered with a floor is counted spelling by spelling, so a rare spelling keeps its own count", async () => {
  const { asked, at, reply } = await run(STACK_ANSWER, { entries: [STACK] });
  const b = at(STACK.qid);
  assert.equal(b.state, "incomplete");
  assert.equal(b.total_hits, null, "the stack's floor became a count");
  assert.equal(b.total_floor, 10000);
  assert.equal(b.crowd_basis, "register-floor");
  assert.notEqual(b.error, true);
  assert.deepEqual(b.term_counts, {
    QZXV: { total_hits: null, total_floor: 10000, disposition: "crowd" },
    QZXW: { total_hits: 3, disposition: "unenumerated" },
    QZXVY: { total_hits: 0, disposition: "verified-zero" },
  });
  assert.match(String(b.reason), /^stack total_hits more than 10,000 exceeds the enumerate ceiling 600; each spelling was counted and none was read \(3 terms: 1 verified-zero, 1 counted and not read, 1 crowd, 0 error\)/);
  assert.deepEqual(reply.spelling_counts, { [STACK.qid]: { QZXV: "crowd more than 10,000", QZXW: 3, QZXVY: 0 } });
  assert.deepEqual(asked.map((a) => `${a.kind} ${a.what}`), ["listing QZXV+QZXW+QZXVY", "count QZXV", "count QZXW", "count QZXVY"],
    "one listing for the stack, then one count per spelling, and nothing asked again");
});

test("a stack whose every spelling counts zero under a floor is never a complete zero", async () => {
  const { at } = await run((p) => ((p.names ?? []).length > 1 ? FLOOR(p.limit) : EXACT(0)(p.limit)), { entries: [STACK] });
  const b = at(STACK.qid);
  assert.equal(b.state, "incomplete", "a clean zero stood over a register's floor");
  assert.equal(b.total_hits, null);
  assert.equal(b.total_floor, 10000);
});

test("an owner's sweep across classes answered with a floor is counted class by class, the readable class read", async () => {
  const OWNER = { qid: "primary-sweep:owner:qzxv", axis: "primary-sweep", predicate: "owner", term: "Qzxv Holdings",
    nice_classes: [9, 42], regions: [], expected_kind: "enumerate" };
  const answer = (p) => {
    const classes = p.nice_classes ?? [];
    if (classes.length !== 1 || classes[0] === 9) return FLOOR(p.limit);
    return { total_hits: 12, total_approximate: false, total_floor: null, results: rows(Math.min(p.limit ?? 100, 12), "c42"), has_more: false };
  };
  const { at } = await run(answer, { entries: [OWNER] });
  const b = at(OWNER.qid);
  assert.equal(b.total_hits, null);
  assert.equal(b.total_floor, 10000);
  assert.notEqual(b.error, true);
  assert.deepEqual(b.class_counts, {
    9: { total_hits: null, total_floor: 10000, disposition: "crowd" },
    42: { total_hits: 12, disposition: "enumerated" },
  });
  assert.match(String(b.reason), /^owner-scoped total_hits more than 10,000 exceeds the enumerate ceiling 600; count-first per-CLASS rescue ran/);
});

test("a wide band asked one spelling at a time keeps a window's floor: the slice's total is null, never the other windows' sum", async () => {
  const WIDE = { qid: "primary-sweep:default:qzxa", axis: "primary-sweep", predicate: "default",
    terms: ["QZXB", "QZXA"], nice_classes: [9], regions: [], expected_kind: "enumerate" };
  const answer = (p) => ((p.names ?? [p.name])[0] === "QZXB" ? FLOOR(p.limit) : EXACT(4)(p.limit));
  const { asked, at } = await run(answer, { entries: [WIDE], capabilities: { namesChunkDefault: 1 } });
  const b = at(WIDE.qid);
  assert.equal(b.total_hits, null, "the slice's total stood as a number beside a window's floor");
  assert.equal(b.total_floor, 10000);
  assert.equal(b.crowd_basis, "register-floor");
  assert.notEqual(b.error, true);
  assert.match(String(b.reason), /^chunk 1\/2 \(1 names\) incomplete: the register answered "more than 10,000"/);
  assert.equal(listings(asked).filter((a) => a.what === "QZXB").length, 1, "the window was asked again");
});
