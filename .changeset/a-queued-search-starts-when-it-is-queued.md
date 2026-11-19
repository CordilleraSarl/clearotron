---
"clearotron-driver": patch
---

Fixed: A search ordered while the worker is idle now starts within a few seconds. It used to wait for the worker's next check, up to 90 seconds later, wherever the worker is started by `clearotron start` rather than by systemd, which includes every Mac.
