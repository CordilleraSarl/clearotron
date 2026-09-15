---
"clearotron-driver": patch
---

New: Setup offers to install the reasoning program your engine uses. Before it asks, it says how much space the program takes and how to remove it.

New: Setup asks which program does the reasoning, and shows the version it found on this machine or says setup can install it.

New: Claude Code or the Codex CLI already on the machine is still used first. `clearotron update` keeps the installed one current, and `clearotron doctor` says which copy runs and its version.

New: Outside Windows, in demo mode, `clearotron doctor` points to setup to install the reasoning program.
