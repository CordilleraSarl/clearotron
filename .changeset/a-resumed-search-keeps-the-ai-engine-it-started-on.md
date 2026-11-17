---
"clearotron-driver": patch
---

Fixed: A search that stops and resumes now finishes on the AI engine it started on, even if the engine setting changed in between. Before, a resumed search switched to whichever engine was set at the time, and its record did not say so.
