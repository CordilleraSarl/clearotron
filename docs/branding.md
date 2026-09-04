# Run it under your own name

Operational guidance, not policy. What you may call your deployment is
[TRADEMARKS.md](../TRADEMARKS.md); this page is how you change what the software prints.

**Delivering a report that carries somebody else's brand is the failure this page exists to prevent.**
A clearance report is read by a lawyer and forwarded to a client. If it arrives under a name that is not
yours, you have built the exact problem the software exists to detect.

## What to do instead

Every name the engine stamps on an artifact comes from one seam, so a deployment sets three variables
and no code. An older `CLEAROTRON_BRAND_*` spelling of each still works and still takes effect — an existing
install needs no change — but the names below are the ones to write:

| Variable | Default | Where it surfaces |
|---|---|---|
| `CLEAROTRON_BRAND_NAME` | `Clearotron` | Report title and watermark, pool index header, portal nav, Excel metadata, connector instructions |
| `CLEAROTRON_BRAND_TAGLINE` | *(empty — no strapline is rendered)* | Report and portal chrome |
| `CLEAROTRON_BRAND_PRODUCT` | `Trademark clearance` | Artifact naming and connector instructions |

**The defaults name the product, not a firm.** A deployment that sets nothing produces neutrally
branded output. That is deliberate: the alternative is what this page warns against, with one
organisation's name as the path of least resistance. Setting `CLEAROTRON_BRAND_NAME` to your own
organisation is still the step to take before you deliver anything to anyone.

There is no neutral strapline, so `CLEAROTRON_BRAND_TAGLINE` defaults to empty and an empty tagline
renders as **absent** — no element, no stray separator — rather than as a blank line.

They are read once, at import (`shared/brand.mjs`), so they are deployment-static: set them in the
environment file and restart.

**Three things that seam does not cover**, stated because finding them at deploy time is worse:

- **The palette is not env-overridable.** Brand colours are defined in code beside those variables.
  Changing them is a code change, not configuration.
- **Neither is the mark.** The ridge mark is drawn in code (`shared/brand.mjs`) and is Cordillera's,
  not the product's. A deployment that sets the three variables gets its own *name* on every artifact
  and still gets that mark beside it. Replacing it is a code change today; if you are deploying under
  your own name, do it. The Swiss flag that used to sit inside the wordmark is **gone** — a shape is
  not a claim, but a national flag beside someone else's name was one.
- **`portal-ui/dist` is committed and CI byte-compares it against a fresh build.** Brand strings are
  baked into that bundle, so changing a default means `npm run build:ui` and committing the result —
  not a text edit.

## Third-party names in this repository

Register operators, marketplaces, regulators, research providers and case-law parties are named
throughout the code, docs, tests and fixtures. They are named as **facts about the world** — the sources
a clearance search actually queries, and the parties to published decisions. No affiliation, sponsorship
or endorsement is claimed or implied, and each name remains its owner's.
