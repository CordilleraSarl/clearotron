---
"clearotron-driver": patch
---

Fixed: A search step that runs again, after a retry or a resume, no longer sends a web research question it already has the answer to. Before, every rerun paid for those questions again.
