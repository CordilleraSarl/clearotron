# Documentation

*The map of everything under `docs/`.*

New here? Start at the repo root: [`../README.md`](../README.md) — what this is, and a demo you can
run in two minutes with no credentials. Then [`../INSTALL.md`](../INSTALL.md) to set it up and run a
real clearance.

## The clearance itself

What the engine searches, how it decides, and what it will not claim.

| Doc | What it answers |
|---|---|
| [`INTAKE.md`](INTAKE.md) | What a run may be asked for, and what it refuses |
| [`DELIVERY.md`](DELIVERY.md) | What a finished run emits, and the contract an integrator wires to |
| [`../providers/jx/README.md`](../providers/jx/README.md) | The native-script lane — why it exists, what it costs, what it cannot do |
| [`../providers/README.md`](../providers/README.md) | Which register each source can search, derived from each adapter's own capability contract |

The four searches are declared in [`../driver/products.mjs`](../driver/products.mjs), which is what the
engine reads. What a register hit count means is declared per adapter in its `capabilities.js`: a count
the vendor flags approximate is UNKNOWN, never a number.

## Making it yours

| Doc | What it answers |
|---|---|
| [`configuration.md`](configuration.md) | Registers, risk frameworks, client profiles — the practice-level settings |
| [`architecture/04-configuration-reference.md`](architecture/04-configuration-reference.md) | Every environment variable, with ownership tiers |
| [`architecture/05-customer-profiles.md`](architecture/05-customer-profiles.md) | Profile internals and the onboarding runbook |

## Operating it

| Doc | What it answers |
|---|---|
| [`INTAKE.md`](INTAKE.md) | How a job reaches the runner — the headless queue contract |
| [`DELIVERY.md`](DELIVERY.md) | What the engine emits when a run finishes, and who sends it |
| [`PORTAL.md`](PORTAL.md) | The portal: what it serves, and who sees what |
| [`CLIENT-MCP.md`](CLIENT-MCP.md) | Publishing a connector your customers sign in to, and how their access is scoped. To connect *your own* app to *your own* runs, use [`../mcp-server/CONNECT.md`](../mcp-server/CONNECT.md) instead |
| [`E2E.md`](E2E.md) | Proving a deployment works end to end |
| [`SECURITY.md`](SECURITY.md) | The security envelope — what protects what, and where it is enforced in code. To report a vulnerability, use [`../SECURITY.md`](../SECURITY.md) |

Access control is stated once, in [`SECURITY.md`](SECURITY.md): who may see which runs, what an unset
guest list means on each face, and which door proves identity. Issuing and rotating grants and ops
tokens is [`architecture/06-operations-runbook.md`](architecture/06-operations-runbook.md#access-control-and-instance-isolation);
what you set at install time, including the four variables that keep two instances on one machine
apart, is [`../INSTALL.md`](../INSTALL.md) §8.
[`../examples/grants.example.json`](../examples/grants.example.json) is a runnable guest list over the
demo clients.

## Architecture

[`architecture/`](architecture/) is the reference pack: product overview, run lifecycle, the
configuration reference, the
[config-governance inventory](architecture/05-config-governance.md), customer profiles, quality and
audit, security and data, and the
[development guide](architecture/08-development-guide.md) — which is where to look before adding a
stage, an engine adapter, or a register provider.

**Adding an environment variable anywhere in this repo means adding a row to
[`05-config-governance.md`](architecture/05-config-governance.md).** Nothing enforces that
mechanically; it is a convention held by review.

## What this repo contains, and what it does not

**No client data.** No client names, no marks under clearance, no matter numbers, no run identifiers.
A guard sweeps every tracked file for client identity,
and a second sweeps for operator identity and for any
citation of a path withheld at the public cut — that second one reads a list of withheld paths
carrying a reason per entry, and fails a citation of one that is not declared. Both are tests in the contributor
tier, so they run under `npm test` on any clone and in CI on every push.

**The guard has a limit worth stating.** Half of it matches a blocklist held outside this repo, and a
blocklist stops what it lists from coming back — it cannot recognise a name nobody has seen before.
The other half is structural: it fails on any undeclared identity inside a matter-scoped fixture,
which is the half that catches something new. Without the private table the guard runs on synthetic
sentinels: the machinery is exercised and there is nothing real to find.

**Demo clients are synthetic.** A Generic default (`generic`) plus three inventions — `aurora`
(gaming), `zephyr` (functional drinks), `petcary` (animal health). They exercise the per-client
machinery and the test suite. Real client bundles load at runtime from a private store
(`CLEAROTRON_CUSTOMERS_DIR`) and are never committed here.

**Real third-party names are deliberate.** Registers, marketplaces, regulators, research providers and
the parties to published decisions are named throughout the code, tests and fixtures — as facts about
the world, being the sources a clearance actually searches. No affiliation or endorsement is implied,
and each name remains its owner's. See [`../TRADEMARKS.md`](../TRADEMARKS.md).

**Some material is held back.** Working design notes, commercial preparation and third-party API
specifications obtained under vendor conversations do not ship. Our adapter code publishes; the
vendors' material does not.
