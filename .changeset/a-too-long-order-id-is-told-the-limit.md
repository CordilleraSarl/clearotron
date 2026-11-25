---
"clearotron-driver": patch
---

Fixed: When an order's id is too long, the refusal now states the 128-character limit and the id's own length. Before, it named only the allowed characters, so a caller could not tell what to fix.
