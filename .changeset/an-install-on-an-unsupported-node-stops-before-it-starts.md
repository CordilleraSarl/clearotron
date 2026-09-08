---
"clearotron-driver": patch
---

Fixed: Installing on a Node version the engine cannot run on now stops at once. It names the version you have, the version needed, and the command that fixes it. Before, the install finished and the first US register search failed with an error that never mentioned Node. The supported floor is Node 22.13 or newer. Lowering it moves the engine's HTTP client back from version 8 to the maintained 7 line, which was the only thing in the tree requiring Node 22.19; the thirty-minute header timeout it exists for is unchanged. Operators who upgraded Node on the previous release's advice do not need to downgrade.
