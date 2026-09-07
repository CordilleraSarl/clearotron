---
"prelim-driver": patch
---

Fixed: The delivery record now states plainly when a report's write-up length and ranking rules could not be checked against the delivered text. It says the rules were applied to nothing on that run. Before, this was recorded as an unlabelled failed check. It looked like any other, so a run could deliver with those rules unverified and nobody would see it.
