---
"clearotron-driver": patch
---

Fixed: When setup's test turn finds the program signed out, the sign-in command it gives names the copy setup installed. It used to name a `claude` or `codex` command the shell does not have.

Fixed: A signed-out Codex CLI that setup installed is told to sign in with that copy, by `clearotron doctor` and when a search starts.

Fixed: Setup's engine question says a program can be paid for by a subscription, an API key or, for Claude, a cloud account.

Fixed: Setup's engine question waits at most two seconds for each program's version, and shows a version only when the program gives one.
