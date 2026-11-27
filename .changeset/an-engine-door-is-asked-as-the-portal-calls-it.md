---
"clearotron-driver": patch
---

Fixed: When the engine door's address carries a user and password, `clearotron doctor` and the portal's start-up check now ask the door the way the portal calls it, without them. Such a door no longer reads as one that does not answer while the portal reaches it.
