// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// digest-queue.mjs — (t1cd): the digest-trigger FUNNEL's durable work queue.
//
// THE DEFECT CLASS (live run, 2026-07-22). One run's register-digest stage ran 13 times across 3
// sessions (~2h, ~33M tokens in that stage alone). Beyond the gate-side waste (fixed separately),
// seven passes were each INDIVIDUALLY legitimate: escalation, envelope, screen-gate re-decide,
// frame-reopen, pre-delivery corrections — half a dozen mechanisms each independently allowed to
// trigger a 5-18-minute opus pass, with per-mechanism "max one" bounds that RESET on every resume.
// And every digest pass invalidates the whole back half (skeptic/synthesis/cards/summaries) under
// the stage-freshness staleness contract, so the cascade multiplies.
//
// THE DESIGN (owner-approved): the queue is the ONLY path to a non-fresh re-digest. Mechanisms keep
// their own cheap unit-level work (warm unit followups, driver code-fetches) but stop calling the
// digest themselves — they MINT durable queue items instead, and the digest reconciles queued items
// at defined settlement points: ONCE before synthesis, plus at most one bounded late flush for
// post-synthesis triggers. Receipts survive resume: an item's receiptKey is minted at most once for
// the life of the run (a re-mint of a flushed OR pending key is a no-op), which is the 13-pass fix —
// per-mechanism bounds no longer reset on resume.
//
// PURE (repo doctrine: decision logic tests offline). No fs, no clock — timestamps are injected by
// the caller (the pipeline stamps `new Date().toISOString()`, the receipt idiom everywhere else);
// the pipeline owns the `_driver/digest-queue.json` sidecar via atomicWrite on every mint/flush.
//
// Item shape: { id, trigger, receiptKey, followupSegment, mintedAt, flushedAt|null }.
// Receipt keys are `<trigger>:<hash of the firing set>` — escalation:<axis-set-hash>,
// envelope:<deferred-row-set-hash>, screen-gate:<uri-set-hash>, lint:<flag-hash> — so the SAME
// firing set re-encountered on a resume no-ops, while a genuinely NEW set (a different axis, a new
// violating URI) mints a fresh item and rides the next settlement flush.

import { createHash } from "node:crypto";
import { editRepairTail } from "./repair-contract.mjs";

/** A fresh, empty queue document (the sidecar's on-disk shape). PURE. */
export function emptyQueue() {
  return { schema_version: 1, items: [] };
}

/**
 * Coerce a loaded sidecar document into a valid queue — a missing/torn/legacy document degrades to
 * an empty queue (never a throw: the funnel must never be worse than the legacy path it replaces).
 * PURE.
 */
export function coerceQueue(doc) {
  const items = Array.isArray(doc?.items)
    ? doc.items.filter((i) => i && typeof i.receiptKey === "string" && i.receiptKey)
    : [];
  return { schema_version: 1, items };
}

/**
 * Deterministic hash of a SET of strings — order-insensitive, duplicate-insensitive, stable across
 * processes (sha256 of the sorted unique members, 12 hex chars — the sha12 receipt idiom). PURE.
 */
export function hashSet(parts) {
  const canon = [...new Set((parts ?? []).map((p) => String(p)))].sort().join("\n");
  return createHash("sha256").update(canon).digest("hex").slice(0, 12);
}

/** `<trigger>:<set-hash>` — the durable idempotency key a mechanism mints under. PURE. */
export function receiptKeyFor(trigger, parts) {
  return `${trigger}:${hashSet(parts)}`;
}

/**
 * Mint a queue item. IDEMPOTENT by receiptKey: a re-mint of a PENDING key (same firing set, digest
 * not yet flushed — e.g. a crash-resume re-entering the mechanism before the settlement point) or a
 * FLUSHED key (the work already landed in a digest pass — the resume-reset defect) is a no-op.
 * Returns { queue, minted, item } without mutating the input. PURE.
 */
export function mintItem(queue, { trigger, receiptKey, followupSegment, mintedAt }) {
  const q = coerceQueue(queue);
  const existing = q.items.find((i) => i.receiptKey === receiptKey);
  if (existing) return { queue: q, minted: false, item: existing };
  const item = {
    id: `dq${q.items.length + 1}`,   // items are append-only (flushed items are kept as receipts), so this is unique
    trigger: String(trigger),
    receiptKey,
    followupSegment: String(followupSegment ?? ""),
    mintedAt: mintedAt ?? null,
    flushedAt: null,
  };
  return { queue: { ...q, items: [...q.items, item] }, minted: true, item };
}

/** The items awaiting a settlement flush (minted, not yet landed in a digest pass). PURE. */
export function pendingItems(queue) {
  return coerceQueue(queue).items.filter((i) => i.flushedAt == null);
}

/**
 * Mark items flushed (their consolidated followup landed in a successful digest pass). A flushed
 * item is a permanent receipt: it can never re-fire, on this pass or any resume. PURE.
 */
export function markFlushed(queue, ids, flushedAt) {
  const q = coerceQueue(queue);
  const idSet = new Set(ids ?? []);
  return {
    ...q,
    items: q.items.map((i) => (idSet.has(i.id) && i.flushedAt == null ? { ...i, flushedAt: flushedAt ?? null } : i)),
  };
}

// ── THE FUNNEL'S DECLARED EXEMPTIONS ───────────────────────────────────────────────────────────────
//
// The header above says the queue is the ONLY path to a non-fresh re-digest. That was written as an
// unqualified invariant and it is not one: `enforceRecallReconciliation` (pipeline.mjs) has always
// fired its own pass. An invariant with an undeclared violation is worse than a narrower invariant
// stated honestly, because the next reader trusts the wrong one — so the exemption is DECLARED here,
// with the reason, and an arm censuses every dispatch site against this list. Silence between an
// invariant and a violation is the defect (tracker issue 116).
//
// WHY RECALL-RECONCILE CANNOT MINT — measured on the tree, not reasoned from the design:
//
//  1. ORDERING MAKES QUEUEING STRICTLY WORSE. Reconcile runs from inside `runDigest`, after EVERY
//     pass. `flushDigestQueue` calls `runDigest`, so the LAST flush's own pass re-enters reconcile —
//     and that flush is guarded by `ctx.digestSettled`, which is set true immediately after it, with
//     no `flushDigestQueue` call anywhere below it. An item minted there has no flush left to carry
//     it. Today the correction fires late; queued, it would never fire at all. `markFlushed` receipts
//     only the items captured BEFORE the pass, so the orphan would sit pending and silent.
//  2. IT IS NOT THE COST THE FUNNEL BOUNDS. The funnel exists to stop N cold opus passes each
//     invalidating the back half. Reconcile sends a WARM followup on the digest's own live session
//     (`sessionKey: r.sessionKey`) — the same class of cheap unit-level work the header already
//     exempts for escalation/envelope/screen-gate, not the cold pass it forbids.
//  3. ITS DURABILITY IS SOLVED ELSEWHERE, NOT MISSING. A queued item survives a crash; so does this,
//     by a different mechanism — the followup receipt rides the recall-reconciliation artifact
//     (`carryRecallFollowup`), bounded per unended-set signature by RECALL_FOLLOWUP_MAX, and the
//     re-derive runs after every pass RAN OR SKIPPED, so a resume re-arms it.
//
// Each entry names the enclosing function that dispatches, and the reason it is not funnel work.
// Adding a site without adding an entry fails the census arm; adding an entry without a site fails it
// too — a stale exemption is the same silence in the other direction.
export const DIGEST_OWN_PASS_EXEMPTIONS = Object.freeze([
  Object.freeze({
    fn: "enforceRecallReconciliation",
    reason: "warm followup on the digest's own live session, re-derived after every pass; queueing it "
      + "would orphan the mint the last flush's own pass makes, because digestSettled closes the queue "
      + "immediately after that flush",
  }),
  Object.freeze({
    fn: "checkLateBind",
    reason: "customer late-bind re-classification — a warm followup on the digest session driven by an "
      + "external answer arriving mid-run, not by a findings-level trigger; the requester has already "
      + "been acked that the bind landed, so it cannot wait for a settlement flush",
  }),
  Object.freeze({
    fn: "UPSTREAM_STALE_REPAIR",
    reason: "the generic stage-freshness repair, one entry in a map that refreshes any upstream-stale "
      + "stage in place; it re-runs a stage whose declared inputs moved rather than correcting findings, "
      + "so it is not the cost the funnel bounds and has no trigger to mint",
  }),
]);

// ── the consolidated settlement followup ───────────────────────────────────────────────────────────

// The standard digest-resume preamble every warm re-digest opens with (verbatim from the legacy
// escalation/envelope/frame-reopen followups — shared so the OFF path stays byte-identical).
export const DIGEST_RESUME_PREAMBLE =
  "You are RESUMING your earlier register-digest session — your prior digest and all unit files are already in your context. Do NOT redo it from scratch.";

/**
 * The standard settlement repair contract: every consolidated flush ends with THIS.
 *
 * It used to demand a full re-emission, and the reason given was that a PARTIAL emission would
 * truncate the findings file the whole back half is built from. That reason is true of a Write and
 * false of an Edit, and the distinction is the whole change. A Write REPLACES the file, so a Write
 * carrying only the changed sections destroys every section it omits — which is why "emit only the
 * changed sections" was, and remains, forbidden. An Edit PATCHES the bytes it names in place; the
 * untouched remainder is not rewritten, so it structurally cannot be truncated by an edit that never
 * addressed it. Targeted edits therefore give the truncation guarantee the full re-emission was only
 * ever a proxy for — and this is the file where the proxy cost the most (repair-contract.mjs carries
 * the settlement-flush measurements: the flush attempt that PASSED is the one that patched).
 */
// ── CONVERTED (conversion 11) ───────────────────────────────────────────────────────────────────
//
// This returned `editRepairTail(registerFindingsPath)` — a targeted-Edit order for a document whose
// only writer is now the driver, which recording-agreement direction (a) refuses by name.
//
// THE REASONING ABOVE SURVIVES INTACT, and the patch call is what now carries it. The argument for the
// targeted edit was that an Edit cannot truncate the remainder it never addressed, which is the
// guarantee full re-emission was only ever a proxy for. A patch call has that property more strongly:
// the driver re-renders from the STORED model with the named rows merged in, so the sections the seat
// does not name are byte-identical by construction rather than by its care — and unlike an Edit there
// is no anchor to miss, so it cannot half-apply.
//
// The `registerFindingsPath` parameter is KEPT rather than dropped: callers pass it and the flush's own
// section text still refers to the document a reader opens. It just no longer names a file to write.
export function digestReemitContract(registerFindingsPath) {
  return `Then reconcile ${registerFindingsPath} with every section above by sending a PATCH call to ` +
    `\`record_register_digest\` (patch: true) carrying ONLY the rows and sections you are changing — ` +
    `the driver holds everything else you sent and re-renders the document from it, so what you do not ` +
    `name comes back byte-identical. Your Coverage ledger is separate and rides \`record_coverage\` as ` +
    `before. There is no file for you to write or edit and nothing you write by hand is read.`;
}

/**
 * Build the ONE consolidated settlement followup: the standard resume preamble, every section
 * clearly delimited (`sections` = [{trigger, text}] — the frame-reopen segment first when present,
 * then every queued segment), ending with the standard full re-emission contract. PURE.
 */
export function buildFlushFollowup({ registerFindingsPath, sections }) {
  const parts = [
    DIGEST_RESUME_PREAMBLE,
    `Several bounded refinement channels have queued reconciliation work since your findings were written. Work through EVERY section below in this ONE pass — each section's unit-level work is already done; your job is to reconcile the findings and the Coverage ledger against it.`,
  ];
  for (const s of sections ?? []) {
    parts.push("", `=== section: ${s.trigger} ===`, s.text);
  }
  parts.push("", digestReemitContract(registerFindingsPath));
  return parts.join("\n");
}

// ── the post-flush screen-gate re-check (code-only, bounded) ───────────────────────────────────────

/**
 * After a flush lands a digest, the re-emitted findings may carry a NEW goods/field drop row without
 * a fetch receipt. Re-run the gate check in code (cheap), and repair with at most ONE bounded
 * code-fetch round — then FLAG the survivors, never loop and never withhold the report (the main
 * gate's disclose-clamp arm already ran, immediately, at the mechanism; this is the flush's cheap net).
 *
 * Injectable (`check` returns the current violation list; `fetcher(uri)` is the driver code-fetch;
 * `log` receives run.jsonl rows) so it tests offline against synthetic flushed-findings fixtures.
 */
export async function runPostFlushGateRepair({ check, fetcher, log = () => {} }) {
  let violations = check();
  if (!violations.length) return { violations: [], repairAttempted: false, failures: new Map() };
  log({ event: "screen-gate-postflush", count: violations.length, uris: violations.map((v) => v.uri), action: "code-fetch-repair" });
  // — KEEP WHAT THE FETCH SAID. This loop used to be `try { await fetcher(v.uri); } catch {}`,
  // discarding the adapter's `{ok:false, cause}` — and the adapter has already carried the provider's
  // own error string this far (`driver.config.mjs` clips it to 140 chars). So the post-flush path had no
  // fetch-outcome map at all and could only ever write the driver's generic "record not retrievable".
  //
  // That string was 62 identical rows on R1, spanning six jurisdictions, with nothing distinguishing a
  // provider limit from a stale index, an entitlement boundary, a transient error or a withdrawn record
  // — and it reached the coverage note repeatedly. A repair that always returns the same
  // count against an opaque cause is a repair that cannot succeed, and it runs on every affected run.
  const failures = new Map();
  for (const v of violations) {
    if (!v.uri) continue;   // the driver cannot fetch what nobody named — such a row goes straight to the flag
    try {
      const r = await fetcher(v.uri);
      if (!r?.ok) failures.set(v.uri, String(r?.cause ?? "record_fetch returned not-ok with no cause").slice(0, 200));
    } catch (e) { failures.set(v.uri, `fetch threw: ${String(e?.message ?? e)}`.slice(0, 200)); }
  }
  violations = check();   // ONE bounded repair round — never a loop
  log(violations.length
    ? { event: "screen-gate-postflush", count: violations.length, uris: violations.map((v) => v.uri), action: "flagged",
      failures: [...failures.entries()].map(([uri, cause]) => ({ uri, cause })) }
    : { event: "screen-gate-postflush", count: 0, action: "clean", recovered: true });
  return { violations, repairAttempted: true, failures };
}
