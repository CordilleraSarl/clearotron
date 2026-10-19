// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A REPAIR IN THE DELIVERY CHECK QUEUES WHAT IT LEFT STALE, AND ONLY THAT.
//
// When the delivery check's repeat of placement changes a decision, the stages that read it are re-run in the same pass,
// and each of those re-runs is followed in turn. Which stages a repair left stale is read from the staleness before and
// after it. A stage stale before for the same reasons is not the repair's, and stays the guard's. A stage already queued
// ahead joins the chain, so its own re-run is followed, and runs where it stands. One this pass already re-did is re-done
// once more at most. Own file, so the call ledger is pinned before the driver loads.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { envFrom, pinEnv } from "../../shared/env-aliases.mjs";
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || mkdtempSync(join(tmpdir(), "clearotron-testroot-")));
process.env.CLEAROTRON_REGISTER_CALL_LOG = join(mkdtempSync(join(tmpdir(), "repair-left-stale-calls-")), "register-calls.jsonl");
writeFileSync(process.env.CLEAROTRON_REGISTER_CALL_LOG, "");

import { test } from "node:test";
import assert from "node:assert/strict";
const { whatTheRepairLeftStale } = await import("../pipeline.mjs");

const stale = (label, ...changed) => ({ label, changed: changed.map(([name, now]) => ({ name, was: "old", now })) });

test("the stages a repeated placement pass left stale are queued, and the repair itself is not", () => {
  const after = [stale("register-digest", ["placement-decisions.json", "d2"]), stale("synthesis", ["placement-decisions.json", "d2"]),
    stale("narrative-refutation", ["placement-decisions.json", "d2"]), stale("placement-inquiry", ["register-named-band.json", "b2"])];
  const r = whatTheRepairLeftStale({ before: [stale("placement-inquiry", ["register-named-band.json", "b2"])], after, repaired: "placement-inquiry" });
  assert.deepEqual(r.queue.map((x) => x.label), ["register-digest", "synthesis", "narrative-refutation"]);
  assert.deepEqual(r.chain, ["register-digest", "synthesis", "narrative-refutation"]);
  assert.deepEqual(r.requeue, []);
});

test("a stage already queued ahead joins the chain and is not queued twice", () => {
  // The writer was stale on entry, on the reading step's record. The repeat moves the decision it also reads.
  const before = [stale("synthesis", ["register-findings.md", "f2"])];
  const after = [stale("synthesis", ["register-findings.md", "f2"], ["placement-decisions.json", "d2"])];
  const r = whatTheRepairLeftStale({ before, after, repaired: "placement-inquiry", ahead: new Set(["synthesis"]) });
  assert.deepEqual(r.chain, ["synthesis"], "the writer the repeat left stale is not followed: its re-run would leave the overview and the cards to the guard");
  assert.deepEqual(r.queue, [], "a stage already queued ahead was queued again");
});

test("a stage stale before the repair for the same reasons is not the repair's, and stays the guard's", () => {
  // A card whose re-render failed earlier in the pass: the repeat of placement changed nothing it reads.
  const card = stale("report-card:3", ["findings.json", "x1"]);
  const r = whatTheRepairLeftStale({ before: [card], after: [card], repaired: "placement-inquiry", processed: new Set(["report-card:3"]) });
  assert.deepEqual([r.chain, r.queue, r.requeue], [[], [], []], "a stage stale for another reason was taken as the repair's");
  // the same card, once the writer's re-run moves what it reads, is the writer's: re-done once more
  const moved = stale("report-card:3", ["findings.json", "x2"]);
  const w = whatTheRepairLeftStale({ before: [card], after: [moved], repaired: "synthesis", processed: new Set(["report-card:3"]) });
  assert.deepEqual([w.chain, w.queue.map((x) => x.label), w.requeue], [["report-card:3"], ["report-card:3"], ["report-card:3"]]);
});

test("a stage this pass already re-did is re-done once more at most", () => {
  const after = [stale("report-overview", ["findings.json", "x3"])];
  const r = whatTheRepairLeftStale({ before: [], after, repaired: "synthesis", processed: new Set(["report-overview"]), requeued: new Set(["report-overview"]) });
  assert.deepEqual(r.queue, [], "a stage re-done twice was queued a third time");
  assert.deepEqual(r.chain, ["report-overview"]);
});
