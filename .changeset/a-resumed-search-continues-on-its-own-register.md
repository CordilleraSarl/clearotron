---
"clearotron-driver": patch
---

Fixed: A search that stops and resumes now continues on the register it started on, even if the register setting changed in between. If this server cannot use that register or AI engine, the search waits and resumes by itself on one that can.
