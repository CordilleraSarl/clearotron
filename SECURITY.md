# Security policy

## Reporting a vulnerability

**Do not open a public issue.** A clearance run touches client matter; a report that names a real
weakness in public is a second incident.

> **Two private channels. Either one, whichever you already have open.**
>
> - **Email [contact@clearotron.ai](mailto:contact@clearotron.ai)** — a monitored mailbox, not a
>   person, so it does not depend on anyone being at their desk.
> - **GitHub's private vulnerability reporting** — the **Report a vulnerability** button under this
>   repository's **Security** tab. Private end to end, and it needs no address from us.
>
> If neither is available to you — no mail, and no button because this repository has not enabled it
> — then, and only then, the one exception to the rule above: open an issue saying you have a
> security report and nothing else — not the component, not the version, not how to trigger it — and
> wait for a maintainer to give you somewhere private. A missing channel is not a reason to publish a
> working exploit.

Include what you would want if you received it: what you did, what happened, what you expected, and
the smallest input that shows it. If you have a patch, say so and hold it until we reply.

**What to expect.** An acknowledgement within three working days, an assessment of severity and
affected versions, and a fix or a written decision not to fix. We will credit you by name unless you
ask us not to.

**Never attach a run artifact to a report.** Reports, audit workbooks, run directories and pool
contents can carry client names, marks and matters. Describe the shape of the data instead, or
reproduce it against the repo's synthetic fixtures.

## What is in scope

This repository: the clearance driver, the MCP server, the provider adapters, the portal UI, and the
scripts that ship with them.

In particular, we want to hear about anything that breaks these:

- **The MCP authorization boundary.** A `user` token is pinned to exactly one run and is read-only. A
  token that enumerates runs, crosses to another run, reaches a write tool, or reads an internal
  artifact is a vulnerability, not a bug.
- **Fail-closed construction.** The HTTP face refuses to start without an audience, an issuer, and an
  identity gate. Any path that serves a request with authentication silently absent is in scope.
- **The dev portal's loopback bind.** `driver/dev-portal.mjs` must refuse every non-loopback host.
- **Client-facing surfaces leaking internals.** An env var name, a switch name, or an internal path
  rendered into a report or a client-visible error.
- **Traversal and injection** into artifact reads, pool paths, or run directories.

[`docs/SECURITY.md`](docs/SECURITY.md) documents the whole envelope — what protects what, and where
it is enforced in code. Read it before reporting; it will tell you whether a behavior is a hole or a
design you have not seen the other half of.

## What is out of scope

- A deployment's own configuration: your auth proxy, your TLS, your firewall, your Perplexity key.
- Findings from an automated scanner with no demonstrated path to impact.
- The absence of a rate limit on a local stdio tool. The stdio face is trusted by construction and
  guarded by the OS user boundary; run it as the operator account.
- Vendor APIs this repo talks to. Report those to the vendor.

## Supported versions

This is a pre-1.0 snapshot. Only `main` is supported; there are no backports.
