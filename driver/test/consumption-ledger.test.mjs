// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Unit tests for the cross-run consumption ledger (consumption-ledger.mjs) — the per-account "what did
// this actually consume" join that `.matter-ledger.jsonl` (which counts RUNS, not work) cannot answer.
// Pure offline: builds a synthetic workspace tree in a temp dir — no network, no pipeline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { recordConsumption, recordRunConsumption, accountConsumption, consumptionLedgerPath } from "../consumption-ledger.mjs";

const DAY = 86400000;

function mkWorkspace(agents = ["clawdi"]) {
  const root = mkdtempSync(join(tmpdir(), "prelim-consumption-"));
  const studios = {};
  for (const a of agents) {
    const studio = join(root, `workspace-${a}`, "studio", "prelim-search");
    mkdirSync(studio, { recursive: true });
    studios[a] = studio;
  }
  return { root, studios };
}

const tokens = (input, output, attempts = 1) => ({
  total: { input, output, cacheRead: 0, cacheWrite: 0, reasoning: 0, attempts },
  byModel: { "anthropic/claude-opus-5": { input, output, cacheRead: 0, cacheWrite: 0, reasoning: 0, attempts } },
});

test("accountConsumption: sums tokens per account across workspaces, day and month buckets", () => {
  const { root, studios } = mkWorkspace(["clawdi", "reviewer"]);
  const now = Date.parse("2026-07-28T12:00:00Z");
  try {
    recordConsumption({ studioRoot: studios.clawdi, runId: "r1", phase: "delivered", profileKey: "acme", tokens: tokens(100, 10), now });
    recordConsumption({ studioRoot: studios.reviewer, runId: "r2", phase: "delivered", profileKey: "acme", tokens: tokens(200, 20), now });
    // last month → month bucket excludes it
    recordConsumption({ studioRoot: studios.clawdi, runId: "r3", phase: "delivered", profileKey: "acme", tokens: tokens(999, 99), now: now - 40 * DAY });
    // a different account is never mixed in
    recordConsumption({ studioRoot: studios.clawdi, runId: "r4", phase: "delivered", profileKey: "other", tokens: tokens(500, 50), now });

    const c = accountConsumption({ workspaceRoot: root, account: "acme", now });
    assert.equal(c.today.runs, 2);
    assert.equal(c.today.tokens.input, 300);
    assert.equal(c.today.tokens.output, 30);
    assert.equal(c.thisMonth.runs, 2, "the 40-day-old run is outside the month");
    assert.equal(c.thisMonth.tokens.input, 300);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The load-bearing collapse rule: a run reaches a terminal more than once (postpone → resume → deliver)
// and each terminal RESTATES the whole-run figure, so counting every row would multiply a run's spend.
test("accountConsumption: a run that postponed then delivered counts ONCE, at its last figure", () => {
  const { root, studios } = mkWorkspace();
  const now = Date.parse("2026-07-28T12:00:00Z");
  try {
    recordConsumption({ studioRoot: studios.clawdi, runId: "r1", phase: "postponed", profileKey: "acme", tokens: tokens(100, 10), now: now - 3600_000 });
    recordConsumption({ studioRoot: studios.clawdi, runId: "r1", phase: "delivered", profileKey: "acme", tokens: tokens(450, 60), now });

    const c = accountConsumption({ workspaceRoot: root, account: "acme", now });
    assert.equal(c.today.runs, 1, "one run, not one per terminal");
    assert.equal(c.today.tokens.input, 450, "the restated final figure, never the sum of restatements");
    assert.equal(c.today.tokens.output, 60);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("recordConsumption: carries wall-clock beside the tokens, and no currency anywhere", () => {
  const { root, studios } = mkWorkspace();
  const now = Date.parse("2026-07-28T12:00:00Z");
  try {
    recordConsumption({
      studioRoot: studios.clawdi, runId: "r1", phase: "delivered", profileKey: "acme", level: "prelim",
      stageLabel: "Depth 4", clientPrincipal: true, markCount: 1, tokens: tokens(100, 10),
      providerUsage: { corsearch: { search: 12, record_fetch: 40, total: 52 } },
      startedAt: new Date(now - 5400_000).toISOString(), now,
    });
    const row = JSON.parse(readFileSync(consumptionLedgerPath(studios.clawdi), "utf8").trim());
    assert.equal(row.wallSec, 5400, "a speed pass reads the same row as a spend pass");
    assert.equal(row.level, "prelim");
    assert.equal(row.clientPrincipal, true);
    assert.equal(row.providerUsage.corsearch.total, 52, "register calls are the second cost axis");
    // owner directive 2026-07-11 — tokens only, no currency in the measurement plane
    assert.doesNotMatch(JSON.stringify(row), /usd|price|[$]/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("recordRunConsumption: maps a run ctx onto a row, taking startedAt from status.json", () => {
  const { root, studios } = mkWorkspace();
  const now = Date.parse("2026-07-28T12:00:00Z");
  const runDir = join(studios.clawdi, "run-1");
  mkdirSync(runDir, { recursive: true });
  try {
    writeFileSync(join(runDir, "status.json"), JSON.stringify({ startedAt: new Date(now - 1800_000).toISOString() }));
    const ctx = {
      run: { runDir, studioRoot: studios.clawdi, slug: "acme-corp", date: "2026-07-28", codename: "zesty-otter" },
      profile: { profileKey: "acme", projectKey: "eu-launch" },
      searchPolicy: { level: "prelim-jx", stageLabel: "Depth 5" },
      job: { clientPrincipal: true, marks: [{ name: "A" }, { name: "B" }] },
    };
    assert.equal(recordRunConsumption(ctx, { phase: "delivered", tokens: tokens(7, 3), now }), true);

    const row = JSON.parse(readFileSync(consumptionLedgerPath(studios.clawdi), "utf8").trim());
    assert.equal(row.runId, "acme-corp-2026-07-28-zesty-otter");
    assert.equal(row.projectKey, "eu-launch");
    assert.equal(row.level, "prelim-jx");
    assert.equal(row.markCount, 2);
    assert.ok(row.wallSec >= 1795 && row.wallSec <= 1805, `wall from status.json startedAt, got ${row.wallSec}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The pairing the whole row exists for: what we QUOTED beside what it CONSUMED. Either alone is useless
// — measured tokens cannot correct an estimate that was not recorded, and an estimate cannot be checked
// without the measurement.
test("recordRunConsumption: carries the frozen quote beside the measured tokens", () => {
  const { root, studios } = mkWorkspace();
  const now = Date.parse("2026-07-28T12:00:00Z");
  const runDir = join(studios.clawdi, "run-q");
  mkdirSync(runDir, { recursive: true });
  try {
    writeFileSync(join(runDir, "status.json"), JSON.stringify({ startedAt: new Date(now - 600_000).toISOString() }));
    const ctx = {
      run: { runDir, studioRoot: studios.clawdi, slug: "acme", date: "2026-07-28", codename: "plucky-vireo" },
      profile: { profileKey: "acme" },
      searchPolicy: { level: "prelim", stageLabel: "Depth 4" },
      job: { clientPrincipal: true, markName: "A" },
      quote: { unitsVersion: 1, units: 5, costBand: 3, raw: 23.2, searches: 1, turnaround: "~1.5 hours" },
    };
    recordRunConsumption(ctx, { phase: "delivered", tokens: tokens(120, 40), now });

    const row = JSON.parse(readFileSync(consumptionLedgerPath(studios.clawdi), "utf8").trim());
    assert.equal(row.quote.units, 5);
    assert.equal(row.quote.unitsVersion, 1, "a quote is only interpretable against its weight set");
    assert.equal(row.quote.raw, 23.2, "the absolute figure is what a price may later be fitted against");
    assert.equal(row.tokens.output, 40, "quote and measurement land on ONE line, joinable without a join");
    assert.doesNotMatch(JSON.stringify(row), /usd|price|[$]/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Measurement must never be load-bearing: it is written at a run's terminal, where throwing would turn a
// delivered report into a crash.
test("recordConsumption / recordRunConsumption: never throw on a bad target", () => {
  assert.equal(recordConsumption({ studioRoot: "/no/such/dir", runId: "r1", phase: "failed" }), false);
  assert.equal(recordConsumption({ studioRoot: null, runId: "r1", phase: "failed" }), false);
  assert.equal(recordRunConsumption(null, { phase: "failed" }), false);
  assert.equal(recordRunConsumption({ run: {} }, { phase: "failed" }), false);
  const c = accountConsumption({ workspaceRoot: "/no/such/root", account: "acme" });
  assert.equal(c.today.runs, 0);
  assert.equal(c.thisMonth.tokens.input, 0);
});
