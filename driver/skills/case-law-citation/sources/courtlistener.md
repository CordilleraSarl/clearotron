# Source adapter — CourtListener (US federal case law)

CourtListener-specific translation of the universal grounding logic in `../SKILL.md`. Use for **US**
findings. Mirrors `legaldatahunter.md`'s structure so the skill reaches the same kind of grounded
profile via a different source.

## Tool reference

Fully-qualified tool names, in the `server__tool` runtime form. Allowlisted on the deployment's
reviewer agent identities via the OAuth bridge (`providers/oauth-mcp-bridge`, `--server
courtlistener`). 5000 requests/day free tier.

| Tool | Use in this skill |
|---|---|
| `courtlistener__search` | Primary search — opinions/clusters/dockets by party, citation, or full-text query. Returns leads, not authority. |
| `courtlistener__get_endpoint_item` | **Fetch the full opinion** before citing it (Step 3). Read the holding from this text. |
| `courtlistener__get_endpoint_schema` | Discover the exact query/filter params for an endpoint — **prefer this over hardcoding params** (live tool wins). |
| `courtlistener__get_counts` | Cheap pre-flight: how many hits a query returns before paging. |
| `courtlistener__get_more_results` | Page through a result set. |
| `courtlistener__extract_citations` / `courtlistener__analyze_citations` / `courtlistener__resume_citation_analysis` | Citation-network tooling — use in Step 5 to surface later decisions that cite a candidate. NOT a citator (no overruled/superseded treatment). |
| `courtlistener__get_choices` / `courtlistener__call_endpoint` | Enumerate field choices / call an arbitrary endpoint when the above don't fit. |

Alert tools (`create_search_alert`, `subscribe_to_docket_alert`, …) exist in the allowlist but are not
part of grounding — do not use them here.

## Coverage and scope

- **US federal and state court opinions**, including the **Court of Appeals for the Federal Circuit
  (CAFC)** — where trademark *appeals* land. Filter to CAFC with the court field (`court=cafc`) when the
  question is a TM appeal.
- **NOT TTAB.** Raw TTAB administrative proceedings (oppositions, cancellations, ex parte) are **not**
  here — that is TTABVUE, a separate source not yet wired. When a finding needs TTAB, say so as a
  coverage gap; do not imply CourtListener covered it.
- US only. For EU / Swiss / non-US, use `legaldatahunter.md` instead.

## Query vocabulary

- **Enforcement history of an owner:** search by party name across opinions/dockets to see whether the
  owner litigates, and how often. A high federal-litigation count is evidence toward "aggressive
  enforcer"; absence is evidence toward "no assertive enforcer".
- **Confusability precedent:** full-text search for the legal test (likelihood of confusion, the
  *DuPont* / *Sleekcraft* factors) combined with the goods/market terms, filtered to CAFC for TM appeals.
- **Discover params, don't guess.** Run `courtlistener__get_endpoint_schema` for the endpoint you are
  hitting and use the field names it returns, rather than assuming param names here. CourtListener's API
  surface is the source of truth.

## Citing convention

US authorities, practitioner form: *Party v. Party*, reporter cite, (Court Year) — e.g.
*In re E. I. du Pont de Nemours & Co.*, 476 F.2d 1357 (C.C.P.A. 1973). Pull the citation from the fetched
record, not from memory. Never present a decision as current good law, and attach no standing tag either
way (Step 5).
