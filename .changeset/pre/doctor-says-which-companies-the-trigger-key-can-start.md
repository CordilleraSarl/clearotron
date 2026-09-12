---
"clearotron-driver": patch
---

Fixed: `clearotron doctor` now lists the companies your portal's key may start runs for.

The key carries a list of the companies it may start runs for. A company added after the key was minted is outside it. Doctor reported the key's expiry and never its coverage. So the one command whose job is to tell you what a machine is configured for said nothing about it.

Doctor reads the company list the background services read, not the one a command run in a terminal would find, and it says which. The two can differ, and when they do, that difference is the answer.

Doctor's coverage line is a note, not a failure. Your portal takes a fresh credential at the start of every call, so a company outside the key is not normally refused. It is refused when the portal cannot take a fresh one, and the line says so and gives you the command to widen the key.
