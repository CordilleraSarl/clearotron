---
"clearotron-driver": patch
---

Fixed: A key pasted at a yes-or-no question in setup is never shown on screen. Where the question leads to a key, a token or a credential, setup takes what was pasted as the answer. It does not ask for it again.

While setup waits for a yes or no, it shows only what you type toward one. Anything else stays off the screen, so a pasted key never reaches the terminal's history.

Fixed: The up-arrow at a later question in setup no longer brings back a key, a token or a password typed earlier. Setup keeps no history of its answers.
