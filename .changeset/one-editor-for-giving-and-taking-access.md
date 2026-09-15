---
"clearotron-driver": patch
---

Fixed: `clearotron grant remove --tenant` now refuses when the person has access to everything on the installation. It used to remove the organisation and then warn that nothing they could see had changed.

Fixed: Removing somebody whose address is spelled with different capitalisation in different parts of the access file now removes all of them. Half of the entry used to survive, and the command reported success.
