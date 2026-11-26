---
"clearotron-driver": minor
---

Fixed: On Claude, a step stopped at its time limit while still working now resumes where it was. Before, Claude refused to resume it, and the step's retry was used up on that refusal.
