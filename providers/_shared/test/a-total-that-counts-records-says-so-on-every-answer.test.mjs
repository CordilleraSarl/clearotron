// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A TOTAL THAT COUNTS RECORDS SAYS SO ON EVERY ANSWER.
//
// A register can answer a filter its grouped view cannot serve with one row per record, so a mark filed
// in several countries is counted once per country it covers, and it says so. The shared enumeration
// keeps the register's number exactly as it was (ruled 2026-10-02: record only, no extra call) and states
// on the answer what the number counts, whichever way the answer leaves: a crowd, a listing, the name
// windows, the region halves, the two rescues, the page limit or a count the rows contradict. Each
// per-spelling and per-class count carries what its OWN count said.
//
// Driven through makeEnumerate with a stand-in register; every case first proves the exit it names was
// the one taken, and the list of exits taken is held to the list below, so an exit that stops being
// reached fails here rather than passing quietly. Invented names only.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "total-counts-"));
process.env.CLEAROTRON_REGISTER_CALL_LOG = join(TMP, "calls.jsonl");
process.env.CLEAROTRON_REGISTER_RECORD_LOG = join(TMP, "records.jsonl");
after(() => rmSync(TMP, { recursive: true, force: true }));

const { makeEnumerate } = await import("../enumerate.mjs");

const GATEWAY = "ERROR: register_search HTTP 504: Error 504: Gateway time-out";
const text = (obj) => ({ type: "text", text: JSON.stringify(obj) });
const rows = (n, tag = "r") => Array.from({ length: n }, (_, i) => ({ record_id: `/mark/zz/${tag}${i}` }));

/**
 * A stand-in register. `answer(params)` returns `{ total, rows, more }`, or null for a gateway timeout;
 * `flags(params)` says whether this answer counts records. The register's flag is the provider's parsed
 * `total_counts`, as the register adapter writes it.
 */
function register({ answer, flags = () => true, ...capabilities }) {
  const { enumerate } = makeEnumerate({
    search: async (_auth, params) => {
      const a = answer(params);
      if (!a) return { type: "text", text: GATEWAY };
      const page = params.limit === 1 ? [] : a.rows;
      return text({ total_hits: a.total, results: page, has_more: a.more === true && params.limit !== 1,
        ...(flags(params) ? { total_counts: "records" } : {}) });
    },
    capabilities: { countProbe: "cheap", screenSource: "search-row", ceilingDefault: 600, ...capabilities },
    rowScreen: () => ({ screen_verdict: "live" }),
  });
  return (params) => enumerate({}, params, null).then((r) => JSON.parse(r.text));
}

const withEnv = async (vars, fn) => {
  const prev = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
};

// Each exit: how to reach it, and the evidence that it was the one reached.
const EXITS = {
  "a crowd at page 0": {
    run: (flags) => register({ flags, answer: () => ({ total: 700, rows: rows(100) }) })({ names: ["QZXV"] }),
    proves: (out) => out.state === "incomplete" && /exceeds the enumerate ceiling 600/.test(out.reason),
  },
  "a listing read to the end": {
    run: (flags) => register({ flags, answer: () => ({ total: 3, rows: rows(3) }) })({ names: ["QZXV"] }),
    proves: (out) => out.state === "enumerated" && out.count === 3,
  },
  "the name windows, merged": {
    run: (flags) => withEnv({ CLEAROTRON_ENUMERATE_NAMES_CHUNK: "2" }, () =>
      register({ flags, answer: (p) => ({ total: p.names.length, rows: rows(p.names.length, p.names[0]) }) })({ names: ["QA", "QB", "QC"] })),
    proves: (out) => out.state === "enumerated" && out.count === 3,
  },
  "the per-spelling rescue": {
    run: (flags) => register({ flags, answer: (p) => (p.names.length > 1 ? { total: 700, rows: rows(100) } : { total: p.names[0] === "QA" ? 12 : 0, rows: [] }) })({ names: ["QA", "QB"] }),
    proves: (out) => out.term_counts?.QA?.disposition === "unenumerated" && out.term_counts?.QB?.disposition === "verified-zero",
  },
  "the per-class rescue": {
    run: (flags) => register({ flags, answer: (p) => (p.nice_classes.length > 1 ? { total: 700, rows: rows(100) }
      : p.nice_classes[0] === 9 ? { total: 4, rows: rows(4, "c9") } : { total: 0, rows: [] }) })({ owner: "Zorvex Holdings", nice_classes: [9, 42] }),
    proves: (out) => out.class_counts?.[9]?.disposition === "enumerated" && out.class_counts?.[42]?.disposition === "verified-zero",
  },
  "the region halves, merged": {
    run: (flags) => register({ flags, answer: (p) => (p.regions.length > 2 ? null : { total: p.regions.length, rows: rows(p.regions.length, p.regions[0]) }) })({ names: ["QZXV"], regions: ["AA", "BB", "CC", "DD"] }),
    proves: (out) => out.state === "enumerated" && Boolean(out.region_split),
  },
  "the page limit": {
    run: (flags) => register({ flags, pageGuard: 2, answer: () => ({ total: 500, rows: rows(100), more: true }) })({ names: ["QZXV"] }),
    proves: (out) => out.state === "incomplete" && /pagination guard hit/.test(out.reason),
  },
  "a count the rows contradict": {
    run: (flags) => register({ flags, answer: () => ({ total: 5, rows: rows(3) }) })({ names: ["QZXV"] }),
    proves: (out) => out.state === "incomplete" && /count\/search divergence/.test(out.reason),
  },
};

const counts = (out) => [out, ...Object.values(out.term_counts ?? {}), ...Object.values(out.class_counts ?? {})]
  .filter((x) => x.disposition !== "error");

test("every exit states that its total counts records when the register said so", async () => {
  const reached = [];
  for (const [name, exit] of Object.entries(EXITS)) {
    const out = await exit.run(() => true);
    assert.ok(exit.proves(out), `${name}: the exit was not the one reached — ${JSON.stringify(out).slice(0, 300)}`);
    reached.push(name);
    assert.equal(out.total_counts, "records", `${name}: the answer does not say what its total counts`);
    for (const c of counts(out)) assert.equal(c.total_counts, "records", `${name}: a count inside the answer does not say so: ${JSON.stringify(c)}`);
  }
  assert.deepEqual(reached, Object.keys(EXITS), "an exit was not driven");
});

test("CONTROL — a register that said nothing leaves no statement anywhere, and the numbers are the same", async () => {
  for (const [name, exit] of Object.entries(EXITS)) {
    const flagged = await exit.run(() => true);
    const silent = await exit.run(() => false);
    assert.ok(exit.proves(silent), `${name}: the silent run took another exit`);
    assert.doesNotMatch(JSON.stringify(silent), /total_counts/, `${name}: a statement nobody made`);
    assert.equal(silent.total_hits, flagged.total_hits, `${name}: the register's number changed — this records, it decides nothing`);
    assert.equal(silent.state, flagged.state, `${name}: the answer's state changed`);
  }
});

test("a per-class and a per-spelling count each say what their own count said, not what the question's did", async () => {
  // The question's total is flagged; only class 9's own count is. Class 42's count carries nothing.
  const byClass = await register({
    flags: (p) => p.nice_classes.length > 1 || p.nice_classes[0] === 9,
    answer: (p) => (p.nice_classes.length > 1 ? { total: 700, rows: rows(100) } : p.nice_classes[0] === 9 ? { total: 4, rows: rows(4, "c9") } : { total: 3, rows: rows(3, "c42") }),
  })({ owner: "Zorvex Holdings", nice_classes: [9, 42] });
  assert.equal(byClass.total_counts, "records");
  assert.equal(byClass.class_counts[9].total_counts, "records");
  assert.equal("total_counts" in byClass.class_counts[42], false, "class 42's count said nothing and was stamped anyway");

  const bySpelling = await register({
    flags: (p) => p.names.length > 1 || p.names[0] === "QA",
    answer: (p) => (p.names.length > 1 ? { total: 700, rows: rows(100) } : { total: p.names[0] === "QA" ? 12 : 7, rows: [] }),
  })({ names: ["QA", "QB"] });
  assert.equal(bySpelling.term_counts.QA.total_counts, "records");
  assert.equal("total_counts" in bySpelling.term_counts.QB, false);
});
