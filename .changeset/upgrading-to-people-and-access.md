---
"clearotron-driver": minor
---

Upgrading: who may sign in is now decided by each person's own entry in the guest list, and by nothing else.

Before you upgrade an installation that already has people on it, edit its guest list (`CLEAROTRON_ACCESS_FILE`) once:

- Give each person who should see everything an entry under a new `people` section with `"everything": true`, `"run": true` and `"manage": true`. Anyone who was admitted as staff because of their email domain needs one.
- Give each person who starts clearances `"run": true`, and each person who adds people or companies `"manage": true`. A person with no entry still sees what their access covers, and can start nothing.
- If an organisation's `accounts` is `"*"`, replace it with the list of the companies it holds. A company may be listed under one organisation only.

`PORTAL_STAFF_DOMAINS` is ignored from this version on.

After upgrading, sign in to check, and run `clearotron connect` again for each person whose assistant uses a key.
