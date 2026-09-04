// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// own-rights.mjs — spec A4: the own-rights evidence gate for house-mark-dependent candidates.
//
// When a candidate's clearance reasoning RELIES on the client's own house mark or franchise root ("the
// prefix is the client's own registered mark", "covered by the applicant's AGE OF EMPIRES registrations"),
// that supporting claim must itself be EVIDENCED: an own-portfolio register sweep confirming the
// registrations (existence, classes, key jurisdictions), cited in the narrative. The affiliate-exclusion
// mandate governs CONFLICTS (don't flag the client against itself); it must never suppress this
// supporting-evidence sweep — those are different things.
//
// Same enforcement substrate and shape as use-check.mjs: pure over the narrative document; a reliance
// without its evidence line fails validators.narrative and drives the existing corrective-retry loop
// (PR-8: synthesis holds the READ-ONLY band tools, so the check runs inline as an owner-scoped
// band_lookup over the run's frozen register material — exactly like the inline use-check; synthesis
// no longer carries live register tools). Because that frozen material is scoped to the matter's
// dispatched slices, an empty owner lookup is NOT a register-negative about the client's portfolio —
// the honest negative names what was consulted, and the missing owner query is raised as an open
// Coverage/open-item row for the escalation lane (supplemental mint), never asserted as a sweep that
// found nothing. The satisfying line is:
//   **Own-rights source:** /mark/<cc>/<id>[, /mark/...]  (record URIs from the owner-scoped lookup)
// or the honest scoped negative that removes the crutch:
//   **Own-rights source:** no applicant-owned registrations in the searched register material
// (This module only requires the "Own-rights source:" line to exist — the source text is free-form,
// so archived runs carrying the retired "own-portfolio sweep — no registrations found" still lint.)

// Reasoning that leans on the client's/applicant's own rights. Anchored on the stock vocabulary; the
// possessive forms ("client's own", "applicant's own", "its own registered") are the load-bearing signal.
const OWN_RIGHTS_RELIANCE_RE = new RegExp([
  "(?:client|applicant|customer)'?s? own (?:live |registered |prior )?(?:mark|registration|rights|portfolio|family)",
  "house[- ]mark",
  "franchise (?:root|prefix|family)",
  "own[- ]rights (?:cover|protect|shield)",
  "(?:prefix|root|element) is (?:the )?(?:client|applicant|customer)'?s?(?: own)? (?:registered|live)",
].join("|"), "i");

const OWN_RIGHTS_SOURCE_RE = /own-?rights source\s*:/i;

// Applicant-own hypothesis: on an applicant-unknown run an identical hit carries a neutral
// "if this is the applicant's own prior filing, disregard" note (2026-06-18 — replaces the retired
// candidate-self treatment). That note is a HYPOTHESIS about identity, not clearance reasoning relying on
// the client's rights — there is nothing to evidence until the applicant is named (the late-bind re-classify
// resolves it). Without this exemption such a finding tripped own_rights_missing (caught by the B5 e2e suite).
// Matches the new note AND the retired phrasing, defensively.
const CANDIDATE_SELF_RE = /candidate-?self\s*:|is this you\?|if this is the applicant'?s own|own prior filing,?\s*disregard/i;

function isFinding(heading, block) {
  return /\bfinding\b/i.test(heading) || /\*\*\s*composite\b/i.test(block) || /\bcandidate\b/i.test(heading);
}

/**
 * Find findings whose clearance reasoning relies on the client's own house mark/franchise root without
 * citing the own-portfolio sweep evidence. Pure: empty/missing input → no violations, never throws.
 *
 * @param {string} narrativeContent  the narrative.md text
 * @returns {Array<{finding:string}>} offending findings (empty ⇒ clean)
 */
export function findOwnRightsViolations(narrativeContent) {
  const lines = (narrativeContent || "").split("\n");
  const blocks = [];
  let cur = null;
  for (const ln of lines) {
    const h = ln.match(/^(#{2,4})\s+(.*)/);
    if (h) {
      if (cur) blocks.push(cur);
      cur = { heading: h[2].trim(), body: [] };
    } else if (cur) {
      cur.body.push(ln);
    }
  }
  if (cur) blocks.push(cur);

  const violations = [];
  for (const b of blocks) {
    const block = `${b.heading}\n${b.body.join("\n")}`;
    if (!isFinding(b.heading, block)) continue;
    if (CANDIDATE_SELF_RE.test(block)) continue;         // B5c conditional treatment — hypothesis, not reliance
    if (!OWN_RIGHTS_RELIANCE_RE.test(block)) continue;   // reasoning doesn't lean on the client's own rights
    if (OWN_RIGHTS_SOURCE_RE.test(block)) continue;      // the sweep evidence (or honest negative) is cited
    violations.push({ finding: b.heading });
  }
  return violations;
}
