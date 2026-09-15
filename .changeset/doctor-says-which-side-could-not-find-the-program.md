---
"clearotron-driver": patch
---

Fixed: When the background services could not find the reasoning program at their last start, `clearotron doctor` says to restart them, or to let setup install the program where they look. It used to tell you to install the CLI where the service could see it.
