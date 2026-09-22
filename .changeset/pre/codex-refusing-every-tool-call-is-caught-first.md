---
"clearotron-driver": patch
---

Fixed: on the OpenAI engine, setup and `doctor --probe-engine` now catch a machine where codex refuses every tool call, before any search is paid for.

A search that meets it stops after one attempt and names the setting that fixes it.
