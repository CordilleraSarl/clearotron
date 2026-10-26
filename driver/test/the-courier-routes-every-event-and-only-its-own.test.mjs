// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE COURIER ROUTES EVERY EVENT THE OUTBOX CARRIES, TAKES ONLY ITS OWN, AND SETTLES A FAILURE NOTICE.
//
// The courier contract an assistant reads had no route for a request that failed before its run could start. It told
// the courier to acknowledge a failed run's notice, which leaves the notice owed, so the backstop sweep sends it again;
// only mark_sent settles one. And it did not scope a courier to its own agent's events, so two assistants that see one
// outbox could each send the same packet. This holds a route for every kind the delivery catalog lists, the failure
// notice settled with mark_sent, the scope to the courier's own agent, and the same in the delivery document's loop and
// in the reference wake's message.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const flat = (rel) => read(rel).replace(/\s+/g, " ");
const COURIER = flat("skills/clearotron-ops/COURIER.md");
const CATALOG = [...read("docs/DELIVERY.md").matchAll(/^\| \*\*([a-z-]+)\*\* \|/gm)].map((m) => m[1]);
/** One numbered step of the loop, from its kind to the next kind's step. */
const step = (kind) => {
  const i = COURIER.indexOf(`**\`kind: "${kind}"\`**`);
  if (i < 0) return "";
  const j = COURIER.slice(i + 1).search(/ \d\. \*\*`kind: /);
  return COURIER.slice(i, j < 0 ? undefined : i + 1 + j);
};

test("the courier contract routes every event the delivery catalog lists, and a packet writer names each", () => {
  assert.ok(CATALOG.length >= 6, `guard: the delivery catalog was read (${CATALOG.join(", ")})`);
  const writers = ["driver/pipeline.mjs", "driver/pipeline-knockout.mjs", "driver/runner.mjs", "mcp-server/lib/ops.mjs"].map(read).join("\n");
  for (const kind of CATALOG) {
    assert.ok(writers.includes(`kind: "${kind}"`), `the catalog lists ${kind}, which no packet writer names`);
    assert.ok(step(kind), `the courier contract has no route for ${kind}`);
  }
});

test("a failed run's notice settles with mark_sent, and a request that became no run with ack_event", () => {
  const failed = step("run-failed");
  assert.match(failed, /mark_sent \{ runId, messageId \}/);
  assert.ok(!/Then \*\*`ack_event/.test(failed), "the courier is still told to acknowledge a failed run's notice, which leaves it owed");
  assert.match(step("pre-run-failed"), /Then \*\*`ack_event \{ file \}`\*\*/);
});

test("the courier takes only its own agent's events, and an only assistant takes them all", () => {
  // Its own agent is the one start_run's reply names (ops start_run returns `agent`, the default when none is
  // passed), so an assistant that passes none still knows it; one that is alone never leaves an event uncouriered.
  assert.ok(COURIER.includes("Courier only the events whose `agent` is yours: the `agent` that `start_run`'s reply names."));
  assert.ok(COURIER.includes("leave another agent's event pending, with no mark and no ack"));
  assert.ok(COURIER.includes("Where you are the only assistant, every event is yours."), "an assistant alone on its deployment may courier nothing");
  assert.ok(!COURIER.includes("the one you pass to `start_run`"), "the courier still ties its own events to an agent it may never pass");
});

test("the delivery loop and the reference wake say the same", () => {
  assert.ok(flat("docs/DELIVERY.md").includes("4. For the remaining kinds — `intake-rejected`, `duplicate-skipped`, `pre-run-failed`, "
    + "`late-bind-ack` — route the"));
  const wake = read("driver/deliver-trigger.sh");
  assert.ok(wake.includes("run-failed → relay its text + mark_sent"), "the reference wake still has a failed run's notice acknowledged");
  assert.ok(wake.includes("only the events whose agent is you"), "the reference wake does not keep the courier to its own events");
});
