# Case-law grounding — VENQORI (Japan)

**Jurisdiction in scope:** Japan (single-country Full country search; this pass covers Japan only, per skill scope).

**Source routing attempted:** Per the source-selection table, Japan is a non-US, non-EU jurisdiction, so the
applicable adapter is **Legal Data Hunter** (108-country statutes and case law). CourtListener (US federal
incl. CAFC) and EUR-Lex (CJEU / General Court) are not applicable to a Japan-only finding and were not
queried for that reason, not omitted by oversight.

**Source availability — coverage gap:** Both configured MCP tool servers, `legaldatahunter` and
`courtlistener`, returned `CONNECTION_CLOSED` for this session and could not be reached. This was verified
directly (a tool lookup for `legaldatahunter__discover_sources`, `legaldatahunter__search`, and
`courtlistener__search` confirmed neither server is connected). Per the skill's failure fallback ("Source
MCP unavailable / errors → report as a coverage gap"), no document could be fetched for either finding
below. No citation is offered in place of a working source; per the fetch-before-cite discipline, an
unreachable source is reported as a gap, not filled with an unfetched or recalled authority.

---

### Grounded profile — VENQORI vs Venkuri / YIWU TENGDING UMBRELLA CO., LTD. (Japan)
- ord: 1

**Question grounded:** Is there judicial or administrative precedent bearing on confusability between
VENQORI and the live Japanese class 9 registration read ベンクリ (Venkuri), owned by Yiwu Tengding Umbrella
Co., Ltd. — i.e., is this owner shown as an aggressive enforcer, and is there case law on the goods-based
non-overlap the narrative identifies (class 9 apparatus vs. downloadable software)?

**No on-point precedent found — source unreachable, no document fetched.** Sources searched: none reachable.
Legal Data Hunter (the adapter for Japan) was unavailable this session (`CONNECTION_CLOSED`); CourtListener
(US-only) and EUR-Lex (EU-only) are out of scope for a Japan finding and were not queried. Coverage gaps:
Japanese case law and JPO Board of Appeal / IP High Court precedent on (a) this owner's enforcement history
and (b) confusability across the Japanese goods-classification line between class 9 measuring/power/
telecommunications apparatus and downloadable software were not searched. This finding's underlying register
fact (the ベンクリ registration and its goods list) is drawn from the narrative/register work, not from any
case-law source — no case or administrative decision is cited here.

---

### Grounded profile — VENQORI vs QORIQ / NXP USA, INC. (Japan)
- ord: 2

**Question grounded:** Is there judicial or administrative precedent on confusability between VENQORI and
NXP USA, Inc.'s QORIQ mark, or on NXP as an enforcer, bearing on the Japanese register in the instructed
classes?

**No on-point precedent found — source unreachable, no document fetched.** Sources searched: none reachable.
Legal Data Hunter (the adapter for Japan) was unavailable this session (`CONNECTION_CLOSED`); CourtListener
(US-only) and EUR-Lex (EU-only) are out of scope for a Japan finding and were not queried. Coverage gaps:
no search was possible for NXP's enforcement history or for confusability precedent involving QORIQ (a
semiconductor-processor mark) against VENQORI in Japan. Note also that the narrative's own spine analysis
places QOR-root marks (read コーク / クオルガ / コアアイキュー) as phonetically unrelated to VENQORI
(ヴェンコリ) when read aloud in Japanese — the case-law layer was not reached before that mechanical
conclusion, so it neither confirms nor undercuts it.

---

## Methodology and standing note

No commercial citator (Shepard's/KeyCite equivalent) is wired into this skill; no decision is ever presented
as current good law and no standing tag is applied — moot here since no decision was fetched. This report's
findings should be re-run once the `legaldatahunter` MCP connection is restored, as Japan has no other wired
case-law adapter in this skill.
