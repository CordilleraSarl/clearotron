---
name: case-law-citation
description: Grounds risk-relevant trademark findings in cited case law and decisions instead of asserting them. Invoked by the prelim-search orchestrator at Step 4.5 to profile an aggressive enforcer or test a likelihood-of-confusion question against precedent, and usable inline in chat for ad-hoc conflict/enforcement questions. Queries live legal sources — CourtListener (US federal incl. CAFC), EUR-Lex (EU CJEU + General Court judgments, verbatim), and Legal Data Hunter (108-country statutes and case law) — and returns, per finding, on-point authorities (case or decision, forum, date, one-line holding, stable identifier) with relevance notes, or an explicit no-precedent result. Cites only from documents fetched in the session, never from memory. Use when grounding watchlist or aggressive-enforcer hits, or when a trademark conflict, confusability, or enforcement-history question needs precedent.
---

# Case-law citation

Grounds a small set of risk-relevant trademark findings in **cited precedent**, fetched live, so an
advisory assessment rests on authority rather than assertion. Universal grounding logic lives here; each
legal source is a thin adapter in `sources/`.

## How this stage runs

The **driver** dispatches it: `case-law` is a stage in its own right (`driver/stages.mjs`), a standalone
compute turn with its own context. The isolation is therefore structural — the bulky fetched documents
cannot reach any other stage's context, because no stage shares one — and it is not something this seat
arranges or can lose. Nothing here spawns a session; sequencing, fan-in and retries are the driver's.

The identical skill is also valid **inline** in ad-hoc chat when a conflict / confusability / enforcer
question arises outside a prelim run.

**Reads** — from the dispatch message (plain markdown, not JSON), for each finding to ground:
- the proposed mark and the conflicting mark / owner / entity,
- the jurisdiction(s) and Nice class(es) in scope,
- the specific question — e.g. *"is this owner a known aggressive enforcer? is there precedent on
  confusability of X vs Y for these goods?"*

**Writes** — optionally, a `case-law-findings-<slug>-<date>.md` file in the workspace (mirrors how the
register / common-law workers hand back).

**Returns to the caller** — the **final session message** (markdown): the grounded profile per finding
(see [Output](#output--grounded-profile)), plus the file path if one was written. Keep raw fetched
documents in this session — do not paste them into the final message (that defeats the isolation).

Companion files (one level deep — read the one you need):
- [sources/courtlistener.md](sources/courtlistener.md) — US federal opinions incl. CAFC; `courtlistener__*` tools.
- [sources/legaldatahunter.md](sources/legaldatahunter.md) — international statutes and case law (Swiss / EU / non-US); `legaldatahunter__*` tools.
- [sources/eurlex.md](sources/eurlex.md) — EU CJEU + General Court judgments, verbatim, via `WebFetch` (no MCP, no account).
- [evals.md](evals.md) — the three scenarios this skill is verified against.

Still-future adapter (drops in here with no change to this file): `sources/euipo.md` (EUIPO
Boards-of-Appeal decisions — no free API today). EUIPO *register* lookups are a different layer
(`prelim-register`), not this skill.

## Trigger

Called by `prelim-search` after synthesis flags the risk-relevant findings (Step 4.5). Also triggers in
chat when the user raises a trademark conflict, likelihood-of-confusion, or enforcement-history question.
Gated and optional: if this skill is absent, prelim skips Step 4.5 and delivers normally.

## Model

**Sonnet, eval-gated** when spawned from the `prelim-search` Step 4.5 seam. The work is extraction
from documents fetched **this session** — the fetch-before-cite discipline (cite only what you
fetched; read the holding from the fetched text; refuse to invent when sources are empty), not model
recall, is what keeps citations honest. That makes it a Sonnet-tier task **provided** Sonnet reliably
follows the discipline. This is the highest-stakes hallucination surface in the workflow, so trust is
gated on this skill's own evals (jurisdiction routing, fetch-before-cite, refusal-to-fabricate): if
Sonnet fails any, or a run cites/holds anything unfetched, escalate to **Opus**. Ad-hoc inline use in
chat may run on whatever the session is already on.

## Scope — light and targeted

Ground **only** the watchlist / aggressive-enforcer hits flagged in synthesis
— not every finding. Grounding all findings is cost-prohibitive and low-signal. Expect a small batch,
typically a handful per search.

## Source selection

Pick the adapter by jurisdiction; read that adapter for its query vocabulary before searching.

A case-law pass covers **exactly one territory** — it runs only on a Full country search, which is a
single-country product, and the doors refuse `caseLaw` over anything wider. So there is no
multi-jurisdiction case to handle here: one run, one jurisdiction, one adapter.

| Finding jurisdiction | Source | Adapter |
|---|---|---|
| US (federal, incl. CAFC trademark appeals) | CourtListener | [sources/courtlistener.md](sources/courtlistener.md) |
| EU — CJEU / General Court judgments | EUR-Lex (verbatim, via `WebFetch`) | [sources/eurlex.md](sources/eurlex.md) |
| Switzerland / other non-US (+ EU statutes) | Legal Data Hunter | [sources/legaldatahunter.md](sources/legaldatahunter.md) |

**MCP tool naming.** Tools are fully qualified `server__tool`, e.g.
`courtlistener__search`, `legaldatahunter__get_document`. Use exactly these names. (EUR-Lex is the
exception — it has no MCP; it uses `WebFetch`, see [sources/eurlex.md](sources/eurlex.md).) Do not
reference a source that is not wired — **EUIPO Boards-of-Appeal** has no free source today — treat it as
a coverage gap, not an available tool.

## Grounding workflow

Copy this checklist into your working notes and tick each finding through it:

```
Grounding progress (per finding):
- [ ] Step 1: Pick the source(s) by jurisdiction; read that adapter
- [ ] Step 2: Search the source for the owner and/or the confusability question
- [ ] Step 3: Fetch each candidate's full document before relying on it
- [ ] Step 4: Validate — every authority traces to a doc fetched this session (loop until clean)
- [ ] Step 5: Date-stamp each decision — no standing tag, ever
- [ ] Step 6: Write the grounded profile (or the explicit no-precedent result) + state coverage gaps
```

**Step 1 — Select source.** Use the table above. Read the chosen `sources/<name>.md` for that source's
search operators and filters.

**Step 2 — Search.** Query for the owner (enforcement history) and/or the specific confusability
question. For Legal Data Hunter, scope first with `legaldatahunter__discover_sources` /
`legaldatahunter__get_filters` so you search the right jurisdiction.

**Step 3 — Fetch before citing.** A search hit is a lead, not an authority. Retrieve the full document
(`courtlistener__get_endpoint_item` / `legaldatahunter__get_document`) and read the holding from the
fetched text.

**Step 4 — Validate (feedback loop).** Before writing anything, check each intended citation against this
rule, and loop until it passes:

> Every cited authority MUST come from a document fetched **this session**, with the holding read from
> that fetched text. Any citation you cannot tie to a fetch is **unverified** — drop it or go fetch it.
> Do not emit it.

This is the spine of the skill. Frontier models attribute case citations at roughly 4–18% accuracy and
will confidently invent case names and holdings; the fetch-and-quote discipline is the only defence.

**Step 5 — Date-stamp.** Date-stamp every decision. Where the source exposes a citation network
(`courtlistener__analyze_citations` / `courtlistener__extract_citations`), opportunistically note later
decisions that cite it. We do **not** run a commercial citator (Shepard's / KeyCite), so **never present a
decision as current good law** — and attach no standing tag the other way either. Report it and its date.

**Step 6 — Write the profile.** Use the format below, or the explicit no-precedent result, and state
what you did not search.

## Treatment and temporal handling

Free sources give citation *networks*, not editorial treatment flags. Achievable, honest handling:
date-stamp every decision and surface later citing decisions where the tools allow. Do not imply a
decision is still good law, and do not tag its standing either: no citator is wired, so such a tag is
true of every citation always — the report's methodology states what ran, once.

## Coverage gaps — state them

Name what you did not search, rather than implying completeness. Common gaps:
- **TTAB administrative proceedings** (oppositions, cancellations, ex parte) are **not** in CourtListener
  — that source covers US federal opinions incl. CAFC only. TTABVUE is a separate, not-yet-wired source.
- **EU court judgments** (CJEU / General Court) are covered verbatim via [sources/eurlex.md](sources/eurlex.md),
  but it has **no keyword search** — recall depends on having a case name/number lead (state when you had
  none). **EUIPO Boards-of-Appeal decisions** have no free API and are not searched.
- A source being unavailable is a coverage gap — report it, do not guess around it. **But say WHICH KIND
  of unavailable, and take that from the source list in your task message, never from the error text.**
  A source this deployment never enrolled is one it does not have; it is not down, not unreachable, and
  not an infrastructure or connection failure. A source that IS enrolled and genuinely failed is an
  outage, and you say so. The distinction is invisible from where you sit — an un-enrolled bridge is
  still declared to your session and still reports a closed connection, so the error you see says
  "configured" about a deployment that configured nothing. The list is right; the error is describing
  plumbing. **This changes the reason you give, never whether you disclose the gap.** A delivered report
  told a client its case-law sources had gone down when that deployment had never had them — flattering,
  and false in the direction that costs a reader most.

## Output — grounded profile

Markdown by design (robust to write mistakes, auditable, manually editable). EU/Swiss authorities use EU
conventions (ECLI where available; statute as `Art. 8 EUTMR`), not US Bluebook. Per finding, EITHER:

```markdown
### Grounded profile — <proposed mark> vs <conflicting mark / owner> (<jurisdiction>)
- ord: <N — the finding ordinal from the task message's join-key list; omit only if no listed finding matches>

**Question grounded:** <the enforcer / confusability question>

**On-point authorities:**
- *<case or decision name>* · <court/forum> · <date> · holding: <one line> · <stable id / URL>
  — relevance: <one line>
- …

**Tags:** mark type · Nice class(es) · similarity outcome (visual/phonetic/conceptual, where stated) ·
legal test applied · outcome · forum.

**Coverage gaps:** <what was not searched, e.g. "TTAB not searched — source not wired">.
```

OR, when nothing is on point:

```markdown
### Grounded profile — <proposed mark> vs <conflicting mark / owner> (<jurisdiction>)
- ord: <N>

**No on-point precedent found.** Sources searched: <list>. Coverage gaps: <list>.
```

The `- ord:` line is the deterministic join key: the driver matches each profile to its
finding by it, so the profile's bearing reaches THAT card and the report render — keep the head shape
(`### Grounded profile — X vs Y / owner (jurisdiction)`) exactly.

Optional fields (keep light — recommended, not a rigid schema): the **Tags** line above improves signal
but omit any tag the fetched decision does not actually state.

## Failure fallback

- **Source MCP unavailable / errors** → report as a coverage gap; ground from the sources that do work.
- **Search returns nothing on point** → emit the explicit no-precedent result. Never fabricate to fill it.
- **Rate-limit / 5xx on a tool** → retry once, then skip and document the gap.
