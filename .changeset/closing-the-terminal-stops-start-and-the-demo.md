---
"clearotron-driver": patch
---

Fixed: Closing the terminal window that runs `clearotron start` or `clearotron demo` now stops it completely, as its banner says. It used to keep running at full processor use and leave the demo's folder behind.
