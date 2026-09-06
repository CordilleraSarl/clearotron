<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md -->

# Releases: which version you get, and what it promises

Clearotron publishes on **two channels**. Which one you are on is decided by how you install it, and
nothing else.

```bash
npm install -g clearotron          # stable — the tested one
npm install -g clearotron@beta     # newest — every merge, minutes after it lands
```

## What each channel promises

| | `latest` (stable) | `beta` |
|---|---|---|
| **Version looks like** | `0.2.0` | `0.2.1-beta.4` |
| **Cut when** | a beta has passed a full clearance run and a from-scratch install by somebody who has never seen the product, and the owner says go | every merge to `main`, automatically |
| **Promises** | it installed and ran a real clearance end to end before it was published | it built, and the automated suite passed |
| **Use it if** | you are running this for real work | you want a fix that landed today, or you are helping test |

**Both are published the same way** — from CI, with provenance you can check back to the commit that
produced it, and with no long-lived credential anywhere. The difference is what was proved before the
publish, not how it was made.

## If you are not sure, take the stable one

`npm install -g clearotron` is the stable channel. A beta is not a warning label — it is the same code a
few days earlier, and it is what `main` is running — but nothing has driven a real clearance through it,
so a fault that only appears against a live register can still be in there.

**Production upgrades to stables only.** That is the rule for our own deployment and it is the rule we
suggest for yours.

## How often

A stable is cut when a beta earns it, which we aim at roughly weekly. Betas arrive whenever something
merges — several a day when a round is running, none for a day when nothing lands.

Numbering follows the change, not the calendar: `0.2.x` for fixes, `0.3.0` when a feature lands, `1.0`
when the hit-list redesign ships.

## Moving between them

```bash
npm install -g clearotron@0.2.0    # pin exactly
npm install -g clearotron          # back to stable
```

Downgrading is an ordinary install of the older version. Your configuration and your pool are not touched
by either — they live outside the package — so moving between channels is not a migration.

Every version's notes are on the [releases page](https://github.com/CordilleraSarl/clearotron/releases)
and in `CHANGELOG.md`, grouped New / Fixed / For operators. A beta's notes are the same notes; the stable
that follows aggregates all of them into one entry.
