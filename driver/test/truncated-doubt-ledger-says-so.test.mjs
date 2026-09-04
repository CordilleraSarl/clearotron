// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — A TRUNCATED DOUBT LEDGER SAYS SO, ON A SURFACE THAT OUTLIVES THE RUN DIR.
//
// The doubt mints are capped at 25 (`mintRecordCarryDoubts`, `mintCommonLawCarryDoubts`) because the
// unreasoned list is unbounded by construction — a wholly failed digest could put every placed record
// in it and drown the ledger. The cap is right, and it already returned what it omitted. What it did
// with that number was the defect: `note()` writes the RUN LOG, and the run dir is purged.
//
// So on a delivered run a ledger holding exactly 25 rows was byte-identical to a complete one that
// happens to hold 25. Measured on delivered run 674db9c7: exactly 25 record-carry doubts, and whether
// a 26th existed is unanswerable from every surviving artifact — the pool keeps audit.md,
// findings.json, report.html, report.md, report-data.json and the xlsx; `_driver/` is gone.
//
// That is the absence-reads-as-a-pass shape on the one artifact a reviewing lawyer is pointed at.
import test from "node:test";
import assert from "node:assert/strict";
import { buildAuditMd } from "../publish/audit-from-spine.mjs";
import { mintRecordCarryDoubts } from "../record-carry.mjs";

const REGISTER_MD = [
  "# Register findings — Mark: TEST",
  "",
  "### Negative results",
  "| Mark | Search Term / Variant | Result | Notes |",
  "|---|---|---|---|",
  "| ACME LLC | acme (default) | dropped — off-field (relevance gate) | URI /mark/xx/1 |",
].join("\n");

const doubt = (n) => ({
  id: `doubt:record-carry:unreasoned:${n}`,
  birth: { place: "record-carry", artifact: "register-named-band.json", quote: `/mark/xx/${n} — MARK ${n}` },
  subject: { mark: `MARK ${n}`, owner: null, uris: [`/mark/xx/${n}`], terms: [], text: "reached placement, stopped at the digest seam" },
  status: "open", ending: null,
});
const CAPPED = Array.from({ length: 25 }, (_, i) => doubt(i + 1));

test("#1348 a truncated ledger says so IN the audit, with the omitted COUNT", () => {
  const { md, counts } = buildAuditMd(REGISTER_MD, "", {
    doubts: CAPPED,
    doubtTruncations: [{ source: "record-carry", minted: 25, omitted: 12 }],
  });
  assert.match(md, /TRUNCATED/, "the delivered audit does not disclose that the ledger is partial");
  assert.match(md, /record-carry/, "…and does not say which mint truncated");
  // THE COUNT, NOT A BOOLEAN. "Some were omitted" tells a reader they are missing something and not
  // how much — the difference between a ledger one row short and one showing a third of the run.
  assert.match(md, /12 further unreasoned drop\(s\)/, "the omitted COUNT must be on the page");
  assert.match(md, /25 of 37 minted/, "…and the reader must be able to see the whole of what was found");
  assert.equal(counts.doubtsOmitted, 12, "the count is not machine-readable — a test or run log would have to grep prose");
  // The remainder lived in _driver/, which is not retained. Pointing a delivered artifact at a purged
  // path would be worse than useless, so the line must say the count IS the record.
  assert.doesNotMatch(md, /_driver\/record-carry\.json/,
    "the delivered audit points the reader at a path that is purged with the run dir");
});

test("#1348 a run that truncated NOTHING renders not one extra byte", () => {
  // The common path, and the reason this cannot become a line every reader learns to skip.
  const clean = buildAuditMd(REGISTER_MD, "", { doubts: CAPPED });
  const emptyList = buildAuditMd(REGISTER_MD, "", { doubts: CAPPED, doubtTruncations: [] });
  const zeroRow = buildAuditMd(REGISTER_MD, "", { doubts: CAPPED, doubtTruncations: [{ source: "record-carry", minted: 25, omitted: 0 }] });

  assert.doesNotMatch(clean.md, /TRUNCATED/, "an untruncated run is disclosing a truncation that did not happen");
  assert.equal(emptyList.md, clean.md, "an empty truncation list changed the artifact");
  assert.equal(zeroRow.md, clean.md, "a zero-omitted row rendered — the filter is on presence, not on the count");
  assert.equal(clean.counts.doubtsOmitted, 0);
});

test("#1348 REPLAY: a ledger AT the cap is now distinguishable from a complete one of the same size", () => {
  // The issue's own acceptance, and the thing that was impossible before: both of these deliver 25
  // rows. Byte-identical previously; they must differ now, and differ in a way a reader can act on.
  const truncated = buildAuditMd(REGISTER_MD, "", {
    doubts: CAPPED, doubtTruncations: [{ source: "record-carry", minted: 25, omitted: 1 }],
  }).md;
  const complete = buildAuditMd(REGISTER_MD, "", { doubts: CAPPED }).md;

  assert.notEqual(truncated, complete,
    "a ledger sitting at the cap still reads identically to a complete one — this is the whole defect");
  assert.match(truncated, /1 further unreasoned drop\(s\)/, "even a single omission is disclosed");
  // …and the doubts themselves are untouched by the disclosure: it qualifies the ledger, never edits it.
  for (const d of CAPPED) assert.ok(truncated.includes(d.birth.quote), `the disclosure dropped a doubt row: ${d.id}`);
});

test("#1348 EVERY slice is named — two truncations are not one", () => {
  // `mintCommonLawCarryDoubts` runs per slice. A reader told "12 omitted" twice with no slice cannot
  // tell two truncations from one repeated line.
  const { md, counts } = buildAuditMd(REGISTER_MD, "", {
    doubts: CAPPED,
    doubtTruncations: [
      { source: "record-carry", minted: 25, omitted: 3 },
      { source: "commonlaw-carry (a)", minted: 25, omitted: 4 },
      { source: "commonlaw-carry (m)", minted: 25, omitted: 5 },
    ],
  });
  for (const s of ["record-carry", "commonlaw-carry (a)", "commonlaw-carry (m)"])
    assert.ok(md.includes(s), `${s}'s truncation is not disclosed on its own line`);
  assert.equal(counts.doubtsOmitted, 12, "the total must be the SUM across mints, not the last one");
});

test("#1348 the mint's own report is what the disclosure is built from — the number is real", () => {
  // Everything above feeds buildAuditMd a literal. This drives the shipped mint, so a change to what
  // it reports is caught rather than the two sides moving independently.
  const unreasoned = Array.from({ length: 37 }, (_, i) => ({
    uri: `/mark/xx/${i + 1}`, mark: `MARK ${i + 1}`, owner: null,
    reach: "placement", stopped_at: "digest", detail: "no ground recorded",
  }));
  const minted = mintRecordCarryDoubts({ unreasoned });
  assert.equal(minted.minted, 25, "the cap moved — this test's arithmetic is written against 25");
  assert.equal(minted.omitted, 12, "the mint no longer reports what it dropped");

  const { md, counts } = buildAuditMd(REGISTER_MD, "", {
    doubts: minted.doubts,
    doubtTruncations: [{ source: "record-carry", minted: minted.minted, omitted: minted.omitted }],
  });
  assert.equal(counts.doubtsOmitted, minted.omitted);
  assert.match(md, /25 of 37 minted/, "the rendered total disagrees with the mint's own arithmetic");
});

test("#1348 a ledger-less run cannot acquire a truncation line", () => {
  // `doubts: null` is the legacy/replay caller — no Doubt Ledger section at all. A truncation row
  // arriving without a ledger must not mint a section that nothing else in the artifact supports.
  const { md } = buildAuditMd(REGISTER_MD, "", {
    doubts: null, doubtTruncations: [{ source: "record-carry", minted: 25, omitted: 9 }],
  });
  assert.doesNotMatch(md, /TRUNCATED/, "a run with no doubt ledger rendered a truncation notice about one");
});
