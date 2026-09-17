---
"clearotron-driver": patch
---

Fixed: A search covering a very large number of register records could finish with no findings document at all. Those records are now accounted for in fixed batches instead of all at once. An interrupted attempt resumes from the records still outstanding, rather than starting again.
