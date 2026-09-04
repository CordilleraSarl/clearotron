# Source adapter — Legal Data Hunter (international statutes + case law)

Legal Data Hunter (LDH) translation of the universal grounding logic in `../SKILL.md`. Use for **EU,
Swiss, and other non-US** findings — the jurisdictions CourtListener cannot reach. Mirrors
`courtlistener.md`'s structure.

## Tool reference

Fully-qualified tool names, in the `server__tool` runtime form. Allowlisted on the deployment's
reviewer agent identities via the OAuth bridge (`providers/oauth-mcp-bridge`, `--server
legaldatahunter`).

| Tool | Use in this skill |
|---|---|
| `legaldatahunter__discover_countries` | List available jurisdictions. Confirm the finding's jurisdiction is covered before searching. |
| `legaldatahunter__discover_sources` | List the government sources for a jurisdiction (courts, registries, gazettes). Scope to the right one. |
| `legaldatahunter__get_filters` | Discover the filters a search accepts — **use this instead of guessing filter params** (live tool wins). |
| `legaldatahunter__search` | Primary search across statutes and case law once scoped. Returns leads, not authority. |
| `legaldatahunter__get_document` | **Fetch the full document** before citing it (Step 3). Read the holding/text from here. |
| `legaldatahunter__resolve_reference` | Resolve a citation/reference string to its document. |
| `legaldatahunter__report_source_issue` | Flag a broken/missing source upstream — diagnostics only, not part of grounding. |

## Coverage and scope

- **108 countries, 533 government sources, ~18.6M documents** (court decisions + laws/regulations +
  doctrine). This is the Swiss / EU / non-US gap CourtListener cannot fill.
- LDH is a broad legal-data index, **not a trademark specialist**. It will surface national and EU court
  judgments and statutes, but it is not the EUIPO administrative layer. For EUIPO Boards-of-Appeal
  decisions there is no free source today — report that as a coverage gap.
- The dedicated EU court layer (CJEU / General Court judgments) now lives in
  [eurlex.md](eurlex.md) — prefer it for EU *judgments*. Keep LDH for EU **statutes** and the non-US /
  Swiss jurisdictions, and run both for an EU finding, de-duplicating by CELEX / ECLI.

## Query vocabulary

- **Scope first, then search.** Run `discover_countries` → `discover_sources` → `get_filters` to pin the
  jurisdiction and source, *then* `search`. Searching unscoped wastes calls and returns cross-border noise.
- **Enforcement history:** search the owner across the jurisdiction's court sources for opposition /
  infringement actions.
- **Confusability precedent:** search the statutory basis (e.g. likelihood of confusion under
  **Art. 8(1)(b) EUTMR**, or the national equivalent) plus the goods/market terms.

## Citing convention

EU / Swiss / national conventions — **not** US Bluebook. Use **ECLI** where the document exposes it
(e.g. `ECLI:EU:T:2020:123`); cite statute by article (`Art. 8(1)(b) EUTMR`, national code + article).
Pull every cite from the fetched document, not from memory. Never present a decision as current good law,
and attach no standing tag either way (Step 5).
