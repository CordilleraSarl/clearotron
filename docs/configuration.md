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

### Writing your own, step by step

**Nothing here is a code change.** Two files go into your own store; a profile points at one of them.

**1. Write the deck.** A markdown document. It is reasoned *with*, so write it the way you would brief a
colleague: what each band means, what it turns on, what to do about it. Give **every band a heading of
its own**, spelled exactly as you will spell it in the manifest, and under each heading write the rungs
as bold-led bullets:

```markdown
## High

- **What it is.** A live registration for a similar mark in a class the client will trade in.
- **What it turns on.** Whether the goods actually overlap, and whether the owner is using the mark.
- **What to do.** Advise against adoption unless the owner's non-use can be established.
```

That shape is not decoration. The profile screen extracts what the bands mean from these headings and
bullets, and **it is all or nothing**: one band without a heading, or one heading with no bold-led
bullet, and the box explaining your bands silently does not render at all — while the title and the
coloured pills still do, so the page looks finished. Frameworks in this repository have shipped in
exactly that state, which is why there is now a command that tells you before a client sees it.

**2. Write the manifest**, beside the deck and named after it: `your-framework.md` needs
`your-framework.manifest.json`. The path is derived, never configured, so the two cannot drift apart.

```json
{
  "schema_version": 1,
  "framework_key": "your-firm-2026",
  "title": "Your firm's clearance risk framework",
  "source_deck": "Where this came from, and when it was last reviewed",
  "entity_label": "the company",
  "bands": [
    { "label": "Very High", "tone": "severe" },
    { "label": "High",      "tone": "high" },
    { "label": "Moderate",  "tone": "medium" },
    { "label": "Manageable","tone": "low" }
  ],
  "structure": { "kind": "bands" }
}
```

Every key above is required and **no other key is allowed** — an unknown one is refused by name rather
than ignored. `schema_version` is `1`. `framework_key` is lowercase letters, digits and hyphens.
`bands` runs **most severe first**; that order is the framework's severity order everywhere the engine
names a risk. A band label may contain letters, spaces, slashes and hyphens, and **no digits** — a band
called "Level 3" invites arithmetic where judgement is wanted. `tone` is one of `severe`, `high`,
`medium`, `low`, `minimal`, and it chooses a colour, nothing else. `entity_label` is how your deck names
the client side in prose. If your deck is a matrix rather than a ladder, say
`"structure": { "kind": "matrix" }` — the matrix itself lives in the deck prose, never here.

**The manifest carries vocabulary and order only.** No threshold, no mapping table, no decision rule.
Those belong in the deck, where they are read as reasoning rather than applied as arithmetic.

**3. Put both files in your own store** and point a profile at the deck with `frameworkPath`. Client
rubrics deliberately do not live inside a checkout of this product.

**4. Check it before it is in force**, with the pre-flight. It opens both files exactly as a run would,
prints what they declare, and where the deck and the manifest disagree it names the band and says what
the deck did not do. It creates nothing, rates nothing and contacts nobody.

```
clearotron framework skills/prelim-search/your-framework.md
```

```
Framework: skills/prelim-search/your-framework.md
  deck      /srv/clearotron-config/skills/prelim-search/your-framework.md
            read from the configured store
  manifest  /srv/clearotron-config/skills/prelim-search/your-framework.manifest.json
            read from the configured store

It declares itself "Your firm's clearance risk framework" (your-firm-2026), a bands-shaped
framework rating the company.

The ladder, highest risk first:
  1. Very High        severe
  2. High             high
  3. Moderate         medium
  4. Manageable       low

What the deck defines:
  ✓ Very High        Advise against adoption; the owner is likely to enforce.
  ✗ High             the section under this band's heading states no rungs — a bands-shaped
                     deck writes each rung as a top-level `- **Label.** text` bullet

Not ready:
  1 of 4 bands are named in the manifest and not defined in the deck. The profile screen shows
  what the bands mean only when EVERY band is defined, so one miss empties the whole box.
```

It exits 0 when the two agree and 1 when they do not, so it can gate a deployment. `clearotron
brandowner add --dry-run` prints the same report for the framework it would set.

**It also tells you which file answered.** Resolution looks in your store first and falls back to this
repository, and the repository ships decks under names a customer may well have chosen too. A deck that
went missing from your store is therefore replaced by ours rather than reported absent — same band
words, different rubric, nothing raised anywhere. When that happens the report says so, above the
verdict, and the profile screen writes a line to the log.

**Then open the profile screen** for a company using it, and confirm you see the framework's title, your
band names in your order, and the box explaining what each band means.

### What is checked, and what is not

| | |
|---|---|
| The deck file exists | checked, and a run refuses without it |
| The manifest parses, and its keys and band labels are legal | checked, by name |
| The deck's headings and bullets match the manifest's bands | checked, by `clearotron framework` — and by the test suite, for every framework this installation can reach |
| Which file answered when your store and this repository both have one | reported by `clearotron framework`, and written to the log at view time |
| Whether the rubric is any good | **not checked, and cannot be** |

That last row is the one to hold on to. A framework is reasoned with on every search the company ever
runs, and nothing reads it for sense. **A framework that is subtly wrong produces confident ratings that
look exactly like right ones.** Have it read by whoever would sign the advice, before it is pointed at.

---

## 3. Client profiles

One JSON file per client under [`driver/profiles/`](../driver/profiles/). Two are published as working
examples: `generic` (the Generic default) and the demo brand owner. Three further synthetic profiles —
gaming, functional drinks and animal health — exist in the repository for the test suite and are left
out of the package.

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
