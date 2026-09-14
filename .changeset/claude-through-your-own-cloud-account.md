---
"clearotron-driver": patch
---

New: Pay for Claude through your own Google Cloud, Microsoft Azure or Amazon Bedrock account with `CLEAROTRON_AI_BILLING=cloud`. Each run records which cloud account paid for it. A billing setting Clearotron does not recognise now stops the run before it starts, instead of billing your subscription.
