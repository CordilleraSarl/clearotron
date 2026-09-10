---
"clearotron-driver": minor
---

For operators: Who may sign in is now decided by each person's own entry in the guest list, and nothing else. On a local installation, the next `clearotron start` gives whoever signs in access to everything if the guest list has no `people` section.

- For operators: Any other installation with people on it needs one edit to its guest list (`CLEAROTRON_ACCESS_FILE`) before upgrading.
- For operators: Anyone admitted because of their email domain needs an entry under a new `people` section: `"everything": true`, `"run": true`, `"manage": true`.
- For operators: Each person who starts clearances needs `"run": true`, and each person who adds people or companies needs `"manage": true`. A person with no entry can see what their access covers, and start nothing.
- For operators: An organisation whose `accounts` is `"*"` needs the list of companies it holds instead. Until then the portal refuses to start, and names the entry. A company may be listed under one organisation only.
- For operators: `PORTAL_STAFF_DOMAINS` is ignored from this version on, and the portal says so at startup.
- For operators: After upgrading, sign in to check, and run `clearotron connect` again for each person whose assistant uses a key.
