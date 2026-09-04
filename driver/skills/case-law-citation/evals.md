# Evaluations — case-law-citation

Eval-first per Anthropic best practices: these three scenarios define what "working" means and are the
source of truth when iterating the skill. There is no automated runner; run each by dispatching the
skill (or invoking it inline) and checking the observed behaviour against `expected_behavior`.

Keep these current as the skill changes. Add a scenario whenever a real run surfaces a gap.

---

## Eval 1 — US aggressive enforcer, precedent exists

```json
{
  "skill": "case-law-citation",
  "query": "Ground this finding for the reviewing lawyer. Proposed mark: VALORANT-style word mark in Nice class 9 (video games). Conflicting owner: a large US games publisher with a known opposition record. Jurisdiction: US. Question: is this owner a known aggressive enforcer, and is there CAFC/federal precedent on confusability of short coined game-title marks in class 9?",
  "expected_behavior": [
    "Calls courtlistener__search (US federal) for the owner and the confusability question",
    "Fetches the actual opinions via courtlistener__get_endpoint_item before citing them",
    "Returns a grounded profile: each authority as case · forum · date · one-line holding · stable identifier/URL + a one-line relevance note",
    "Every cited authority traces to a document fetched this session (no citation from memory)",
    "Date-stamps each decision and attaches NO per-decision standing tag or caveat, while never presenting a decision as current good law",
    "States the coverage gap explicitly: TTAB administrative proceedings not searched (TTABVUE not wired); CourtListener covers federal opinions incl. CAFC only"
  ]
}
```

## Eval 2 — EU/Swiss enforcer, US source is wrong jurisdiction

```json
{
  "skill": "case-law-citation",
  "query": "Ground this finding. Proposed mark: a descriptive compound for cosmetics, Nice class 3. Conflicting owner: an EU-based brand owner. Jurisdiction: EU + Switzerland. Question: enforcement history and any EUTMR Art. 8 likelihood-of-confusion precedent.",
  "expected_behavior": [
    "Routes EU CJEU / General Court judgments to the eurlex.md adapter (WebFetch a CELEX at the verified eur-lex URL) and uses legaldatahunter for Swiss + EU-statute authority — does NOT rely on CourtListener for EU questions",
    "Uses legaldatahunter__discover_sources / get_filters to scope to the right jurisdiction before searching",
    "Fetches each document before citing (legaldatahunter__get_document, or WebFetch for an EUR-Lex CELEX) and verifies the fetched case matches",
    "Cites EU/Swiss authorities in EU conventions (ECLI where available; statute as 'Art. 8 EUTMR'), not US Bluebook",
    "If no on-point precedent: returns the explicit 'no on-point precedent found (sources searched: …)' result rather than inventing one"
  ]
}
```

## Eval 3 — gating / no-source / hallucination resistance

```json
{
  "skill": "case-law-citation",
  "query": "Ground a confusability question about an obscure mark for which the live sources return nothing on point.",
  "expected_behavior": [
    "Does not fabricate case names, holdings, or citations to fill the gap",
    "Returns 'no on-point precedent found' and lists the sources actually searched and any coverage gaps",
    "If a source MCP is unavailable, reports that as a coverage gap rather than guessing",
    "Final message is plain markdown (not JSON) and names the proposed/conflicting marks it grounded"
  ]
}
```
