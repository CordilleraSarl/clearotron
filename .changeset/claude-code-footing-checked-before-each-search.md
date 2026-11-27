---
"clearotron-driver": minor
---

For operators: Before each search, and in `clearotron doctor`, Clearotron now checks that Claude Code still stops a search from writing over its own instructions, offers every tool a search uses, and pays with the account the install is set to pay with. If a Claude Code update changes how it starts, the search is refused before anything is spent, and the message names the cause and what to do.
