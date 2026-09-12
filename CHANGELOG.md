# Changelog

What changed in each release of Clearotron, in plain English.

Install or upgrade with `npm install -g clearotron`.

## 0.3.0-beta.11

### Fixed

- The setup and status commands no longer load the unit renderer while starting up. That shape once made an install command refuse to run at all. A check now refuses it anywhere it appears.

### For operators

- The install check now reports an npm failure it cannot read as a could-not-look, instead of refusing your package.

## 0.3.0-beta.10

### New

- The install guide now says how to remove Clearotron, naming every path it writes and which one holds your reports.

### Fixed

- A portal address that does not exist now says so wherever it is. Addresses under the admin path used to show the Global config screen.

## 0.3.0-beta.9

### Fixed

- Commands printed while running from npx name the published version, so they still work after npm cleans its cache.
- When the engine cannot answer "Describe it", the page names the check that finds out why. It says "just now" only for a usage limit.
- `clearotron status` says whether a product started in a terminal is up, and on which addresses. `clearotron stop` says how to stop it.
- The demo no longer offers `start --background`, which set up an empty install in your home instead of running the demo.
- The key command the demo prints issues a key the demo's client door accepts, run exactly as printed.

## 0.3.0-beta.8

### Fixed

- Commands the install, start and the New company screen print now run as printed, from any directory and after npm cleans its cache.
- A demo started with npx prints commands that keep working after npm cleans its cache.
- Doctor, run before the first start, describes the local sign-in that start brings up, and drops checkout-only warnings on a packaged install.
- The package no longer names the hosted service's own hostnames; a deployment names its own.
- The README installs with `npx clearotron install`, which needs no root, and no longer says the demo opens a browser.

## 0.3.0-beta.7

### Fixed

- A demo started with npx keeps its assistant connection working after npm cleans its cache.
- An assistant connected to the demo now opens each sample report on the demo's own portal, not on another server.
- The portal names the organisation setup recorded, and the product keeps its own name beside it.

## 0.3.0-beta.6

### New

- An assistant connected to `clearotron demo` can now list, brief and open the demo's four sample runs. They stay inside the demo's own folder.
- `clearotron update` now updates an npm-installed copy itself, and a beta install moves on to the release once it is published.

### Fixed

- When codex's sign-in can no longer be refreshed, the search stops and says to run `codex login`. It used to retry with a bare exit code.
- When the portal address opens someone else's page, for example a port forwarded from outside WSL, Clearotron now says so and points you to `--port`.
- The sign-in page clears a session left by another Clearotron on the same address and says so. A refusal that is not about the passphrase now says what it is about.
- A passphrase pasted with a space or line break at either end now signs in, instead of being refused as wrong.
- A manager who does not run the installation no longer sees server file paths when a new company cannot be recorded or filed.
- The local sign-in page no longer invites the browser to fill in a saved password from another install.
- `npx clearotron install` now installs Clearotron permanently under `~/.local` before setting up. The `clearotron` command and your assistants' connections keep working after npm cleans its cache.
- When the saved-search store exists but cannot be read, the connector and `clearotron doctor` now say so, instead of reporting no saved searches.
- On WSL, the "on this computer" connect steps now say to run them inside WSL. The Claude Code line registers Clearotron for every project and works in Windows PowerShell.
- The sign-in page's reset line now runs for a demo started with npx, and resets that demo's own passphrase.

## 0.3.0-beta.5

### Fixed

- A Clearotron install signed in to OpenAI's `codex` with a subscription keeps working after codex refreshes its login. Before, every search after the first refresh failed within seconds until you signed in again.
- When the company store cannot record a new company, the New company page now says why and what fixes it, instead of "Try again shortly". Someone who does not run the installation is told to ask whoever does.
- On an install run with `clearotron start`, a connected assistant now lists the same saved searches as the portal, including Generic's. `clearotron doctor` no longer says working saved searches are off, and it names one place profiles come from.
- When setup offers to try your engine, it no longer names an Anthropic model to someone who chose OpenAI's `codex`.

## 0.3.0-beta.4

### New

- Use your own AI asks first where Clearotron is running, then shows the steps for your app beside the list. The same five apps are offered either way.
- Claude Code and Codex can connect to an installation running elsewhere, and the ChatGPT desktop app to one on the same machine.
- the company switcher in the sidebar ends with `+ New company`. Making a company is now one click from every screen, whether or not a company is selected.

### Fixed

- Codex was told to paste a settings block into a terminal. Its steps now name the file the block goes in.

### For operators

- `clearotron connect` and `clearotron disconnect` take `--where here` or `--where elsewhere`. Assistant names used before, such as `cowork`, still work.

## 0.3.0-beta.3

### Fixed

- Creating a company is refused, with nothing left behind, when the configuration store cannot record it. The company used to be created anyway, with no record of who made it or when, and its organisation was given access to it.
- A store with no git identity is the usual cause on a new machine, and the refusal names the command that fixes it. Setup and `clearotron start` now check a store they adopt for this straight away.
- A search step stopped at its time limit now records the output it actually produced. It used to record a small fraction, so a step that was working read as one that had stalled.
- The token totals `clearotron tokens` reports for runs with a stopped step now include that output.
- `clearotron doctor` now says when saved searches are switched off and why, and when a saved search file cannot be read.
- An assistant asking for saved searches is told when they could not be read, instead of being told there are none.
- `clearotron doctor` reports the register and the research key the background services will use, read from the file they read. Run from a new terminal, it used to say no register was selected on an install whose searches were running.
- Global config appears in the account menu only for people who can open it. Someone managing one organisation used to be offered it, and the page then said it was not available.
- Clearances and People no longer ask for installation-wide data that a manager of one organisation cannot see.
- A clearance or knockout searched through Compumark now links each register record to the trade mark office's own page for it. Those records used to show an internal reference nobody could open.
- The offices linked are the United States, the European Union, the United Kingdom, Canada, Australia, Switzerland, France, Norway, Sweden and WIPO. A record from any other office is cited by its number, and the report says why once, under the findings.
- Saved searches work on a fresh install and in the demo, for every company, Generic included. They used to fail to load for every company, with a message saying to try again shortly.

## 0.3.0-beta.2

### New

- `clearotron brandowner framework <key> <path>` points an existing company at a risk framework.
- Which framework rates a company's matters is set on the command line. Until now the only verb there was `add`, which creates a company. A company made in the browser could not be pointed at its own rubric at all.
- The framework's deck is checked before anything is written. A path that does not resolve, or a manifest that will not load, is refused. The company is left exactly as it was.
- A screening report's summary, basis lines and conflict sentences now read in plain language.
- Long sentences are split and the profession's shorthand is replaced with the everyday word. No rating, name or reason is changed.

### Fixed

- A key pasted at a yes-or-no question in setup is never shown on screen. Where the question leads to a key, a token or a credential, setup takes what was pasted as the answer. It does not ask for it again.
- While setup waits for a yes or no, it shows only what you type toward one. Anything else stays off the screen, so a pasted key never reaches the terminal's history.
- The up-arrow at a later question in setup no longer brings back a key, a token or a password typed earlier. Setup keeps no history of its answers.
- A knockout searched on Signa now shows each filing's owner, classes and filing date. Before, those cells were blank on every filing.
- Each filing in a Signa knockout that carries its office's number now links to the trade mark office's own page for that record. Where it cannot be linked, the report gives the office and the number, and says once why. A filing without a number shows as before. The audit workbook carries the same link or number.
- A knockout no longer refuses a finding that names the register filings it rests on. Before, the assessment was refused and retried, and the delivered findings lost the labels that say where each one came from.
- A new install signs in with a passphrase of its own, and its first start prints it. This holds even on a machine where an earlier install left a sign-in behind.
- Each new install keeps its sign-in inside its own directory, `~/trademark/` by default. An install that already signs in with the shared one under `~/.cordillera/` keeps using it, so no passphrase stops working when you upgrade.
- When a start does not print the passphrase, its first line now says how to get a new one: `clearotron passphrase --reset`. It also says which sign-in file it is using, when that file was created, and for which address.
- The demo always gives you a passphrase that works. Each demo start makes a new one and prints it, instead of reusing one an earlier demo left behind.
- A new install can open its companies' profiles. If its configuration folder overrides no instruction files, the portal no longer answers with an error. Nor does it warn that risk frameworks might be synthetic. Setup also creates the `skills` folder its closing screen tells you to use.
- A search refused because the install is not fully configured now names the settings file `clearotron start` read. It no longer names a file that does not exist on that machine.
- An audit workbook no longer reports every register finding as missing its link when the register publishes no page per record.
- The registration number and the office are the citation in that case. A finding that carries neither is called out instead.
- A search now records any of your default territories that the engine cannot search, in the record of that search. A mistyped default no longer narrows a search silently.
- An assistant connected to a local install now sees the saved searches the portal shows, and can plan a run from one of them. Before, outside the demo, only the portal was told where saved searches are kept, so an assistant was told the install had none.
- `clearotron doctor` now reports everything a search would be refused for, checked against the environment the search will run in. So an installation it passes is one that can run a search.
- A token set in the installation's own configuration file now reaches the engine check. A headless server set up the documented way proves its engine instead of reporting it signed out.
- When a search is refused because the installation is not configured, the message names every configuration file that reaches the run.
- The signed-out message now offers a sign-in route for a machine with no browser.
- Filtering Clearances to a company with no clearances no longer clears the page.
- The company buttons and the status filters stay on screen, so you can pick another. They used to disappear along with the list, and they are the only way to change company there.
- Pressing Stop now prevents the report from being published.
- A run stopped during its final step used to finish and deliver anyway, after telling you nothing would be delivered.
- The Stop dialog no longer promises that nothing will be delivered when the report is already being written. It says so instead.
- "Stop now" ends the step in flight and anything that step started, and says the step has ended only once it has.
- If the step cannot be ended, the card says so and the run stops at its next step instead.
- Pressing "Stop now" no longer says the step in flight has ended. It says a stop was sent, and what happens if the step will not take it.
- A stop is sent to the step under way. If it takes it the run ends in seconds; if it does not, the run ends at its next step. The old wording promised the first of those every time.
- The notice shown while a run is stopping no longer overlaps the elapsed time on the card.
- It has its own line under the run, so "1 min so far" stays readable while a stop is in flight.
- `clearotron demo` no longer reads the settings of a real install on the same computer. Before, it showed that install's companies instead of its own and put its four example reports into that install's archive. A company created in the demo would have been saved into that install's customer list. An assistant connected to the demo could be offered that install's saved searches. The demo now keeps all of this in its own folder.
- The demo's company switcher lists the demo company and Generic. A company you create in the demo belongs to the demo's own organisation.
- If no organisation is set up yet, New company now says so and names the command that sets one up.
- A Knockout report no longer carries a line telling the reader to remove the reviewer's notes before it goes to a client.
- The notes are reference material and the report says so where they sit. An instruction to edit the document was addressed to the lawyer and read by whoever opened it.
- `clearotron doctor`'s register check now tests the register your install is set up for. A register or key kept only in your install's settings file came back as not set, though doctor had just listed it. The check now reads that file too, and a value set in your shell still wins.
- You can now start a new company from the Company profile screen. It used to be reachable only from the company picker, which disappears as soon as you pick a company.
- Choosing a company on the dashboard now shows only that company's clearances. The buttons above the list used to change nothing.
- When a feature is switched off on your installation, the screen says so and what to change. It used to suggest trying again shortly.
- The link to the risk-framework guide opens in a new tab and goes straight to the section on writing your own. It also appears on the Company profile screen.
- The audit workbook's "What was searched" sheet is now in plain words. Its Result and Note columns carry the search log's own notes. Internal terms could reach them: a status such as "deferred", a full web address, a bare HTTP code. Those words are now replaced as the workbook is built, a republished report included. A search recorded as not run still reads as not searched. Search terms and names stay exactly as written, because they record what was searched.
- An assistant reading a knockout's filings through the connector now gets each filing's page at the trade mark office, as the report does. Where that register publishes no page for a single record, it gets the office and the number instead. Before, it got a reference that opens nowhere.

### For operators

- A deployment health check that could not finish now fails instead of reporting success. Two parts of the service check could skip themselves. One skipped when the installation did not say which installation it is; the other when the scan of the service files did not finish. Both used to note that they had not run and then pass.
- Set `CLEAROTRON_BOX` to `prod` or `test`. Those are the only two values the check accepts; anything else, including any other name, reads as unnamed and fails. The failure names the setting and says what went unchecked.
- The part that could skip itself is the one that notices a service that has stopped and stayed stopped. The other part lists what is running, so it cannot see something that is no longer there. While the first part is skipped, a service can disappear without the check saying anything.
- `clearotron doctor` now says where a company or project saved in the portal goes once it is recorded. Sometimes the settings folder sits in a copy of a repository that other work also pulls and pushes. The next person to do that then publishes those saves. Doctor now warns about this, and counts the saves still waiting to go. Publishing your settings on purpose is still supported: this is only a warning, and it does not change doctor's result.
- On a local install, setup no longer asks for a sign-in address. It uses your computer account's name at `localhost` and shows it once in the summary. An address already in your settings file is kept.
- The deployment health check now reports whether the component that updates an installation is itself up to date. It was the one part of a deployment the check could not identify. An installation kept current by an out-of-date updater could report healthy while serving stale code.
- An updater that cannot be identified is now reported as a failure rather than passed over. A copy old enough to predate this reporting writes nothing at all. That silence is the case worth knowing about, so it is treated as a finding.

## 0.3.0-beta.1

### New

- People, in the sidebar for anyone with Manage, lists who can use the installation, and adds a person.
- Enter their email address, choose what they may do and what they can see, and save. A sentence under the form says what they will and will not see, before you save. They sign in the same way you do; Clearotron issues no passwords.
- An installation that signs one person in on its own machine cannot hold a second. People says so, and links to how to put a login system in front of it.
- Each person now has two permissions, Run clearances and Manage, instead of a staff or client role.
- A person sees everything below the points they were given: the whole installation, an organisation, or a single company. Someone without Run has no New clearance. Someone without Manage has no People page and cannot add companies.
- The company menu groups companies by organisation when you can see more than one. Each organisation has its own Generic, listed first and marked Default. The top bar names your organisation when you can see exactly one.
- Clearances with no company set up now have a daily allowance per organisation, 20 unless the Generic profile sets another.
- Anyone with Run clearances on a whole organisation can start them. One organisation's clearances never use up another's, and a person with access to the whole installation is not limited.
- You can now choose which company a clearance is for on the page itself, and set up new companies in the browser.
- Those screens used to refuse to render until a company was chosen. They told you to pick one at the top left. That is not where the control is when the sidebar is collapsed. They now show you the companies instead. Each one says what it sells, how many marketplaces it covers, and which territories it defaults to.
- Setting up a company is a page, not a document. It needs a name. Everything else has a default, and the screen says what that default is. It refuses before writing anything, and says why. A name it cannot make a key from, a key already in use, or an email address another company claims. A company you create can run its first search straight away, with no restart, and stop or cancel that search like any other.
- The product now says company throughout. It used to say brand owner, account, client and customer for the same thing. The firm running the installation is named separately, in the top bar.
- Companies created through the settings page were saved without a risk framework. Their matters were then rated under the default risk framework, with nothing on screen saying so. Every company created now carries one, and says which.
- The setup wizard now asks for the organisation's name after the sign-in address, and the person who installs starts with access to everything.
- `clearotron grant add` sets a person's two permissions with `--run` and `--manage`; with neither, the person can look and start nothing.
- `clearotron framework <your-framework.md>` reads a risk framework and its manifest, and reports what they declare.
- Run it before either rates a matter. It prints the ladder in the framework's own order, the company the deck names, and the shape it is. Where the deck and the manifest disagree, it names the band and says what the deck did not do. It creates nothing, rates nothing and contacts nobody, and it exits non-zero when the pair is not ready. `clearotron brandowner add --dry-run` prints the same report.
- Getting the deck's shape wrong used to fail quietly. The profile screen showed the framework's title and your band colours, and silently omitted the box saying what the bands mean. The new command answers that question directly, using the screen's own read of the deck.
- The configuration guide now explains how to write your own risk framework, step by step.
- It gives the manifest in full. It says which fields are required, and what each one may contain. It shows the shape a deck needs for the profile screen to explain your bands.
- That shape was undocumented, and getting it wrong fails quietly. The screen still shows the framework's title and your band colours. The box saying what the bands mean does not appear at all.
- The guide also says what is checked and what is not. Nothing reads your rubric for sense. A framework that is subtly wrong produces confident ratings that look exactly like right ones.

### Fixed

- Installed under a folder named with `#` or `%`, setup's register check now reads the provider's cost instead of calling it unknown. It built the address of the provider's own declaration by hand, and those characters broke it. It now uses the address Node builds, which is also what Windows needs.
- When you have a configuration store set and a risk framework comes from the product's own files instead, the product now says so.
- Your store is looked in first, and the product's files answer when it is silent. The product ships decks under names you may also have chosen. So a deck that went missing from your store was replaced by ours rather than reported absent. Same band words, different rubric, nothing raised anywhere. The profile screen now writes one line naming what happened, and the new command reports it.
- The built-in triage framework's profile page explains its bands again.
- Its band sections stated their meanings as plain paragraphs, which the screen does not read. Every company without a framework of its own saw band colours and no explanation. The wording is unchanged.
- `clearotron doctor` now lists the companies your portal's key may start runs for.
- The key carries a list of the companies it may start runs for. A company added after the key was minted is outside it. Doctor reported the key's expiry and never its coverage. So the one command whose job is to tell you what a machine is configured for said nothing about it.
- It reads the company list the background services read, not the one a command run in a terminal would find, and it says which. The two can differ, and when they do, that difference is the answer.
- The line is a note, not a failure. Your portal takes a fresh credential at the start of every call, so a company outside the key is not normally refused. It is refused when the portal cannot take a fresh one, and the line says so and gives you the command to widen the key.
- On reports searched through Signa, each register finding now links to the office's own page for that record, where the office publishes one. Singapore publishes no such page, so its registrations are cited by number, and the report says why. A number that an office's page cannot take is cited the same way.
- A company you create in the browser now appears in your assistant's list of companies straight away.
- It used to appear only after the service restarted, although a search could already be started for it. Its projects were missing from the list in the same way, and so was its account in the search options.
- The check comparing the running service with the configuration store no longer calls a company the portal's key does not cover a disagreement. It names that gap on a line of its own, with the command that widens the key.

### For operators

- Who may sign in is now decided by each person's own entry in the guest list, and nothing else. On a local installation, the next `clearotron start` gives whoever signs in access to everything if the guest list has no `people` section.
- Any other installation with people on it needs one edit to its guest list (`CLEAROTRON_ACCESS_FILE`) before upgrading.
- Anyone admitted because of their email domain needs an entry under a new `people` section: `"everything": true`, `"run": true`, `"manage": true`.
- Each person who starts clearances needs `"run": true`, and each person who adds people or companies needs `"manage": true`. A person with no entry can see what their access covers, and start nothing.
- An organisation whose `accounts` is `"*"` needs the list of companies it holds instead. Until then the portal refuses to start, and names the entry. A company may be listed under one organisation only.
- `PORTAL_STAFF_DOMAINS` is ignored from this version on, and the portal says so at startup.
- After upgrading, sign in to check, and run `clearotron connect` again for each person whose assistant uses a key.

## 0.2.4

### Fixed

- A search that was planned and never run is disclosed on the report again, even when another search mentions the same word.
- Seven fixed sentences on the clearance report are now written for the person reading it.
- The demo now names the register its example run was captured against.
- The lines a client reads first are now checked for the profession's vocabulary and for sentences carrying more than one idea. The reviewing pass rewrites them before delivery. Nothing about the check is shown to the client, and no run fails over it. A report clearing a name like PREVAIL is unaffected, because the mark being cleared is never read as a legal term.
- The screen that will not start a search now gives advice that fits your machine.

## 0.2.3

### New

- A screening report now leads with the read. Each conflict shows its name, band, source and a one-sentence verdict. The paragraph arguing that verdict is one click away. Register filings appear as conflicts only where the reviewer rated them above the lowest band; the rest stay in the filings table.

### Fixed

- The configuration check no longer reports a problem when the client connector's address is reached with its own token. Putting a single sign-on front before it is the client's choice, and running it token-based is supported. The check still says the sign-in audience was not compared against that address, so it never implies the two agree.
- A bundled risk framework now states where it came from in words a customer can read. The note used to carry a confidentiality marking, a filename for a document not included, an internal reference number and revision history. It says whose framework it is, who stands behind it and which revision, and nothing else.
- A fresh install's brand-owner list now offers Generic and, with the demo, the demo account. It offered three of our test accounts as well, on the install route that clones the repository.
- A run record now says which version of the engine's command-line tool served it. A change in results can be traced to a tool upgrade rather than guessed at.
- The deployment check now says whether each scheduled job's timer is still armed. A timer-driven service reads "inactive" between runs and when its timer has been stopped. So a check that asked only about the service could report nothing wrong while the scheduled work had quietly stopped happening.
- A supplementary memo now succeeds on its first attempt. It cost two turns instead of one, and left a retried-stage mark on a report that had been delivered cleanly.
- Installing on a Node version the engine cannot run on now stops at once. It names the version you have, the version needed, and the command that fixes it. Before, the install finished and the first US register search failed with an error that never mentioned Node. The supported floor is Node 22.13 or newer.
- Setup now asks which address signs in, instead of turning it into an access rule covering everyone who shares its email domain.
- Five things a first-time reader could not act on.
- The New clearance screen now has a **Start a search** button. The button that ran a search used to say "Review clearance", and people could not tell it was the way to begin.
- The settings page no longer shows the engine as healthy when the engine program cannot be found.

### For operators

- Clearotron runs on Node 22.13 or newer again, down from 22.19, because its HTTP client moves back to version 7. Anyone who upgraded Node for the last release has nothing to undo.

## 0.2.2

### New

- An assistant on a clearance account can now answer "what if this were different" about a report already delivered. It writes a short memo reasoning over the evidence already gathered, instead of asking for a new search.
- A Knockout search now looks up what the owner of a registered right actually sells, and the report says where that answer came from. Before, the assessment inferred the owner's trade from the company name alone, then told you to go and obtain the registration's own goods list. The name is not evidence of the trade. It happened to read correctly on one search and would have read confidently wrong on the next.
- One engine process can now serve both people arriving through a tunnel and programs on the same machine holding an access key. It listens for the key on a local socket, which no tunnel can forward to, and the network door never accepts a key at all. Deployments that needed both used to run the process twice, on two ports, with two units to keep in step.
- A Knockout report now carries the whole assessment behind its ratings. You get the reviewer's notes and the reviewer's own opening read of each name. You also get the reasoning that holds a name at its rating, and what would move it. This was written during every search and reached only the audit workbook, so the report showed a rating without the thinking under it. The notes are marked as reference material rather than mixed into the findings.
- The tools that show how a search reached its answer now work on a Knockout search. You can ask what it found, what it looked at, where it searched and came back empty, and read the delivered report itself. Until now they returned nothing at all for a Knockout search, so anyone asking how one of these results was reached saw a blank record.

### Fixed

- The configuration audit now refuses when one of the files it reads is missing, instead of reporting that nothing sets the variables that file records. Its answer decides which settings look unused, so a file it could not read was being counted as a file with nothing in it.
- A scheduled deploy no longer updates the working copy while an experiment run is in progress. It now waits, as it already did for a clearance run.
- A client account asking about a mark in a knockout screen now receives the risk band, the reason for it and the findings behind it. It previously returned an empty answer.
- A knockout report no longer shows a register filing's risk band beside a line saying that filing carries no rating. The band shows when the reviewer gave one, and the line appears only when they did not.
- The unit inventory again records why every shipped unit that runs on no box is still shipped. One entry lost its reason when its name was superseded.
- Stopping the demo now stops everything it started, including when the stop signal reaches only the command you can see rather than the whole terminal.
- The architecture diagrams in the public documentation render with their intended colours again, and thirteen code comments state the colour they meant.
- The deployment check now reports the services a box is actually running. It had been asking systemd about unit names left behind by a rename, so a healthy box reported nothing running.
- The "your screen is done" notice for a knockout search now goes to the person who ordered it, with the operator kept as a copy. It previously went to the operator alone, whoever had asked for the search.
- The link in your completion email and message now opens the report. It previously pointed at a path the site does not serve, so it led to a sign-in and then a dead page. This affected every delivered report on both search products, in the email, the chat notice and the assistant's own answer. The workbook link in the same email was always correct and is unchanged.
- A live registration covering the goods you asked about is no longer left out of a report for want of room. It is reported, or the report says why it is distant.
- A what-if memo is now refused if it writes anywhere in the delivered run except its own memo folder, and the refusal names the file.
- A what-if question left queued when its run is archived now comes back with a reason, instead of never being answered.
- The delivery record now states plainly when a report's write-up length and ranking rules could not be checked against the delivered text. It says the rules were applied to nothing on that run. Before, this was recorded as an unlabelled failed check. It looked like any other, so a run could deliver with those rules unverified and nobody would see it.
- The deployment check now says which checkout a service is running from even when its unit file does not declare one.
- The demo and the install steps now start on native Windows, where they previously crashed on the first internal module they loaded.

### For operators

- Each run record now says whether the model id it observed was a pinned snapshot or an alias the provider can repoint.

## 0.3.0-beta.0

### New

- A Knockout report now carries the whole assessment behind its ratings. You get the reviewer's notes and the reviewer's own opening read of each name. You also get the reasoning that holds a name at its rating, and what would move it. This was written during every search and reached only the audit workbook, so the report showed a rating without the thinking under it. The notes are marked as reference material rather than mixed into the findings.
- The tools that show how a search reached its answer now work on a Knockout search. You can ask what it found, what it looked at, where it searched and came back empty, and read the delivered report itself. Until now they returned nothing at all for a Knockout search, so anyone asking how one of these results was reached saw a blank record.

### Fixed

- A live registration covering the goods you asked about is no longer left out of a report for want of room. It is reported, or the report says why it is distant.
- A what-if memo is now refused if it writes anywhere in the delivered run except its own memo folder, and the refusal names the file.
- A what-if question left queued when its run is archived now comes back with a reason, instead of never being answered.
- The delivery record now states plainly when a report's write-up length and ranking rules could not be checked against the delivered text. It says the rules were applied to nothing on that run. Before, this was recorded as an unlabelled failed check. It looked like any other, so a run could deliver with those rules unverified and nobody would see it.
- The deployment check now says which checkout a service is running from even when its unit file does not declare one.
- The demo and the install steps now start on native Windows, where they previously crashed on the first internal module they loaded.

### For operators

- Each run record now says whether the model id it observed was a pinned snapshot or an alias the provider can repoint.

## 0.2.1

### New

- `clearotron demo` now publishes all four example reports — one per product — instead of only the first.

### Fixed

- A report now keeps a mark the search confirmed, instead of dropping it because it was already noted on an internal working sheet. Where a mark is still missing, the run records it by name rather than closing the question.
- Asking a what-if question about a delivered report now returns a memo, instead of failing to find the run it was asked about.
- `doctor` no longer reports a working Cloudflare Access door as unprotected. An API-style door and a failing origin are now told apart, each with its own message. Neither is reported as a pass.
- the settings catalogue now lists `CLEAROTRON_CHECKOUT_DIR`, the path every service file points at. The installer still fills it in for you. It is written down so that anyone whose service will not start can look it up.

### For operators

- The `beta` channel now gets a release when there is something worth testing, days apart, instead of one on every merge.
- The configuration reference now explains the two deprecated search-log variables in full, instead of stopping mid-sentence.

## 0.2.1-beta.2

### Fixed

- `doctor` no longer reports a working Cloudflare Access door as unprotected. An API-style door and a failing origin are now told apart, each with its own message. Neither is reported as a pass.

## 0.2.1-beta.1

### Fixed

- the settings catalogue now lists `CLEAROTRON_CHECKOUT_DIR`, the path every service file points at. The installer still fills it in for you. It is written down so that anyone whose service will not start can look it up.

## 0.2.1-beta.0

### For operators

- The configuration reference now explains the two deprecated search-log variables in full, instead of stopping mid-sentence.

## 0.2.0

### New

- Two release channels. `npm install clearotron` stays on the tested release; `npm install clearotron@beta` follows every merge.

## 0.1.12

### For operators

- A release now publishes both the version waiting and the one it just prepared, so neither sits unpublished.

## 0.1.11

### Fixed

- A what-if on a delivered report now returns its memo. The previous release announced this before it worked; from this version it does.

### For operators

- On a box running the services, the check-up now reports what those services read rather than what the shell you typed in happens to carry.
- `npm install clearotron` gives you the tested release. `npm install clearotron@beta` gives you the newest, published within minutes of every merge.

## 0.1.10

### Fixed

- The check-up no longer reports that nobody can use the portal on an install where signing in works. It now reads the settings the running services load.
- Restarting no longer logs a warning saying searches will fail. The portal sometimes starts before the door it calls, and that clears itself within seconds.
- Stopping the product and starting it again now works. Before, the start refused because the assistant connection that stopping deliberately leaves running was still there.

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
