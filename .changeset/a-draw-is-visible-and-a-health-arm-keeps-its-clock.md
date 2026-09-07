---
"prelim-driver": patch
---

Fixed: An hourly deploy no longer fast-forwards the checkout while an experiment draw is running. A draw now holds a lock the deploy guard reads.
