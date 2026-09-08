---
"clearotron-driver": patch
---

Fixed: The lines a client reads first are now checked for the profession's vocabulary and for sentences carrying more than one idea. The reviewing pass rewrites them before delivery. Nothing about the check is shown to the client, and no run fails over it. A report clearing a name like PREVAIL is unaffected, because the mark being cleared is never read as a legal term.
