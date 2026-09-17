---
"clearotron-driver": patch
---

Fixed: `clearotron doctor` and `clearotron start --background` look for Claude Code or the Codex CLI on the PATH the background services use. They used to say every search would be refused on a machine whose searches found the program and ran.
