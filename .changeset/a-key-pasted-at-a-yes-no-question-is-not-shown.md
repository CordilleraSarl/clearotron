---
"clearotron-driver": patch
---

Fixed: A key pasted at a yes/no question in setup is never shown on screen. Setup takes it as the key and does not ask for it again.

While setup waits for a yes or no, it shows only what you type toward one. Anything else stays off the screen, so a pasted key never reaches the terminal's history.
