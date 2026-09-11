---
"clearotron-driver": patch
---

Fixed: Creating a company is refused, with nothing left behind, when the configuration store cannot record it. The company used to be created anyway, with no record of who made it or when, and its organisation was given access to it.

A store with no git identity is the usual cause on a new machine, and the refusal names the command that fixes it. Setup and `clearotron start` now check a store they adopt for this straight away.
