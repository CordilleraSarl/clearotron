---
"clearotron-driver": minor
---

Fixed: A Knockout resumed after a failed attempt now carries on from the step that failed. It used to run every step again from the reading of the order, which could frame the order differently the second time.
