// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// delivery-state.test.mjs — runSummary()/list_runs()/get_run() surfacing sendPending + .sent (2026-07-10 fix).
// Root cause of the VIBRANTE FROSTPLUM / VENZY late-duplicate incident: nothing exposed a run's delivery
// state deterministically, so the instant-wake path and the HEARTBEAT completion-watch each independently
// guessed a run-dir path and could (and did) disagree. Isolated temp workspace, built by hand like
// ops.test.mjs — deliberately NOT touching the shared _fixture.mjs runs other tests depend on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const ROOT = mkdtempSync(join(tmpdir(), "delivery-state-ws-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);

const { tools } = await import("../server.mjs");

function makeRun({ slug, codename, sendPending, withSentFile = false, receipts = null }) {
  const runDir = join(ROOT, "workspace-clawdi", "studio", "prelim-search", "archive", "2026-07", slug, codename);
  mkdirSync(runDir, { recursive: true });
  const runId = `${slug}-${codename}`;
  writeFileSync(join(runDir, "status.json"), JSON.stringify({
    runId, slug, codename, date: "2026-07-08", agent: "clawdi", state: "delivered",
    verdict: "CONDITIONAL", markName: "TESTMARK", sendPending,
    startedAt: "2026-07-08T05:00:00Z", updatedAt: "2026-07-08T06:00:00Z", deliveredAt: "2026-07-08T06:00:00Z",
  }));
  if (withSentFile) writeFileSync(join(runDir, ".sent"), JSON.stringify({ sentAt: "2026-07-08T06:05:00Z" }));
  if (receipts != null) {
    mkdirSync(driverDir(runDir), { recursive: true });
    writeFileSync(driverDir(runDir, "send-receipts.json"),
      typeof receipts === "string" ? receipts : JSON.stringify(receipts));
  }
  return { runDir, runId };
}

test("get_run: a fully-delivered run reports sendPending false", () => {
  const { runId } = makeRun({ slug: "tmpa-settled", codename: "2026-07-08-alpha-x", sendPending: false, withSentFile: true });
  const r = tools.get_run({ runId });
  assert.equal(r.run.sendPending, false);
  assert.equal(r.run.sent, true);
});

test("get_run: a handoff-mode run still owed a notification reports sendPending true, sent false", () => {
  const { runId } = makeRun({ slug: "tmpb-owed", codename: "2026-07-08-bravo-x", sendPending: true, withSentFile: false });
  const r = tools.get_run({ runId });
  assert.equal(r.run.sendPending, true);
  assert.equal(r.run.sent, false);
});

test("get_run: a status.json with no sendPending field at all (legacy stage-mode run) reports false, not undefined/null", () => {
  const runDir = join(ROOT, "workspace-clawdi", "studio", "prelim-search", "archive", "2026-07", "tmpc-legacy", "2026-07-08-charlie-x");
  mkdirSync(runDir, { recursive: true });
  const runId = "tmpc-legacy-2026-07-08-charlie-x";
  writeFileSync(join(runDir, "status.json"), JSON.stringify({
    runId, slug: "tmpc-legacy", codename: "2026-07-08-charlie-x", date: "2026-07-08", agent: "clawdi",
    state: "delivered", verdict: "CLEAR", markName: "LEGACY",
  }));
  const r = tools.get_run({ runId });
  assert.equal(r.run.sendPending, false);
  assert.equal(r.run.sent, false);
});

test("list_runs: sendPending:true filter returns only owed runs, false returns only settled ones", () => {
  makeRun({ slug: "tmpd-owed2", codename: "2026-07-08-delta-x", sendPending: true, withSentFile: false });
  makeRun({ slug: "tmpe-settled2", codename: "2026-07-08-echo-x", sendPending: false, withSentFile: true });

  const owed = tools.list_runs({ sendPending: true });
  assert.ok(owed.every((r) => r.sendPending === true), "every result actually owed");
  assert.ok(owed.some((r) => r.runId === "tmpd-owed2-2026-07-08-delta-x"));
  assert.ok(!owed.some((r) => r.runId === "tmpe-settled2-2026-07-08-echo-x"));

  const settled = tools.list_runs({ sendPending: false });
  assert.ok(settled.every((r) => r.sendPending === false), "every result actually settled");
  assert.ok(settled.some((r) => r.runId === "tmpe-settled2-2026-07-08-echo-x"));
  assert.ok(!settled.some((r) => r.runId === "tmpd-owed2-2026-07-08-delta-x"));
});

// ── B4: per-channel dual-read (channels.email / channels.whatsapp) ────────────────────────────────
// A channel counts as sent when the run has that channel's receipt in _driver/send-receipts.json
// (written by prelim-deliver right after EACH send lands) OR the legacy all-channels .sent marker.
// This is what SKILL.md step 2b consults on a retry to skip already-receipted channels.

test("channels: legacy .sent only (pre-receipts run) → both channels read as sent, ids null", () => {
  const { runId } = makeRun({ slug: "tmpf-legacy-sent", codename: "2026-07-08-golf-x", sendPending: false, withSentFile: true });
  const c = tools.get_run({ runId }).run.channels;
  assert.deepEqual(c.email, { sent: true, messageId: null, sentAt: null });
  assert.deepEqual(c.whatsapp, { sent: true, messageId: null, sentAt: null });
});

test("channels: partial receipts, no .sent (the crash-between-channels retry case) → only the receipted channel sent", () => {
  const { runId } = makeRun({
    slug: "tmpg-partial", codename: "2026-07-08-hotel-x", sendPending: true,
    receipts: { email: { emailMessageId: "AAMk-123", sentAt: "2026-07-08T06:01:00Z" } },
  });
  const r = tools.get_run({ runId }).run;
  assert.equal(r.sent, false, ".sent stays the final all-channels marker");
  assert.deepEqual(r.channels.email, { sent: true, messageId: "AAMk-123", sentAt: "2026-07-08T06:01:00Z" });
  assert.equal(r.channels.whatsapp.sent, false, "the un-receipted channel is the ONLY one a retry sends");
});

test("channels: full receipts (email + whatsapp), no .sent yet → both sent with their ids", () => {
  const { runId } = makeRun({
    slug: "tmph-receipts", codename: "2026-07-08-india-x", sendPending: true,
    receipts: {
      email: { emailMessageId: "AAMk-456", sentAt: "2026-07-08T06:01:00Z" },
      whatsapp: { whatsappMessageId: "wamid.789", sentAt: "2026-07-08T06:02:00Z" },
    },
  });
  const c = tools.get_run({ runId }).run.channels;
  assert.deepEqual(c.email, { sent: true, messageId: "AAMk-456", sentAt: "2026-07-08T06:01:00Z" });
  assert.deepEqual(c.whatsapp, { sent: true, messageId: "wamid.789", sentAt: "2026-07-08T06:02:00Z" });
});

test("channels: receipts AND .sent (settled run) → sent everywhere, ids from the receipts", () => {
  const { runId } = makeRun({
    slug: "tmpi-both", codename: "2026-07-08-juliet-x", sendPending: false, withSentFile: true,
    receipts: {
      email: { emailMessageId: "AAMk-999", sentAt: "2026-07-08T06:01:00Z" },
      whatsapp: { whatsappMessageId: "wamid.000", sentAt: "2026-07-08T06:02:00Z" },
    },
  });
  const r = tools.get_run({ runId }).run;
  assert.equal(r.sent, true);
  assert.equal(r.channels.email.messageId, "AAMk-999");
  assert.equal(r.channels.whatsapp.messageId, "wamid.000");
});

test("channels: torn/unreadable receipts fall back to the .sent marker alone (never a crash)", () => {
  const { runId } = makeRun({
    slug: "tmpj-torn", codename: "2026-07-08-kilo-x", sendPending: true, receipts: "{ not json",
  });
  const c = tools.get_run({ runId }).run.channels;
  assert.deepEqual(c.email, { sent: false, messageId: null, sentAt: null });
  assert.deepEqual(c.whatsapp, { sent: false, messageId: null, sentAt: null });
});

test("channels: a run with neither receipts nor .sent reads unsent on both channels", () => {
  const { runId } = makeRun({ slug: "tmpk-fresh", codename: "2026-07-08-lima-x", sendPending: true });
  const c = tools.get_run({ runId }).run.channels;
  assert.equal(c.email.sent, false);
  assert.equal(c.whatsapp.sent, false);
});

test("list_runs: omitting sendPending returns both owed and settled runs (no behavior change for existing callers)", () => {
  const all = tools.list_runs({});
  const ids = all.map((r) => r.runId);
  assert.ok(ids.includes("tmpa-settled-2026-07-08-alpha-x"));
  assert.ok(ids.includes("tmpb-owed-2026-07-08-bravo-x"));
});

test.after(() => { try { rmSync(ROOT, { recursive: true, force: true }); } catch { /* best-effort */ } });
