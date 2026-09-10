---
"clearotron-driver": patch
---

Fixed: `clearotron doctor`'s register check now tests the register your install is set up for. A register or key kept only in your install's settings file came back as not set, though doctor had just listed it. The check now reads that file too, and a value set in your shell still wins.
