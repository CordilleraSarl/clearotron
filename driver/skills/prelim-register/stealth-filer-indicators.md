# Stealth-filer indicators

Detect "law firm as owner" (i.e., the registered owner is a legal-services entity rather than the underlying client) via the following regex / substring patterns. Any match flags the row as a candidate stealth filing — surface this in the Findings sheet and feed it into Option D Trigger 2 (one common-law query for the underlying client's marketplace use).

Canonical entry point: [prelim-register/SKILL.md](SKILL.md) lists this file and `status-rules.md` as siblings; this file references back to `status-rules.md` only for the owner-extraction fallback chain it depends on.

## Indicator patterns

Match against the normalised owner name AFTER applying the owner-extraction fallback chain in [status-rules.md](status-rules.md#owner-extraction-fallback-chain).

- `\bLLP\b` — Limited Liability Partnership
- `\bP\.?C\.?\b` — Professional Corporation (when in legal-firm context — check for accompanying "Law", "Attorneys", etc.)
- `\bADVOKAT(PARTNERSELSKAB|BYRA|FIRMA)?\b` — Scandinavian law firm suffixes
- `\bLAW (OFFICES?|FIRM|GROUP)\b`
- `\bATTORNEYS?\b` (in the owner name, not in an address)
- `\bSOLICITORS?\b`
- `\b& PARTNERS?\b` (when accompanying any of the above)
- `\bPATENT(S)? AND TRADEMARK(S)?\b`
- `\bRECHTSANWÄLTE\b` — German
- `\bAVOCATS?\b` — French
- `\bABOGADOS?\b` — Spanish
- `\b特許\b` followed by `\b事務所\b` — Japanese: patent firm

## Actions when stealth-filer detected

- Flag the row with `Stealth filer (law firm owner)` in the Findings sheet
- Trigger Option D rule 2 — one common-law query for the underlying client's marketplace use
- Capture verbatim opposition history if present — stealth-filers often have aggressive enforcement records

## False-positive guard

An owner whose name contains "LAW" but is not a law firm (e.g., "Law Industries Inc." for an industrial supplier) should be checked manually if the regex matches but no other legal-firm indicator does. Default rule: require at least TWO independent indicators above before flagging, OR a single high-specificity indicator (`\bLLP\b`, `\bRECHTSANWÄLTE\b`, `\bADVOKATPARTNERSELSKAB\b`).
