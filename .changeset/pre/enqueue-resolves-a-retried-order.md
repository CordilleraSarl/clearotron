---
"clearotron-driver": minor
---

For operators: an order retried with the id of one that was already refused, parked or finished is no longer queued a second time. `enqueue` exits 3, as it already did for an order still waiting, and prints what became of the first order: its state, the reason it was refused, and its run id.
