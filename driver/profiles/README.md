# Per-customer profiles

One JSON file per customer, git-owned — authored by hand in the config store or saved through the
`profile-service.mjs` editor (staff on any profile, a client on their own). Neither path has a PR
gate: a UI save is a validated **auto-commit**. What holds the line is the shared validator — every
write re-runs the driver's own load-time validators, so the UI cannot persist a profile the driver
would reject, and the commit is authored as the verified Access identity. Customers are onboarded
**one at a time** as a bespoke engagement.

## How a job picks its profile

**`job.profileKey` first, then forwarder domain.** The intake AI resolves WHO the customer is and
stamps `job.profileKey`; `resolveProfile(job)` returns the roster entry that key names, so this code
is the deterministic floor UNDER that judgment rather than a second guess at it. A named-but-unknown
key THROWS `profile_key_unknown` instead of falling back: a silent fall to `generic` strips the
customer's platforms, their self-exclusion seed and the framework that RATES the matter, which is a
wrong deliverable rather than a degraded one — it shipped one on 2026-07-18. (Intake's `validateJob`
clarifies a typo'd key before any run, so the throw is the deleted-profile-mid-flight edge.)

With no key, `resolveProfile(job)` matches `job.forwarderDomain` against each
profile's `matchDomains[]` (exact host or dot-suffix — the original `selectCustomer` semantics),
else `generic.json`. The applicant named in the request (`job.customer`) NEVER selects a profile —
it only activates `selfExclusionOwners[]` when it matches the profile's `name`
(`applicantMatchesProfile`: word-boundary containment, so an aurora-interactive.example-forwarded
search for a third-party applicant never buries genuine Aurora Interactive-owned conflicts as
"own rights").

Resolution happens ONCE at run start and is frozen into the run's sidecar
`_driver/profile.json` — resumes, re-runs, and experiments read the sidecar, so editing a profile
file mid-run can never change a live run's floor or platform grid. A mid-run customer reply
re-classifies findings only; it never re-resolves the profile.

## Fields (every one has working machinery — no dead knobs, enforced)

**KIND** names which layer a field belongs to: **structural** = data the engine needs; **context** =
informs the reasoning (never a rule that decides); **delivery** = presentation only; **rating
authority** = it decides which framework RATES the matter, which is precisely the layer that is
neither context nor presentation; **entitlement** = which searches this account may run; **admission**
= whether a request is let in at all. **Enforcement:** the set of
allowed keys is closed (`KNOWN_PROFILE_KEYS`) — an unknown key hard-fails at load (deny-unknown-key) — and
every field is listed in the `FIELD_CONSUMERS` manifest (`profiles.mjs`) with the exact code symbol that
consumes it; a unit test greps each symbol, so a field with no live consumer fails CI (no dead knobs).

| Field | KIND | What it drives |
|---|---|---|
| `name` | structural | the customer identity the self-exclusion gate matches against |
| `matchDomains[]` | structural | forwarder-domain resolution (overlaps across files are a load-time error) |
| `industry` | context | matter-frame **sector context** — sharpens which sectors/adjacencies matter for the vertical (e.g. food/ingestible adjacency for a beverage brand); falsy-omitted, so an empty profile renders the matter-frame message byte-identical. Context, never a rule that decides a finding |
| `platforms[]` | structural | the store DOMAINS the common-law grid sweeps — dictated verbatim into the worker's task message AND enforced by the receipts gate's platform-identity join. The general-web cell is implicit (always swept; never list it) |
| `defaultClasses[]` | structural | matter-frame default when the request names no classes |
| `defaultJurisdictions[]` | structural | matter-frame "materially matters" seed |
| `selfExclusionOwners[]` | structural | the customer's own/affiliate names — own-rights classification seed, applicant-gated as above |
| `delivery` | delivery | `{ email: "summary", privileged: bool }` — the "Privileged & Confidential" header. Two further optional sub-keys are accepted: `style` (a prose string, guarded by the same anti-rule check as a context pack, dictated into the `report-overview` and `report-card` stages as presentation tone and never to `synthesis`, the rating stage) and `template` (a report-template name; `"standard"` is the only one that exists, and it is the default). **Absent ⇒ neutral default** (`{email:"summary"}` — deliberately SILENT on `privileged`, which is three-state on every surface that reads it (`confPosture`): `true` extends the marking to "Attorney Work Product", `false` is a deliberate OFF, and absent is no opinion, which gets the plain "Privileged & Confidential" every legal deliverable carries. Saying `false` in the neutral overlay read as an instruction to strip the marking, and a Generic-default clearance shipped with no line at all). `email` no longer selects anything: every run's mail is a COVER NOTE pointing at the one report. The old `"table"` value — a full review table inlined into the mail body — is **retired**; it is still accepted at load so stored profiles keep validating, and folded to `"summary"` by `normalizeDelivery`. A customer who wants their own house format gets it drafted by the assistant from the run's `report-data.json`, where a person reads it before it goes |
| `riskAppetite` | context | a PROSE-POSTURE string (optional) that flavours **emphasis + recommended follow-up** in delivery curation — the two stages that are dictated it, `report-overview` and `report-card` — **never the Level/Composite**. A load-time anti-threshold guard rejects numeric/threshold phrasing (`>50%`, `Level C or above`, `threshold`); the "never decides" invariance itself is gated by review |
| `marketplaceDensity` | structural | `"sparse"` (default) \| `"dense"` — selects the per-profile grid cell budget so a byte-heavy marketplace's verbatim stdout fits the worker output channel (sparse ⇒ 98-cell budget; dense ⇒ 16). Dense fits long retail listings (Zephyr beverages/supplements); gaming stores stay sparse |
| `frameworkPath` | rating authority | optional path to the customer's OWN risk framework (`skills/prelim-search/<file>.md`, path-escape-blocked). **The framework in force RATES the matter** — the customer's own if on file, else the Generic default `risk-framework.md`; nothing in between. Each framework is a prose deck (the client's own rubric, reasoned WITH) plus a `.manifest.json` sidecar carrying its band vocabulary (`test/framework-lint.test.mjs` guards the pair). Git + legal-team gated; the config UI shows which is in force, read-only |
| `workedExamplesPath` | context | optional path to a per-customer worked-examples set (`skills/prelim-search/<file>.md`). The analysis DEPTH TARGET in `synthesis`, calibrated under that customer's framework; **absent ⇒ the Generic default `worked-examples.md`** |
| `defaultProduct` | entitlement | which of the four searches runs when a request names none (`search-policy.mjs`). May be left unset, and that is not a gap — a clearance that names no product is then named by its own resolved territories |
| `allowedRecipes[]` | entitlement | the closed menu of searches this account may trigger; non-empty when present, and **absent ⇒ everything allowed** |
| `jxPolicy` | entitlement | the native-language deepening POSTURE — declared lanes / escalation / provider stance. Policy, never capability; frozen into the run sidecar so a resume keeps the posture the run started under |
| `runCaps` | admission | per-account admission caps `{maxQueued?, dailyRuns?, monthlyRuns?}` — integers 1–10000, at least one set when the block is present. Enforced at the runner's claim chokepoint (`checkRunCaps`) so every intake door is covered, because the RUN-slot cap does not bound a client that can trigger its own searches. Two things to know before relying on one: a client-started run with no `dailyRuns` still gets `DEFAULT_CLIENT_DAILY_RUNS`, and `generic` is exempt by design (it is not a brand owner) |

**Derived, never stored** (a stored copy would drift): `minCellsPerVariant = platforms.length + 1`
(the +1 is the general-web cell) and the grid batch size `floor(budget / floor)`, where `budget` is the
density-dependent cell budget (sparse 98 — the measured-safe 14×7 — or dense 16). Writing either derived
value into a profile file is a load-time error.

## Parked (no machinery yet — do NOT add until it exists)

- A report-template FAMILY — several `.html` templates a profile picks between by name — is parked and
  unlikely to be built: per-customer output FORMATTING is the assistant's job, from `report-data.json`,
  and the engine ships one report per level and one cover-note email. (`delivery.template` itself is a
  live field with one accepted value; see the Fields table.)
- `refRequired` — contradicts the intake relaxation (missing ref = warning, never a silent reject);
  needs an intake clarify path first.
- `depth` / `budget` — `pro-search` is uniform; budget collides with the run/lane caps. Define the
  semantics before adding the knob.
- Per-country risk-framework deep-dives, customer internal-rights registers — a much bigger ownership
  commitment than a profile field. (Per-customer risk-framework *variants* are a different thing and
  they exist — see `frameworkPath` / `workedExamplesPath` in the Fields table above. Each customer's
  framework legitimately diverges: it IS their rating authority, and `test/framework-lint.test.mjs`
  guards manifest⇄deck integrity.)

## Onboarding a new customer

1. Customer asks (bespoke engagement). Author `profiles/<key>.json` with them: their marketplaces
   (store domains the grid program can domain-restrict to), default classes/jurisdictions, their
   own/affiliate entity names.
2. PR review — every field is read by code, so review like code. This is the git path's practice, not
   the write door: the same profile saved through the editor is a validated auto-commit with no PR in
   it, and the shared load-time validators are what both paths cannot get past.
3. **Rewrite check:** the skills are platform-agnostic (they follow the dictated list), but read
   `skills/prelim-common-law/SKILL.md` + `perplexity-prompts.md`, `skills/prelim-search/SKILL.md` +
   `phase2-execution.md`, and the driver message prose in `stages.mjs` once against the new
   industry — worked examples are gaming-flavored by history.
4. ONE validation run against a known/synthetic matter: confirm the grid swept exactly the
   profile's platforms (the receipts gate enforces it), classes/jurisdictions landed in the matter
   frame, and the report reads right.
5. Merge + deploy.
