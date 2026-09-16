---
"clearotron-driver": patch
---

Fixed: A search on a short or common word could return so many unrelated marks that one query filled most of the results. Any single query now contributes at most a fixed number of records. Anything beyond that is reported as a crowd, with its full count, rather than left out silently.
