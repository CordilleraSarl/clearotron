# prelim-driver

## 0.1.9

### Patch Changes

- 9a1a968: Fixed: Asking a delivered report a what-if now returns a memo — the request used to be accepted and then dropped before anything ran.
- 9a1a968: For operators: A run stopped by a provider's usage cap now says so and how long it waited, instead of reporting the provider as overloaded.
- 9a1a968: Fixed: A clearance no longer stops because its placement section was worded differently. The section is accepted on what it contains.

## 0.1.8

### Patch Changes

- 04b6113: For operators: A new version now reaches npm within about a minute of its release being merged, instead of waiting for the next unrelated change.

## 0.1.7

### Patch Changes

- 0f1ad4e: Fixed: A search skipped as a duplicate now says which earlier one it matched and when, so it cannot be mistaken for a submission that vanished. It also says how to force a genuine re-run.
- 0f1ad4e: For operators: Installing a server now fills in the address list the engine door needs, from the port it binds and your public hostname. It was the one such setting left to type by hand.
- 0f1ad4e: For operators: A server install now starts before a search register is chosen. The portal and doors come up, and each search is refused when ordered, naming the setting to fill in.
- 0f1ad4e: Fixed: The connect steps on a delivered report now match what Claude actually asks for, and are dated with when we last checked them. The old steps waited for a sign-in that never came.
- 0f1ad4e: Fixed: The setup wizard explains its engine check in one plain line. It also says what a wrong register key costs you when setup cannot test it.

## 0.1.6

### Patch Changes

- 3e15f83: For operators: A node_modules borrowed from another checkout makes npm compare the wrong tree. Six licence checks then fail as if the code were at fault. The refusal now names that cause, points at the symlink and the tree it came from, and says which command fixes it. It also stops printing thousands of rows that scrolled the explanation off the screen. A genuine licence problem is unaffected and still fails with its own message.
- 3e15f83: For operators: The deploy health check now reads whether this box drains continuously or on a timer, and says which posture it read. On a timer-driven box, no drainer between ticks was reported as a fault. It is the normal resting state there, and the check no longer calls it a failure. Where a worker holds the queue open, an absent drainer is still the outage it always was. A posture the check could not read is still a failure, never a pass.

## 0.1.5

### Patch Changes

- c6e183d: For operators: A background install that stops because engine settings are missing now names the files to put them in. It used to point only at the setup wizard, which will not run outside a terminal. So a scripted or hosted install was being sent somewhere it could not go. The missing report-pool setting is the same.
- c6e183d: For operators: When systemd refuses to start one of the installed services, the background install now says what systemd said. It names which service refused and which ones are already up. It also says that re-running finishes the job. It used to end in a raw crash dump.
- c6e183d: For operators: An install step that refuses no longer claims it wrote new keys first, so a failed run cannot look like a partly finished one.
- c6e183d: For operators: A server install now refuses before installing services that cannot run, naming each missing setting and the file to put it in.
- c6e183d: For operators: When a port is already in use, the message now names the configuration file it actually reads, so the setting goes where it works.
- c6e183d: For operators: Connecting now says when it would point your deployment at a different copy of the software, and refuses when the running services disagree.
- c6e183d: Fixed: The demo's help now lists every example clearance it ships and says which one runs by default, so none stay hidden.
- c6e183d: For operators: Changing the client connection port and re-running the install step now updates the addresses it accepts, so the service no longer refuses its own.
- c6e183d: For operators: A warning about the ops access key now prints a command that preserves the holder and permissions it already had, instead of widening them.

## 0.1.4

### Patch Changes

- 7f37550: Fixed: A server install now generates the portal secret it needs, so the portal starts instead of exiting at boot.
- 6595180: Fixed: A report now says a case-law source could not be confirmed, rather than saying this installation does not have it.
- 6595180: For operators: The live-surface check no longer calls a healthy installation broken over a service file the product never shipped.
- 7f37550: Fixed: An address only this machine can reach is no longer described as reachable from the internet. A key that could not be written down now names the missing setting.
- 19a1869: For operators: the configuration page now shows this deployment's live settings, and says if the last run used different ones.
- 7f37550: Fixed: Connecting an assistant no longer reports the connector as closed when it cannot reach the session bus. It also no longer stops on a signing secret the installation already holds.
- 6595180: Fixed: Connecting an assistant now says what went wrong when it stops part-way, and what it had already changed.
- 6595180: Fixed: Checking a settings file now reports on the file you named, not the one this machine happens to use.
- 13858ed: Fixed: Installing Clearotron from npm works again — recent releases failed before any files were written, so nothing could be installed or run.
- 5828fc1: For operators: the shipped multi-country demo is now the same run family as the other three, not an older capture from a different customer.
- 6595180: For operators: The end-to-end harness now recognises the worker draining queues here, instead of offering to start a second one.
- 7f37550: New: The install guide names both provider settings an assistant's sign-in depends on. `clearotron doctor --probe-connector` asks your address whether each assistant maker can sign in.
- 7f37550: New: The portal now checks at start-up whether the engine it submits to will accept it, and says so in its log. Changing the engine's sign-in used to break Start silently.
- 7f37550: Fixed: Reinstalling the services no longer overrides the port and address you set for the assistant connector. The connector's unit reads them from your settings file like every other service.

## 0.1.3

### Patch Changes

- 345aba8: For operators: The engine's HTTP client moves to its current major version, which needs Node 22.19 or newer. Installs on an older Node 22 must upgrade Node first.

## 0.1.2

### Patch Changes

- 2fd8b10: Fixed: A clearance no longer fails part-way because a section heading was worded differently. The report is accepted on what it contains.
- c5df5c7: Fixed: A zone with too many results to work through is now recorded, not left blank where it could read as searched and clean.
- 2fd8b10: Fixed: A clearance stopped by a provider's usage limit now waits for that limit to reset, instead of giving up and reporting a failed run.
- 2fd8b10: Fixed: A what-if about a finished report is answered under the same risk framework as the original run, or declines rather than switching.
- 2f7afd2: New: A finished report can now be asked what changes under a stated assumption, answered by a short memo over the evidence already gathered. Nothing is searched again and the report is not altered.
- 2fd8b10: Fixed: Reports can no longer say a territory was searched when it was not. The wording is corrected before the report reaches the client.

## 0.1.1

### Patch Changes

- 69b52a4: Fixed: The instructions for running from a clone no longer show a short command form that only a global install provides.
- 6d05f62: Fixed: A case-law sign-in that is present but no longer usable is now reported as such, instead of being counted as ready.
- 6d05f62: Fixed: The package now includes its third-party licence notices, and they list every package it bundles.
- 6d05f62: Fixed: The connection steps shown for Cowork and Perplexity now match what those apps actually ask for.
- 6d05f62: Fixed: The demo's port setting now moves every connection it opens, so a demo cannot take the ports of an installation running beside it.
- 6d05f62: Fixed: Stopping the demo now closes every connection it opened, instead of leaving some listening.
- 6d05f62: Fixed: Installing Clearotron no longer downloads an AI vendor toolkit that the product never uses.
- f7c1570: New: Releases are now signed. Each npm package carries a record of the exact source and build it came from, so an install can be verified against this repository.
- f7c1570: Fixed: Removing the demo is one folder again: nothing it writes lands outside the folder it names, and running it leaves the installed files untouched.
- 6d05f62: Fixed: Settings renamed in an earlier release are now reported at start-up and by `clearotron doctor`, so an upgrade cannot quietly ignore them.
- f7c1570: Fixed: Settings now live in `~/.config/clearotron/` and survive an upgrade — before, upgrading a global install threw them away, credentials included, while reporting success.
- 6d05f62: For operators: Updating an installation built from source now rebuilds the web interface, so it no longer serves the previous one after an update.
- 6d05f62: For operators: Stopping a backgrounded command now stops everything it started, instead of leaving the engine, client and portal connections listening.
- f7c1570: Fixed: The demo now offers only the two example accounts it ships with; three names that were only test material are gone.
- f7c1570: For operators: Server installs no longer stop accepting new clearances after 30 days. The internal key renews itself on every start, and `clearotron doctor` warns a week before it would lapse.

## 0.1.1-beta.1

### Patch Changes

- 6d05f62: A case-law sign-in that is present but no longer usable is now reported as such, instead of being counted as ready.
- 6d05f62: The third-party licence notices now list every package the product bundles.
- 6d05f62: The connection steps shown for Cowork and Perplexity now match what those apps actually ask for.
- 6d05f62: The demo's port setting now moves every connection it opens, so a demo cannot take the ports of an installation running beside it.
- 6d05f62: Stopping the demo now closes every connection it opened, instead of leaving some listening.
- 6d05f62: Installing Clearotron no longer downloads an AI vendor toolkit that the product never uses.
- 6d05f62: Settings renamed in an earlier release are now reported at start-up and by `clearotron doctor`, so an upgrade cannot quietly ignore them.
- 6d05f62: Updating an installation built from source now rebuilds the web interface, so it no longer serves the previous one after an update.
- 6d05f62: Stopping a backgrounded command now stops everything it started, instead of leaving the engine, client and portal connections listening.

## 0.1.1-beta.0

### Patch Changes

- f7c1570: Every release now carries a signed record of the commit and the build that produced it, so you can check that what you installed is what this repository holds.
- f7c1570: Removing the demo is one directory again: nothing it writes lands outside the folder it names, and running it no longer edits your copy of the repository.
- f7c1570: Your settings now live at `~/.config/clearotron/.env`, where an upgrade cannot delete them. An install set up before this keeps working and tells you once where to move the file. Before, upgrading a global install threw the settings away — credentials included — and every command still reported success.
- f7c1570: The demo offers the two example accounts it ships with. Three company names that were only ever test material are gone from the package.
- f7c1570: `clearotron doctor` now says how long the portal key has left and refuses when it has lapsed or is close to it. Before, a server stopped being able to start searches thirty days after setup, and reported it as a fault in the search engine.
