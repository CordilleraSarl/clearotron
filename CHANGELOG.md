# Changelog

What changed in each release of Clearotron, in plain English.

Install or upgrade with `npm install -g clearotron`.

## 0.1.9

### Fixed

- Asking a delivered report a what-if now returns a memo — the request used to be accepted and then dropped before anything ran.
- A clearance no longer stops because its placement section was worded differently. The section is accepted on what it contains.

### For operators

- A run stopped by a provider's usage cap now says so and how long it waited, instead of reporting the provider as overloaded.

## 0.1.8

### For operators

- A new version now reaches npm within about a minute of its release being merged, instead of waiting for the next unrelated change.

## 0.1.7

### Fixed

- A search skipped as a duplicate now says which earlier one it matched and when, so it cannot be mistaken for a submission that vanished. It also says how to force a genuine re-run.
- The connect steps on a delivered report now match what Claude actually asks for, and are dated with when we last checked them. The old steps waited for a sign-in that never came.
- The setup wizard explains its engine check in one plain line. It also says what a wrong register key costs you when setup cannot test it.

### For operators

- Installing a server now fills in the address list the engine door needs, from the port it binds and your public hostname. It was the one such setting left to type by hand.
- A server install now starts before a search register is chosen. The portal and doors come up, and each search is refused when ordered, naming the setting to fill in.

## 0.1.6

### For operators

- A node_modules borrowed from another checkout makes npm compare the wrong tree. Six licence checks then fail as if the code were at fault. The refusal now names that cause, points at the symlink and the tree it came from, and says which command fixes it. It also stops printing thousands of rows that scrolled the explanation off the screen. A genuine licence problem is unaffected and still fails with its own message.
- The deploy health check now reads whether this box drains continuously or on a timer, and says which posture it read. On a timer-driven box, no drainer between ticks was reported as a fault. It is the normal resting state there, and the check no longer calls it a failure. Where a worker holds the queue open, an absent drainer is still the outage it always was. A posture the check could not read is still a failure, never a pass.

## 0.1.5

### Fixed

- The demo's help now lists every example clearance it ships and says which one runs by default, so none stay hidden.

### For operators

- A background install that stops because engine settings are missing now names the files to put them in. It used to point only at the setup wizard, which will not run outside a terminal. So a scripted or hosted install was being sent somewhere it could not go. The missing report-pool setting is the same.
- When systemd refuses to start one of the installed services, the background install now says what systemd said. It names which service refused and which ones are already up. It also says that re-running finishes the job. It used to end in a raw crash dump.
- An install step that refuses no longer claims it wrote new keys first, so a failed run cannot look like a partly finished one.
- A server install now refuses before installing services that cannot run, naming each missing setting and the file to put it in.
- When a port is already in use, the message now names the configuration file it actually reads, so the setting goes where it works.
- Connecting now says when it would point your deployment at a different copy of the software, and refuses when the running services disagree.
- Changing the client connection port and re-running the install step now updates the addresses it accepts, so the service no longer refuses its own.
- A warning about the ops access key now prints a command that preserves the holder and permissions it already had, instead of widening them.

## 0.1.4

### New

- The install guide names both provider settings an assistant's sign-in depends on. `clearotron doctor --probe-connector` asks your address whether each assistant maker can sign in.
- The portal now checks at start-up whether the engine it submits to will accept it, and says so in its log. Changing the engine's sign-in used to break Start silently.
- Ask a what-if about a delivered report and get a supplementary memo over its archived evidence, without touching the report.

### Fixed

- A server install now generates the portal secret it needs, so the portal starts instead of exiting at boot.
- A report now says a case-law source could not be confirmed, rather than saying this installation does not have it.
- An address only this machine can reach is no longer described as reachable from the internet. A key that could not be written down now names the missing setting.
- Connecting an assistant no longer reports the connector as closed when it cannot reach the session bus. It also no longer stops on a signing secret the installation already holds.
- Connecting an assistant now says what went wrong when it stops part-way, and what it had already changed.
- Checking a settings file now reports on the file you named, not the one this machine happens to use.
- Installing Clearotron from npm works again — recent releases failed before any files were written, so nothing could be installed or run.
- Reinstalling the services no longer overrides the port and address you set for the assistant connector. The connector's unit reads them from your settings file like every other service.
- The portal now runs on the current React, TypeScript and Vite, and its download is smaller because build comments no longer ship to the browser.
- The case-law sign-in instructions now produce a credential that survives its first renewal, and verify that it does.

### For operators

- The live-surface check no longer calls a healthy installation broken over a service file the product never shipped.
- the configuration page now shows this deployment's live settings, and says if the last run used different ones.
- the shipped multi-country demo is now the same run family as the other three, not an older capture from a different customer.
- The end-to-end harness now recognises the worker draining queues here, instead of offering to start a second one.

## 0.1.3

### For operators

- The engine's HTTP client moves to its current major version, which needs Node 22.19 or newer. Installs on an older Node 22 must upgrade Node first.

## 0.1.2

### New

- A finished report can now be asked what changes under a stated assumption, answered by a short memo over the evidence already gathered. Nothing is searched again and the report is not altered.

### Fixed

- A clearance no longer fails part-way because a section heading was worded differently. The report is accepted on what it contains.
- A zone with too many results to work through is now recorded, not left blank where it could read as searched and clean.
- A clearance stopped by a provider's usage limit now waits for that limit to reset, instead of giving up and reporting a failed run.
- A what-if about a finished report is answered under the same risk framework as the original run, or declines rather than switching.
- Reports can no longer say a territory was searched when it was not. The wording is corrected before the report reaches the client.

## 0.1.1

### New

- Releases are now signed. Each npm package carries a record of the exact source and build it came from, so an install can be verified against this repository.

### Fixed

- The instructions for running from a clone no longer show a short command form that only a global install provides.
- A case-law sign-in that is present but no longer usable is now reported as such, instead of being counted as ready.
- The package now includes its third-party licence notices, and they list every package it bundles.
- The connection steps shown for Cowork and Perplexity now match what those apps actually ask for.
- The demo's port setting now moves every connection it opens, so a demo cannot take the ports of an installation running beside it.
- Stopping the demo now closes every connection it opened, instead of leaving some listening.
- Installing Clearotron no longer downloads an AI vendor toolkit that the product never uses.
- Removing the demo is one folder again: nothing it writes lands outside the folder it names, and running it leaves the installed files untouched.
- Settings renamed in an earlier release are now reported at start-up and by `clearotron doctor`, so an upgrade cannot quietly ignore them.
- Settings now live in `~/.config/clearotron/` and survive an upgrade — before, upgrading a global install threw them away, credentials included, while reporting success.
- The demo now offers only the two example accounts it ships with; three names that were only test material are gone.
- An assistant connected to Clearotron no longer asks permission before reading; it still asks before starting or stopping a search.
- The demo now says plainly when a search type has no sample run, and lists the ones it has. Nothing is started and nothing is charged.

### For operators

- Updating an installation built from source now rebuilds the web interface, so it no longer serves the previous one after an update.
- Stopping a backgrounded command now stops everything it started, instead of leaving the engine, client and portal connections listening.
- Server installs no longer stop accepting new clearances after 30 days. The internal key renews itself on every start, and `clearotron doctor` warns a week before it would lapse.
- The portal now reports its screens as out of date when they are older than the sources they were built from, instead of ready.

## 0.1.1-beta.1

### Fixed

- A case-law sign-in that is present but no longer usable is now reported as such, instead of being counted as ready.
- The package now includes its third-party licence notices, and they list every package it bundles.
- The connection steps shown for Cowork and Perplexity now match what those apps actually ask for.
- The demo's port setting now moves every connection it opens, so a demo cannot take the ports of an installation running beside it.
- Stopping the demo now closes every connection it opened, instead of leaving some listening.
- Installing Clearotron no longer downloads an AI vendor toolkit that the product never uses.
- Settings renamed in an earlier release are now reported at start-up and by `clearotron doctor`, so an upgrade cannot quietly ignore them.
- An assistant connected to Clearotron no longer asks permission before reading; it still asks before starting or stopping a search.

### For operators

- Updating an installation built from source now rebuilds the web interface, so it no longer serves the previous one after an update.
- Stopping a backgrounded command now stops everything it started, instead of leaving the engine, client and portal connections listening.

## 0.1.1-beta.0

### New

- Releases are now signed. Each npm package carries a record of the exact source and build it came from, so an install can be verified against this repository.

### Fixed

- Removing the demo is one folder again: nothing it writes lands outside the folder it names, and running it leaves the installed files untouched.
- Settings now live in `~/.config/clearotron/` and survive an upgrade — before, upgrading a global install threw them away, credentials included, while reporting success.
- The demo now offers only the two example accounts it ships with; three names that were only test material are gone.
- The demo now says plainly when a search type has no sample run, and lists the ones it has. Nothing is started and nothing is charged.

### For operators

- The portal now reports its screens as out of date when they are older than the sources they were built from, instead of ready.
- Server installs no longer stop accepting new clearances after 30 days. The internal key renews itself on every start, and `clearotron doctor` warns a week before it would lapse.
