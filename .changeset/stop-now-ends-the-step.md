---
"clearotron-driver": patch
---

Fixed: "Stop now" ends the step in flight and anything that step started, and says the step has ended only once it has.

If the step cannot be ended, the card says so and the run stops at its next step instead.
