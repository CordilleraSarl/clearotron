// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Seam coverage for the shared adapter kernel (providers/_shared).
//
// The corsearch path ("cheap" + "bulk-endpoint") is pinned by that adapter's own contract test,
// which drives the REAL core.
// This file pins the OTHER seam settings — countProbe "endpoint" and "none", screenSource
// "billed-record-fetch" and "search-row" — by driving makeEnumerate with injected dependencies rather
// than through any provider. Every branch of the seam table is therefore covered on its own terms,
// whichever combinations the wired providers happen to use.
//
// Run:  node --test providers/_shared/test/kernel-seams.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../../shared/driver-dir.mjs";   //

const TMP = mkdtempSync(join(tmpdir(), "kernel-seams-"));
process.env.CLEAROTRON_REGISTER_CALL_LOG = join(TMP, "calls.jsonl");
process.env.CLEAROTRON_REGISTER_RECORD_LOG = join(TMP, "records.jsonl");

const { makeEnumerate } = await import("../enumerate.mjs");
const { makeLedger, CALL_LOG_PATH, RECORD_LOG_PATH } = await import("../ledger.mjs");
const { screenVerdict, normalizeBrandRow, makeClassifyStatus } = await import("../screen.mjs");

const ok = (obj) => ({ type: "text", text: JSON.stringify(obj) });
const parse = (r) => JSON.parse(r.text);
const rows = (n, tag) => Array.from({ length: n }, (_, i) => ({ record_id: `/mark/ch/${tag}-${i}` }));

// ── ledger ────────────────────────────────────────────────────────────────────

test("ledger: every row carries its provider discriminator, on the shared paths", () => {
  const a = makeLedger("corsearch");
  const b = makeLedger("clarivate");
  a.logCall({ agentId: "clawdi", sessionKey: "s1", kind: "search", target: "t" }, { http_status: 200, ok: true });
  b.logCall({ agentId: "clawdi", sessionKey: "s1", kind: "search", target: "t" }, { http_status: 200, ok: true });
  b.logRecordBody({ sessionKey: "s1" }, "/mark/ch/1", { x: 1 });
  const calls = readFileSync(CALL_LOG_PATH, "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(calls.map((r) => r.provider), ["corsearch", "clarivate"]);
  assert.equal(calls[0].tool, "search");
  assert.equal(calls[0].http_status, 200);
  assert.equal(calls[0].sessionKey, "s1");
  const recs = readFileSync(RECORD_LOG_PATH, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(recs[0].provider, "clarivate");
  assert.deepEqual(recs[0].body, { x: 1 });
});

test("ledger: a write failure never throws into the caller", () => {
  const l = makeLedger("signa");
  const circular = {}; circular.self = circular;   // JSON.stringify throws
  assert.doesNotThrow(() => l.logRecordBody({}, "t", circular));
});

// ──: the record body goes where the CALLER says, because the driver runs several runs at once ──

test("ledger: logRecordBody writes to tctx.recordLog, and the global path is only the fallback", () => {
  const l = makeLedger("euipo");
  const runLog = driverDir(join(TMP, "run-a"), "register-record-bodies.jsonl");
  l.logRecordBody({ sessionKey: "s2", recordLog: runLog }, "/mark/eu/1", { y: 2 });
  const rows743 = readFileSync(runLog, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(rows743[0].provider, "euipo", "member attribution rides the row wherever it lands");
  assert.deepEqual(rows743[0].body, { y: 2 });
  // …and the run's body did NOT also land in the global file. Two addresses for one response is the
  // shape removes: it is what makes a usage diff and a fidelity check disagree about one fetch.
  assert.equal(readFileSync(RECORD_LOG_PATH, "utf8").includes("/mark/eu/1"), false);
});

test("ledger: a blank recordLog falls back rather than dropping the body", () => {
  const l = makeLedger("signa");
  // A body with nowhere to go must not vanish. `""` and whitespace are "not told", not "discard".
  for (const bad of ["", "   ", null, undefined]) {
    l.logRecordBody({ sessionKey: "s3", recordLog: bad }, `/mark/ch/blank-${String(bad).trim() || "empty"}`, { z: 3 });
  }
  const recs = readFileSync(RECORD_LOG_PATH, "utf8");
  assert.equal((recs.match(/\/mark\/ch\/blank-/g) ?? []).length, 4,
    "every body reached the fallback — losing evidence is worse than filing it globally");
});

test("screen: a provider with its own status vocabulary keeps the fail-open posture", () => {
  const classify = makeClassifyStatus({ live: ["ACTIVE"], dead: ["CANCELLED"] });
  assert.equal(classify("active"), "live");
  assert.equal(classify("Cancelled"), "dead");
  assert.equal(classify("Valid"), "ambiguous");   // not in THIS vocabulary → never auto-drop
  const row = normalizeBrandRow({ status: "ACTIVE", classes: [9] }, { classify, plumbing: [] });
  assert.equal(screenVerdict(row, [9]), "surface:in-scope-live");
});

// ── SEAM 1: countProbe ────────────────────────────────────────────────────────

test('countProbe "endpoint": counts FIRST and never searches a crowd', async () => {
  const calls = [];
  const { enumerate } = makeEnumerate({
    search: async () => { calls.push("search"); return ok({ total_hits: 0, results: [], has_more: false }); },
    count: async () => { calls.push("count"); return { ok: true, total: 209012 }; },
    screen: async () => ok({ rows: [] }),
    capabilities: { countProbe: "endpoint", screenSource: "billed-record-fetch", ceilingDefault: 600 },
  });
  const out = parse(await enumerate("auth", { query: "NIKE" }, {}));
  assert.equal(out.state, "incomplete");
  assert.equal(out.total_hits, 209012);
  assert.deepEqual(out.sample, []);         // no rows were fetched — an honest empty sample
  assert.match(out.reason, /CROWD/);
  assert.deepEqual(calls, ["count"]);       // the whole-set search is NEVER issued for a crowd
});

test('countProbe "endpoint": under the ceiling it counts then searches', async () => {
  const calls = [];
  const { enumerate } = makeEnumerate({
    search: async () => { calls.push("search"); return ok({ total_hits: 3, results: rows(3, "a"), has_more: false }); },
    count: async () => { calls.push("count"); return { ok: true, total: 3 }; },
    screen: async (a, p) => ok({ rows: p.uris.map((u) => ({ uri: u, live_status: "live" })) }),
    capabilities: { countProbe: "endpoint", screenSource: "billed-record-fetch", ceilingDefault: 600 },
  });
  const out = parse(await enumerate("auth", { query: "NIKE" }, {}));
  assert.equal(out.state, "enumerated");
  assert.equal(out.count, 3);
  assert.equal(out.records[0].screen.live_status, "live");
  assert.deepEqual(calls, ["count", "search"]);
});

test('countProbe "endpoint": a failed count is a provider error, never a zero', async () => {
  const { enumerate } = makeEnumerate({
    search: async () => { throw new Error("must not be called"); },
    count: async () => ({ ok: false, reason: "HTTP 503" }),
    screen: async () => ok({ rows: [] }),
    capabilities: { countProbe: "endpoint", screenSource: "billed-record-fetch" },
  });
  const out = parse(await enumerate("auth", { query: "NIKE" }, {}));
  assert.equal(out.state, "incomplete");
  assert.match(out.reason, /provider error on the count probe/);
  assert.match(out.reason, /HTTP 503/);
});

test('countProbe "endpoint": the per-term rescue probes the COUNT endpoint, not a search', async () => {
  const probes = [];
  const { enumerate } = makeEnumerate({
    search: async (a, p) => {
      const n = p.names?.length === 1 && p.names[0] === "RARE" ? 2 : 0;
      return ok({ total_hits: n, results: rows(n, "r"), has_more: false });
    },
    count: async (a, p) => {
      const terms = p.names ?? [];
      probes.push(terms.join("+"));
      if (terms.length > 1) return { ok: true, total: 5000 };
      return { ok: true, total: terms[0] === "RARE" ? 2 : 0 };
    },
    screen: async (a, p) => ok({ rows: p.uris.map((u) => ({ uri: u })) }),
    capabilities: { countProbe: "endpoint", screenSource: "billed-record-fetch", ceilingDefault: 10 },
  });
  const out = parse(await enumerate("auth", { names: ["ZERO", "RARE"] }, {}));
  assert.equal(out.state, "enumerated");                    // every term resolved ⇒ the union IS the band
  assert.equal(out.total_hits, 5000);
  assert.deepEqual(out.term_counts.ZERO, { total_hits: 0, disposition: "verified-zero" });
  assert.deepEqual(out.term_counts.RARE, { total_hits: 2, disposition: "enumerated" });
  assert.deepEqual(probes, ["ZERO+RARE", "ZERO", "RARE", "RARE"]);
});

test('countProbe "endpoint" without a count dependency fails LOUDLY at construction', () => {
  assert.throws(() => makeEnumerate({ search: async () => ok({}), capabilities: { countProbe: "endpoint" } }),
    /requires a count\(\) dependency/);
});

test('countProbe "none": the ceiling is a page-count cutoff and total_hits stays NULL', async () => {
  const { enumerate } = makeEnumerate({
    search: async (a, p) => ok({ results: rows(100, `p${p.page}`), has_more: true }),
    rowScreen: (row) => ({ uri: row.record_id, screened: true }),
    capabilities: { countProbe: "none", screenSource: "search-row", ceilingDefault: 250, pageSize: 100 },
  });
  const out = parse(await enumerate("auth", { query: "X" }, {}));
  assert.equal(out.state, "incomplete");
  assert.equal(out.total_hits, null);            // unknown — never 0, never fabricated
  assert.equal(out.fetched, 300);
  assert.match(out.reason, /exposes NO total anywhere/);
  assert.match(out.reason, /not a clean negative/);
});

test('countProbe "none": a tractable band still enumerates, screened inline', async () => {
  let searches = 0;
  const { enumerate } = makeEnumerate({
    search: async () => { searches += 1; return ok({ results: rows(4, "s"), has_more: false }); },
    rowScreen: (row, scope) => ({ uri: row.record_id, in_scope: scope.length > 0 }),
    capabilities: { countProbe: "none", screenSource: "search-row", ceilingDefault: 600 },
  });
  const out = parse(await enumerate("auth", { query: "X", in_scope_classes: [9] }, {}));
  assert.equal(out.state, "enumerated");
  assert.equal(out.total_hits, null);
  assert.equal(out.count, 4);
  assert.deepEqual(out.records[0].screen, { uri: "/mark/ch/s-0", in_scope: true });
  assert.equal(searches, 1);   // "search-row" screening costs ZERO extra calls
});

test('countProbe "none" disables the count-first rescue (there is nothing to count)', async () => {
  let searches = 0;
  const { enumerate } = makeEnumerate({
    search: async () => { searches += 1; return ok({ results: rows(100, "c"), has_more: true }); },
    rowScreen: (row) => ({ uri: row.record_id }),
    capabilities: { countProbe: "none", screenSource: "search-row", ceilingDefault: 50, pageSize: 100 },
  });
  const out = parse(await enumerate("auth", { names: ["A", "B"] }, {}));
  assert.equal(out.state, "incomplete");
  assert.equal(out.term_counts, undefined);
  assert.equal(searches, 1);
});

// ── SEAM 2: screenSource ──────────────────────────────────────────────────────

test('screenSource "billed-record-fetch": screening an enumerated band also HYDRATES it', async () => {
  const screened = [];
  const { enumerate } = makeEnumerate({
    search: async () => ok({ total_hits: 2, results: rows(2, "h"), has_more: false }),
    count: async () => ({ ok: true, total: 2 }),
    screen: async (a, p) => { screened.push(p.uris.length); return ok({ rows: p.uris.map((u) => ({ uri: u, markText: "ACME", statusClass: "live" })) }); },
    capabilities: { countProbe: "endpoint", screenSource: "billed-record-fetch" },
  });
  const out = parse(await enumerate("auth", { query: "ACME", in_scope_classes: [9] }, {}));
  assert.deepEqual(screened, [2]);
  assert.equal(out.records[1].screen.markText, "ACME");   // the billed call returns the full record
});

test('screenSource "search-row" without a rowScreen dependency fails LOUDLY at construction', () => {
  assert.throws(() => makeEnumerate({ search: async () => ok({}), capabilities: { screenSource: "search-row" } }),
    /requires a rowScreen\(\) dependency/);
});

test("screening is best-effort in every mode: a screen error never drops the band", async () => {
  const { enumerate } = makeEnumerate({
    search: async () => ok({ total_hits: 2, results: rows(2, "b"), has_more: false }),
    count: async () => ({ ok: true, total: 2 }),
    screen: async () => ({ type: "text", text: "ERROR: screen endpoint down" }),
    capabilities: { countProbe: "endpoint", screenSource: "billed-record-fetch" },
  });
  const out = parse(await enumerate("auth", { query: "ACME" }, {}));
  assert.equal(out.state, "enumerated");
  assert.equal(out.count, 2);
  assert.equal(out.records[0].screen, undefined);
});

process.on("exit", () => { try { rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ } });

// ── the count-first per-CLASS rescue (the owner lane) ───────────────

test('per-class rescue, "endpoint": an owner-scoped multi-class crowd is counted per class and every tractable leg enumerates', async () => {
  const perClass = { 5: 200, 30: 0, 32: 300 };
  const probes = [];
  const { enumerate } = makeEnumerate({
    search: async (a, p) => {
      const c = p.nice_classes?.[0];
      return ok({ total_hits: perClass[c], results: rows(perClass[c], `c${c}`), has_more: false });
    },
    count: async (a, p) => {
      probes.push((p.nice_classes ?? []).join("+"));
      if ((p.nice_classes ?? []).length !== 1) return { ok: true, total: 805 };
      return { ok: true, total: perClass[p.nice_classes[0]] };
    },
    screen: async (a, p) => ok({ rows: p.uris.map((u) => ({ uri: u })) }),
    capabilities: { countProbe: "endpoint", screenSource: "billed-record-fetch", ceilingDefault: 600 },
  });
  const out = parse(await enumerate("auth", { owner: "Jandor Holdings AG", nice_classes: [5, 30, 32] }, {}));
  assert.equal(out.state, "enumerated", "every leg resolved ⇒ the union of per-class enumerations IS the band");
  assert.equal(out.total_hits, 805);
  assert.equal(out.count, 500);
  assert.deepEqual(out.class_counts["30"], { total_hits: 0, disposition: "verified-zero" });
  assert.deepEqual(out.class_counts["5"], { total_hits: 200, disposition: "enumerated" });
  assert.deepEqual(out.class_counts["32"], { total_hits: 300, disposition: "enumerated" });
  // whole-stack count first, then one probe per class; the verified-zero leg is never searched
  assert.deepEqual(probes, ["5+30+32", "5", "30", "32", "5", "32"]);
});

test('per-class rescue: a saturated leg stays a CROWD in class_counts — a populated class is never recorded 0 or "unopened"', async () => {
  const perClass = { 5: 100, 30: 900, 32: 550 };
  const { enumerate } = makeEnumerate({
    search: async (a, p) => {
      const c = p.nice_classes?.[0];
      const n = Math.min(perClass[c], 600);
      return ok({ total_hits: perClass[c], results: rows(n, `c${c}`), has_more: false });
    },
    count: async (a, p) => ((p.nice_classes ?? []).length === 1
      ? { ok: true, total: perClass[p.nice_classes[0]] } : { ok: true, total: 1550 }),
    screen: async (a, p) => ok({ rows: p.uris.map((u) => ({ uri: u })) }),
    capabilities: { countProbe: "endpoint", screenSource: "billed-record-fetch", ceilingDefault: 600 },
  });
  const out = parse(await enumerate("auth", { owner: "Jandor Holdings AG", nice_classes: [5, 30, 32] }, {}));
  assert.equal(out.state, "incomplete", "an unresolved leg keeps the slice honest — never a self-accepted clean");
  assert.equal(out.class_counts["30"].disposition, "crowd");
  assert.equal(out.class_counts["5"].disposition, "enumerated");
  // 100 already merged; +550 would pass the one-ceiling budget ⇒ unenumerated, with its count carried
  assert.deepEqual(out.class_counts["32"], { total_hits: 550, disposition: "unenumerated" });
  assert.match(out.reason, /per-CLASS rescue/);
  assert.match(out.reason, /never recorded 0 and never "unopened"/);
  assert.equal(out.fetched, 100, "the tractable leg's records are CARRIED, not discarded");
});

test("per-class rescue fires ONLY on owner-scoped queries — an ordinary multi-class crowd keeps the instant descriptor", async () => {
  const calls = [];
  const { enumerate } = makeEnumerate({
    search: async () => ok({ total_hits: 0, results: [], has_more: false }),
    count: async (a, p) => { calls.push(p.nice_classes ?? []); return { ok: true, total: 5000 }; },
    screen: async () => ok({ rows: [] }),
    capabilities: { countProbe: "endpoint", screenSource: "billed-record-fetch", ceilingDefault: 600 },
  });
  const out = parse(await enumerate("auth", { query: "GLIMMERON", nice_classes: [5, 30, 32] }, {}));
  assert.equal(out.state, "incomplete");
  assert.match(out.reason, /CROWD/);
  assert.equal(calls.length, 1, "no per-class probes without an owner scope");
});

test('per-class rescue, "cheap": the page-0 crowd on an owner×term slice splits per class too', async () => {
  const perClass = { 5: 2, 32: 3 };
  const { enumerate } = makeEnumerate({
    search: async (a, p) => {
      const cs = p.nice_classes ?? [];
      if (cs.length !== 1) return ok({ total_hits: 700, results: rows(5, "stack"), has_more: false });
      if (p.limit === 1) return ok({ total_hits: perClass[cs[0]], results: [] });   // the cheap count probe
      return ok({ total_hits: perClass[cs[0]], results: rows(perClass[cs[0]], `c${cs[0]}`), has_more: false });
    },
    screen: async (a, p) => ok({ rows: p.uris.map((u) => ({ uri: u })) }),
    capabilities: { countProbe: "cheap", screenSource: "bulk-endpoint", ceilingDefault: 600 },
  });
  const out = parse(await enumerate("auth", { name: "GLIMMERON", owner: "Vantage Orchard Inc.", nice_classes: [5, 32] }, {}));
  assert.equal(out.state, "enumerated");
  assert.equal(out.count, 5);
  assert.deepEqual(out.class_counts["5"], { total_hits: 2, disposition: "enumerated" });
  assert.deepEqual(out.class_counts["32"], { total_hits: 3, disposition: "enumerated" });
});

test("per-class rescue: the multi-NAME rescue keeps precedence (term accounting is the finer truth on an OR-stack)", async () => {
  const { enumerate } = makeEnumerate({
    search: async (a, p) => {
      const n = p.names?.length === 1 && p.names[0] === "RARE" ? 2 : 0;
      return ok({ total_hits: n, results: rows(n, "r"), has_more: false });
    },
    count: async (a, p) => {
      const terms = p.names ?? [];
      if (terms.length > 1) return { ok: true, total: 5000 };
      return { ok: true, total: terms[0] === "RARE" ? 2 : 0 };
    },
    screen: async (a, p) => ok({ rows: p.uris.map((u) => ({ uri: u })) }),
    capabilities: { countProbe: "endpoint", screenSource: "billed-record-fetch", ceilingDefault: 10 },
  });
  const out = parse(await enumerate("auth", { names: ["ZERO", "RARE"], owner: "Vantage Orchard Inc.", nice_classes: [5, 32] }, {}));
  assert.equal(out.state, "enumerated");
  assert.ok(out.term_counts, "per-term truth rides the block");
  assert.equal(out.class_counts, undefined, "no per-class pass when the term rescue already resolved the stack");
});

test("per-class rescue: a failed class probe is an honest error disposition — never a zero (register-count rule 2)", async () => {
  const { enumerate } = makeEnumerate({
    search: async (a, p) => ok({ total_hits: 4, results: rows(4, "c5"), has_more: false }),
    count: async (a, p) => {
      const cs = p.nice_classes ?? [];
      if (cs.length !== 1) return { ok: true, total: 700 };
      if (cs[0] === 30) return { ok: false, reason: "HTTP 503" };
      return { ok: true, total: 4 };
    },
    screen: async (a, p) => ok({ rows: p.uris.map((u) => ({ uri: u })) }),
    capabilities: { countProbe: "endpoint", screenSource: "billed-record-fetch", ceilingDefault: 600 },
  });
  const out = parse(await enumerate("auth", { owner: "Jandor Holdings AG", nice_classes: [5, 30] }, {}));
  assert.equal(out.state, "incomplete");
  assert.deepEqual(out.class_counts["30"], { total_hits: null, disposition: "error" });
  assert.deepEqual(out.class_counts["5"], { total_hits: 4, disposition: "enumerated" });
});

test("per-class rescue: the post-resolution owners[] stack (the #116 shape) is owner-scoped too — resolution stays a bonus that never costs the sweep", async () => {
  // On the resolution provider the caller's {owner} arrives at the kernel already expanded to
  // owners:[raw, …resolved] (expandOwnerTerms). The rescue must key on THAT shape as well, and the
  // per-class probes reuse the same expanded params — so a widened sweep is rescued widened, and a
  // failed resolution (raw-only owners[]) is rescued raw: either way the sweep is never lost.
  const perClass = { 5: 3, 32: 4 };
  const probed = [];
  const { enumerate } = makeEnumerate({
    search: async (a, p) => {
      const c = p.nice_classes?.[0];
      return ok({ total_hits: perClass[c], results: rows(perClass[c], `c${c}`), has_more: false });
    },
    count: async (a, p) => {
      probed.push({ owners: p.owners, classes: p.nice_classes ?? [] });
      if ((p.nice_classes ?? []).length !== 1) return { ok: true, total: 900 };
      return { ok: true, total: perClass[p.nice_classes[0]] };
    },
    screen: async (a, p) => ok({ rows: p.uris.map((u) => ({ uri: u })) }),
    capabilities: { countProbe: "endpoint", screenSource: "billed-record-fetch", ceilingDefault: 600 },
  });
  const owners = ["Vantage Orchard Inc.", "VANTAGE ORCHARD INTERNATIONAL C.V."];
  const out = parse(await enumerate("auth", { owners, nice_classes: [5, 32] }, {}));
  assert.equal(out.state, "enumerated");
  assert.deepEqual(out.class_counts["5"], { total_hits: 3, disposition: "enumerated" });
  assert.ok(probed.every((p) => JSON.stringify(p.owners) === JSON.stringify(owners)),
    "every per-class probe carries the SAME (expanded) owner stack — the split narrows classes, never the owner scope");
});

// ── THE TRANSPORT SEAM — a rejection degrades ONE query, it does not abort the caller ────────────────
//
// These live here, in the KERNEL's own suite, and not only in one adapter's fault lane,
// because the whole argument for fixing this in providers/_shared rather than in one provider's core is
// "the guard is at a seam every provider shares." That claim has to be demonstrated at the seam itself,
// or a later refactor can quietly un-cover the providers that have no fault-lane suite of their own
// (clarivate is the one that matters: it ran the most recent live clearance).
//
// The contract in one line: a thrown ETIMEDOUT must come back through the SAME vocabulary a 503 does —
// `incomplete` + a "provider error" reason — and never as a new state, never as a deferred capability
// gap, and never as a zero.

test("transport: a search REJECTION degrades to incomplete, exactly like a 503", async () => {
  const { enumerate } = makeEnumerate({
    search: async () => { throw Object.assign(new Error("connect ETIMEDOUT 10.0.0.1:443"), { code: "ETIMEDOUT" }); },
    screen: async () => ok({ rows: [] }),
    capabilities: { countProbe: "cheap", screenSource: "bulk-endpoint" },
  });
  const out = parse(await enumerate("auth", { name: "ACME" }, {}));
  assert.equal(out.state, "incomplete");
  assert.match(out.reason, /provider error during enumeration \(page 0\)/);
  // The errno is the entire diagnostic payload and the reason is truncated at 140 chars — it has to
  // survive, so it is placed early rather than after the message.
  assert.match(out.reason, /ETIMEDOUT/);
  assert.notEqual(out.total_hits, undefined);
});

test("transport: a rejection on the ENDPOINT count probe is an honest unknown, never a zero", async () => {
  const { enumerate } = makeEnumerate({
    search: async () => ok({ total_hits: 0, results: [], has_more: false }),
    count: async () => { throw Object.assign(new Error("getaddrinfo EAI_AGAIN"), { code: "EAI_AGAIN" }); },
    screen: async () => ok({ rows: [] }),
    capabilities: { countProbe: "endpoint", screenSource: "billed-record-fetch" },
  });
  const out = parse(await enumerate("auth", { name: "ACME" }, {}));
  assert.equal(out.state, "incomplete");
  assert.match(out.reason, /provider error on the count probe before enumeration/);
  assert.match(out.reason, /EAI_AGAIN/);
});

test("transport: the count kernel reports total NULL on a rejection — never a counted 0", async () => {
  const { makeCountProbe } = await import("../count.mjs");
  const cheap = makeCountProbe({
    search: async () => { throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }); },
    capabilities: { countProbe: "cheap" },
  });
  const c = await cheap("auth", { name: "ACME" }, {});
  assert.equal(c.ok, false);
  assert.equal(c.total, null, "a count that never got an answer is UNKNOWN — a 0 here would be a fabricated clean");
  assert.match(String(c.reason), /ECONNRESET/);

  const endpoint = makeCountProbe({
    count: async () => { throw new Error("boom"); },
    capabilities: { countProbe: "endpoint" },
  });
  const e = await endpoint("auth", { name: "ACME" }, {});
  assert.equal(e.ok, false);
  assert.equal(e.total, null);
});

test("transport: screening that REJECTS never drops an enumerated band", async () => {
  const { enumerate } = makeEnumerate({
    search: async () => ok({ total_hits: 2, results: rows(2, "s"), has_more: false }),
    screen: async () => { throw Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" }); },
    capabilities: { countProbe: "cheap", screenSource: "bulk-endpoint" },
  });
  // Screening is BEST-EFFORT on a content-carrying provider: the records still cross with their
  // search-row facts. The band survives; only the screening attachment is missing.
  const out = parse(await enumerate("auth", { name: "ACME" }, {}));
  assert.equal(out.state, "enumerated");
  assert.equal(out.count, 2);
});

test("transport: on a screen-sourced-content provider a screen REJECTION is a content-loss incomplete", async () => {
  const { enumerate } = makeEnumerate({
    search: async () => ok({ total_hits: 2, results: rows(2, "s"), has_more: false }),
    count: async () => ({ ok: true, total: 2 }),
    screen: async () => { throw Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" }); },
    capabilities: { countProbe: "endpoint", screenSource: "billed-record-fetch", contentFromScreen: true },
  });
  const out = parse(await enumerate("auth", { name: "ACME" }, {}));
  assert.equal(out.state, "incomplete", "bare ids with no mark text can never ship as a completed band");
  assert.match(out.reason, /provider error/);
});

test("transport: ONE rejecting entry degrades that entry — the rest of the plan still executes", async () => {
  const { makeExecutePlan } = await import("../execute-plan.mjs");
  const { mkdtempSync: mkd, writeFileSync: wf, readFileSync: rf } = await import("node:fs");
  const dir = mkd(join(tmpdir(), "kernel-transport-plan-"));
  const planPath = join(dir, "plan.json");
  const outPath = join(dir, "band.json");
  const entries = ["a", "DEAD", "c"].map((t, i) => ({ qid: `q${i}`, axis: "ch", predicate: "exact", term: t, nice_classes: [9] }));
  wf(planPath, JSON.stringify({ entries }));

  // The rejection is raised by the PROVIDER'S EXPORTED enumerate — outside the enumerate kernel. That is
  // deliberate: clarivate's exported doEnumerate resolves owner names over the network before the kernel
  // ever runs, so this seam is the only thing standing between that call and a dead stage.
  const executePlan = makeExecutePlan({
    search: async () => ok({ total_hits: 0, results: [] }),
    enumerate: async (a, p) => {
      if (String(p.name) === "DEAD") throw Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" });
      return ok({ state: "enumerated", total_hits: 1, count: 1, records: rows(1, "ok") });
    },
  });
  const summary = JSON.parse((await executePlan("auth", { plan_path: planPath, axis: "ch", output_path: outPath }, {})).text);
  assert.deepEqual(summary.states, { q0: "enumerated", q1: "error", q2: "enumerated" },
    "the timed-out entry is the ONLY casualty — a plan carries tens of independent queries");
  const band = JSON.parse(rf(outPath, "utf8"));
  const dead = band.find((b) => b.qid === "q1");
  assert.equal(dead.error, true);
  assert.match(dead.reason, /provider error \(after one in-tool retry\)/, "same vocabulary a 503 produces");
  assert.notEqual(dead.deferred, true,
    "a transport fault is TRANSIENT and rides the repair ladder — deferral is for a capability the provider genuinely lacks");
  rmSync(dir, { recursive: true, force: true });
});

test("transport: the capability-gap marker the guard mirrors is the real one", async () => {
  const { CAPABILITY_GAP_MARKER, isCapabilityGap } = await import("../execute-plan.mjs");
  const { __CAPABILITY_GAP_MARKER_MIRROR, faultText } = await import("../transport-guard.mjs");
  assert.equal(__CAPABILITY_GAP_MARKER_MIRROR, CAPABILITY_GAP_MARKER,
    "transport-guard.mjs mirrors this literal to stay dependency-free — if it drifts, a timeout starts being disclosed as a permanent capability gap");
  // A provider whose error text happens to carry the marker must still classify TRANSIENT.
  assert.equal(isCapabilityGap(faultText(new Error(`${CAPABILITY_GAP_MARKER} not really`), "search")), false);
});

test("transport: the REAL undici shape (TypeError: fetch failed) still names its errno", async () => {
  // This is the object node actually throws on a live timeout — the opaque message at the top level and
  // the only useful fact hidden on `cause`. If the guard read `err.code` alone, every live reset, DNS
  // failure and timeout would land in the band as the same undiagnosable string.
  const { faultText } = await import("../transport-guard.mjs");
  const real = Object.assign(new TypeError("fetch failed"),
    { cause: Object.assign(new Error("connect ETIMEDOUT 10.0.0.1:443"), { code: "ETIMEDOUT" }) });
  const text = faultText(real, "search");
  assert.match(text, /^ETIMEDOUT — /, "the errno leads: every consumer truncates this line");
  assert.match(text, /connect ETIMEDOUT 10\.0\.0\.1:443/, "the cause's message carries the address that timed out");
});

// ── audit item 5a — the count arm owns the deferral lane too ─────────────────────────────────────────
test("count descriptor: a capability-gap refusal is DEFERRED — no repair rung can change a client-side no", async () => {
  const { makeExecutePlan, CAPABILITY_GAP_MARKER, isCapabilityGap } = await import("../execute-plan.mjs");
  const { mkdtempSync: mkd, writeFileSync: wf, readFileSync: rf } = await import("node:fs");
  const dir = mkd(join(tmpdir(), "kernel-count-gap-"));
  wf(join(dir, "plan.json"), JSON.stringify({ entries: [
    { qid: "q0", axis: "ch", predicate: "exact", term: "NOVAWELD", nice_classes: [9], regions: ["XA"], expected_kind: "count" },
  ] }));
  // The REAL refusal shape: clarivate's execute-plan `search` is doCount-backed, and doCount's
  // buildSearchRequest catch marks every client-side refusal (an office outside the 186-code
  // vocabulary, a reserved operator word, parentheses) with the capability-gap marker. This exact text
  // reached the count arm and rode the repair ladder anyway — only the enumerate arm called
  // isCapabilityGap. (The parenthetical/operator shapes are refused even earlier by the kernel's own
  // plan-defect guard, so the vocabulary refusal is the one that genuinely arrives via the wire path.)
  const refusal = `ERROR: clarivate count probe — ${CAPABILITY_GAP_MARKER} jurisdiction(s) [XA] are outside this provider's registrationOfficeCode vocabulary — a coverage gap to disclose, never a filter to drop`;
  assert.ok(isCapabilityGap(refusal), "precondition: the fixture carries the real marker");
  const executePlan = makeExecutePlan({
    search: async () => ({ type: "text", text: refusal }),
    enumerate: async () => ok({ state: "enumerated", total_hits: 0, count: 0, records: [] }),
  });
  const outPath = join(dir, "band.json");
  const summary = parse(await executePlan("auth", { plan_path: join(dir, "plan.json"), axis: "ch", output_path: outPath }, {}));
  assert.deepEqual(summary.states, { q0: "error" }, "still an error — never a sanctioned crowd");
  const block = JSON.parse(rf(outPath, "utf8")).find((b) => b.qid === "q0");
  assert.equal(block.error, true, "the error stamp is KEPT (no consumer may read this as executed)");
  assert.equal(block.deferred, true,
    "…and the deterministic refusal joins the DEFERRED bucket — a disclosed gap, not a StageFailure grind");
  assert.match(block.reason, /provider error on the count probe/);

  // The control: a transient count failure keeps riding the repair ladder, exactly as before.
  const transientPlan = makeExecutePlan({
    search: async () => ({ type: "text", text: "ERROR: clarivate count probe — HTTP 503: upstream unavailable" }),
    enumerate: async () => ok({ state: "enumerated", total_hits: 0, count: 0, records: [] }),
  });
  const outPath2 = join(dir, "band2.json");
  await transientPlan("auth", { plan_path: join(dir, "plan.json"), axis: "ch", output_path: outPath2 }, {});
  const t = JSON.parse(rf(outPath2, "utf8")).find((b) => b.qid === "q0");
  assert.equal(t.error, true);
  assert.notEqual(t.deferred, true,
    "a 503 is weather — deferral here would disclose a permanent gap the provider does not have");
  rmSync(dir, { recursive: true, force: true });
});

// ──: THE SCREEN LIFT NEVER SKIPS IN SILENCE ────────────────────────────────────────────────────
//
// The kernel had two ways to do nothing and say nothing. Both produced a band stamped `enumerated`
// whose records carried null mark_text/classes/status/owner_name — the exact review-findings 7/15
// symptom the lift was written to fix, re-created by a vocabulary mismatch instead of a missing lift.
//
// The pre-existing "screening that REJECTS never drops an enumerated band" test above is DELIBERATE and
// still passes: a screen call that fails outright on a content-carrying provider is best-effort and the
// band survives. These cases are different — the call SUCCEEDS and the lift still does nothing.
test("#729 a screen answering under the WRONG LIST NAME is reported on the band, not skipped in silence", async () => {
  const { enumerate } = makeEnumerate({
    search: async () => ok({ total_hits: 2, results: rows(2, "s"), has_more: false }),
    // 200, well-formed JSON, plausible content — under `brands` instead of `rows`.
    screen: async () => ok({ brands: [{ uri: "/mark/ch/s-0", mark_text: "ACME" }] }),
    capabilities: { countProbe: "cheap", screenSource: "bulk-endpoint" },
  });
  const out = parse(await enumerate("auth", { name: "ACME" }, {}));
  assert.equal(out.state, "enumerated",
    "still survivable on a content-carrying provider — the search row already holds mark text, so this is a degradation and not a hole");
  assert.ok(out.screen_lift, "but it is NO LONGER SILENT — that was the whole defect");
  assert.equal(out.screen_lift.applied, false);
  assert.match(out.screen_lift.reason, /no `rows` array/);
});

test("#729 a join key that lines up with NOTHING is content loss on a screen-sourced provider", async () => {
  // The rows are well-formed and under the right name; they simply identify themselves with the OTHER
  // declared spelling (`record_id` where this provider's screenJoinKey reads `uri`). byUri then collapses
  // to a single entry keyed `undefined` and every get() misses. The old contentFromScreen gate inspected
  // only whether the CALL succeeded, so this shipped a full band of nameless ids as `enumerated`.
  const { enumerate } = makeEnumerate({
    search: async () => ok({ total_hits: 2, results: rows(2, "s"), has_more: false }),
    count: async () => ({ ok: true, total: 2 }),
    screen: async () => ok({ rows: [{ record_id: "/mark/ch/s-0", mark_text: "ACME" }, { record_id: "/mark/ch/s-1", mark_text: "BETA" }] }),
    capabilities: { countProbe: "endpoint", screenSource: "billed-record-fetch", contentFromScreen: true },
  });
  const out = parse(await enumerate("auth", { name: "ACME" }, {}));
  assert.equal(out.state, "incomplete", "bare ids with no mark text can never ship as a completed band");
  assert.match(out.reason, /NOT ONE joined/);
});

test("#729 a SHORT join is still legitimate and must not become a false incomplete", async () => {
  // A record-content endpoint may answer for fewer ids than it was asked about — a guid that is not a
  // trademark record yields no content, and that is a provider FACT. Keying the new check on row
  // shortfall rather than on a zero join would turn every such band into a false refusal.
  const { enumerate } = makeEnumerate({
    search: async () => ok({ total_hits: 3, results: rows(3, "s"), has_more: false }),
    count: async () => ({ ok: true, total: 3 }),
    screen: async () => ok({ rows: [{ uri: "/mark/ch/s-0", mark_text: "ACME" }] }),   // 1 of 3, and it JOINS
    capabilities: { countProbe: "endpoint", screenSource: "billed-record-fetch", contentFromScreen: true },
  });
  const out = parse(await enumerate("auth", { name: "ACME" }, {}));
  assert.equal(out.state, "enumerated", "one real join is evidence the vocabulary lines up");
  assert.equal(out.screen_lift, undefined, "and a band whose lift APPLIED carries no complaint");
});

test("#729 a clean full join stays byte-identical — no new field on the happy path", async () => {
  const { enumerate } = makeEnumerate({
    search: async () => ok({ total_hits: 2, results: rows(2, "s"), has_more: false }),
    screen: async () => ok({ rows: [{ uri: "/mark/ch/s-0", mark_text: "ACME" }, { uri: "/mark/ch/s-1", mark_text: "BETA" }] }),
    capabilities: { countProbe: "cheap", screenSource: "bulk-endpoint" },
  });
  const out = parse(await enumerate("auth", { name: "ACME" }, {}));
  assert.equal(out.state, "enumerated");
  assert.equal(out.screen_lift, undefined);
  assert.equal(out.records[0].mark_text, "ACME", "the lift still lifts");
});
