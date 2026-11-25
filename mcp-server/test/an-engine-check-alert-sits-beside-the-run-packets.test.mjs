// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The engine check's alert (driver/engine/health.mjs) is the first outbox packet with no run behind it and no
// requester. Every reader of the outbox meets it beside a run's packets: the MCP event list, its account filter,
// the e2e harness's packet matcher and the deploy check's backlog count. None of them may stop on it, and the run
// packets beside it must come through as before. A courier holding an account-scoped key does not see it: the
// filter keeps only events whose run is in the grant, and this event has none.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinEnv } from "../../shared/env-aliases.mjs";

const work = mkdtempSync(join(tmpdir(), "engine-check-outbox-"));
const outbox = join(work, "outbox");
const saved = { work: process.env.CLEAROTRON_WORK_DIR, outbox: process.env.CLEAROTRON_OUTBOX_DIR };
pinEnv(process.env, "CLEAROTRON_WORK_DIR", work);
pinEnv(process.env, "CLEAROTRON_OUTBOX_DIR", outbox);

const { listOutboxEvents } = await import("../lib/ops.mjs");
const { filterByAccounts } = await import("../server.mjs");
const { outboxPackets } = await import("../../scripts/e2e.mjs");
const { outboxBacklog } = await import("../../scripts/drain-preflight.mjs");
const { runEngineCheck, engineCheckPacketName } = await import("../../driver/engine/health.mjs");

const RUN = "tmpx-veltrane-2026-11-25-jade-q";
const signedOut = async () => ({ ok: false, engine: "anthropic-agent", mode: "signed-out", basis: "text-match",
  headline: "anthropic-agent is not signed in", fix: "Sign in: run `claude` once in a terminal and complete the sign-in." });

test("every outbox reader takes the engine check's alert beside a run's packets", async () => {
  try {
    mkdirSync(outbox, { recursive: true });
    writeFileSync(join(outbox, `${RUN}.pending`), "intake-agent\n");   // the delivered marker's legacy plain-text body
    writeFileSync(join(outbox, `${RUN}.failed.pending`), JSON.stringify({ kind: "run-failed", runId: RUN, text: "failed" }));
    await runEngineCheck({ env: { CLEAROTRON_AI: "anthropic-agent" }, judge: signedOut, dir: join(work, "engine-check"), log: () => {} });
    const alert = `${engineCheckPacketName("anthropic-agent")}.pending`;

    const all = listOutboxEvents();
    assert.equal(all.count, 3, JSON.stringify(all));
    const kinds = Object.fromEntries(all.events.map((e) => [e.file, e.kind]));
    assert.deepEqual(kinds, { [`${RUN}.failed.pending`]: "run-failed", [`${RUN}.pending`]: "delivered", [alert]: "engine-check-failed" });
    const event = all.events.find((e) => e.file === alert);
    assert.equal(event.audience, "operator");
    assert.equal(event.runId, undefined, "no run is behind it");

    assert.deepEqual(filterByAccounts({ kind: "ops", accounts: "*" }, "list_outbox_events", all), all, "a full grant sees it");
    const scoped = filterByAccounts({ kind: "ops", accounts: ["demo-brand-owner"] }, "list_outbox_events", all);
    assert.ok(!scoped.events.some((e) => e.file === alert), "an account-scoped courier does not see an event with no run");

    assert.deepEqual(outboxPackets({ runId: RUN }, outbox).packets, [`${RUN}.failed.pending`, `${RUN}.pending`], "a run's packets are its own");
    assert.equal(outboxBacklog(outbox).pending, 3, "the deploy check counts it as waiting, as it is");
  } finally {
    pinEnv(process.env, "CLEAROTRON_WORK_DIR", saved.work);
    pinEnv(process.env, "CLEAROTRON_OUTBOX_DIR", saved.outbox);
    rmSync(work, { recursive: true, force: true });
  }
});
