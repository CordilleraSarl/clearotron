---
"clearotron-driver": patch
---

Fixed: A search step that streams at a crawl is now stopped early and retried, instead of running to its time limit and losing the work.
