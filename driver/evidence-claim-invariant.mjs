// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── A CLAIM MAY NOT OUTLIVE ITS EVIDENCE, AND IT MAY NOT OUTRANK IT EITHER ───────────────────
//
// A scored run was refused at the re-check because the corrective pass deleted the evidence for a claim
// about a named third party's regulatory status, kept the claim, and hardened it — on the opening page.
// Thirteen of fourteen corrections landed cleanly; the pass created this one while resolving the others.
//
// TWO DIRECTIONS, AND THE SECOND WAS NOT IN THE REPORT. Measuring that run's own pre/post pair turned up
// the reported shape and a second one nobody had counted, moving the other way:
//
//   A. EVIDENCE FELL, CLAIM HELD. Four `use` meters went `verified-from-record` → `inferred-from-signal`
//      with their `source` deleted. The BAND held on all four. One kept a byte-identical
//      `legal_position`, so a text diff of the claim finds nothing at all; another GREW by 243
//      characters as its citation was removed, which is the strengthening the issue was opened for.
//
//   B. THE EVIDENCE STAMP ROSE WITH NO NEW EVIDENCE. Six meters went the other way, back to
//      `verified-from-record` — and all six were on the driver's own demotion list from twelve minutes
//      earlier, every one of them `why: record-on-disk-never-read`. No register call was made between
//      the two snapshots. Nothing was re-verified; a machine-checked "the reading log cannot back this"
//      was simply overruled.
//
// B IS INVISIBLE TO EVERY CHECK THE ISSUE PROPOSED, which is why it is here. A rule about deletion sees
// nothing — nothing was deleted. A rule comparing claim text sees nothing — the prose is free to be
// identical. And `verified-from-record` is the STRONGEST basis, so a "certainty must not increase" rule
// reading only the claim misses it: the increase is in the evidence stamp.
//
// THE LADDER ALREADY EXISTS, so this introduces no vocabulary. `basis` is the run's own certainty
// ordering and 's demotion is its enforcement; `basis-derivation.json` records every demotion with
// its reason and its uri. Arm B is a comparison against an artifact the driver already writes, which is
// why it needs no fetch ledger and no new plumbing.
//
// REPORTS, NEVER THROWS. The caller decides what a violation costs — 's lesson is that a guard
// which can kill a run is a guard that eventually kills a run over its own false positive.

/** The run's own certainty ordering for a meter's basis. Higher is more certain. */
export const BASIS_RANK = Object.freeze({
  "verified-from-record": 3,
  assumed: 2,
  "inferred-from-signal": 1,
  "not-checked": 0,
});

// A non-array where an array is expected must report nothing, not throw. These functions read run
// artifacts, and an artifact that arrives as a string or an object is a case that WILL happen — a
// half-written file, a legacy shape, a wrapper someone forgot to unwrap. Throwing here would turn a
// diagnostic into a run-killer, which is the failure spent a production run learning about.
const rows = (v) => (Array.isArray(v) ? v : []);
const rank = (b) => BASIS_RANK[String(b ?? "").trim()] ?? null;
const txt = (v) => String(v ?? "").trim();
const findingKey = (f) => `${txt(f?.mark)}|${txt(f?.owner?.name ?? f?.owner)}`;
const hasSource = (m) => Boolean(txt(m?.source));

/**
 * ARM A — evidence fell while the claim it supported did not.
 *
 * A claim "held" when its BAND is unchanged. The band is the certainty a reader acts on, and holding it
 * while the support beneath it drops is the ratio this invariant bounds — stated as data rather than as
 * a judgement about prose. `claimIdentical` rides along because it separates the two sub-shapes: an
 * unchanged claim is the one no text diff can see, and a changed-but-still-banded claim is the one that
 * was rewritten without being weakened.
 *
 * PURE. `before`/`after` are findings arrays.
 */
export function evidenceFellClaimHeld(before, after) {
  const B = new Map(rows(before).map((f) => [findingKey(f), f]));
  const out = [];
  for (const a of rows(after)) {
    const b = B.get(findingKey(a));
    if (!b) continue;
    for (const [meter, ma] of Object.entries(a?.meters ?? {})) {
      const mb = b?.meters?.[meter];
      if (!mb) continue;
      const rb = rank(mb.basis), ra = rank(ma.basis);
      const basisFell = rb != null && ra != null && ra < rb;
      const sourceDeleted = hasSource(mb) && !hasSource(ma);
      if (!basisFell && !sourceDeleted) continue;
      if (txt(b.band) !== txt(a.band)) continue;          // the claim WAS weakened — the invariant holds
      out.push({
        arm: "evidence-fell-claim-held",
        finding: findingKey(a), meter,
        basis: { before: txt(mb.basis) || null, after: txt(ma.basis) || null },
        sourceDeleted,
        band: txt(a.band) || null,
        claimIdentical: txt(b.legal_position) === txt(a.legal_position),
        claimGrewBy: txt(a.legal_position).length - txt(b.legal_position).length,
        why: `the ${meter} meter lost support (${txt(mb.basis) || "?"} → ${txt(ma.basis) || "?"}`
          + `${sourceDeleted ? ", source deleted" : ""}) and the band did not move`,
      });
    }
  }
  return out;
}

/**
 * ARM B — a meter the driver demoted as unprovable is stamped `verified-from-record` again.
 *
 * `demotions` is `basis-derivation.json`'s `rows` — the driver's own record of every stamp it could not
 * back, each with its mark, meter and reason. A meter appearing there and reading `verified-from-record`
 * in the final findings has had a machine-checked verdict overruled. That is a stronger statement than
 * "the basis rose": the driver did not merely disagree, it recorded WHY it could not back the claim.
 *
 * PURE, and it needs no fetch ledger — the demotion list IS the before-state, already on disk.
 */
export function demotedStampReasserted(after, demotions) {
  const demoted = new Map();
  for (const d of rows(demotions)) {
    const k = `${txt(d?.mark).toUpperCase()}|${txt(d?.meter)}`;
    if (k !== "|") demoted.set(k, d);
  }
  const out = [];
  for (const f of rows(after)) {
    for (const [meter, m] of Object.entries(f?.meters ?? {})) {
      if (txt(m?.basis) !== "verified-from-record") continue;
      const d = demoted.get(`${txt(f?.mark).toUpperCase()}|${meter}`);
      if (!d) continue;
      out.push({
        arm: "demoted-stamp-reasserted",
        finding: findingKey(f), meter,
        demotedWhy: txt(d.why) || null,
        why: `the driver demoted this stamp (${txt(d.why) || "unprovable"}) and it reads `
          + `verified-from-record again — a verification the reading log cannot back`,
      });
    }
  }
  return out;
}

/**
 * Both arms, most severe first. Arm B leads: overruling a machine-checked demotion is a stronger claim
 * about the run than a band that failed to move.
 *
 * PURE; never throws. An absent input yields `[]` — and a caller must not read that as "clean", because
 * it is also what a missing snapshot looks like. `snapshots` says which inputs were actually present.
 */
export function evidenceClaimViolations({ before, after, demotions } = {}) {
  const violations = [
    ...demotedStampReasserted(after, demotions),
    ...evidenceFellClaimHeld(before, after),
  ];
  return {
    violations,
    snapshots: {
      before: Array.isArray(before) ? before.length : null,
      after: Array.isArray(after) ? after.length : null,
      demotions: Array.isArray(demotions) ? demotions.length : null,
    },
  };
}

/**
 * THE ROWS AS THE RECHECK SEAT READS THEM.
 *
 * Written because the first version of this feature recorded the violations to an artifact and to
 * run.jsonl, said in its own comment that they were "carried to the recheck", and carried nothing: no
 * consumer existed anywhere, the recheck seat holds no tool that could read the file, and the `note()`
 * beside the write is stderr. A finding that reaches no reader is not an escalation.
 *
 * DATA, NEVER A JUDGEMENT — the same contract the corrections table beside it keeps. This says what
 * moved against its own evidence. It does not say the change was wrong; that is the seat's to decide,
 * and it is the one party that can.
 *
 * Returns "" for no violations, so the dispatch is byte-identical on a clean pass.
 */
export function evidenceClaimTable(violations) {
  const v = Array.isArray(violations) ? violations : [];
  if (!v.length) return "";
  const rows = v.map((x) => x.arm === "demoted-stamp-reasserted"
    ? `| ${x.finding} | ${x.meter} | the driver demoted this stamp (${x.demotedWhy || "unprovable"}) and it reads verified-from-record again |`
    : `| ${x.finding} | ${x.meter} | support fell ${x.basis?.before ?? "?"} → ${x.basis?.after ?? "?"}`
      + `${x.sourceDeleted ? ", source deleted" : ""}; band ${x.band ?? "?"} did not move`
      + `${x.claimIdentical ? "; the claim is BYTE-IDENTICAL" : (x.claimGrewBy > 0 ? `; the claim GREW by ${x.claimGrewBy} characters` : "")} |`);
  return [
    `THE DRIVER COMPARED EVERY CLAIM AGAINST ITS OWN EVIDENCE ACROSS THE CORRECTIVE PASS, and ${v.length} `
    + `moved against it. This is machine-derived DATA, not a judgement that the change was wrong — you are `
    + `the one party that can decide that, and one of these shapes is invisible to a text diff.`,
    "",
    "| finding | meter | what moved |",
    "|---|---|---|",
    ...rows,
    "",
    `Say for each whether the claim is still supported. A claim whose support was removed must be removed, `
    + `weakened or explicitly caveated; a stamp the driver could not back must not read verified-from-record `
    + `unless the record was actually read this pass.`,
  ].join("\n");
}
