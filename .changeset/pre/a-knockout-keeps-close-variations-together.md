---
"clearotron-driver": patch
---

Fixed: A Knockout of close variations no longer risks rating each name alone. The intake must now say which names belong together, listing unrelated names on their own, before its plan is saved. Before, a plan that left the groups out was accepted, and every name was then rated in isolation. Once a plan is saved, a correction to one of its fields or one of its names is now accepted on its own, where before it was refused.
