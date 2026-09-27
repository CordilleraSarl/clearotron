// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// CHANGING THE DEMO'S AGENT ID LEAVES AN OPERATOR WITH TWO COPIES OF EVERY SAMPLE, AND THIS SAYS WHAT
// EACH LISTING DOES WITH THEM.
//
// Ruling 563 took the old default agent id out of the product, and the samples' id is a path segment:
// they are laid under `workspace-<agent>/…`. Seeding is idempotent per DIRECTORY, so an operator whose
// demo workspace was laid down by an earlier version keeps that copy and gains a second under the new id.
// The consequence was recorded as never measured. It is measured here, driven through both listings
// rather than reasoned about, and the answers differ:
//
//   the client portal      a DELIVERED run is skipped by the workspace walk — the pool row is its face —
//                          and all four shipped samples are delivered, so no duplicate reaches it.
//                          A live run does duplicate there, which is why both states are pinned below.
//   the dev cockpit        lists both copies, each carrying its own agent, BY DESIGN: it deliberately
//                          shows delivered runs, because a run vanishing at the moment it succeeds was
//                          the defect that put that branch there.
//
// AND THE TWO ROWS ARE LEFT AS TWO ROWS. Collapsing them would need a winner, `readdirSync` order is
// filesystem-dependent, and a page that silently drops one of two rows sharing an id would hide a real
// divergence as readily as a harmless copy. Two rows naming two agents is the honest shape, and the
// cockpit is loopback-only staff surface where that reads as what it is.
//
// SEEDS THE OLD PATH FIRST AND THEN THE NEW ONE. An arm that seeds once proves nothing about the case:
// the duplicate exists only for an operator who already had a workspace.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import { driverDir } from "../../shared/driver-dir.mjs";
import { seedDemoRuns } from "../demo-container.mjs";
import { scanAllRuns } from "../portal-service.mjs";

const RUN_ID = "tmp9100-sample-2026-08-07-fixture";
const OLD_ID = "legacy-agent";        // stands for whatever id an earlier workspace was laid under
const NEW_ID = "localagent";

const get = (port, path) => new Promise((resolve, reject) => {
  const r = httpRequest({ host: "127.0.0.1", port, path, method: "GET" }, (res) => {
    let d = ""; res.on("data", (c) => { d += c; }); res.on("end", () => resolve(JSON.parse(d)));
  });
  r.on("error", reject); r.end();
});

/** A frozen sample container holding one run under `agent`, laid twice: old id, then new. */
function seedTwice(state) {
  const root = mkdtempSync(join(tmpdir(), "two-agent-ids-"));
  const workspace = join(root, "ws"); mkdirSync(workspace, { recursive: true });
  const pool = join(root, "pool"); mkdirSync(pool, { recursive: true });
  const examples = join(root, "examples");
  const child = join(examples, "knockout-search"), run = join(child, "run");
  const write = (agent) => {
    mkdirSync(driverDir(run), { recursive: true });
    // FROZEN MEANS BOTH: a manifest and the lane's entry file. Without them `demoChildren` returns
    // nothing, every seed reports zero, and an arm reading that as "no duplicate" proves the opposite of
    // what it claims. The first drive of this had neither.
    writeFileSync(join(child, "meta.json"), JSON.stringify({ runId: "x", codename: "fixture", template: "knockout" }) + "\n");
    writeFileSync(join(run, "knockout-findings.json"), "{}\n");
    writeFileSync(driverDir(run, "profile.json"), JSON.stringify({ profileKey: "generic" }) + "\n");
    writeFileSync(join(run, "status.json"), JSON.stringify({
      runId: RUN_ID, slug: "tmp9100-sample", codename: "fixture", date: "2026-08-07",
      agent, state, markName: "SAMPLE",
    }) + "\n");
  };
  write(OLD_ID); const first = seedDemoRuns({ workspace, examplesDir: examples });
  write(NEW_ID); const second = seedDemoRuns({ workspace, examplesDir: examples });
  assert.deepEqual(first.seeded, [RUN_ID], "guard: the old-id seed laid nothing, so nothing here is evidence");
  assert.deepEqual(second.seeded, [RUN_ID], "guard: the new-id seed laid nothing — the second copy is the case under test");
  return { workspace, pool };
}

test("the client portal: a delivered sample seeded under two ids does not duplicate there", () => {
  const { workspace, pool } = seedTwice("delivered");
  const rows = scanAllRuns({ poolRoot: pool, workspaceRoot: workspace });
  assert.equal(rows.filter((r) => r.runId === RUN_ID).length, 0,
    "a delivered run is the pool's row, and the workspace walk must not add one per agent directory");
});

test("the client portal: a LIVE run DOES duplicate, which is why the state above is load-bearing", () => {
  const { workspace, pool } = seedTwice("running");
  assert.equal(scanAllRuns({ poolRoot: pool, workspaceRoot: workspace }).filter((r) => r.runId === RUN_ID).length, 2,
    "the walk takes every agent directory, so a live run in two of them is two rows — stated, not hidden");
});

test("the dev cockpit: both copies are listed, each naming its own agent", async () => {
  const { workspace, pool } = seedTwice("delivered");
  const { startPortal } = await import("../dev-portal.mjs");
  const portal = await startPortal({ poolRoot: pool, port: 0, workspaceRoot: workspace });
  try {
    const rows = await get(portal.address().port, "/dev/runs");
    const mine = rows.filter((r) => r.runId === RUN_ID);
    assert.equal(mine.length, 2, "the cockpit shows delivered runs on purpose, so both copies appear");
    assert.deepEqual(mine.map((r) => r.agent).sort(), [NEW_ID, OLD_ID].sort(),
      "each row must carry the agent whose directory it came from — that is what makes two rows readable "
      + "rather than a page repeating itself");
  } finally { portal.close(); }
});
