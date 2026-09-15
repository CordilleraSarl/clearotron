---
"clearotron-driver": patch
---

New: Pay for Claude through your own Google Cloud, Microsoft Azure or Amazon Bedrock account with `CLEAROTRON_AI_BILLING=cloud`. Tested on Microsoft Azure; Google Cloud and Amazon Bedrock use the Claude program's own settings.

New: Each run records which cloud account paid for it, and `clearotron doctor` names the cloud account it charges.

New: Setup asks how Claude is paid for, and for a cloud account asks which cloud and checks it with one turn.

New: `clearotron start`, when no billing is set, names a cloud account for Claude beside a subscription and an API key.

New: `clearotron start --background` carries the cloud account's settings to the background services.

New: `clearotron doctor` says how the background services pay, and warns when your own configuration sets a different way of paying.

Fixed: An install that pays with an API key and runs as background services now hands the services its key. Before, every search stopped after it was ordered.

Fixed: A subscription install signed in with a long-lived token from `claude setup-token` now hands that token to its background services.

Fixed: `clearotron doctor` and `clearotron start` now report a billing setting that would stop every search, such as an API key that is not set.

For operators: `clearotron start --background` names each setting on which `~/.env` and Clearotron's settings disagree, such as a rotated key, without printing values. It adds only settings `~/.env` lacks and never replaces one, so change a setting in both files.

Before you upgrade: A billing setting Clearotron does not recognise now stops a search before it starts, where it used to bill the subscription. Run `clearotron doctor` after upgrading.

Before you upgrade: On a Claude install, a cloud's own switch left on, such as `CLAUDE_CODE_USE_FOUNDRY`, now stops a search unless `CLEAROTRON_AI_BILLING=cloud`.
