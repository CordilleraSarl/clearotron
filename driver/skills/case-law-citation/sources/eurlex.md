# Source adapter — EUR-Lex (EU / CJEU + General Court case law)

EUR-Lex translation of the universal grounding logic in `../SKILL.md`. Use for **EU trademark case
law — Court of Justice (CJEU) and General Court judgments** (likelihood of confusion under
**Art. 8(1)(b) EUTMR**, enforcer profiling, distinctiveness). This is the dedicated EU court layer
that Legal Data Hunter only covers patchily; run it for EU findings **in addition to** LDH and
de-duplicate by CELEX / ECLI.

**No dedicated MCP, by design.** Unlike `courtlistener.md` / `legaldatahunter.md`, this adapter does
**not** call a `eurlex__*` server. EU judgments are published verbatim and anonymously on EUR-Lex, so
this adapter drives the agent's existing **`WebFetch`** tool against a stable, account-free URL. The
fetch-before-cite spine is unchanged — you still read every holding from the document you fetched.

## Tool reference

| Tool | Use in this skill |
|---|---|
| `WebFetch` | **Fetch the full judgment** (Step 3) from the verified EUR-Lex URL below. Read the holding, ECLI, and parties from the returned text. |
| `perplexity_research` *(or `legaldatahunter__search`)* | **Lead-finding only** — to discover a candidate case name / number when the finding doesn't already name one. A lead is **not** an authority; you must still fetch the judgment before citing. |

## The fetch pattern (live-verified 2026-06-05)

Fetch by CELEX number at:

```
https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:<CELEX>
```

This returns the full judgment text (HTML), including the **ECLI** and case number. Verified against
*Canon* C-39/97 (`61997CJ0039` → `ECLI:EU:C:1998:442`) and a General Court judgment T-162/01
(`62001TJ0162` → `ECLI:EU:T:2003:199`).

> **Do not use** `publications.europa.eu/resource/celex/<CELEX>` or the `.EN.html` suffix — both
> were tested and fail (HTTP 400 / 404 / 303-timeout). The `legal-content/EN/TXT` URL above is the
> reliable anonymous path.

### Building the CELEX from a case number (sector 6)

`6` + `YYYY` + `<type code>` + `NNNN` (case number **zero-padded to 4 digits**), where `YYYY` is the
**year in the case number** (the year the case was lodged, not decided):

| Case number | Type code | CELEX |
|---|---|---|
| C-39/97 (CJEU judgment) | `CJ` | `61997CJ0039` |
| T-162/01 (General Court judgment) | `TJ` | `62001TJ0162` |
| C-487/07 (CJEU judgment) | `CJ` | `62007CJ0487` |

Common type codes: **`CJ`** = CJEU judgment, **`TJ`** = General Court judgment, `CO` = CJEU order,
`TO` = General Court order, `CC` = Advocate-General opinion. We cite **judgments** (`CJ`/`TJ`); flag
orders/AG opinions as such if relied on.

**CELEX construction is fallible** (registration-vs-decision year, multiple documents per case). So:
**construct → fetch → confirm** the fetched page's case number and parties match the case you intended
before citing. If they don't match, treat it as a miss and do not cite — never cite a CELEX you didn't
successfully fetch and verify.

## Coverage and scope — state it honestly

- **CJEU + General Court judgments**, full text, free, no account. This is the EU court gap CourtListener
  (US-federal only) cannot reach and LDH covers only partially.
- **No native keyword search here.** This adapter is strongest when you already have a case
  **name or number** (from the finding, from LDH, or from a `perplexity_research` lead). For open-ended
  "find any EU precedent on X" discovery with no lead, recall is weak — say so, and lean on LDH /
  perplexity for the lead, then fetch the verbatim judgment here. (A dedicated EU case-law search tool
  would close this gap; none is wired today.)
- **Not** the EUIPO administrative layer: **EUIPO Boards-of-Appeal decisions** have no free API and are
  not searched — report that as a coverage gap. EUIPO *register* lookups are a different layer
  (`prelim-register`), not this skill.

## Citing convention

EU conventions — **not** US Bluebook. Cite by **ECLI** (read from the fetched page, e.g.
`ECLI:EU:C:1998:442`) with the case number and short party name; cite the statutory basis by article
(`Art. 8(1)(b) EUTMR`). Pull every cite from the fetched document, never from memory. EUR-Lex gives the
judgment text, not editorial treatment: never present a decision as current good law, and attach no
standing tag either way (Step 5).
