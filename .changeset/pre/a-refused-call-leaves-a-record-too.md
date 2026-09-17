---
"clearotron-driver": patch
---

For operators: The connector access log now records what happened to each call, and records calls that were refused as well as calls that got through. A line also names which door took the call, so a client key and a staff session can be told apart. Before, a call was recorded only as having been made, and a refused one left no line at all. `doctor` now names where that log is being written. It reads that from the service's own settings, not from the shell you are typing in.
