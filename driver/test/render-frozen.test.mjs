// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// driver/publish/render.mjs is FROZEN.
//
// It produces every clearance report Cordillera has ever delivered. The portal rebuild
// does not touch it: legacy runs are served as baked bytes and embedded in a null-origin iframe, and new
// runs render component-native from report-data.json. Nothing in the portal imports it, ever.
//
// The freeze starts AFTER the 2026-07-19 ramp recolor (the quadrant panel hardcodes band hexes because it
// stays a fixed light surface in dark mode, so the recolor had to reach in once). This test pins the
// result of that commit.
//
// ── If this test fails ──────────────────────────────────────────────────────────────────────────────
// You changed render.mjs. That is not automatically wrong, but it is a decision, not a detail:
//
//   1. Is the change reachable from a REPUBLISH? pool-admin's doRepublish() re-renders any archived run,
//      so a change here silently rewrites reports already delivered to clients. Check that first.
//   2. Could it live in report.css or brand.mjs instead? Those are not frozen, and almost every visual
//      change belongs there.
//   3. If it genuinely must land here, update the hash below IN THE SAME COMMIT and say in the commit
//      message why the renderer had to move. Do not update the hash in a follow-up "fix the test" commit —
//      that is how a freeze becomes a formality.
//
// The hash is over the file's exact bytes. Whitespace and comments count; that is deliberate.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
// The header strings come from the sweep script that WRITES them (#854). Spelled out here as literals,
// this test had its own copy of the identifier and the AGPL flip made that copy wrong — the filter
// matched nothing, the "header is present exactly once" assertion failed, and the message pointed at
// the freeze rather than at the licence. Importing them means the break still fires where it should,
// on the content hash below, which is the assertion that is supposed to demand a human decision.
import { SPDX, COPYRIGHT } from "../../scripts/spdx-headers.mjs";
import { inDispositionMode, DISPOSITION_BAND } from "../findings-model.mjs";   // #1100

const at = (p) => fileURLToPath(new URL(p, import.meta.url));
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

// sha256 of driver/publish/render.mjs, as of the deployment-hostname commit (2026-07-19).
//
// Second break of the freeze, and it answers the checklist above: the change IS reachable from a republish,
// and that is the point. The frozen bytes contained `process.env.CLEAROTRON_MCP_URL || 'https://mcp.example.com/mcp'`,
// so every internal report — including any archived run re-rendered later — carried an "Ask your AI"
// connector pointing at a host that does not exist. It could NOT live in report.css or brand.mjs: it is the
// connector URL, not a visual. On a configured deployment a republish now emits the real host instead of the
// dead one, which is a repair of already-delivered reports rather than a rewrite of their substance.
// Third break (2026-07-20, spec-61 R1 — the MCP client view).
//
// Pure code MOTION, no behaviour: stripEngineInternals + ENGINE_INTERNAL_RE + TELEMETRY_RE moved out to
// publish/parse.mjs (beside stripInternal, their sibling rule) and are now imported back. Nothing else in
// the file changed.
//
// Answering the checklist honestly: the change IS reachable from a republish, so it was verified the only
// way that claim is worth anything — by rendering a real run (noref000001-venzy) through BOTH the frozen
// and the refactored module, in BOTH modes, and byte-comparing. Internal and client HTML were identical
// (sha a2f0a789bc05…; client 162492 bytes both sides). The client pass matters most: stripEngineInternals
// only fires on the CLIENT branch, so an internal-only comparison would have exercised none of the moved
// code and proved nothing.
//
// Why it could not live elsewhere: it is not a visual, so report.css/brand.mjs were not options. The MCP
// client surface needs the SAME client-safety rules (spec-61 R1: read_artifact served the internal cut of
// report.md), and the leak being fixed was itself caused by "what may a client see?" being answered twice
// and drifting. Leaving a second copy in the renderer to keep the freeze intact would have rebuilt the bug
// this commit exists to close. One definition, two callers — the renderer and mcp-server/lib/scrub.mjs.
// Fourth break (2026-07-22, the MCP client EVIDENCE layer) — the same move as the third, for the same
// reason, on the last client-safety transform still living here.
//
// Pure code MOTION, no behaviour: ENGINE_PLAIN + plainify moved out to publish/parse.mjs (beside
// stripInternal / stripEngineInternals / stripTelemetry, their siblings) and are imported back. The only
// other edit in the file is the import line. The moved block is byte-identical to the deleted one apart
// from the `export` keyword — asserted below, so this claim is checked by CI rather than trusted.
//
// Answering the checklist honestly: the change IS reachable from a republish. plainify is a pure
// string→string function and render.mjs's every use of it is a call, so a byte-identical definition gives
// byte-identical output; the assertion below pins that identity permanently, which is a stronger guarantee
// than a one-off render comparison (it cannot drift after this commit).
//
// Why it could not live elsewhere: it is not a visual, so report.css/brand.mjs were not options. The MCP
// client evidence surface (mcp-server/lib/evidence.mjs) serves the SAME findings.json coverage[] notes
// that coverageGrid renders through plainify — the client report and the connector must plainify them
// identically or the connector becomes a less-scrubbed copy of the PDF. One definition, two callers.
//
// Fifth break (2026-07-22, spec-66 — the 404-card caveat), merged with the fourth: the hash below is
// over the file carrying BOTH changes.
//
// One guarded line: a finding whose cited register record the V4-2 closure fetch DEFINITIVELY could
// not retrieve (`f._recordFetchFailure`, stamped by joinEvidenceStatus from the persisted failure
// list) gets one deterministic code-owned caveat on its card — "Official register record could not
// be retrieved — registry details in this card are unverified." A delivered ION card had claimed
// "verified directly from the record" over a record whose fetch 404'd; the freeze's own checklist
// answers: (1) the change IS reachable from a republish, and that is the point — an archived run
// whose lint receipt records a fetch failure gains the caveat it always deserved, the same
// repair-of-delivered-reports class as the second break; runs with no stamped failure render
// byte-identically by construction (the new line is '' in both the guard and the interpolation —
// verified by the data-driven render tests). (2) It could not live in report.css/brand.mjs: it is
// card content carrying an evidentiary status, not a visual. (3) Hash updated with this rationale.
// Sixth break (2026-07-28) — COMMENT-ONLY, and the weakest reason yet to touch this file, so it is
// stated plainly rather than dressed up. Two comments cited real client runs by codename as shorthand for
// the defect each guards against. The repo-wide de-identification took the identifiers out; the evidence
// each comment carries is unchanged, only the name is.
//
// The checklist, answered: (1) NOT reachable from a republish — every changed line is a comment, verified
// by diffing with non-comment lines filtered out (zero), so the rendered bytes are identical by
// construction rather than by measurement. (2) It could not live in report.css/brand.mjs — a comment
// belongs in the file it explains. (3) Hash updated here, in the same commit as the edit.
// Seventh break (2026-07-28) — the report says WHICH READ it is. The hero confidentiality line now reads
// "Depth 4 — Preliminary Clearance" when the run's frozen policy sidecar names a stage, from opts.stageLabel.
//
// This closes the rule that a report's title, banner and subject derive from the REGISTRY entry, which
// was honoured in meta.json and in the portal list and nowhere inside either renderer. A
// reader holding the document could not tell a Depth 4 from a Depth 5 or a register-only read, and the
// knockout lane's rebuild made the gap conspicuous: that report names its level and this one did not.
//
// The checklist, answered: (1) REACHABLE from a republish, and intended — an archived run gains the stage
// it was always run under. A run with NO policy sidecar (every run older than the level registry) yields
// undefined and renders BYTE-IDENTICALLY: proved by rendering a real archived clearance through the old
// and new modules across the plain, client and privileged variants and comparing bytes, the same method as
// the third through fifth breaks. (2) It could not live in report.css/brand.mjs — it is document content
// stating what the run was, not a visual. (3) Hash updated here, in the same commit as the edit.
//
// The freeze is the reason this was caught at all: a comment sweep is exactly the "detail" that would
// otherwise have walked through a frozen renderer unnoticed. Worth saying, since a break this trivial is
// the kind that turns a freeze into a formality.
//
// Same break, second edit (one commit later on the same branch): a third comment named a client mark
// as shorthand for the wide-card example. Identical answers — comment-only (non-comment lines changed:
// zero), belongs in this file, hash moved with the edit rather than after it.
//
//
// Eighth break (2026-07-28) — the worldwide claim stops being read out of model prose.
//
// Three lines: a module-level `SCOPE_WORLDWIDE`, its binding from `opts.scopeBasis`, and
// `jurisdictionCodes` seeding `worldwide` from it instead of starting at `false`. Everything else —
// the ledger-prose sniff, the chips, the two disclosures, the forced WO — is untouched.
//
// Why it had to be here: "did this sweep run worldwide?" was answered by regexing the word out of the
// coverage ledger's MODEL-WRITTEN rows, so the disclosure appeared only if a model happened to write
// it. That was survivable while the only register provider expressed worldwide as an ABSENT region
// clause. It stops being survivable now that a regions-required provider (clarivate) compiles a
// worldwide matter to the vendor's full 186-office list: by shape, "everywhere" and "these 186
// territories" are the same array, and only the plan's `scope_basis` can tell them apart. Prose is not
// a place to keep a scope fact.
//
// Answering the checklist honestly:
//   1. Reachable from a republish — YES, and the answer is that it changes NOTHING there. Publish
//      supplies `scopeBasis` only from a plan carrying `scope_basis`, which no archived run has, so
//      `SCOPE_WORLDWIDE` is null and the prose sniff decides exactly as before. Verified the way the
//      third break was, not by assertion: all 9 archived runs under workspace-clawdi (2026-06 and
//      2026-07 archives + the live run) re-rendered through BOTH the frozen and the modified module,
//      in BOTH modes — 18 renders, sha256-identical on every pair.
//   2. Could it live in report.css / brand.mjs — no. It is a factual claim about search scope, not a
//      visual, and its source is a machine artifact the renderer already receives opts from.
//   3. Hash updated in this commit, with this rationale.
// Fifth break (2026-07-29, PR-11 — the report-voice sweep reaches the renderer's own copy).
//
// One string: the "Notable but manageable" section note read "coexistence or a clean distinction is the
// realistic path" — advice voice, retired product-wide (#132 swept every model surface; this was the
// one advice phrase living in frozen code). It now reads "documented
// coexistence or clear distinction on the record" — a statement of what the section's records show, not
// a recommended course.
//
// Answering the checklist: the change IS reachable from a republish, and deliberately so — same shape as
// the second break: a re-rendered archived run gets the retired advice phrase repaired to the factual
// note, a repair of voice, never of substance (no band, no card, no fact moves). It could not live in
// report.css/brand.mjs: it is copy, not styling.
//
//   3. Hash updated in this commit, with this rationale.
//
// Ninth break (2026-07-30, one report — the CLIENT flag retired).
//
// The report exists in ONE version now (spec 2026-07-30 §5). The module-level CLIENT
// audience flag and every branch it forked (~20 sites: stripInternal mode, cov-read/origins gating,
// case-law body, risk chips, capture controls, the connector-URL choice, theme/nav/footer variants) are
// deleted; what remains is exactly the old internal path. Serve-time preparation for a client reader
// (nav/staff-chrome strip, Ask-your-AI + connector-token removal) lives in portal-report.mjs, one place.
//
// Answering the checklist honestly:
//   1. Reachable from a republish — YES, and the answer is that the surviving document does not move:
//      the internal render collapses branch-for-branch onto its old bytes. Verified the way the third
//      and eighth breaks were, not by assertion: the same parsed inputs rendered through the frozen
//      module (origin/main) and this one — a rich framework/verdict/case-law/senior-rights render and
//      a legacy minimal render, each with and without findings — four pairs, byte-identical on every
//      pair. What a republish CHANGES is that no report.client.html is produced any more, which is the
//      point of the commit, not a side effect.
//   2. Could it live in report.css / brand.mjs — no. It is the deletion of a render fork, not a visual.
//   3. Hash updated in this commit, with this rationale.
//
//
// Tenth break (2026-07-30, P4 — REPORT-PROSE-SPEC-2026-07-30 §3+§4, charter ruling 1). The one break the
// spec itself schedules ("Steps 3 and 5 both break it — follow the checklist … update the hash in the
// same commit"). What moved, all of it reader-facing substance that cannot live in report.css:
//   • B1 — the "Subject to:" bound line is DELETED (a third copy of the verdict's conditions, cut
//     mid-sentence, linking into a sandboxed frame where fragment jumps go nowhere). boundLineHtml and
//     its hero emission are gone; actYouConditions STAYS (the email composer still builds from it).
//   • B3 — the per-card provenance hedges stop being stamped: the enforcer-inferred tail ("; not
//     verified against a fetched record" — 10 stampings on the measured delivered run), the wp50/wi7
//     coherence line, and the per-leg "— full record not pulled this run" clause. Record provenance is
//     stated ONCE, code-owned, at the top of Scope. Never-invent is untouched: an unfetched leg still
//     renders no field as if confirmed, and the 404 / senior-right open-item lines (specific facts,
//     not blanket hedges) stay.
//   • §3 spine — in DISPOSITION mode, 03 Notable but manageable ABSORBS 04 Commercial awareness
//     (fold-lead + cards) and the famous-mark notes (fold-lead + list, out of Scope); common-law
//     renumbers up. LEGACY (composite) runs keep the prior layout byte-for-byte — the restructure is
//     gated on DISPOSITION_MODE exactly like banding itself.
//   • Mark itself — markAssessmentBlock renders the STRUCTURED form natively: the one-sentence `read`
//     leads, typed rows collapse behind two toggles (counter_registrations kept, collapsed — spec §10).
//     Legacy two-string runs (8 of 11 archived) render byte-identically; publish stops projecting the
//     object to a wall paragraph on the render path.
//   • Charter ruling 1 — opts.depthNote renders as a masthead depth strip naming what the depth
//     covers/omits (from the run's frozen policy components via search-policy productCoverageNote),
//     NAME-LED per the ruling: the strip bolds the product's registry name (the same name #158's
//     read pills speak) ahead of the coverage clauses, splitting on the LAST " — " seam because a
//     registry name may itself carry one ("Preliminary clearance — register only").
//     Absent (every archived run without a sidecar) ⇒ byte-identical.
//   • §L — the ruled-out FALLBACK heuristic now treats a token that contains the other mark's token
//     (≥4 chars) as sharing a word, so a same-element register mark (FREEZEIV on the measured run) can
//     no longer be silently routed off the conflict-landscape chart. Explicit ruled_out is untouched.
//   • Hardening: history.replaceState in the card-anchor handler is try/caught (it throws in the
//     portal's null-origin sandbox and killed the rest of the handler).
//   • Rebase over the ninth break (one report): the mark-itself header comment kept the ninth break's
//     "on THE report" wording and dropped the retired report.client.html clause, so this tenth hash is
//     measured on the merged bytes — the CLIENT fork is gone underneath it, not re-introduced by it.
//   • Post-review repair, same break, same commit (2026-07-31): B3's provenance paragraph was gated on
//     hasRecordSet, but the labels it exists to explain are NOT. "(register-index entry)" renders from
//     the registration render's second disjunct with no record set, and the enforcer "inferred —
//     reputation/profile signal" basis line is ungated entirely — so on a no-record-set run the reader
//     got both labels and no explanation, having just lost the per-leg wording that used to explain
//     itself. scopeSection now takes a second flag (are there cards at all — deliberately NOT a copy of
//     the two label conditions, which is a thing that drifts) and the fetched-records SENTENCE alone
//     stays conditional on hasRecordSet. A run WITH a record set composes the identical string, so every
//     archived run (all nine carry _records) re-publishes byte-identically; only the branch B3 got
//     backwards changes, which is the branch this repairs.
// The checklist, answered: (1) REACHABLE from a republish and intended for the hedge/duplicate
// deletions (the same repair-of-delivered-reports class as the second and PR-11 breaks); the spine
// and mark-itself changes are disposition/structured-form gated, and legacy runs were verified by
// re-rendering an archived legacy run through both modules. (2) The moved material is document
// content and structure, not styling — the styling half of this change DID go to report.css
// (.depth-strip, .ma-more, .fold-lead) and shared/brand.mjs (--ma-toggle dark token). (3) Hash
// updated here, in the same commit, with this rationale.
//
// Break of 2026-07-31 (P5 — charter "content model: ratings & categories", Reviewer §L + Round-2 §4).
// The renderer learns to CONSUME the P5 content-model fields; every addition is gated on the new
// fields being present, so an archived run (no legal_position/practical_position, no manageable,
// no four_answers) renders byte-identically. What moved:
//   • legal/practical split — a rated finding carrying legal_position / practical_position renders
//     the two labelled reads (lp-split) on full AND compact cards: the legal read and the practical
//     read stated apart, never averaged (Reviewer's ruling; the fields are typed in findings.json).
//   • manageable category — a notable-but-manageable finding carrying manageable {category, reason}
//     renders WHY it is manageable (large competitor / commercial partner / troll / well-known
//     enforcer + the stated reason) on its card.
//   • the four answers — opts.fourAnswers renders a hero panel (fourAnswersPanel) decomposing the
//     verdict into its four questions (third-party rights / objection likelihood / registrability /
//     own enforceability), tokens + reads + basis from findings.json four_answers. No new spine
//     section heading (headings are ruled); the panel lives inside the hero. It renders reads
//     verbatim and never composes a verdict sentence — riskStatement() stays the one assembler.
// The checklist, answered: (1) REACHABLE from a republish and intended — a republished archived run
// gains no CONTENT (every branch is field-gated); a republished FRESH run renders its own recorded
// content model, the same repair-of-substance class as the P4 break. (2) The styling half went to
// report.css (.lp-split, .fourans — not frozen); the markup emission cannot live there. (3) Hash
// updated here, in the same commit, with this rationale.
//
// WHAT "byte-identically" MEANS HERE, stated precisely because the first cut of this rationale
// overclaimed it (review 2026-07-31, problem 8). The whole PAGE is not byte-identical: it carries the
// new report.css rules in its inlined <style> block, and report.css is correctly not frozen. The page
// BODY is — measured, on a verbatim sha-verified copy of a real July-2026 archived clearance, the
// rendered output with the <style> block dropped is byte-identical to the pre-P5 render (132,169 bytes
// both sides). The first cut was NOT: each empty ${lpSplit}/${manageableLine}/${fourAnswersPanel} sat
// on its own source line and left a whitespace-only line behind (+156 bytes on that run). Those
// expressions are now attached to the preceding element, so an absent content model emits exactly zero
// bytes. Two tests hold the line (render.test.mjs, "an archived-shape run … leaves no residue"): no P5
// markup on an archived-shape run, and the P5 additions move no other byte. The prior rationale cited
// "the existing archived-fixture tests" as proof of byte identity — those tests assert section
// membership and absence, never bytes, so that citation was wrong and is withdrawn.
//
// Same break, second edit (review round, same branch): the P5 free-prose fields now render through
// inline() — the ONE client-scrub choke point (stripInternal → plainify → esc → link safety) — instead
// of bare esc(). They are model-authored strings that carry ::p:: staff asides exactly like prose
// does, and the first cut shipped those asides verbatim to the client while report-data.json scrubbed
// the same bytes; two client surfaces, two answers. Reachable from a republish and intended: a
// republished run with a staff tail in legal_position / practical_position / manageable.reason /
// four_answers.read / .basis / obstacles[].note now loses it on the client cut and keeps it, relabelled
// [internal] and print-classed, on the internal one. It could not live in report.css — it is a
// safety transform, not a visual, and the transform itself lives in parse.mjs (one definition).
//
// REBASED onto the tenth break (2026-07-31). This package was built on P4's PRE-squash branch, so both
// hashes it carried were measured over renderer bytes that never reached main. The rationale above is
// EXTENDED, not replaced: the tenth break's entry (P4 — the spine, the mark-itself structured form, the
// depth strip, the provenance repair) stands unchanged directly above P5's, and the hash below is
// re-measured over the MERGED bytes — P4's landed renderer plus P5's field-gated additions plus the
// inline() routing. The byte-identity claim was re-measured on the merged file rather than carried
// over: the archived-shape residue tests below run against these bytes, not the pre-rebase ones.
// ELEVENTH BREAK (item 9a/9b, 2026-08-01) — the one-clause net becomes a TYPED FIELD and the card
// renders from it. Two changes, both narrow:
//   · `const one = foldClause(f.net) || (card?.meta?.one) || oneFallback(f, who)` — the typed record
//     wins over the `- one:` line parsed out of card markdown, which is the entire point of typing it:
//     the card and the MCP brief were separately authoring their own version of one sentence, and two
//     surfaces summarising one finding is how they come to disagree about it. `card.meta.one` stays as
//     the fallback, so an archived run — which has no `net` on its findings — renders byte-identically.
//   · `foldClause` — the LENGTH BUDGET, enforced HERE and deliberately not in the prompt. A model told
//     to be brief writes a shorter sentence and drops a fact; a renderer folding a long one loses
//     nothing the reader wanted, because the full reasoning is in the card body directly below it. It
//     folds at a sentence end inside the budget, else at a word boundary, and marks the fold — never a
//     mid-word cut.
// Byte-identity on archived shapes is held by the same two residue tests below: with `net` absent
// foldClause returns '' and the expression falls through to exactly the previous value.
// TWELFTH BREAK (#242, 2026-08-03) — reasoned negatives render as a GROUP, on a v6 record only.
//
// The change: a `NEGATIVES_GROUPED` module flag bound from `opts.findingsSchemaVersion`, a
// `reasonedNegatives` / `negativeLine` pair beside secondaryRegions, and one branch at the
// "Notable but manageable" section that chooses between them. Nothing else in the file moves.
//
// WHY IT HAD TO LAND HERE. secondaryRegions groups negatives by JURISDICTION, which is the one thing
// about a cleared mark a reader does not need repeated: eight cards under four region headings re-derive
// the same clearing argument eight times. #242 asks for the shared ground stated ONCE in the group
// heading and one line per member carrying only what is its own. That is document structure, so
// report.css/brand.mjs were not options — the new CSS (`.rn*`) did go there, where it belongs.
//
// The checklist, answered:
//   (1) REACHABLE from a republish — and gated so that it is not. The grouped form fires only when the
//       caller threads a declared schema_version >= 6, which no archived findings.json carries and no
//       existing caller supplied. The gate is fail-CLOSED: absent, null, stale or unparseable renders the
//       pre-#242 section. MEASURED, not claimed, by the method of the third, fifth and seventh breaks —
//       the same inputs rendered through the pre-change and post-change modules and byte-compared:
//         legacy/composite  internal + client  103867b  sha256 2386c469d88a8b87…  IDENTICAL
//         v5 disposition-mode, including a POSITIONLESS off-field finding (the exact 08-02 archive shape
//         this issue exists to close)  internal + client  106344b  sha256 edb9ff57a8acd0fe…  IDENTICAL
//       with a v6 positive control confirming the new section does render, so the identity above is not
//       the trivial result of dead code. The residue tests in render.test.mjs pin it permanently.
//   (2) It could not live in report.css/brand.mjs — see above; the visual half did.
//   (3) Hash updated here, in the same commit as the edit.
// (#314, 2026-08-03 — UNNUMBERED. It changed negativeLine's reason fallback to
// `foldClause(f.net) || foldClause(f.legal_position)` and bumped the hash without adding an entry
// here. Recorded so the sequence below is not read as covering a file it predates.)
// THIRTEENTH BREAK (#243, 2026-08-03) — compactCard reads the typed net, which the ELEVENTH BREAK missed.
//
// The change is ONE line: `const one = foldClause(f.net) || (card?.meta?.one) || oneFallback(f, '')` in
// compactCard — the fallback chain findingCard has had since the eleventh break, applied to the other card
// renderer. Nothing else in the file moves.
//
// WHAT THIS IS. The eleventh break typed the one-clause net and pointed findingCard at it. It did not
// point compactCard at it. So on a v6 run this file rendered the TYPED net on the on-field cards and the
// separately AUTHORED `- one:` markdown line on the secondary ones — two summaries, two sources, one HTML
// document, which is precisely the drift item 9a exists to prevent. #243 deletes the authored line at the
// prompt, so leaving compactCard alone would have been worse than the drift: with no `- one:` to parse it
// would fall through to the code-built oneFallback stub ("Not rated — commercial awareness.") and every
// secondary card would lose its sentence.
//
// WHY IT HAD TO LAND HERE. It is the renderer's own fallback chain — not a visual, so report.css and
// brand.mjs were never options, and not a client-safety transform, so parse.mjs was not one either.
//
// The checklist, answered:
//   (1) REACHABLE from a republish — yes, and MEASURED to be inert there, by the method of the third,
//       fifth, seventh and twelfth breaks: the same archived-shape inputs (card markdown carrying `- one:`
//       and `### The read`, findings carrying NO `net`) rendered through the pre-change and post-change
//       modules and byte-compared. RE-MEASURED after the rebase onto fa1cd9fc (#314's negativeLine
//       fallback), against those bytes and not the ones this branch was cut from:
//         legacy composite/level        107281b  sha256 da68bac4ce1d9497…  IDENTICAL
//         v5 disposition-mode           105527b  sha256 e886030744dee78b…  IDENTICAL
//         v5 under a v6 gate            105863b  sha256 9cc17f4d584c6660…  IDENTICAL
//       With `net` absent foldClause returns '' and the expression falls through to exactly the previous
//       value, so no archived run can move. A v6 POSITIVE CONTROL carrying `net` differs, as it must —
//       pre-change the secondary card read the authored "Identical anchor on core supplement goods.",
//       post-change it reads the finding's own typed net. That control is what makes the three identities
//       above a fact about archived runs rather than the trivial result of dead code.
//   (2) It could not live in report.css/brand.mjs — see above.
//   (3) Hash updated here, in the same commit as the edit.
//
// Break of 2026-08-04 (#265 — the quality subsystem is retired, so its capture UI leaves the renderer).
//
// The previous report-review system is superseded. (It had two product names; #853 retired both, from this
// log with everything else — the identifiers below are quoted as the shapes that were deleted, renamed here
// to the neutral tokens the surviving guards use.) Deleted here: `internalToolbar`, the capture-controls
// block, `cardFlag`, the module-level capture-URL constant, the two `cardFlag()` call sites on the full and
// compact cards, the capture-URL binding in renderHtml, and the two inline `document.addEventListener`
// handlers that posted to the write-service's flag, etch and etch-confirm routes. `internalToolbar` went with
// them because it existed only to host those controls and returned '' without them.
//
// The checklist, answered:
//
//   1. REACHABLE from a republish, and it is a repair. The MARKUP half was already gated: the capture
//      controls and `cardFlag` rendered only when publish passed a capture-URL option, which came from an
//      env var, so on a deployment with that unset an archived run re-publishes with no visible change.
//
//      The SCRIPT half was not gated, and that is the finding. Those two handlers sat in the static inline
//      <script> template, so **3,442 bytes of dead JavaScript posting to a retired service shipped in every
//      report** — including the ones delivered to clients, where no capture-control element ever existed for
//      them to bind to.
//
//      Measured, not asserted, the way the third and eighth breaks were: the same parsed inputs rendered
//      through cdc4a18 and through this branch, then diffed. The WHOLE delta of a republished report is
//      105,271 → 101,785 bytes, and every hunk is accounted for:
//        • the two dead click handlers (3,442 B of the 3,486)
//        • one blank line, where the toolbar interpolation stood
//        • the capture-control `.util` styling rule — from report.css, not frozen
//        • two `[data-theme="dark"] .cardflag` rules — from shared/brand.mjs, not frozen
//        • two reworded CSS comments
//      No document content moves: no band, no card, no fact, no heading. The deletion takes dead code out
//      of every future republish and changes nothing a reader sees.
//
//   2. It could not live in report.css/brand.mjs — it is markup and behaviour, not styling. The one
//      styling rule DID go, from report.css, which is correctly not frozen.
//
//   3. Hash updated here, in the same commit as the edit.
//
// NOT deleted, deliberately: portal-report.mjs still strips `.review.internal`, `button.cardflag` and
// `span.cardflag-pop` at serve time, and `LEAKY_HREF_RE` still neutralises links to pool-root staff pages.
// Reports already delivered are frozen bytes on disk and carry that markup forever, so those rules are
// load-bearing for every archived run and their hit count is a leak canary.
//
// #853 widened that href rule from a list of page names to the shape `../<name>.html`, because one of the
// names it enumerated was a retired subsystem's. The archived reports it defends are unchanged and still
// matched — the pages they link to are pool-root siblings, which is what the shape describes.
//
// Break of 2026-08-06 (#470 — the reasoning moves below the fold, the character cap is deleted, and the
// grouped-negative gate is pinned to a literal floor). THREE changes in ONE break, deliberately: each
// one alone would re-render every archived client report, and three breaks is three rewrites of the same
// documents. What moved:
//
//   • THE FOLD. `${lpSplit(f)}${manageableLine(f)}` left the body of findingCard and compactCard and is
//     emitted once, by fullDetail, at the head of `<div class="drillbody">`. Above the fold a card now
//     carries the one-line head (ordinal · owner · mark/classes · band chip · the sentence) and, on a
//     full card, the meters strip. The design ruling of 2026-08-06: above any fold, only a statement, a
//     labelled row, a count or a one-line card; prose waits until a reader opens something, and once
//     opened nothing is ever cut.
//
//     ONE THING ABOVE THE FOLD IS NOT ON THAT LIST, and it is stated rather than glossed, because this
//     header's own history is a run of withdrawn overclaims: `findingCard` still emits the "The read"
//     drawer with `open` set, so on a card whose report.md carries a `### The read` section, prose is
//     visible without anyone opening anything. It is NOT touched here, and the reason is that it cannot
//     occur on a run this layout is for: #243 retired that section and stages.mjs now instructs
//     "Emit NO '### The read' section — RETIRED", so `readProse` is empty and the drawer does not render
//     at all on a fresh run. It survives only on ARCHIVED report.md files. Deleting `open` would
//     therefore move prose in already-delivered documents and change nothing the product now produces —
//     a republish cost with no reader on the other side of it. Left as a stated gap, not a silent one.
//   • THE CAP. `NET_BUDGET = 240` and `foldClause` are deleted; the typed net renders verbatim on both
//     card renderers and on the #242 reasoned-negative row. `clause()` replaces foldClause and is that
//     function with the budget arm removed and nothing else — its trim-to-empty return is what makes
//     `clause(f.net) || card?.meta?.one || oneFallback(...)` fall through on an archived run, and
//     changing that would move every archived card whose `net` key is present and blank.
//   • THE FLOOR. `NEGATIVES_GROUPED` compared against the imported FINDINGS_SCHEMA_VERSION, which this
//     same commit bumps to 7. Its own comment says it fires "only on a record that declares the v6
//     contract", so it means a FLOOR and was written against a moving constant. It now reads `>= 6`.
//
// The checklist, answered:
//
//   1. REACHABLE from a republish — all three, and the answers differ, so they are given apart and
//      MEASURED rather than claimed, by the method of the third, eighth and #265 breaks: the same parsed
//      inputs rendered through the pre-change module and through this branch, then diffed. RE-MEASURED
//      after the rebase onto `aaee3228`, against those bytes and not the ones this branch was cut from —
//      the rebase note above exists because a PR once bumped a hash over bytes that never reached main,
//      and the hash below is the sha256 of render.mjs as it stands on the rebased tree. Page BODY bytes,
//      the inlined stylesheet dropped (see the 2026-07-31 precision note above for why that distinction
//      is load-bearing), on five shapes:
//
//        A  archived legacy/composite, no content model     33,755 → 33,755   BYTE-IDENTICAL
//        B  disposition-mode carrying the P5 positions      33,780 → 33,780   relocation only
//        C  v6 with three grouped reasoned negatives        34,722 → 35,351   +629
//        D  the same record declaring v7                    34,722 → 35,351   +629
//        E  a 299-character net (the cap probe)             33,971 → 34,031   +60
//
//      A is the archived-run guarantee: a run with no legal_position / practical_position / manageable
//      renders not one byte differently, because both helpers return '' and the interpolation is
//      attached to the template's opening.
//
//      B is the whole of the fold move, and it is a RELOCATION: strip every `<div class="lp-split">`
//      block from both renders and the remainders are equal, with the same three blocks on each side.
//      Not one byte is added or lost — the positions are the same text in a different place.
//
//      C/D is the ONE SUBSTANCE ADDITION in this break, and it is named as such rather than folded into
//      "content moved". fullDetail is the drawer of the full card, the compact card AND each #242
//      reasoned-negative row, so a negative's drawer gains the positions it never had: three blocks,
//      629 bytes, and the strip-and-compare shows nothing else moves. #242's own note promises "each
//      member is a <details> whose body is the same fullDetail block the compact card carries" and that
//      was untrue of the one field v6 guarantees on every negative. Suppressing it there would need a
//      conditional whose only purpose is reproducing the pre-#470 shape, which is the legacy code path
//      this program forbids.
//
//      E is the cap, and it is a TEXT change to delivered documents, stated separately from the move
//      because it is the one place a republished report says something the delivered copy did not. The
//      word-boundary arm at least marked its cut with an ellipsis. The SENTENCE-END arm did not: on a
//      256-character probe the cut falls at index 159 — `slice(0, 241).lastIndexOf(". ")` — keeping 160
//      characters and dropping 96 with no ellipsis at all. The delivered card read "…on the class-41
//      services as filed." and silently dropped "The holder has opposed twice in the last three years
//      and the opposition window closes in March." — a deadline, cut with no mark that anything was
//      missing. The republished card carries it.
//      (This sentence said "first sentence ends at 156" until review measured it twice and got 159. The
//      point is unchanged; the number was wrong, and a header whose only value is that its numbers hold
//      does not get to carry one that does not.)
//
//      The FLOOR pin was measured ALONE, before the bump, which is the only point at which the claim is
//      checkable: with the driver still at v6 the two expressions are numerically identical and all five
//      shapes above rendered byte-identically through both modules — a byte change to a frozen file with
//      zero rendered difference, the class of the third and fourth breaks. The counterfactual is what
//      makes that worth measuring: with the driver at 7 and the comparison left bound to the constant,
//      shape C renders 36,466 bytes instead of 34,722 — every archived v6 run losing its ground-grouped
//      negatives to the pre-#242 region-grouped section, on republish, silently.
//
//      WHAT A POST-CHANGE REPUBLISH OF AN ARCHIVED RUN LOOKS LIKE — required by #470 before merge, and
//      this is the ruling. There is no second store of delivered bytes: `archive-tags.json` is a list of
//      retired run ids, not a snapshot, and the pool run dir IS the artifact the portal serves. So a
//      republish REWRITES what the client can open. After this commit it renders under the new layout,
//      complete, and there is no mode that reproduces the old one — rule 1 of this program, no legacy
//      paths. Concretely, for a run archived before today: nothing is lost (B), the sentence may get
//      longer where the fold ate it (E), a v6 run's reasoned negatives gain their positions inside the
//      drawer (C), and every run's page grows the 1,000 bytes of new report.css. `rerender-all` over the
//      live pool is therefore a RE-DELIVERY decision, not maintenance: it is correct for a repair, and
//      running it to pick up a layout change re-issues documents nobody asked to be re-issued.
//
//   2. Could it live in report.css or brand.mjs — the fold move and the cap are markup and content, so
//      no. The styling half DID go to report.css, which is correctly not frozen: `.lp-split` is
//      re-sized for the drawer it now leads (`.drillbody` is 13.5px/1.62, not the tighter card body) and
//      the print block gained a comment, because `details>*:not(summary){display:block!important}` just
//      became load-bearing for the document's CONTENT rather than its completeness — without it the
//      exported PDF would carry the one-line verdicts and none of the reasoning. PRINT IS DELIBERATELY
//      UNCHANGED (#470: the export keeps the "open everything" behaviour it has today). That stylesheet
//      is inlined by render.mjs, so those 1,000 bytes reach every republished report; "not frozen"
//      means "editable without a hash bump", never "outside the delivered document".
//
//   3. Hash updated here, in the same commit as the edit, re-measured over these merged bytes.
//
// ── BUMP, #467 round 2: A COMMENT, AND NOTHING ELSE ─────────────────────────────────────────────────
//
// One line of prose changed, in the comment over `depthStripHtml`. It named `depthCoverageNote`, which
// was renamed `productCoverageNote` in search-policy.mjs when the depth ladder went — so the one comment
// explaining where the masthead's coverage clauses come from pointed at a function that does not exist,
// and the reader it exists for could not follow it.
//
//   WHAT RENDERS DIFFERENTLY: nothing. `git diff` on this file for the commit is one line, inside a `//`
//   comment, outside every template literal. No selector, no markup, no string a report carries. The
//   rendered-difference question the third and fourth breaks made mandatory is answered by inspection
//   rather than by measurement here, and that is honest only because the diff is one comment line — a
//   one-line diff anywhere else in this file would still owe the render comparison.
//
//   WHY BUMP AT ALL RATHER THAN LEAVE THE COMMENT WRONG: the freeze protects DELIVERED BYTES, not the
//   file's prose. Refusing a comment fix to avoid a hash bump would make the freeze a reason to leave
//   documentation lying, which is the opposite of what it is for — and a wrong pointer in the one comment
//   that explains a frozen function is how the next person reads the wrong module.
//
//   Re-measured over the merged bytes, in the same commit as the edit, per rule 3 above.
// FOURTEENTH BREAK (#463, 2026-08-07) — the clearance report names ITS OWN PRODUCT, and stops composing
// one out of a rung and a literal.
//
// What moved, four sites and one helper:
//   • `productName` — a new opts binding, the resolved product NAME. Publish reads it from the run's
//     frozen policy row through `reportIdentityFor(pol).identity`, the same registry join the knockout
//     renderer has always used.
//   • THE TITLE. `<title>Preliminary Clearance — …</title>` → the product name, or the mark alone.
//   • THE HERO. The conf line composed `${opts.stageLabel} — Preliminary Clearance`. It now prints the
//     product and nothing else, via `confLineHtml`, which also DROPS THE WHOLE ROW when neither the
//     privileged posture nor a product has anything to say — an empty `.label` would leave the leading
//     `.dot` bulleting nothing.
//   • THE FOOTER. It named no product at all — #463 calls that a hole rather than a hardcoding: a reader
//     holding a printed page whose header has scrolled off had nothing telling them which read this is.
//     It now leads with the product name, matching `render-knockout.mjs`'s footer, its sibling.
//   • `opts.stageLabel` IS DELETED as a render input. It reaches no string in this file, and publish
//     stops passing it. That is the mechanism this replaces, removed in the same commit rather than left
//     as a second way to name the document.
//
// WHY `.identity` AND NOT `.banner`. `banner` joins stageLabel with identity. On the four live products
// those are the same string and it dedupes, so banner looks harmless — but on a RETIRED row it yields
// "Depth 4 — Preliminary clearance", and #463's whole point is that no depth number, stage label or level
// slug appears on a client surface. Measured, shape B below: banner would have printed the rung.
//
// WHY NOT RE-DERIVE FROM PIPELINE + SCOPE HERE. #463 says the name is a function of pipeline + scope
// "resolved at publish, never stored", and the tempting reading is a `productFor()` call in publish. That
// is the documented WRONG move and the issue's own comment thread says why: `register-plan.json`'s
// `scope_basis` is a conditional spread, ABSENT (not false) on every archived run, so `!== 'worldwide'`
// mislabels every republish; and `searchedJurisdictions` is deliberately emptied on a worldwide sweep, so
// a territory count taken here reads 0 for the one scope that most needs naming. The frozen sidecar
// carries no territory list at all — checked, it freezes level/pipeline/stageLabel/components/recipe/
// origins. `resolveSearchPolicy` already asked `productFor` at plan time against the territories as they
// actually resolved. The stored thing is the product ID; the NAME is still derived on every render, which
// is what the ban on storing names is for.
//
// The checklist, answered:
//
//   1. REACHABLE from a republish — YES, on every shape, and this is the one break where an archived run
//      is MEANT to move. Measured by the method of the third, eighth and #470 breaks: the same parsed
//      inputs rendered through the pre-change module and through this one, whole-file bytes:
//
//        A  archived, no policy sidecar          103,628 → 103,505   -123   conf row DROPPED
//        B  archived on a RETIRED row (prelim)   103,640 → 103,651    +11   "Depth 4 — Preliminary
//                                                                           Clearance" → "Preliminary
//                                                                           clearance"
//        C  live Global preliminary search       103,658 → 103,663     +5   "Global preliminary search —
//                                                                           Preliminary Clearance" →
//                                                                           "Global preliminary search"
//        D  live Full country search             103,652 → 103,645     -7
//        E  D + privileged posture               103,710 → 103,703     -7   prefix still composes
//        F  privileged, no sidecar               103,686 → 103,635    -51   P&C survives ALONE, no
//                                                                           dangling " · "
//        G  a level the registry has forgotten   103,640 → 103,505   -135   "Depth 9 — Preliminary
//                                                                           Clearance" → nothing
//
//      C IS THE DEFECT THIS ISSUE EXISTS FOR, reproduced: the pre-change render of a correctly-resolved
//      Global preliminary search said "Global preliminary search — Preliminary Clearance" — one page,
//      two names. G is the sharper one: an unknown level printed a rung AND a product it could not
//      vouch for. Both now say one true thing or nothing.
//
//      NO SHAPE IS BYTE-IDENTICAL, and that is stated plainly rather than buried: this break repairs a
//      wrong name on every archived clearance, so "unchanged on archived runs" was never available. The
//      repair class is the second break's (a delivered report carrying a dead connector URL), not the
//      tenth's. A republish of an archived run now names the product that run was sold as, per the
//      registry row it still resolves through, and names nothing when that row is gone. `rerender-all`
//      over the live pool remains a RE-DELIVERY decision, exactly as #470's entry ruled.
//
//   2. Could it live in report.css or brand.mjs — no. It is the document's statement of what it is.
//      There is no styling half to this change.
//
//   3. Hash updated here, in the same commit as the edit.
// FIFTEENTH BREAK (#470's owed bullet, 2026-08-07) — the hero verdict caption folds to its first
// sentence.
//
// This is the ONE criterion of #470 that `cf8dd43` did not meet. The issue's design ruling names it
// ("the hero verdict caption folds to its first sentence, remainder behind a disclosure") and the
// comment of 2026-08-06 recorded it as an unmet criterion rather than a scope call, routing it to this
// build on the argument that this build breaks the freeze anyway — so it costs no extra republish.
//
// What moved: `splitFirstSentence` + `heroCaptionHtml`, and the hero's caption line calls the latter
// instead of emitting `<p class="sub">` directly.
//
// THE SPLIT IS ON THE RAW TEXT, and `inline()` runs on each half afterwards. Splitting the RENDERED
// html would cut inside a tag or a link the first time a caption carried one — the fold point comes
// from a heuristic, and a heuristic must never land in the middle of markup.
//
// NOTHING IS EVER CUT, which is what makes a sentence heuristic acceptable where a cap was not. Its
// worst failure moves the fold; the caption still recomposes whole. #470 deleted the last cap in this
// file and forbids a "just in case" replacement, and a fold that dropped its tail would be one.
//
// The checklist, answered:
//
//   1. REACHABLE from a republish — yes, on every run whose caption is more than one sentence, and
//      that is the point. MEASURED IN A BROWSER, not inferred, because a string test cannot see a fold
//      (google-chrome --headless=new, getBoundingClientRect, the mechanism of scripts/render-check.mjs;
//      the measuring script APPENDED to a copy of the page rather than interpolated, so a bad escape
//      cannot read as null). Same caption, pre-change render vs this one, at 1280px:
//
//                                            PRE      POST
//        caption chars above the fold        166        15     the first sentence, alone
//        remainder's height while closed       —      0px     it adds nothing above the fold
//        chars recovered on opening            —       150     15 + 150 + one space = 166, complete
//        hero height, closed               494.0     497.1     +3.1px — a summary row for two lines
//        hero height, opened               494.0     559.6
//
//      Whole-file bytes, all seven shapes of the fourteenth break: +77 each, uniformly — the
//      `<details>` wrapper. Strip that wrapper from the post-change render and rejoin the two
//      paragraphs, and the remainder is BYTE-IDENTICAL to the pre-change page. It is a pure
//      relocation: no word is added, lost or reworded.
//
//      A ONE-SENTENCE caption grows no disclosure and no `sub-lead` class, so it renders exactly as
//      before — asserted, because that is most archived captions.
//
//      The page's horizontal overflow (scrollWidth 1290 vs clientWidth 1265 at a 1280px window) is
//      PRE-EXISTING and identical on both sides. It is not introduced here, and it is reported rather
//      than quietly absorbed into this entry's numbers.
//
//   2. Could it live in report.css or brand.mjs — the fold is markup, so no. The styling half DID go to
//      report.css, which is correctly not frozen: `details.sub-more` and `.sub.sub-lead`. The lead
//      class exists so the stylesheet needs no positional selector — `.sub:first-of-type` would have
//      caught an UNFOLDED caption too and changed the spacing of every archived report that has no
//      fold. PRINT IS UNCHANGED: the existing `@media print` rule `details>*:not(summary){display:
//      block!important}` already forces this disclosure open, so the exported PDF carries the whole
//      caption — #470's rule for print.
//
//   3. Hash updated here, in the same commit as the edit.
// ── BUMP, #599: THE OWNER HEADING STOPS BEING A ROMANISATION ────────────────────────────────────────
//
// The owner heading could render as character-by-character pinyin — eleven lowercase
// syllables, no word boundaries, no capitals — because the register's Latin owner field IS a
// romanisation for a CJK proprietor. The narrative, one file away, had the company's proper English
// name. The renderer never saw it: `recordOwner` preferred the record outright.
//
// The edit is four lines. `recordOwner` now asks the SHARED decision (registry-fidelity's
// ownerDisplayName) instead of REC.owner directly. The decision is provider-derived, not a guess about
// what "looks romanised": a record carrying BOTH a Latin name and a native-script one is itself saying
// the Latin field is a transliteration, and only then does a rendering the run resolved beat it.
//
//   1. REACHABLE from a republish — yes, and the answer is that ARCHIVED RUNS DO NOT MOVE. A republish
//      renders the archived findings.json, whose owner.name was already bound to the record's string by
//      the old rule. So `resolved` EQUALS `raw`, ownerDisplayName returns it, and the byte is identical.
//      The fix reaches runs bound after it lands, and nothing else. That is asserted, not reasoned:
//      "a REPUBLISH of an archived run is byte-identical" in owner-name-romanisation.test.mjs.
//
//      A Latin-only record is unchanged in every case — no native form, so the never-invent overwrite
//      (doc-31 step 4) still wins and a model-typed owner still never reaches the page. Also asserted,
//      and a break that removes it reddens.
//
//   2. Could it live in report.css or brand.mjs — no. It is WHICH FACT the page states about a party,
//      not how that fact looks. The alternative was leaving render alone, and that was the version of
//      this change that did nothing: binding the finding while the renderer re-derived the owner on its
//      own is why the first cut of #599 would have shipped inert on both of its symptoms.
//
//   3. Hash updated here, in the same commit as the edit.
// ── BUMP, #601: THE LINE'S OWN CUT STOPS BEING A MAGIC NUMBER ───────────────────────────────────────
//
// An "Only you can close these" ask can run to several hundred characters. The reading that
// matters is not that they are long: `actYouConditions` CUTS them at 170 characters, at a word boundary
// and — by the recorded decision one line above it — with no ellipsis. So the report hero's "subject to"
// line and the email's conditions box showed the client a sentence that simply stopped. Measured: a
// 255-character ask renders as 162.
//
// The edit is two lines. `170` becomes an exported `CONDITION_HEAD_MAX`, and the cut uses it.
//
//   1. NOTHING RENDERS DIFFERENTLY. The value is unchanged and the expression is the same; this is a
//      literal becoming a named export. owner-name-romanisation.test.mjs's republish-is-byte-identical
//      property is untouched, and action-fits-bound-line.test.mjs arm 5 asserts the width and the
//      no-ellipsis decision both survive.
//
//   2. WHY IT HAD TO LEAVE THIS FILE AT ALL. The number governed two client surfaces and lived nowhere
//      the seat authoring the ask could see it, so the dictation could not state it and the pre-delivery
//      lint could not check it without retyping it. A retyped bound drifts silently in the direction
//      that matters — a check passing an ask the renderer cuts. Now stages.mjs interpolates it into the
//      dictation and predelivery-lint imports it, so the cut, the instruction and the check are one
//      number.
//
//   3. The cut itself is NOT changed. Marking it would be the other way to fix this and it is the
//      owner's call, not a dev tidy: the no-ellipsis choice is recorded here and governs client-facing
//      wording. This change is upstream of it — stop authoring asks that need cutting.
//
//   4. Hash updated here, in the same commit as the edit.
// ── BUMP, #601 AGAIN: THE CONDITIONS BOX STOPS CUTTING ──────────────────────────────────────────────
//
// The bump above named the 170 and left the cut alone, on the ground that marking it was the owner's
// call. Putting that choice in front of him turned up the case the length bound never covered:
//
//     const m = t.match(/^[\s\S]*?[.:](?=\s|$)/); head = (m ? m[0] : t).trim();   // first whole sentence
//
// ONE LINE ABOVE THE CAP, AND IT FIRES FIRST. It ends the "sentence" at the first '.' or ':' before
// whitespace, so "Obtain consent from Matchday, Inc. before filing in Japan." was delivered as "Obtain
// consent from Matchday, Inc" — 77 characters, nowhere near 170, cut, unmarked, and invisible to the
// check I had just added, which measures length. "Inc.", "Ltd.", "U.S.", "No. 2" and any internal colon
// all do it, and those are the words an ask about a company is made of.
//
// Owner ruling 2026-08-10: stop cutting. Both cuts are deleted and CONDITION_HEAD_MAX with them.
//
//   1. REACHABLE FROM A REPUBLISH, AND INTENDED. An archived CONDITIONAL run re-rendered after this
//      lands gets the whole ask on its email banner instead of the fragment. That is the same
//      repair-of-delivered-reports class as the second break, not a rewrite of substance: no ask
//      changes, the ones that were being shortened stop being shortened.
//
//      TWO VISIBLE CHANGES, BOTH DELIBERATE. (a) An ask past the first period now renders to its end.
//      (b) The driver's "(re: <mark>)" subject join and "(due by <date>)" suffix now reach the banner —
//      the sentence cut removed them as a side effect of stopping at the ask's own period. Both name
//      the finding and the date the condition turns on, which is what a line headed "subject to:" is
//      for. Nothing else in the file moved.
//
//   2. COULD IT LIVE ELSEWHERE — no. The cut is in this function; there is nowhere else to not do it.
//
//   3. WHY THE BOUND DID NOT GO WITH IT. 170 governed two surfaces and one of them, the report hero's
//      "subject to" line, was DELETED (see the B1 note beside the function). What was left was a
//      wrapping <p> in an email with no width and no clamp — a cut with nothing to cut for. But the
//      product does still shorten an ask, honestly and in one place: findings-model clips the verdict
//      statement's "conditional on:" clause at STATEMENT_CLAUSE_MAX and MARKS it with an ellipsis. The
//      constant moved there, which is where it was always derived; the dictation and predelivery-lint
//      now read it from the surface that actually clips.
//
//   4. Hash updated here, in the same commit as the edit.
//
// ── The eleventh break: seven COMMENTS, zero executable bytes (#623) ────────────────────────────────
//
// The repo is being cut as a public snapshot, and seven comments in render.mjs cited a real client
// matter by its mark — the shorthand this codebase used for a class of layout defect ("the <mark>
// header showed the citation core", "<mark>: 7 alarm cells"). Those are exactly the accumulated client
// names the identifier guard's header names as the reason it exists, and a public repo cannot carry
// them. The mark was substituted for its demo twin across the whole tree in one mechanical pass; these
// seven lines were part of it.
//
//   1. REACHABLE FROM A REPUBLISH — no. Every changed byte is inside a `//` comment. The rendered
//      output of any run, archived or new, is identical: `doRepublish()` produces the same bytes
//      before and after. This is the first break with no reader-visible effect at all, which is also
//      why it is worth stating plainly rather than waving through — the freeze is about republish
//      risk, and this change carries none.
//   2. COULD IT LIVE ELSEWHERE — no. The comments are in this file.
//   3. WHY IT HAD TO LAND HERE. Leaving them would have left the mark in the published snapshot, and
//      the whole point of the pass is that it is mechanical: an exception for one file is a name that
//      survives because a hash was inconvenient.
//   4. Hash updated here, in the same commit as the edit.
//
// ── The twelfth break: two COMMENTS, zero executable bytes (#623) ───────────────────────────────────
//
// Same class as the eleventh, one round later and for people rather than marks. Two comments credited
// a content-model ruling to the reviewing lawyer by first name. The attribution is the useful part —
// it says the rule came from the lawyer, not from an engineer's taste — and the ROLE carries that
// just as well as the name does, without putting a person in a public repo. The repo-wide PII pass
// moved every such attribution to its role; these two lines were part of it.
//
//   1. REACHABLE FROM A REPUBLISH — no. Both changed lines are `//` comments; a republish produces
//      identical bytes, verified by diffing with non-comment lines filtered out (zero).
//   2. COULD IT LIVE ELSEWHERE — no. The comments are in this file.
//   3. WHY IT HAD TO LAND HERE. An exception for the frozen file is a name that survives the sweep
//      because a hash was inconvenient, which is how a scrub becomes partial.
//   4. Hash updated here, in the same commit as the edit.
// ── BUMP #14 (#669) — THE PRESENTATION SANITIZER IS OUT OF THE RENDER PATH ─────────────────────────
//
// `plainify` ran nineteen find-and-replace rules over the rendered client surface, and #656 is what
// that cost: `axis` -> `group` turned "AXIS Bank filed in class 36" into "group Bank filed in class
// 36" — a report naming a mark that does not exist, inside the report that clears it. AXIS and SLICE
// are both live trademarks; the ban list and the trademark register overlap, and this engine exists
// to search the register. Case-sensitivity was a trade, not a fix: it bought the uppercase mark and
// gave up a sentence-initial "Axis coverage was limited", and a mark filed in lowercase was still
// eaten. Four call sites go with it — inline(), plainScopeNote, the coverage-read line and
// coverageGrid — and the grid now prints `areaLabel`, a field the DRIVER emits beside the machine
// identifier (coverage-ledger.coverageUnitLabel).
//
//   1. REACHABLE FROM A REPUBLISH — YES, and deliberately. An archived run re-rendered under this
//      code prints its `area` verbatim where it used to print the substituted string: a row reading
//      `incumbent-class (entire axis)` renders as itself rather than as `owner portfolio sweep
//      (entire group)`, because archived rows carry no `areaLabel`. That is the honest direction —
//      the identifier is what the run recorded — and it is the price of never rewriting a client
//      string again. The eleven legacy doc-52 idiom rules go too; measured across the twelve
//      delivered runs in the test pool, every one of them matches ZERO times in the source artifacts,
//      so what is lost is a fixup for text nothing produces.
//   2. COULD IT LIVE ELSEWHERE — the substitution could not. The label had to be emitted where the
//      area is minted (the driver), which is what this change does; the renderer's part is to stop
//      transforming and start reading a field.
//   3. WHY IT HAD TO LAND HERE. coverageGrid is in this file. A label emitted and not read is a
//      column nobody sees.
//   4. Hash updated here, in the same commit as the edit.
// SIXTEENTH BREAK (#761, 2026-08-12) — two changes, both about a reader knowing WHAT THEY ARE HOLDING.
//
//   (a) THE RISK FRAMEWORK IS NAMED BESIDE THE BAND SCALE, not only in the footer.
//   (b) THE CONFIDENTIALITY POSTURE BECOMES ONE THREE-STATE RULE, shared with the knockout template.
//
// ── (a) the framework, where its words are read ───────────────────────────────────────────────────────
//
//     <div class="label">Overall risk</div>
//   → <div class="label">Overall risk<span class="gauge-fw">${esc(FRAMEWORK.title)}</span></div>
//
// The `.ticks` row under the scale spells a VOCABULARY — "Manageable", "Moderate", words whose meaning is
// entirely the manifest's — and the only place naming the manifest was the footer, at the bottom of a
// document that routinely runs six thousand pixels. #761 complains that the framework is named ONLY
// there, not that it is named there, so THE FOOTER LINE STAYS: it is the printed page's provenance and it
// survives an export whose header has scrolled off. `FRAMEWORK.title` is the manifest's own name for
// itself and the exact string that footer already prints — composing a second, shorter form here would
// put two names for one framework on one page, which is the #463 failure in another corner.
//
// LEGACY `gauge()` IS UNTOUCHED. Its branch has no manifest to name, which is what makes it the legacy
// branch, and leaving it alone is what buys the zero rows in the framework column below.
//
// ── (b) one confidentiality rule, two templates ───────────────────────────────────────────────────────
//
//     confLineHtml(privileged, productName)  with  const privileged = opts.delivery ? !!opts.delivery.privileged : false
//   → confLineHtml(opts.delivery, productName)  calling  confPosture(delivery)  from shared/brand.mjs
//
// This template emitted "Privileged & Confidential · Attorney Work Product" only when a profile asked;
// render-knockout.mjs emitted a SHORTER "Privileged & Confidential" unconditionally, from a hand-rolled
// array join with no way to read a profile at all. Two hand-written copies of one firm-wide document
// marking, drifted on both the wording and the condition. The rule now has ONE definition, in
// shared/brand.mjs (not frozen, and already imported here), and both templates call it:
//
//     privileged === true   → "Privileged & Confidential · Attorney Work Product"
//     privileged === false  → nothing; the caller drops the row
//     absent / no opinion   → "Privileged & Confidential"
//
// THE `!!` WAS THE BUG. Coercing to a boolean erased the difference between a customer who said "no" and
// a customer who said nothing, and answered both with silence. Absent is not false: "Attorney Work
// Product" characterises the document in legal terms and is not ours to assert over every House-default
// run, while the plain confidentiality line claims nothing and is what any legal deliverable carries.
//
// THE CONFIG MOVED IN THE SAME COMMIT, and without it this rule would be decoration. profiles/generic.json
// ("House default", and what resolveProfile returns for every unbound run) said `"privileged": false`
// outright, as did NEUTRAL_DELIVERY — so the no-opinion state had no producer and every House-default
// clearance shipped unmarked. Both are now SILENT on the field. zephyr.json and petcary.json keep their
// explicit `false`, which now means a customer deliberately choosing off, and still works.
//
// ONLY THE COMPOSER IS SHARED, NOT THE ESCAPING. Each template joins the posture to its own product name
// with its own `esc` — the knockout's also escapes `"` — and each drops the whole row when the result is
// empty. Unifying two `esc`s that differ would move a frozen template's bytes for no reason; that is the
// depthStrip lesson (render-knockout.mjs) and it is deliberately NOT bundled in here.
//
// ── the checklist, answered ───────────────────────────────────────────────────────────────────────────
//
//   1. REACHABLE FROM A REPUBLISH — YES, on both halves, and (b) moves archived bytes on purpose. Method
//      as the third, eighth, #470 and fourteenth breaks: `git show 3270133:driver/publish/render.mjs`
//      (byte-identical to 857db4a's, as is every module it imports), the same parsed inputs through both
//      modules, whole-file bytes, one shape per fresh process so no file-scope `let` in the renderer
//      carries between them. Shapes A-G are the FOURTEENTH BREAK's, each rendered twice because (a)'s
//      discriminator (a framework manifest) is orthogonal to that entry's (productName + privileged); H
//      and I are added because #761 makes an EXPLICIT `false` a distinct state that A-G never exercised.
//
//      THE FIXTURE IS NAMED HERE, WHICH IS THE ONE THING EVERY EARLIER TABLE LEFT OUT. Inputs are
//      scripts/report-print-check.mjs's clearance fixture verbatim — its REPORT_MD through `parseReport`,
//      its two FINDINGS, its two COVERAGE rows — and the manifest is
//      driver/test/fixtures/knockout-brimstone/_driver/framework.json ("Aurora Interactive ACP risk
//      framework", 37 chars). Each shape is exactly one `(productName, delivery)` pair, productName
//      resolved through `reportIdentityFor` the way publish resolves it, never hand-written; `delivery`
//      is OMITTED, not passed as undefined, wherever the shape has none. An unnamed fixture is why the
//      fourteenth break's absolutes cannot be compared with these: its dependencies are byte-identical to
//      this tree's, so the ~3KB gap is its parsed input and nothing else. Renders are deterministic —
//      each cell below reproduced three times.
//
//                                              no framework              framework in force
//        A  archived, no policy sidecar       106,725 → 106,830  +105   106,862 → 107,034  +172
//        B  archived on a RETIRED row         106,871 → 106,904   +33   107,008 → 107,108  +100
//        C  live Global preliminary search    106,883 → 106,916   +33   107,020 → 107,120  +100
//        D  live Full country search          106,865 → 106,898   +33   107,002 → 107,102  +100
//        E  D + privileged posture            106,923 → 106,923     0   107,060 → 107,127   +67
//        F  privileged, no sidecar            106,855 → 106,855     0   106,992 → 107,059   +67
//        G  level the registry has forgotten  106,725 → 106,830  +105   106,862 → 107,034  +172
//        H  #761 explicit OFF + product       106,865 → 106,865     0   107,002 → 107,069   +67
//        I  #761 explicit OFF, no product     106,725 → 106,725     0   106,862 → 106,929   +67
//
//      THE TWO CHANGES ARE ORTHOGONAL, MEASURED RATHER THAN ASSUMED: carrying a manifest costs a uniform
//      137 bytes on all nine shapes before and a uniform 204 after, so `204 - 137 = 67` is (a)'s whole
//      contribution and the right-hand column is always the left-hand delta plus it. A shape where those
//      two constants moved would mean (a) and (b) interact, and the table would have to be read row-wise
//      instead.
//
//      Every number decomposes into the two changes and nothing else:
//        +67  = (a), the gauge name — `<span class="gauge-fw">` (23) + `</span>` (7) + THIS MANIFEST'S
//               37-char title. It varies with the title's length and with nothing about the run, so a
//               customer whose framework is named differently moves this number and only this number.
//        +33  = (b) on a row that already existed — the default posture and its separator prefixed to a
//               product name (29 bytes of text + 4 for " · ", the middot being two bytes in UTF-8).
//        +105 = (b) creating a row that did not exist — 76 bytes of `.conf` markup plus the 29-byte line.
//           0 = unchanged, and there are two distinct reasons. E and F are PRIVILEGED, which behaved
//               correctly before and is byte-identical now. H and I are an EXPLICIT `false`, which
//               renders exactly what a House default used to render — the old behaviour is still
//               reachable, it just has to be asked for.
//
//      A AND G ARE THE SAME CELL, and that is a check rather than a duplicate: a forgotten level and an
//      absent sidecar both resolve to no name, so any table where they diverge was built wrong. Same for
//      E against F once the product is stripped.
//
//      A AND G ARE THE DEFECT THIS ISSUE EXISTS FOR, reproduced: an archived clearance with no delivery
//      opinion carried NO confidentiality marking at all, and now carries the plain one. That is the
//      issue's own cited live proof, and it is a repair of already-delivered reports in the second
//      break's class, not a rewrite of their substance.
//
//      ONE LIMIT, STATED PLAINLY RATHER THAN LEFT TO BE DISCOVERED: a republish reads the run's FROZEN
//      profile sidecar, never today's profiles/. An archived run bound to generic BEFORE this commit
//      froze `privileged:false` (pipeline.mjs stores `p.delivery ?? NEUTRAL_DELIVERY`), so it
//      re-renders as shape H/I — still unmarked. That is correct: the frozen profile is the authority on
//      what a run shipped under. The repair reaches new runs and sidecar-less archives; it is NOT
//      retroactive for archives that recorded the old explicit false, and `rerender-all` over the live
//      pool remains a RE-DELIVERY decision exactly as #470's entry ruled.
//
//      THE DELIVERED DOCUMENT ALSO MOVES BY report.css, WHICH THIS TABLE DOES NOT COVER. That file is
//      inlined into every report and grew 425 bytes — `.gauge .label .gauge-fw` and its comment, 31,229 →
//      31,654 — on top of every figure above, which are rendered against the NEW stylesheet on both sides
//      so the renderer's own contribution is what the columns isolate. The table isolates the
//      RENDERER's contribution, which is what this freeze covers; the CSS half is measured because a
//      "byte-identical" claim taken from the renderer alone would be false about the file a client opens.
//
//   2. COULD IT LIVE IN report.css OR brand.mjs — and half of it DID, which is the point of asking.
//      (a)'s styling is entirely `.gauge .label .gauge-fw` in report.css, and cost no hash bump; what
//      could not go there is the NAME, because a stylesheet cannot read `FRAMEWORK.title` and a CSS
//      `content:` string would hardcode one customer's framework onto every report. (b)'s RULE went to
//      shared/brand.mjs in full — the three-state function lives there and this file only calls it, which
//      is what makes "one rule" true in code rather than only in output. What is left here is the two
//      call sites, and a call site cannot be moved out of the file that calls.
//
//   3. Hash updated here, in the same commit as the edit.
// SEVENTEENTH BREAK (#763, 2026-08-12) — four changes, one subject: the page says each thing ONCE, in the
// place a reader looks for it.
//
//   (a) A FINDING'S READ IS PRINTED ONCE, not twice inside its own drawer.
//   (b) WHAT THE SEARCH RAN IS NOT FOLDED AWAY, and the masthead's pointer quotes a real title.
//   (c) THE ONLY-YOU CHIP VOCABULARY GAINS ITS FOURTH TOKEN (the section itself is fixed upstream).
//   (d) A SUB-HEADING STOPS BEING DELIVERED TO A CLIENT AS A CONDITION.
//
// ── (a) one account per fact ──────────────────────────────────────────────────────────────────────────
//
//     const positions = `${lpSplit(f)}${manageableLine(f)}`
//   → const proseHasRead = /(^|\n)\s*-\s*(\*\*)?\s*Risk assessment\b/i.test(proseFull || '')
//     const positions = `${proseHasRead ? '' : lpSplit(f)}${manageableLine(f)}`
//
// Inside "Full detail & provenance" the typed legal_position printed as a "Legal risk." paragraph and
// then again, three lines down, as the card's own "- **Risk assessment.**" bullet; practical_position did
// the same against the commercial and enforcement bullets. Both copies are model-authored and BOTH are
// mandated: delivery-contract §L requires the Risk assessment bullet, and stages.mjs — in the same
// instruction — says the legal and enforcement reads "are already TYPED on the record (legal_position /
// practical_position) and render from there". The contract asks for one account in two places, and the
// renderer printed both.
//
// MEASURED, not eyeballed: on the frozen example (demo, 10 full cards) a token-set
// similarity sweep over each card's own text found 19 near-identical sentence pairs, every one of them
// between a typed position and a prose bullet — the Risk assessment bullet on 10 cards of 10, and the
// Use / Enforcement / Portfolio bullets on 5 more. Suppressing the two NAMED bullets instead leaves 6 of
// those pairs standing, one of them a verbatim repeat; suppressing the typed pair leaves 0. That is the
// measurement that chose the DIRECTION — which of the two copies goes. Which CARDS it applies to is a
// separate question and is answered below, more narrowly than that measurement alone would suggest.
//
// THE REASONED READ WINS, which is the enfLine / impactLine dedupe this function already runs twice, one
// level up — and the gate is written the way those two are, as a test for §L's own bullet label on the
// card MARKDOWN. It is a SUBTRACTION: no client string is rewritten, filtered, re-labelled or cut — one
// code-emitted block stops printing where the card has already printed it. Editing the prose instead was
// the other direction, and it is the pattern #709 and #669 exist to forbid.
//
// THE FIRST CUT OF THIS GATE WAS `proseFull ? '' : …` — any Full-detail prose at all — and it is recorded
// here because it was WRONG in a way the sample could not show: all 10 cards carry the bullet, so the two
// gates are identical on it. Rendered on a card whose Full-detail block states the filing and cites the
// source and says nothing about the risk, the broad gate produced a drawer with a filing line, an
// enforcer line and a source and NO READ AT ALL — the last copy deleted, silently. Shape P below is that
// card, and it is 0 under the gate that shipped. A dedupe that can delete the last copy of something is
// not a dedupe.
//
// A DRIFTED LABEL FAILS THE SAFE WAY: a card that labels its read something §L does not name misses this
// test and shows the duplicate again — visible, and fixable at the contract. The other failure direction
// is a card that quietly says less than the record holds, which nobody would ever see.
//
// WHERE THERE IS NO PROSE THE TYPED PAIR IS STILL THE ACCOUNT: a structured-only finding, a #242
// reasoned-negative row, a compact card whose report-card stage produced nothing. #470's promise that a
// negative's drawer carries its positions is intact — a negative has no Full-detail prose to duplicate.
// Shapes K and P below are those guarantees, measured.
//
// ── (b) the checks come out of the fold, and the pointer quotes the title ─────────────────────────────
//
// The "Checks we ran — what we found" bucket is the run's reasoned negatives: the grounds checked, and
// why each came back empty. It was the FIRST thing inside a closed <details> whose summary announces the
// opposite — "Scope & what we didn't search" — so the page's best evidence was filed under its own
// disclaimer. It is now emitted beside that <details> instead of inside it. Same markup, same authored
// heading, same ✓ marker, same position at the head of §4; the long not-run / partially-covered ledger,
// the methodology note and the internal provenance rows stay folded, in the same order, under the same
// summary. Placement, not furniture (#765).
//
// The masthead footnote read `coverage-limited (see “What we covered”)`. The heading is "What we covered
// — and what's open", so the quoted words were a PREFIX of a title rather than a title, and there is no
// anchor to follow instead (null-origin iframe — the B1 note's own reason for deleting the Subject-to
// line). It now quotes the heading verbatim. The issue reports the title as existing "nowhere on the
// page"; the code says otherwise and the code is right — grep the rendered sample and the heading is
// there. What was true is that no reader could FIND it from the pointer. THE POINTER CANNOT DANGLE:
// `limited` is populated only from coverage rows carrying a coverage-limited / not-searched state, so a
// limited chip implies a coverage row, which is the exact condition the heading renders under. That was
// checked rather than assumed, and the `coverage.length` guard the recon proposed was NOT added — a
// guard no input can reach is a claim nobody can check.
//
// PROVED, not asserted: a checker over the rendered sample that extracts every curly-quoted phrase
// introduced by "see/under/in" and requires it to equal an h1-h4, a <summary> or a bold lead on the same
// page reports 1 dangling pointer before this commit and 0 after, out of 23 titles.
//
// ── (c) the fourth chip ───────────────────────────────────────────────────────────────────────────────
//
// One `.replace` beside the three that were there. The SECTION's defect is upstream and is fixed there:
// pipeline.mjs's buildOnlyYouSection emitted undated conditions as bare `- text` while every advisory
// carried a tag, and collapsed the sub-headings whenever only one bucket was non-empty — so the section's
// shape and its labelling both varied with facts about the matter rather than with the kinds of item in
// it. That is the drift #763 reports, it is assembly-time, and no archived report.md moves for it. This
// file's part is to render the token the assembler now mints. It is inert on any run assembled before it.
//
// ── (d) the sub-heading that was being delivered as a condition ───────────────────────────────────────
//
// Found while doing (c), and OLDER than it. `actYouConditions` — which the email composer builds the
// "subject to:" box from — splits the only-you bucket on `\n(?=\s*[-*]\s)`. #601 (c) put bold sub-headings
// into that bucket in 2026-08-10. So everything before the first bullet became item 0, and every heading
// after a bullet was swallowed by the bullet above it. Run against the PRE-CHANGE module with the frozen
// example's own only-you body, its literal output is:
//
//     [ "Before you can rely on this result",
//       "Narrow the class-9 wording. We need an answer from you" ]
//
// — a heading delivered to a client as a condition, and a real condition with the next heading welded to
// its end. The fix drops whole-line bold lines before splitting: structure, not wording, and no item line
// can be one (every item opens "- "). It is recorded here rather than folded into (c) because it is a
// defect on a DIFFERENT surface — the email, not the report — that (c) would otherwise have widened from
// multi-group runs to every run carrying a condition.
//
// ── the checklist, answered ───────────────────────────────────────────────────────────────────────────
//
//   1. REACHABLE FROM A REPUBLISH — YES on (a) and (b); NO on (c) or (d), and both of those were traced
//      rather than assumed. (c) is ASSEMBLY-time: buildOnlyYouSection runs once, during the run, and its
//      output is frozen into report.md; publish and republish read that file. (d) is DELIVERY-time:
//      `actYouConditions` has exactly one non-test caller, `composeEmailHtml` (publish/index.mjs),
//      which is itself called from exactly one place — pipeline.mjs, writing `email-body.md` in the
//      delivery stage. `publishReport` never calls it, so a republish rebuilds report.html and does not
//      recompose the cover note. Both changes therefore reach runs made after they land and no delivered
//      artifact; the table below is about report.html, and for (c) and (d) there is nothing outside it.
//
//      Method for the two that ARE reachable:
//      as the third, eighth, #470, fourteenth and sixteenth breaks: `git show origin/main:driver/publish/
//      render.mjs` beside the modified module, the same parsed inputs through both, whole-file bytes, ONE
//      shape per fresh process so no file-scope `let` carries between them. Both sides read the SAME
//      (new) report.css, so the stylesheet cancels and the columns isolate the RENDERER's contribution;
//      the stylesheet's own growth is stated below it. EVERY CELL REPRODUCED THREE TIMES, byte-for-byte.
//
//      THE FIXTURE IS THE SIXTEENTH BREAK'S, VERBATIM, which is what makes the A-I rows comparable with
//      that entry's: scripts/report-print-check.mjs's clearance fixture (its REPORT_MD through
//      `parseReport`, its two FINDINGS, its two COVERAGE rows), manifest from
//      driver/test/fixtures/knockout-brimstone/_driver/framework.json, productName resolved through
//      `reportIdentityFor`, `delivery` OMITTED where a shape has none. A-I are that entry's nine shapes.
//
//      A-I CANNOT SEE ANY OF THE FOUR CHANGES, and that is stated rather than left for a reader to infer
//      from eighteen zeroes: the print-check fixture carries no `# Actions` section, no P5 content model
//      and no register-CODED coverage-limited row, so it has no checks bucket to lift, no only-you items
//      to chip, no typed positions to dedupe and no masthead footnote. J-N add exactly ONE discriminator
//      each, on D's (productName, delivery) pair, so the input document is the only variable.
//
//                                                 no framework                framework in force
//        A  archived, no policy sidecar         108,675 → 108,675     0     108,879 → 108,879     0
//        B  archived on a RETIRED row           108,749 → 108,749     0     108,953 → 108,953     0
//        C  live Global preliminary search      108,761 → 108,761     0     108,965 → 108,965     0
//        D  live Full country search            108,743 → 108,743     0     108,947 → 108,947     0
//        E  D + privileged posture              108,768 → 108,768     0     108,972 → 108,972     0
//        F  privileged, no sidecar              108,700 → 108,700     0     108,904 → 108,904     0
//        G  level the registry has forgotten    108,675 → 108,675     0     108,879 → 108,879     0
//        H  #761 explicit OFF + product         108,710 → 108,710     0     108,914 → 108,914     0
//        I  #761 explicit OFF, no product       108,570 → 108,570     0     108,774 → 108,774     0
//        J  D + a checks-we-ran bucket   (b)    109,046 → 109,086   +40     109,250 → 109,290   +40
//        O  D + an only-you bucket       (c)    109,320 → 109,372   +52     109,524 → 109,576   +52
//        K  D + typed positions, NO prose (a-)  109,877 → 109,877     0     110,081 → 110,081     0
//        L  D + typed positions AND prose (a)   110,303 → 109,736  -567     110,507 → 109,940  -567
//        M  J + O + L together                  111,183 → 110,708  -475     111,387 → 110,912  -475
//        N  D + coverage-limited REGISTER row(b)109,130 → 109,150   +20     109,334 → 109,354   +20
//        P  L's card, prose with NO risk bullet  110,016 → 110,016     0     110,220 → 110,220     0
//
//      A-I ARE THE ARCHIVED-RUN GUARANTEE. Nine shapes, both columns, eighteen pairs, not one byte: a
//      clearance with no content model, no Actions section and no register-coded coverage gap republishes
//      exactly as delivered. The framework column adds a uniform 204 bytes on both sides of every row —
//      the sixteenth break's own constant, unchanged — which is the check that this break and that one do
//      not interact.
//
//      EVERY NON-ZERO CELL DECOMPOSES, and each decomposition was computed from the two renders rather
//      than reasoned from the diff:
//        +40  = (b) the fold move. `<div class="panel actions scope-ran">` (37) + `</div>` (6), less the
//               `"\n  "` separator (3) the bucket no longer needs as a member of `parts.join`. Not a word
//               is added or lost: strip the wrapper and the checks bucket is byte-identical.
//        +52  = (c) the fourth chip. `<b>[Before you can rely]</b>` (28) → `<b><span class="src cl"
//               style="margin-right:6px">Before you can rely</span> </b>` (80). It is the same substitution
//               the other three tokens have had since doc-52 and costs what they cost.
//        -567 = (a) EXACTLY ONE `<div class="lp-split">` block, the one on the card whose own prose
//               already carried both reads. Measured two ways: the block is 567 bytes, and stripping every
//               lp-split from BOTH renders leaves byte-identical remainders — so nothing else in the
//               document moved, and no text was reflowed, re-escaped or re-ordered.
//        +20  = (b) the pointer's " — and what's open", 20 bytes in UTF-8 (the em-dash being three).
//
//      K AND P ARE THE POSITIVE CONTROLS FOR (a), and without them the L row would be worth nothing. L's
//      fixture has TWO findings carrying typed positions and gives Full-detail prose to only the first;
//      the pre-change render emits two 567-byte lp-split blocks, the post-change render emits ONE, and
//      the survivor is byte-identical to the SECOND — the card with no prose to duplicate. K is that same
//      guarantee whole-document (typed positions, no prose anywhere). P is L's own card with the §L
//      bullet taken OUT of its prose, and it is the control on the GATE rather than on the field: same
//      card, same typed positions, nothing suppressed, zero bytes moved. So -567 is a duplicate being
//      removed, and it is removed only where the replacement is demonstrably on the page.
//
//      M = J + O + L, EXACTLY (-475 = 40 + 52 - 567), which is how the three are known to be orthogonal
//      rather than assumed to be. A shape where that arithmetic failed would mean two of the changes
//      interact, and the table would have to be read row-wise instead of column-wise.
//
//      N IS 20 BYTES OF POINTER: the em-dash clause " — and what's open" (20 bytes in UTF-8, the dash
//      being three). It is the one row where a delivered report says something it did not say before, and
//      what it now says is the name of its own heading.
//
//      THE DELIVERED DOCUMENT ALSO MOVES BY report.css, WHICH THIS TABLE DOES NOT COVER — the same
//      caveat the sixteenth break records, for the same reason. That file is inlined into every report
//      and grew 1,845 bytes (31,654 → 33,499): `details.scope > summary` had NO screen rule at all, so
//      the section stating what the search did not cover rendered at the browser's default size, weight
//      and triangle at the foot of a six-thousand-pixel page. It is now a section header, and the lifted
//      checks panel's `h4` is sized to match the panel headings around it. Both sides of every figure
//      above are rendered against the NEW stylesheet, so the columns isolate the renderer.
//
//      WHAT A REPUBLISH OF AN ARCHIVED RUN LOOKS LIKE, per #470's ruling that this must be stated: a run
//      with no content model does not move at all (A-I). A run WITH one loses the second copy of its own
//      reads (L) — that is a subtraction of a duplicate, never of a fact, and the surviving copy is the
//      card's own reasoned prose, uncut. A run with an Actions section shows its checks without a click
//      (J). A run with a coverage-limited register row gets a pointer that names the heading it points at
//      (N). `rerender-all` over the live pool remains a RE-DELIVERY decision, exactly as #470 ruled.
//
//   2. COULD IT LIVE IN report.css OR brand.mjs — and the whole visual half DID, which is the point of
//      asking. Every rule above (`details.scope > summary`, its marker, its print reset, the
//      `.scope-ran` h4) is in report.css, hash-free. What could not go there: WHICH block prints (a is a
//      conditional, not a style — `display:none` on `.lp-split` would blank it on the negatives and
//      compact cards that are its only remaining home), WHERE the checks bucket sits in the document
//      (moving a node between parents is markup), the pointer's WORDS, the chip token, and (d), which is
//      a text-extraction rule feeding the email composer and not a rendering at all.
//
//   3. Hash updated here, in the same commit as the edit.
//
// ── THREE THINGS THIS BREAK DOES NOT DO, STATED SO NOBODY HAS TO REDISCOVER THEM ──────────────────────
//
//   · report-data.json STILL CARRIES BOTH ACCOUNTS. (a) lands in the HTML renderer, so the
//     component-native portal path keeps serving `legal_position` beside the card prose. That is the
//     "two surfaces summarising one finding" shape the eleventh break's own note warns about, and it is
//     a second lane's fix, not this one's.
//   · THE FROZEN SAMPLE'S only-you SECTION KEEPS ITS UNLABELLED CONDITION. (c) is assembly-time and
//     demo's report.md is frozen engine output (#623, shared/vetted-identities.mjs), so
//     the sample shows the fixed CARDS and the fixed SCOPE section but its only-you items are whatever
//     the run assembled in August. It clears when the sample is re-frozen from a new run, and not before.
//   · ONE EDGE MOVES AND IT IS NOT IN THE TABLE, because no shape above reaches it: a run whose §4 held
//     NOTHING BUT the checks bucket — no findings, so no record-provenance paragraph, and no coverage,
//     methodology, context notes or origins rows. `scopeSection` used to wrap that lone bucket in
//     `<details class="scope">`; it now returns the bucket alone and emits no Scope section at all.
//     Rendered and checked on a findings-less run with a checks bucket: no `<details class="scope">`,
//     the panel and its heading present. That is the right answer — a fold whose entire contents just
//     came out of it is a summary over nothing — but it is a structural change on that one shape and it
//     is written down rather than left to be found.
//   · THE KNOCKOUT LANE IS UNTOUCHED BY THE NEW CSS, which is worth saying because report.css is inlined
//     by render-knockout.mjs and shared between the two reports. That renderer emits a numbered
//     `<div class="sec">` for Scope and has no `<details class="scope">` and no `.scope-ran`, so neither
//     new selector matches anything on it. Both browser gates run BOTH lanes and both pass.
// EIGHTEENTH BREAK (#762, 2026-08-12) — the page stops speaking engine to a client. THREE changes, one
// subject: "Client prose fails the non-lawyer test" reports four defects and three of them are the same
// mistake with a different word — a CODE-OWNED TOKEN reaching a client's page with nothing between it and
// the reader.
//
// THE ORDINAL WAS CHECKED, NOT COUNTED. The sequence above is not sound: "Fifth break" appears twice
// (spec-66 at the top, PR-11 below it), four entries are dated rather than numbered ("Break of
// 2026-07-31", 08-04, 08-06), and #314 is recorded as deliberately UNNUMBERED. Counting entries gives the
// wrong answer; the highest ORDINAL written down is the seventeenth, so this is the eighteenth.
//
// ── WHAT MOVED ────────────────────────────────────────────────────────────────────────────────────────
//
//   • D4 — THE FUSED METER CAPTION. `meter()` joined two orthogonal facts with ' · ': what was found
//     (the token) and how well it is evidenced (`_status`, or the meter's own `basis`). A client read
//     "Confirmed · inferred" as one caption and as an oxymoron, because nothing on the page said the
//     separator meant "and we know that because". `meter()` now returns `{ cap, ev }` and `meters()`
//     gives them two labelled positions — `<div class="mv">Confirmed</div>` and
//     `<div class="mev">Evidence: inferred</div>`. NO FACT WORD CHANGES and nothing is re-rated: the same
//     tokens, in two places instead of one. The same pair, joined again with a comma on the cite and with
//     ' · ' on the common-law contribution list, is labelled the same way at both sites.
//   • D5 — THE DISPOSITION SUFFIX LEAVES THE CLIENT CHIP. `riskChip` appended
//     `' · ' + humanize(f.disposition)` in the band-mode branch, so every card read "Manageable ·
//     Adversarial". `disposition` is a PLACEMENT key — stages.mjs dictates that it "SETS ONLY WHERE THE
//     CARD IS PLACED IN THE REPORT (it NEVER changes the band you set above)" — and findings-model.mjs
//     already maps it to the section heading this file already prints. The suffix was the heading
//     repeated in the engine's spelling, and "Adversarial" reads as a claim about the owner's temper.
//     The internal legacy Level/Composite branch below it is untouched: that chip is reviewer shorthand.
//   • D7 — THE RAW TOOL NAME. `perplexity_research — no result` reached the page twice: through
//     `cite(f.use_check?.source, …)` on the card, and through the contribution list, where `new URL()`
//     threw on it and the catch printed `host.slice(0, 40)` — the sentinel is 31 characters, so a client
//     read the tool name WHOLE. Both sites now map it, at this boundary, BY EXACT EQUALITY AGAINST ONE
//     CONSTANT. The sentinel itself does not move in any of its three homes (stages.mjs dictates it,
//     findings-model.mjs names it in two refusals, use-check.mjs wires it into validators.narrative as
//     FATAL): archived runs carry that value forever, and a second spelling would have to be accepted
//     everywhere, over a complaint that is only ever about the page.
//
// NONE OF THIS IS A DICTIONARY, and the distinction is the whole reason the change is shaped this way.
// #669 deleted nineteen find-and-replace rules from the client surface after `axis` -> `group` turned
// "AXIS Bank filed in class 36" into "group Bank filed in class 36" — a report naming a mark that does not
// exist, inside the report that clears it. Every map added here is a CLOSED, CODE-OWNED ENUM keyed by
// exact equality — `_status`, `basis`, `_useSourceClass`, one sentinel string — which is what
// EVIDENCE_LABEL has been since spec-48. D5 adds no map at all; it deletes a field from a surface.
// client-surface-vocabulary.test.mjs arm 9 renders a mark literally named BAND, through band mode with a
// disposition and a joined status, and requires it in all three casings on the chip, the masthead and the
// card head. BAND is the sharpest case in the set: it is the engine's own word for the rating printed by
// the very chip this break edits.
//
// TWO THINGS THIS DID THAT THE ISSUE DID NOT ASK FOR, named rather than folded in:
//
//   1. THE ENFORCER'S `basis` WENT THROUGH THE NEW SLOT TOO. The issue names the `_status` fusion. The
//      no-status enforcer had its own fusion in the other direction — `${basis} — ${tok}`, i.e.
//      "Inferred — medium", evidence first and fact second. Leaving it would have put three split meters
//      beside one fused one on the same strip, which is the defect again in a smaller box. It is the
//      single largest republish cost in this break and it has its own row below (A).
//   2. `USE_SOURCE_LABEL` WAS DECLARED TWICE, WITH TWO DIFFERENT STRINGS FOR ONE CLOSED MEMBER: fullDetail
//      said 'register mirror — not evidence of use' and the contribution list said 'register mirror — not
//      use evidence'. Relabelling both sites while leaving two spellings of one vocabulary would have
//      shipped the drift knowingly, so it is one module-level const now. Row J is that row.
//
// ── the checklist, answered ───────────────────────────────────────────────────────────────────────────
//
//   1. REACHABLE FROM A REPUBLISH — YES, on all three, AND THAT IS THE POINT. This break has no
//      archived-run zero row and does not pretend to: the whole issue is that a re-rendered archived
//      report stops saying "Confirmed · inferred" and "Adversarial" to a client. `basis` is REQUIRED on
//      every meter (findings-model.mjs validateMeters refuses a meter without one), so EVERY archived
//      run's enforcer caption moves — row A, +28 bytes, is that fact, and A0 is a synthetic control
//      rather than a guarantee.
//
//      MEASURED, not claimed, by the method of the third, eighth, #470, fourteenth, sixteenth and
//      seventeenth breaks: `git show origin/main:driver/publish/render.mjs` written as a SIBLING inside
//      driver/publish/ (so its relative imports resolve identically), the same parsed inputs through both
//      modules, WHOLE-FILE bytes, ONE SHAPE PER FRESH PROCESS so no file-scope `let` carries between them.
//      Both sides read the SAME (new) report.css, so the stylesheet cancels and the columns isolate the
//      RENDERER; the stylesheet's own growth is stated below. EVERY CELL REPRODUCED THREE TIMES,
//      byte-for-byte, with the sha256 compared on every repetition.
//
//      THE FIXTURE IS THE SIXTEENTH AND SEVENTEENTH BREAKS', VERBATIM — scripts/report-print-check.mjs's
//      clearance fixture (its REPORT_MD through parseReport, its two FINDINGS, its two COVERAGE rows),
//      framework from driver/test/fixtures/knockout-brimstone/_driver/framework.json, productName through
//      `reportIdentityFor`. That fixture is LEGACY composite/level and carries no `_status`, no
//      `disposition` and no `use_check`, so it can see exactly ONE of the four changes on its own — which
//      is why A is not zero and why B-J add ONE discriminator each to it, the seventeenth break's method.
//
//        A0  A with `basis` deleted from all four meters  109,143 → 109,143     0   sha 04352ca04451f06c
//        A   the fixture VERBATIM (the archived shape)    109,156 → 109,184   +28
//        B   A + `_status` on the USE meter alone         109,168 → 109,225   +57
//        C   A + `_status` on ONE risk meter alone        109,176 → 109,233   +57
//        D   band mode, both cards banded + dispositioned 109,265 → 109,261    -4
//        E   D with the second card UNRATED (band null)   109,284 → 109,280    -4
//        F   A + the sentinel on the COMMON-LAW finding   109,218 → 109,256   +38
//        G   A + the sentinel on the REGISTER finding     109,550 → 109,594   +44
//        H   G's control: a real URL, not the sentinel    109,625 → 109,654   +29
//        I   B + C + G together (the sum check)           109,649 → 109,768  +119
//        J   a URL + `_status` + a use SOURCE CLASS       109,785 → 109,887  +102
//
//      A0 IS A CONTROL, NOT A GUARANTEE, and it is labelled that way because `basis` is required: no real
//      findings.json can produce it. What it proves is the narrower thing worth proving — that nothing
//      outside the four changes moved, and that an absent evidence word costs ZERO bytes rather than
//      rendering an empty <div> (render.test.mjs, "a meter with NO evidence to state emits no evidence
//      slot at all").
//
//      EVERY NON-ZERO CELL DECOMPOSES, and each part was computed from the two renders rather than
//      reasoned from the diff. The evidence slot's wrapper `<div class="mev"></div>` is 23 bytes:
//        +28  A. One enforcer meter, one full card (compactCard renders no meter strip). The text
//             "Inferred — medium" (19 B) becomes "Medium" (6) + the wrapper (23) + "Evidence: inferred"
//             (18) = 47. 47 - 19 = 28.
//        +29  B/C/J. The same arithmetic on a fused `<fact> · <status>` caption: "Confirmed · inferred"
//             (21 B) → 9 + 23 + 18 = 50.
//        -32  D/E. `" · Adversarial"` (15 B) off the full card and `" · Distinguished"` (17 B) off the
//             compact one. Both rows are 28 - 32 = -4, which is the enforcer row showing through.
//        +10  F/G/I. The cite: the sentinel (33 B in UTF-8) → "Marketplace search run — no result
//             found." (43 B).
//        +6   G/I. The contribution list: the separator `' · '` → `' — '` (+1) and the sentinel → the
//             short phrase (+5).
//        +1   H. That separator ALONE, on a source that is a real URL. H is the control on the MAPPING:
//             same code path, no sentinel, so nothing but the separator may move — and nothing does.
//        +7   I/J. The cite's status label, `"· "` → `"Evidence: "`.
//        +10  I/J. The contribution list's, `"("` → `"(evidence: "`.
//        +13/+14  J. The unified source phrase, against each of the two strings it replaced.
//
//      I IS THE SUM CHECK AND IT IS NOT A PLAIN SUM, which is stated because a plain sum is what a reader
//      would try: (B-A) + (C-A) + (G-A) = 74, and I - A = 91. The residual is 17 = 7 + 10, the two
//      evidence LABELS, and they are not double-counted — they materialise only where a finding carries
//      BOTH a joined status AND a use_check, which no single-discriminator shape does. That is a real
//      interaction between D4 and D7 rather than an orthogonality, and it is written down as one.
//
//      WHAT A REPUBLISH OF AN ARCHIVED RUN LOOKS LIKE: every run gains the enforcer's evidence line under
//      its appetite instead of in front of it (A). A run whose receipts were joined gains the same
//      treatment on the other three meters (B, C). A banded run LOSES the disposition suffix from every
//      chip (D, E) — a subtraction of a duplicate, never of a fact: the placement it named is the section
//      heading the card already sits under. A run whose use-check found nothing stops naming the vendor
//      (F, G). No band, no card, no count and no finding moves.
//
//   2. COULD IT LIVE IN report.css OR brand.mjs — the STYLING half did, which is the point of asking.
//      `.mev` (the evidence position's size, colour and spacing) is in report.css, hash-free, and that
//      file grew 395 bytes (33,499 → 33,894) — a figure this table does not include, because both columns
//      render against the new stylesheet so it cancels. What could NOT go there: which words the two
//      positions carry, that there are two of them at all (a second element is markup, not a style), the
//      sentinel map, and the deletion of the chip suffix — `display:none` cannot remove a substring from
//      inside a `<span>`.
//
//   3. Hash updated here, in the same commit as the edit.
//
// ── WHAT THIS BREAK DOES NOT DO ───────────────────────────────────────────────────────────────────────
//
//   · THE SENTINEL IS UNCHANGED in stages.mjs, findings-model.mjs and use-check.mjs. Mapping at the
//     boundary is the whole design; those three are another lane's files this hour in any case.
//   · report-data.json STILL CARRIES `disposition` (publish/report-data.mjs), so the component-native
//     portal path serves the placement key even though the HTML chip no longer prints it. Same shape as
//     the note the #470 break left about `legal_position`, and the same answer: a second lane's fix.
//   · THE FOURTH DEFECT (#762 D6 — a scope fragment opening with a bare dash) is NOT in this file. It was
//     fixed in render-knockout.mjs, which is not frozen. The clearance-side candidate that could produce
//     the same shape — `plainScopeNote` splitting on /(?<=[.;])\s+/, which crosses newlines because `\s`
//     matches one, so a telemetry lead-in is dropped and the bullets it led are welded onto one line — is
//     REPRODUCED AND LEFT OPEN, characterised by an arm in render.test.mjs rather than guessed at. Its
//     sibling in parse.mjs (stripTelemetry) splits per LINE first and does not have the defect; closing
//     that divergence is a second frozen-renderer change with its own republish cost and its own
//     decision, and it is reported with #762 rather than folded into it.
// Break of 2026-08-13 (#853 — a retired subsystem's name leaves the tree, including this comment).
//
// THE SMALLEST BREAK THIS FREEZE HAS TAKEN, and it is recorded at full length anyway, because a freeze
// that logs only the interesting breaks is a freeze people learn to skip. One word is deleted from one
// comment in render.mjs — the retired quality subsystem's product name, in front of "Flag/Etch
// controls". No code, no string, no template.
//
// The checklist, answered:
//
//   1. REACHABLE from a republish? NO — and this is the one case where that answer is provable rather
//      than argued. The change is inside a `//` comment, so the emitted document is byte-identical: any
//      archived run re-rendered through pool-admin's doRepublish() produces exactly the bytes it produced
//      before. The other frozen assertions in this file (the rendered-output fixtures) are untouched and
//      still pass, which is the measurement rather than the claim.
//
//   2. Could it live in report.css or brand.mjs? NO. The name was in this file, so it had to go from this
//      file. The same name in report.css went from report.css, which is correctly not frozen.
//
//   3. Hash updated here, in the same commit as the edit.
//
// Why the name could not simply be left in a comment: the repository is being prepared for publication,
// and flipping a repository public publishes its whole history. A dead product name surviving in a
// comment is a dead product name published. See #853 for the history half, which this commit cannot fix.
// Break of 2026-08-13 (#832 — plainScopeNote stops crossing newlines, and stops being a second copy).
//
// WHAT MOVED. `plainScopeNote` split the WHOLE Methodology block on /(?<=[.;])\s+/ and rejoined the
// survivors with a space. `\s` matches a newline, so the split crossed LINES: every multi-line note came
// back as one run of sentences. It now calls parse.mjs's `stripTelemetry`, the sibling rule, which splits
// per LINE first and then per sentence within a line. TELEMETRY_RE is no longer imported by this file at
// all — the renderer holds no copy of the RULE either, only a call to it, which is why the moved-transform
// assertion below now names stripTelemetry.
//
// THE DEFECT WAS NEVER THE TELEMETRY, and this is the part #832 as filed does not say. The issue frames it
// as "a scope lead-in is dropped and its bullets weld into one line". The weld does not need a lead-in to
// be dropped: rows C and F below carry NO telemetry at all and move anyway. Telemetry only made the damage
// visible — with the lead-in gone the first surviving bullet became the paragraph and the rest printed
// their dashes as literal text, which is the #762 D6 shape a client actually received.
//
// ── the checklist, answered ───────────────────────────────────────────────────────────────────────────
//
//   1. REACHABLE FROM A REPUBLISH — YES, and the scope is WIDER than the issue implies: every archived run
//      whose Methodology block has more than one line re-renders differently, telemetry or not. Runs whose
//      Methodology is ONE paragraph — the shape in mcp-server/test/fixtures/report.internal.md, taken from
//      a real delivered run — are byte-identical, and rows A and B are that fact rather than a hope.
//
//      MEASURED, not claimed, by the method of the third, eighth, #470, fourteenth, sixteenth, seventeenth
//      and eighteenth breaks: `git show origin/main:driver/publish/render.mjs` written as a SIBLING inside
//      driver/publish/ (so its relative imports resolve identically), the same parsed inputs through both
//      modules, WHOLE-FILE bytes, ONE SHAPE PER FRESH PROCESS so no file-scope `let` carries between them.
//      Both sides read the same parse.mjs and the same report.css, so both cancel and the columns isolate
//      the RENDERER. EVERY CELL REPRODUCED THREE TIMES, byte-for-byte, sha256 compared on every repetition.
//
//      THE FIXTURE IS THE SIXTEENTH TO EIGHTEENTH BREAKS', VERBATIM — scripts/report-print-check.mjs's
//      clearance fixture (its REPORT_MD through parseReport, its two FINDINGS, its two COVERAGE rows),
//      framework from driver/test/fixtures/knockout-brimstone/_driver/framework.json, productName through
//      `reportIdentityFor`. That fixture carries NO `# Methodology` section, so Z is a true zero row and
//      each row below adds exactly one Methodology block to it.
//
//        Z  no Methodology section at all              109,391 → 109,391     0  sha c9bc420ec6299917
//        A  ONE paragraph, no telemetry                109,792 → 109,792     0  sha de79676ef3f6c853
//        B  ONE paragraph WITH a telemetry clause      109,792 → 109,792     0  sha de79676ef3f6c853
//        C  multi-line, NO telemetry                   109,605 → 109,626   +21
//        D  #832's reproduction (telemetry lead-in)    109,602 → 109,608    +6
//        E  every line telemetry                       109,391 → 109,391     0  sha c9bc420ec6299917
//        F  two paragraphs, an authored blank line     109,602 → 109,608    +6
//
//      A AND B ARE THE LOAD-BEARING ZEROS. A is the archived shape; B adds a telemetry clause to it and is
//      byte-identical to A on BOTH sides, which is the proof that the telemetry rule itself did not move —
//      only where the split happens. E is the other zero and it is a different claim: every line is
//      telemetry, the note reduces to '' rather than to a string of newlines, and E equals Z exactly, so
//      the block emits NOTHING rather than an empty <div class="methnote"> plus its heading.
//
//      EVERY NON-ZERO CELL DECOMPOSES, computed from the two rendered notes rather than reasoned from the
//      diff. Before, in every row: one <p>, everything welded into it.
//        +21  C.  <p>Scope note. - Japan…. - Korea….</p>
//                 → <p>Scope note.</p><ul><li>Japan….</li><li>Korea….</li></ul>
//                 The first ` - ` (3 B) becomes `</p><ul><li>` (12) = +9; the second ` - ` becomes
//                 `</li><li>` (9) = +6; the trailing `</p>` (4) becomes `</li></ul>` (10) = +6.
//        +6   D.  The lead-in is telemetry and is dropped on BOTH sides, so the wrapper is already a <ul>
//                 and only the inner join moves: ` - ` (3) → `</li><li>` (9).
//        +6   F.  The paragraph join, a single space (1), becomes `</p><p>` (7).
//
//      WHAT A REPUBLISH OF AN ARCHIVED RUN LOOKS LIKE: a one-paragraph Methodology note is untouched. A
//      note the lawyer wrote as bullets renders as bullets instead of as one paragraph with dashes in the
//      middle of it. A note written as two paragraphs renders as two. No band, no card, no count, no
//      finding, no coverage row and no telemetry decision moves.
//
//   2. COULD IT LIVE IN report.css OR brand.mjs — NO, and not partly. There is no styling half: the change
//      is WHICH ELEMENTS exist. CSS cannot turn a substring of a <p> into an <li>, and report.css is
//      untouched by this commit.
//
//   3. Hash updated here, in the same commit as the edit.
//
// ── WHAT THIS BREAK DOES NOT DO ───────────────────────────────────────────────────────────────────────
//
//   · IT DOES NOT CHANGE WHAT COUNTS AS TELEMETRY. TELEMETRY_RE is untouched in parse.mjs; rows A/B/E
//     are the measurement of that.
//   · IT DOES NOT TOUCH render-knockout.mjs, where #762 fixed the OTHER mechanism that produces a bare
//     leading dash. That file is not frozen and was already repaired.
//   · IT DOES NOT REACH report.md OR report-data.json. plainScopeNote has exactly one caller
//     (scopeSection), so the Markdown and the data file are unaffected.
// Sixth break (2026-08-13, #854 — the Apache-2.0 licence header).
//
// The smallest break this freeze will ever take, and it is worth saying why it is a break at all. The
// only edit is two COMMENT lines, placed after the shebang:
//
//   // SPDX-License-Identifier: Apache-2.0
//   // Copyright 2026 Cordillera Sàrl
//
// added to every authored source file in the tree by scripts/spdx-headers.mjs. Apache-2.0 §4(c)
// requires the notice to be retained in source form, and this file is source we ship.
//
// Answering the checklist honestly: the change IS reachable from a republish, and it is NOT behaviour.
// Two comment lines cannot be — the parser drops them, no string in this module reads its own source,
// and nothing here is line-number-sensitive. That is the one claim worth being careful about, so it is
// CHECKED rather than asserted: the second test below strips exactly the two header lines and compares
// what is left against the PREVIOUS frozen hash. A behavioural edit smuggled in alongside the header
// fails there, exactly as it would have failed here before.
//
// EXCLUDING THIS FILE FROM THE SWEEP WAS THE ALTERNATIVE, AND IT IS WORSE: it would leave the one
// republish-reachable renderer as the only shipped source file in the repository with no licence
// notice. That is the "present on 80% of files" state #854 says is worse than having no policy at all.
// Seventh break (2026-08-14, #705 — the chrome home link's target).
//
// ONE ATTRIBUTE ON ONE ANCHOR: `homeButton` now emits `target="_blank" rel="noopener"`.
//
// Answering the checklist honestly, in order.
//
//   1. REACHABLE FROM A REPUBLISH? YES, and that is the point rather than the risk — the same shape as
//      the second break's dead connector host. Counsel reported that links inside the portal's report
//      frame are dead: the frame is sandboxed with no `allow-same-origin` (deliberate, and it stays —
//      it retires stored XSS for every report ever delivered), so a TARGETLESS anchor navigates the
//      IFRAME, where a portal-relative href cannot resolve. Every archived report carries that home
//      button. A republish repairs a link that does not work today; it rewrites no substance, no
//      finding, no number and no word a client reads.
//   2. COULD IT LIVE IN report.css OR brand.mjs? No. `target` is not a visual — it is where a link
//      goes. The style string beside it is already inline here and untouched.
//   3. WHY THE RENDERER HAD TO MOVE: `homeButton` is the emitter. There is nowhere else the attribute
//      could be added, and #705 asks explicitly for a decision between `target="_top"` (which needs
//      `allow-top-navigation` in the sandbox) and a new tab. A new tab is the option that does not
//      widen the boundary a delivered report is held behind, and the sandbox already carries
//      `allow-popups allow-popups-to-escape-sandbox`.
//
// The comment-only assertion below is UNCHANGED IN INTENT and both constants move together: this break
// is not comment-only, so FROZEN_BEFORE_SPDX advances with it and keeps meaning "everything except the
// two licence lines".
// Seventh break (2026-08-16, #1006 — the doctrine rebuild).
//
// ONE COMMENT LINE, and it is a comment that was WRONG rather than merely dated. The §L note below
// explains the token-containment rule using the mark the rule was found on, and that mark is one of
// the twelve the owner ruled real. The rebuild renames it — at which point the sentence claimed a
// neighbour shared an element of a mark it shares nothing with, and the worked name in it no longer
// contained any token of the new mark. So the example moves with the mark it illustrates.
//
// BOTH CONSTANTS ADVANCE, unlike the sixth break. FROZEN_BEFORE_SPDX strips the two LICENCE lines and
// nothing else, so it is blind to a licence change and not to this one. A break that moved only the
// first hash would be claiming licence-only; this one is comment-only, which is a weaker claim, and
// the honest way to say so is to move both rather than to widen what the second test strips.
//
// (Its FROZEN value, 56030ac6…, is superseded by the eighth break below and is recorded here only as
// the point that break started from.)

// Eighth break (2026-08-17, #854 — Apache-2.0 becomes AGPL-3.0-only).
//
// The same one line in the same place, carrying a different identifier: the owner ruled the licence and
// scripts/spdx-headers.mjs rewrote it across every authored file. Nothing else in render.mjs moved.
//
// AND THIS BREAK PROVES ITSELF, which is the whole reason the two-hash shape exists. FROZEN_BEFORE_SPDX
// is NOT updated below — it stays byte-identical to the value the seventh break left, because the
// second test strips the licence lines before hashing and the licence lines are all that changed. A
// licence sweep that had dragged a behavioural edit along with it could not leave that constant
// standing. So: one hash moves, one does not, and which is which is the evidence.
//
// It is the EIGHTH and not the seventh because #1006 landed first and took that number; this file is
// the record of how many times the freeze has been broken, so the count has to be true.

// Ninth break (2026-08-19, #1285 — the fourth advisory chip).
//
// FOUR LINES: one `.replace(/\[Filing step\]/gi, …)` beside the four already here, and the comment above
// it. `filing-routine` is a schema-valid ADVISORY_KINDS member that could never reach a client document
// — pipeline.mjs's ADVISORY_TAG had three entries to ADVISORY_KINDS' four, so the watch group #615 wrote
// to hold it ("monitoring and filing-routine are standing items") could only ever receive monitoring.
// The owner ruled on 2026-08-19 that it renders. Without a replace here, the chip the pipeline now mints
// would reach the reader as the literal text "[Filing step]".
//
// The checklist, answered:
//
//   1. REACHABLE from a republish, and INERT on every archived run. A run assembled before this lands
//      carries no "[Filing step]" token at all, so the added replace matches nothing and the bytes are
//      identical by construction — the same argument the fifth break made for its guarded line, and it
//      holds for the same reason: the new behaviour is conditional on a token only the new pipeline
//      mints. No delivered report changes.
//   2. It could NOT live in report.css or brand.mjs. The other four chips are token→span transforms in
//      this file; a fifth one written anywhere else would be the drift the arms below exist to stop, and
//      the styling it produces is `class="src"`, which report.css already owns.
//   3. Hash updated here, in the same commit as the edit.
//
// BOTH CONSTANTS ADVANCE. This is neither licence-only nor comment-only, so a break that moved only
// FROZEN would be claiming less than it did. FROZEN_BEFORE_SPDX advances to keep meaning "everything
// except the two licence lines", which is what makes it a live guard against the NEXT licence sweep
// rather than a record of the last one.
//
// Worth stating because the freeze earned its keep here: this change was scoped as a two-file edit
// (pipeline + renderer) and the freeze is what forced the third file to be found. Chasing why the hash
// moved surfaced report-data.mjs holding its own `filter((a) => a.kind !== 'filing-routine')` — the
// copy that matters most, since new runs render component-native from report-data.json. A fix that
// stopped at this file would have left the kind unreachable on every future run while the tests around
// it went green.
// Next break (2026-08-19, #1376 — the footer lockup stops carrying one firm's strapline).
//
// The footer called `logoLockup({ mark: 16, tag: 'IP Law · Switzerland · Global' })`. That literal was an
// ARGUMENT DEFAULT OVERRIDE, so it was the one brand string on the report no deployment could configure:
// setting CLEAROTRON_BRAND_TAGLINE moved the report chrome and left this footer still saying the other thing.
// Every installer who set nothing — and every installer who set everything — published a report footer
// carrying a Swiss practice's strapline. It now reads `logoLockup({ mark: 16 })`, and the argument
// defaults to BRAND.tagline in brand.mjs, which is empty unless a deployment sets it.
//
// The checklist, answered:
//
//   1. REACHABLE from a republish, and that is the repair rather than the risk — the same shape as the
//      second break, which replaced a hardcoded `mcp.example.com` connector host for exactly this reason.
//      A republished archived run now renders the strapline its deployment has CONFIGURED instead of a
//      literal nobody could configure. On a deployment that sets CLEAROTRON_BRAND_TAGLINE the footer reads
//      that value; on one that sets nothing the sub-label is dropped entirely rather than rendered empty.
//      Measured, not reasoned. The same parsed report was rendered through the frozen module and the
//      patched one, twice:
//
//         CLEAROTRON_BRAND_* set to the previous literals   frozen 97207b  patched 97207b   sha256
//                                                       1653229c62a6a6c6 BOTH SIDES — BYTE-IDENTICAL
//         CLEAROTRON_BRAND_* unset (the new default)        frozen 97207b  patched 97150b   DIFFERENT
//                                                       at exactly one place, line 619: the frozen side
//                                                       emits <span class="lk-tag">IP Law · Switzerland ·
//                                                       Global</span> and the patched side emits the
//                                                       lockup with NO lk-tag element at all.
//
//      (Both totals are 417b below the first measurement of this break, and both moved together: the
//      Swiss flag left the lockup in the same change, from brand.mjs, so it is absent on the frozen side
//      too and cancels out of the comparison. The 57b delta — the whole lk-tag element — is unchanged,
//      which is the point: it is the only thing THIS file's edit is responsible for.)
//
//      That second row is the acceptance for "an empty tagline renders as absent": the 57-byte delta is
//      the whole element, not a blank one, and no separator is left behind. A deployment that configures
//      the strapline it was already publishing gets the identical bytes it got before.
//   2. It could NOT live in report.css or brand.mjs. The literal was in THIS file, passed at the call
//      site; brand.mjs's own default is what the call site was overriding. The fix is to stop overriding
//      it, which is necessarily an edit here. brand.mjs took the half that could live there — `tag` now
//      defaults to BRAND.tagline instead of to a firm's strapline.
//   3. Hash updated here, in the same commit as the edit.
//
// BOTH CONSTANTS ADVANCE — neither licence-only nor comment-only, same reasoning as the break above.
// Next break (2026-08-19, #1339 D3 precondition — the dedupe gate becomes a shared predicate).
//
// Pure code MOTION, no behaviour. `proseHasRead` tested an inline literal
// `/(^|\n)\s*-\s*(\*\*)?\s*Risk assessment\b/i`; it now tests `READ_LEAD_RE`, imported from
// report-card-record.mjs, whose `.source` and `.flags` are byte-identical to that literal (asserted:
// source equal, flags equal). One import line and one substitution — nothing else in the file moved.
//
// WHY IT HAD TO LEAVE THIS FILE. `acceptReportCard` now REFUSES a card that carries no "Risk
// assessment"-led bullet, because this gate deletes the record's typed legal/practical reads wherever it
// matches. Two copies of that pattern — one deciding what to delete, one deciding what must exist — are
// exactly the drift breaks three, four and #832 were about, and here the drift is not a visible
// duplicate but a card that reaches the client with NO risk read at all. So the renderer holds no copy
// of the rule: it imports the one the card contract owns.
//
// The checklist, answered:
//
//   1. REACHABLE from a republish, and INERT by construction. The predicate is the same regex, so
//      `proseHasRead` evaluates identically on every card this renderer has ever seen — archived runs
//      included. No delivered report changes, and the claim is checked rather than promised: the arm in
//      a-deduped-read-must-exist-on-the-card.test.mjs asserts the renderer's gate IS the shared constant
//      and that no re-typed literal survives beside the import.
//   2. It could NOT live in report.css or brand.mjs — it is not a visual — and it could not stay here:
//      the whole point is that acceptance and the render read ONE predicate.
//   3. Hash updated here, in the same commit as the edit.
//
// BOTH CONSTANTS ADVANCE: neither licence-only nor comment-only.
// (Its values, 69b95593… / a247cb66…, are superseded by the break below and recorded here only as the
// point that break started from.)

// Next break (2026-08-20, #1438 — a record link resolves, or it is not a link).
//
// A BEHAVIOURAL BREAK, and the first in this lineage that changes what a DELIVERED report contains
// rather than how it is composed. `regHref` built a record href from `RECORD_ORIGIN || provOrigin`,
// where provOrigin was scraped from the finding's own `source.resolved_link`. The `||` is the defect:
// `record-origins.mjs` returns `[]` for a provider that publishes no per-record page, publish/index.mjs
// turns that into a null RECORD_ORIGIN, and the fallback then handed the job to whatever host happened
// to sit in that finding's source link. The refusal was computed and bypassed one file later.
//
// The renderer now takes the run's ALLOW-LIST (`opts.recordOrigins`, the same array
// `normalizeRecordLinks` repairs against) and resolves a bare `/mark/<cc>/<id>` only when that list
// names exactly ONE origin. Two origins is a composite, and choosing one of two offices is a guess. An
// already-absolute uri links only if its own origin is on the list. Plus `opts.recordCitation` from the
// provider table, which decides what a card shows where a link cannot go — the owner's per-provider
// ruling, held in the table rather than as a vendor branch in here.
//
// The checklist, answered:
//
//   1. REACHABLE from a republish, and NOT inert — which is the point. A republished archived run on a
//      provider that publishes no record page LOSES links it used to render. Those links were wrong:
//      every one pointed at a host the provider does not publish (measured on this tree before the fix
//      existed — 28 absolute anchors on one clarivate run, publish/index.mjs:754). The acceptance
//      criterion is that a republish introduces no link it did not have; removing false ones is the
//      requirement, not a side effect. A run on corsearch, EUIPO or USPTO republishes byte-identically.
//   2. It could NOT live elsewhere. The hrefs are CONSTRUCTED here, from `registrations[].uri` paths, at
//      render time — publish/index.mjs's repair pass only sees links that are already absolute, which
//      is why the two disagreed in the first place. Both now read one list.
//   3. Hash updated here, in the same commit as the edit.
//
// BOTH CONSTANTS ADVANCE: this is behaviour, not a licence line and not a comment.
// (#1438's values, 5348bfda… / be4f30be…, are superseded by the break below and recorded here only
//  as the point it started from — the same shape every earlier break in this lineage uses.)

// (Its values, 69b95593… / a247cb66…, are superseded by the break below.)

// Next break (2026-08-20, #1431 — the ridge is retired from every surface this product renders).
//
// TWO LINES, and both are removals. `<body class="has-glow watermark">` loses the watermark class — the
// rule and its ::after are deleted from shared/brand.mjs, so the class named nothing — and the import
// line drops `ridgeMark`, which this file imported and never called. Nothing else in render.mjs moved.
//
// The mark itself is the owner's call of 2026-08-20: the product is Clearotron and the mark is the
// bracket, and the background watermark is REMOVED rather than redrawn. That work is in
// shared/brand.mjs; what reaches this file is only the two lines above.
//
// The checklist, answered:
//
//   1. REACHABLE from a republish, and it CHANGES what one renders: a republished archived report loses
//      the parent company's ridge from behind its text. That is the requirement, not a regression — and
//      it closes a defect rather than only a visual one. The mask URL-encoded the asset whole, aria-label
//      included, so every emitted page's <style> carried a firm's name in a form a source grep could not
//      see (#1376 arm E measured it on the demo pool index). Removing the watermark removes the surface.
//   2. It could NOT live elsewhere. The class is applied on the body element this file emits; the CSS it
//      names lives in brand.mjs and is deleted there. Leaving the class behind would be a body attribute
//      pointing at a rule that no longer exists.
//   3. Hash updated here, in the same commit as the edit.
//
// BOTH CONSTANTS ADVANCE: this is behaviour, not a licence line and not a comment.
// (Its values, db1744e7… / 915cd160…, are superseded by the break below.)

// Next break (2026-08-22, #1100 — the disposition-mode predicate has one definition, and it is not here).
//
// TWO LINES. `DISPOSITION_MODE` is set by calling `inDispositionMode(findings)` — the predicate this
// file already imported and never called — instead of re-typing its body; and `DISPOSITION_BAND` leaves
// the import list, because reading the banding table was the only thing that body needed it for.
//
// THIS IS THE ONE BREAK IN THIS LINEAGE THAT RENDERS NOTHING NEW, and that is the argument for it rather
// than against it. findings-model's `inDispositionMode` is `(findings ?? []).some((f) => f &&
// f.disposition && DISPOSITION_BAND[f.disposition])`; the line replaced here was the same expression with
// `||` for `??`. The two can only differ on a `findings` that is falsy-but-not-nullish, and `[...findings]`
// thirty lines down would throw on any such value — so no archived report can re-render differently.
//
// WHY IT IS WORTH A BREAK AT ALL: findings-model calls that export "the mode switch both sort sites use",
// and it was not. pipeline.mjs sorts with the shared predicate; this file — the surface that PRINTS the
// report, and whose isOnField / bandOf / quadrant / keyPanel all read the flag — used a copy. Two
// definitions of one mode agree until somebody edits one, and nothing said so. #1100's class exactly.
//
// The checklist, answered:
//
//   1. REACHABLE from a republish, and it changes what one renders: NO — see above, and that is checked
//      rather than asserted (driver/test/unit-pair-classification.test.mjs pins the single definition).
//   2. It could NOT live elsewhere. The flag is module state in this file and every prominence helper
//      here reads it; the predicate it must agree with is exported from findings-model.
//   3. Hash updated here, in the same commit as the edit.
//
// BOTH CONSTANTS ADVANCE. #1375 family 3, 2026-08-23 — COMMENT-ONLY, and the first break of this
// freeze that is. Two comments asserted a defect had reached a CLIENT ("a heading delivered to a client
// as a condition"; "what a client read was the raw tool name"). The renderer's behaviour is what those
// comments describe and it is untouched: the diff is two `//` lines and nothing else.
//
// FROZEN_BEFORE_SPDX still advances, even though no licence line moved. It guards "changed by more than
// its header", not "changed behaviourally" — a comment edit moves those bytes too, and leaving it
// behind would fail the next licence sweep against a file that had legitimately moved on.
//
// Proof carried in the PR: the frozen sample rendered byte-identically before and after, with a control
// showing the comparison can tell renders apart at all.
// ── 2026-08-24, #1132: THE FREEZE MOVED, AND HERE IS WHY IT HAD TO ────────────────────────────────
//
// `render.mjs:856` dropped the entire "What we covered — and what's open" section when the coverage
// ledger had zero rows — no heading, no marker, nothing. A reader who has seen that section on another
// report could not tell a run that measured nothing from one whose section was not reached, and on the
// one delivered run in the pool that hits it the internal `Coverage read` line was gone too, so there
// was no fallback in practice either. 29 clearance reports in the pool; 28 carry the section.
//
// It could NOT live in report.css or brand.mjs: the section is not emitted at all, so there is nothing
// for a stylesheet to reach. That is the second question this header asks, and it is why the hash moves.
//
// REACHABLE FROM A REPUBLISH — the first question — and the answer is measured rather than argued.
// Rendering the same input through the old and new renderer:
//
//   POPULATED  old 297acde75f7ae202  new 297acde75f7ae202  → BYTE-IDENTICAL
//   ZERO ROWS  old 199f671c8fb1f30f  new 5d1927452bd6bd54  → different (the fix landed)
//   CONTROL — two different inputs hash differently, so the comparison can tell renders apart
//
// So a republish of any of the 28 produces the same bytes it produced before, and a republish of the
// 29th gains a disclosure it should always have carried. `rerender-all` is an explicit operator
// command, not something that runs on its own.
//
// Owner ruling 2026-08-24 ordered the build and discharged #1132's standing "only with a legitimate
// renderer change" condition. The arm below pins the empty state, so the next freeze break cannot
// silently take it away again.
// Advanced by the fifth break (tracker issue 1903) with the constant below it — this one moves on every
// break that is not licence-only, so what it guards is the NEXT licence sweep.
// Advanced again by the break below (tracker issue 1935): prose inside the file, so neither
// licence-only nor comment-only.
// Advanced again by the break below (tracker issue 1957). A comment REWRITE is not licence-only,
// so this constant moves with the other one.
// Advanced again by the sixth break below (tracker issue 2097): behaviour, so both constants move.
const FROZEN_BEFORE_SPDX = "ade003e4a60deea2c8cd57a45e22d337c870c27f769794e6f8cee84866ce0d95";
// FIFTH BREAK (2026-08-26, tracker issue 1903 — a client surface must not follow the OS).
//
// NOT code motion. A behaviour change, and the smallest one that fixes a live client-facing defect: the
// clearance report emitted the AUTO dark pair — `REPORT_ROOT_DARK` plus the OS-aware `THEME_INIT` — so a
// delivered legal document went dark on a dark-mode laptop. On the standalone file AND framed in the
// portal, because the shell does not strip that rule. The knockout renderer already took the EXPLICIT
// pair; the two report lanes disagreed and the wrong one was the bigger deliverable.
//
// Found by enumerating every server-rendered surface rather than by looking at this file: the #1892 arm
// held `loginPage` and `denialPage` BY NAME, and portal-tokens.mjs said so itself — "anything ELSE
// server-rendered is still unheld". The CI grep that enforces this rule scans the built SPA bundle, not a
// rendered report, so nothing was looking here at all.
//
// Answering the checklist honestly. The change IS reachable from a republish, and that is the point: it
// repairs reports already delivered, exactly as the second break did. It could NOT live in report.css or
// brand.mjs — both pairs already exist there and are correct; what was wrong was which pair this file
// asked for. Verified by rendering the same report through the frozen and the changed module and diffing
// the output: the ONLY differences are the 16-line `@media (prefers-color-scheme:dark)` block, now
// absent, and the toggle script no longer reading the OS to choose its target (it defaults to dark, which
// is right for a page that now always paints light). Nothing else moved; the light half is byte-identical.
//
// Dark is still fully reachable — by the toggle, and by a choice carried from any other surface through
// the shared theme key. This removes the automatic part only.
// NEXT BREAK (2026-08-27, tracker issue 1935 — the word a client does not read).
//
// Owner ruling: "weighed is not a law-friendly term." It went first on the knockout report, where he
// read it; he was then asked whether the rule reaches the clearance report and its workbook, WITH the
// republish consequence below stated, and ruled that it does. Two strings in this file move:
//
//   the impact bullet's tail   "— for the client to weigh."      -> "— for the client to consider."
//   the collapsed toggle       "Registrations weighed"           -> "Registrations considered"
//
// ANSWERING THE HEADER'S CHECKLIST, in its own order:
//
//   1. IS IT REACHABLE FROM A REPUBLISH? YES, and that is the fact the owner was given before he ruled
//      rather than after. pool-admin's doRepublish() re-renders archived runs through this file, so a
//      report delivered last month comes back next month with two different words on it. What makes
//      that acceptable here is what makes the second and fifth breaks acceptable: the substance — every
//      finding, band, record and number — is untouched, and only the house wording moves. It is a
//      repair of delivered reports rather than a rewrite of what they say. A break that changed a
//      CONCLUSION on an archived run would not clear this bar and is not what this is.
//
//   2. COULD IT LIVE IN report.css OR brand.mjs? No. Both are words, not visuals: one is a sentence
//      fragment appended to a rendered bullet, the other is a <summary> label. Neither is expressible
//      as a rule in a stylesheet.
//
//   3. HASH UPDATED HERE, IN THE SAME COMMIT as the edit. Both constants advance.
//
// ── WHAT THIS BREAK DOES NOT DO ───────────────────────────────────────────────────────────────────────
//
// It does not touch the DOCTRINE that uses the same phrase. stages.mjs's impact instruction and
// synthesis-rules.md both tell the seat that impact is surfaced "for the client to weigh" — those are
// orders to a model, not text a client reads, and editing what a seat is told can move what the engine
// produces. That is an engine change and not a copy change; it is raised on the issue as its own
// question rather than folded in here.
//
// It does not touch the validation messages in findings-model.mjs that carry the word: those are thrown
// at the driver, and no client sees them.
// NEXT BREAK (2026-08-27, tracker issue 1957 — the public-cut prose pass).
//
// THE SMALLEST CHANGE THIS FILE CAN TAKE: one comment recomposed, no code touched. The owner ruled one
// line out of the public tree — the one that explained the #599 defect by naming what a delivered
// report had carried. It was the MIDDLE of a four-line sentence, so cutting it literally welded
// "preferring the record outright is" onto "file away had the company's proper English name". The rule
// survives and the evidence for it does not: four comment lines become three, and the record's Latin
// field being a ROMANISATION is still the stated reason the SHARED decision is asked for.
//
// ANSWERING THE HEADER'S CHECKLIST:
//
//   1. REACHABLE FROM A REPUBLISH? A comment cannot be, and that is not left as an argument from first
//      principles. The clearance lane was rendered end to end from demo through the tree
//      BEFORE this pass and again AFTER it, and every artefact hashed identically — report.html,
//      report-data.json, report.md, findings.json, audit.md, meta.json and the pool index. The knockout
//      lane was rendered from its own fixture in both shapes and hashed identically too.
//
//      That comparison is worth something because it was controlled BOTH ways first. Two runs of an
//      UNCHANGED tree a minute apart disagreed until three wall-clock fields were normalised by name
//      (the report's Issued stamp in two places, and meta.json's issuedAt) — and a positive control on
//      each lane, one word changed in a string the fixture actually renders, moves the digests. An
//      earlier positive control passed on the clock rather than on the plant, because the fixture never
//      renders the bullet it was planted in; that is why the plant is now on a string grep proves is on
//      the page.
//
//   2. COULD IT LIVE ELSEWHERE? The line is a comment in this file. There is nowhere else for it.
//
//   3. HASH UPDATED IN THE SAME COMMIT. Both constants advance: a deletion is neither licence-only nor
//      no-change.
//   FOURTEENTH BREAK — THE ADDITIONAL-TERMS NOTICE (tracker issue 1740), answering the checklist above:
//
//   1. REACHABLE FROM A REPUBLISH? No. One comment line: this file's existing copyright line now carries
//      counsel's notice sentence after it. No executable byte moves.
//   2. COULD IT LIVE ELSEWHERE? No. The notice's purpose is to travel WITH the file when somebody lifts
//      it out of the repository; a statement in a document at the repository root does not.
//   3. HASH UPDATED IN THE SAME COMMIT. FROZEN advances. FROZEN_BEFORE_SPDX DOES NOT, and that is the
//      claim this break makes: it is licence-only, so stripping the two licence lines still yields the
//      bytes the thirteenth break left. Measured before either constant was touched — which is the
//      reason this file is swept rather than excluded from the sweep. An exclusion would have declared
//      the change harmless; the double-hash shape lets it be PROVED, which is what it exists for.
//   FIFTEENTH BREAK — THE DEMONSTRATION BANNER (tracker issue 2013), answering the checklist above:
//
//   1. REACHABLE FROM A REPUBLISH? YES, and that is the point rather than a side effect. A demo report
//      is the only artefact in this thread that leaves the machine, and the marking must appear on
//      reports ALREADY PUBLISHED when it is re-rendered — verified by republishing the frozen sample
//      under a marked roster and reading the banner out of the output HTML.
//   2. COULD IT LIVE ELSEWHERE? No. The console is not a surface (it does not survive a PDF or a
//      forwarded link), and the topbar is `no-print`. It sits in the hero, which is the first thing on
//      screen and the first thing on paper.
//   3. HASH UPDATED IN THE SAME COMMIT. BOTH constants advance: this break is NOT licence-only, so
//      FROZEN_BEFORE_SPDX moves with it — the fourteenth break's claim ("strip the two licence lines and
//      the bytes are what the previous break left") is exactly what must NOT be asserted here.
//
//   A CONTROL WAS RUN BEFORE TRUSTING ANY OF IT: the same republish against the SHIPPED roster, where
//   the account is unmarked, produces no banner. A marking that fires on every report would be worse
//   than none, and "it appeared" is only half a measurement.
// SIXTH BREAK (2026-08-31, tracker issue 2097 — the use-check line stops lying in both directions).
//
// Behaviour, owner-ruled ("a website does not equal a citation on a register record — so how would
// that ever line up. So yes, drop it"): (1) the use surfaces print NO verification word — a use
// meter's receipt join is unreachable for an http source, so "not yet verified" had one reachable
// value and a reviewing lawyer read it as doubt about the fact; `inferred`/`not checked` stay, and
// the register meters keep the full vocabulary untouched. (2) The "searched, nothing found" sentinel
// is matched on NORMALISED dash/whitespace instead of one spelling — the seat emitted a hyphen and
// the raw tool name reached a delivered page twice. The constant itself does not move.
//
//   1. REACHABLE FROM A REPUBLISH — and that is the point: a republish of the affected report now
//      renders the corrected line (the repair of already-delivered pages, the second break's own
//      rationale). Controls at arm level in render.test.mjs: a real source URL is untouched, a
//      source merely containing similar words is not substituted, and non-use meters keep their
//      receipt vocabulary byte-for-byte.
//   2. COULD IT LIVE ELSEWHERE? No — it is the evidence wording and the sentinel match, not a visual.
//   3. HASH UPDATED IN THE SAME COMMIT; not licence-only, so FROZEN_BEFORE_SPDX moves with it.
//
// ── BREAK, 2026-09-04 — THE GLOBAL NAMESPACE RENAME (owner ruling, pre-cut) ────────────────────────
//
//   WHAT MOVED: two lines, and both carry the renamed token. One comment, and one real read —
//   `process.env.PRELIM_MCP_URL` became `process.env.CLEAROTRON_MCP_URL`. Verified as the WHOLE of the
//   diff before the hash was touched: every changed line in the file carries the token and nothing
//   else rode along.
//
//   1. REACHABLE FROM A REPUBLISH? YES, and it is the reason this note is longer than the diff.
//      `doRepublish()` re-renders archived runs, so a box whose environment still spells this variable
//      the old way would re-render a DELIVERED report with an empty "Ask your AI" target and drop the
//      link. That is safe here only because the rename is global and lands with the environment in the
//      same change — greenfield, no public installs, our own boxes rebuilt rather than migrated (owner
//      ruling 2026-09-04). It would NOT be safe as a code-only edit, and a future reader deciding
//      whether to backport this line should stop at that sentence.
//   2. COULD IT LIVE ELSEWHERE? No. It is a variable name, and the whole point of the ruling is that
//      one namespace exists. Leaving this one read spelled the old way is the half-converted tree the
//      rename exists to prevent.
//   3. HASH UPDATED IN THE SAME COMMIT; not licence-only, so FROZEN_BEFORE_SPDX moves with it.
const FROZEN = "1bc04cf103f0737368ee7333e0b3d34e3a727c9c304604ee3c3bb02cc8a8b064";

test("render.mjs is frozen at its post-recolor content hash", () => {
  const actual = sha256(readFileSync(at("../publish/render.mjs")));
  assert.equal(actual, FROZEN, "render.mjs changed — read the header of this file before updating the hash");
});

test("#854 stripping the two licence lines leaves the file the last break left — a licence sweep carries nothing else", () => {
  // Strip exactly the two header lines and nothing else, then compare with the hash from before the
  // sweep. This is what makes "comment-only" a checked claim rather than a promise in a comment: a
  // behavioural edit that rode in with the licence sweep changes these bytes and fails right here.
  const text = readFileSync(at("../publish/render.mjs"), "utf8");
  const lines = text.split("\n");
  // THE COPYRIGHT LINE IS MATCHED BY PREFIX because it now CARRIES the additional-terms notice
  // (tracker issue 1740): counsel's sentence sits on that line rather than on a third one, so that the
  // sweep changes no file's line COUNT and no line-numbered citation moves.
  //
  // The property this arm protects is unchanged, and the definitional question was asked before the
  // matcher was widened: are the additional terms LICENCE content? They are terms under section 7 of
  // the AGPL itself, so a notice pointing at them is licence metadata exactly as the SPDX and copyright
  // lines are. The header is therefore still two lines of licence and nothing else, and stripping them
  // must still leave the bytes the last break left.
  const header = lines.filter((l) => l.trim() === SPDX || /^\/\/ Copyright /.test(l.trim()));
  assert.equal(header.length, 2, "the header is present exactly once, as two lines");
  const stripped = lines.filter((l) => !header.includes(l)).join("\n");
  assert.equal(sha256(Buffer.from(stripped, "utf8")), FROZEN_BEFORE_SPDX,
    "render.mjs changed by more than its licence header. This constant advances with every break that is "
    + "not licence-only (see the lineage above), so what it guards is the NEXT licence sweep: a sweep that "
    + "drags a behavioural edit along with it moves these bytes and fails right here, where the first "
    + "assertion could only say 'something changed'");
});

// The client-safety transforms that MOVED out of the renderer (breaks three and four) must have exactly
// ONE definition, in parse.mjs. A re-introduced local copy in render.mjs would pass the hash test on its
// next bump and silently rebuild the spec-61 R1 drift — the served report and the MCP client surface
// answering "what may a client see?" separately. Since the ninth break (one report) the renderer's own
// client fork is gone, so it still USES only the telemetry rule — plainify and ENGINE_PLAIN are DELETED
// (#669: find-and-replace over a client string ate a trademark) — but none of these may ever be
// redefined here: a local copy is how the fork grows back.
//
// #832 SHARPENED WHAT "ONE DEFINITION" MEANS HERE. The renderer imported the PATTERN (TELEMETRY_RE) and
// applied it with its own split, which is a second implementation of the rule wearing the first one's
// constant — and the two diverged exactly there: plainScopeNote crossed newlines, stripTelemetry never
// did. It imports the FUNCTION now, so the renderer holds no copy of the rule at all. Importing
// TELEMETRY_RE again would be re-opening that door, which is why the required name changed rather than
// the list simply growing.
test("the moved client-safety transforms are imported from parse.mjs, never redefined in the renderer", () => {
  const src = readFileSync(at("../publish/render.mjs"), "utf8");
  const imported = src.match(/import\s*\{([^}]*)\}\s*from\s*'\.\/parse\.mjs'/)?.[1] ?? "";
  for (const name of ["stripTelemetry"]) {
    assert.match(imported, new RegExp(`\\b${name}\\b`), `render.mjs must import ${name} from parse.mjs`);
  }
  assert.doesNotMatch(imported, /\bTELEMETRY_RE\b/,
    "#832 — the renderer takes the telemetry RULE (stripTelemetry), never the pattern to re-apply itself");
  // #669 — and the sanitizer is not imported at all, because it no longer exists. A renderer that
  // reached for it again would be reaching for the mechanism that ate the mark AXIS.
  assert.doesNotMatch(src, /\bplainify\b/, "plainify is deleted (#669) — the driver emits areaLabel instead");
  for (const name of ["stripEngineInternals", "stripTelemetry", "TELEMETRY_RE", "plainify"]) {
    assert.doesNotMatch(
      src,
      new RegExp(`^(?:const|let|function)\\s+${name}\\b`, "m"),
      `render.mjs defines its own ${name} — it must have one definition, in parse.mjs (see spec-61 R1)`,
    );
  }
  assert.doesNotMatch(src, /^const ENGINE_PLAIN\b/m, "ENGINE_PLAIN belongs to parse.mjs — see spec-61 R1");
  // One report: the renderer must never grow its audience fork back.
  assert.doesNotMatch(src, /^let CLIENT\b/m, "the CLIENT audience flag is retired — one render path (spec 2026-07-30 §5)");
  assert.doesNotMatch(src, /opts\.client/, "renderHtml takes no client option any more — one render path");
});

// #1100 — THE SAME ONE-DEFINITION RULE, FOR THE MODE SWITCH. findings-model exports `inDispositionMode`
// and its own comment calls it "the mode switch both sort sites use". It was not: this file imported it,
// never called it, and re-typed its body to set `DISPOSITION_MODE` — the flag isOnField, bandOf, quadrant
// and keyPanel all read. pipeline.mjs sorted with the shared predicate; the surface that PRINTS the
// report used a copy. Identical bodies, so nothing was wrong yet, and nothing would have said so.
//
// The check is the CALL and the ABSENCE OF THE TABLE. Asserting the call alone leaves the copy free to
// come back beside it; asserting the table's absence is what makes the copy impossible to write, because
// the body cannot be typed without `DISPOSITION_BAND`.
test("#1100 the disposition mode has ONE definition, and the renderer calls it rather than re-typing it", () => {
  const src = readFileSync(at("../publish/render.mjs"), "utf8");
  assert.match(src, /DISPOSITION_MODE\s*=\s*inDispositionMode\(/,
    "render.mjs derives its module-wide disposition mode some other way again — every prominence helper "
    + "here reads that flag, so a second derivation splits the printed report from the ordering pipeline "
    + "computed, and the two agree only until somebody edits one");
  // The SUBSCRIPT, not the token: this file's own lineage names DISPOSITION_BAND in prose, and a token
  // grep cannot tell a comment from a use.
  assert.doesNotMatch(src, /DISPOSITION_BAND\s*\[/,
    "render.mjs is reading the banding table directly again — it needs the predicate, not the table, and "
    + "holding the table is how the copy grows back");
  // POSITIVE CONTROL: the canonical definition must still be where this points, or a green result above
  // means the rule moved rather than that the renderer obeys it.
  assert.match(readFileSync(at("../findings-model.mjs"), "utf8"),
    /export function inDispositionMode\(findings\)[\s\S]{0,200}DISPOSITION_BAND\[/,
    "`inDispositionMode` is no longer the predicate this arm points render.mjs at — re-read both ends");
});

// The freeze's checklist asks whether a break CHANGES what a republish renders. This one answers no, and
// that answer is checked here rather than argued in the lineage note: the deleted line was the imported
// predicate's body with `||` where it has `??`, so the two can only part on a `findings` that is falsy
// but not nullish — and `[...findings]` thirty lines further down throws on every such value.
test("#1100 the shared predicate answers exactly what the deleted copy answered", () => {
  const deletedCopy = (findings) => (findings || []).some((f) => f && f.disposition && DISPOSITION_BAND[f.disposition]);
  const CASES = [
    [], null, undefined,
    [{}], [{ disposition: null }], [{ disposition: "" }], [{ disposition: "not-a-band" }],
    [{ disposition: "adversarial" }], [{ disposition: "off-field" }], [{ disposition: "distinguished" }],
    [{ disposition: "coexistence-partner" }],
    [null, { disposition: "adversarial" }], [{ disposition: "not-a-band" }, { disposition: "off-field" }],
  ];
  let sawTrue = false, sawFalse = false;
  for (const findings of CASES) {
    const was = deletedCopy(findings);
    assert.equal(inDispositionMode(findings), was,
      `the two definitions part on ${JSON.stringify(findings)} — the break is no longer render-neutral and `
      + "the lineage note above is wrong");
    if (was) sawTrue = true; else sawFalse = true;
  }
  // Both outcomes, or the equality above is a pair of constants agreeing.
  assert.ok(sawTrue && sawFalse, "the cases produced only one answer — this arm is not discriminating");
});

// The other half of the freeze: the portal must never reach the frozen renderer. If a portal module
// imports it, "frozen" stops meaning anything — the renderer becomes live code on a new surface, and the
// doc-31 unbound-findings trap and the republish path come with it.
test("no portal module imports a report renderer", () => {
  const driverDir = at("../");
  const portalFiles = readdirSync(driverDir).filter((n) => /^portal-.*\.mjs$/.test(n));
  assert.ok(portalFiles.length > 0, "expected at least one portal-*.mjs — did the naming convention change?");

  // render-knockout.mjs is covered too. It is not hash-frozen — it is a new sibling and will keep moving
  // — but the SERVING rule is the same for both: a report is a baked artifact, and the portal shows the
  // bytes that were published. A portal that re-renders is a portal that can show a reader something the
  // delivered file never said.
  for (const name of portalFiles) {
    const src = readFileSync(join(driverDir, name), "utf8");
    assert.doesNotMatch(
      src,
      /from\s+["'][^"']*publish\/render\.mjs["']|import\(\s*["'][^"']*publish\/render\.mjs["']/,
      `${name} imports the frozen renderer — the portal renders reports natively (or iframes the baked file)`,
    );
    assert.doesNotMatch(
      src,
      /from\s+["'][^"']*publish\/render-knockout\.mjs["']|import\(\s*["'][^"']*publish\/render-knockout\.mjs["']/,
      `${name} imports the knockout renderer — same rule: serve the baked report, never re-render it`,
    );
  }
});
