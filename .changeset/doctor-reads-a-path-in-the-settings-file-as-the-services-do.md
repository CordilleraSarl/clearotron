---
"clearotron-driver": patch
---

Fixed: `clearotron doctor` and `clearotron start --background` look for Claude Code or the Codex CLI on the PATH the background services get. When the services' settings file sets its own PATH, that PATH is the one they get. Before, the two commands could report a machine as ready whose searches could not find the program.

Fixed: A doubled percent sign (`%%`) in a background service's settings is read as one percent sign, as the services read it.
