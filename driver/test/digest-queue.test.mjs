// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// digest-queue.mjs unit tests — (t1cd): the digest-trigger funnel's durable work queue.
// PURE module: no fs, no clock (timestamps injected), so everything here runs offline. The sidecar
// round-trip is exercised through real serialize→parse cycles (the exact bytes the pipeline writes).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyQueue, coerceQueue, hashSet, receiptKeyFor, mintItem, pendingItems, markFlushed,
} from "../digest-queue.mjs";

const FINDINGS = "/runs/acme/2026-07-22-teal-otter/register-findings.md";

test("mintItem: mints once, then no-ops on the same receiptKey while PENDING and after FLUSHED", () => {
  let q = emptyQueue();
  const key = receiptKeyFor("escalation", ["primary-sweep", "incumbent-class"]);
  const r1 = mintItem(q, { trigger: "escalation", receiptKey: key, mintedAt: "2026-07-22T10:00:00.000Z" });
  assert.equal(r1.minted, true);
  assert.deepEqual({ ...r1.item }, {
    id: "dq1", trigger: "escalation", receiptKey: key, mintedAt: "2026-07-22T10:00:00.000Z", flushedAt: null,
  });
  q = r1.queue;
  // re-mint while pending (a crash-resume re-entering the mechanism before settlement) → no-op
  const r2 = mintItem(q, { trigger: "escalation", receiptKey: key, mintedAt: "2026-07-22T10:05:00.000Z" });
  assert.equal(r2.minted, false);
  assert.equal(r2.queue.items.length, 1);
  assert.equal(r2.item.mintedAt, "2026-07-22T10:00:00.000Z", "the original item stands — a no-op never rewrites");
  // flush, then re-mint (the 13-pass resume-reset shape) → still a no-op, forever
  q = markFlushed(q, ["dq1"], "2026-07-22T10:30:00.000Z");
  const r3 = mintItem(q, { trigger: "escalation", receiptKey: key, mintedAt: "2026-07-22T11:00:00.000Z" });
  assert.equal(r3.minted, false, "a flushed receiptKey can never re-fire");
  assert.equal(pendingItems(r3.queue).length, 0, "zero pending ⇒ zero digest passes owed");
});

test("durable round-trip: serialize → parse → coerce preserves pending/flushed state exactly", () => {
  let q = emptyQueue();
  q = mintItem(q, { trigger: "escalation", receiptKey: receiptKeyFor("escalation", ["a1"]), mintedAt: "t1" }).queue;
  q = mintItem(q, { trigger: "envelope", receiptKey: receiptKeyFor("envelope", ["primary-sweep/NZ (material)"]), mintedAt: "t2" }).queue;
  q = markFlushed(q, ["dq1"], "t3");
  const reloaded = coerceQueue(JSON.parse(JSON.stringify(q, null, 2)));   // the sidecar's exact bytes
  assert.deepEqual(reloaded, q);
  assert.deepEqual(pendingItems(reloaded).map((i) => i.id), ["dq2"], "only the un-flushed item survives as pending");
  // torn / absent / legacy sidecar shapes degrade to empty — never a throw
  assert.deepEqual(coerceQueue(null), emptyQueue());
  assert.deepEqual(coerceQueue({ items: "garbage" }), emptyQueue());
  assert.deepEqual(coerceQueue({ items: [{ nope: 1 }] }), emptyQueue());
});

test("markFlushed: stamps only the named PENDING items; pendingItems selects the remainder", () => {
  let q = emptyQueue();
  q = mintItem(q, { trigger: "screen-gate", receiptKey: "screen-gate:aaa", mintedAt: "t1" }).queue;
  q = mintItem(q, { trigger: "lint", receiptKey: "lint:bbb", mintedAt: "t2" }).queue;
  q = markFlushed(q, ["dq1"], "t3");
  assert.equal(q.items.find((i) => i.id === "dq1").flushedAt, "t3");
  assert.equal(q.items.find((i) => i.id === "dq2").flushedAt, null);
  assert.deepEqual(pendingItems(q).map((i) => i.receiptKey), ["lint:bbb"]);
  // re-flushing an already-flushed id must not move its receipt timestamp
  const q2 = markFlushed(q, ["dq1"], "t9");
  assert.equal(q2.items.find((i) => i.id === "dq1").flushedAt, "t3", "a flush receipt is immutable");
});

test("receiptKeyFor: deterministic, order- and duplicate-insensitive over the firing set; distinct sets differ", () => {
  const a = receiptKeyFor("escalation", ["primary-sweep", "incumbent-class"]);
  const b = receiptKeyFor("escalation", ["incumbent-class", "primary-sweep", "primary-sweep"]);
  assert.equal(a, b, "the SAME firing set re-encountered on a resume must key identically");
  assert.match(a, /^escalation:[0-9a-f]{12}$/);
  assert.notEqual(a, receiptKeyFor("escalation", ["primary-sweep"]), "a different axis set is new work");
  assert.notEqual(a, receiptKeyFor("envelope", ["primary-sweep", "incumbent-class"]), "the trigger namespaces the hash");
  assert.equal(hashSet(["x", "y"]), hashSet(["y", "x"]));
});

// ── the 13-pass probe, module level: mint + flush + sidecar round-trip + mechanism re-entry ──────────
test("multi-resume re-entry (13-pass probe): after a flush survives the sidecar round-trip, re-entering the mechanism no-ops — zero new digest passes", () => {
  // pass 1: escalation + envelope mint; the settlement flush lands and receipts both.
  let q = emptyQueue();
  const escKey = receiptKeyFor("escalation", ["primary-sweep"]);
  const sgKey = receiptKeyFor("envelope", ["primary-sweep/NZ (material)"]);
  q = mintItem(q, { trigger: "escalation", receiptKey: escKey, mintedAt: "t0" }).queue;
  q = mintItem(q, { trigger: "envelope", receiptKey: sgKey, mintedAt: "t0" }).queue;
  let digestPasses = 1;   // the settlement flush
  q = markFlushed(q, pendingItems(q).map((i) => i.id), "t1");
  const sidecar = JSON.stringify(q, null, 2) + "\n";   // what atomicWrite persists
  // pass 2 (a fresh-session resume): reload the sidecar, re-enter BOTH mechanisms with the same firing sets.
  let q2 = coerceQueue(JSON.parse(sidecar));
  for (const [trigger, key] of [["escalation", escKey], ["envelope", sgKey]]) {
    const r = mintItem(q2, { trigger, receiptKey: key, mintedAt: "t2" });
    assert.equal(r.minted, false, `${trigger}: the resume re-mint is a no-op (digest-queue-noop)`);
    q2 = r.queue;
  }
  if (pendingItems(q2).length) digestPasses++;   // the settlement point: empty queue ⇒ no flush
  assert.equal(pendingItems(q2).length, 0, "nothing pending after the resume re-entries");
  assert.equal(digestPasses, 1, "the two mechanisms across two sessions cost ONE digest pass total");
});

// ── copper-vault SHAPE probe (synthetic — invented marks/axes; shapes mirror the live 2026-07-22 run) ─
test("copper-vault SHAPE probe: the legacy policy spends 6 digest passes; the funnel bounds the same triggers to ≤3 (fresh + settlement + ≤1 late)", () => {
  // The trigger sequence the live run actually fired (each individually legitimate):
  const PRE_SYNTHESIS = [
    ["escalation", ["primary-sweep"]],
    ["envelope", ["primary-sweep/NZ (material)"]],
    ["screen-gate", ["/mark/cn/88001-42"]],
  ];
  const POST_SYNTHESIS = [["lint", ["registry-record-match"]]];   // the pre-delivery correction class
  const runShape = (funnelOn) => {
    let q = emptyQueue();
    const passes = ["fresh"];
    for (const [trigger, parts] of PRE_SYNTHESIS) {
      if (!funnelOn) passes.push(trigger);   // legacy: each mechanism fires its own opus pass
      else q = mintItem(q, { trigger, receiptKey: receiptKeyFor(trigger, parts), mintedAt: "t0" }).queue;
    }
    // the frame-reopen seam: legacy fires ITS re-digest too; the funnel settles the whole queue here
    if (!funnelOn) passes.push("frame-reopen");
    else if (pendingItems(q).length || true /* reopen segment present */) {
      passes.push("settlement-flush");
      q = markFlushed(q, pendingItems(q).map((i) => i.id), "t1");
    }
    for (const [trigger, parts] of POST_SYNTHESIS) {
      if (!funnelOn) passes.push(trigger);
      else q = mintItem(q, { trigger, receiptKey: receiptKeyFor(trigger, parts), mintedAt: "t2" }).queue;
    }
    if (funnelOn && pendingItems(q).length) {   // AT MOST ONE bounded late flush
      passes.push("late-flush");
      q = markFlushed(q, pendingItems(q).map((i) => i.id), "t3");
    }
    return passes;
  };
  const legacy = runShape(false);
  assert.equal(legacy.length, 6, `legacy shape: ${legacy.join(", ")}`);
  const funnel = runShape(true);
  assert.ok(funnel.length <= 3, `funnel shape must be ≤3, got: ${funnel.join(", ")}`);
  assert.deepEqual(funnel, ["fresh", "settlement-flush", "late-flush"]);
});
