// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// doubt-ledger.mjs — doubts end in a recorded judgment (2026-07-22; the copper-gantry defect).
//
// THE DEFECT THIS KILLS: the published audit is a UNION of run artifacts with no reconciliation step —
// by design (the audit is the defensibility record of everything considered). copper-gantry shipped three
// fragments about ONE mark side by side: an asserted "closest analogue, active nationwide product" block,
// a direct-search "does NOT appear on the owner's official sites" block, and a prose "requires
// prelim-register layer cross-check" note that NOTHING parses. The resolutions usually EXIST — in
// findings.json dispositions/actions, in the coverage ledger, in register-findings answer/watchlist
// lines — the missing piece was the JOIN back to the fragment that raised the doubt. This module is
// that join, and nothing more.
//
// NORTH STAR (annotate/disclose, never gate): a doubt is a QUESTION the run asked itself. This module
// mints the question as a record, stitches it to an answer the run ALREADY produced when one exists,
// and otherwise leaves it visibly OPEN. Nothing here loops, retries, re-searches, or blocks delivery —
// judgment decides, code only joins and records. An OPEN doubt shipping in the audit's Doubt Ledger is
// the system working, not failing.
//
// PURE by design (no node imports, no I/O) — like coverage-ledger.mjs / common-law-receipts.mjs it
// tests offline and the pipeline call site owns all file reads/writes.
//
// Doubt record shape (frozen — _driver/doubts.json and the audit's # Doubt Ledger both render it):
//   {
//     id: "<deterministic — place + artifact + index>",
//     birth:  { place: "<the minting site>", artifact: "<file>", quote: "<verbatim>" },
//     subject:{ mark, owner, terms:[...], text, uris:[...], placementTier },  // the JOIN KEYS, derived
//                                                  // at mint — never guessed later
//
//   `place` USED TO NAME TWO SITES HERE, read as the closed set it never was — so this is a pointer
//   instead. SCOPE IT: `place:` names two ledgers, and the doubt mints are the minority. Doubts key it
//   `birth: { place }`; ASKS key it `born: { place }`, all in ask-ledger.mjs, and they are 8 of the 15
//   distinct values. So `grep -rhoE 'place: *"[a-z-]+"' driver/*.mjs` answers a question about a
//   different ledger; add `--exclude=ask-ledger.mjs` (verified to return exactly the `birth:`-scoped
//   set) for the doubt mints. PRESENCE_BIRTH_PLACE below is the one place name this module itself
//   turns on, and it is exported for that reason.
//
//   `uris` and `placementTier` are the DRIVER-SELECTION keys. `uris` predates  and was already
//   undocumented here; `placementTier` arrived with it  and is what doubt-closure selection cuts
//   on. Both are null/empty at the mints that genuinely have no such key — a record, not a gap.
//     status: "checked-and-settled" | "open",
//     ending: { by: "code-stitch" | "doubt-closure-stage", evidence: { file, quote }, reason? } | null,
//   }

// ── normalization + the exact-token join primitive ────────────────────────────────────────────────
// Same normalization family as audit-from-spine's normJoin / predelivery-lint's correction join: the
// join must survive markdown bold, case, punctuation — but NEVER fuzzy-match. This module is a leaf;
// audit-from-spine imports normalizeJoinText FROM here, so both sides of every doubt join and the
// audit-side matchers normalize through ONE function and can never drift.

/** NFKD + strip combining marks: "Mięsko" → "Miesko". Fold, never transliterate. PURE. */
const foldMarks = (s) => String(s ?? "").normalize("NFKD").replace(/\p{M}+/gu, "");

/**
 * THE join normalization (2026-07-22, doubt-closure T2c — widened from bare lowercase+punct-strip on
 * offline evidence over 6 archived runs: of the doubts the stitch left OPEN, ~75% had an on-disk
 * answer the exact-token join could not reach, and the top mechanical causes were case/format variants
 * ("IonLabs" vs "ION LABS") and diacritics ("Pan Mięsko" vs "Pan Miesko")). Steps, in order:
 * diacritics fold (NFKD + strip marks), camelCase/PascalCase seam split (case info must still exist),
 * every punctuation/hyphen/dot run collapsed to one space, uppercase. Still NEVER fuzzy: two texts
 * either share a whole token after this or they don't. PURE.
 */
export function normalizeJoinText(s) {
  return foldMarks(s)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")     // camelCase seam: "IonLabs" → "Ion Labs"
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")   // PascalCASE seam: "ODELabs" → "ION Labs"
    .replace(/[^A-Za-z0-9]+/g, " ")             // hyphen/space/dot (all punctuation) → single space
    .trim().toUpperCase();
}
const norm = normalizeJoinText;

/** Word-bounded exact containment on NORMALIZED text — the ONLY match verb in this module. Exported
 *  (like normalizeJoinText / distinct above) so placement-carry.mjs matches with the SAME verb rather
 *  than a local copy — one matcher, never two that drift. PURE. */
export const hasToken = (hay, needle) => !!needle && ` ${norm(hay)} `.includes(` ${norm(needle)} `);

// DISTINCTIVENESS FLOOR — "NEVER guess" made mechanical. A join term must be ≥2 tokens, or a single
// token of ≥6 chars, before it may join anything: "HYDRO" (5) or a stray "PLUS" joining a coverage row
// would be a guess dressed as a match. A doubt whose only term fails the floor simply stays OPEN —
// honest, and exactly what the ledger is for. Exported (like normalizeJoinText) so
// presence-reconciliation.mjs applies the SAME floor to its mint-time terms — one floor, never two.
export const distinct = (nTerm) => {
  const t = String(nTerm ?? "").trim();
  return t.includes(" ") || t.length >= 6;
};

// ── candidate mark-token extraction (mint-time, deterministic) ────────────────────────────────────
// Gather prose and audit block titles name marks in ALL CAPS ("PROPEL AQUAPLUS", "VOLTMAX
// ENERGYCORE"); the surrounding words are narrative. Extract maximal caps runs, trim the caps-cased
// STOPWORDS that ride along ("[NEW]", "NOT", "LLC"), and keep only runs that pass the floor. This is
// extraction of what the text already says — never generation.
const CAPS_STOP = new Set(["NEW", "NOT", "THE", "AND", "FOR", "WITH", "LLC", "INC", "LTD", "CO",
  "US", "USA", "EU", "UK", "A", "AN", "OF", "ON", "IN", "NO", "VS", "OR", "PER", "SEE"]);

/** ALL-CAPS runs from `text` that pass the distinctiveness floor, deduped. Diacritics are folded
 *  BEFORE extraction ("PAN MIĘSKO" → candidate "PAN MIESKO") so accented caps runs extract at all —
 *  the join normalizes both sides through the same fold, so a folded candidate still matches. PURE. */
export function capsCandidates(text) {
  const cleaned = foldMarks(text).replace(/[*_`()\[\]]/g, " ");
  const runs = cleaned.match(/\b[A-Z][A-Z0-9&'-]+\b(?:\s+\b[A-Z][A-Z0-9&'-]+\b)*/g) ?? [];
  const out = [];
  for (const run of runs) {
    // trim stopword tokens at the edges only — "VOLTMAX ENERGYCORE NOT" → "VOLTMAX ENERGYCORE";
    // an interior stopword is part of the mark ("BEST OF BREW") and stays.
    const toks = run.split(/\s+/);
    while (toks.length && CAPS_STOP.has(toks[0])) toks.shift();
    while (toks.length && CAPS_STOP.has(toks[toks.length - 1])) toks.pop();
    const cand = toks.join(" ");
    if (cand && distinct(norm(cand)) && !out.includes(cand)) out.push(cand);
    // ALSO emit the variant with ≤2-char edge tokens trimmed: a caps run routinely drags a
    // jurisdiction code along ("GLACIALIS PEAKFUEL CH designations" → run "GLACIALIS PEAKFUEL CH")
    // and the resolution surface names the mark WITHOUT it. Both variants are candidates — the join
    // still demands whole-token containment on one of them, so this widens extraction, never matching.
    const inner = [...toks];
    while (inner.length > 1 && inner[0].length <= 2) inner.shift();
    while (inner.length > 1 && inner[inner.length - 1].length <= 2) inner.pop();
    const innerCand = inner.join(" ");
    if (innerCand && innerCand !== cand && distinct(norm(innerCand)) && !out.includes(innerCand)) out.push(innerCand);
  }
  return out;
}

// ── the short-mark TWO-TOKEN path (2026-07-22, doubt-closure T2c) ─────────────────────────────────
// The distinctiveness floor refuses ONE weak signal — and stays: "ION" alone joining anything would be
// a guess (offline evidence: on the mark ION the floor blocked 6/6 would-be joins, ALL of which had
// on-disk answers). But two INDEPENDENT weak signals agreeing in the SAME candidate is a different
// epistemic situation: the short mark token AND an owner token (or an instructed class number) both
// naming one line is no longer a stray-token collision. So a below-floor subject may join ONLY when
// both signals land in the same candidate. Signals are DERIVED at join time from the frozen subject
// shape (mark/owner/text) — extraction of what the doubt already says, never generation. Independence
// is structural: a short mark token FAILS the floor, an owner companion must PASS it, so one token can
// never play both roles.

// Process/jurisdiction vocabulary that rides in cross-check prose in TitleCase — never an owner name.
const OWNER_STOP = new Set(["Check", "Verify", "Confirm", "Cross", "Direct", "Owner", "Search",
  "Register", "Registry", "Whether", "Requires", "Required", "Designation", "Designations",
  "Class", "Classes", "Madrid", "Protocol"]);
const TITLE_RUN_RE = /\b[A-Z][a-z][A-Za-z0-9&'-]*(?:\s+[A-Z][a-z][A-Za-z0-9&'-]*)*/g;

/** {marks, owners, classes} for the two-token path — derived, never stored on the record. PURE. */
function shortJoinSignals(subject) {
  // cross-check doubts carry "<what> — <why>": the mark and owner live in <what>, narrative in <why>
  // (a narrative word like "verify" must never become a companion signal).
  const what = String(subject?.text ?? "").split(" — ")[0];
  const src = foldMarks([subject?.mark, what].filter(Boolean).join(" ")).replace(/[*_`()\[\]]/g, " ");

  // short mark tokens: exactly the caps-run tokens the floor made capsCandidates drop at mint
  const marks = [];
  for (const run of src.match(/\b[A-Z][A-Z0-9&'-]+\b(?:\s+\b[A-Z][A-Z0-9&'-]+\b)*/g) ?? []) {
    for (const t of run.split(/\s+/)) {
      if (!CAPS_STOP.has(t) && norm(t) && !distinct(norm(t)) && !marks.includes(t)) marks.push(t);
    }
  }

  // owner companions: the owner FIELD (contradiction doubts) + TitleCase runs in <what> (cross-check
  // doubts name the owner in prose). Each companion must itself pass the floor.
  const owners = [];
  const pushOwner = (t) => { const n = norm(t); if (n && distinct(n) && !owners.includes(t)) owners.push(t); };
  const ownerField = String(subject?.owner ?? "");
  if (norm(ownerField)) { pushOwner(ownerField); for (const t of ownerField.split(/\s+/)) pushOwner(t); }
  for (const run of foldMarks(what).match(TITLE_RUN_RE) ?? []) {
    const toks = run.split(/\s+/).filter((t) => !OWNER_STOP.has(t));
    for (const t of toks) pushOwner(t);
    if (toks.length > 1) pushOwner(toks.join(" "));
  }

  // class-number companions: "class 25" named anywhere in the doubt's subject
  const classes = [...String(subject?.text ?? "").matchAll(/\bclass(?:es)?\s+(\d{1,2})\b/gi)].map((m) => m[1]);
  return { marks, owners, classes };
}

/** TWO independent weak signals agreeing in ONE candidate: short mark + (owner | class N). PURE. */
function twoTokenMatch(sig, candidateText) {
  if (!sig.marks.some((m) => hasToken(candidateText, m))) return false;
  if (sig.owners.some((o) => hasToken(candidateText, o))) return true;
  return sig.classes.some((n) => hasToken(candidateText, `class ${n}`) || hasToken(candidateText, `classes ${n}`));
}

// ── minting: gather cross-check hand-offs ─────────────────────────────────────────────────────────
// The gather stages are DICTATED (stages.mjs) to record any check they could not perform, on its own
// line, in EXACTLY this shape. The prefix is exact and the parse is deterministic ON PURPOSE: legacy
// artifacts (and free prose like "requires prelim-register layer cross-check" buried in a paragraph —
// the copper-gantry note nothing parsed) mint NOTHING. Carrying prose doubts is the dictation's job at
// the source, not a fuzzy parser's job here. A leading list bullet is tolerated (models bullet
// everything); anything else about the shape is strict, including the em-dash between what and why.
const CROSS_CHECK_RE = /^(?:[-*]\s+)?CROSS-CHECK REQUIRED:\s*(.+?)\s+—\s+(.+?)\s*$/;

/**
 * Parse `CROSS-CHECK REQUIRED: <what> — <why>` lines out of a gather artifact → doubt records
 * (status "open"; stitchDoubts decides endings). `sourceName` is the artifact's display name and
 * rides in birth.artifact + the id. PURE.
 */
export function mintCrossCheckDoubts(artifactText, sourceName) {
  const doubts = [];
  for (const rawLine of String(artifactText ?? "").split("\n")) {
    const m = rawLine.trim().match(CROSS_CHECK_RE);
    if (!m) continue;
    const [, what, why] = m;
    doubts.push({
      id: `doubt:crosscheck:${sourceName}:${doubts.length + 1}`,
      birth: { place: "gather-crosscheck", artifact: String(sourceName ?? ""), quote: rawLine.trim() },
      // join keys: the caps-named marks inside <what> (a designation check names its mark in caps per
      // the search artifacts' own convention), plus the full clause text for scope-term containment.
      subject: { mark: "", owner: "", terms: capsCandidates(what), text: `${what} — ${why}` },
      status: "open",
      ending: null,
    });
  }
  return doubts;
}

// ── minting: audit contradictions ─────────────────────────────────────────────────────────────────
// The same mark asserted by one Finding block and refuted by another. Detection is deliberately
// narrow: the REFUTING side must carry an explicit direct-search negation (the shape the copper-gantry
// refutation actually had — "does NOT appear", "NOT found"), and the two blocks must share a
// floor-passing caps mark candidate. This GENERALIZES withdrawnMatchFor's matching approach (normalize
// + exact containment) but cannot demand mark+owner like it does: in the live defect the two fragments
// carried DIFFERENT titles/owners ("Prime Hydration (…)" refuting "[NEW] Gatorade Propel AQUAPLUS")
// and the common-law blocks carry no owner field at all — the shared MARK token is the identity, with
// the distinctiveness floor standing in for the owner check.
const NEG_RE = /\b(?:not\s+found|does\s+not\s+appear|no\s+such\s+\w+|not\s+located|no\s+match(?:es)?\b|not\s+marketed)/i;

const blockText = (b) => [b?.title, b?.description, b?.key_factors].filter(Boolean).join(" ");

/**
 * One doubt per (asserting block, refuting block) pair sharing a distinctive mark candidate.
 * `auditBlocks` is audit-from-spine's parsed Findings-block shape ({title, owner, description, …}).
 * PURE.
 */
export function mintContradictionDoubts(auditBlocks) {
  const blocks = Array.isArray(auditBlocks) ? auditBlocks : [];
  const doubts = [];
  for (const a of blocks) {
    const aText = blockText(a);
    if (NEG_RE.test(aText)) continue;                    // a refuting block never plays the asserting side
    for (const cand of capsCandidates(String(a?.title ?? ""))) {
      for (const b of blocks) {
        if (b === a) continue;
        const bText = blockText(b);
        if (!NEG_RE.test(bText)) continue;               // the other side must be an explicit negation
        if (!hasToken(bText, cand)) continue;            // …about the SAME mark, exact token containment
        // one doubt per PAIR — a pair sharing two candidates ("PROPEL" + "PROPEL AQUAPLUS") mints once
        if (doubts.some((d) => d.subject.asserted === a.title && d.subject.refuting === b.title)) continue;
        doubts.push({
          id: `doubt:contradiction:${norm(cand).replace(/ /g, "-")}:${doubts.length + 1}`,
          birth: {
            place: "audit-contradiction", artifact: "audit.md",
            // both fragments verbatim — the quote is the pair, because the DOUBT is the pair
            quote: `asserted: "${a.title}" / refuted: "${b.title}"`,
          },
          subject: {
            mark: cand, owner: String(a?.owner ?? ""), terms: [cand],
            text: `${a?.title ?? ""} ${a?.owner ?? ""} ${b?.title ?? ""}`,
            asserted: a.title, refuting: b.title,        // audit builder finds both blocks by these
          },
          status: "open",
          ending: null,
        });
      }
    }
  }
  return doubts;
}

// ── the findings.json join (shared with the audit builder's contradiction annotation) ─────────────
/**
 * The findings.json finding a doubt's subject joins, or null. THE RULE (per the "never guess" law):
 * the finding's mark — or its owner name — must appear WHOLE (normalized, word-bounded) in the
 * doubt's join text, and the matched name must pass the distinctiveness floor. A mark too short/
 * generic to join on its own name may still join via the two-token path: the finding's own record
 * (mark + owner + classes) must carry BOTH the doubt's short mark token AND an owner/class companion
 * (shortJoinSignals). Otherwise the doubt stays OPEN rather than guessing. PURE.
 */
export function findingJoinFor(subject, findings) {
  const text = [subject?.mark, subject?.owner, subject?.text, ...(subject?.terms ?? [])]
    .filter(Boolean).join(" ");
  if (!norm(text)) return null;
  const sig = shortJoinSignals(subject);
  for (const f of findings ?? []) {
    const markN = norm(f?.mark), ownerN = norm(f?.owner?.name);
    if (distinct(markN) && hasToken(text, markN)) return f;
    if (distinct(ownerN) && hasToken(text, ownerN)) return f;
    const fText = [f?.mark, f?.owner?.name,
      Array.isArray(f?.classes) && f.classes.length ? `classes ${f.classes.join(" ")}` : ""]
      .filter(Boolean).join(" ");
    if (twoTokenMatch(sig, fText)) return f;
  }
  return null;
}

// ── stitching: join each doubt to a resolution the run already produced ───────────────────────────
// Resolution sources, in a FIXED order (first verified join wins — determinism over completeness):
//   1. a findings.json finding (mark/owner exact-token match) → its disposition/band/ordinal, plus
//      any actions-register entry referencing that ordinal (text COPIED verbatim — never re-worded);
//   2. a coverage-ledger row naming the doubt's term/axis;
//   3. a register-findings.md line in an answer/watchlist section containing the doubt's mark token.
// No join ⇒ the doubt stays "open" and ships visibly as OPEN. Never mutates its input.

const clip = (s, n = 200) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** Evidence quote for a findings.json join — every word COPIED from the finding/action records. */
function findingEvidence(f, actions) {
  const head = `finding #${f.ordinal}: ${f.mark} — ${[f.disposition, f.band].filter(Boolean).join(" / ") || "recorded"}`;
  const reason = f.withdrawn_reason ? ` — ${f.withdrawn_reason}` : "";
  const acts = (actions ?? []).filter((a) => Array.isArray(a?.ordinals) && a.ordinals.includes(f.ordinal))
    .map((a) => ` — action: "${clip(a.text)}"`).join("");
  return `${head}${reason}${acts}`;
}

/** Lines from register-findings.md that sit under an answer/watchlist heading. PURE. */
function answerWatchlistLines(registerFindingsText) {
  const out = [];
  let inSection = false;
  for (const line of String(registerFindingsText ?? "").split("\n")) {
    const h = line.match(/^#{1,4}\s+(.*)/);
    if (h) { inSection = /answer|watchlist/i.test(h[1]); continue; }
    if (!inSection) continue;
    const t = line.trim();
    if (t && !/^\|[\s:|-]+\|$/.test(t)) out.push(t);      // skip table separator rows, keep everything else
  }
  return out;
}

/** EVERY content line of register-findings.md (any section) — the two-token path's wider surface.
 *  Widening past the answer/watchlist sections is safe ONLY because that path demands two independent
 *  co-matching signals; the distinctive single-token join keeps the narrow section list above. PURE. */
function allContentLines(registerFindingsText) {
  const out = [];
  for (const line of String(registerFindingsText ?? "").split("\n")) {
    const t = line.trim();
    if (t && !/^\|[\s:|-]+\|$/.test(t)) out.push(t);
  }
  return out;
}

/**
 * Stitch each doubt to an existing resolution. Returns a NEW array of doubt records; a verified join
 * ⇒ status "checked-and-settled" + ending {by:"code-stitch", evidence:{file, quote}}; no join ⇒ the
 * record passes through "open" and unchanged. `findings` = findings.json content ({findings, actions})
 * or a bare findings array; `coverageRows` = coverage-ledger rows [{axis, scope, status, reason, unit?}];
 * `registerFindingsText` = register-findings.md prose. PURE.
 */
// ── the provenance rule: a doubt may not be answered by the file that raised it ────────────────────
//
// A doubt is minted BECAUSE some artifact said something the run could not otherwise account for, and
// `birth.artifact` names that artifact. Quoting it back is not evidence — it is the question restated.
//
// This was not hypothetical. `mintPresenceDoubts` parses the digest's rated rows OUT of
// register-findings.md and mints a doubt for every row the DELIVERED set does not account for; that
// file is also one of the three CLOSURE_EVIDENCE_FILES. So every presence doubt was minted from a row
// that is, by construction, still sitting in the haystack the stitch then searches — and step 3b below
// matches ANY content line on two tokens. A presence doubt could therefore never ship OPEN. Measured on
// the delivered run `674db9c7`: its one presence doubt was settled `code-stitch` against
// register-findings.md, quoting "- Instructed scope: classes **5, 42, 44**…" — the digest's own scope
// header, which says nothing whatever about the record in doubt.
//
// The rule is PROVENANCE, not file identity, and that distinction is the whole design. A file-identity
// rule ("only findings.json may settle anything") would break the sanctioned path stages.mjs already
// dictates — a presence doubt MAY be settled "by citing a DELIVERED crowd/coverage disclosure" — and
// register-coverage-ledger.json is no more present in the delivered pool than register-findings.md is.
// Delivered-ness is about whether the QUOTED PASSAGE reaches the reader; circularity is about whether
// the evidence is independent of the question. Only the second is decidable here, so only the second is
// enforced here.
//
// Enumerated across every mint site the day this landed, exactly ONE family is bound by it: presence
// (`register-findings.md`). record-carry is born of register-named-band.json, placement-carry of
// placements.json, commonlaw-carry of common-law-grid.json, audit-contradiction of audit.md,
// gather-crosscheck of the search files, remedy-accounting of _driver/frame-reopen.json — none citable,
// so none changes behaviour. It is written as the general rule anyway: the next family minted out of a
// citable file inherits the guard instead of re-discovering the defect.
const baseName = (s) => String(s ?? "").trim().split(/[\\/]/).pop().toLowerCase();

/** True when `file` is the very artifact this doubt was minted out of. PURE. */
export function citesOwnSource(doubt, file) {
  const born = baseName(doubt?.birth?.artifact);
  const cited = baseName(file);
  return Boolean(born) && born === cited;
}

export function stitchDoubts(doubts, { findings = null, coverageRows = null, registerFindingsText = "" } = {}) {
  const findingRecs = Array.isArray(findings) ? findings : (findings?.findings ?? []);
  const actions = Array.isArray(findings) ? [] : (findings?.actions ?? []);
  const rows = Array.isArray(coverageRows) ? coverageRows : [];
  const rfLines = answerWatchlistLines(registerFindingsText);
  const rfAllLines = allContentLines(registerFindingsText);

  return (doubts ?? []).map((d) => {
    // Returns null on the doubt's own birth artifact, so each branch below falls through to the next
    // join instead of ending the doubt. Wrapping the CONSTRUCTOR rather than guarding each call site is
    // deliberate: a branch added later cannot forget the rule, because there is no way to build an
    // ending without passing through here.
    const settle = (file, quote) => (citesOwnSource(d, file) ? null : {
      ...d, status: "checked-and-settled",
      ending: { by: "code-stitch", evidence: { file, quote } },
    });
    const sig = shortJoinSignals(d?.subject);

    // 1. findings.json — the run's own recorded judgment is the strongest ending a doubt can have.
    const f = findingJoinFor(d?.subject, findingRecs);
    if (f) {
      const s = settle("findings.json", findingEvidence(f, actions));
      if (s) return s;
    }

    // 2. a coverage-ledger row NAMING the doubt's term (row scope in the doubt's text, or a doubt
    //    term in the row) — an exact-token match either way, floor-guarded on the matching name; a
    //    below-floor mark joins a row only under the two-token rule (mark + owner/class in the row).
    const subjText = [d?.subject?.mark, d?.subject?.text, ...(d?.subject?.terms ?? [])].filter(Boolean).join(" ");
    for (const r of rows) {
      const rowText = [r?.unit, r?.axis, r?.scope, r?.reason].filter(Boolean).join(" ");
      const scopeN = norm(r?.scope);
      const named = (distinct(scopeN) && hasToken(subjText, scopeN))
        || (d?.subject?.terms ?? []).some((t) => distinct(norm(t)) && hasToken(rowText, t))
        || twoTokenMatch(sig, rowText);
      if (named) {
        const s = settle("register-coverage-ledger.json",
          `${r.unit ?? [r.axis, r.scope].filter(Boolean).join(" / ")} — ${r.status}${r.reason ? ` — ${clip(r.reason)}` : ""}`);
        if (s) return s;
      }
    }

    // 3. a register-findings.md answer/watchlist line carrying the doubt's mark token verbatim
    //    (distinctive marks keep exactly this: single-token, floor-guarded, answer/watchlist only).
    for (const line of rfLines) {
      if ((d?.subject?.terms ?? []).some((t) => distinct(norm(t)) && hasToken(line, t))) {
        const s = settle("register-findings.md", clip(line));
        if (s) return s;
        break;                                   // same file for every line — one refusal settles the branch
      }
    }

    // 3b. the short-mark two-token path over ANY register-findings line: answers routinely live
    //     outside the answer/watchlist sections, and the wider surface is safe ONLY because two
    //     independent signals (short mark + owner/class) must co-name the same line.
    for (const line of rfAllLines) {
      if (twoTokenMatch(sig, line)) {
        const s = settle("register-findings.md", clip(line));
        if (s) return s;
        break;                                   // as above — the branch cannot succeed for this doubt
      }
    }

    // no ending found — the doubt ships OPEN. That is disclosure, not failure: nothing loops here.
    return { ...d, status: "open", ending: null };
  });
}

// ── the doubt-closure stage contract (settle-by-citation, 2026-07-22 T2c) ─────────────────────────
// After the stitch, a bounded sonnet pass may point each still-OPEN doubt at evidence that ALREADY
// exists on disk — one dictated line per doubt, parsed strictly here (a malformed line is treated as
// ABSENT: its doubt simply stays open; carrying sloppy output is the dictation's job at the source,
// same law as CROSS_CHECK_RE). The stage never writes analysis and never decides anything: code
// re-verifies every quoted citation VERBATIM (applyClosure) — the model can only point, never settle.
//
//   SETTLED <id>: <file>: "<verbatim quote ≤200 chars>" — <one-line reason>
//   OPEN <id>: <one-line why no on-disk evidence answers it>
const SETTLED_LINE_RE = /^(?:[-*]\s+)?SETTLED\s+(\S+):\s*(\S+?):\s*"(.{1,300}?)"\s*—\s*(.+?)\s*$/;
const OPEN_LINE_RE = /^(?:[-*]\s+)?OPEN\s+(\S+):\s*(.+?)\s*$/;

/** Parse the stage's dictated output → [{verdict, id, file?, quote?, reason}]. Non-matching lines
 *  parse to NOTHING (absent ⇒ the doubt stays open) — strict on purpose, like CROSS_CHECK_RE. PURE. */
export function parseClosureLines(text) {
  const out = [];
  for (const rawLine of String(text ?? "").split("\n")) {
    const line = rawLine.trim();
    let m = line.match(SETTLED_LINE_RE);
    if (m) { out.push({ verdict: "SETTLED", id: m[1], file: m[2], quote: m[3], reason: m[4] }); continue; }
    m = line.match(OPEN_LINE_RE);
    if (m) out.push({ verdict: "OPEN", id: m[1], reason: m[2] });
  }
  return out;
}

// EXPORTED so the typed closure transport verifies with THE SAME predicate applyClosure settles with.
// Two copies of "does this quote appear verbatim" would diverge on the first change to either, and the
// divergence would look like a seat citing badly rather than like two normalizers disagreeing.
//
// ── — THE ESCAPE STEP, AND WHY IT IS BOTH SIDES ────────────────────────────────────────────────
//
// Two of the three files this stage may cite are JSON: findings.json and register-coverage-ledger.json
// (pipeline.mjs, the doubt-closure `fileTexts` block). The comparison is against those files' RAW TEXT,
// so a findings value rendered on disk as
//
//     "net": "The mark \"VENTURI\" is registered in CH"
//
// verified only if the seat's quote also carried the backslashes. `The mark "VENTURI" is registered in
// CH` — the sentence a reader would call the quote — did not match, and the doubt shipped OPEN into
// `unverified`. Safe direction, but it reads as the model citing badly rather than as a normalizer
// missing a step, and the stage exists precisely because most stitch-open doubts have an on-disk answer.
//
// The sibling site already had it: contract-audit.mjs's `normalizeQuote` unescapes before collapsing
// whitespace, asking the identical question one corpus over. verify.mjs is the second precedent, from
// the other direction — it accepts both forms explicitly, because "the JSON-escaped rendering IS the
// verbatim the model saw".
//
// BOTH SIDES, and that is load-bearing rather than tidy. Every call site squashes the haystack and the
// needle through this one function, so the widening is symmetric: a seat quoting the escaped bytes and a
// seat quoting the logical value both verify against either rendering. Unescaping the QUOTE alone would
// let `\"` in a seat's quote match a plain `"` in the file without the reverse — a widening in one
// direction with no reason behind it.
export const squash = (s) => String(s ?? "").replace(/\\"/g, '"').replace(/\s+/g, " ").trim();

/**
 * The anti-confabulation guard (non-negotiable): apply the stage's parsed lines to the stitched
 * doubts. `fileTexts` = {"<file name as cited>": content} for ONLY the files the stage was allowed to
 * cite — a citation of any other file can never verify. A SETTLED line settles its doubt IFF the
 * doubt is still open AND the quote appears VERBATIM (whitespace-normalized, nothing else) in the
 * named file; anything short of that leaves the doubt OPEN and lands in `unverified` (LOUD — the
 * call site logs each one; a silently-dropped fabricated citation would be the defect this guard
 * exists to kill). An OPEN line changes nothing — it is the model agreeing with the ledger. Returns
 * { doubts, settledByStage, unverified } and never mutates its input. PURE.
 *
 * IT ALSO ENFORCES THE PROVENANCE RULE, and this half is what makes the stitch half worth anything.
 * The stitch runs FIRST and the seat runs after it, over whatever the stitch left open — so refusing a
 * circular ending in the stitch alone would not remove it, it would just hand the same doubt to a model
 * that can end it the same way one stage later. Refused here, the doubt ships OPEN, which is the
 * disclosure the whole family exists to produce. The refusal is recorded in `unverified` with a `why`,
 * so the run log distinguishes it from an invented quote — two different seat errors that would
 * otherwise read identically to anyone reading the events.
 */
/**
 * The birth place of the presence-or-reason family. Defined HERE, in the module that imports nothing, and
 * imported by presence-reconciliation.mjs — a family this file's closure rule turns on cannot be named by
 * a string literal at each end, because the two ends would then be free to drift apart silently.
 */
export const PRESENCE_BIRTH_PLACE = "presence-reconciliation";

export function applyClosure(doubts, closureLines, fileTexts = {}) {
  const settledById = new Map();
  for (const l of closureLines ?? []) if (l?.verdict === "SETTLED" && !settledById.has(l.id)) settledById.set(l.id, l);
  const unverified = [];
  let settledByStage = 0;
  const out = (doubts ?? []).map((d) => {
    if (d?.status !== "open") return d;                       // the stage may never touch a settled doubt
    const l = settledById.get(d.id);
    if (!l) return d;                                         // OPEN verdict / no line / malformed ⇒ stays open
    if (citesOwnSource(d, l.file)) {                          // the question restated is not an answer
      unverified.push({ id: d.id, file: l.file, quote: l.quote, why: "cites the doubt's own birth artifact" });
      return d;
    }
    //, owner-ruled: A PRESENCE DOUBT CLOSES ONLY ON A DELIVERED FINDING — A NOTE ALONE DOES NOT.
    //
    // Placed AFTER citesOwnSource on purpose. Ahead of it, a circular citation on a presence doubt would
    // be refused for the family rather than for the circularity, and the arm that proves the circularity
    // guard still works would go on passing while testing nothing.
    //
    // AND THE DELIVERED SET IS ALREADY CHECKED — TWICE — BEFORE ANY DOUBT GETS HERE, which is why this
    // needs no findings lookup of its own and takes no findings argument:
    //
    //   mintPresenceDoubts   skips every row whose uri is in the delivered set, and every row that
    //                        findingJoinFor()s a delivered finding. A presence doubt therefore EXISTS
    //                        only for a record that is not delivered.
    //   stitchDoubts         settles on a findings.json join before this stage runs at all.
    //
    // and the set cannot move in between. CITED BY SYMBOL, not by line, because this paragraph outlives
    // any line number in a 12,000-line file — including the ones the change carrying it shifted:
    //   · pipeline.mjs parses P.findings into `auditRunFindings` and hands it straight to
    //     mintPresenceDoubts, in the same try block.
    //   · the doubt-closure stage re-reads P.findings into `fileTexts["findings.json"]` and calls
    //     applyClosure on the next statement.
    //   · every `atomicWrite(P.findings, …)` in that file sits ABOVE both — grep it and check, the count
    //     is what matters and not where they are.
    // Same bytes at both ends. So "settles only on a delivered finding" resolves, at THIS site, to "no
    // quote settles it" — the doubt stays open and is reported open.
    //
    // IF THAT ORDERING EVER CHANGES — a findings write between the mint and this stage — then a presence
    // doubt could legitimately become deliverable late, and this rule would need the delivered set passed
    // in rather than inferred from the invariant above. Read this paragraph before moving either seam.
    if (d?.birth?.place === PRESENCE_BIRTH_PLACE) {
      unverified.push({ id: d.id, file: l.file, quote: l.quote,
        why: "a presence doubt closes only on a delivered finding; a note does not settle it" });
      return d;
    }
    const hay = squash(fileTexts?.[l.file]);
    const q = squash(l.quote);
    if (q && hay && hay.includes(q)) {
      settledByStage++;
      return { ...d, status: "checked-and-settled",
        ending: { by: "doubt-closure-stage", evidence: { file: l.file, quote: l.quote }, reason: l.reason } };
    }
    unverified.push({ id: d.id, file: l.file, quote: l.quote });
    return d;
  });
  return { doubts: out, settledByStage, unverified };
}
