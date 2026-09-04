# Running a hosted client connector

*For an operator standing one up. Everything here is deployment: hostnames, an auth proxy, service
definitions.*

> **Just want to connect your own app to your own runs?** You do not need any of this — spawn the stdio
> server from your clone. [`mcp-server/CONNECT.md`](../mcp-server/CONNECT.md) is four lines of
> copy-paste. This document is for publishing a connector your *customers* sign in to.

What a customer reaches once you have, what they cannot, and how to turn it on. For the staff/ops MCP
faces see `docs/architecture/09-security-and-data.md`.

## The three faces, in one table

One codebase (`mcp-server/server.mjs`), three processes. The separation is per-process **configuration**,
never a runtime branch — "a client cannot reach staff read-all" is a fact about which binary is listening,
not about a flag being right.

| Face | Where it listens | Who | Reach |
|---|---|---|---|
| **Staff** | your staff hostname → `TRADEMARK_MCP_HTTP_PORT` (default 18790) | firm staff (staff CF Access AUD) | every read tool, all runs |
| **Client** | your client hostname → `CLIENT_MCP_HTTP_PORT` (default 18811) | customers (client CF Access AUD) | see below |
| **Ops** | loopback only, on its own port, **no hostname** | the portal's trigger lane | reads + write verbs |
| **API key** | a hostname with no Access app in front → its own `CLIENT_MCP_HTTP_PORT` | a client agent that cannot sign in | same as Client |

Every port above is the code default and each face is a separate process, so on one machine give
each its own. The ops face is never on the internet. If you are looking for "the customer one", it
is the Client face. The API-key door is that same client face reached with a credential instead of a
browser login — see "The API-key door" below.

## The two client principals

**`user` — a run-bound report link.** A read-only token pinned to one run, no enumeration. The scope
is served as it always was; what changed with the move to a single report document is how anyone
comes by one. The token is minted into THE report's "Ask your AI" block against the STAFF connector
(`CLEAROTRON_MCP_URL`, `render.mjs`), and `portal-report.mjs` strips that whole block for every non-staff
reader at serve time — so **no client-facing surface hands one out any more**. A signed-in client
reaches the connector as `account` instead, at an address the portal serves live from
`/portal/api/mcp-access` (`CLEAROTRON_CLIENT_MCP_URL`, no baked credential). A run-bound link for a
recipient who has no login is now a deliberate act:
`node mcp-server/mint-token.mjs --scope user --run <runId>`.

**`account` — a signed-in client.** A CF-verified client identity with **no token**, resolved to the
accounts their email is granted (`CLEAROTRON_ACCESS_FILE` — the same guest list the portal's client door uses).
Enrolment is therefore the portal's: no second credential to mint, rotate or revoke, and revoking portal
access revokes this with it. **Off unless `CLIENT_MCP_ACCOUNT_ACCESS=1`.**

**Who turns that on. The installer, since 2026-09-03** — owner ruling, settled
point 2. `render-units.mjs --apply` and `npx clearotron start --background` both write the settings this
door refuses to start without and then place and enable `clearotron-client-mcp.service`. The settings
come from one authority, `enablePlan` in `shared/client-door.mjs`, which is also what
`npx clearotron connect` calls.

**This supersedes the 2026-08-31 ruling** *"On demand is fine"*, under which nothing at install and no
rebuild's enable list could start this unit, because starting it WAS the consent that opened
client-account access. The owner changed the posture knowingly: **the per-account key is the gate, not
whether a process runs.** A door with no key issued refuses everything, which is the same protection by
a mechanism that does not depend on a reader finding a verb.

**`npx clearotron disconnect` therefore revokes a person, not a service** (Q3). It writes the caller's key
ids to the denylist and strikes them from the record; it does not stop the unit and does not touch
`CLIENT_MCP_ACCOUNT_ACCESS`, which is the whole install's setting. Cutting everyone off is
`npx clearotron disconnect --everyone`, which states how many keys and how many people that is before
acting — and does not stop the service either.

An `account` principal reaches **eighteen** tools, for its own accounts only — everything carrying
`accountSafe: true` in `TOOL_SCOPES` (`shared/scope.mjs`), and nothing else:

| Layer | Tools |
|---|---|
| the report | `brief`, `read_artifact` (the report; `clientSummary` is retired from client reach and stays an ops-only internal source), `list_findings` (curated cards) |
| the evidence behind it | `list_evidence`, `list_searches`, `get_search_coverage` |
| the audit chain | `read_artifact` over `audit`, `narrative`, `registerFindings`, `commonLaw`, `caseLaw`, `matterContext` and `registerUnit:<axis>`; `list_findings` on the raw `kind` path; `get_finding`, `get_run`, `trace`, `decision_timeline` |
| the run lifecycle | `list_runs`, `describe_options`, `plan_run`, `start_run`, `stop_run` |
| what-if | `what_if_plan` (free), `what_if_run` (queues a sandbox job), `what_if_result` (collects it) |

The evidence layer exists because a client lawyer defending a filing decision needs the records
under the report, not just its prose. It projects named structured fields and enums derived from
them — `mcp-server/lib/evidence.mjs` states that there is no code path forwarding free prose, and
that is the one declared exception to the scrub.

**The audit chain is open by owner ruling, 2026-08-27** ("I don't see why we don't open it or just
give it to clients. Ignore the call spend."). The same lawyer who needs the records also has to be
able to show *how* the answer was reached, so the decision chain is client product now. Unlike the
evidence layer this one does forward prose — a chain of reasoning is prose — so it is bounded a
different way: `mcp-server/lib/audit-view.mjs` names the structural fields that travel and puts the
surviving prose through the report's own client-safety passes, never a second copy of them.

Three things stayed behind, and each has a reason rather than a habit:

- **Cost.** `get_telemetry` and `get_provider_usage` exist to report model identity and billed
  counts. Every other decision-chain read is model-free by construction — `events.mjs`, `trace.mjs`
  and `getStages` each say so on their own surface — so sealing exactly these two costs a client
  nothing of the chain.
- **The engine's judgment of its own output.** `skepticFlags` and `seniorEyeReview` are the reviewers
  writing about our draft, the same class as the `withdrawn_reason` ruling. The verdict they
  produced travels; the critique does not.
- **The unruled reads.** `get_coverage`, `search`, `search_runs`, `diff_artifact`, `run_changes`,
  `list_profiles`, delivery/outbox, `feed_context` and what-if. Nobody has decided what these should
  show a client, and an undecided tool is denied — `get_search_coverage` is deliberately not
  `get_coverage`, the latter being the engineering artifact-validity view.

**What-if is a QUEUED JOB on this surface, and that is what keeps the door honest.** The remote faces
never spawn the engine — `http-server.mjs` states it as a configuration fact and `lib/whatif.mjs`'s lazy
import of `driver/pipeline.mjs` is what holds it — so a client's `what_if_run` does not execute. It
validates, enqueues into `<runDir>/_experiments/_queue/`, and returns an `experimentId`;
`driver/whatif-worker.mjs`, drained by the runner in an OS service process, is what spawns the sandbox.
The client collects the diff with `what_if_result`. The original run is never modified — the experiment
writes only under `_experiments/`.

Four things about it are worth knowing before you offer it:

- **The confirmation-token handshake stays, and a client must ALSO name the run.** A token is plain
  base64url JSON that nothing signs, so a token-only call would slip past the account gate, which keys on
  `runId`. Naming the run puts the grant check in the path; `whatIfEnqueue` then proves the token names
  the same run, so neither half can be satisfied alone.
- **A client cannot choose the model.** The tier is cost and method both, and it is the one argument on
  the one tool that spends. Express the change with `instructions`.
- **Nothing bounds the spend, by ruling.** `start_run` is stamped `clientPrincipal: true` at the
  chokepoint so `runCaps.dailyRuns` bites it; a what-if job carries no such stamp, because the owner
  ruled spend controls out ("ignore the call spend"). Every experiment records what it spent; no door
  refuses the next one. Concurrency IS bounded — `CLEAROTRON_WHATIF_MAX_CONCURRENT`, default 1 — because
  letting a free experiment occupy the box while a paid clearance waits is a different question from
  spend, and the ruling did not touch it.
- **It starts on the timer, not instantly.** The systemd `.path` unit watches the clearance queue dirs,
  not run dirs, so a queued what-if is picked up on the runner's 90s tick.

**A forwardable report link did not move.** `USER_ARTIFACTS` gated `read_artifact` for both client
kinds, so the account layer was given its own set (`ACCOUNT_ARTIFACTS`) rather than the shared one
being widened: a run-bound `user` token rides inside a delivered PDF and can be forwarded to anyone,
and the ruling was about clients the firm enrolled.

## What a client sees of a report

The client cut, which is **what THE report already shows them — no more, and no less**:
`report.html` as served to a client through the portal's `readReport()`
preparation (`mcp-server/lib/scrub.mjs` states the rule; `driver/portal-report.mjs` is the serve-time
counterpart).

Removed: `- [internal]` reasoning bullets, the internal band code (`overall_badge`), the framework profile
hash, and the `tier`/`label` card shorthand the report footer says is "removed on export".

**Kept, deliberately:** the Methodology section and the register/common-law provider names. Both are in the
delivered report already (`render.mjs` renders Methodology via `plainScopeNote`; provider names are named
for provenance honesty). A scrubber stricter than the report would delete content the client was already
sent and make the connector a different product from the PDF in their inbox. **If you want less exposed,
change the report render or the serve-time preparation (`portal-report.mjs`) — it flows here for free.
Never add an MCP-only rule.**

## The daily allowance — read this before enabling a demo tenant

A client starting a run over MCP spends real money. The control is `runCaps.dailyRuns` on the customer
profile, enforced at the runner's admission gate (so it covers every door) plus a portal pre-check.

It only bites jobs stamped `clientPrincipal: true`, and **that stamp is positive-only — absence means
uncapped**. `authorize()` forces it for an `account` principal, so a client cannot omit it or pass `false`.
Staff runs deliberately never consume a client's allowance.

**For a demo or pitch account, set `dailyRuns` low (1–2) and `maxQueued: 1`.** Without `dailyRuns` the
account is uncapped by day and can exhaust the weekly engine capacity in a sitting. Prefer a synthetic
account for demos so the data is disposable too.

## The API-key door — for agents that cannot sign in

An auth proxy at the edge — here, Cloudflare Access — authenticates a **human in a browser**. Some connectors can't do that: their settings
offer one fixed "API key" box and no control over headers (Perplexity, most headless CLIs). Access cannot
be gated on a custom header value either, so such an agent has no way through `clients-mcp` at all.

The API-key door is that way through. A **third scope**, `account`, is minted per person:

```
node mcp-server/mint-token.mjs --scope account --sub lawyer@acme.example [--accounts acme] [--ttl-days 90]
```

**The key proves WHO; the grants file still decides WHAT.** `--sub` names an identity that must appear in
`CLEAROTRON_ACCESS_FILE`, and the accounts are resolved from that file **on every request** — never baked into
the token. `--accounts` is a CAP (an intersection on top of the grant) and can only narrow it. So there are
two independent revocation levers: **delete the grants row** (instant, needs no re-minting) or **denylist
the `jti`** (`TRADEMARK_MCP_TOKEN_DENYLIST`).

It resolves to the **same `account` principal** as a signed-in client, so the tool set, `authorize()`, the
scrub and `runCaps` above all apply unchanged — there is no second policy to keep in step.

**It is a separate process, not a flag on the client door** (`CLIENT_MCP_TOKEN_ONLY=1`, its own
service, port and hostname), for the same reason the client face is separate from the staff one: a
posture difference should be a fact about which binary is listening. The signed-in client face is
untouched by any of this and cannot be widened by it.

Because no auth proxy sits in front, the key is the authentication — so the mode refuses to start without
`TRADEMARK_MCP_TOKEN_SECRET`, without `CLIENT_MCP_ACCOUNT_ACCESS=1`, without `CLIENT_MCP_ALLOWED_HOSTS`, on
a non-loopback bind, or **combined with `CLIENT_MCP_AUTH_DISABLED`** (that pair would hand out the dev
synthetic identity instead of demanding a key). An unkeyed request gets a 401 with no fallback identity.

A key may be presented as `Authorization: Bearer <key>`, a bare `Authorization: <key>`, the explicit
`X-Trademark-Token` header, or `?token=<key>` on the URL — a connector with a fixed key box gives you no
say in which, and `?token=` is the fallback that needs no header at all. On the CF-fronted doors
`Authorization` is deliberately **not** read as a trademark key: there it belongs to the proxy/agent.

**Give a key a real account with real `runCaps`, never `generic`** — `generic` is cap-exempt, so a
long-lived credential pointed at it can spend without limit.

### Standing it up

1. At your edge: publish a hostname for this door, pointed at the loopback port you will give it, with
   **no Access app in front of it**. It must be a different hostname from the signed-in client door.
2. Run it as its own service — a copy of your live client-face service, never the repo template
   (`mcp-server/remote/client-mcp.service` is a placeholder). Set `CLIENT_MCP_TOKEN_ONLY=1`, give it
   its own `CLIENT_MCP_HTTP_PORT`, set `CLIENT_MCP_ALLOWED_HOSTS` to the hostname from step 1, keep
   `CLIENT_MCP_ACCOUNT_ACCESS=1` + `CLEAROTRON_ACCESS_FILE`, and drop the CF AUD lines (unused here).
3. Verify before exposing: `curl 127.0.0.1:<port>/healthz`; the boot log says `API-KEY door — no auth
   proxy in front`; an MCP `initialize` **without** a key is a 401.
4. Mint a key, hand it over with the address. `tools/list` must be exactly the eleven account tools
   above — anything more means the door resolved a wider principal than `account`.

## Turning it on

Repo-side needs nothing — the flag is off by default and shipping the code changes nothing.

Deploy-side, on whatever service definition already carries your client face's real port, host and
AUD. **Never copy `mcp-server/remote/client-mcp.service` over it — that file is a placeholder
template, and a placeholder that looks configured is worse than unset.**

1. Add two variables to that service: `CLEAROTRON_ACCESS_FILE` pointing at your grants file, and
   `CLIENT_MCP_ACCOUNT_ACCESS=1`.
2. Reload your supervisor and restart the client face.
3. Verify: `curl 127.0.0.1:<client-port>/healthz`; the boot log must say `auth ON — CLIENT CF Access …`
   and `client ACCOUNT access ON`. Starting with the flag set and no grants file is a **FATAL**
   refusal, by design.
4. At your edge: confirm the client hostname resolves to that port and that the **client** Access app
   fronts it — not the staff one. Enrol the client emails on that app's policy.
5. `CLEAROTRON_CLIENT_MCP_URL` must be set for the portal process too, or `/portal/api/mcp-access` answers
   `{url:null}` and the Use-your-AI screen correctly shows its empty state.

The client connector address is served **live**: `/portal/api/mcp-access` reads `CLEAROTRON_CLIENT_MCP_URL`
at request time, so a change reaches every client screen on the next load — no re-render involved. The
render no longer reads this variable at all: the block baked into
`report.html` is the STAFF connector (`CLEAROTRON_MCP_URL`), and it is stripped for non-staff readers at
serve time.

## What briefs the client's assistant

`skills/clearotron-client/SKILL.md`, served as the MCP `instructions` field on initialize — clients surface
it to their model on connect. It sets voice (plain language, no codes), the tool ladder, the verdict
vocabulary, evidence drill-through, and the three "never"s.

**It is guidance to a model, not a boundary.** It makes the output good; it does nothing about access.
Access is `authorize()` and the `clientSafe`/`accountSafe` gate; artifact text is `lib/scrub.mjs`. Never
move a rule out of those into the pack because "the skill says not to".
