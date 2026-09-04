# The portal

*One address and one login, for staff and clients alike.*

**Two ways to prove who you are, and one place that decides what you see.** Hosted,
`PORTAL_AUTH_MODE=auth-proxy` means any login system in front that authenticates in the browser and
forwards a verifiable JWT per request — **any OIDC provider is a choice you make per deployment, not a
special case in the code.** For example, Cloudflare Access needs `CF_ACCESS_TEAM` + `CLEAROTRON_OIDC_AUDIENCE`;
your own provider needs `PORTAL_OIDC_ISSUER` and, if the keys are not derivable from it,
`PORTAL_JWKS_URL`. `PORTAL_EMAIL_CLAIM` and `PORTAL_AUTH_HEADER`
name the claim and the header. **Fronting the portal with a different JWT proxy is CONFIG, not code**
— the same posture the MCP face has always had.`cf-access` remains a valid value for the mode
and means exactly what `auth-proxy` means. On a single machine, the local sign-in below proves it instead. Either way
`driver/portal-access.mjs` is the inner boundary (roster → principal → the `assertPrincipal`
chokepoint every scoped route passes) — it takes an email address and has no opinion where it came
from, so a third door changes nothing about
who sees what. Putting it on a public hostname is a deployment step of your own — DNS, the edge and
enrolment — and none of it is done by installing this repo.

## The model

| Who | Sees |
|---|---|
| Staff (email domain ∈ `PORTAL_STAFF_DOMAINS`) | everything, with an explicit **acting-for** account on scoped routes (never an implicit firm-wide default) |
| Enrolled client (email in the grants file) | exactly their accounts: their searches, their runs, their released client reports |
| Anyone else | 403 at the door; cross-account probes read as **404** (existence never leaks) |

The enrolment substrate IS the grants file (`CLEAROTRON_ACCESS_FILE`, [the operations runbook](architecture/06-operations-runbook.md#access-control-and-instance-isolation)
for the shape and `examples/grants.example.json` for a runnable one) — portal
enrolment and MCP grants stay one roster, no migration later; the file is re-read PER REQUEST, so
enrolment lands without a restart. **Enrolment is two-sided** — the address must be authenticated at
whichever door this instance runs, then granted here; the model is stated once in
[docs/SECURITY.md](SECURITY.md). On a proxied instance that means
`MCP_ALLOWED_EMAIL_DOMAINS` and/or `MCP_ALLOWED_EMAILS` (no default — the portal
refuses to start with neither set, and combines the two as a UNION rather than the verifier's default
intersection) must admit the CLIENT identities as well as the staff domain: the staff domain in the
domain list, and individually named client addresses in `MCP_ALLOWED_EMAILS` rather than their whole
domain — admitting a consumer domain wholesale to enrol one client would put every address on it
through the door, leaving the grants file as the only wall. Untagged and `generic` runs are staff-only on
every client surface — a run with no account tag belongs to no client, so it is shown to none of them.
Multi-account clients enter the door normally and pick an account (`/portal/api/me` returns the list).
The one-shot confirmation store is in memory, which bounds the deployment to **one portal process per
instance**: a second process would not see the first's CONSUMED jtis, so the one-shot guarantee fails
OPEN rather than closed — the token itself verifies anywhere (both processes hold the same
`PORTAL_SECRET`), and a replay inside the TTL would be accepted by whichever process had not yet
burned it.

## Surfaces (`driver/portal-service.mjs`, loopback — `PORTAL_SERVICE_PORT`, default 18802)

- `GET /portal` — the one-page UI (searches · run with confirmation · runs list).
- `GET|POST /portal/login`, `POST /portal/logout` — **local mode only**: a server-rendered
  sign-in form, not a screen in `portal-ui`. The names are reserved on every deployment, so behind CF
  Access they 404 rather than rendering the app shell. A signed-out browser is redirected here; a
  signed-out API caller gets the same 401 the edge produces for a missing JWT.
- `GET /portal/api/searches?account=` — registry levels + the account's saved recipes.
- `POST /portal/api/run/plan` — the **confirmation gate**: validation, the registry-derived
  stage label (never a client's recipe label), mark count, turnaround hint, the standing caveat, and
  a 10-minute HMAC `confirmationToken` bound to the fields of the server-stamped job that fix scope,
  cost and identity (`jobHashOf`: marks, markName, classes, goods, product/recipeKey), the confirming
  identity, and a ONE-SHOT jti. Jurisdictions are deliberately OUTSIDE the hash, so the plan step can
  normalise territories (the worldwide token, the dedupe) without invalidating the token. Nothing
  spends here.
- `POST /portal/api/run` — re-runs the plan gates, verifies the token (a mutated request, another
  sign-in's token, or a replay all 409) then triggers via **real MCP JSON-RPC over the ops face's
  `/mcp`** (`driver/portal-mcp-client.mjs`: initialize → tools/call with the accounts-scoped
  `PORTAL_OPS_TOKEN`; wire shape test-pinned against the face's own handler) — the portal's blast
  radius is that token's grant, enqueue-only, and scoped tokens must name `profileKey` explicitly.
  Job identity (profileKey, forwarder, forwarderEmail) is SERVER-stamped from the verified principal;
  an upstream refusal is audited and surfaced as an honest 502. The runner's admission gate
  (`runCaps`, dedup, product gates) applies unchanged — the portal is just another door. The verified
  token `sub` is frozen into the run as `enqueuedBy` in `_driver/search-policy.json` on every lane,
  and copied into `meta.json` by the clearance publisher.
- `GET /portal/api/runs?account=` — delivered pool rows (released reports linked; held runs listed
  unlinked) + live workspace rows.
- `GET /portal/report/<runId>/` — the CLIENT export, ownership-checked; foreign/held/missing = 404.
- `GET /portal/admin/*` — staff-only (clients get 404).

Every plan/trigger is audited to `PORTAL_AUDIT` (JSONL, verified email + account + selector).

## Per-account admission caps (`runCaps`)

Customer-profile key (visible, git-tracked — never a hidden env var). The closed key set is
`{maxQueued?, dailyRuns?, monthlyRuns?}`, at least one required when the block is present
(`driver/profiles.mjs`) — for example
`"runCaps": { "maxQueued": 3, "monthlyRuns": 40 }` — enforced at the runner's `claimAndPrep`
chokepoint for EVERY door (email, CLI, MCP, portal). Over-cap **clarifies** (requester notified,
re-sendable), never drops. Monthly counting rides the matter ledger (now stamped with `profileKey` +
`enqueuedBy`); queued counting scans the queue manifests' tags. Customer-only (a project cannot
widen caps). `runCaps` is one of the `CODE_OWNED_FIELDS` (`driver/profile-service.mjs`): the profile
editor has no form field for it and preserves whatever is on file across a save, so it is edited in
the profile JSON and never lost by a form that does not mention it.

## Running it locally — one person, one passphrase

There were two ways in and only one of them proved anything: the auth-proxy edge, or
`PORTAL_AUTH_DISABLED=1` + `PORTAL_DEV=1`, which did not authenticate anybody — it skipped identity
and handed every caller the same synthetic address. **Both switches are deleted**, along with
`PORTAL_DEV_EMAIL`. Local mode replaces them with a real sign-in.

**Use `npx clearotron start`.** It is the documented way to run this product on one machine
([INSTALL.md](../INSTALL.md) §6) and it assembles everything below for you: the portal, the MCP face the Start button
calls, a minted ops key, the grants file, the saved-search store and the data-plane paths — one command,
one URL, `Ctrl-C` stops both processes. Nothing here needs an `*_AUTH_DISABLED` variable, and the
launcher sets the MCP face's pair to `0` so it cannot inherit one.

What that command starts, for anyone who needs to drive the portal on its own:

```bash
# the portal with the LOCAL identity source (no CF Access, loopback only)
PORTAL_AUTH_MODE=local PORTAL_LOCAL_USER=cli@celta.example \
PORTAL_STAFF_DOMAINS=example-firm.com CLEAROTRON_ACCESS_FILE=$HOME/trademark-dev/grants.json \
PORTAL_SECRET="$(openssl rand -base64 32)" CLEAROTRON_REPORTS_DIR=$HOME/trademark-dev/pool \
CLEAROTRON_WORK_DIR=$HOME/trademark-dev/workspace node driver/portal-service.mjs
# → http://127.0.0.1:18802/portal/login
```

The first start writes `~/.cordillera/portal-local-credential.json` (mode 0600) and prints a generated
passphrase to the terminal **once** — write it down, because nothing stores it in a form that can be
read back and no later start reprints it. `PORTAL_LOCAL_CREDENTIAL` moves the file; deleting the file
and restarting mints a new passphrase.

What local mode does **not** change is who sees what. It produces an email address and stops;
`makePrincipal` and the `assertPrincipal` chokepoint judge it exactly as they judge a
proxy-verified address, so `PORTAL_LOCAL_USER` must ALSO be enrolled — a staff domain for the
staff view, a grants row for the client view. Sign in as an address the roster does not know and every
page refuses it at the door, which is the correct answer and is warned about at boot. The roster itself
stays mandatory: local mode has a population of one, and one is still a population.

Two things the mode selection deliberately refuses to guess. `PORTAL_AUTH_MODE` unset means
**auth-proxy**, so a deployment that loses `CLEAROTRON_OIDC_AUDIENCE`, or loses both `CF_ACCESS_TEAM` and
`PORTAL_OIDC_ISSUER`, still refuses to start
rather than quietly opening a passphrase door instead; and local mode refuses a non-loopback
`PORTAL_SERVICE_HOST`, because off loopback the passphrase and the session cookie are on the wire in
clear. Put a TLS-terminating proxy in front if it has to be reachable.

Grants fixture: `{"tenants":{"demo":{"accounts":["aurora"],"users":{"cli@celta.example":["aurora"]}}}}`.

The trigger lane needs the MCP HTTP face and an accounts-scoped ops token; without both, the run step
reports the trigger lane unwired and the plan step still works. **The face no longer has to be run in
its dev bypass to provide that**:`TRADEMARK_MCP_AUTH_MODE=token` runs it with a mandatory scoped
access key and no auth proxy — loopback only, and refused outright alongside
`TRADEMARK_MCP_AUTH_DISABLED`, which authenticates nobody. Mint the key with
`mint-token.mjs --scope ops --sub portal --verbs start_run,stop_run --accounts aurora`, or let
`npx clearotron start` mint one in memory at every start and never write it down.

## Putting your own login provider in front

The section above is the **local** door: one address, one passphrase, no identity provider. It is what
this install produces and it is the right answer for a single-operator box.

The other door is **auth-proxy**: an OIDC or JWT proxy sits in front of the portal, proves who the
caller is, and passes the verified identity through. The portal then trusts that header rather than
asking for a passphrase.

The mechanism is generic: the origin re-validates the proxy's signed assertion, whichever proxy is in
front. Any OIDC or JWT provider that fronts an origin will do — Cloudflare Access is a choice, for
example, and so is Entra, Google or Okta. **There is no vendor-specific path in the product.** The
worked example below uses Cloudflare Access because this deployment's production instance runs it.

Which door runs, and what each one proves, is stated once in
[`SECURITY.md`](SECURITY.md). Read that before you choose; this section is the procedure, not
the model.

**The four values the portal reads:**

| variable | what it is |
|---|---|
| `PORTAL_OIDC_ISSUER` | the issuer URL your provider publishes |
| `PORTAL_JWKS_URL` | where its signing keys are served |
| `PORTAL_EMAIL_CLAIM` | which claim in the token carries the address |
| `PORTAL_AUTH_HEADER` | the header the proxy forwards the assertion in |

**The procedure:**

1. Put the proxy in front of the portal's port and make it require sign-in. The portal must not be
   reachable except through it — an origin a client can reach directly is an origin with no door.
2. Set `PORTAL_AUTH_MODE=auth-proxy` and the four values above in `.env`.
3. `npx clearotron doctor` — the **Portal door** section reports which door is configured and which of
   the four values are present, by name. It never prints their values.
4. Sign in through the proxy once and confirm the portal shows your address rather than a passphrase
   box.

**Worked example — Cloudflare Access.** Create an Access application over the portal's hostname, set the
policy to the addresses that should reach it, then:

```
PORTAL_AUTH_MODE=auth-proxy
PORTAL_OIDC_ISSUER=https://<your-team>.cloudflareaccess.com
PORTAL_JWKS_URL=https://<your-team>.cloudflareaccess.com/cdn-cgi/access/certs
PORTAL_EMAIL_CLAIM=email
PORTAL_AUTH_HEADER=Cf-Access-Jwt-Assertion
```

For example, `CF_ACCESS_TEAM` is still read as a fallback for the issuer, so a deployment already
fronted this way keeps working without being rewritten.

**Leaving `PORTAL_AUTH_MODE` unset selects auth-proxy, not local.** An install that sets nothing and has
no proxy in front is the one shape to avoid: `doctor` reports the fronted door with all four values
absent, and the portal refuses to start without an issuer. If you want the passphrase door, say
`PORTAL_AUTH_MODE=local`.

## How a run gets its account

`runAccountKey` (`mcp-server/lib/runs.mjs`) reads the run's own frozen profile sidecar
(`_driver/profile.json`) and takes `profileKey`, falling back to `key`. That key is what grants
scoping filters on, so a run whose sidecar carries neither is untagged and reaches no client surface.

The write side is gated the same way. An accounts-scoped token can only dequeue jobs inside its
grant — `stop_run` checks the account on the queue form as well as on a live run — and every
`start_run` stamps the verified token `sub` into the job as `enqueuedBy`, ignoring any value the
body supplied.
