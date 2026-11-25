// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A courier whose token is scoped to named companies dropped every notice filed before a run existed:
// list_outbox_events kept only events whose run resolved to one of its companies, and these have no run.
// So a failure before start reached no one. Such a notice now carries the account its order named, and
// both the listing and ack_event judge it on that. A foreign company's notice stays invisible and
// survives an ack, and one that names no account stays full-grant only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinEnv } from "../../shared/env-aliases.mjs";

const ROOT = mkdtempSync(join(tmpdir(), "runless-courier-"));
const OUTBOX = join(ROOT, "clearance-outbox");
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
pinEnv(process.env, "CLEAROTRON_OUTBOX_DIR", OUTBOX);
mkdirSync(OUTBOX, { recursive: true });

const { ackEvent, listOutboxEvents } = await import("../lib/ops.mjs");
const { filterByAccounts } = await import("../server.mjs");

const SCOPED = { kind: "ops", sub: "courier", accounts: ["demo-brand-owner"] };
const notice = (base, fields) => {
  const file = `intake-${base}.prerun-failed.pending`;
  writeFileSync(join(OUTBOX, file), JSON.stringify({ kind: "pre-run-failed", base, agent: "intake-agent", text: "…", ...fields }));
  return file;
};
const listed = (scope) => filterByAccounts(scope, "list_outbox_events", listOutboxEvents()).events.map((e) => e.file);

test("the scoped courier lists its company's notice, and not another company's or an unnamed one", () => {
  const mine = notice("job-mine", { account: "demo-brand-owner", organisation: null });
  const theirs = notice("job-theirs", { account: "celta", organisation: null });
  const unnamed = notice("job-unnamed", { account: null, organisation: null });
  const old = notice("job-old", {});   // written before notices carried an account
  const seen = listed(SCOPED);
  assert.ok(seen.includes(mine), "its own company's failure before start is visible");
  for (const f of [theirs, unnamed, old]) assert.ok(!seen.includes(f), `${f} stays out of a scoped listing`);
  const all = listed({ kind: "ops", accounts: "*" });
  for (const f of [mine, theirs, unnamed, old]) assert.ok(all.includes(f), `a full grant still lists ${f}`);
});

test("a Generic notice is visible to a session that holds Generic", () => {
  const g = notice("job-generic", { account: "generic", organisation: null });
  assert.ok(listed({ kind: "ops", accounts: ["generic"] }).includes(g));
  assert.ok(!listed(SCOPED).includes(g));
});

test("ack_event consumes the scoped courier's own notice, and leaves a foreign or unnamed one in place", () => {
  const mine = notice("ack-mine", { account: "demo-brand-owner" });
  assert.deepEqual(ackEvent({ file: mine }, { scope: SCOPED }), { ok: true, file: mine, alreadyGone: false });
  assert.equal(existsSync(join(OUTBOX, mine)), false);
  for (const f of [notice("ack-theirs", { account: "celta" }), notice("ack-unnamed", { account: null })]) {
    assert.deepEqual(ackEvent({ file: f }, { scope: SCOPED }), { ok: true, file: f, alreadyGone: true },
      "answers exactly as for a file that is not there");
    assert.equal(existsSync(join(OUTBOX, f)), true, "and the full-grant courier can still route it");
  }
});
