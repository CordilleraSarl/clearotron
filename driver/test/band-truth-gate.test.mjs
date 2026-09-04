// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// PR B (2026-07-14, teal-foundry): countLaneCalls — the ledger join under the fan-in band-truth gate.
// The provider call ledger is code-written at the plugin chokepoint, outside the model's reach; a unit
// lane with a qid-stamped band but zero ledger rows never called the provider (the band was authored,
// not executed — the fabrication that shipped ashen-causeway 07-06, teal-lattice 07-07, teal-foundry 07-13).
// SAFETY GUARD (2026-07-14, learned the hard way): driver.config freezes workspaceRoot at FIRST import
// with a PRODUCTION default. Pin it to a throwaway root BEFORE any driver module loads —
// a static driver import above this line would hoist past it, so driver modules are imported DYNAMICALLY.
import { mkdtempSync as __mkdtemp } from "node:fs";
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";   // — the default is taken only when NO spelling holds a value
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || __mkdtemp(__join(__tmpdir(), "prelim-testroot-")));
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countLaneCalls } from "../provider-usage.mjs";

const LANE = "prelim-noref123-test-mark-copper-keystone-register-unit-saturation-probe";

function mkLedger(lines) {
  const p = join(mkdtempSync(join(tmpdir(), "btg-")), "calls.jsonl");
  writeFileSync(p, lines.join("\n") + "\n");
  return p;
}

test("countLaneCalls: counts gateway-namespaced rows, -fbN / -taint-rerun variants, sessionId fallback; ignores other lanes and torn lines", () => {
  const p = mkLedger([
    JSON.stringify({ ts: "t", agentId: "clawdi", sessionKey: `agent:clawdi:${LANE}`, tool: "search" }),
    JSON.stringify({ ts: "t", agentId: "clawdi", sessionKey: `agent:clawdi:${LANE}-fb1`, tool: "search" }),
    JSON.stringify({ ts: "t", agentId: "clawdi", sessionKey: `agent:clawdi:${LANE}-taint-rerun-1`, tool: "search" }),
    JSON.stringify({ ts: "t", agentId: "clawdi", sessionKey: "", sessionId: LANE, tool: "search" }),
    JSON.stringify({ ts: "t", agentId: "clawdi", sessionKey: "agent:clawdi:prelim-noref123-test-mark-copper-keystone-register-unit-primary-sweep", tool: "search" }),
    `{"ts":"t","sessionKey":"agent:clawdi:${LANE}","tool":`,   // torn concurrent append
  ]);
  assert.equal(countLaneCalls(LANE, p), 4, "base + fb + taint-rerun + sessionId fallback; other lane and torn line ignored");
  assert.equal(countLaneCalls("prelim-noref123-test-mark-copper-keystone-register-unit-primary-sweep", p), 1);
  assert.equal(countLaneCalls("prelim-noref999-other-run-register-unit-saturation-probe", p), 0, "unknown lane counts zero");
});

test("countLaneCalls: absent/unreadable ledger returns null (the gate cannot judge and must skip)", () => {
  assert.equal(countLaneCalls(LANE, "/nonexistent/telemetry/calls.jsonl"), null);
  assert.equal(countLaneCalls("", mkLedger([]).replace("calls.jsonl", "calls.jsonl")), null, "empty lane key never judges");
});

test("countLaneCalls: empty ledger file (exists, zero rows) returns 0 — a judgeable zero, not a skip", () => {
  const p = mkLedger([]);
  assert.equal(countLaneCalls(LANE, p), 0);
});
