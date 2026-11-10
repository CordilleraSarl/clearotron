---
"clearotron-driver": patch
---

Fixed: A Knockout search that fails on a missing credential or a configuration fault now ends at once, with the notice a clearance sends for the same cause. It used to wait for an automatic retry that could not succeed.
