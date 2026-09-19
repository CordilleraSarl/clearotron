---
"clearotron-driver": patch
---

Fixed: A knockout's per-name read no longer carries a next-step section the model wrote. It is removed before delivery instead of the batch being sent back to rewrite it, so knockouts finish sooner.
