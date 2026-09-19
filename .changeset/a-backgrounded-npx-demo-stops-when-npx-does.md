---
"clearotron-driver": patch
---

Fixed: A demo started in the background with `npx` now stops completely when that `npx` is stopped, freeing its three ports and removing its folder.
