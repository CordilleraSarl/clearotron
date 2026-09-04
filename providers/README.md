# Providers — the data sources a clearance searches

This directory holds one adapter per external data source. Two kinds live here:

- **Registers** — the trademark offices a clearance searches. **Exactly one is active per install**, chosen
  by `CLEAROTRON_DATABASE`. There is no default and no fallback: unset, a run refuses and names the
  variable.
- **Research and support** — the marketplace/common-law sweep (`perplexity`), the search-engine grid
  (`serpapi`), the native-script candidate lane (`jx`), and an OAuth bridge to case-law sources
  (`oauth-mcp-bridge`).

`_shared/` is the register kernel every register adapter is built from — paging, counting, screening,
the call ledger. It is not a provider.

## Is this a wrapper around one vendor?

No, and the seam is checkable rather than asserted. **`../driver/register-plan.mjs` — the module that
decides what gets searched — takes a capabilities object as a parameter and imports no vendor.** Its
only provider-side imports are from `_shared/`. Confirm it in one line:

```
grep -E "^import" ../driver/register-plan.mjs | grep -E "corsearch|clarivate|signa|euipo|uspto|free-tier"
```

That returns nothing, and an empty result is the pass here — the one match in that file is a comment
citing a chunk bound, not an import.

A vendor reaches the planner as **data**. `../driver/register-capabilities.mjs` resolves a provider id
to the frozen `CAPABILITIES` object that `<id>/src/capabilities.js` declares, and passes it in. That
resolver is the single module that names all six, and it has to: mapping ids to declarations is what
it is for. An unknown id throws loudly with no fallback capability set, because planning against
corsearch's abilities while a thinner provider executes is exactly the defect this contract prevents.

Six adapters behind one contract. **Three cost nothing in vendor fees** — `euipo`, `uspto-local`, and
`free-tier`, which is those two paired. The recommended tier is the self-serve one:
[ADR-0001](../docs/decisions/0001-register-ladder.md) recommends **Signa**, whose key is issued from
the vendor's own site, over either adapter that needs a sales agreement.

---

## Choose one register

### 1 · Signa — recommended, and the fastest route to a real clearance

One API key, issued self-serve from the vendor's own site: no sales call, no contract, no waiting. It
covers the **US and EU registers together**, plus WIPO/Madrid, the UK, Switzerland, Canada, Australia,
France, Singapore, Norway and Sweden — **eleven offices**. Native sound-alike search, exact result counts,
opposition state, and one call returns every layer of rights binding a territory, so an EU trade mark that
blocks use in France is actually found rather than missed by a national-only search.

```sh
CLEAROTRON_DATABASE=signa
SIGNA_API_KEY=...
# SIGNA_BASE_URL=...   # optional; defaults to the adapter's base
```

Coverage is not hand-typed: it is derived from the vendor's own `GET /v1/offices`, committed as a snapshot
(`signa/src/offices.generated.js`, refreshed by `bin/signa-sync.mjs`), so a change in what we claim to
search arrives as a reviewable diff. Only offices the vendor reports as `live` are searched; anything else
is disclosed as a coverage gap rather than quietly dropped.

> **The grant gap on this provider is closed.** A stage running against Signa was granted two register
> tools where its server serves four — including `register_enumerate`, the primitive that exhausts a band
> rather than returning a short list. Fixed, along with a test that compares every provider's
> advertised tools against its resolved grant, so the next one cannot drift the same way.

### 2 · Free tier — EUIPO plus a local USPTO index, no vendor, real limits

Two free public sources composed into **one** register covering the **EU and the US, and nothing else**.
Choose it when you must not pay a vendor, and know what it costs you:

- **No sound-alike search at all.** Neither source has a phonetic surface, so the composite has none. A
  phonetic slice is disclosed as a gap rather than answered with something weaker.
- **No WIPO/Madrid layer, no opposition records, no mark images.** Every territory outside the EU and US is
  disclosed as a gap.
- **EUIPO needs an account and an API application.** Sandbox access comes quickly and production needs
  EUIPO's review. **The sandbox is a frozen snapshot containing synthetic test marks — it is for wiring up
  only and must never produce a clearance.** Set `EUIPO_ENVIRONMENT=production` explicitly; sandbox and
  production are separate deployments holding different corpora.
- **The US half is a build, not a key.** A USPTO account with ID.me identity verification, a one-off
  **41.5 GB** download, roughly **9 hours** of indexing, and 20 GB of free disk. Until the index exists the
  US is disclosed as a deferred gap and the EU half runs — so you can start without it.

```sh
CLEAROTRON_DATABASE=free-tier
EUIPO_CLIENT_ID=... / EUIPO_CLIENT_SECRET=... / EUIPO_ENVIRONMENT=production
# USPTO_LOCAL_DB=/var/lib/trademark/uspto/us.db   # optional — see ../INSTALL.md
```

Either half can also be run alone: `CLEAROTRON_DATABASE=euipo` for the EU register only, or
`uspto-local` for the US register only.

### 3 · Corsearch or Clarivate — the widest coverage

Global coverage with the full analyst-grade surface — Clarivate reaches 186 offices. Both are enterprise
subscriptions: the key arrives through a sales agreement, not a signup form. Choose these when the matter
needs global reach and you already have the contract.

```sh
CLEAROTRON_DATABASE=corsearch      # CORSEARCH_SESSION_KEY=...
CLEAROTRON_DATABASE=clarivate      # CLARIVATE_API_KEY=...
```

---

## What each register can do

Derived from each adapter's own capability contract (`<provider>/src/capabilities.js`), where every value
carries the probe that established it.

| | Signa | Free tier | EUIPO | USPTO local | Corsearch | Clarivate |
|---|---|---|---|---|---|---|
| **How you get it** | self-serve key | free, two accounts | free account | free account + build | sales | sales |
| **Offices** | 11 | 2 (EU + US) | 1 (EU) | 1 (US) | global | 186 |
| **WIPO / Madrid layer** | yes | no | no | no | yes | yes |
| **Sound-alike (phonetic)** | native | — | — | — | native | search only |
| **Exact result counts** | yes | partial | yes | yes | yes | yes |
| **Opposition state** | yes | no | partial | no | yes | yes |
| **Non-Latin script index** | yes | undeclared | yes | undeclared | yes | no |
| **Mark images** | no | EU only | yes | no | yes | yes |

An empty cell means the capability is absent and a slice needing it is **disclosed as a deferred coverage
row** — never answered with a weaker substitute. That rule is the point of the contracts: under-claiming
costs coverage and says so; over-claiming produces a thin answer that reads as clean.

---

## Research and support sources

| Source | Needs | Used by | Without it |
|---|---|---|---|
| `perplexity` | `PERPLEXITY_API_KEY` — metered, prepaid credits, no free tier | The common-law and marketplace sweep, on **every** product | A clearance refuses at preflight, before a stage has spent; a knockout runs, delivers its register half, and states on the report that the open-web half did not run |
| `oauth-mcp-bridge` | A one-time OAuth login per source (CourtListener, LegalDataHunter) — **free, immediate access** | The case-law reading, on a Full country search only | The lane stays dark and the run's ledger records that it did not dispatch, so no report can claim "no adverse case law" |
| `jx` | none of its own — runs on the program the run chose | Native-script (CJK) register candidates | The lane degrades and says so |
| `serpapi` | `SERPAPI_API_KEY` — free tier available | The search-engine grid inside the CJK lane | Grid cells gap with one named cause |

Case-law setup is an OAuth flow, **not** an environment variable — see
[`oauth-mcp-bridge/README.md`](oauth-mcp-bridge/README.md).

---

## Adding or changing a register adapter

Read [`../driver/skills/prelim-register/providers/README.md`](../driver/skills/prelim-register/providers/README.md)
first — it carries the mandatory empirical-verification checklist. The short version: **never inherit a
capability claim by analogy from another provider.** Every operator, filter, pagination shape and
composition rule is probed against the live API before it is written down, and the observed figure is
recorded beside the value.

Each adapter is two halves:

- `<provider>/src/capabilities.js` — the pure capability contract. No node imports, no vendor HTTP, so the
  driver can load every contract at module load.
- `<provider>/src/core.js` — the transport: request building, paging, normalisation, the call ledger.

The driver wires them in `../driver/driver.config.mjs`, and the model-facing tool surface lives in
`../driver/engine/mcp/<provider>-server.mjs` under the neutral `register_*` names.

## Where to go next

- [`../INSTALL.md`](../INSTALL.md) — prerequisites, credentials, first run
- [`../docs/README.md`](../docs/README.md) — the documentation map
