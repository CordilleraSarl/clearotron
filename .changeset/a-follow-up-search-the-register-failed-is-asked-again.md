---
"clearotron-driver": patch
---

Fixed: A clearance whose follow-up register search failed with a temporary register error now asks that search again in the same pass. If the register still fails, the report states the search as not searched, with the register's error, and the clearance is delivered without stopping to resume.
