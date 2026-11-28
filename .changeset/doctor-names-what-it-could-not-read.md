---
"clearotron-driver": minor
---

For operators: `clearotron doctor` reports a settings file it cannot read as a failed check. It names the file, says how to fix it, and no longer reports the settings in that file as unset; a setting the environment carries is still read. A custom-instructions folder it cannot read is a failed check that names `CLEAROTRON_INSTRUCTIONS_DIR`, including when only the settings file names the folder.

For operators: A failed check in `clearotron doctor` names what failed and what to do next, without the machine's own error text. A configured address that carries a user, a password or a query is shown without them, and the line that named the checkout `clearotron doctor` runs from is gone.
