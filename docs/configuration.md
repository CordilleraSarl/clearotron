# Configuration

*How to configure risk frameworks, registers and markets for your own practice.*

This is the practice-level guide: which register you search, how risk gets rated, and what the engine
knows about each client. Environment variables and install-time setup are
[`../INSTALL.md`](../INSTALL.md); the exhaustive variable table is
[`architecture/04-configuration-reference.md`](architecture/04-configuration-reference.md).

Nothing here is a code change. Everything on this page is a file you edit.

---

## 1. Registers

The engine searches exactly **one** register provider per run, named by `CLEAROTRON_DATABASE`. There
is no default, no fallback and no secondary — unset, register work **refuses by name**, because a register
that answered "no conflicts found" while unconfigured is the most dangerous output this system can produce.

**Which one to pick is a question about how you get access, not about tuning**, and the tiers are ordered by
that:

| | Provider | How you get it | Coverage |
|---|---|---|---|
| **1 — recommended** | `signa` | **Self-serve API key**, issued from the vendor's site. No sales call | 11 offices: US, EU, WIPO/Madrid + 8 |
| **2 — free, with real limits** | `free-tier` (`euipo` + `uspto-local`) | Two free accounts, and a 41.5 GB local build for the US half | EU + US, and nothing else. No sound-alike search |
| **3 — widest coverage** | `corsearch`, `clarivate` | Credential issued by the vendor | Global; Clarivate reaches 186 offices |

**The full ladder, and what each tier can and cannot search, is
[`../providers/README.md`](../providers/README.md)** — derived from each adapter's own capability contract
rather than restated here, so this table can go stale about *access* but never about *capability*.

Either half of the free tier also runs alone: `CLEAROTRON_DATABASE=euipo` for the EU register only, or
`uspto-local` for the US only.

### The free tier

`euipo` covers the EU and nothing else. `uspto-local` covers the US and nothing else. Neither is a
clearance on its own, so `free-tier` composes them into one synthetic provider — one plan, one query
namespace, one coverage skeleton, one ledger. Nothing above the provider seam learns that two sources
are involved.

- **EUIPO** needs a free account: `EUIPO_CLIENT_ID`, `EUIPO_CLIENT_SECRET`, and
  `EUIPO_ENVIRONMENT=production`. Sandbox and production are separate deployments over different
  corpora — a sandbox credential searches a corpus that is not the register.
- **`uspto-local`** builds a local index from the USPTO bulk product. No vendor account, no
  per-query cost, and it is yours once built. Budget the disk — **and schedule the sync.** There is no
  built-in scheduler: past 24 hours since the last successful sync the provider stops counting and
  every US slice discloses as a deferred gap. [`../providers/uspto-local/README.md`](../providers/uspto-local/README.md) → *You are the scheduler* carries a systemd
  timer and a cron form.

### The paid registers

Each takes its own credential — `SIGNA_API_KEY`, `CORSEARCH_SESSION_KEY`, `CLARIVATE_API_KEY` — under **your
own agreement with that vendor.** This project supplies the adapter, never the access.

**They are not equally hard to get, and that is the whole reason the tiers are ordered as they are.** Signa
issues a key on signup; the other two arrive through a sales agreement. A register is also the only thing a
vendor subscription buys here — the reasoning stages ride your coding CLI, not a register vendor.

Credentials are preflighted at run start, so a bad key fails before a run directory exists rather than
halfway through.

### Adding your own

The adapter contract is provider-neutral and lives in
[`providers/_shared/`](../providers/_shared/): query translation, pagination, status-enum
normalisation, and record normalisation into the fields the driver reads. Write a core, wrap it in an
engine-local MCP server, register it, and add the provider's skill doc. The six steps are in
[`architecture/08-development-guide.md`](architecture/08-development-guide.md) §"How to: add a
register provider".

The real work is empirical, not code volume: operator vocabulary, composition semantics, pagination
to `has_more:false`, and status-enum truth-testing against marks you know to be live and dead. Budget
for that, not for the adapter.

**Or don't build it.** Two things make an adapter someone else's job rather than an afternoon: a
register that is reached through a partnership rather than an API, and an adapter you need supported
rather than merely written. Either is a commercial conversation —
[contact@clearotron.ai](mailto:contact@clearotron.ai). Contributing the adapter back is the other
route, and usually the cheaper one.

---

## 2. The risk framework

**The framework in force rates the matter.** A run rates under the client's own framework if one is
on file, otherwise the Generic default. There is nothing in between and no blending.

A framework is two files that travel together:

| File | What it is |
|---|---|
| `risk-framework.md` | **A prose deck** — the rubric itself, written to be reasoned *with*, not executed. |
| `risk-framework.manifest.json` | A small sidecar carrying the framework's **vocabulary**: band labels, their severity order, the entity label, provenance. |

The Generic default ships at
[`driver/skills/prelim-search/risk-framework.md`](../driver/skills/prelim-search/risk-framework.md)
with bands Very High · High · Moderate · Manageable.

**Replace it with your firm's own.** Write your rubric as prose, add a manifest naming your bands,
and point a customer profile at it with `frameworkPath`. Validators, the renderer, the archive index
and the config UI all read your band vocabulary from the manifest, so your words appear everywhere
the engine names a risk.

**The manifest carries vocabulary and order only — never a threshold, mapping table or decision
rule.** Those belong in the deck prose, where the model reasons with them. Band labels may not
contain digits, for the same reason: a band called "Level 3" invites arithmetic where judgement is
wanted. A framework and its manifest are checked as a pair.

Alongside it, `workedExamplesPath` sets the analysis depth target — worked clearances calibrated
under that framework. Absent, the generic set applies.

---

## 3. Client profiles

One JSON file per client under [`driver/profiles/`](../driver/profiles/). Four ship as working
examples: `generic` (the Generic default) plus three synthetic demo clients — `aurora` (gaming),
`zephyr` (functional drinks) and `petcary` (animal health).

A job picks its profile by **forwarding domain** — `matchDomains[]`, exact host or dot-suffix. The
applicant named in a request never selects a profile. Resolution happens once at run start and is
frozen into the run's own sidecar, so editing a profile mid-run cannot change a live run's answer.

### What a profile sets

| Field | Drives |
|---|---|
| `name`, `matchDomains[]` | Identity and resolution. Overlapping domains across files is a load-time error. |
| `platforms[]` | The store domains the common-law sweep covers. The general-web cell is implicit — never list it. |
| `defaultClasses[]`, `defaultJurisdictions[]` | What the matter assumes when a request names neither. |
| `selfExclusionOwners[]` | The client's own and affiliate names, so their own rights are not reported as conflicts against them. |
| `industry` | Sector context that sharpens which adjacencies matter. Context, never a rule that decides. |
| `riskAppetite` | A prose posture that flavours emphasis and recommended follow-up. |
| `marketplaceDensity` | `sparse` (default) or `dense` — the per-profile sweep budget. Dense fits long retail listings; gaming stores stay sparse. |
| `delivery` | Presentation only — the confidentiality header. |
| `frameworkPath`, `workedExamplesPath` | §2 above. |

### Two guardrails worth knowing

**`riskAppetite` can never move a rating.** A load-time guard rejects numeric or threshold phrasing —
`>50%`, `Level C or above`, `threshold` — because an appetite that sets a cutoff is a rating rule
wearing a posture's clothes. It changes what a report emphasises and what it recommends next. It does
not change the answer.

**There are no dead knobs.** The set of allowed keys is closed — `KNOWN_PROFILE_KEYS` in
`driver/profiles.mjs`, sixteen of them — and an unknown key hard-fails at load rather than being
silently ignored. Every one is listed against the code symbol that consumes it, and a test greps for
each symbol, so a field whose machinery is deleted fails the build instead of quietly becoming
decoration.

The table above covers the twelve a practice sets by hand. The other four choose which search runs
and how much of it: `defaultProduct`, `allowedRecipes` and `jxPolicy` select among the four products
declared in [`../driver/products.mjs`](../driver/products.mjs), and the admission caps in `runCaps` are
in [`PORTAL.md`](PORTAL.md).

---

## 4. Where the rest lives

| You want to change | Go to |
|---|---|
| Credentials, ports, paths, data locations | [`../INSTALL.md`](../INSTALL.md) §3 |
| Who may see which runs, operator tokens, instance isolation | [`../INSTALL.md`](../INSTALL.md) §8 |
| Every environment variable, with ownership tiers | [`architecture/04-configuration-reference.md`](architecture/04-configuration-reference.md) |
| Model tiers, stage timeouts, retry behaviour | [`architecture/04-configuration-reference.md`](architecture/04-configuration-reference.md) |
| Profile internals and the onboarding runbook | [`architecture/05-customer-profiles.md`](architecture/05-customer-profiles.md) |
| What each product searches | [`../driver/products.mjs`](../driver/products.mjs) — the declaration the engine reads |

**Client profiles and frameworks are not application config.** Keep them in your own private store
and point the engine at it with `CLEAROTRON_CUSTOMERS_DIR` — the bundled profiles are demo data, and a
real client's rubric does not belong in a checkout of this repo.
