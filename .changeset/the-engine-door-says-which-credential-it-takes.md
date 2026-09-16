---
"trademark-artifacts-mcp": patch
---

Fixed: Sending an access key to the engine's network address now gets a refusal that says so. It reports that the address takes an identity from the sign-in proxy and never a key.

Fixed: That refusal also names the local door where a key is accepted. Before, it reported only a missing sign-in assertion, which sent operators to the wrong configuration.

For operators: A program on the same machine can now reach the engine's local key door without setting a host name for it. The local door no longer applies a browser protection that only a network address needs.
