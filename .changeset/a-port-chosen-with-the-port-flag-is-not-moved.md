---
"clearotron-driver": patch
---

Fixed: A port chosen with `clearotron start --port` is now refused when it is busy, as a port set by its variable is, instead of being moved.
