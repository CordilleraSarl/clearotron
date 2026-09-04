// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── WHICH NAMES THIS PRODUCT COULD PLAUSIBLY OWN — stated once, for every gatherer ───────────────
//
//. A production box runs more than this product. Any file gathered wholesale from a
// real box — an environment name list, a unit inventory, a port map, a process list — carries that
// box's other software with it, and a list of plausible names looks exactly like a list of correct ones
// in review.
//
// Established on step 1: a production name list was committed as the evidence a
// reviewer diffs against, and **64 of its 136 names belonged to other products** — another product's
// variables, a retired platform's, and personal integrations whose names identify a PERSON. No values.
// Names alone, which in a repository whose whole point is being de-identified is enough.
//
// ══ AN ALLOWLIST, NEVER A DENYLIST ══
//
// A denylist cannot know about the software installed on that box next month. It is written against the
// things that were there when someone last looked, and its silence afterwards reads exactly like a
// clean gather. This list says what THIS product owns; everything else is dropped, including things
// nobody has heard of yet.
//
// ══ ADDING A PREFIX ══
//
// Add it here and nowhere else, and only if this product genuinely owns it. A prefix added to let one
// awkward name through re-opens the gap for every future gather — the cost is not local.
export const PRODUCT_NAME_PREFIXES = Object.freeze([
  "PRELIM", "CLEAROTRON", "PORTAL", "TRADEMARK_MCP", "CLIENT_MCP", "CLIENT_ACCESS",
  "CLIENT_CF", "PROFILE", "RECIPE", "MCP_A",
]);

// ══ A PREFIX LIST ALONE IS THE WRONG ANSWER, AND IT WAS THE ONE IN USE ══
//
// The filter this generalises was prefixes ONLY. Measured against the committed evidence file: it drops
// 16 of 72 names, and MOST OF THEM ARE THIS PRODUCT'S OWN — the credentials for its register and
// research providers, which are named after the vendors they reach rather than after this product.
// Re-gathering with that filter would silently delete them from the very file a reviewer diffs against,
// which is the same defect in the opposite direction: a filter that looks clean and removes evidence.
//
// So the credential names are INJECTED, derived by the caller from the provider declarations
// (`AMBIENT_KEYS` in bin/onboard.mjs, itself built from the provider specs). Transcribing them here
// would go stale the day a provider is added — which is precisely the failure this issue is about.
// THREE SOURCES, ALL DERIVED, because no one of them is complete:
//   prefixes        — this product's own namespaces (CLEAROTRON_*, CLEAROTRON_*, PORTAL_* …)
//   catalogueNames  — every variable its own .env.example files document
//   credentialNames — the provider credentials, built from the provider specs (AMBIENT_KEYS)
//
// Measured against the committed production name list: prefixes alone drop 16 of 72 names and MOST OF
// THEM ARE OURS — the register and research credentials, which are named after the vendors they reach
// rather than after this product. Re-gathering with that filter would have silently deleted them from
// the file a reviewer diffs against: the same defect in the opposite direction, a filter that looks
// clean and removes evidence. The union drops 2 of 72, and still rejects every foreign name probed.
export function makeIsProductOwned({ credentialNames = [], catalogueNames = [] } = {}) {
  const exact = new Set([...credentialNames, ...catalogueNames].map((n) => String(n)));
  const rx = new RegExp(`^(?:${PRODUCT_NAME_PREFIXES.join("|")})`);
  return function isProductOwnedName(name) {
    const n = String(name ?? "");
    return rx.test(n) || exact.has(n);
  };
}

// ══ A FILTER THAT DROPS SILENTLY IS THE FAILURE MODE, NOT THE FIX ══
//
// The allowlist is not going to be exactly right — two names set in production are this product's own
// and appear in none of the three sources, because its own catalogue does not document them. A filter
// that quietly removed those would replace one invisible loss with another.
//
// So a gather PARTITIONS and the caller reports both halves. The reviewer sees a count and the shape of
// what went, and can tell "it dropped another product's software" from "it dropped something of ours
// that nothing documents" — which are different problems with different fixes.
export function partitionByOwnership(names, isOwned) {
  const kept = [], dropped = [];
  for (const n of names) (isOwned(n) ? kept : dropped).push(n);
  return { kept, dropped };
}

// Grouped by FIRST TOKEN and counted, never listed. A dropped name can identify a person — that is one
// of the three classes the incident behind this found — so the report says the shape, not the names.
export function droppedShape(dropped) {
  const by = new Map();
  for (const n of dropped) {
    const head = String(n).split("_")[0];
    by.set(head, (by.get(head) ?? 0) + 1);
  }
  return [...by.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** The sentence a gathered-evidence file must carry, so the filter is visible where the names are. */
export const FILTER_DECLARATION =
  "FILTERED to names this product could plausibly own (an allowlist of its own prefixes, "
  + "shared/product-owned-names.mjs). A box runs other software and its names are not ours to publish; "
  + "an allowlist is used rather than a denylist because a denylist cannot know what is installed next "
  + "month. Anything not matching was dropped at gather time, not in review.";

// ══ THE REGISTRY — which committed files are GATHERED EVIDENCE ══
//
// A gathered-evidence file is one whose contents were read off a real box wholesale, because gathering
// selectively is how you miss the thing you were looking for, and then committed so a reviewer can diff
// against it without the privilege to re-read it. Every one of them carries that box's other software
// unless something removed it, and "something removed it" has to be the GATHERER — a filter that lives
// in the reviewer's eye cannot stop a refresh re-importing what the last pass took out.
//
// Registered here so the rule has a corpus. Adding a file to this list is the cheap half; the guard
// beside it then requires the file to say what it was filtered to.
export const GATHERED_EVIDENCE_FILES = Object.freeze([
  Object.freeze({
    path: "docs/architecture/env-set-in-production.txt",
    gatheredBy: "scripts/env-classify.mjs --gather-prod",
    holds: "environment variable NAMES set on the production box; no value is read into it",
  }),
]);

// The marker a gathered-evidence file must carry. Matched on this phrase rather than the whole
// declaration so the wording can be improved without silently un-marking every file.
export const FILTER_MARKER = "FILTERED to names this product could plausibly own";
