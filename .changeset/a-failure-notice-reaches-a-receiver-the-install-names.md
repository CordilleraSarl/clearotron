---
"clearotron-driver": minor
---

For operators: An install with no courier can now name a receiver on the same machine for failure notices. The worker sends it each order refused before it ran, each run that stopped and each failed engine check, addressed to the person who placed the order or to the operator. Each notice is kept on record until the receiver confirms it, and a receiver that cannot be reached is tried again after a wait, with only the notice sent again, never the search. Nothing changes until a receiver is named. The delivery guide describes the settings and what the receiver is sent.
