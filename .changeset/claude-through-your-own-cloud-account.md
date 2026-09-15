---
"clearotron-driver": patch
---

New: Pay for Claude through your own Google Cloud, Microsoft Azure or Amazon Bedrock account with `CLEAROTRON_AI_BILLING=cloud`. Tested on Microsoft Azure; Google Cloud and Amazon Bedrock use the Claude program's own settings.

New: Each run records which cloud account paid for it, and `clearotron doctor` names the cloud account it charges.

New: Setup asks how Claude is paid for, and for a cloud account asks which cloud and checks it with one turn.

New: `clearotron start`, when no billing is set, names a cloud account for Claude beside a subscription and an API key.

Before you upgrade: A billing setting Clearotron does not recognise now stops a search before it starts, where it used to bill the subscription. Run `clearotron doctor` after upgrading.

Before you upgrade: On a Claude install, a cloud's own switch left on, such as `CLAUDE_CODE_USE_FOUNDRY`, now stops a search unless `CLEAROTRON_AI_BILLING=cloud`.
