---
"clearotron-driver": patch
---

Before you upgrade: a new operator key must now name the tools it may use, for example `--verbs start_run,stop_run`. Keys already issued keep working.

For operators: a revoked key stops working even where no revocation list was set up, because every connector now reads the install's own list.

Fixed: over the network, an operator key can no longer start a what-if that its assistant is not shown.

Fixed: the portal refuses a change sent from another website, or from another app on the same computer, including a sign-in.
