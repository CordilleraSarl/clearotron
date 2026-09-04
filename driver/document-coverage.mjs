// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// document-coverage.mjs — whether registry documents were obtained, stated by the RENDERER from the run's
// own records, because no seat can see that lane.
//
//, and it is part 2's ruling at a third seat. A scored run on 2026-08-22 was refused by the
// reviewer: the clearance narrative told the client, as a WHOLE-REPORT limitation, that no registry
// certificate was obtained and that every right's goods were therefore judged from class numbers rather
// than wording. The run's own `_driver/register-record-bodies.jsonl` held 855 fetched bodies, and nine
// findings recorded `meters.use.basis = "verified-from-record"`. Where the wording HAD been read it
// contradicted the narrative on a headline conflict.
//
// The seat was not lying. Its declared inputs do not include the record sidecar, so it cannot see what the
// fetch lane retrieved, and it described the lane from the only thing it had. part 2 settled what to
// do about that and restated it one lane over: NOBODY WHO CANNOT SEE THE MACHINERY DESCRIBES IT.
// The seat is told to say nothing; the renderer writes the sentence from the sidecars.
//
// ── WHY THIS SENTENCE IS WORTH RENDERING AT ALL ──────────────────────────────────────────────────────
//
// Deleting the seat's claim and writing nothing would be worse than the defect for the run that genuinely
// fetched nothing: a report silent about document coverage reads as one where the wording was read. The
// limitation is real and a lawyer needs it — it just has to be measured rather than assumed. So this
// renders in EVERY state, including the one where nothing was fetched, and never emits an empty section.
//
// ── WHAT IT COUNTS, AND WHAT IT REFUSES TO SAY ───────────────────────────────────────────────────────
//
// Two measurements, from two artifacts the run already writes:
//
//   records with a body   how many register records this delivery holds an actual document for
//   findings on record    how many findings rest on `meters.use.basis = "verified-from-record"`
//
// It does NOT compute a percentage of "rights whose goods were read", and that is deliberate. The
// reviewer's complaint was a claim that outran its evidence in one direction; a renderer that answered
// with a confident ratio over a denominator nobody defined would do the same thing in the other. It
// states the two counts it can stand behind and leaves the reader to weigh them.

/** The two counts, from artifacts the run already holds. PURE — the caller reads the files. */
export function documentCoverage({ records = null, findings = null } = {}) {
  // `records` is the assembled record set (a Map of uri → body) or any iterable of bodies. A record with
  // no body is a receipt that a fetch was ATTEMPTED, which is not a document.
  const bodies = records == null ? null
    : [...(typeof records.values === "function" ? records.values() : records)]
      .filter((b) => b && typeof b === "object" && !Array.isArray(b));
  const withBody = bodies == null ? null : bodies.filter(hasBody).length;
  const list = Array.isArray(findings) ? findings : (Array.isArray(findings?.findings) ? findings.findings : null);
  const onRecord = list == null ? null
    : list.filter((f) => String(f?.meters?.use?.basis ?? "") === "verified-from-record").length;
  return {
    // null is "this run holds no such artifact", which is NOT the same as zero and must never render as
    // "nothing was fetched" — the instrumentation house rule, in the one place where getting it wrong
    // puts a false limitation in front of a client.
    recordsWithBody: withBody, recordsTotal: bodies == null ? null : bodies.length,
    findingsOnRecord: onRecord, findingsTotal: list == null ? null : list.length,
  };
}

/**
 * Does this record artifact carry an actual document, as opposed to a receipt that one was sought?
 *
 * Keys that are pure provenance (`_uri`, `_fetchedAt`, …) do not make a body. A record whose only content
 * is its own address is exactly the shape that would let "we fetched 855 records" mean nothing at all.
 */
function hasBody(b) {
  return Object.keys(b).some((k) => !k.startsWith("_") && b[k] != null && b[k] !== "");
}

/** Was there enough to say anything? A run holding neither artifact gets the honest refusal below. */
export const canStateDocumentCoverage = (s) => s?.recordsWithBody != null || s?.findingsOnRecord != null;

/**
 * The section a lawyer reads. NEVER EMPTY, and never an absence it cannot support.
 *
 * Three states, and the middle one is the whole point: a run that fetched documents must not be
 * described as one that did not.
 */
export function renderDocumentCoverageSection(summary) {
  const s = summary ?? {};
  const head = "## Document coverage\n\n";
  if (!canStateDocumentCoverage(s)) {
    // NOT SILENCE. A missing artifact is a fact about the run's instrumentation, and saying so is the only
    // honest option: the alternative reads as "the wording was not read", which is the defect inverted.
    return head
      + "**This run holds no record of which registry documents were retrieved.** The driver states this "
      + "section from the run's own fetched records; that artifact is absent here, so no claim is made "
      + "either way about whether the underlying documents were obtained, and none should be read into "
      + "this report's silence.";
  }
  const parts = [];
  if (s.recordsWithBody != null)
    parts.push(s.recordsWithBody === 0
      ? "**No registry document was retrieved for this search.** Every right below was assessed from the "
        + "register entry as listed — its classes, its status and its owner — and not from the wording of "
        + "the specification itself."
      : `**Registry documents were retrieved for this search:** ${s.recordsWithBody} record`
        + `${s.recordsWithBody === 1 ? "" : "s"}${s.recordsTotal != null && s.recordsTotal !== s.recordsWithBody
          ? ` of the ${s.recordsTotal} held for this matter` : ""} carr${s.recordsWithBody === 1 ? "ies" : "y"} `
        + "the document itself, so the goods and services behind those rights were read as written rather "
        + "than inferred from their class numbers.");
  if (s.findingsOnRecord != null && s.recordsWithBody !== 0)
    parts.push(s.findingsOnRecord === 0
      ? "No finding in this report rests on wording read from a retrieved document; where a specification "
        + "is characterised below, it is characterised from the register entry."
      : `${s.findingsOnRecord} of the ${s.findingsTotal} findings below rest${s.findingsOnRecord === 1 ? "s" : ""} `
        + "on wording read from the retrieved document rather than on the class heading alone.");
  return head + parts.join(" ");
}

const HEADING_RE = /^#{2,4}\s+Document coverage\s*$/i;

/**
 * Put the section into a document, REPLACING one already there.
 *
 * Idempotent by construction, mirroring spliceCoverageLedger: this renders on more than one pass, and an
 * appending splice would leave a report carrying two document-coverage statements written from different
 * states of the same run — which is the two-artifacts-disagreeing failure is about, manufactured by
 * the cure.
 */
export function spliceDocumentCoverage(md, section) {
  const doc = String(md ?? "");
  if (!section) return doc;
  const lines = doc.split("\n");
  const start = lines.findIndex((ln) => HEADING_RE.test(ln));
  if (start >= 0) {
    // THE NEXT HEADING OF ANY LEVEL ends it, not the next one of equal-or-shallower level. This section
    // has no sub-headings, so nothing deeper belongs to it — and the level-based scan the ledger splice
    // uses swallows a following `### Audit trail` whole, because level 3 is not "shallower than 2". Found
    // by the re-render arm, which is why that arm asserts the rest of the document survives.
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^#+\s/.test(lines[i])) { end = i; break; }
    }
    return [...lines.slice(0, start), ...section.split("\n"), "", ...lines.slice(end)].join("\n");
  }
  const audit = lines.findIndex((ln) => /^#{2,4}\s+[^\n]*audit trail/i.test(ln));
  if (audit >= 0) return [...lines.slice(0, audit), ...section.split("\n"), "", ...lines.slice(audit)].join("\n");
  return `${doc.replace(/\s*$/, "")}\n\n${section}\n`;
}
