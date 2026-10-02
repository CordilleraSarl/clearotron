// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// read-before-rate.mjs — whether a finding stamped "verified from the record" rests on a record the run
// holds AND read. What is left of the recall spine's module once step 3 judged by owner: the
// reconciliation join over the register digest's endings left with the digest.
//
// PURE (no node imports) — the pipeline owns all IO, events and enforcement.

import { normalizeRecordUri } from "./registry-fidelity.mjs";

const lc = (u) => String(u ?? "").toLowerCase();

// ── read-before-rate (charter P2c) — the deciding-document join ─────────────────────────────────────
//
// A disposition that turns on goods wording / status / examination history must rest on the on-disk
// record, READ — not on the band row. The findings contract already stamps the claim
// (meters[].basis === "verified-from-record" + a /mark source); the reading layer already logs every
// band_record call. This join makes the stamp checkable: stamped-from-record × record-on-disk ×
// reading-log ok:true. The evidence run stamped 19/19 findings "verified-from-record" while reading
// 9 documents — the honor-system gap this closes.

/**
 * @param findings   parsed findings[] (lenient parse output)
 * @param hasRecord  (lowercased canonical uri) => boolean — is the official record on disk?
 * @param wasRead    (lowercased canonical uri) => boolean — reading-log ok:true band_record row?
 * @returns rows [{ordinal, mark, meter, uri, onDisk, read}] for every verified-from-record register
 *          source; `violations` = onDisk && !read (a stamp the reading log cannot back). PURE.
 */
export function findUnreadRatedSources({ findings = [], hasRecord = () => false, wasRead = () => false } = {}) {
  const rows = [];
  for (const f of findings) {
    if (String(f?.disposition ?? "") === "withdrawn") continue;
    for (const [meter, m] of Object.entries(f?.meters ?? {})) {
      if (!m || m.basis !== "verified-from-record") continue;
      const canon = normalizeRecordUri(m.source);
      if (!canon) continue;                       // a URL / non-register source — not this join's subject
      const uri = lc(canon);
      const onDisk = hasRecord(uri);
      rows.push({ ordinal: f.ordinal ?? null, mark: f.mark ?? null, meter, uri, onDisk, read: onDisk ? wasRead(uri) : null });
    }
  }
  return { rows, violations: rows.filter((r) => r.onDisk && r.read === false) };
}

// ──: the basis a run can PROVE ─────────────────────────────────────────────────────────────────
//
// RULING (2026-08-10): `basis: "verified-from-record"` means THE RUN CAN PROVE IT. The model never
// self-attests a read. That is the rule every form in this program was built on — the machine writes
// what must be exact, the model supplies judgment — and a basis claim is exact data, not judgment.
//
// So the stamp stops being a claim that gets AUDITED and becomes a field that gets DERIVED. The
// difference is not stylistic. The audit was a second full synthesis pass costing ~10 serial minutes on
// 3 of 4 runs to have a model re-assert what the log already knew, and it had two structural holes that
// no amount of re-asserting could close:
//
//   1. IT RAN ONCE, BEFORE REFUTATION. Re-derived on the delivered findings.json of the four runs it
//      measured, the counts do not match what it recorded: 35→37, 28→31, 37→38, 41→40. Stamps entered
//      and left the deliverable AFTER the only check that polices them. A derivation runs at every
//      write, so there is no "after".
//   2. `off_disk` WAS NEVER A VIOLATION. The join only fired on onDisk && !read, so a stamp citing a
//      record the run never fetched at all fell through untouched. the 2026-08-10 R6
//      delivered with its own artifact reading {"stamped":19,"read":0,"off_disk":19,"violations":0}:
//      nineteen meters claiming the disposition rests on the official record, zero of those records on
//      disk, and the gate reported no violation. Under "the run can prove it" there is nothing to
//      argue about — nineteen unprovable claims are nineteen demotions.
//
// A demotion is not a flag and not a caveat: the meter becomes `inferred-from-signal`, which is what the
// evidence supports, and every downstream surface already knows how to present an inference AS one
// (stages.mjs card contract, joinEvidenceStatus's `_status`). The source is KEPT — it is still the lead
// the claim points at, and dropping it would destroy the only thing that says which record to go read.

/**
 * Every meter whose `verified-from-record` stamp the machine evidence cannot support.
 *
 * Scope is exactly `findUnreadRatedSources`': meters citing a REGISTER RECORD uri. A meter citing a
 * website is not this join's subject — the reading log does not cover the open web, and demoting on
 * evidence nothing collects would be a guess wearing a machine's authority.
 *
 * @returns [{ordinal, mark, meter, uri, from, to, why}] — `why` is `record-never-fetched` (no record on
 *          disk to have read) or `record-on-disk-never-read` (the old violation). PURE.
 */
export function unprovableRecordBases({ findings = [], hasRecord = () => false, wasRead = () => false } = {}) {
  const { rows } = findUnreadRatedSources({ findings, hasRecord, wasRead });
  return rows.filter((r) => r.read !== true).map((r) => ({
    ordinal: r.ordinal, mark: r.mark, meter: r.meter, uri: r.uri,
    from: "verified-from-record", to: "inferred-from-signal",
    why: r.onDisk ? "record-on-disk-never-read" : "record-never-fetched",
  }));
}

/**
 * Apply the demotions to a parsed findings doc. Returns a NEW doc (the input is not mutated) and the
 * count actually applied — which can be lower than the demotion list only if the doc moved underneath,
 * so the caller records both and a divergence is visible rather than assumed.
 *
 * Matched on (ordinal, meter) — the ordinal is the findings contract's own join key, used by the card
 * render and the plan audit. Matching on the uri instead would demote every meter that happens to cite
 * the same record, including ones whose read IS logged.
 *
 * A meter that is ALREADY `inferred-from-signal` is not counted as applied, even if a caller names it.
 * `applied` is what the caller compares against its demotion list to decide whether an unprovable claim
 * is still standing, so a no-op that inflated it would hide exactly the shortfall that check exists to
 * catch. PURE.
 */
export function applyDerivedBases(doc, demotions = []) {
  const byOrdinal = new Map();
  for (const d of demotions) {
    if (d?.ordinal == null) continue;
    if (!byOrdinal.has(d.ordinal)) byOrdinal.set(d.ordinal, new Set());
    byOrdinal.get(d.ordinal).add(d.meter);
  }
  let applied = 0;
  const findings = (doc?.findings ?? []).map((f) => {
    const meters = byOrdinal.get(f?.ordinal);
    if (!meters || !f?.meters) return f;
    const next = { ...f, meters: { ...f.meters } };
    for (const name of meters) {
      const m = next.meters[name];
      if (!m || typeof m !== "object" || m.basis !== "verified-from-record") continue;
      next.meters[name] = { ...m, basis: "inferred-from-signal" };
      applied += 1;
    }
    return next;
  });
  return { doc: { ...doc, findings }, applied };
}

/** Parse _driver/reading-log.jsonl content into the set of lowercased canonical uris with an
 *  ok:true band_record row. Tolerant of torn lines (best-effort append log). PURE. */
export function readOkRecordUris(readingLogContent) {
  const out = new Set();
  for (const ln of String(readingLogContent ?? "").split("\n")) {
    if (!ln.trim()) continue;
    let row;
    try { row = JSON.parse(ln); } catch { continue; }
    if (row?.ok !== true) continue;
    // A record is read when a band_record call returned it, or when one of step 3's judges opened it
    // (register_open, which fetches the full record on open and logs it as shown).
    const id = row?.tool === "band_record" ? row?.args?.record_id
      : row?.tool === "register_open" ? (row?.shown?.[0] ?? row?.args?.record) : null;
    const canon = normalizeRecordUri(id);
    if (canon) out.add(lc(canon));
  }
  return out;
}
