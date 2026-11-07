---
"clearotron-driver": patch
---

Fixed: Setup and `doctor` no longer tell you to set a register on the Installation settings page, which shows each setting but cannot change one. They tell you to re-run setup.

Fixed: Setup's opening now says that a paid register key is written on your word, because checking it would cost you. It also says that your organisation's name is the one answer you cannot skip. With no register chosen, setup's closing lines no longer suggest a first real clearance that would be refused.

Fixed: After `doctor --probe-engine` runs a test turn, its last line no longer says that nothing was written: the AI program keeps its own files from that turn.
