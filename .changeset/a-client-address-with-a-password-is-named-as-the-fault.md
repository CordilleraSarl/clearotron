---
"clearotron-driver": patch
---

Fixed: When the client connector address carries a username or a password, `clearotron doctor` names the address as the failed check and does not try it, instead of reporting a door that does not answer. An assistant's client refuses such an address before it connects, so setup now refuses it too.

For operators: When `clearotron doctor` cannot determine how the engine is paid for, it says so and points to `clearotron install`, instead of printing the error it met.
