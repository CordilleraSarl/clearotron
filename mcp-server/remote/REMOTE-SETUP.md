# Remote MCP setup — putting the HTTP face behind your own login

Turns the local HTTP MCP into a remote endpoint that a user adds to their chat app (Claude / ChatGPT)
by URL and signs into with their existing work identity. A signed-in user gets the read tools and
nothing else: `what_if_*` are never exposed remotely, to anyone, whatever their scope.

> **The server is not read-only, and the difference matters when you decide who may reach this URL.**
> An identity alone gets the read tools. A caller presenting an **ops token** also gets the write
> verbs — `start_run`, `stop_run`, `feed_context`, `mark_sent`, `ack_event` — and **`start_run` bills a
> real search**. Minting and scoping that credential is `INSTALL.md` §8, *Ops tokens*. Size the ingress
> below for a surface that can spend, not for one that can only read.

> This is a runbook for a human (or a guided session). **Nothing here is auto-applied**, and every
> vendor console step should be checked against that vendor's current documentation as you go — this
> area moved through 2025–26 (links at the bottom).

## What the server actually requires

**Any auth proxy that fronts the origin with a JWT works. This is configuration, not code**, and no
part of it is specific to one vendor:

| variable | what it is |
|---|---|
| `TRADEMARK_MCP_OIDC_ISSUER` | your issuer URL |
| `TRADEMARK_MCP_JWKS_URL` | where the origin fetches signing keys |
| `TRADEMARK_MCP_EMAIL_CLAIM` | which claim carries the identity (providers differ — some use `email`, some `preferred_username`) |
| `TRADEMARK_MCP_AUTH_HEADER` | the header your proxy puts the assertion in |
| `MCP_ALLOWED_EMAIL_DOMAINS` and/or `MCP_ALLOWED_EMAILS` | **the identity gate — mandatory** |

The origin re-validates the proxy's JWT itself rather than trusting the network, so a request that
reaches the port directly is refused the same way. **With no identity gate set the server refuses to
start**, because the alternative is a remote endpoint that authenticates nobody.

Direct OIDC, an identity-aware proxy, an OAuth gateway, `oauth2-proxy` — all are the same four
variables. The worked example below happens to use one combination; it is not a requirement, and if you
already run something that mints JWTs, use it. See `.env.example` §7.

## Architecture

> One face, deployed. **For which faces exist and who reaches each,
> see [`docs/CLIENT-MCP.md`](../../docs/CLIENT-MCP.md)** — the one place that model is written down. The
> diagram below is this runbook's own subject: the staff door behind an auth proxy.


```
Claude / ChatGPT  ──OAuth (browser login)──▶   your auth proxy   ──(your IdP, your domain policy)
   custom connector URL                              │  your tunnel or reverse proxy
   https://tm-mcp.example.com/mcp                    ▼
                                       127.0.0.1:18790  http-server.mjs
                                              • read tools to a signed-in identity
                                              • write verbs (start_run SPENDS) to an ops token
                                              • re-validates the proxy's JWT (defence in depth)
                                              • email gate + audit log + rate limit
```

## 1 — Run the HTTP face (loopback only)

Set the env in the service user's `~/.env` — see `.env.example` for the full key list:

```
MCP_ALLOWED_EMAIL_DOMAINS=example.com             # the identity gate — required
TRADEMARK_MCP_HTTP_PORT=18790
TRADEMARK_MCP_ALLOWED_HOSTS=tm-mcp.example.com    # DNS-rebinding protection (the public hostname)
CLEAROTRON_ACCESS_FILE=…/grants.json                  # who may read which accounts; unset ⇒ everyone reads everything
# …plus EITHER the four generic OIDC keys above, OR your proxy's own pair (see the example below)
```

Install the user service — it binds `127.0.0.1:18790` and fails closed if the auth keys are missing:

```
cp mcp-server/remote/trademark-artifacts-http.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now trademark-artifacts-http.service
curl -s http://127.0.0.1:18790/healthz          # → {"ok":true,...}
```

## 2 — Publish the loopback port

Any reverse proxy or tunnel that terminates TLS at your public hostname and forwards to
`127.0.0.1:18790`. `remote/cloudflared-ingress.example.yml` is a worked ingress file for one such tool.

## Worked example — Cloudflare Access with Entra ID as the IdP

**One combination that is known to work end to end.** Substitute your own throughout; nothing in the
server knows which of these you chose. This route needs Zero-Trust admin and an IdP app registration.

Its two extra variables replace the generic OIDC pair:

```
CF_ACCESS_TEAM=<your-zero-trust-team-name>          # → https://<team>.cloudflareaccess.com
CLEAROTRON_OIDC_AUDIENCE=<access-app-AUD-tag>                  # from step 3 below
```

1. **Add your IdP** (Settings → Authentication). For Entra ID: your directory (tenant) ID plus an app
   registration's client ID and secret, with the redirect URI the console gives you.
2. **Create a self-hosted Application** for your public hostname. Enable its **MCP-server / OAuth**
   option so chat clients can complete the OAuth flow (verify the exact toggle in current docs).
3. **Policy:** Allow — *Emails ending in* your domain, or an IdP group. That single policy is the
   authorization model; there is no per-person setup.
4. Copy the application's **Application Audience (AUD) Tag** → `CLEAROTRON_OIDC_AUDIENCE`, and your team name →
   `CF_ACCESS_TEAM`, then `systemctl --user restart trademark-artifacts-http.service`.

## 3 — Verify

- **Auth on:** the service log prints `auth ON — issuer=… aud=…`. A request to `/mcp` with a missing or
  invalid assertion header gets `401`; an identity outside the gate gets `403`.
- **End-to-end:** add the connector in your chat app (below), sign in with an allowed identity, and run
  `brief` / `decision_timeline`.
- **Access log:** `~/trademark/telemetry/trademark-mcp-access.jsonl` records
  `{ts,email,sub,method,tool,runId,query,status}` — a summary of the request, never artifact content.
  On a **fresh** box, `mkdir -p ~/trademark/telemetry` before first start: the unit's `ReadWritePaths`
  cannot make a directory writable that is not there, and the append is best-effort, so the log would
  go missing quietly. Override the location with `TRADEMARK_MCP_AUDIT_LOG`.

## Defence-in-depth already in the server (don't rely on the network alone)

- **No compute remotely:** `what_if_plan` / `what_if_run` are omitted from the HTTP profile whatever the
  caller's scope — no spend, no shell. A signed-in user with no token reaches read tools only; the write
  verbs require an ops token, minted per principal and scoped to the verbs it needs
  (`../packs/ops/CONNECT.md`).
- **Token re-validation at the origin:** RS256 signature against the issuer's JWKS, `iss` / `aud` checks
  and the identity gate — even if someone reached the port directly without passing the proxy.
- **Loopback bind + DNS-rebinding protection** (`TRADEMARK_MCP_ALLOWED_HOSTS`), per-identity **rate
  limit**, **audit log**.
- **Fail-closed:** auth is on unless `TRADEMARK_MCP_AUTH_DISABLED=1` **and** `TRADEMARK_MCP_DEV=1`
  **and** a loopback `HOST` **and** `CLEAROTRON_ACCESS_FILE` (all four required, dev only — the grants file
  because without one a token-less caller resolves to read-all across every customer). When auth is on,
  missing issuer/audience keys, a missing identity gate, **or** a missing `TRADEMARK_MCP_ALLOWED_HOSTS`
  ⇒ the server refuses to start. A stray disable flag cannot silently fail open.

## Before you widen access beyond your own organisation

Most IdPs can admit outside identities (guest invitations, an external-identity tenant, a second IdP)
and the plumbing above does not change. **The data scoping does, and it is not optional.**

A token-less session resolves to the accounts its email is granted in `CLEAROTRON_ACCESS_FILE`
(`shared/scope.mjs`, `accountsForEmail`). **With no grants file configured that resolution returns
`"*"`, and every authenticated user then sees every run in the pool** — which is defensible for a
single-organisation deployment and wrong the moment an outside identity can sign in. External clients
belong on the separate client process (`http-server-client.mjs`), which cannot resolve a read-all scope
at all. Set the grants file before you widen the policy.

## References (verify current)

- Cloudflare: secure MCP servers / MCP portals — developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/
- Cloudflare Access JWT validation — developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
- Entra ID: building MCP servers with pre-authorized clients (it lacks DCR/CIMD — pre-registration or a proxy)
- MCP authorization spec (OAuth 2.1, RFC 9728 protected-resource-metadata, RFC 8707 resource indicators) — modelcontextprotocol.io
