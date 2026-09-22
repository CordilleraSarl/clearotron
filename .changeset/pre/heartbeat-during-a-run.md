---
"clearotron-driver": patch
---

Fixed: the worker now reports itself alive throughout a search, not only between searches. Its liveness file went stale for the whole of a long search. A check reading it would call a healthy search dead, and might stop it.
