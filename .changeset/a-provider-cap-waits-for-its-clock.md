---
"clearotron": patch
---

Wait for a provider cap to reset instead of dying against it

When a provider capped the account, the run kept probing on a ladder that topped out at
an hour and then gave up, reporting exhausted retries — when the truth was that the
account was blocked until a known time. Runs now wait for the reset time the provider
states, and where none is stated they back off over about eleven hours instead of three.
A temporary block stops being reported as a terminal failure.
