---
"clearotron-driver": patch
---

Fixed: A search on a short or common word could return so many unrelated marks that one query filled most of the results. Any single query now contributes at most a fixed number of records, and anything beyond that is reported as a crowd with its full count rather than silently left out — so a broad search says plainly that the ground was too wide to list, instead of burying the relevant marks.
