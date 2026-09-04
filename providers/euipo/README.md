# providers/euipo — the EU register

The adapter for EUIPO's free Trade mark search API (OAuth2 client-credentials, RSQL over
`GET /trademarks`): EU trade marks and international registrations designating the EU. One office,
`EU`. No sound-alike surface — `predicates.phonetic` is an explicit `null` — but a leading wildcard
matches natively, with no reversed index and no verification pass.

Selected on its own by `CLEAROTRON_DATABASE=euipo`; it is also the EU half of `../free-tier/`,
which imports this contract and this core rather than restating them.

## `EUIPO_ENVIRONMENT` is not a preference

`sandbox` and `production` are **separate deployments holding different corpora**, so a sandbox
credential searches marks that are not in the live register — a sandbox answer is a different
register, not a thinner one. Three things in the code follow from that: `resolveConfig` in
`src/core.js` defaults to `sandbox` when the variable is unset, refuses an unknown value by name
rather than falling back, and every search response carries the `environment` that answered so
nothing downstream can mistake one for the other. Set `production` explicitly.

## What reads it

- `../../driver/driver.config.mjs` — the `euipo` provider entry, which lazily imports `src/core.js`
  for `recordFetch`, `countHits`, `listRecords` and `executePlan`. `credEnv` is `EUIPO_CLIENT_ID`
  with `EUIPO_CLIENT_SECRET` in `credEnvAlso`, so preflight checks the whole pair.
- `../../driver/engine/mcp/euipo-server.mjs` — the model-facing surface, under the neutral
  `register_*` names. `register_expand_phoneme` is absent on purpose: the planner stamps a phonetic
  slice `unsupported` and it is disclosed as a deferred coverage row.
- `../../driver/register-capabilities.mjs` — imports `src/capabilities.js` statically at module load,
  which is why that file has no node imports, no HTTP and no credentials.
- `../_shared/` — paging, counting, screening and the call ledger are the same kernels corsearch and
  clarivate run. Only the seams in `src/core.js` are EUIPO-shaped.

## Where to start

`src/capabilities.js`, first and whole: it is the provider in one page, and every value carries the
probe that established it — the OR-width bound and why it sits beneath the worst measured case, the
absent phonetic operators, the sixteen statuses the API will filter on against the spec's eighteen.
Then `src/core.js`, whose header names the four seams that would otherwise have failed silently:
`and` binding tighter than `or`, the `size` floor of 10, `logRecordBody`, and the page params.

| File | Role |
|---|---|
| `src/capabilities.js` | The capability contract. Dependency-free, read at plan time. |
| `src/core.js` | The provider surface over the shared kernels: config, RSQL assembly, the ledger. |
| `src/euipo-client.js` | Pure HTTP/OAuth — the token cache, `assembleRsql`, and the two direct-call tools. |
| `src/row.js` | The two row vocabularies (`toBandRow`, `toNeutralRecord`) and the status classifier. |
| `test/` | The query builder and status vocabulary, the kernel seams, and the deferred-block link. |
