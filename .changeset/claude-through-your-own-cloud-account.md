---
"clearotron-driver": patch
---

New: Pay for Claude through your own Google Cloud, Microsoft Azure or Amazon Bedrock account with `CLEAROTRON_AI_BILLING=cloud`. Tested on Microsoft Azure; Google Cloud and Amazon Bedrock use the Claude program's own settings. Each run records which cloud account paid for it. A billing setting Clearotron does not recognise now stops the run before it starts, instead of billing your subscription. So does `subscription` or `api-key` while a cloud's own switch, such as `CLAUDE_CODE_USE_FOUNDRY`, is on, because Claude would bill that cloud. Setup now asks how Claude is paid for, and for a cloud account asks which cloud and checks it with one turn. `clearotron doctor` names the cloud account it charges.
