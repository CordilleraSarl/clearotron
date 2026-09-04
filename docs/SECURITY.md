# Security envelope

*What protects what, and where each control is enforced in code.*

What protects what, where it is enforced in code, and what the operator must do. Every statement
here corresponds to shipped behavior; when hardening changes, change this file in the same PR.

## Surfaces

| Surface | Trust | Guard |
|---|---|---|
| stdio MCP (`mcp-server/server.mjs`) | local/full ("ops") | OS user boundary — run it AS the operator account; it is the only surface on which `what_if_run` EXECUTES (`visibleTools` keeps what-if out of the HTTP listing for ops, but the CallTool chokepoint gates on `authorize()` alone, which admits it for any ops token not `--verbs`-scoped) |
| Client MCP (`mcp-server/http-server-client.mjs`) | signed-in client / account key | a client account's `what_if_run` ENQUEUES rather than executes (owner ruling 2026-08-27) — it never imports the engine, and `driver/whatif-worker.mjs` spawns the sandbox from an OS service process. A confirmation token is unsigned, so the call must ALSO name its `runId`: the account gate keys on it, and `whatIfEnqueue` refuses a token naming a different run. The `model` argument is refused to a client. |
| HTTP MCP (`mcp-server/http-server.mjs`) | authenticated remote | auth-BEFORE-data; fail-closed construction; inner scoped tokens |
| Report "Ask your AI" links | external report recipients | run-bound `user` tokens minted at publish; client layer only |
| Dev portal (`driver/dev-portal.mjs`) | dev only | loopback-only (throws on any other host); never production serving |

## Authentication (the outer gate — both faces)

> **THIS IS THE CANONICAL STATEMENT OF THE ACCESS MODEL.** Every other document links here rather than
> restating it (ADR-0004: *one canonical statement per subject; a second copy is a future
> contradiction*). A guard in the suite fails if a second copy appears.

**The product owns authorization. It does not own authentication.** Proving an address belongs to
whoever typed it is chosen per deployment and nothing is ever inferred; what that address may then see
is the product's, always, and identical whichever door it came through.

Three deployment shapes, and they are the whole set:

| Shape | How identity is proven | How a second person is added |
|---|---|---|
| **A laptop** | `PORTAL_AUTH_MODE=local` — one address, one passphrase, signed session, loopback only | There is no second person; sharing an instance means the row below |
| **Shared or hosted** | `PORTAL_AUTH_MODE=auth-proxy` — any login system in front that authenticates in the browser and forwards a verifiable JWT per request (`cf-access` is the older word for this and still works) | Admit the address at your login system, **then** grant it in the guest list — both halves, always |
| **Neither configured** | the service refuses to start | — |

Exactly two roles exist: **staff**, admitted by an email-domain rule (`PORTAL_STAFF_DOMAINS`), and
**client**, admitted by a named grant in the guest list (`CLEAROTRON_ACCESS_FILE`). `makePrincipal` →
`assertPrincipal` is the only path to a decision and no identity source may reach past it. Grants are
created in the guest-list file by whoever administers the box — `npm run grant` is the editor for it —
never from a browser. The file is re-read per request, so a grant lands without a restart.


- **On the proxy door**, every HTTP request re-validates a JWT from the fronting auth proxy. The
  proxy is yours to choose — issuer, JWKS URL, claim and header are config
  (`TRADEMARK_MCP_OIDC_ISSUER` / `_JWKS_URL` / `_EMAIL_CLAIM`), and the origin re-validates the token
  whichever one you put in front. Cloudflare Access is one worked example; direct Entra, Google IAP
  and Auth0 are others. No cookie, no session-based auth.
- **There is a second authenticated door, and it runs no proxy and validates no JWT**:
  `TRADEMARK_MCP_AUTH_MODE=token` (`tokenOnly` in `makeHttpHandler`) demands a valid scoped access
  key on every request instead — the key IS the authentication, checked before the limiter, the body
  and the session. It is fail-closed differently rather than less: a loopback bind,
  `TRADEMARK_MCP_ALLOWED_HOSTS` and `CLEAROTRON_ACCESS_FILE` are all required to start, it needs neither
  audience nor issuer, and it is mutually exclusive with both a verifier and dev mode by construction.
- **Fail-closed at every layer**: on the proxy door the server refuses to START without an audience +
  issuer and at least one identity gate (`MCP_ALLOWED_EMAIL_DOMAINS` / `MCP_ALLOWED_EMAILS`); the
  handler refuses to BUILD without a verifier unless dev mode or the access-key door; dev mode itself
  requires two explicit flags AND a loopback listener.
- DNS-rebinding protection via `TRADEMARK_MCP_ALLOWED_HOSTS` (required when auth is on).
- **Sessions are owner-bound**: a session id presented by a different authenticated identity is
  refused (403) — a leaked session id never transfers an inner token's authority.

## Authorization (the inner gate — both faces; `shared/scope.mjs`, enforced at ONE chokepoint)

- Four principal kinds: **ops** (write verbs; automation/operator), **user** (read-only, pinned to
  exactly ONE run — report recipients), **account** (a signed-in client across the accounts their
  identity is granted: the client layer, the evidence layer — `list_evidence` / `list_searches` /
  `get_search_coverage` — the AUDIT CHAIN (owner ruling 2026-08-27: `read_artifact` over the chain
  artifacts named in `ACCOUNT_ARTIFACTS`, `list_findings` on the raw `kind` path, `get_finding`,
  `get_run`, `trace`, `decision_timeline`), WHAT-IF as a queued sandbox job (`what_if_plan`,
  `what_if_run`, `what_if_result`), and the run lifecycle on their own runs, and nothing else. All of it accountSafe and deliberately NOT clientSafe, because a report link is forwardable
  and an account is an enrolled identity), **internal** (authenticated staff, read-all, no writes).
- **What an account still cannot read, and why each one**: `get_telemetry` / `get_provider_usage`
  (model identity and billed counts — the firm's cost structure, and the only two tools that carry
  either, so sealing them costs the client nothing of the chain); the `skepticFlags` /
  `seniorEyeReview` artifacts (the reviewers' judgment of the engine's OWN output — the verdict they
  produced travels, the critique does not); `status.json` / `run.jsonl` (JSON that the markdown
  scrub would pass through untouched, carrying the run codename, the agent id, absolute paths and
  raw stacks — `get_run` projects the same lifecycle facts bounded); and the reads nobody has ruled
  on (`get_coverage`, `search`, `diff_artifact`, `run_changes`, what-if), which are denied by the
  default that an undecided tool is denied.
- HMAC-signed tokens (`v1.<payload>.<sig>`, node:crypto only). `authorize()` is the single
  enforcement point for every tool call; `visibleTools()` additionally hides what a session may not
  call — but it is hygiene on the tool LISTING, not a second gate, and it is the only thing that
  reads `local`.
- **User tokens cannot**: enumerate runs, cross to another run (explicit mismatching runId refused;
  omitted runId pinned), reach any write/spend tool, or read internal artifacts — `read_artifact`
  is name-gated to the report alone (`USER_ARTIFACTS`), and `list_findings` to the curated
  report-card groups, so the raw audit trail stays sealed. **The 2026-08-27 audit-chain ruling did
  not move this line.** `USER_ARTIFACTS` gated `read_artifact` for both client kinds, so the account
  layer was given its own `ACCOUNT_ARTIFACTS` rather than the shared set being widened: a user token
  rides inside a delivered PDF and can be forwarded to anyone, and the ruling was about clients the
  firm enrolled. Both sets are gated at the read_artifact tool AND at the Resources surface
  (`resources/list` / `resources/read`), kind for kind — two doors to the same bytes, one rule.
- **Ops tokens are least-privilege**: an optional `verbs[]` allowlist restricts write tools per
  principal (an intake connector physically cannot `stop_run`). `what_if_*` is filtered out of the
  HTTP tool LISTING for every OPS scope (`visibleTools`, keyed on `local` — the `local` test governs
  the ops branch only, and a client account returns above it). That is hygiene, not a wall:
  `authorize()` never sees `local` and treats what-if as an ordinary ops write verb, so an ops token
  minted without `--verbs` can still call it over HTTP — which is why every HTTP ops token should be
  minted verb-scoped.

## Token lifecycle

*Operating instructions — minting, revoking, rotating — are [the operations runbook](architecture/06-operations-runbook.md#access-control-and-instance-isolation). This is
what the mechanism guarantees.*

- One OPERATOR issuance path: `mint-token.mjs` (prints once, stores nothing; `sub` names the
  principal in every audit line; the `jti` printed at mint time is the revocation handle). Two
  automatic minters sit beside it on the same `mintToken`: the clearance publisher mints the report
  link's run-bound `user` token at publish, and `npx clearotron start` mints the portal's verb-scoped,
  account-capped ops token in memory at every start. Neither prints, and neither is written down.
- **Revocation**: denylist file checked on every verification; missing file = nothing revoked (the
  denylist can never take all auth down). **Rotation**: two-secret window, flag-day-free.
- **Rate limits**: per-identity bucket on every request plus a separate lower per-principal bucket
  for ops sessions.

## Audit

Every HTTP tool call appends `{ts, email, sub, tool, args-summary}` to an append-only JSONL
(`TRADEMARK_MCP_AUDIT_LOG`). Audit is written after scope resolution (so the line names the
principal) and before dispatch; it is best-effort and never blocks a request.

## Data plane

- **No client data in this repository — structural, not procedural.** Real customer bundles live in
  an external store (`CLEAROTRON_CUSTOMERS_DIR`/`CLEAROTRON_INSTRUCTIONS_DIR`); the repo ships synthetic demo
  customers only. Run data lives in operator-owned directories outside git (`CLEAROTRON_REPORTS_DIR`,
  workspace root, outbox), backed up by the operator, never committed.
- Secrets enter only via environment (`.env` on the host); the repo carries `.env*.example` files
  with placeholders. CI runs a secret scan (gitleaks) on every push.
- Dev instances are isolated by CONFIGURATION and nothing else: a test instance and a live one are the
  same code with different environment — no build flag, no profile constant, no mode switch in the
  source — so the separation holds exactly as far as the operator gives it its own
  pool/workspace/queue/outbox, points the engine at the mock and hands it no credentials. The one axis
  enforced in code is the auth bypass's loopback-only bind. See [the operations runbook](architecture/06-operations-runbook.md#access-control-and-instance-isolation).
- **What a run sends to third parties** — every destination, what is in each call, and the code that
  makes it — is tabulated at
  [architecture/09 § What leaves the machine](architecture/09-security-and-data.md#what-leaves-the-machine).
  That table is the one place it is written down; this file does not restate it.

## The compute engine

Each pipeline stage shells the configured engine binary as the operator account — `CLEAROTRON_AI`
picks the adapter install-wide (`anthropic-agent` spawns `claude -p`, `openai-agent` spawns
`codex exec` with a per-run `CODEX_HOME`), with no per-stage engine and no fallback between them —
with run-scoped `--add-dir` access and per-provider gather MCP servers whose credentials come from the
environment. Stage outputs are judged by file-truth validators — the engine's own success claims
are never trusted. Delivery is a self-contained packet couriered by the integrator; the engine sends
no messages and holds no channel credentials.

## Prompt-injection posture

- Client-facing tool outputs carry context-phrased guidance (not imperatives) so MCP metadata
  scrubbers pass them through, and the client pack tells the assistant to relay the report's own
  wording and never to invent a finding, level, jurisdiction or source
  (`skills/clearotron-client/SKILL.md`). What no pack yet says is that report content is DATA rather
  than instructions: nothing in the prompt payload answers an instruction embedded in a report, so on
  the client side that output note is the whole of this control today.
- The courier contract is **verbatim relay** — an integrator agent following the ops pack never
  executes instructions found inside packets, it transports them.

## Reporting

**[`../SECURITY.md`](../SECURITY.md) is the disclosure path** — the channel, what is in scope, and
what to expect. It is the only file that names the channel — a monitored `security@` mailbox and
GitHub's private vulnerability reporting, either one — so there is one place to change if a channel
ever moves.

If you run your own deployment, reports about *your* configuration — your auth proxy, your TLS, your
keys — go to you. This file describes what the code guarantees; it cannot speak for how a given
instance is stood up.
