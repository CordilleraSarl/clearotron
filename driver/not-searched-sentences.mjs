// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// not-searched-sentences.mjs — the owner's sentences for why a search was not carried out, and which recorded reason
// takes which: the one for a search the register refused during the run, and the nine for every other kind. A pure
// leaf with no imports, so the plan compiler, the coverage ledger and the audit share one reading: the coverage ledger
// prints them beside each search left undone (coverage-form.mjs), and the audit's ask ledger prints them in place of a
// recorded reason (publish/audit-from-spine.mjs). The run's record keeps every recorded line.
//
// ── WHY ANY OTHER SEARCH WAS NOT CARRIED OUT, IN THE LAWYER'S WORDS (the owner's sentences, approved 2026-10-30) ──────
//
// Beside every other search a run left undone, the coverage ledger printed the line the run recorded, written for the
// run's record: "capability-gap:", a provider's id, the plan's own vocabulary. Each kind of recorded reason now reads
// as the owner's sentence for it, followed by the sentence that says it was set aside and is disclosed. A kind is told
// by the words its producer writes, and takes its sentence only where that sentence is true of it:
//   - a term in another alphabet takes the first only where the register is known to file such marks under a Latin
//     spelling; where nobody has declared which form the index holds, it takes the last;
//   - a query the register refused as malformed takes the too-many-names sentence only where the request sent more
//     than one name; otherwise it takes the last.
// The last sentence is for the kinds the code records that are not among the eight: a territory or office the
// register does not reach here, an owner and a term asked together, a goods narrowing, and the EU register's own
// refusals. A reason of any other kind keeps its recorded line, and the run's record keeps every recorded line.
export const NOT_SEARCHED_SENTENCES = Object.freeze({
  "other-alphabet": "Not searched: this register files marks in other alphabets under a Latin spelling, so a term written in its own alphabet cannot be searched here. It was set aside and is disclosed here.",
  "kind-of-search": "Not searched: this register does not offer this kind of search. It was set aside and is disclosed here.",
  "owner-not-recognised": "Not counted: the register did not recognise this owner's name, so a count of zero for the owner would prove nothing. It was set aside and is disclosed here.",
  "kept-timing-out": "Not searched: the register kept timing out on this search, even when asked one territory at a time. It was set aside and is disclosed here.",
  "search-command-word": "Not searched: the term contains the word AND, OR or NOT, which this register treats as a search command, so it cannot be searched as written. It was set aside and is disclosed here.",
  "phrase-too-long": "Not searched: the phrase is longer than this register can search as one phrase. It was set aside and is disclosed here.",
  "too-many-names": "Not searched: the register refused this search because it asked for too many names at once. It was set aside and is disclosed here.",
  "wildcard-mid-phrase": "Not searched: a wildcard in the middle of a phrase cannot be searched on this register. It was set aside and is disclosed here.",
  "cannot-run": "Not searched: this register cannot run this search; the reason is recorded in the run. It was set aside and is disclosed here.",
});

// A recorded line is clipped in its middle, so a kind is also told by the words its producer puts last.
const MALFORMED_REFUSAL_RE = /register_refused_query: the register refused this query as malformed|provider's declared width is \d+ terms\.$/;
/** Each kind's test on a recorded reason, in order: the first that holds names the sentence. */
const NOT_SEARCHED_KINDS = [
  ["other-alphabet", /is not in Latin script, and .{1,80}? indexes non-Latin filings by their transliteration/i],
  ["kind-of-search", /predicate "[^"]*" is not supported by the active register provider \([^)]*\) — that capability is absent/],
  ["owner-not-recognised", /bare-owner portfolio count — UNVERIFIED, never the number zero/],
  ["kept-timing-out", /mechanical-fail:timeout: after a gateway timeout the question was asked again in region halves down to the one region /],
  ["search-command-word", /contains a reserved boolean operator \(OR\/AND\/NOT\)|escape syntax for this field — the slice is deferred rather than searched as a different query/],
  ["phrase-too-long", /has \d+ words, past the \d+-word bound/],
  ["too-many-names", (s) => MALFORMED_REFUSAL_RE.test(s) && Number((s.match(/\bSent (\d+) OR terms\b/) ?? [])[1]) >= 2],
  ["wildcard-mid-phrase", /infix-star pattern "/],
  ["cannot-run", [
    /is not in Latin script, and the active register provider \([^)]*\) has NOT DECLARED which form its index holds/,
    MALFORMED_REFUSAL_RE,
    /is not covered by the active register provider \([^)]*\) — the office is outside the provider's coverage/,
    /is not covered by the active register provider \([^)]*\) AS THIS DEPLOYMENT IS CONFIGURED/,
    /owner×term intersection is not supported by the active register provider/,
    /goods-and-services text narrowing is not supported by the active register provider/,
    /EUIPO cannot serve match_mode "/,
    /EUIPO declares predicate "[^"]*" unavailable/,
    /an empty search term reached the EUIPO query builder/,
    /is anchored with "\*" but the predicate is `exact`/,
    /is nothing but wildcards — refused rather than sent as a whole-register sweep/,
    /EUIPO holds the EU register only/,
  ]],
];

/** The owner's sentence for a search left undone, by its recorded line; null for a line of no known kind, which
 *  stands as recorded. A search the register refused during the run has its own sentence (refusedSearchSentence). PURE. */
export function notSearchedSentence(reason) {
  const s = String(reason ?? "");
  if (!s) return null;
  const holds = (t) => (typeof t === "function" ? t(s) : Array.isArray(t) ? t.some((re) => re.test(s)) : t.test(s));
  const kind = NOT_SEARCHED_KINDS.find(([, t]) => holds(t));
  return kind ? NOT_SEARCHED_SENTENCES[kind[0]] : null;
}

export const PROVIDER_HARD_ERROR_PREFIX = "provider hard error after the full recovery ladder — the slice was accepted and then failed, so it was never searched and cannot be read as clean: ";
export const PROVIDER_PERMANENT_ERROR_PREFIX = "provider hard error the recovery ladder cannot help — the slice was accepted and then failed with an error this run cannot classify as transient, so it was never searched and cannot be read as clean: ";

/** Is this deferral row one of ours (either path)? The stem both carry-forward and the fan-in key off. PURE. */
export const isProviderHardErrorReason = (reason) => {
  const s = String(reason ?? "");
  return s.startsWith(PROVIDER_HARD_ERROR_PREFIX) || s.startsWith(PROVIDER_PERMANENT_ERROR_PREFIX);
};

// ── WHY A SEARCH WAS NOT CARRIED OUT, IN THE LAWYER'S WORDS (the owner's sentences, approved 2026-10-30) ──────────────
//
// The front matter gave every search the register left undone one account: the provider cannot express it. That is
// true of a search the register does not support, and false of one it refused during the run, such as on a spent daily
// limit, which a later run can repeat. Each kind now has its own sentence. The refused one also stands beside each
// refused search in the coverage ledger, in place of its recorded line, which is written for the run's record and not
// for a reader; an unsupported search keeps its own line there, which names what the register lacks. The refused sentence
// names the register's recorded answer in its bracket: a daily limit, a rate limit, or no answer. Any other answer gets
// no bracket. The run's record keeps the recorded line.
export const REFUSAL_BRACKETS = Object.freeze({
  "daily-limit": "its daily limit was reached",
  "rate-limited": "it was rate-limited",
  "not-responding": "it was not responding",
});
export const refusedSearchesSentence = (cause = null) =>
  `These searches were not carried out because the register refused them during this run${REFUSAL_BRACKETS[cause] ? ` (${REFUSAL_BRACKETS[cause]})` : ""}; a later run can repeat them.`;

/** The register's recorded answer to a search it refused, as a bracket: a 429 or rate limit that names a daily limit
 *  (Signa's `daily_credit_cap_exceeded`, which clears at UTC midnight), any other 429 or rate limit, and a 5xx or no
 *  answer at all. Signa's `insufficient_credits` is a used-up credit balance, which retrying cannot clear until the
 *  balance changes: none of the three, so like anything else it is null. PURE. */
export function refusalCause(reason) {
  const s = String(reason ?? "");
  const status = Number((s.match(/\bHTTP (\d{3})\b/i) ?? [])[1] ?? NaN);
  if (status === 429 || /(?:^|[^a-z])rate[_ -]?limit/i.test(s)) {
    if (/daily/i.test(s)) return "daily-limit";
    return /insufficient[_ ]credits?/i.test(s) ? null : "rate-limited";
  }
  if (status >= 500 && status <= 599) return "not-responding";
  if (!(status >= 400 && status <= 499) && /\btimed out\b|\btimeout\b|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed/i.test(s))
    return "not-responding";
  return null;
}

/** The sentence that stands beside one search the register refused, by its recorded line; null for any other line,
 *  which stands as recorded. PURE. */
export const refusedSearchSentence = (reason) => (isProviderHardErrorReason(reason) ? refusedSearchesSentence(refusalCause(reason)) : null);
