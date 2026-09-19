<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md -->

# Onboarding a company

One page, one command.

A company is a business whose names this installation clears — your own, or one you clear names for.
Onboarding one means creating its bundle in the company store and choosing the risk framework its
clearances are rated under. The command still says `brandowner`, the word it used before the product
settled on company. Before this page existed the command shipped and no document mentioned it, so an
operator following the docs hand-edited JSON in a directory holding real companies' material.

## Before you start

You need the company store. `CLEAROTRON_CUSTOMERS_DIR` names it, and the command refuses by name if it
is unset or unreadable rather than writing somewhere else. It is the private config repository described
in `docs/architecture/05-config-governance.md` — not part of this repository, and not created by the
installer.

## The command

```
clearotron brandowner add <key> --name "<legal name>" [options]
```

`<key>` is the bundle's filename and its identity everywhere else. It is validated on the way in, so a
malformed one is refused before anything is written.

| option | |
|---|---|
| `--name` | the legal name. Required. |
| `--domains` | comma-separated email domains that resolve to this company |
| `--platforms` | marketplaces their searches cover. Omitted, the default's platforms apply and are named in the output. |
| `--framework` | their risk framework, as `skills/clearance-search/<file>.md`. Omitted, the default applies and is named in the output. |
| `--industry` | free text, shown on their profile |
| `--context` | a file whose contents become this company's context pack |
| `--dry-run` | say exactly what would be written, and write nothing |

**Run it with `--dry-run` first.** It prints the same decisions and the same refusals against the same
store, and writes nothing — so the first real run is one you have already read.

## The framework is always set, and the output says which one

Ruling, 2026-08-29: the risk framework is mandatory at onboarding, with a default backup so
onboarding is never blocked. The command therefore sets a framework on every bundle it writes, and
prints which one it used.

**Absent and broken are different events, deliberately.**

- **You gave no `--framework`.** The default applies, and the output names it. Onboarding proceeds —
  a company without a framework of its own yet is not a reason to refuse it.
- **You gave one and it cannot be read.** The command refuses and writes nothing. Falling back here
  would rate a company's clearances under a framework nobody chose, while the operator believed they had
  set theirs — silently, which is the part that makes it worth an exit code.

Read the line that names the framework. It is the whole receipt for a decision you cannot see in the
bundle afterwards without opening it.

## What the exit codes mean

| | |
|---|---|
| `0` | written and recorded |
| `1` | refused — nothing was written |
| `2` | usage |
| `3` | **written but NOT recorded** — the bundle exists and the store has no record of it |

`3` is the one to act on. It is not a failure to write and it is not a success: the bundle is on disk
and the store's own record does not mention it, so a later read may not find what a directory listing
plainly shows. Reconcile it before onboarding anything else.

## After it succeeds

The company's profile is readable by the portal and by the engine, and its profile page in the portal
shows the framework's title and bands. Order a first clearance for it the way you order any other —
through the portal, or through the MCP door described in `docs/CLIENT-MCP.md`.

## What this page does not cover

Editing an existing company, and the validation the portal's own profile form applies. Both are the
profile service's, not this command's — a save from the portal may not introduce a framework selection,
and that refusal is deliberate and is documented with the service rather than here.
