---
"clearotron-driver": patch
---

Fixed: A large search no longer slows down each time a step looks up a register record the search has already fetched. On the largest searches these lookups could add several minutes, and a search that had fetched a very large number of records could fail to find them at all.
