// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// digest-queue.mjs unit tests — (t1cd): the digest-trigger funnel's durable work queue.
// PURE module: no fs, no clock (timestamps injected), so everything here runs offline. The sidecar
// round-trip is exercised through real serialize→parse cycles (the exact bytes the pipeline writes).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyQueue, coerceQueue, hashSet, receiptKeyFor, mintItem, pendingItems, markFlushed,
  buildFlushFollowup, digestReemitContract, DIGEST_RESUME_PREAMBLE, runPostFlushGateRepair,
} from "../digest-queue.mjs";

const FINDINGS = "/runs/acme/2026-07-22-teal-otter/register-findings.md";

test("mintItem: mints once, then no-ops on the same receiptKey while PENDING and after FLUSHED", () => {
  let q = emptyQueue();
  const key = receiptKeyFor("escalation", ["primary-sweep", "incumbent-class"]);
  const r1 = mintItem(q, { trigger: "escalation", receiptKey: key, followupSegment: "reconcile the escalated axes", mintedAt: "2026-07-22T10:00:00.000Z" });
  assert.equal(r1.minted, true);
  assert.deepEqual({ ...r1.item }, {
    id: "dq1", trigger: "escalation", receiptKey: key,
    followupSegment: "reconcile the escalated axes", mintedAt: "2026-07-22T10:00:00.000Z", flushedAt: null,
  });
  q = r1.queue;
  // re-mint while pending (a crash-resume re-entering the mechanism before settlement) → no-op
  const r2 = mintItem(q, { trigger: "escalation", receiptKey: key, followupSegment: "reconcile again", mintedAt: "2026-07-22T10:05:00.000Z" });
  assert.equal(r2.minted, false);
  assert.equal(r2.queue.items.length, 1);
  assert.equal(r2.item.followupSegment, "reconcile the escalated axes", "the original segment stands — a no-op never rewrites");
  // flush, then re-mint (the 13-pass resume-reset shape) → still a no-op, forever
  q = markFlushed(q, ["dq1"], "2026-07-22T10:30:00.000Z");
  const r3 = mintItem(q, { trigger: "escalation", receiptKey: key, followupSegment: "reconcile yet again", mintedAt: "2026-07-22T11:00:00.000Z" });
  assert.equal(r3.minted, false, "a flushed receiptKey can never re-fire");
  assert.equal(pendingItems(r3.queue).length, 0, "zero pending ⇒ zero digest passes owed");
});

test("durable round-trip: serialize → parse → coerce preserves pending/flushed state exactly", () => {
  let q = emptyQueue();
  q = mintItem(q, { trigger: "escalation", receiptKey: receiptKeyFor("escalation", ["a1"]), followupSegment: "s1", mintedAt: "t1" }).queue;
  q = mintItem(q, { trigger: "envelope", receiptKey: receiptKeyFor("envelope", ["primary-sweep/NZ (material)"]), followupSegment: "s2", mintedAt: "t2" }).queue;
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
  q = mintItem(q, { trigger: "screen-gate", receiptKey: "screen-gate:aaa", followupSegment: "s", mintedAt: "t1" }).queue;
  q = mintItem(q, { trigger: "lint", receiptKey: "lint:bbb", followupSegment: "s", mintedAt: "t2" }).queue;
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

test("buildFlushFollowup: ONE consolidated followup — preamble, every section clearly delimited, ending with the FULL re-emission contract (falcon tripwire)", () => {
  const followup = buildFlushFollowup({
    registerFindingsPath: FINDINGS,
    sections: [
      { trigger: "frame-reopen", text: "These register units just folded in supplemental sweeps from a blind frame re-derivation: primary-sweep." },
      { trigger: "escalation", text: "The Step-2.6 skeptic flagged the issues below, and these register units have just defended/revised in place: incumbent-class." },
      { trigger: "envelope", text: "These register units just CLOSED their deferred Coverage-ledger work (deadline-envelope rule): primary-sweep." },
      { trigger: "screen-gate", text: "RE-DECIDE EACH on its fetched goods: keep it as a conflict/finding if in-field." },
    ],
  });
  assert.ok(followup.startsWith(DIGEST_RESUME_PREAMBLE), "opens with the standard digest-resume preamble");
  for (const t of ["frame-reopen", "escalation", "envelope", "screen-gate"])
    assert.ok(followup.includes(`=== section: ${t} ===`), `section ${t} clearly delimited`);
  // frame-reopen segment leads; the queued segments follow in queue order
  assert.ok(followup.indexOf("=== section: frame-reopen ===") < followup.indexOf("=== section: escalation ==="));
  // ── CONVERSION 11: THE CONTRACT IS A PATCH CALL, AND THE PROPERTY IT CARRIES IS THE SAME ONE ────
  //
  // The settlement flush is the measured worst case of whole-file re-emission (repair-contract.mjs), and
  // it is the one prompt where "patch it" and "never truncate it" have to be the same instruction. That
  // was solved by TARGETED EDITS — an Edit cannot truncate the remainder it never addressed. A patch call
  // has the property more strongly: the driver re-renders from the STORED model with the named rows
  // merged in, so what the seat does not name is byte-identical BY CONSTRUCTION, and unlike an Edit there
  // is no anchor to miss. The assertion moved to the new mechanism; the guarantee it asserts did not.
  const contract = digestReemitContract(FINDINGS);
  // The mandate is unchanged and the WORDING had to move with the mechanism: the old line read "Coverage
  // ledger included — the driver re-derives its JSON mirror from your prose", which had been stale since
  // took the prose ledger out of the loop. What is asserted is the operational fact that survived —
  // the ledger is reconciled in this same pass, on its own transport.
  assert.match(contract, /Coverage ledger is separate and rides `record_coverage`/,
    "the reconciliation mandate is unchanged: the ledger rides the same pass, on its own transport");
  assert.match(contract, /record_register_digest/, "the repair is aimed at the transport that now writes the document");
  assert.match(contract, /patch: true/, "a flush corrects named rows — a whole re-send is the shape this contract exists to avoid");
  assert.match(contract, /what you do not\s+name comes back byte-identical/,
    "the anti-truncation guarantee must survive the change of mechanism — it is the whole reason this contract is not a full re-emission");
  assert.doesNotMatch(contract, /full file, not a diff/);
  assert.doesNotMatch(contract, /using the Edit tool/,
    "the document's only writer is the driver — an Edit order here is the superseded path the golden rule bans");
  assert.ok(followup.trimEnd().endsWith(contract), "the consolidated followup ENDS with the repair contract");
  // …and never a partial-emission instruction (the legacy screen-gate tail must not survive into a flush).
  // This is the half of the tripwire that did NOT move: a WRITE carrying only the changed sections still
  // destroys everything it omits, and no flush may ever ask for one.
  assert.ok(!followup.includes("ONLY those rows corrected"), "never 'emit only the changed sections'");
});

test("runPostFlushGateRepair: a new drop row without a fetch receipt gets ONE code-fetch repair round, then clears", async () => {
  const fetched = [];
  let checks = 0;
  const check = () => { checks++; return fetched.includes("/mark/cn/88001-42") ? [] : [{ uri: "/mark/cn/88001-42", mark: "KINETIC" }]; };
  const rows = [];
  const r = await runPostFlushGateRepair({ check, fetcher: async (uri) => { fetched.push(uri); }, log: (row) => rows.push(row) });
  assert.equal(r.repairAttempted, true);
  assert.deepEqual(r.violations, [], "the repaired row clears on the re-check");
  assert.deepEqual(fetched, ["/mark/cn/88001-42"], "exactly one targeted fetch");
  assert.equal(checks, 2, "check → one repair round → re-check; nothing more");
  assert.deepEqual(rows.map((x) => x.action), ["code-fetch-repair", "clean"]);
});

test("runPostFlushGateRepair: a survivor is FLAGGED after the single round — never looped on; unnamed rows are never fetched", async () => {
  let checks = 0, fetches = 0;
  const violations = [{ uri: "/mark/us/404404", mark: "GHOST" }, { uri: null, mark: "UNNAMED SLICE" }];
  const rows = [];
  const r = await runPostFlushGateRepair({
    check: () => { checks++; return violations; },                       // nothing ever clears
    fetcher: async () => { fetches++; throw new Error("record 404"); },  // and the fetch throws — must be swallowed
    log: (row) => rows.push(row),
  });
  assert.equal(r.violations.length, 2, "survivors are returned for the flag");
  assert.equal(checks, 2, "exactly two checks — ONE bounded round, never a loop");
  assert.equal(fetches, 1, "the unnamed row (uri null) is never fetched — nothing to fetch");
  assert.deepEqual(rows.map((x) => x.action), ["code-fetch-repair", "flagged"]);
  // — the thrown error is SWALLOWED for control flow and KEPT as the cause. This loop used to be
  // `try { await fetcher(v.uri); } catch {}`, which discarded the only thing that could distinguish a
  // provider limit from a stale index from a transient error — 62 rows on R1 carried one generic string.
  assert.equal(r.failures.get("/mark/us/404404"), "fetch threw: record 404");
  assert.equal(r.failures.has(null), false, "an unnamed row is never fetched, so it records no failure");
  assert.equal(rows[1].failures[0].cause, "fetch threw: record 404", "and it reaches run.jsonl");
  // clean findings short-circuit: no repair, no log rows
  const r2 = await runPostFlushGateRepair({ check: () => [], fetcher: async () => { throw new Error("never"); }, log: () => { throw new Error("never"); } });
  assert.deepEqual(r2, { violations: [], repairAttempted: false, failures: new Map() });
});

test("runPostFlushGateRepair: a not-ok fetch carries the PROVIDER's own words, not the driver's summary", async () => {
  // The adapter already clips the register's error to 140 chars and returns it as `{ok:false, cause}`.
  // Everything needed to tell a provider limit from an entitlement boundary was one return value away.
  const violations = [{ uri: "/mark/cn/CHINI216", mark: "CHRON" }];
  const r = await runPostFlushGateRepair({
    check: () => violations,
    fetcher: async () => ({ ok: false, cause: "ERROR: 403 record outside subscription scope" }),
    log: () => {},
  });
  assert.equal(r.failures.get("/mark/cn/CHINI216"), "ERROR: 403 record outside subscription scope");
});

test("runPostFlushGateRepair: a not-ok with NO cause still records something rather than nothing", async () => {
  const r = await runPostFlushGateRepair({
    check: () => [{ uri: "/mark/us/1", mark: "X" }],
    fetcher: async () => ({ ok: false }),
    log: () => {},
  });
  assert.match(r.failures.get("/mark/us/1"), /not-ok with no cause/, "an absence is recorded, never silent");
});

test("runPostFlushGateRepair: a SUCCESSFUL fetch records no failure — that row is a different defect", async () => {
  // The 641-mark class: the fetch reports ok and the gate still cannot see the record (a case-fold, a
  // granularity, a record-log write loss). Recording a provider cause here would send a run chasing the
  // vendor while the records sit in _records/ the whole time.
  const r = await runPostFlushGateRepair({
    check: () => [{ uri: "/mark/us/1", mark: "X" }],
    fetcher: async () => ({ ok: true }),
    log: () => {},
  });
  assert.equal(r.failures.size, 0);
});

// ── the 13-pass probe, module level: mint + flush + sidecar round-trip + mechanism re-entry ──────────
test("multi-resume re-entry (13-pass probe): after a flush survives the sidecar round-trip, re-entering the mechanism no-ops — zero new digest passes", () => {
  // pass 1: escalation + screen-gate mint; the settlement flush lands and receipts both.
  let q = emptyQueue();
  const escKey = receiptKeyFor("escalation", ["primary-sweep"]);
  const sgKey = receiptKeyFor("screen-gate", ["/mark/cn/88001-42"]);
  q = mintItem(q, { trigger: "escalation", receiptKey: escKey, followupSegment: "esc", mintedAt: "t0" }).queue;
  q = mintItem(q, { trigger: "screen-gate", receiptKey: sgKey, followupSegment: "sg", mintedAt: "t0" }).queue;
  let digestPasses = 1;   // the settlement flush
  q = markFlushed(q, pendingItems(q).map((i) => i.id), "t1");
  const sidecar = JSON.stringify(q, null, 2) + "\n";   // what atomicWrite persists
  // pass 2 (a fresh-session resume): reload the sidecar, re-enter BOTH mechanisms with the same firing sets.
  let q2 = coerceQueue(JSON.parse(sidecar));
  for (const [trigger, key] of [["escalation", escKey], ["screen-gate", sgKey]]) {
    const r = mintItem(q2, { trigger, receiptKey: key, followupSegment: "again", mintedAt: "t2" });
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
      else q = mintItem(q, { trigger, receiptKey: receiptKeyFor(trigger, parts), followupSegment: trigger, mintedAt: "t0" }).queue;
    }
    // the frame-reopen seam: legacy fires ITS re-digest too; the funnel settles the whole queue here
    if (!funnelOn) passes.push("frame-reopen");
    else if (pendingItems(q).length || true /* reopen segment present */) {
      passes.push("settlement-flush");
      q = markFlushed(q, pendingItems(q).map((i) => i.id), "t1");
    }
    for (const [trigger, parts] of POST_SYNTHESIS) {
      if (!funnelOn) passes.push(trigger);
      else q = mintItem(q, { trigger, receiptKey: receiptKeyFor(trigger, parts), followupSegment: trigger, mintedAt: "t2" }).queue;
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
