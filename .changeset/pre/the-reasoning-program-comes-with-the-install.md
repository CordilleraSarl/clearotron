---
"clearotron-driver": patch
---

New: Setup offers to install the reasoning program your engine uses. Before it asks, it says how much space the program takes and how to remove it.

New: Setup asks which AI should run your searches, Claude or Codex, and says what it found on this computer.

New: Claude Code or the Codex CLI already on the machine is still used first. `clearotron update` keeps the installed one current, and `clearotron doctor` says which copy runs, and its version when the program reports one.

New: Outside Windows, in demo mode, `clearotron doctor` points to setup to install the reasoning program.

New: When the reasoning program cannot be found, Global config's Engine row and the search screen name the setup command that installs it.
