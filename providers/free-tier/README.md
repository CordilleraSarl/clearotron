# providers/free-tier — EUIPO + the local US index as ONE register

The composite adapter: `../euipo/` serves the EU, `../uspto-local/` serves the US, and this directory
makes the pair look like a single provider to everything above it — one plan, one `qid` namespace, one
coverage skeleton, one ledger. Nothing above the provider seam learns that two sources exist.
Selected by `CLEAROTRON_DATABASE=free-tier`.

Precedence applies *between* tiers, never within one: a paid vendor, if configured, is the register
alone; this is the free tier; with neither, register work refuses by name.

## The contract is derived, not written

`src/capabilities.js` computes every field from its members, and the rule is **pointwise-weakest**.
The consequence a reader needs: **a capability either member lacks is absent from the composite.**
Predicates INTERSECT, so `phonetic` is `null` here because both members lack it — and would stay
`null` if only one did. `maxOrWidth` is the MIN (25, the US index's bound, not EUIPO's 50);
`oppositions`, `phonemeExpansion` and `hasPublicRecordUrl` are AND; `countProbe` and the kernel bounds
take the weakest member; `nativeScriptIndex` is a tri-state where one undeclared member makes the
composite undeclared, because `false` means "we probed" and `null` means "nobody did".

`offices.covered` composes by UNION — `["EU", "US"]` — and it is static, never narrowed to whichever
member happens to be credentialed on this box. That question is answered in
`../../driver/register-availability.mjs` instead, and the unreachable office rides the plan as a
disclosed `deferred_coverage` row. Layer tables union too; `src/capabilities.js` explains why that
asymmetry with predicates is deliberate.

Weakest-member costs nothing to disclose, because every step after it already exists: an
intersected-away predicate stamps `unsupported`, the executor emits `error: true` + `deferred: true`,
and it lands as a disclosed coverage row on the face of the report. Taking the strongest member
instead would plan a query one source cannot run and call the result a clean.

## What reads it

- `../../driver/driver.config.mjs` — the `free-tier` entry. `credEnv` is the EU pair only:
  `USPTO_LOCAL_DB` is deliberately not required, so a box without the index still gets its EU
  coverage. `publicRecordOrigin` is `null` and `composedOf` carries the members, because the two
  halves have different public hosts.
- `../../driver/engine/mcp/free-tier-server.mjs` — seven of the eight neutral `register_*` tools. The
  seat is not told there are two sources; it sees only the derived contract.
- `../../driver/register-capabilities.mjs` and `../../driver/register-availability.mjs` — the latter
  joins `composedOf` to each member's credential declaration to decide reachable offices.

## Where to start

`src/capabilities.js`, top to bottom: the derivation primitives (`every`, `min`, `weakest`,
`triState`, `derivePredicates`) are short, and the header states the rule they implement. Then
`src/core.js` for the only thing this provider adds over its members — the merge arithmetic:
records concatenate, `total_hits` sums only when every participating member reported a finite number,
and `state` is `"enumerated"` only if every member enumerated. One member's failure fails the whole
slice, because `joinPlanToBands` has no shape for "half of this ran".

| File | Role |
|---|---|
| `src/capabilities.js` | The derived contract, the routing table (`memberForOffice`), the disjointness check. |
| `src/core.js` | Routing, the merge arithmetic, the ledger; enforces office-disjointness at load. |
| `test/composite.test.mjs` | The derivation rules and the merge, driven through stood-in member cores. |
| `test/unconfigured-member.test.mjs` | The backstop when a member unreachable on this box is called anyway. |
