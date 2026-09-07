---
"prelim-driver": patch
---

New: One engine process can now serve both people arriving through a tunnel and programs on the same machine holding an access key. It listens for the key on a local socket, which no tunnel can forward to, and the network door never accepts a key at all. Deployments that needed both used to run the process twice, on two ports, with two units to keep in step.

Fixed: The startup lines now say whether a local key path exists, and what its permissions are. An operator can see it without opening a unit file. A deployment with no key path is told that too, rather than left to infer it from silence.

For operators: set TRADEMARK_MCP_KEY_SOCKET to the socket path the local key door should listen on. It is created with owner and group access only. Leaving it unset changes nothing about an existing deployment. The door refuses to open without a grants file, or alongside the authentication bypass.
