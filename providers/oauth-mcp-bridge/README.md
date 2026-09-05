# OAuth MCP stdio bridge

A short-lived stdio adapter between an MCP client and remote MCP servers that
require OAuth 2.1 authentication. In this repo the clearance engine's gather
config points a case-law MCP server at `bridge.mjs`
(`driver/engine/mcp/gather-config.mjs`, overridable with `CLEAROTRON_OAUTH_BRIDGE`).
Any other stdio MCP client can spawn the same script from its own config.

**This exists because a stdio MCP client cannot hold an OAuth token.** The
protocol gives it nowhere to put one, so something in front of the server has to
own the refresh. When your client ships native OAuth for remote MCP, **drop this
directory** and give it a native URL+auth server entry instead.

The bridge uses `@modelcontextprotocol/sdk` directly — the same SDK the clients
themselves use — so the migration is a config swap, not a logic swap.

## Lifecycle

```
                       one-time (workstation w/ browser)
                       ─────────────────────────────────
                       curl DCR + PKCE, by hand
                       ("One-time setup" below)
                                  │
                                  ▼
              <creds-dir>/<server>.json
                                  │
                       ┌──────────┴──────────┐
                       ▼                     ▼
              runtime (service acct)  (refresh writes back here)
              ────────────────
              the MCP client spawns bridge.mjs
                       │
                       ▼
              MCP SDK Client → StreamableHTTPClientTransport
                                 (auto-refresh via authProvider)
                       │
                       ▼
              mcp.<remote-server>.com
```

The bridge owns `<creds-dir>/<server>.json` from the moment the recipe below
writes it, and refreshes are written back there. mcporter's own credential store
can rotate or clear without affecting the bridge.

**Where `<creds-dir>` is.** `bridge.mjs` reads `--creds-dir`, else
`OAUTH_BRIDGE_CREDS_DIR`, else `~/.config/trademark-oauth-mcp`. `warm-server.mjs`
reads `--creds-dir`, else `~/.config/clawdi/oauth-mcp` — it has no env override,
so a deployment that runs both must pass the same directory to the warm server
explicitly or keep the credentials where each default looks.

## One-time setup (per remote MCP server)

The bridge cache file at `<creds-dir>/<server>.json` needs to contain
`serverUrl`, `scope`, `clientInfo` (DCR client_id + client_secret), and `tokens`
(access + refresh) with `0600` permissions.

### The only path: manual DCR + PKCE bootstrap

Do it by hand. There is no helper script in this directory, and the automated
route it would have wrapped does not work: mcporter's
`--static-oauth-client-metadata` flag silently fails to propagate
`token_endpoint_auth_method` into DCR on the installed version (0.11.1) — the
server registers the client as `"none"` (public client) regardless, and
subsequent token exchanges fail with `InvalidGrantError`. Seeding the cache
from an mcporter login therefore produces credentials that cannot refresh.

Run on any host that can reach `https://<auth-server>/o/register/` (the
remote MCP server's auth server). For CourtListener that's
`https://www.courtlistener.com/o/`.

```bash
# Replace SERVER, AUTH_BASE, RESOURCE for each new MCP server.
# SVC_USER / SVC_HOME name the account the MCP client runs as — your own if you
# run it yourself. CREDS_DIR must match what that process resolves (see above).
# Run this block from the repository root so BRIDGE resolves; the steps below cd away.
SERVER="courtlistener"
AUTH_BASE="https://www.courtlistener.com/o"
RESOURCE_ORIGIN="https://mcp.courtlistener.com"
SVC_USER="$(id -un)"
SVC_HOME="$HOME"
CREDS_DIR="$SVC_HOME/.config/trademark-oauth-mcp"
BRIDGE="$PWD/providers/oauth-mcp-bridge/bridge.mjs"
SCOPES="openid api"            # discoverable at ${AUTH_BASE}/.well-known/openid-configuration → scopes_supported
REDIRECT="http://127.0.0.1:8765/callback"   # any unused port; browser will fail to connect, you paste the URL back manually

mkdir -p /tmp/cl-oauth && cd /tmp/cl-oauth

# 0. READ the resource indicator from the server. NEVER compose it by hand.
#    RFC 8707 binds a token family to a resource, and the SDK sends that value on every
#    token request INCLUDING the refresh. A value that differs from the server's own by
#    one character fails exactly like an absent one — and CourtListener publishes
#    `https://mcp.courtlistener.com/`, with a trailing slash its own serverUrl lacks.
#    This line used to be a hand-written constant, and that is the whole defect: sign-in
#    succeeded, every check passed, and the credential died at its first refresh.
RESOURCE=$(curl -sS "${RESOURCE_ORIGIN}/.well-known/oauth-protected-resource" | jq -r .resource)
[ -n "$RESOURCE" ] && [ "$RESOURCE" != "null" ] || { echo "no resource indicator published — stop here and find out why"; exit 1; }
echo "resource indicator, as the server states it: $RESOURCE"

# 1. Dynamic Client Registration — explicit confidential client.
DCR=$(curl -sS -X POST "${AUTH_BASE}/register/" -H 'Content-Type: application/json' \
  -d "$(jq -n --arg ru "$REDIRECT" --arg sc "$SCOPES" '{
    client_name:"trademark-oauth-mcp-bridge",
    redirect_uris:[$ru],
    grant_types:["authorization_code","refresh_token"],
    response_types:["code"],
    token_endpoint_auth_method:"client_secret_post",
    scope:$sc
  }')")
echo "$DCR" | jq '{client_id, has_secret:(.client_secret!=null), token_endpoint_auth_method}'
# Expect: has_secret: true, token_endpoint_auth_method: "client_secret_post"

# 2. Generate PKCE pair + state.
CODE_VERIFIER=$(openssl rand -base64 96 | tr -d '\n=' | tr '+/' '-_' | cut -c1-128)
CODE_CHALLENGE=$(printf '%s' "$CODE_VERIFIER" | openssl dgst -sha256 -binary | openssl base64 -A | tr -d '=' | tr '+/' '-_')
STATE=$(cat /proc/sys/kernel/random/uuid)
CLIENT_ID=$(echo "$DCR" | jq -r .client_id)
CLIENT_SECRET=$(echo "$DCR" | jq -r .client_secret)

# 3. Build authorize URL — paste it into a real browser and click Authorize.
#    `resource` rides here AND on the exchange below. Both, or the family is bound to
#    nothing and the first refresh presents a resource it was never issued for.
#
#    STAGE STEP 5 BEFORE YOU HAND THIS URL TO ANYONE. An authorization code is
#    short-lived: Django OAuth Toolkit, which CourtListener runs, expires it in 60 seconds.
#    If the exchange is not already typed and waiting, the first callback is dead on
#    arrival and you go round again.
SCOPE_ENC=$(printf '%s' "$SCOPES" | sed 's/ /+/g')
REDIRECT_ENC=$(printf '%s' "$REDIRECT" | jq -sRr @uri)
RESOURCE_ENC=$(printf '%s' "$RESOURCE" | jq -sRr @uri)
echo "https://${AUTH_BASE#https://}/authorize/?response_type=code&client_id=${CLIENT_ID}&code_challenge=${CODE_CHALLENGE}&code_challenge_method=S256&redirect_uri=${REDIRECT_ENC}&state=${STATE}&scope=${SCOPE_ENC}&resource=${RESOURCE_ENC}"

# 4. Browser will fail to connect to 127.0.0.1:8765 — fine. Copy the full
#    `http://127.0.0.1:8765/callback?code=...&state=...` URL from the
#    address bar and extract the code.
CODE="<paste code from callback URL>"

# 5. Exchange code for tokens. `resource` again — the authorize step alone does not bind it.
TOKENS=$(curl -sS -X POST "${AUTH_BASE}/token/" \
  --data-urlencode "grant_type=authorization_code" \
  --data-urlencode "code=$CODE" \
  --data-urlencode "redirect_uri=$REDIRECT" \
  --data-urlencode "client_id=$CLIENT_ID" \
  --data-urlencode "client_secret=$CLIENT_SECRET" \
  --data-urlencode "resource=$RESOURCE" \
  --data-urlencode "code_verifier=$CODE_VERIFIER")
echo "$TOKENS" | jq '{has_access:(.access_token!=null), has_refresh:(.refresh_token!=null), expires_in, scope}'

# 6. Assemble bridge cache file in the shape bridge.mjs expects.
#    `serverUrl` is the ORIGIN the bridge connects to, NOT the resource indicator — those are
#    two different strings here and the difference is the trailing slash. The SDK re-derives
#    the indicator from this URL's own protected-resource metadata at refresh time, so writing
#    the indicator in as serverUrl would point the transport at a URL nobody serves.
jq -n --argjson dcr "$DCR" --argjson tokens "$TOKENS" --arg server "$SERVER" --arg url "$RESOURCE_ORIGIN" --arg scope "$SCOPES" --arg ts "$(date -u +%FT%TZ)" '{
  serverName:$server, serverUrl:$url, scope:$scope,
  clientInfo:$dcr, tokens:$tokens, bootstrappedAt:$ts
}' > "${SERVER}.json"

# 7. Install into the bridge cache the MCP client's account will read.
sudo install -o "$SVC_USER" -g "$SVC_USER" -m 700 -d "$CREDS_DIR"
sudo install -o "$SVC_USER" -g "$SVC_USER" -m 600 "${SERVER}.json" "$CREDS_DIR/${SERVER}.json"

# 8. Cleanup scratch — bridge cache file owns the secrets now.
shred -u ./*.json 2>/dev/null; rm -f ./*.json; cd / && rmdir /tmp/cl-oauth
```

### Verify by forcing a REFRESH, because a sign-in cannot fail for the reason that matters

A `tools/list` against fresh tokens is not a verification of this recipe. It passes on a
credential bound to no resource — that is exactly the state that shipped, and every surface
we had said `enrolled` while the connector was already dead. The refresh is the only step
that exercises what the bootstrap got wrong, so the check has to reach it.

**In place, with a backup, and restore on failure.** A copy proves the token family *can*
refresh; it does not leave the file the engine reads holding the rotated token, so a passing
copy-test can still leave a deployment that dies. In place is both the truer test and the
state you want to end in — and the rollback makes a failure cost nothing.

```bash
CRED="$CREDS_DIR/${SERVER}.json"
sudo -u "$SVC_USER" cp -p "$CRED" "$CRED.bak"
OLD_REFRESH=$(sudo -u "$SVC_USER" jq -r .tokens.refresh_token "$CRED")

# Blank the ACCESS token only. The bridge must now refresh before it can answer.
sudo -u "$SVC_USER" bash -c "jq '.tokens.access_token = \"\"' '$CRED' > '$CRED.tmp' && mv '$CRED.tmp' '$CRED'"

sudo -u "$SVC_USER" bash -c '(printf "%s\n" "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"probe\",\"version\":\"0.1\"}}}"; sleep 2; printf "%s\n" "{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}"; sleep 1; printf "%s\n" "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\"}"; sleep 8) | node '"$BRIDGE"' --server '"$SERVER"' 2>/tmp/refresh-probe.err

NEW_REFRESH=$(sudo -u "$SVC_USER" jq -r .tokens.refresh_token "$CRED")
grep -q 'tokens refreshed' /tmp/refresh-probe.err \
  && [ "$NEW_REFRESH" != "$OLD_REFRESH" ] \
  && echo "REFRESH OK — token rotated on disk" \
  || { echo "REFRESH FAILED — restoring"; sudo -u "$SVC_USER" mv "$CRED.bak" "$CRED"; sed -n '1,40p' /tmp/refresh-probe.err; }
```

All three must hold, and each catches something the others do not: `tokens refreshed` in
stderr says the refresh path ran at all, a populated `tools/list` result says the new token
works against the server, and **the refresh token changed on disk** says the rotation was
persisted — the half whose absence bricks the next spawn on a server that revokes a reused
family. `InvalidTargetError: resource does not match refresh token` in that stderr means the
indicator is wrong or missing: go back to step 0 and read it from the server rather than
typing it.

Remove `$CRED.bak` once the check passes; it holds a working refresh token.

### Why there is no scripted bootstrap

An `mcporter auth <server>` login followed by a helper that converts its
credential file into a bridge cache would be the obvious shortcut. It is not
offered, because on mcporter 0.11.1 the login half produces a public client
whose token exchange fails — a helper over it would hand you a cache file that
looks right and dies at the first refresh.

If mcporter fixes `--static-oauth-client-metadata` propagation, that shortcut
becomes worth writing. Until then the recipe above is the whole procedure, and
running it by hand is the point: every value it writes is one you have seen.

## Two runtime models: per-session bridge vs. warm service

There are two ways to run an OAuth-protected upstream, chosen per server by how
its **access-token lifetime** interacts with the MCP client's per-session spawn
model:

| | `bridge.mjs` (per-session stdio) | `warm-server.mjs` (long-lived HTTP) |
|---|---|---|
| Process model | one spawn **per agent session** | **one** persistent service |
| Client config | `command`/`args` (stdio) | `{ url, transport: "streamable-http" }` |
| Refresh coordination | cross-process file lock (`refresh-lock.mjs`) | single in-process serialization (`withUpstream`) |
| Used by | **legaldatahunter** (~7-day token), and **courtlistener** where the clearance engine mounts it | **courtlistener** (~1-hour token) in the gateway deployment |

**Why courtlistener is warm.** CourtListener's ~1-hour access token means the
per-session bridge fleet refreshes constantly, and CourtListener rotates the
refresh token on every refresh + revokes the whole family on reuse detection.
That bricked the credentials twice: the file lock stops
two processes refreshing *simultaneously*, but not a **rotate-then-lost-response**
— a per-session bridge killed by the gateway connect-timeout (or a 5xx) *after*
the server rotated but *before* it persisted the new token strands a **consumed**
refresh token for the next spawn to re-present → family revoked → `invalid_grant`
on every spawn until re-bootstrap. `warm-server.mjs` removes the whole class: one
long-lived owner (no spawn storm, no per-session kill window) that **serializes
all upstream access** (so a refresh can never race another) and **refreshes
proactively** just after expiry, off any request's critical path. It re-exposes
the upstream as a loopback streamable-http MCP server on `127.0.0.1:18797`, and this
directory ships
[`systemd/courtlistener-mcp.service`](./systemd/courtlistener-mcp.service) to run it
that way.

Two caveats on "courtlistener is warm", both about WHERE. First, no box runs a unit of
that name: `driver/unit-inventory.mjs` declares the shipped one an orphan and records the
live service as `clawdi-courtlistener-mcp`, run from another checkout — so editing
`warm-server.mjs` or the unit file here changes nothing on the running proxy. Second, the
clearance engine does not reach the warm service at all: `driver/engine/mcp/gather-config.mjs`
mounts courtlistener as a per-session `bridge.mjs` spawn, exactly like legaldatahunter, so
every case-law stage of every clearance still spawns one — with the refresh lock, not the
warm model, as its only protection against the failure this section describes.

Nothing in this repo installs that unit. It is a **user** unit — it resolves
`%h` and wants `default.target` — so install it under the account that runs the
gateway:

```bash
install -Dm644 providers/oauth-mcp-bridge/systemd/courtlistener-mcp.service \
  ~/.config/systemd/user/courtlistener-mcp.service
systemctl --user daemon-reload
systemctl --user enable --now courtlistener-mcp.service
systemctl --user status courtlistener-mcp.service
```

**`ExecStart` carries a placeholder and you must substitute it.** The line reads
`@CLEAROTRON_CHECKOUT_DIR@/providers/...`. Nothing resolves it for you: the documented install creates no
units at all — they are the hosted-deployment opt-in step — so a unit you install by hand starts with the
placeholder still in it and will not start until you replace it with the absolute path of your own
checkout.

**Why this unit does not take `CLEAROTRON_CHECKOUT_DIR` the way the driver units do**: those load
`EnvironmentFile=%h/.env` and expand `${CLEAROTRON_CHECKOUT_DIR}` in `ExecStart`. This one deliberately
loads no environment file — it reads the OAuth cache at `~/.config/clawdi/oauth-mcp/courtlistener.json`
and needs nothing else — and on systemd an `EnvironmentFile` **overrides** the unit's own `Environment=`
lines, so adding one to gain the variable would also let `~/.env` silently replace this unit's `PATH`.
Editing one line is the smaller cost. Keep `loginctl enable-linger <user>` on if the service must
survive logout.

> Residual (honest): a single actor can still lose a rotation response to a 5xx
> and strand a consumed token — far rarer than the storm, and surfaced by the same
> `REFRESH TOKEN REVOKED` log. Fully eliminating it needs upstream to stop
> rotating, which is not ours to change.
>
> Stale-comment note: `refresh-lock.mjs`'s `waitMaxMs=28000` comment says "just
> under the gateway's 30s MCP connect timeout" — the engine's own gather config
> sets `connectionTimeoutMs: 60000` for bridge servers
> (`driver/engine/mcp/gather-config.mjs`). Harmless (28s is still a safe
> fail-open bound), but the number in the comment is out of date.

## Runtime invocation (MCP client config)

Per-session bridge (legaldatahunter):

```json
"mcp": {
  "servers": {
    "<server>": {
      "command": "node",
      "args": [
        "<checkout>/providers/oauth-mcp-bridge/bridge.mjs",
        "--server",
        "<server>"
      ]
    }
  }
}
```

Warm service (courtlistener) — a service runs
`warm-server.mjs --server courtlistener --port 18797`, and the client connects by URL:

```json
"courtlistener": { "url": "http://127.0.0.1:18797/mcp", "transport": "streamable-http" }
```

The bridge:

- Reads cached tokens at startup.
- Connects to the remote server via Streamable HTTP with an MCP-SDK
  `OAuthClientProvider` configured to refresh tokens when needed.
- Exposes the ALLOWLISTED remote tools (`ALLOWED_TOOLS` in `bridge.mjs`; the rest are
  dropped from `tools/list` and refused on call) via a local stdio MCP server, under
  their BARE upstream names — the bridge renames nothing. The CLIENT namespaces them:
  the clearance engine's grant is `mcp__<server>__*`; a per-agent allowlist on another client
  entry is `<server>__<tool>`, and the bridge's own audit line records
  `<server>__<tool>`.
- On token refresh, writes new tokens back to the cache file atomically
  (temp-file + `rename`), under a cross-process lock — see *Concurrency* below.
- Logs status to stderr, so it lands wherever the spawning process's stderr goes.

### How token refresh works (and how to test it)

When the cached access token expires, the SDK's auth flow calls the provider's
`prepareTokenRequest(scope)`, which returns a `refresh_token` grant; client auth
(`client_secret_post`) is applied automatically from `clientInformation()`. The new
tokens are merged into the cache via `saveTokens()` — **merged, not replaced**, because
these servers (CourtListener = Django OAuth Toolkit, Legal Data Hunter) **rotate the
refresh token on every refresh** and a refresh response often omits a new one; a blind
replace would leave the next refresh with no refresh token.

> **Lesson:** a bootstrap smoke test passes with *fresh* tokens and never
> exercises the refresh path, so it cannot catch a broken refresh. Both bridges silently
> died at their first access-token expiry (CourtListener ~1h after bootstrap, LDH ~7d)
> because the provider had no `prepareTokenRequest`. **Always verify by forcing a refresh**
> — blank the cached `access_token` in a throwaway `--creds-dir` copy and confirm stderr
> logs `tokens refreshed` plus a populated `tools/list`. Note: forcing a refresh consumes
> (rotates) the refresh token, so test on a copy and promote it, or expect to re-bootstrap.

### Concurrency — why a refresh lock ([`refresh-lock.mjs`](./refresh-lock.mjs))

The client spawns **one bridge process per agent session**, so several processes
share the single on-disk credential file. CourtListener (Django OAuth Toolkit)
and LDH **rotate the refresh token on every refresh and revoke the entire token
family if an already-consumed refresh token is re-presented** (reuse detection).
So two processes refreshing the same cached token at the same moment permanently
brick the credentials — every later spawn then dies with `invalid_grant`. This
is exactly what wedged CourtListener once (its ~1h access token makes
the whole fleet refresh constantly; LDH's ~7d token merely hid the same latent
bug).

The bridge serializes refreshes so each process always presents a *current*
token, never a consumed one:

- **`tokens()` reads through to disk** before every request, so once any sibling
  refreshes, the others pick up the fresh access token and never start their own
  racing refresh.
- **`prepareTokenRequest()` takes a cross-process lock** (`<server>.json.lock`,
  an `O_EXCL` lockfile whose mtime is heartbeated while held; a waiter reclaims
  it only after the lease lapses, i.e. the holder died) and re-reads the freshest
  refresh token under the lock. Released by `saveTokens()` on success, or the
  `main()` catch / `exit` handler on failure. On lock-wait timeout it **fails the
  session rather than refreshing unlocked** — a brick is worse than one session
  losing the tool until its next spawn.
- **`saveCreds()` writes atomically** (temp + `rename`) so a read-through never
  sees a half-written file.

When the refresh token is genuinely dead (true expiry / revocation), every
process still fails — but with a distinct `REFRESH TOKEN REVOKED — re-bootstrap
required` line on stderr instead of a buried MCP `-32000`. That's the signal to
re-run the bootstrap recipe above.

The lock primitive has no test of its own. Nothing but `bridge.mjs` imports
`refresh-lock.mjs`, so the `O_EXCL` + lease/heartbeat/reclaim behaviour above is
exercised only in production and a regression in it lands green. The one test in this
directory ([`test/warm-server.test.mjs`](./test/warm-server.test.mjs)) covers the warm
server's in-process `withUpstream` mutex instead — a different mechanism, and the one the
warm path uses precisely because it needs no file lock. That file is picked up by
`npm run test:providers`, so a regression in the mutex reds CI; the lock primitive above
still has nothing.

## Refreshing OAuth (when access tokens stop refreshing, e.g. after 90+ days of inactivity)

If the refresh-token chain breaks, there is nothing to repair — the credentials
are re-minted from scratch. **Re-run the manual DCR + PKCE recipe under
"One-time setup" above**, on a machine with a browser. It registers a fresh
client and overwrites `<creds-dir>/<server>.json` at step 7, so no cleanup comes
first.

Then pick the process back up:

```bash
# Per-session bridge (legaldatahunter): picks up fresh tokens on next spawn.
# Warm service (courtlistener): restart it to load the fresh cache.
systemctl --user restart courtlistener-mcp.service
```

## Tool allowlists

The bridge can't dynamically list remote tools into a client's tool allowlist, and what
to write there depends on the client.

On a per-agent allowlist, enumerate the exact tool names — a wildcard is not
reliable there across MCP-namespaced and plugin-namespaced tools. The clearance engine is
the other way round: `allowedToolsFor` (`driver/engine/mcp/gather-config.mjs`) grants a
bridge as `mcp__<server>__*`, a whole-server wildcard pinned by name in
`driver/test/server-tools-granted-or-stated.test.mjs` — so adding a bridge there hands
every holder every tool that server exposes, now and in future.

To discover the tool names on a fresh server:

```bash
mcporter list <server> --json | jq -r '.tools[].name'
```

Then add `<server>__<toolname>` for each to the client's per-agent allowlist.

## Files

- [`bridge.mjs`](./bridge.mjs) — per-session stdio adapter (legaldatahunter, and courtlistener as the clearance engine mounts it)
- [`warm-server.mjs`](./warm-server.mjs) — long-lived streamable-http proxy (courtlistener)
- [`systemd/courtlistener-mcp.service`](./systemd/courtlistener-mcp.service) — warm-service unit (:18797)
- [`refresh-lock.mjs`](./refresh-lock.mjs) — cross-process refresh lock (per-session bridge only)
- [`test/warm-server.test.mjs`](./test/warm-server.test.mjs) — mock-upstream arms: proxying, the allowlist, and mutex serialization (with a control proving the fixture can see overlap)
- [`package.json`](./package.json) — `@modelcontextprotocol/sdk` dep

## Servers currently wired

- **`courtlistener`** — `https://mcp.courtlistener.com`, 14 tools (search,
  citation tools, alerts, generic endpoint access). OAuth 2.1 with DCR. Runs BOTH
  ways: the gateway deployment runs it as the **warm service** (`warm-server.mjs`,
  :18797), while the clearance engine mounts it as a **per-session bridge**
  (`bridge.mjs`) — `driver/engine/mcp/gather-config.mjs` spawns both case-law
  servers that way. See the two-models table above and its two caveats.
- **`legaldatahunter`** — runs as the **per-session bridge** (`bridge.mjs`); its
  ~7-day token doesn't churn, so the warm model isn't needed (yet).

Add more in three steps, not two: repeat the one-time setup above; add an
`ALLOWED_TOOLS` entry for the server in `bridge.mjs` (and in `warm-server.mjs` if it
runs warm — both exit 2 at startup for a server that has none, before any connection is
attempted); then add the server entry to the MCP client's config (per-session
`command`/`args`, or warm `{url, transport}` + a service unit if it has a short access
token).
