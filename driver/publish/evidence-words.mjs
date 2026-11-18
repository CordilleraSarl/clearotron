// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// publish/evidence-words.mjs — how well a meter's value is evidenced, in the report's own words.
//
// A meter's evidence is its joined status (registry-fidelity.mjs joinEvidenceStatus stamps `_status` on each
// meter), said in four words. The report's meters and the audit workbook's driver cells both say it, and they
// say it from here, so the lawyer reads the same word for the same value in both. On Use no verification word
// is printed (2026-08-31): its receipt join cannot reach the use surface, so only "inferred" and "not checked"
// are said there. Under Similarity no evidence word is printed at all (2026-11-18).
export const EVIDENCE_LABEL = Object.freeze({ confirmed: 'verified', assumed: 'not yet verified', inferred: 'inferred', 'not-checked': 'not checked' });
export const EVIDENCE_BASIS_LABEL = Object.freeze({ 'verified-from-record': 'verified', 'inferred-from-signal': 'inferred' });
export const USE_EVIDENCE_LABEL = Object.freeze({ inferred: 'inferred', 'not-checked': 'not checked' });

/** The evidence word for one meter, as the report prints it, or '' where it prints none. */
export function meterEvidence(name, entry) {
  const e = entry || {};
  if (name === 'mark_similarity') return '';
  if (name === 'use') return USE_EVIDENCE_LABEL[e._status] || '';
  // With a joined status the status replaces the raw basis word on the enforcer.
  return EVIDENCE_LABEL[e._status] || (name === 'enforcer' ? EVIDENCE_BASIS_LABEL[e.basis] || '' : '');
}
