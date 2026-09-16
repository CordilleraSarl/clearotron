---
"clearotron-driver": patch
---

Fixed: A clearance over a very large number of register records could end with no findings document at all. The records are now accounted for in fixed batches rather than all at once, so a dense matter completes instead of running out of room part-way through, and an attempt that is interrupted resumes from the records still outstanding instead of starting again from the beginning.
