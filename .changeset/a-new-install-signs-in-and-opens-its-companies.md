---
"clearotron-driver": patch
---

Fixed: A new install signs in with a passphrase of its own, and its first start prints it. This holds even on a machine where an earlier install left a sign-in behind.

Each new install keeps its sign-in inside its own directory, `~/trademark/` by default. An install that already signs in with the shared one under `~/.cordillera/` keeps using it, so no passphrase stops working when you upgrade.

Fixed: When a start does not print the passphrase, its first line now says how to get a new one: `clearotron passphrase --reset`. It also says which sign-in file it is using, when that file was created, and for which address.

Fixed: The demo always gives you a passphrase that works. Each demo start makes a new one and prints it, instead of reusing one an earlier demo left behind.

Fixed: A new install can open its companies' profiles. If its configuration folder overrides no instruction files, the portal no longer answers with an error. Nor does it warn that risk frameworks might be synthetic. Setup also creates the `skills` folder its closing screen tells you to use.

Fixed: A search refused because the install is not fully configured now names the settings file `clearotron start` read. It no longer names a file that does not exist on that machine.
