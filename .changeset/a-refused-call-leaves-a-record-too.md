---
"clearotron-driver": patch
---

For operators: The connector access log now records calls that were refused, not only calls that succeeded. A line also names which door took the call, so a client key and a staff session can be told apart. Before, a refused call left no line at all, and an absent record could not be told from a call that was never made.
