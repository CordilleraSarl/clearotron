---
"clearotron-driver": patch
---

For operators: `clearotron update` now waits while a search is parked, as it already waited for one that is running. A search started before an update is no longer resumed after it: it ends with the usual failure notice, and nothing is asked of the register again.
