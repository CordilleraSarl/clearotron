---
"clearotron-driver": patch
---

Fixed: A supplementary memo now succeeds on its first attempt instead of failing and retrying, so it costs one turn rather than two and no longer leaves a retried-stage mark against a report that was delivered cleanly.

Fixed: A supplementary memo states the rating framework it was reasoned under, on the memo itself. A report assessed under a customer's own framework said so; a memo written from it did not, and a reader could not tell which had been applied.
