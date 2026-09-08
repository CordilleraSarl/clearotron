---
"clearotron-driver": patch
---

Fixed: The settings page no longer shows the engine as healthy when the engine program cannot be found.

That page reports which engine is configured. The New clearance screen reports whether a search can start right now. When those two readings disagreed, neither screen said so.

An install could therefore show a green engine while no search would start, and nothing explained the gap. The settings page now names the disagreement and says what to do about it. Running `clearotron doctor` reports the same thing in the same words.
