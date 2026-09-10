---
"clearotron-driver": patch
---

Fixed: `clearotron demo` no longer reads the settings of a real install on the same computer. Before, it showed that install's companies instead of its own and put its four example reports into that install's archive. A company created in the demo would have been saved into that install's customer list, and an assistant connected to the demo could be offered that install's saved searches. The demo now keeps all of this in its own folder.

Fixed: The demo's company switcher lists the demo company and Generic. A company you create in the demo belongs to the demo's own organisation.

Fixed: If no organisation is set up yet, New company now says so and names the command that sets one up.

For operators: On a local install, setup no longer asks for a sign-in address. It uses your computer account's name at `localhost` and shows it once in the summary. An address already in your settings file is kept.
