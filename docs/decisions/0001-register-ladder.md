# 0001 — Signa is the recommended register; the ladder has three tiers

**Accepted.**

## Context

A reader arriving at this repository has to choose a register before anything else works, and the choice
was presented as six equal options in at least three different orders across eighteen files. The free tier
led, because free reads as the lowest barrier. It is not: EUIPO needs an account and an API application,
and the US half is a 41.5 GB download and roughly nine hours of indexing before it answers a single query.

Signa issues an API key self-serve, covers the US and EU registers together plus WIPO/Madrid and eight
more offices, and has native sound-alike search. It was offered last, described in seven words, and the
fact that it is self-serve appeared in no file that ships.

## Decision

Three tiers, in this order, everywhere the choice is presented:

1. **Signa** — recommended. One self-serve key; US + EU + WIPO and eight more offices.
2. **Free tier** (EUIPO + a local USPTO index) — the no-vendor route, with its limits stated rather than
   implied: no sound-alike search on either member, no Madrid layer, no oppositions, no images, and a US
   half that is a build rather than a key.
3. **Corsearch / Clarivate** — widest coverage; credential issued by the vendor.

`providers/README.md` is the canonical statement. Every other file carries a one-line pointer to it and no
competing recommendation.

## Consequences

- Being free is not the same as being low-barrier, and the docs must not conflate them. The free tier's
  limits are stated at the point of choice, not discovered later.
- **The EUIPO sandbox is not the register.** It is a frozen snapshot carrying synthetic test marks, reachable
  quickly, and unusable for a clearance. Both halves of that go in the ladder.
- A capability claim in the ladder must be derivable from the provider's own `capabilities.js`, where every
  value carries the probe that established it. The ladder states nothing the contracts do not already assert.
- The wizard's order is asserted by `driver/test/onboard-wizard.test.mjs`, which currently pins free-first.
  That assertion encodes the superseded policy and changes with this decision.
