// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Unit tests for the Corsearch per-run usage rollup (provider-usage.mjs).
// Pure offline: builds a synthetic ledger in a temp file and asserts the tally — no network, no gateway.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { tallyRegisterCalls, KINDS } from "../provider-usage.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const RUN = "prelim-acme-bluejay-";

// Write the given ledger rows (objects, one per line) to a fresh temp file and tally THIS run.
function tallyRows(rows, prefix = RUN) {
  const dir = mkdtempSync(join(tmpdir(), "corsearch-ledger-"));
  const path = join(dir, "calls.jsonl");
  writeFileSync(path, rows.map((r) => (typeof r === "string" ? r : JSON.stringify(r))).join("\n") + "\n");
  try { return tallyRegisterCalls(path, prefix); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

const row = (o) => ({ ts: "2026-06-05T00:00:00Z", sessionKey: `${RUN}primary-sweep`, ok: true, attempts: 1, bytes: 100, cache_hit: false, ...o });

test("missing ledger → all-zero tally, never throws", () => {
  const t = tallyRegisterCalls("/no/such/ledger.jsonl", RUN);
  assert.equal(t.total, 0);
  assert.equal(t.record_fetch, 0);
  assert.equal(t.duplicate_fetches, 0);
});

test("no runPrefix → all-zero tally", () => {
  assert.equal(tallyRegisterCalls("/tmp/whatever.jsonl", undefined).total, 0);
});

test("tallies per-tool counts, total, and bytes for the matching run only", () => {
  const t = tallyRows([
    row({ tool: "search", bytes: 37000 }),
    row({ tool: "record_fetch", target: "/mark/us/1", bytes: 9000 }),
    row({ tool: "record_fetch", target: "/mark/us/2", bytes: 8000 }),
    row({ tool: "image", target: "/x.png", bytes: 500 }),
    row({ tool: "phoneme", target: "nike|en_US", bytes: 200 }),
    // a DIFFERENT run — must be excluded
    row({ tool: "search", sessionKey: "prelim-other-run-primary-sweep", bytes: 99999 }),
  ]);
  assert.equal(t.total, 5);
  assert.equal(t.search, 1);
  assert.equal(t.record_fetch, 2);
  assert.equal(t.image, 1);
  assert.equal(t.phoneme, 1);
  assert.equal(t.bytes, 37000 + 9000 + 8000 + 500 + 200);
});

test("retries = Σ(attempts-1); errors count ok:false (incl. transport throws)", () => {
  const t = tallyRows([
    row({ tool: "search", attempts: 3 }),                       // 2 retries
    row({ tool: "record_fetch", target: "/m/1", attempts: 2 }), // 1 retry
    row({ tool: "record_fetch", target: "/m/2", ok: false, http_status: 500, attempts: 2 }), // 1 retry + error
    row({ tool: "record_fetch", target: "/m/3", ok: false, http_status: 0, attempts: 1 }),   // transport throw
  ]);
  assert.equal(t.retries, 2 + 1 + 1);
  assert.equal(t.errors, 2);
});

test("duplicate detail-fetches split same- vs cross-session; first fetch is not a duplicate", () => {
  const t = tallyRows([
    // /m/1 fetched 3× — once in primary-sweep, then again same axis (same-session dup), then in another axis (cross-session dup)
    row({ tool: "record_fetch", target: "/m/1", sessionKey: `${RUN}primary-sweep` }),
    row({ tool: "record_fetch", target: "/m/1", sessionKey: `${RUN}primary-sweep` }),
    row({ tool: "record_fetch", target: "/m/1", sessionKey: `${RUN}incumbent-class` }),
    // /m/2 fetched once — no duplicate
    row({ tool: "record_fetch", target: "/m/2", sessionKey: `${RUN}primary-sweep` }),
  ]);
  assert.equal(t.record_fetch, 4);
  assert.equal(t.duplicate_fetches, 2);
  assert.equal(t.duplicate_fetches_same_session, 1);
  assert.equal(t.duplicate_fetches_cross_session, 1);
});

test("a cache_hit counts as a hit but NOT as a new duplicate fetch", () => {
  const t = tallyRows([
    row({ tool: "record_fetch", target: "/m/1" }),                  // first real fetch
    row({ tool: "record_fetch", target: "/m/1", cache_hit: true }), // served from cache — not a network dup
  ]);
  assert.equal(t.cache_hits, 1);
  assert.equal(t.duplicate_fetches, 0); // the cache hit avoided the duplicate; it is not counted as one
});

test("matches the run on sessionId when sessionKey is absent", () => {
  const t = tallyRows([
    { ts: "t", sessionKey: null, sessionId: `${RUN}synthesis`, tool: "search", ok: true, attempts: 1, bytes: 10, cache_hit: false },
  ]);
  assert.equal(t.search, 1);
  assert.equal(t.total, 1);
});

test("tolerates a torn/partial concurrent-append line (skips it, keeps going)", () => {
  const t = tallyRows([
    JSON.stringify(row({ tool: "search" })),
    '{"tool":"record_fetch","sessionKey":"prelim-acme-bluejay-x","target":"/m/1",',  // torn line — no closing brace
    JSON.stringify(row({ tool: "record_fetch", target: "/m/9" })),
  ]);
  assert.equal(t.total, 2);          // the two valid lines
  assert.equal(t.search, 1);
  assert.equal(t.record_fetch, 1);
});

test("rerun suffixes still attribute to the run (prefix match covers -rerunN)", () => {
  const t = tallyRows([
    row({ tool: "search", sessionKey: `${RUN}narrative-refutation` }),
    row({ tool: "search", sessionKey: `${RUN}narrative-refutation-rerun1` }),
    row({ tool: "search", sessionKey: `${RUN}narrative-refutation-fb` }),
  ]);
  assert.equal(t.search, 3);
});

test("attributes gateway-namespaced sessionKeys: agent:<id>:prelim-… (the live format)", () => {
  // The gateway prepends `agent:<agentId>:` to the driver's --session-key before it reaches the plugin;
  // a bare startsWith("prelim-…") would miss all of these. This is the exact shape seen on the first live run.
  const t = tallyRows([
    { ts: "t", sessionKey: `agent:clawdi:${RUN}register-unit-primary-sweep`,            sessionId: "uuid-a", tool: "search",       ok: true, attempts: 1, bytes: 10, cache_hit: false },
    { ts: "t", sessionKey: `agent:clawdi:${RUN}register-unit-transliteration-numeric`,  sessionId: "uuid-b", tool: "record_fetch", target: "/m/1", ok: true, attempts: 1, bytes: 20, cache_hit: false },
    // a DIFFERENT run, also namespaced — must be excluded
    { ts: "t", sessionKey: "agent:clawdi:prelim-other-run-primary-sweep",               sessionId: "uuid-c", tool: "search",       ok: true, attempts: 1, bytes: 5,  cache_hit: false },
  ]);
  assert.equal(t.total, 2);
  assert.equal(t.search, 1);
  assert.equal(t.record_fetch, 1);
});

// ── AD-4 (2026-07-30 addendum): the search:0-vs-total:286 class ─────────────────────────────────────
// The R2 evidence run's calls all rode `execute_plan` — a kind the KINDS list had fallen behind on — so
// the tally printed search:0 against total:286 and "not classified" was indistinguishable from "no
// searches happened". The current kinds are first-class now, and ANY tool name lands in by_tool
// unconditionally, with names outside KINDS counted in `unclassified` instead of vanishing into total.

test("execute_plan / enumerate / propose_supplemental are first-class counters (the R2 shape can't recur)", () => {
  const t = tallyRows([
    row({ tool: "execute_plan", target: "plan:axis-1" }),
    row({ tool: "execute_plan", target: "plan:axis-2" }),
    row({ tool: "enumerate" }),
    row({ tool: "propose_supplemental" }),
  ]);
  assert.equal(t.total, 4);
  assert.equal(t.execute_plan, 2);
  assert.equal(t.enumerate, 1);
  assert.equal(t.propose_supplemental, 1);
  assert.equal(t.unclassified, 0, "every current MCP-server kind is classified");
});

test("by_tool is the complete unconditional census; an unknown tool name counts as unclassified, never vanishes", () => {
  const t = tallyRows([
    row({ tool: "search" }),
    row({ tool: "register_search_v2" }),   // a future rename this module doesn't know yet
    row({ tool: "register_search_v2" }),
    row({ ...row({}), tool: undefined }),  // a row with no tool name at all
  ]);
  assert.equal(t.total, 4);
  assert.equal(t.search, 1);
  assert.equal(t.unclassified, 3, "2 unknown-name rows + 1 nameless row — visible, not silently absorbed into total");
  assert.deepEqual(t.by_tool, { search: 1, register_search_v2: 2, "(none)": 1 },
    "the census names the unknown tool, so the KINDS gap is diagnosable from the tally alone");
});

test("empty tally carries by_tool/unclassified unconditionally (a reader never distinguishes 'absent' from 'zero')", () => {
  const t = tallyRegisterCalls("/no/such/ledger.jsonl", RUN);
  assert.deepEqual(t.by_tool, {});
  assert.equal(t.unclassified, 0);
  assert.equal(t.execute_plan, 0);
});

// ── post-merge audit of ──────────────────────────────────────────────────────────────────────────
// The last "a zero that means not-recorded" in this module. Every early return above produced the SAME
// all-zero tally, so a CLEAROTRON_REGISTER_CALL_LOG pointing at a path that is not there journalled a clean
// `total=0 ((none))` — identical to a run that genuinely made no provider calls. The four facts behind
// the zeros (configured / present / readable / rowsScanned) are now on the tally, so the note line and the
// provider-usage event can say which one it is, and a greenlight pre-flight can assert `present` before a
// paid run starts rather than discovering it at publish time.
test("AUDIT #172/4 — a NOT-CONFIGURED ledger path marks the zeros as not-measured", () => {
  const t = tallyRegisterCalls(null, RUN);
  assert.equal(t.total, 0);
  assert.equal(t.ledger.configured, false, "no path was ever supplied — nothing was looked at");
  assert.equal(t.ledger.present, false);
  assert.equal(t.ledger.readable, false);
  assert.equal(t.ledger.rowsScanned, 0);
});

test("AUDIT #172/4 — a MISSING ledger file is distinguishable from a run that made no calls", () => {
  const missing = tallyRegisterCalls("/no/such/ledger.jsonl", RUN);
  assert.equal(missing.total, 0);
  assert.equal(missing.ledger.configured, true, "a path WAS configured…");
  assert.equal(missing.ledger.present, false, "…and it is not there — the tonight's-E2E mis-pointed-path case");
  assert.equal(missing.ledger.rowsScanned, 0);
  // the tally rides status.json and the MCP tool responses, so it names no filesystem: the path is on the
  // driver's own stderr note and nowhere else
  assert.equal("path" in missing.ledger, false, "no service-account path on a surface a tool can return");
  assert.doesNotMatch(JSON.stringify(missing), /\//, "no path fragment anywhere on the tally");

  // the same zeros, honestly earned: the ledger was READ and carried traffic, none of it this run's
  const empty = tallyRows([row({ tool: "search", sessionKey: "prelim-other-run-primary-sweep" })]);
  assert.equal(empty.total, 0, "same total…");
  assert.equal(empty.ledger.present, true, "…utterly different provenance");
  assert.equal(empty.ledger.readable, true);
  assert.equal(empty.ledger.rowsScanned, 1, "the ledger had a row; it just was not ours");
});

test("AUDIT #172/4 — a real tally reports how many ledger rows it actually scanned", () => {
  const t = tallyRows([
    row({ tool: "execute_plan" }),
    row({ tool: "execute_plan" }),
    row({ tool: "search", sessionKey: "prelim-other-run-x" }),   // scanned, not attributed
  ]);
  assert.equal(t.total, 2, "only this run's rows are tallied");
  assert.equal(t.execute_plan, 2, "the R2 shape: the whole register workload under one kind");
  assert.equal(t.ledger.rowsScanned, 3, "…out of 3 rows read — the denominator is recorded too");
  assert.equal(t.ledger.readable, true);
});

// ── — the KINDS list is now CHECKED against the servers that stamp the names ────────────────────
// AD-4's rule (1) — "the list carries every kind the MCP servers currently stamp" — was prose. Nothing
// failed when a server gained a `tctx("<kind>")` the list did not know; the only signal was an
// `unclassified` count on a run that had already been paid for, read after the fact. That is the same
// after-the-fact diagnosis the R2 evidence run got. This reads the servers' own source and makes the
// coupling a build-time failure.
//
// ONE DIRECTION ONLY, and deliberately: stamped ⊆ KINDS. The reverse does not hold, because KINDS is the
// UNION across register providers and exactly one is wired per run (REGISTER_PROVIDER) — under signa six
// entries have no stamp site at all, and clarivate deliberately serves no phoneme tool. A per-provider
// dead entry is expected, not drift.
test("#249: KINDS covers every kind the MCP servers stamp — the list cannot silently fall behind", () => {
  const mcpDir = join(HERE, "..", "engine", "mcp");
  const servers = readdirSync(mcpDir).filter((f) => f.endsWith("-server.mjs"));
  assert.ok(servers.length >= 3, `expected the MCP server sources at ${mcpDir}; found ${servers.length} — the scrape is looking in the wrong place`);

  const stamped = new Map();   // kind → the files that stamp it
  for (const f of servers) {
    const src = readFileSync(join(mcpDir, f), "utf8");
    for (const m of src.matchAll(/\btctx\(\s*["']([a-z_]+)["']/g))
      stamped.set(m[1], [...(stamped.get(m[1]) ?? []), f]);
  }
  // Zero-semantics: a regex that matched nothing would make every assertion below pass in silence.
  assert.ok(stamped.size >= 8, `scraped only ${stamped.size} kinds out of ${servers.length} servers — the tctx() scrape is broken, which would make this guard pass vacuously`);

  const unknown = [...stamped.keys()].filter((k) => !KINDS.includes(k)).sort();
  assert.deepEqual(unknown, [],
    `these kinds are stamped by an MCP server but are NOT in provider-usage KINDS: ${unknown.map((k) => `${k} (${stamped.get(k).join(", ")})`).join("; ")} — every call under them would land in \`unclassified\`, i.e. counted but not attributed, which is the R2 search:0-against-total:286 shape. Add them to KINDS (emptyTally derives its counters from it).`);
});

// The coupling that had no test at all: the per-kind counters are derived from KINDS, so a kind can never
// be classifiable-but-uncounted. Before this, `out[row.tool]++` on such a kind was undefined++ → NaN →
// `null` in status.json, with unclassified stuck at 0 because KINDS.includes() had already passed.
test("#249: every KINDS entry is a live counter — a classifiable kind can never tally NaN", () => {
  const empty = tallyRegisterCalls("/no/such/ledger.jsonl", RUN);
  for (const k of KINDS) assert.equal(empty[k], 0, `KINDS entry "${k}" has no counter in emptyTally — it would tally NaN and stringify as null`);
  const t = tallyRows(KINDS.map((k) => row({ tool: k })));
  assert.equal(t.total, KINDS.length);
  assert.equal(t.unclassified, 0, "every KINDS entry classifies");
  for (const k of KINDS) assert.equal(t[k], 1, `KINDS entry "${k}" counted as ${t[k]}, not 1 — the counter is missing or NaN`);
});
