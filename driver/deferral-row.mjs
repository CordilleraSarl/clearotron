// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// deferral-row.mjs — the row a reader gets for anything left open this run, and the words its reasons
// are given in. Moved out of pipeline.mjs unchanged so that publishing and the audit workbook can reuse the
// shipped words without importing the pipeline. A pure leaf: no imports at all.

// wp50/wi9 — machine directives reworded at the authoring point: "frame-reopen / source:who inn list…"
// with note "deferred this run — mechanical-fail:timeout" is machinery-speak on a lawyer's report.
export const plainDirective = (s) => String(s ?? "").replace(/\b(source|variant|field|axis):\s*/gi, "").replace(/\s+/g, " ").trim();
// ── — TRANSLATE AT THE BOUNDARY, NEVER FILTER ──────────────────────────────────────────────────
//
// This switch is a CODE-MINTED, CODE-ENUMERATED set of reason prefixes, not a dictionary. Every token
// it matches is minted by this same file (`regDeferReason`) and written to _driver/frame-reopen.json;
// none of it is ever authored by a model, and none of it comes from client prose or the register. That is the whole distinction drew — the `mechanical-fail:*` arms below
// have sat here since wp50/wi9 and nobody called them a ban list, because a switch over your own
// output is not a find-and-replace over somebody else's.
//
// DROPPING THE SENTENCE IS NOT AN OPTION. Adding `no-code-remedy:` to parse.mjs's ENGINE_INTERNAL_RE
// would delete the whole sentence (that filter drops per sentence) and with it the disclosure the row
// exists to make — injectDeferralCoverage's own contract is that "the reader-visible disclosure is the
// whole point of 'can't close → disclose'". A reader who is told nothing about an unsearched slice is
// worse off than one told about it in engine words. So: translate, never filter.
//
// The engine wording is KEPT on the internal record — regTermRows' `dispatch_reason` and the
// frame-reopen.json `reason` are unchanged, so remedy-accounting and the audit still read the token.
export const plainDeferralReason = (r) => {
  const t = String(r ?? "unclosed").trim();
  if (/mechanical-fail:timeout/i.test(t)) return "the source timed out this run";
  if (/mechanical-fail:(.+)/i.test(t)) return `a tool failed this run (${t.replace(/^mechanical-fail:/i, "")})`;
  if (/^no-code-remedy:/i.test(t)) {
    // The two forms regDeferReason mints, in the reader's words. Both must still say the slice was NOT
    // searched and why — a translation that loses that has filtered the disclosure by other means.
    if (/class-gap/i.test(t))
      return "no search could be built for it: the gap names classes but no searchable name, and re-running the matter's own classes would only repeat the main sweep, so it is left open here rather than reported as clean";
    if (/\blabel\b/i.test(t))
      return "no search could be built for it: the item names a category rather than a name a register can be searched for, so searching the wording literally would return nothing and read as clean, and it is left open here";
    return "no search could be built for it this run, so it is left open here rather than reported as clean";
  }
  // ── — THE ARMS DID NOT REACH, AND A FALLBACK THAT CANNOT LEAK ────────────────────────
  //
  // built this switch for the two families it had met and left `return t` under them, so every
  // OTHER token `regDeferReason` and `partitionFiring` mint reached the coverage row verbatim. The
  // worst shape is a hash-bearing one — `slice-not-landed:supp:<axis>:<predicate>:<term>:<hash>` — which
  // is not a sentence anybody can act on, and the row it lands in is one a reader relies on to tell a
  // searched slice from an unsearched one.
  //
  // THIS IS THE ONLY PLACE IT CAN BE REPAIRED. The portal's embed strip passes coverage rows through
  // untouched, so whatever this function returns is what the served page carries — there is no second
  // surface downstream that could catch a token this one let past.
  if (/^no-resumable-session\b/i.test(t))
    return "the earlier search session could not be resumed to finish it, so the slice was left open rather than reported as clean";
  if (/^unchanged-after-resume\b/i.test(t))
    return "it was re-run and the result did not change, so it stands as it was — open, not cleared";
  if (/^not-verified-closed\b/i.test(t))
    return "nothing in the run's own record confirms it was searched, so it is left open rather than assumed done";
  if (/^source-not-swept\b/i.test(t))
    return "the channel it needed was never swept this run, so nothing is known about it either way";
  if (/^digest-locked-resume\b/i.test(t))
    return "the earlier pass was still holding the record when the re-run was attempted, so it could not be completed this run";
  if (/^resume-arm-unverifiable\b/i.test(t))
    return "the re-run left no evidence of what it actually searched, so it cannot be treated as having closed this — disclosed rather than assumed clean";
  if (/^proposals-rejected\b/i.test(t))
    return "the searches proposed for it could not be put to this register, so it was never searched";
  if (/^slice-not-landed\b/i.test(t))
    return "the search for it was planned and never reached the register, so nothing is known about it either way";
  if (/^redigest-fail\b/i.test(t))
    return "the re-read of the results failed this run, so what it holds was never established";
  // THE FALLBACK IS THE FIX, and the arms above are the courtesy.
  //
  // `return t` was the defect: it made every UNKNOWN token a rendered string, so the leak was not
  // the nine arms above — it was that the set is open and the default published whatever it did not
  // recognise. A tenth token minted tomorrow would have leaked on the day it was minted. This says the
  // one thing every branch here must say — the slice was not completed and is not clean — and says it
  // without the token.
  //
  // AND IT DROPS NOTHING PROTECTED. Its ruling is "translate, never filter", because a reader told
  // nothing about an unsearched slice is worse off than one told in engine words. The row still renders,
  // still says it was not completed, and still reads as open. The engine wording is untouched on the
  // internal record — `regTermRows`' `dispatch_reason` and `frame-reopen.json`'s `reason` — exactly as
  // that ruling stipulates, so remedy-accounting and the audit still read the token.
  return "it could not be completed this run, so it is left open here rather than reported as clean";
};

// ── — A HEADING IS NOT THE PLACE FOR A DIRECTIVE ───────────────────────────────────────────────
//
// What shipped: `Follow-up / ${plainDirective(directive).slice(0, 60)}` — a hard character cut with no
// word boundary and no ellipsis. Two delivered specimens in demo:
//   "Follow-up / consumer and prosumer water testing (pool, spa, aquarium, ho"   (mid-"home")
//   "Follow-up / agri-tech, irrigation, aquaculture and hydrology monitoring "   (mid-"software", and
//                                                                                a trailing space)
// That string is a CLIENT HEADING — render.mjs's coverageGrid prints it under "What we covered — and
// what's open", and it rides verbatim into report-data.json.
//
// THE FIX IS HERE, NOT IN THE RENDERER, deliberately. coverageGrid carries the ruling that
// "NOTHING IS SUBSTITUTED HERE ANY MORE — `area` and `note` ride verbatim". Clipping in the renderer
// would re-open substitution over a client string at exactly the seam that ruling closed. The heading
// is wrong where it is MINTED, so it is fixed where it is minted.
//
// A smarter truncation would still be a truncation. The real defect is that a whole search directive
// was being asked to serve as a heading. So the heading gets a short, word-boundary-cut label with an
// explicit "…" saying it was shortened, and the FULL directive moves into `note`, which has room for
// it. Nothing is lost from the reader's view; it moves to where it fits.
//
// "Follow-up / " STAYS LITERAL. coverage-ledger.coverageUnitLabel keys label suppression off that exact
// shape ("a driver-authored plain-English area … must not be touched"), so only what follows it moves.
const DEFERRAL_AREA_ITEM_BUDGET = 48;      // characters after "Follow-up / " — a heading, not a sentence

/** Cut `s` to at most `max` characters at a WORD boundary, marking the cut with an explicit "…".
 *  Trailing punctuation and whitespace are trimmed before the ellipsis so no heading ends "monitoring …"
 *  or with a dangling bracket. Returns `s` unchanged when it already fits. PURE. */
export function clipToWord(s, max) {
  const t = String(s ?? "").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  const head = (sp > 0 ? cut.slice(0, sp) : cut).replace(/[\s,;:.\-–—(/[]+$/, "");
  return head ? `${head}…` : `${cut.trim()}…`;
}

/** — ONE deferral's reader-visible coverage row. Exported so the shape a client reads is testable
 *  without a run directory: injectDeferralCoverage below is the file-I/O wrapper around this. PURE. */
export function deferralCoverageRow(directive, reason) {
  const full = plainDirective(directive);
  return {
    area: `Follow-up / ${clipToWord(full, DEFERRAL_AREA_ITEM_BUDGET)}`,
    state: "open",
    note: `${full} — not completed this run — ${plainDeferralReason(reason)}`,
  };
}
