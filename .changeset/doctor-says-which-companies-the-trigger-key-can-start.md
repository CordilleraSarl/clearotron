---
"clearotron-driver": patch
---

Fixed: `clearotron doctor` now says which companies your portal's trigger key can start.

The key carries a list of the companies it may start runs for. A company added after the key was minted is outside it. Doctor reported the key's expiry and never its coverage. So the one command whose job is to tell you what a machine is configured for said nothing about it.

It reads the roster the services read, not the one a command-line process resolves, and it says which. Those two can disagree, and when they do the difference is the whole answer.

The line is a note, not a failure. Your portal takes a fresh credential at the start of every call, so a company outside the key is not normally refused. It is refused when the portal cannot take a fresh one, and the line says so and gives you the command to widen the key.
