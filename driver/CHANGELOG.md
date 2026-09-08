# clearotron-driver

## 0.2.3

### Patch Changes

- 54ea03a: Fixed: The configuration check no longer reports a problem when the client connector's address is reached with its own token. Putting a single sign-on front before it is the client's choice, and running it token-based is supported. The check still says the sign-in audience was not compared against that address, so it never implies the two agree.
- 4b6be02: Fixed: A bundled risk framework now states where it came from in words a customer can read. The note used to carry a confidentiality marking, a filename for a document not included, an internal reference number and revision history. It says whose framework it is, who stands behind it and which revision, and nothing else.
- 63f916c: Fixed: A fresh install's brand-owner list now offers Generic and, with the demo, the demo account. It offered three of our test accounts as well, on the install route that clones the repository.
- 5d12baa: Fixed: A run record now says which version of the engine's command-line tool served it. A change in results can be traced to a tool upgrade rather than guessed at.
  
  Fixed: A version the tool could not report is recorded as unreadable. An absent field could not be told apart from a probe that never ran.
- 888de5d: Fixed: The deployment check now says whether each scheduled job's timer is still armed. A timer-driven service reads "inactive" between runs and when its timer has been stopped. So a check that asked only about the service could report nothing wrong while the scheduled work had quietly stopped happening.
- 3a75e22: Fixed: A supplementary memo now succeeds on its first attempt. It cost two turns instead of one, and left a retried-stage mark on a report that had been delivered cleanly.
  
  Fixed: A supplementary memo states the rating framework it was reasoned under. A report assessed under a customer's own framework said so; a memo written from it did not.
- fe22384: Fixed: Installing on a Node version the engine cannot run on now stops at once. It names the version you have, the version needed, and the command that fixes it. Before, the install finished and the first US register search failed with an error that never mentioned Node. The supported floor is Node 22.13 or newer.
- 74b2cdd: Fixed: Setup now asks which address signs in, instead of turning it into an access rule covering everyone who shares its email domain.
  
  For operators: The People & access page now names the setting behind a staff rule, and the file to edit to undo it.
- 9053919: Fixed: Five things a first-time reader could not act on.
  
  A screen that needs a brand owner chosen no longer points at the top left when the menu is collapsed and there is nothing there.
  
  The profile editor's Save button now states the one thing that is blocking it. That reason was always there, but it looked the same as the states where nothing is wrong.
  
  The default jurisdictions field now says what it does with what you type. Entries are checked against the list and kept, never refused. A region counts as one entry.
  
  The trademark categories field explains what those numbers are, with examples, before naming the standard they come from.
  
  The row of coloured ratings under "Risk framework in force" now says it belongs to that framework. It used to read as a list of several frameworks. Both editors say it the same way.
- fe22384: For operators: Clearotron runs on Node 22.13 or newer again, down from 22.19, because its HTTP client moves back to version 7. Anyone who upgraded Node for the last release has nothing to undo.
- bb899a7: New: A screening report now leads with the read. Each conflict shows its name, band, source and a one-sentence verdict. The paragraph arguing that verdict is one click away. Register filings appear as conflicts only where the reviewer rated them above the lowest band; the rest stay in the filings table.
  
  New: What was asked is now at the top of a screening report, with any question about whether it was the right thing to ask. Both used to sit at the bottom.
  
  New: The long per-name assessment now opens from the read. The engine has always written it and the page never showed it.
  
  New: Register counts say what they counted in their column headers. Territories are named rather than printed as two-letter codes.
  
  New: The lines a reader meets before opening anything are written in plain language. That is the summary, the basis line, each conflict's one sentence and the reviewer's notes. Legal vocabulary stays where the detail is.
  
  Fixed: Reviewer notes no longer appear on a screening report exported to PDF. They are for the reviewing lawyer, and a report forwarded to a client used to carry them.
- 2a812d6: Fixed: The New clearance screen now has a **Start a search** button. The button that ran a search used to say "Review clearance", and people could not tell it was the way to begin.
  
  Fixed: When a search cannot start yet, the screen says what is still missing, both on the form and beside the button. It used to grey the button out and give no reason at all.
  
  Fixed: **Save as search** now confirms the save beside the button that was pressed, names what was saved, and links to it. It gave no sign at the point of the click.
  
  Fixed: The unsaved-changes warning no longer fires on a search you have just saved. It compared the form against a blank one and nothing ever reset it.
  
  Fixed: The message shown when no search engine is attached now names the setup command for the way you installed. It used to name the one that only works in a copy of the source.
- 58af0b7: Fixed: The settings page no longer shows the engine as healthy when the engine program cannot be found.
  
  That page reports which engine is configured. The New clearance screen reports whether a search can start right now. When those two readings disagreed, neither screen said so.
  
  An install could therefore show a green engine while no search would start, and nothing explained the gap. The settings page now names the disagreement and says what to do about it. Running `clearotron doctor` reports the same thing in the same words.

## 0.2.2

### Patch Changes

- df095a8: Fixed: The configuration audit now refuses when one of the files it reads is missing, instead of reporting that nothing sets the variables that file records. Its answer decides which settings look unused, so a file it could not read was being counted as a file with nothing in it.
- f05657c: New: An assistant on a clearance account can now answer "what if this were different" about a report already delivered. It writes a short memo reasoning over the evidence already gathered, instead of asking for a new search.
- d52cd98: Fixed: A scheduled deploy no longer updates the working copy while an experiment run is in progress. It now waits, as it already did for a clearance run.
- f05657c: Fixed: A client account asking about a mark in a knockout screen now receives the risk band, the reason for it and the findings behind it. It previously returned an empty answer.
- 38ce32f: New: A Knockout search now looks up what the owner of a registered right actually sells, and the report says where that answer came from. Before, the assessment inferred the owner's trade from the company name alone, then told you to go and obtain the registration's own goods list. The name is not evidence of the trade. It happened to read correctly on one search and would have read confidently wrong on the next.
  
  Fixed: Where the lookup finds nothing, the report says so plainly and still delivers. An unanswered search is never written up as a clean negative, and a provider outage never withholds a report.
  
  For operators: this adds one web search per promoted registered filing, deduplicated by owner and capped at three per searched name. A search with no registered right against it costs nothing extra.
- 57eaf24: Fixed: A knockout report no longer shows a register filing's risk band beside a line saying that filing carries no rating. The band shows when the reviewer gave one, and the line appears only when they did not.
- b1f188f: Fixed: The unit inventory again records why every shipped unit that runs on no box is still shipped. One entry lost its reason when its name was superseded.
- 3de0828: New: One engine process can now serve both people arriving through a tunnel and programs on the same machine holding an access key. It listens for the key on a local socket, which no tunnel can forward to, and the network door never accepts a key at all. Deployments that needed both used to run the process twice, on two ports, with two units to keep in step.
  
  Fixed: The startup lines now say whether a local key path exists, and what its permissions are. An operator can see it without opening a unit file. A deployment with no key path is told that too, rather than left to infer it from silence.
  
  For operators: set TRADEMARK_MCP_KEY_SOCKET to the socket path the local key door should listen on. It is created with owner and group access only. Leaving it unset changes nothing about an existing deployment. The door refuses to open without a grants file, or alongside the authentication bypass.
- 235cf07: Fixed: Stopping the demo now stops everything it started, including when the stop signal reaches only the command you can see rather than the whole terminal.
- be648b6: Fixed: The architecture diagrams in the public documentation render with their intended colours again, and thirteen code comments state the colour they meant.
- 97b7c96: Fixed: The deployment check now reports the services a box is actually running. It had been asking systemd about unit names left behind by a rename, so a healthy box reported nothing running.
- f05657c: Fixed: The "your screen is done" notice for a knockout search now goes to the person who ordered it, with the operator kept as a copy. It previously went to the operator alone, whoever had asked for the search.
- c4b6b58: Fixed: The link in your completion email and message now opens the report. It previously pointed at a path the site does not serve, so it led to a sign-in and then a dead page. This affected every delivered report on both search products, in the email, the chat notice and the assistant's own answer. The workbook link in the same email was always correct and is unchanged.
  
  Fixed: The chat notice now goes to the person who ordered the search, with the operator keeping a copy they can switch off. Before, it went only to whoever runs the service, so the requester was never told their search had finished.
  
  For operators: hold requesters' numbers in CLEAROTRON_REQUESTER_WHATSAPP, keyed by email address or by the handle a request arrives under. Where no number is held, the delivery record says so by name instead of quietly sending the notice to you. Set CLEAROTRON_WHATSAPP_OPERATOR_COPY=0 to stop receiving copies of other people's runs.
- bb1a409: New: A Knockout report now carries the whole assessment behind its ratings. You get the reviewer's notes and the reviewer's own opening read of each name. You also get the reasoning that holds a name at its rating, and what would move it. This was written during every search and reached only the audit workbook, so the report showed a rating without the thinking under it. The notes are marked as reference material rather than mixed into the findings.
  
  New: A registered filing the search formed a view on now shows that rating and the read behind it. Before, the one registered right on a page was the only entry carrying no rating, beside softer uses that all carried one. That inverted what matters legally. A filing the search did not weigh still says so plainly.
- df6277c: Fixed: A live registration covering the goods you asked about is no longer left out of a report for want of room. It is reported, or the report says why it is distant.
- 9ba8cd0: Fixed: A what-if memo is now refused if it writes anywhere in the delivered run except its own memo folder, and the refusal names the file.
- 8c8e200: Fixed: A what-if question left queued when its run is archived now comes back with a reason, instead of never being answered.
- bb1a409: Fixed: The delivery record now states plainly when a report's write-up length and ranking rules could not be checked against the delivered text. It says the rules were applied to nothing on that run. Before, this was recorded as an unlabelled failed check. It looked like any other, so a run could deliver with those rules unverified and nobody would see it.
- 9ba8cd0: For operators: Each run record now says whether the model id it observed was a pinned snapshot or an alias the provider can repoint.
- aea4a4e: Fixed: The deployment check now says which checkout a service is running from even when its unit file does not declare one.
- bb1a409: New: The tools that show how a search reached its answer now work on a Knockout search. You can ask what it found, what it looked at, where it searched and came back empty, and read the delivered report itself. Until now they returned nothing at all for a Knockout search, so anyone asking how one of these results was reached saw a blank record.
  
  New: The proof-of-search record answers on these searches. It lists what was searched and found nothing, which is what answers a challenge to a result. Where a tool has nothing to show for this kind of search, it now says so in words. An empty list reads as "we looked and found nothing".
- 14d6d28: Fixed: The demo and the install steps now start on native Windows, where they previously crashed on the first internal module they loaded.

## 0.3.0-beta.0

### Minor Changes

- bb1a409: New: A Knockout report now carries the whole assessment behind its ratings. You get the reviewer's notes and the reviewer's own opening read of each name. You also get the reasoning that holds a name at its rating, and what would move it. This was written during every search and reached only the audit workbook, so the report showed a rating without the thinking under it. The notes are marked as reference material rather than mixed into the findings.
  
  New: A registered filing the search formed a view on now shows that rating and the read behind it. Before, the one registered right on a page was the only entry carrying no rating, beside softer uses that all carried one. That inverted what matters legally. A filing the search did not weigh still says so plainly.
- bb1a409: New: The tools that show how a search reached its answer now work on a Knockout search. You can ask what it found, what it looked at, where it searched and came back empty, and read the delivered report itself. Until now they returned nothing at all for a Knockout search, so anyone asking how one of these results was reached saw a blank record.
  
  New: The proof-of-search record answers on these searches. It lists what was searched and found nothing, which is what answers a challenge to a result. Where a tool has nothing to show for this kind of search, it now says so in words. An empty list reads as "we looked and found nothing".

### Patch Changes

- df6277c: Fixed: A live registration covering the goods you asked about is no longer left out of a report for want of room. It is reported, or the report says why it is distant.
- 9ba8cd0: Fixed: A what-if memo is now refused if it writes anywhere in the delivered run except its own memo folder, and the refusal names the file.
- 8c8e200: Fixed: A what-if question left queued when its run is archived now comes back with a reason, instead of never being answered.
- bb1a409: Fixed: The delivery record now states plainly when a report's write-up length and ranking rules could not be checked against the delivered text. It says the rules were applied to nothing on that run. Before, this was recorded as an unlabelled failed check. It looked like any other, so a run could deliver with those rules unverified and nobody would see it.
- 9ba8cd0: For operators: Each run record now says whether the model id it observed was a pinned snapshot or an alias the provider can repoint.
- aea4a4e: Fixed: The deployment check now says which checkout a service is running from even when its unit file does not declare one.
- 14d6d28: Fixed: The demo and the install steps now start on native Windows, where they previously crashed on the first internal module they loaded.

## 0.2.1

### Patch Changes

- 3cc154a: Fixed: A report now keeps a mark the search confirmed, instead of dropping it because it was already noted on an internal working sheet. Where a mark is still missing, the run records it by name rather than closing the question.
- 3cc154a: Fixed: Asking a what-if question about a delivered report now returns a memo, instead of failing to find the run it was asked about.
- 0f7b44a: New: `clearotron demo` now publishes all four example reports — one per product — instead of only the first.
- 2138a3c: For operators: The `beta` channel now gets a release when there is something worth testing, days apart, instead of one on every merge.
- 8b5ab91: Fixed: `doctor` no longer reports a working Cloudflare Access door as unprotected. An API-style door and a failing origin are now told apart, each with its own message. Neither is reported as a pass.
- 77cf56d: For operators: The configuration reference now explains the two deprecated search-log variables in full, instead of stopping mid-sentence.
- 0dcd05a: Fixed: the settings catalogue now lists `CLEAROTRON_CHECKOUT_DIR`, the path every service file points at. The installer still fills it in for you. It is written down so that anyone whose service will not start can look it up.

## 0.2.1-beta.2

### Patch Changes

- 8b5ab91: Fixed: `doctor` no longer reports a working Cloudflare Access door as unprotected. An API-style door and a failing origin are now told apart, each with its own message. Neither is reported as a pass.

## 0.2.1-beta.1

### Patch Changes

- 0dcd05a: Fixed: the settings catalogue now lists `CLEAROTRON_CHECKOUT_DIR`, the path every service file points at. The installer still fills it in for you. It is written down so that anyone whose service will not start can look it up.

## 0.2.1-beta.0

### Patch Changes

- 77cf56d: For operators: The configuration reference now explains the two deprecated search-log variables in full, instead of stopping mid-sentence.

## 0.2.0

### Minor Changes

- cb0f60a: New: Two release channels. `npm install clearotron` stays on the tested release; `npm install clearotron@beta` follows every merge.

## 0.1.12

### Patch Changes

- fb25fd5: For operators: A release now publishes both the version waiting and the one it just prepared, so neither sits unpublished.

## 0.1.11

### Patch Changes

- 83970de: Fixed: A what-if on a delivered report now returns its memo. The previous release announced this before it worked; from this version it does.
- d534f53: For operators: On a box running the services, the check-up now reports what those services read rather than what the shell you typed in happens to carry.
- 29ba234: For operators: `npm install clearotron` gives you the tested release. `npm install clearotron@beta` gives you the newest, published within minutes of every merge.

## 0.1.10

### Patch Changes

- d06533e: Fixed: The check-up no longer reports that nobody can use the portal on an install where signing in works. It now reads the settings the running services load.
- d06533e: Fixed: Restarting no longer logs a warning saying searches will fail. The portal sometimes starts before the door it calls, and that clears itself within seconds.
- d06533e: Fixed: Stopping the product and starting it again now works. Before, the start refused because the assistant connection that stopping deliberately leaves running was still there.

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
