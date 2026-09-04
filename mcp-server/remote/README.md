# mcp-server/remote — deployment templates for the hosted faces

Service and ingress templates for running the MCP server as an authenticated internet-facing service, plus
the runbook that walks one auth proxy end to end.

**You do not need any of this to use the MCP server.** Spawning it from your own clone over stdio needs no
proxy, no hostname and no credential — [`../CONNECT.md`](../CONNECT.md) is four lines of copy-paste. This
directory is for publishing a connector other people sign in to.

| File | What it is |
|---|---|
| [`REMOTE-SETUP.md`](REMOTE-SETUP.md) | **The runbook.** Provisioning worked through one stack end to end: Cloudflare Tunnel + Access + Entra ID + systemd |
| `trademark-artifacts-http.service` | Template unit for the staff HTTP face |
| `client-mcp.service` | Template unit for the client face, behind an auth proxy |
| `client-mcp-apikey.service` | Template unit for the API-key door — the client face reached with a credential instead of a browser login |
| `cloudflared-ingress.example.yml` | Tunnel ingress — hostname → loopback port. The filename names one such tool; adapt it to whatever fronts your deployment |

## These are templates, and a placeholder that looks configured is worse than unset

**Never copy one of these over a live service definition.** The runbook says so and it is the mistake worth
naming twice: these files carry placeholder ports, hostnames and audience values. Applied to a running
deployment they replace real configuration with values that start a process listening in the wrong posture.

Add variables to the unit that already carries your real port, host and audience. Read a template to see
which variables a face needs; do not deploy it.

## What the templates encode, and why it is not a flag

Each face is a **separate process**, and that is the design rather than an accident of packaging: "a client
cannot reach staff read-all" is a fact about which binary is listening on which port, not about a flag being
set correctly. The same reasoning gives the API-key door its own unit — no auth proxy in front, so the key
*is* the authentication, and that posture difference is a different process rather than a mode.

Every face binds loopback. The only way in is the proxy you put in front of it, and each face re-validates
that proxy's JWT on every request rather than trusting the hop.

**They are fail-closed on purpose.** A face refuses to start — not degrade — when its issuer, audience,
identity gate or allowed-hosts list is missing, and the API-key door additionally refuses on a non-loopback
bind, without a token secret, or combined with the dev bypass. If a unit you copied starts and you expected
it to refuse, check that you edited the right file.

## Standing one up

[`REMOTE-SETUP.md`](REMOTE-SETUP.md) for the provisioning, and
[`../../docs/CLIENT-MCP.md`](../../docs/CLIENT-MCP.md) for what a customer reaches once you have — the
eleven account tools, why the rest are withheld, and the daily allowance to set before you enable a demo
tenant. Verify before exposing anything: `curl 127.0.0.1:<port>/healthz`, then read the boot log, which
states its posture in words.
