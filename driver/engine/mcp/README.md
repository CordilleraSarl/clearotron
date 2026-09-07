# engine/mcp — the tool servers a stage's model process is given

Thirteen of the fourteen `*-server.mjs` files here are standalone MCP servers, spawned as their own child process
when a stage's turn is dispatched: six wrap a vendor register core (only the ACTIVE provider's is spawned in a given
run), two reach the network on their own (`perplexity-server.mjs`, `fetch-server.mjs`), and five serve the run's own
artifacts and dial nothing (`band-server.mjs`, `coverage-server.mjs`, `declination-server.mjs`,
`dispositions-server.mjs`, `recording-server.mjs`). `stdio-server.mjs` is the fourteenth and is NOT a server: it is
the shared `serve()` / JSON-RPC bootstrap the others import. `gather-config.mjs` is the wiring: which servers a stage mounts, and which
tool names it is allowed to call.

## The register surface is provider-neutral

The active register provider is mounted under the single, neutral server key `register`, and every register tool is
named `register_*` — so the namespaced ids the prompts and allowlists carry (`mcp__register__register_enumerate`)
stay stable across a provider swap. What is PINNED is the vendor's TOOL tokens, not its name:
`../../test/provider-neutral-prose.test.mjs` walks `driver/` (skipping `fixtures/`) and fails any `<vendor>_<tool>`
outside the six `<provider>-server.mjs` files and `../../skills/prelim-register/providers/`, exempting a core's own
`ERROR: … HTTP` diagnostics. The plain vendor NAME is unrestricted: `REGISTER_SERVERS` is keyed by it, and 134 other
files under `driver/` carry `corsearch`.

`REGISTER_SERVERS` in `gather-config.mjs` is the table: provider key → server script → which of the eight names in
`REGISTER_TOOLS` that provider can serve. A provider that cannot serve one leaves it out and the gap becomes a
disclosed `deferred` coverage row, never a weaker substitute under the same name. No default exists —
`requireRegisterProvider()` throws, and an unknown provider fails loudly. **Read the table's comments as part of the
table:** each entry explains every name it omits with the probe that settled it. `signa` was the exception — granted
two names while its server served four — and it went unseen because `allowedToolsFor` is built FROM this table, so the
count assertion compared the table with itself and passed. `../../test/register-advertisement-vs-grant.test.mjs` now
drives every provider's real `tools/list` against its resolved grant.

Credentials never enter the generated config — the servers inherit them from the engine process env. The config env
carries non-secret wiring, and not all of it is per-run: session key, agent and the band tools' run dir when the
caller supplies them; the run's record log plus the box's homedir call ledger, resolved here rather than forwarded
raw; and `CLEAROTRON_GATHER_SESSION_ID` + `EUIPO_ENVIRONMENT` (a box-level sandbox/production selector, not a secret)
when the engine env sets them. The bridges get a deliberately smaller set: run dir, session key, agent.

## What reads it

`../../gateway.mjs` calls `toolGroupsForStage` on every turn it dispatches, and `buildGatherMcpConfig` +
`allowedToolsFor` only inside `if (groups.length)` — so the nine stages in `TOOL_FREE_STAGES` reach neither, and
their turns carry no `--mcp-config`, `--strict-mcp-config` or `--allowedTools` at all.
`../../contract-dictation-registry.mjs` reads `toolGroupsForStage` + `allowedToolsFor` (plus the `REGISTER_SERVERS`
and `TOOL_FREE_STAGES` tables) into the live grant authority `../../contract-dictation.mjs`'s `toolOrderContract`
checks a stage's dictated tool orders against. `../../stage-context.mjs` reads `toolGroupsForStage` alone, for a
different job: `TOOL_GROUP_EDGES` turns a stage's groups into the FILES its tools open, so `sandboxManifest` can
refuse a dispatch into a sandbox lacking them. For the codex engine, `../openai-agent.mjs` renders the identical
wiring as a `config.toml` through `codex-config.mjs`, and `../../test/engine.gather.test.mjs` +
`../../test/server-tools-granted-or-stated.test.mjs` pin the grants.

## Files

| File | Role |
|---|---|
| `gather-config.mjs` | READ FIRST. `REGISTER_TOOLS` and `REGISTER_SERVERS`, then the `LOCAL` table, then `toolGroupsForStage` (stage name → abstract groups: `perplexity`, `register`, `band`, `coverage`, `declination`, `dispositions`, `caselaw`, plus one derived key per recording stage) and `allowedToolsFor`. `TOOL_FREE_STAGES` is the other half of that map, so a stage cannot fall into the no-tools catch-all by omission. `../CONTRACT.md` has the engine turn |
| `codex-config.mjs` | The same wiring rendered as a codex `config.toml`, so `gather-config.mjs` stays the one source |
| `stdio-server.mjs` | `serve()` — the shared JSON-RPC stdio scaffolding, and the writer of the per-run `_driver/tool-calls.jsonl`, where a `started` line with no `settled` line is the only evidence that a killed call ever happened |
| `http-dispatcher.mjs` | Side-effect import: raises undici's 300s headers timeout for long grid/register calls |
| `corsearch-server.mjs`, `clarivate-server.mjs`, `euipo-server.mjs`, `signa-server.mjs`, `uspto-local-server.mjs`, `free-tier-server.mjs` | One per register provider, all under the neutral `register_*` names |
| `supplemental.mjs` | Mint-and-execute for model-proposed register queries; bound by each server that serves `register_propose_supplemental` |
| `perplexity-server.mjs` | `perplexity_research` (the common-law grid and open-web research); calls the Perplexity agent API under `PERPLEXITY_API_KEY`. It served `record_dispositions` too until — a record tool on a key FOUR stages hold, so three of them were granted a writer into the common-law lane's ruling ledger that no doctrine of theirs ordered |
| `band-server.mjs` | Read-only lookups over the run's frozen register band; every call appended to the reading audit |
| `coverage-server.mjs` | `record_coverage`, granted to `register-digest` alone |
| `declination-server.mjs` | `record_declination`, granted to `synthesis` alone — the per-record decision NOT to deliver something that reached the findings surface. Same shape as `coverage-server.mjs` and deliberately NOT a recording key: synthesis still authors `findings.json`, so it keeps `Write` |
| `dispositions-server.mjs` | `record_dispositions`, granted to the `common-law` lane alone (its `common-law-half` variant included) — the meaning rulings the lane's own doctrine orders. `coverage`/`declination`'s shape, reached by SUBTRACTION: moved the tool off the shared`perplexity` key rather than adding a new one |
| `recording-server.mjs` | The typed-return surface for converted stages: writes the caller's own artifact, dials nothing |
| `fetch-server.mjs` | `fetch_url`, a read-only GET to an absolute http(s) URL — mounted by `codex-config.mjs` whenever a stage's grant carries `WebFetch`, for the codex engine, which has no built-in |
