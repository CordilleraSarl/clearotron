// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// card-frame.mjs — THE REPORT CARD'S FRAME, COMPOSED FROM THE RECORD INSTEAD OF DICTATED TO A MODEL.
//
// ── WHAT WAS WRONG ──────────────────────────────────────────────────────────────────────────────────
//
// report-card's dictation ordered the seat to type a head — `## <owner> — <MARK>, <jurisdictions>` —
// out of three fields the driver had just JSON.stringify'd into the very same dispatch, then `- ord:`
// out of a value the driver interpolated into the prompt, then `- group:` and `- source:` out of typed
// enum fields on that record. Assembly then re-parsed its own dictated values back out.
//
// The `- group:` line is the sharpest instance, and it is not a hypothetical: assembly ALREADY
// overwrote the seat's answer from DISPOSITION_GROUP on every run (the VIBRANTE mislabel is why the
// stamp exists). So the seat was ordered to type a value that was discarded on the same pass. `- net:`
// is the same — stamped from the typed record since. The dictation for both survived only because
// the stamps anchored their regexes on `^##…\n(?:- ord:…\n)?`: the driver dictated a head SO THAT it
// had something of its own to anchor on.
//
// That is the day's defect shape in one stage — a decision taken on a surface token while the record
// underneath already said it — and it is what 's S2 ruling settled: "the mechanical card fields
// (headings, ids, links, driver-stamped values) move to code NOW — uncontested."
//
// ── WHY THE HEAD RULE IS THE WHOLE REVIEW QUESTION ──────────────────────────────────────────────────
//
// `- ord:`, `- group:` and `- source:` are pure lookups. The HEAD is not: it carries two typographic
// judgments the record does not state. The seat uppercased the mark (`"qori"` → `QORI`) and
// sentence-cased the owner (`"operating entity not confirmed"` → `Operating entity not confirmed`);
// and on a common-law finding whose `mark` field is literally `"VENTURI (venturi.io)"` it did NOT
// uppercase the parenthetical, and it dropped the `, <jurisdictions>` clause entirely rather than
// writing an empty one. A naive `.toUpperCase()` ships `VENTURI (VENTURI.IO)` into a delivered report.
//
// So the rule below is NOT derived from the dictation's wording. It is derived from the delivered
// artifact and pinned to it: report-card-frame.test.mjs composes a head for every card in
// demo and asserts byte-equality against report.md's own `## ` lines — seven specimens
// including the common-law one that breaks the obvious rule. If a future edit makes the composer and
// the delivered corpus disagree, that test fails with both strings side by side.
//
// ── WHAT THIS DOES NOT DO ───────────────────────────────────────────────────────────────────────────
//
// It does not touch the `- Source: [<register> · <id>](<url>)` bullet. That bullet sits INSIDE the
// judgment block rather than in the frame, it has a no-public-URL branch, and parse.mjs lifts the head's
// "View record →" link out of it — a different change with a different blast radius, so it rode its own
// work. It is no longer seat-composed: conversion 5 moved it to report-card-record.mjs's
// `renderSourceBullet`, which builds it from the finding's own record. This sentence said it was still
// the seat's for as long as that was false, which is why it now names the file that owns it.
//
// PURE. No fs, no imports. The caller supplies the group word, because DISPOSITION_GROUP lives with
// the record model and this file must stay leaf-weight enough for any consumer to import.

/** Sentence-case the first character only; the rest of an owner's name is its own. PURE. */
export const capFirst = (s) => {
  const t = String(s ?? "").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
};

/**
 * The mark as the head displays it: uppercased UP TO the first "(", the parenthetical left alone.
 *
 * The bound is the parenthesis, not a vocabulary. A common-law finding's `mark` carries its domain
 * inline (`"VENTURI (venturi.io)"`), and a domain uppercased is a different string that no reader
 * would type — while the mark itself is a mark and is displayed as one. PURE.
 */
export const markDisplay = (s) => String(s ?? "").replace(/^[^(]+/, (t) => t.toUpperCase().trimEnd() + (/\s$/.test(t) ? " " : ""));

/** Distinct jurisdictions across the owner's registrations, in record order. PURE. */
export const jurisdictionsOf = (f) =>
  [...new Set((f?.owner?.registrations ?? []).map((r) => r?.jurisdiction).filter(Boolean))].join(", ");

/**
 * The card head, WITHOUT its "## " marker.
 *
 * `<owner> — <MARK>, <jurisdictions>`, and the jurisdictions clause is OMITTED rather than emptied
 * when the finding holds no registration — which is every common-law finding, and is what the seat
 * itself did. An empty clause would ship a trailing comma into the delivered report. PURE.
 */
export function cardHead(f) {
  const j = jurisdictionsOf(f);
  return `${capFirst(f?.owner?.name)} — ${markDisplay(f?.mark)}${j ? `, ${j}` : ""}`;
}

/**
 * The `- source:` word from the record's typed `source.source_type`.
 *
 * A CLOSED enum read off a closed enum. `both` is its own source_type rather than something inferred
 * from two others — inferring it would be this file re-judging a field synthesis already typed. An
 * unrecognised type returns null and the caller OMITS the line: a wrong word on a delivered card is
 * worse than an absent one, and an absent line is visible to the lint that reads card meta. PURE.
 */
export function sourceWord(sourceType) {
  const t = String(sourceType ?? "");
  if (t.startsWith("register")) return "Register";
  if (t.startsWith("common-law")) return "Common-law";
  if (t === "both") return "Both";
  return null;
}

/**
 * Does this card body carry its own frame, i.e. is it a card written under the RETIRED dictation?
 *
 * THE BRANCH IS FAIL-SAFE BY CONSTRUCTION, and this is deliberate. It asks whether the body opens
 * with a `### ` section — the new dictation's first line — and treats EVERYTHING ELSE as legacy.
 * A seat that ignores the new dictation and types a head anyway therefore lands on the OLD path and
 * renders exactly as it does today, instead of being handed a second, composed head above its own.
 * Keying on `/^##\s/` instead would invert that: drift would produce a doubled head in a delivered
 * report, which is the failure this whole change exists to stop happening by accident.
 *
 * Archived runs are the same case as drift and get the same answer: every card file on disk today
 * opens with `## `, so replay and re-assembly are byte-unchanged. PURE.
 */
export const carriesOwnFrame = (body) => !/^###\s/.test(String(body ?? "").trimStart());

/**
 * Compose the frame for a body that carries none, and return the full card.
 *
 * ── THE LINE ORDER IS THE LEGACY *INSERTION* ORDER, NOT THE DICTATION'S LISTING ORDER ──────────────
 *
 * This is the part that is easy to get subtly wrong. Under the retired path the seat typed head /
 * ord / group / source, and then assembly inserted `- net:` and `- open:` by anchoring immediately
 * after the head-and-ord — so the stamped lines landed ABOVE the seat's own group and source lines,
 * in the order net-then-open-reversed (open is stamped last and therefore ends up first). The
 * delivered corpus shows exactly that: `## / - ord: / - open: true / - net: / - group: / - source:`.
 *
 * Composing in the order the dictation listed the fields would produce a different, equally valid
 * looking card that silently reshuffles every delivered report. So the order here is copied from what
 * assembly actually emitted, and report-card-frame.test.mjs pins it against the real artifact.
 *
 * @param {object} f            the finding record
 * @param {string} body         the seat's judgment block, opening with `### `
 * @param {object} opts
 * @param {string} opts.group   DISPOSITION_GROUP[f.disposition], or falsy to omit the line (legacy records)
 * @param {string} opts.netLine the already-composed `- net: …` line (assembly owns its absent-marker text)
 * @param {boolean} opts.open   stamp `- open: true` (the single highest-risk card)
 * @returns {string}
 */
export function composeCard(f, body, { group, netLine, open = false } = {}) {
  const src = sourceWord(f?.source?.source_type);
  return [
    `## ${cardHead(f)}`,
    `- ord: ${f?.ordinal}`,
    open ? "- open: true" : "",
    netLine,
    group ? `- group: ${group}` : "",
    src ? `- source: ${src}` : "",
    String(body ?? "").trim(),
  ].filter(Boolean).join("\n");
}
