// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// EVERY QUESTION IS ASKED TO THE ORDER'S SCOPE, ON EVERY REGISTER.
//
// A question minted with no regions (a proposal, a cross-check, a recall probe) asks for the matter's
// territories. Only a register whose regions are mandatory used to fill them from the plan, so on the
// others such a question went to the wire with no office at all and searched the whole register, on an
// order that had named its countries. Driven through the shared executor with the default query builder,
// a register that needs no office, and what reaches the wire recorded.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeExecutePlan } from "../execute-plan.mjs";

const entry = (over = {}) => ({
  qid: "primary-sweep:exact:lanternwick", axis: "primary-sweep", predicate: "exact",
  term: "LANTERNWICK", nice_classes: [9], regions: [], expected_kind: "enumerate", ...over,
});

/** Run one axis of a plan through the shared executor and hand back every request that reached the wire. */
async function wireFor(plan) {
  const dir = mkdtempSync(join(tmpdir(), "order-scope-"));
  try {
    const planPath = join(dir, "register-plan.json");
    writeFileSync(planPath, JSON.stringify(plan));
    const wire = [];
    const executePlan = makeExecutePlan({
      search: async (_a, p) => { wire.push(p); return { type: "text", text: JSON.stringify({ total_hits: 0, results: [] }) }; },
      enumerate: async (_a, p) => { wire.push(p); return { type: "text", text: JSON.stringify({ state: "enumerated", total_hits: 0, count: 0, records: [] }) }; },
      capabilities: { id: "a-register-that-needs-no-office" },
    });
    const res = await executePlan("auth", { plan_path: planPath, axis: "primary-sweep", output_path: join(dir, "band.json") }, {});
    assert.ok(!String(res.text).startsWith("ERROR"), res.text);
    return wire;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("on an order that named its countries, a question minted with no regions is asked in those countries", async () => {
  const wire = await wireFor({ regions: ["JP", "KR"], entries: [entry()] });
  assert.equal(wire.length, 1);
  assert.deepEqual(wire[0].regions, ["JP", "KR"], "the question searched the whole register on a two-country order");
});

test("a question that names its own markets keeps them", async () => {
  const wire = await wireFor({ regions: ["JP", "KR"], entries: [entry({ qid: "sup:exact:lanternwick+jp", regions: ["JP"] })] });
  assert.deepEqual(wire[0].regions, ["JP"]);
});

test("on a worldwide order there is nothing to fill, and the question goes out with no office", async () => {
  const wire = await wireFor({ regions: [], entries: [entry()] });
  assert.equal(wire.length, 1);
  assert.equal(wire[0].regions, undefined);
});
