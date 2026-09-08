---
"clearotron-driver": patch
---

Fixed: The screen that will not start a search now gives advice that fits your machine.

An install with the engine program present, but invisible to the engine service, was told to install a program it already had. That advice cannot work. Following it changes nothing, because the engine reads its PATH when it starts. Until it is restarted, every screen reports what it saw at startup. Nothing said so.

The New clearance notice now tells those two states apart. Where the program is absent it gives the install advice as before. It adds that the service has to be restarted afterwards before it will notice. Where the program is present and the engine cannot see it, the notice says that instead, and names the restart as the remedy. Staff also get a link from that notice to the configuration page.

The configuration page's engine row now names the program it could not find. It names the command that installs it too, and `clearotron doctor` says the same, in the same words.
