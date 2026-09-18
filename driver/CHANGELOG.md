# clearotron-driver

## 0.3.2-beta.10

### Patch Changes

- 98a57dd: Fixed: The README, quickstart and install guide now give one way to install, and their commands work as written.
- 98a57dd: Before you upgrade: security fixes now go to the current stable as a new stable, and to the current beta on a best-effort basis. Older versions receive none.
- 98a57dd: Fixed: In a source checkout without a built portal, `npx clearotron demo` stops and names the build command instead of opening a portal with no pages.
- 98a57dd: Fixed: The demo now removes its folder when you close it, as described. Pass --keep to keep the folder and its reports.
- 98a57dd: New: A report opened in the portal now follows the portal's light or dark theme, and changes with it straight away.

## 0.3.2-beta.9

### Patch Changes

- 09f51e0: Fixed: A country named in words now reaches its register, and naming one in words and by code no longer counts as two places.
- 09f51e0: Fixed: A search that failed can be picked up again with its codename alone. The command the engine prints when a search stops no longer names a job file that is no longer on the machine.
- 09f51e0: For operators: Resuming a failed search by its codename now works without the original job file, and refuses by name when the run's record is incomplete.
- 09f51e0: Fixed: A knockout report no longer scrolls sideways on a phone when a finding cites a long web address.
- 09f51e0: Fixed: a knockout report's Registers counted row reads "186 registers, on" the register service, without a list of territories folded under it.
- 09f51e0: New: A knockout search now delivers the engine's own assessment and findings alongside the report, as a full clearance already did.
- 09f51e0: Fixed: A report no longer says the local-language investigation did not run when the run's own record shows it did.
- 09f51e0: Fixed: On a phone, the rights-holder panel now shows a scrollbar when its rows run past the right edge.
  
  Fixed: "Web and marketplace names" lists names again. Readings of what a mark means are carried by the connotation section, where they were already stated in full.
- 09f51e0: Fixed: when a register reports only that it holds more than a figure, the knockout counts table and workbook show that figure, not "not available".
- 09f51e0: Fixed: Preliminary searches on one register now report the registered marks the assessment found, instead of a register section left empty.
  
  Fixed: A search whose register assessment cannot be recorded now stops with an error instead of delivering a report silent on the register.
- 09f51e0: Fixed: A report's section links now sit in the header and stay on screen while you read, instead of scrolling away.
- 09f51e0: Fixed: A report no longer reads "Case-law research could not be completed for ." when the search covered a register that does not publish per-country records.
- 09f51e0: New: A report states whether the local-language investigation ran at the depth configured for the matter.
- 09f51e0: Fixed: On a knockout report, the risk band marker no longer overlaps the words above it.
- 09f51e0: Fixed: A running search now reports the stage it is on, not the last one finished, so progress no longer appears to go backwards.
- 09f51e0: Fixed: A knockout report no longer states, for each name, whether that name should proceed to a full clearance search. It reports what the screen found.
- 09f51e0: New: A report table that continues past the right edge now shows a scrollbar, so it is clear there is more to see.
- 09f51e0: Fixed: When a register search did not finish, the verdict's condition no longer names the engine's internal label for the unfinished part.
- 09f51e0: New: a worldwide search names the register service that searches it, on the New clearance form and on the report's coverage line.
- 09f51e0: Fixed: Worldwide searches on a register that keeps no record archive now show how many register records were read and in which countries.
- 09f51e0: Fixed: Searches of a named company's own trademark portfolio now run on every register. On one register they were refused before the search was sent, and the report told the reader those holdings could not be reached.
- 09f51e0: Fixed: After upgrading, existing companies, past clearances and queued searches stay visible, with no folder to rename and no company file to edit.
  
  Fixed: A company file that cannot be read no longer empties the company list; that company is named with the reason instead.
- 09f51e0: Fixed: each finding's "Ask AI about this finding" button in a report now opens Ask AI, with that finding's number in the question.
- 09f51e0: New: Searches no longer look up ordinary English words one letter away from the mark that sound different, such as CODE beside CORE.
- 09f51e0: Before you upgrade: reports left waiting in the delivery folder's old name are found and sent again. Nothing needs moving, and none is sent twice.
- 09f51e0: Fixed: The forward-decisions section of a clearance report is headed "What happens next", as the approved design heads it.
- 09f51e0: New: A clearance report carries a section strip along the top, so a reader can jump to the findings, the next steps or what was searched.
- 09f51e0: New: The new clearance form now offers every country a supported register can search, not a fixed list of 37.
- 09f51e0: Fixed: The new clearance form no longer repeats in paragraphs what each product row and each place already say.
- 09f51e0: Fixed: on a phone, the list of clearances made the whole page slide sideways instead of scrolling the table. The table now scrolls on its own and the page stays put.
- 09f51e0: Fixed: on a narrow window the buttons at the end of each clearance row pushed the page sideways, and every date broke onto two lines. The buttons now fit the space they are given and the date stays on one line.
- 09f51e0: Before you upgrade: the folder a finished report waits in while it is sent has been renamed. If you have never set that folder yourself, nothing needs moving. Reports already waiting in the old folder are still sent.
- 09f51e0: Fixed: Knockout reports no longer print a caveat line under the register counts table.
- 09f51e0: New: A knockout report carries a section strip along the top, so a reader can jump to the conflicts, the filings or the next steps.
- 09f51e0: Fixed: A mark whose official record could not be retrieved is no longer listed as a condition on the verdict. The report still names it where the search's coverage is set out.
- 09f51e0: Fixed: Installs inside WSL now show a second setup command, for an assistant running inside WSL as well as one on Windows.
- 09f51e0: Fixed: a clearance report's "What was searched" section shows register totals, counts per country and a link to the audit workbook, as designed.

## 0.3.2-beta.8

### Patch Changes

- d194d41: Fixed: A knockout search now covers the territories the form is showing you, rather than searching the whole world instead of them.
  
  Fixed: A new clearance recommends and preselects a search when the form is showing your company's own territories. It previously offered none and said no search was picked, beside a summary naming those same countries.
- d194d41: Fixed: A report opened on a phone fits the screen instead of scrolling sideways.
- d194d41: Fixed: A knockout search that is running says it usually takes 5 to 10 minutes. It previously showed 1.5 to 2.5 hours, which is how long a full clearance takes.
- d194d41: Fixed: A running search says which step it is on, such as "Register sweeps", rather than "Register sweeps · 3 of 9". How many steps a search has varies with what it needs to do, so the number did not mean what it looked like.
- d194d41: New: Each search in your list now says which of the four searches it was.
- d194d41: Fixed: A new clearance now offers only the territories your register can search. Before, it offered countries your register cannot reach, and choosing one stopped the search from starting.
  
  Fixed: You can now remove one of your company's default territories on the clearance form. Before, if your register could not search one of them, nothing on that screen let you take it off and carry on.
- d194d41: Fixed: A report now gives the specific reason each name was set aside. Before, every such name carried the same general sentence, and the reason the search actually recorded for it was not shown.
- d194d41: Fixed: A search naming a territory your trademark register does not cover is now refused before it starts, and says which territory to remove. Before, the search ran and that territory was reported as not searched at the end.
- d194d41: New: Pay for Claude through your own Google Cloud, Microsoft Azure or Amazon Bedrock account with `CLEAROTRON_AI_BILLING=cloud`. Tested on Microsoft Azure; Google Cloud and Amazon Bedrock use the Claude program's own settings.
  
  New: Each run records which cloud account paid for it, and `clearotron doctor` names the cloud account it charges.
  
  New: Setup asks how Claude is paid for, and for a cloud account asks which cloud and checks it with one turn.
  
  New: `clearotron start`, when no billing is set, names a cloud account for Claude beside a subscription and an API key.
  
  New: `clearotron start --background` carries the cloud account's settings to the background services.
  
  New: `clearotron doctor` says how the background services pay, and warns when your own configuration sets a different way of paying.
  
  New: Global config's Engine row names the cloud account that pays, and turns red, naming the setting to change, when searches would be refused.
  
  Fixed: An install that pays with an API key and runs as background services now hands the services its key. Before, every search stopped after it was ordered.
  
  Fixed: A subscription install signed in with a long-lived token from `claude setup-token` now hands that token to its background services.
  
  Fixed: `clearotron start` now reports a billing setting that would stop every search, such as an API key that is not set. `clearotron doctor` also checks the settings the background services read.
  
  For operators: `clearotron start --background` names each setting on which `~/.env` and Clearotron's settings disagree, such as a rotated key, without printing values. It adds only settings `~/.env` lacks and never replaces one, so change a setting in both files.
  
  Before you upgrade: A billing setting Clearotron does not recognise now stops a search before it starts, where it used to bill the subscription. Run `clearotron doctor` after upgrading.
  
  Before you upgrade: On a Claude install, a cloud's own switch left on, such as `CLAUDE_CODE_USE_FOUNDRY`, now stops a search unless `CLEAROTRON_AI_BILLING=cloud`.
- d194d41: Fixed: Connect your AI now sits last in the sidebar, under Company settings. It used to sit second, directly under Home.
- d194d41: Fixed: `clearotron doctor` and `clearotron start --background` look for Claude Code or the Codex CLI on the PATH the background services use. They used to say every search would be refused on a machine whose searches found the program and ran.
- d194d41: Fixed: When a background service's unit and its settings file set the same value, `clearotron doctor` and `clearotron connect` take the file's, as systemd does.
  
  Fixed: `clearotron doctor` and `clearotron connect` read a doubled percent sign (`%%`) in a background service's unit as one, as systemd does.
- d194d41: Fixed: When the background services found the reasoning program and this machine cannot, `clearotron doctor` now suggests installing it here with setup. It used to suggest installing it where the services could already see it.
  
  New: If a restart does not help the background services find the reasoning program, `clearotron doctor` says how to point them at it.
- d194d41: New: `clearotron doctor --probe-engine` tries Claude with the cloud settings in Clearotron's settings file, the Amazon keys included, as a search does.
- d194d41: Fixed: A search on a short or common word could return so many unrelated marks that one query filled most of the results. Any single query now contributes at most a fixed number of records. Anything beyond that is reported as a crowd, with its full count, rather than left out silently.
- d194d41: Fixed: A report made before this summer, reopened today, states its conditions in the same words as a new one.
- d194d41: New: The sign-in command from setup, `clearotron doctor` and a starting search names the copy setup installed, which is not on the PATH.
- d194d41: New: Setup's test turn tries Claude with the cloud settings in Clearotron's settings file, the Amazon keys included, as a search does.
- 6c7c7f1: For operators: the offline test suite runs in four parallel shards, so a change is checked in about a quarter of the time it used to take.
- d194d41: Fixed: A search covering a very large number of register records could finish with no findings document at all. Those records are now accounted for in fixed batches instead of all at once. An interrupted attempt resumes from the records still outstanding, rather than starting again.
- d194d41: New: A knockout report has an Export button, so anyone who opens the file can save it as a PDF.
- d194d41: New: Claude steps run on the newest Opus and Sonnet as soon as they ship, unless a setting holds a tier at one model.
- d194d41: New: Setup offers to install the reasoning program your engine uses. Before it asks, it says how much space the program takes and how to remove it.
  
  New: Setup asks which AI should run your searches, Claude or Codex, and says what it found on this computer.
  
  New: Claude Code or the Codex CLI already on the machine is still used first. `clearotron update` keeps the installed one current, and `clearotron doctor` says which copy runs, and its version when the program reports one.
  
  New: Outside Windows, in demo mode, `clearotron doctor` points to setup to install the reasoning program.
  
  New: When the reasoning program cannot be found, Global config's Engine row and the search screen name the setup command that installs it.
- d194d41: New: Each report names the models that did the work, including those behind the Chinese, Japanese and Korean language steps.
  
  New: Through a cloud account, a report names the Claude model or its tier, never your organisation's own name for its deployment.
- d194d41: New: When a cloud account refuses the credentials, setup, `clearotron doctor` and a starting search name that cloud and the settings to check.
  
  Fixed: When an API key is refused, setup, `clearotron doctor` and a starting search name the key to check, rather than asking for a sign-in.
- d194d41: Fixed: When you have used all of today's searches, the screen names the person to ask for another. On an installation with no name set it read "ask your the operator contact to run this one for you".
- d194d41: Fixed: A report's verdict now lists every condition it is conditional on. It used to name the first and close with "(and 2 more)". The rest sat in a separate list below it, so a reader could see that conditions existed without reading them.

## 0.3.2-beta.7

### Patch Changes

- 4bde529: Fixed: A clearance that completed all but one or two of its local-language searches now delivers the report. Before, a single search that did not complete threw the whole clearance away, including the fifty-nine that had run. The report says which term's search was short.
- b5b789c: Fixed: The exported PDF no longer prints a collapsed arrow above sections that are already fully open.

## 0.3.2-beta.6

### Patch Changes

- 911b0b4: New: The report a client opens has been redrawn. It opens with what was asked, then the rating with its reasons, then the conflicts. What a search is and is not is no longer narrated at length.
  
  New: A finding's full detail shows the goods as the register recorded them, and the record's own dates. This is on a full country search.
  
  New: A knockout report closes with what happens next. The paragraph moves out of the long read rather than being repeated.

## 0.3.2-beta.5

### Patch Changes

- a4ea94d: For operators: The connector access log now records what happened to each call, and records calls that were refused as well as calls that got through. A line also names which door took the call, so a client key and a staff session can be told apart. Before, a call was recorded only as having been made, and a refused one left no line at all. `doctor` now names where that log is being written. It reads that from the service's own settings, not from the shell you are typing in.

## 0.3.2-beta.4

### Patch Changes

- 3f4367e: Fixed: A multi-country search no longer refuses to start on a form that is already showing the territories it will search. When you have not chosen territories yourself, the form shows your company's own and the search uses those.
  
  Fixed: A new clearance form now opens with one line saying what to do. It no longer shows two warning panels about work you have not started.
- 3f4367e: Fixed: On a phone, the list of clearances can now be scrolled sideways to read its columns. Before, the risk word was printed on top of the date and names broke in the middle of a word.

## 0.3.2-beta.3

### Patch Changes

- cc56786: New: an installation can name its administrator contact, a mail or web address, and Preferences links "Clearotron administrator" to it.
  
  New: Preferences carries the top bar's blur button, and the blur now stays as you left it in this browser, reloads included.
  
  New: Global config is now Installation settings, with one sign-in row, the engine's own web search under Engine, and providers grouped by category.
  
  New: a provider needing action says what it needs in a few words and links its setup guide, instead of naming settings and files.
  
  New: About lists its facts in one card, and its source link reads as the repository's name, with the build just above.
  
  New: the sign-in page leads with one line, "This Clearotron signs in one person: you.", and keeps the reset and sign-on steps under Administrator help.
- cc56786: New: a report's header labels both of its dates, searched and issued, with Ask AI and Export beside them as two buttons.
  
  New: Ask AI on a report offers four questions, and opens Claude with the one you pick typed in, ready for you to send.
  
  New: Use your AI is now Connect your AI, and shows whether your assistant is connected, folding the setup steps away once it is.
  
  New: after Set it up on a report's Ask AI, Connect your AI offers a button back to that report once your assistant connects.
  
  Fixed: Claude's steps no longer tell you to ignore an authentication warning, and copy the address and the key with separate buttons.
  
  New: where your installation offers another way to connect, Connect your AI keeps those steps in a closed fold under the sign-in steps.

## 0.3.2-beta.2

### Patch Changes

- 8642064: Fixed: On one register the "Filings containing the name" figure counted only identical filings. A report could therefore show a field as far less crowded than it really is. That column now asks the register the question its label promises. Where a register cannot answer a given kind of search, the figure is reported as unavailable rather than filled in from a narrower one.

## 0.3.2-beta.1

### Patch Changes

- 2a81abc: New: A report can now show how much was searched to reach its answer. It records the names read and cleared, the records read in each country, and the checks made. Countries where nothing was found are included.
- 2a81abc: Fixed: The conditions listed on a report are now written in plain legal English, matching the summary line above them. One condition could previously appear as an internal engine note with counts and identifiers in it.

## 0.3.2-beta.0

### Patch Changes

- 7cc0d29: Fixed: A report now lists every part of the search that was left open. One with a short name could be hidden by another line that happened to mention the same word. The overall result was never affected, only the list of what remained open.

## 0.3.1

### Patch Changes

- 240673c: Fixed: A chat notice now carries the channel to send it on, so an assistant with several chat channels no longer drops it silently.
- a2c4b94: Fixed: A correction to a coverage note or an action is now applied, or the run records why it was not.
- 240673c: Fixed: Naming a country in words rather than by code now works for every country, including Belgium and Luxembourg. Before, some were carried as unrecognised.
- b320c65: Fixed: A demo sample that cannot be read is named in the demo's output, and the other demos still publish.
- 240673c: Fixed: A family search on a name whose first or last word is a single letter or digit now runs. Before, one register refused it and the search was reported as an outage.
  
  Fixed: A conflict whose owner could not be identified is no longer given a risk rating. It is carried as an open item naming who must be identified.
- d0d42f7: Fixed: A name in a knockout batch is no longer rated above every conflict found against it. Its rating now follows from the conflicts on its own page.
  
  Fixed: Before, a rule forced any name made of everyday words off the lowest band, whatever the search found. That rule is gone for every client.
- f96c089: Fixed: Running the test suite from inside another test run no longer lets the outer run delete the inner run's temporary files.
- f96c089: Fixed: A clearance for a new client can be ordered through an assistant connector without setting up a company first.
- 240673c: Fixed: In the staff editor, a refused territory in a project now highlights the field it is about, as it already did when editing a customer. Before, the message appeared but no field was marked.
- 240673c: Fixed: A sign-in refusal now always says which instance answered — by organisation, by sign-in service, or by the address it runs on.
- 240673c: Fixed: The published list of settings this build reads no longer keeps a name after the code stops reading it. The list was derived from a scan that included the list itself, so a retired name kept itself alive.
- c3228f3: Fixed: A clearance that stops is recorded as owing a notice even when the folder its notice is queued in cannot be written to.
- d9798db: Fixed: A clearance that stops now always records that its notice is still owed, so a failure cannot be passed over as already handled.
- 240673c: Fixed: A search step that streams at a crawl is now stopped early and retried, instead of running to its time limit and losing the work.
- 56a760f: Fixed: Giving somebody access to everything on the installation now works from the access form. It used to refuse. The message it refused with said you can only give access to what you hold yourself, which was not true of the person seeing it.
- ae2cc82: For operators: An assistant asking which searches still owe someone a notice now gets all of them, not just the fifty most recent. Asking for recent searches is unchanged.
- f96c089: Fixed: A mark whose main element contains no vowel — a consonant-only initialism, for example — can now be cleared. Before, the search plan refused to compile and the whole clearance ended without delivering anything.
- 8c3bc3b: New: Ask AI on a report now opens Claude or ChatGPT with a question about that report already typed in. One press, in a new tab, and nothing is sent until you send it.
  
  The button used to hand over a connector address and a question carrying the run's internal code, with no indication of which one you needed. The address belongs on the Use your own AI page, where you set the connector up once. It is no longer shown on reports at all.
  
  If you have not connected an assistant yet, the button explains that in a line and offers to take you there.
  
  For operators: the report's own "Ask your AI" band is gone, so there is one Ask AI control rather than two. Reports rendered before this upgrade keep the band in their own file, and it is hidden when the portal serves them.
- c3228f3: Fixed: Check now reports the same problems Save would refuse, so a company setting can no longer pass the check and then fail to save.
- 240673c: Fixed: Use your AI now gives the steps your connector actually takes — sign-in where it signs you in, a key only where a key works.
- f96c089: Fixed: `doctor` now names the deployment it is checking, and refuses a name that is missing or not recognised. Before, a deployment that was misnamed — or not named at all — passed the check in silence.
- 240673c: Fixed: Setup and the framed first-run box now say what to do when the page that opens belongs to another program.
  
  Fixed: The port that advice suggests is never the port already in use.
- 6d0c8f5: Fixed: The portal now tells your browser not to store the data its screens read. Those responses carry people's names, company access and run lists, and nothing previously said how long a browser could keep them.
  
  For operators: every JSON response from the portal now sends `Cache-Control: no-store` and `Vary: Accept`. A route that sets a stricter policy of its own keeps it.
- f96c089: For operators: The repository's own comment-to-code references are now checked for having moved, not only for existing.
- c3228f3: Fixed: On older Windows-Subsystem installations the engine now identifies the platform by its interop registration rather than by the kernel version string.
- 240673c: Fixed: On WSL, the "on this computer" rows now start the server inside WSL for you, so an assistant running on Windows can use them.
- 56a760f: Fixed: `clearotron grant remove --tenant` now refuses when the person has access to everything on the installation. It used to remove the organisation and then warn that nothing they could see had changed.
  
  Fixed: Removing somebody whose address is spelled with different capitalisation in different parts of the access file now removes all of them. Half of the entry used to survive, and the command reported success.
- 56a760f: New: Access can now be narrowed and taken away, not only added to. Somebody who manages one organisation removes that organisation alone. Somebody who can see all of a person removes their access to the installation, and withdraws the keys their AI assistant was using.
  
  Fixed: A removal now says plainly when the connector cannot be told about it yet, instead of implying the assistant lost access too.
- 240673c: Fixed: Somebody you add on the People page can sign in straight away. Before, they were refused until the service restarted with a changed setting.
- e390417: For operators: The portal's start-up check now says when its engine address is behind a sign-in it cannot pass, instead of reporting that address as reachable.
- 240673c: Fixed: The demo now removes everything it created when its window closes, and says so. Pass `--keep` to leave the folder and its reports.
  
  Fixed: Trying the demo a second time on a machine that has run it before now works. Before, it refused its own folder and suggested dropping a flag that had not been given.
- 240673c: Fixed: The demo opens ports of its own rather than the ones an installation uses, so the page it points you at is the demo's.
- 240673c: Fixed: A search now covers every spelling and sound-alike of the name in each category of goods or services the engine judges relevant.
  
  Fixed: Before, the added categories were searched for the name exactly and nothing else. The matter frame records each one with the reason it was added.
- 240673c: Fixed: An off-register search now also covers the channels the matter itself names, not only the account's usual marketplaces.
  
  Fixed: A channel no pass ran is now recorded as open rather than described in a note.
  
  Fixed: A finding reads what the platform's own record says before calling an owner unidentified.
- 240673c: For operators: The portal can now call the engine over a local socket instead of a network port, by naming it as its engine address. The deployment check reports that address as wired and says which socket it is.
- f96c089: Fixed: The run purge no longer deletes a clearance whose report or failure notice has not been sent yet.
  
  Fixed: Those runs are marked in the table the purge prints, and removing one now takes a flag that says so.
  
  For operators: Every applied purge leaves a record of what it removed, when, and whether any of it was still owed.
- 1905ea4: Fixed: Saving a territory the engine cannot search now says so, instead of suggesting the kind of entry that was just refused.
- f1c5925: Fixed: Where a search covers two ratified forms of a name, the report now reasons each form and says which conflicts differ between them.
  
  Fixed: Before, both forms were searched but one combined read came back. When the forms read alike the report now says so, rather than leaving it unsaid.

## 0.3.1-beta.4

### Patch Changes

- 6d0c8f5: Fixed: The portal now tells your browser not to store the data its screens read. Those responses carry people's names, company access and run lists, and nothing previously said how long a browser could keep them.
  
  For operators: every JSON response from the portal now sends `Cache-Control: no-store` and `Vary: Accept`. A route that sets a stricter policy of its own keeps it.

## 0.3.1-beta.3

### Patch Changes

- d0d42f7: Fixed: A name in a knockout batch is no longer rated above every conflict found against it. Its rating now follows from the conflicts on its own page.
  
  Fixed: Before, a rule forced any name made of everyday words off the lowest band, whatever the search found. That rule is gone for every client.
- 56a760f: Fixed: Giving somebody access to everything on the installation now works from the access form. It used to refuse. The message it refused with said you can only give access to what you hold yourself, which was not true of the person seeing it.
- 8c3bc3b: New: Ask AI on a report now opens Claude or ChatGPT with a question about that report already typed in. One press, in a new tab, and nothing is sent until you send it.
  
  The button used to hand over a connector address and a question carrying the run's internal code, with no indication of which one you needed. The address belongs on the Use your own AI page, where you set the connector up once. It is no longer shown on reports at all.
  
  If you have not connected an assistant yet, the button explains that in a line and offers to take you there.
  
  For operators: the report's own "Ask your AI" band is gone, so there is one Ask AI control rather than two. Reports rendered before this upgrade keep the band in their own file, and it is hidden when the portal serves them.
- 56a760f: Fixed: `clearotron grant remove --tenant` now refuses when the person has access to everything on the installation. It used to remove the organisation and then warn that nothing they could see had changed.
  
  Fixed: Removing somebody whose address is spelled with different capitalisation in different parts of the access file now removes all of them. Half of the entry used to survive, and the command reported success.
- 56a760f: New: Access can now be narrowed and taken away, not only added to. Somebody who manages one organisation removes that organisation alone. Somebody who can see all of a person removes their access to the installation, and withdraws the keys their AI assistant was using.
  
  Fixed: A removal now says plainly when the connector cannot be told about it yet, instead of implying the assistant lost access too.
- f1c5925: Fixed: Where a search covers two ratified forms of a name, the report now reasons each form and says which conflicts differ between them.
  
  Fixed: Before, both forms were searched but one combined read came back. When the forms read alike the report now says so, rather than leaving it unsaid.

## 0.3.1-beta.2

### Patch Changes

- 240673c: Fixed: A chat notice now carries the channel to send it on, so an assistant with several chat channels no longer drops it silently.
- 240673c: Fixed: Naming a country in words rather than by code now works for every country, including Belgium and Luxembourg. Before, some were carried as unrecognised.
- 240673c: Fixed: A family search on a name whose first or last word is a single letter or digit now runs. Before, one register refused it and the search was reported as an outage.
  
  Fixed: A conflict whose owner could not be identified is no longer given a risk rating. It is carried as an open item naming who must be identified.
- f96c089: Fixed: Running the test suite from inside another test run no longer lets the outer run delete the inner run's temporary files.
- f96c089: Fixed: A clearance for a new client can be ordered through an assistant connector without setting up a company first.
- 240673c: Fixed: In the staff editor, a refused territory in a project now highlights the field it is about, as it already did when editing a customer. Before, the message appeared but no field was marked.
- 240673c: Fixed: A sign-in refusal now always says which instance answered — by organisation, by sign-in service, or by the address it runs on.
- 240673c: Fixed: The published list of settings this build reads no longer keeps a name after the code stops reading it. The list was derived from a scan that included the list itself, so a retired name kept itself alive.
- 240673c: Fixed: A search step that streams at a crawl is now stopped early and retried, instead of running to its time limit and losing the work.
- f96c089: Fixed: A mark whose main element contains no vowel — a consonant-only initialism, for example — can now be cleared. Before, the search plan refused to compile and the whole clearance ended without delivering anything.
- 240673c: Fixed: Use your AI now gives the steps your connector actually takes — sign-in where it signs you in, a key only where a key works.
- f96c089: Fixed: `doctor` now names the deployment it is checking, and refuses a name that is missing or not recognised. Before, a deployment that was misnamed — or not named at all — passed the check in silence.
- 240673c: Fixed: Setup and the framed first-run box now say what to do when the page that opens belongs to another program.
  
  Fixed: The port that advice suggests is never the port already in use.
- f96c089: For operators: The repository's own comment-to-code references are now checked for having moved, not only for existing.
- 240673c: Fixed: On WSL, the "on this computer" rows now start the server inside WSL for you, so an assistant running on Windows can use them.
- 240673c: Fixed: Somebody you add on the People page can sign in straight away. Before, they were refused until the service restarted with a changed setting.
- 240673c: Fixed: The demo now removes everything it created when its window closes, and says so. Pass `--keep` to leave the folder and its reports.
  
  Fixed: Trying the demo a second time on a machine that has run it before now works. Before, it refused its own folder and suggested dropping a flag that had not been given.
- 240673c: Fixed: The demo opens ports of its own rather than the ones an installation uses, so the page it points you at is the demo's.
- 240673c: Fixed: A search now covers every spelling and sound-alike of the name in each category of goods or services the engine judges relevant.
  
  Fixed: Before, the added categories were searched for the name exactly and nothing else. The matter frame records each one with the reason it was added.
- 240673c: Fixed: An off-register search now also covers the channels the matter itself names, not only the account's usual marketplaces.
  
  Fixed: A channel no pass ran is now recorded as open rather than described in a note.
  
  Fixed: A finding reads what the platform's own record says before calling an owner unidentified.
- 240673c: For operators: The portal can now call the engine over a local socket instead of a network port, by naming it as its engine address. The deployment check reports that address as wired and says which socket it is.
- f96c089: Fixed: The run purge no longer deletes a clearance whose report or failure notice has not been sent yet.
  
  Fixed: Those runs are marked in the table the purge prints, and removing one now takes a flag that says so.
  
  For operators: Every applied purge leaves a record of what it removed, when, and whether any of it was still owed.
- 1905ea4: Fixed: Saving a territory the engine cannot search now says so, instead of suggesting the kind of entry that was just refused.

## 0.3.1-beta.1

### Patch Changes

- c3228f3: Fixed: A clearance that stops is recorded as owing a notice even when the folder its notice is queued in cannot be written to.
- c3228f3: Fixed: Check now reports the same problems Save would refuse, so a company setting can no longer pass the check and then fail to save.
- c3228f3: Fixed: On older Windows-Subsystem installations the engine now identifies the platform by its interop registration rather than by the kernel version string.

## 0.3.1-beta.0

### Patch Changes

- a2c4b94: Fixed: A correction to a coverage note or an action is now applied, or the run records why it was not.
- b320c65: Fixed: A demo sample that cannot be read is named in the demo's output, and the other demos still publish.
- d9798db: Fixed: A clearance that stops now always records that its notice is still owed, so a failure cannot be passed over as already handled.
- ae2cc82: For operators: an assistant asking which searches still owe someone a notice now gets all of them, not just the fifty most recent. Asking for recent searches is unchanged.
- e390417: For operators: The portal's start-up check now says when its engine address is behind a sign-in it cannot pass, instead of reporting that address as reachable.

## 0.3.0

### Minor Changes

- d2afa5e: Before you upgrade: Name every person who uses your installation in the file that lists who may sign in, or the portal will not start. That file is in your install folder.
- d2afa5e: New: Switch between companies from any screen, and set a new one up in the browser.
- d2afa5e: New: Add people from the portal, and give each the right to run clearances, to manage people and companies, or both.
- d2afa5e: New: Every register finding in a report links to the trade mark office's own page for that record.
- d2afa5e: New: A clearance records any territory it could not cover, so a partial search never reads as a complete one.
- d2afa5e: New: Connect Clearotron to your own AI assistant — Claude Code, Codex, or ChatGPT — on your computer or a shared server.
- d2afa5e: New: A saved search is available in every company, in the portal and in your AI assistant.
- d2afa5e: New: Check a risk framework for errors before it rates a clearance, and point a company at its own.
- d2afa5e: New: Group companies under an organisation, each with its own daily limit on clearances.
- d2afa5e: New: Clearotron installs to a fixed location, so the commands it prints and your AI assistant's connection keep working.
- d2afa5e: New: `clearotron update` moves an installation, beta included, to the current release.

### Patch Changes

- d2afa5e: Fixed: You sign in, open your companies, and run your first clearance on a new installation.
- d2afa5e: Fixed: The demo reads and writes only its own companies, reports, and saved searches.
- d2afa5e: Fixed: `clearotron doctor` checks what a clearance needs, so an installation it clears can run one.
- d2afa5e: Fixed: A key you paste at a yes-or-no question stays off the screen and out of your command history.
- d2afa5e: Fixed: Clearotron stays signed in to a paid Codex plan when Codex renews the sign-in.
- d2afa5e: Fixed: The dashboard shows only the chosen company's clearances, and keeps the filters on screen.
- d2afa5e: Fixed: The Stop button ends a run before its report goes out, and its dialog says what stopping does.
- d2afa5e: Fixed: A knockout report names the filings behind each finding, and marks the reviewer's notes as reference.

## 0.3.0-beta.10

### Patch Changes

- fd3a4f7: Fixed: A portal address that does not exist now says so wherever it is. Addresses under the admin path used to show the Global config screen.
- fd3a4f7: New: The install guide now says how to remove Clearotron, naming every path it writes and which one holds your reports.

## 0.3.0-beta.9

### Patch Changes

- 86061f4: Fixed: Commands printed while running from npx name the published version, so they still work after npm cleans its cache.
- ab9dc2d: Fixed: When the engine cannot answer "Describe it", the page names the check that finds out why. It says "just now" only for a usage limit.
- ab9dc2d: Fixed: `clearotron status` says whether a product started in a terminal is up, and on which addresses. `clearotron stop` says how to stop it.
- ab9dc2d: Fixed: The demo no longer offers `start --background`, which set up an empty install in your home instead of running the demo.
- ab9dc2d: Fixed: The key command the demo prints issues a key the demo's client door accepts, run exactly as printed.

## 0.3.0-beta.8

### Patch Changes

- 9181d6a: Fixed: Commands the install, start and the New company screen print now run as printed, from any directory and after npm cleans its cache.
- 0d75b4a: Fixed: A demo started with npx prints commands that keep working after npm cleans its cache.
- 9181d6a: Fixed: Doctor, run before the first start, describes the local sign-in that start brings up, and drops checkout-only warnings on a packaged install.
- 91888b2: Fixed: The package no longer names the hosted service's own hostnames; a deployment names its own.
- 9181d6a: Fixed: The README installs with `npx clearotron install`, which needs no root, and no longer says the demo opens a browser.

## 0.3.0-beta.7

### Patch Changes

- c5744bf: Fixed: A demo started with npx keeps its assistant connection working after npm cleans its cache.
- c5744bf: Fixed: An assistant connected to the demo now opens each sample report on the demo's own portal, not on another server.
- c5744bf: Fixed: The portal names the organisation setup recorded, and the product keeps its own name beside it.

## 0.3.0-beta.6

### Patch Changes

- 2ca849d: Fixed: When codex's sign-in can no longer be refreshed, the search stops and says to run `codex login`. It used to retry with a bare exit code.
- a81279f: Fixed: When the portal address opens someone else's page, for example a port forwarded from outside WSL, Clearotron now says so and points you to `--port`.
- a81279f: Fixed: The sign-in page clears a session left by another Clearotron on the same address and says so. A refusal that is not about the passphrase now says what it is about.
- f133f7d: Fixed: A passphrase pasted with a space or line break at either end now signs in, instead of being refused as wrong.
- 2ca849d: Fixed: A manager who does not run the installation no longer sees server file paths when a new company cannot be recorded or filed.
- a81279f: Fixed: The local sign-in page no longer invites the browser to fill in a saved password from another install.
- a81279f: Fixed: `npx clearotron install` now installs Clearotron permanently under `~/.local` before setting up. The `clearotron` command and your assistants' connections keep working after npm cleans its cache.
- 2ca849d: Fixed: When the saved-search store exists but cannot be read, the connector and `clearotron doctor` now say so, instead of reporting no saved searches.
- a81279f: Fixed: On WSL, the "on this computer" connect steps now say to run them inside WSL. The Claude Code line registers Clearotron for every project and works in Windows PowerShell.
- a81279f: New: An assistant connected to `clearotron demo` can now list, brief and open the demo's four sample runs. They stay inside the demo's own folder.
- a81279f: Fixed: The sign-in page's reset line now runs for a demo started with npx, and resets that demo's own passphrase.
- a81279f: New: `clearotron update` now updates an npm-installed copy itself, and a beta install moves on to the release once it is published.

## 0.3.0-beta.5

### Patch Changes

- 5f7e295: Fixed: A Clearotron install signed in to OpenAI's `codex` with a subscription keeps working after codex refreshes its login. Before, every search after the first refresh failed within seconds until you signed in again.
- 2878809: Fixed: When the company store cannot record a new company, the New company page now says why and what fixes it, instead of "Try again shortly". Someone who does not run the installation is told to ask whoever does.
- e7cd9e1: Fixed: On an install run with `clearotron start`, a connected assistant now lists the same saved searches as the portal, including Generic's. `clearotron doctor` no longer says working saved searches are off, and it names one place profiles come from.
- e7cd9e1: Fixed: When setup offers to try your engine, it no longer names an Anthropic model to someone who chose OpenAI's `codex`.

## 0.3.0-beta.4

### Minor Changes

- a9f5375: New: Use your own AI asks first where Clearotron is running, then shows the steps for your app beside the list. The same five apps are offered either way.
  
  New: Claude Code and Codex can connect to an installation running elsewhere, and the ChatGPT desktop app to one on the same machine.
  
  Fixed: Codex was told to paste a settings block into a terminal. Its steps now name the file the block goes in.
  
  For operators: `clearotron connect` and `clearotron disconnect` take `--where here` or `--where elsewhere`. Assistant names used before, such as `cowork`, still work.

### Patch Changes

- a9f5375: New: the company switcher in the sidebar ends with `+ New company`. Making a company is now one click from every screen, whether or not a company is selected.

## 0.3.0-beta.3

### Patch Changes

- a782aad: Fixed: Creating a company is refused, with nothing left behind, when the configuration store cannot record it. The company used to be created anyway, with no record of who made it or when, and its organisation was given access to it.
  
  A store with no git identity is the usual cause on a new machine, and the refusal names the command that fixes it. Setup and `clearotron start` now check a store they adopt for this straight away.
- d1ef225: Fixed: A search step stopped at its time limit now records the output it actually produced. It used to record a small fraction, so a step that was working read as one that had stalled.
  
  The token totals `clearotron tokens` reports for runs with a stopped step now include that output.
- 0ff42d1: Fixed: `clearotron doctor` now says when saved searches are switched off and why, and when a saved search file cannot be read.
  
  An assistant asking for saved searches is told when they could not be read, instead of being told there are none.
- a782aad: Fixed: `clearotron doctor` reports the register and the research key the background services will use, read from the file they read. Run from a new terminal, it used to say no register was selected on an install whose searches were running.
- 0ff42d1: Fixed: Global config appears in the account menu only for people who can open it. Someone managing one organisation used to be offered it, and the page then said it was not available.
  
  Clearances and People no longer ask for installation-wide data that a manager of one organisation cannot see.
- a782aad: Fixed: A clearance or knockout searched through Compumark now links each register record to the trade mark office's own page for it. Those records used to show an internal reference nobody could open.
  
  The offices linked are the United States, the European Union, the United Kingdom, Canada, Australia, Switzerland, France, Norway, Sweden and WIPO. A record from any other office is cited by its number, and the report says why once, under the findings.
- a782aad: Fixed: Saved searches work on a fresh install and in the demo, for every company, Generic included. They used to fail to load for every company, with a message saying to try again shortly.

## 0.3.0-beta.2

### Minor Changes

- cdc7c84: New: `clearotron brandowner framework <key> <path>` points an existing company at a risk framework.
  
  Which framework rates a company's matters is set on the command line. Until now the only verb there was `add`, which creates a company. A company made in the browser could not be pointed at its own rubric at all.
  
  New: The framework's deck is checked before anything is written. A path that does not resolve, or a manifest that will not load, is refused. The company is left exactly as it was.

### Patch Changes

- c7c96f3: Fixed: A key pasted at a yes-or-no question in setup is never shown on screen. Where the question leads to a key, a token or a credential, setup takes what was pasted as the answer. It does not ask for it again.
  
  While setup waits for a yes or no, it shows only what you type toward one. Anything else stays off the screen, so a pasted key never reaches the terminal's history.
  
  Fixed: The up-arrow at a later question in setup no longer brings back a key, a token or a password typed earlier. Setup keeps no history of its answers.
- 184fbc8: Fixed: A knockout searched on Signa now shows each filing's owner, classes and filing date. Before, those cells were blank on every filing.
  
  Fixed: Each filing in a Signa knockout that carries its office's number now links to the trade mark office's own page for that record. Where it cannot be linked, the report gives the office and the number, and says once why. A filing without a number shows as before. The audit workbook carries the same link or number.
- 5851a16: Fixed: A knockout no longer refuses a finding that names the register filings it rests on. Before, the assessment was refused and retried, and the delivered findings lost the labels that say where each one came from.
- 4585112: Fixed: A new install signs in with a passphrase of its own, and its first start prints it. This holds even on a machine where an earlier install left a sign-in behind.
  
  Each new install keeps its sign-in inside its own directory, `~/trademark/` by default. An install that already signs in with the shared one under `~/.cordillera/` keeps using it, so no passphrase stops working when you upgrade.
  
  Fixed: When a start does not print the passphrase, its first line now says how to get a new one: `clearotron passphrase --reset`. It also says which sign-in file it is using, when that file was created, and for which address.
  
  Fixed: The demo always gives you a passphrase that works. Each demo start makes a new one and prints it, instead of reusing one an earlier demo left behind.
  
  Fixed: A new install can open its companies' profiles. If its configuration folder overrides no instruction files, the portal no longer answers with an error. Nor does it warn that risk frameworks might be synthetic. Setup also creates the `skills` folder its closing screen tells you to use.
  
  Fixed: A search refused because the install is not fully configured now names the settings file `clearotron start` read. It no longer names a file that does not exist on that machine.
- b45a5cf: New: A screening report's summary, basis lines and conflict sentences now read in plain language.
  
  Long sentences are split and the profession's shorthand is replaced with the everyday word. No rating, name or reason is changed.
- b45a5cf: Fixed: An audit workbook no longer reports every register finding as missing its link when the register publishes no page per record.
  
  The registration number and the office are the citation in that case. A finding that carries neither is called out instead.
  
  Fixed: A search now records any of your default territories that the engine cannot search, in the record of that search. A mistyped default no longer narrows a search silently.
- eacfce4: Fixed: An assistant connected to a local install now sees the saved searches the portal shows, and can plan a run from one of them. Before, outside the demo, only the portal was told where saved searches are kept, so an assistant was told the install had none.
- 34cc1c7: For operators: A deployment health check that could not finish now fails instead of reporting success. Two parts of the service check could skip themselves. One skipped when the installation did not say which installation it is; the other when the scan of the service files did not finish. Both used to note that they had not run and then pass.
  
  For operators: Set `CLEAROTRON_BOX` to `prod` or `test`. Those are the only two values the check accepts; anything else, including any other name, reads as unnamed and fails. The failure names the setting and says what went unchecked.
  
  For operators: The part that could skip itself is the one that notices a service that has stopped and stayed stopped. The other part lists what is running, so it cannot see something that is no longer there. While the first part is skipped, a service can disappear without the check saying anything.
- b45a5cf: Fixed: `clearotron doctor` now reports everything a search would be refused for, checked against the environment the search will run in. So an installation it passes is one that can run a search.
  
  Fixed: A token set in the installation's own configuration file now reaches the engine check. A headless server set up the documented way proves its engine instead of reporting it signed out.
  
  Fixed: When a search is refused because the installation is not configured, the message names every configuration file that reaches the run.
  
  Fixed: The signed-out message now offers a sign-in route for a machine with no browser.
- 332967f: For operators: `clearotron doctor` now says where a company or project saved in the portal goes once it is recorded. Sometimes the settings folder sits in a copy of a repository that other work also pulls and pushes. The next person to do that then publishes those saves. Doctor now warns about this, and counts the saves still waiting to go. Publishing your settings on purpose is still supported: this is only a warning, and it does not change doctor's result.
- cdc7c84: Fixed: Filtering Clearances to a company with no clearances no longer clears the page.
  
  The company buttons and the status filters stay on screen, so you can pick another. They used to disappear along with the list, and they are the only way to change company there.
- b45a5cf: Fixed: Pressing Stop now prevents the report from being published.
  
  A run stopped during its final step used to finish and deliver anyway, after telling you nothing would be delivered.
  
  Fixed: The Stop dialog no longer promises that nothing will be delivered when the report is already being written. It says so instead.
- e3db928: Fixed: "Stop now" ends the step in flight and anything that step started, and says the step has ended only once it has.
  
  If the step cannot be ended, the card says so and the run stops at its next step instead.
- b1dbbd5: Fixed: Pressing "Stop now" no longer says the step in flight has ended. It says a stop was sent, and what happens if the step will not take it.
  
  A stop is sent to the step under way. If it takes it the run ends in seconds; if it does not, the run ends at its next step. The old wording promised the first of those every time.
  
  Fixed: The notice shown while a run is stopping no longer overlaps the elapsed time on the card.
  
  It has its own line under the run, so "1 min so far" stays readable while a stop is in flight.
- fc3c17d: Fixed: `clearotron demo` no longer reads the settings of a real install on the same computer. Before, it showed that install's companies instead of its own and put its four example reports into that install's archive. A company created in the demo would have been saved into that install's customer list. An assistant connected to the demo could be offered that install's saved searches. The demo now keeps all of this in its own folder.
  
  Fixed: The demo's company switcher lists the demo company and Generic. A company you create in the demo belongs to the demo's own organisation.
  
  Fixed: If no organisation is set up yet, New company now says so and names the command that sets one up.
  
  For operators: On a local install, setup no longer asks for a sign-in address. It uses your computer account's name at `localhost` and shows it once in the summary. An address already in your settings file is kept.
- cdc7c84: Fixed: A Knockout report no longer carries a line telling the reader to remove the reviewer's notes before it goes to a client.
  
  The notes are reference material and the report says so where they sit. An instruction to edit the document was addressed to the lawyer and read by whoever opened it.
- ad088d6: Fixed: `clearotron doctor`'s register check now tests the register your install is set up for. A register or key kept only in your install's settings file came back as not set, though doctor had just listed it. The check now reads that file too, and a value set in your shell still wins.
- b45a5cf: Fixed: You can now start a new company from the Company profile screen. It used to be reachable only from the company picker, which disappears as soon as you pick a company.
  
  Fixed: Choosing a company on the dashboard now shows only that company's clearances. The buttons above the list used to change nothing.
  
  Fixed: When a feature is switched off on your installation, the screen says so and what to change. It used to suggest trying again shortly.
  
  Fixed: The link to the risk-framework guide opens in a new tab and goes straight to the section on writing your own. It also appears on the Company profile screen.
- ad088d6: Fixed: The audit workbook's "What was searched" sheet is now in plain words. Its Result and Note columns carry the search log's own notes. Internal terms could reach them: a status such as "deferred", a full web address, a bare HTTP code. Those words are now replaced as the workbook is built, a republished report included. A search recorded as not run still reads as not searched. Search terms and names stay exactly as written, because they record what was searched.
- ff16a3b: For operators: The deployment health check now reports whether the component that updates an installation is itself up to date. It was the one part of a deployment the check could not identify. An installation kept current by an out-of-date updater could report healthy while serving stale code.
  
  For operators: An updater that cannot be identified is now reported as a failure rather than passed over. A copy old enough to predate this reporting writes nothing at all. That silence is the case worth knowing about, so it is treated as a finding.

## 0.3.0-beta.1

### Minor Changes

- f75266d: New: People, in the sidebar for anyone with Manage, lists who can use the installation, and adds a person.
  
  Enter their email address, choose what they may do and what they can see, and save. A sentence under the form says what they will and will not see, before you save. They sign in the same way you do; Clearotron issues no passwords.
  
  An installation that signs one person in on its own machine cannot hold a second. People says so, and links to how to put a login system in front of it.
- f75266d: New: Each person now has two permissions, Run clearances and Manage, instead of a staff or client role.
  
  A person sees everything below the points they were given: the whole installation, an organisation, or a single company. Someone without Run has no New clearance. Someone without Manage has no People page and cannot add companies.
  
  The company menu groups companies by organisation when you can see more than one. Each organisation has its own Generic, listed first and marked Default. The top bar names your organisation when you can see exactly one.
- f75266d: New: Clearances with no company set up now have a daily allowance per organisation, 20 unless the Generic profile sets another.
  
  Anyone with Run clearances on a whole organisation can start them. One organisation's clearances never use up another's, and a person with access to the whole installation is not limited.
- c4d2768: New: You can now choose which company a clearance is for on the page itself, and set up new companies in the browser.
  
  Those screens used to refuse to render until a company was chosen. They told you to pick one at the top left. That is not where the control is when the sidebar is collapsed. They now show you the companies instead. Each one says what it sells, how many marketplaces it covers, and which territories it defaults to.
  
  Setting up a company is a page, not a document. It needs a name. Everything else has a default, and the screen says what that default is. It refuses before writing anything, and says why. A name it cannot make a key from, a key already in use, or an email address another company claims. A company you create can run its first search straight away, with no restart, and stop or cancel that search like any other.
  
  The product now says company throughout. It used to say brand owner, account, client and customer for the same thing. The firm running the installation is named separately, in the top bar.
  
  Companies created through the settings page were saved without a risk framework. Their matters were then rated under the default risk framework, with nothing on screen saying so. Every company created now carries one, and says which.
- f75266d: New: The setup wizard now asks for the organisation's name after the sign-in address, and the person who installs starts with access to everything.
  
  `clearotron grant add` sets a person's two permissions with `--run` and `--manage`; with neither, the person can look and start nothing.
- f75266d: For operators: Who may sign in is now decided by each person's own entry in the guest list, and nothing else. On a local installation, the next `clearotron start` gives whoever signs in access to everything if the guest list has no `people` section.
  
  - For operators: Any other installation with people on it needs one edit to its guest list (`CLEAROTRON_ACCESS_FILE`) before upgrading.
  - For operators: Anyone admitted because of their email domain needs an entry under a new `people` section: `"everything": true`, `"run": true`, `"manage": true`.
  - For operators: Each person who starts clearances needs `"run": true`, and each person who adds people or companies needs `"manage": true`. A person with no entry can see what their access covers, and start nothing.
  - For operators: An organisation whose `accounts` is `"*"` needs the list of companies it holds instead. Until then the portal refuses to start, and names the entry. A company may be listed under one organisation only.
  - For operators: `PORTAL_STAFF_DOMAINS` is ignored from this version on, and the portal says so at startup.
  - For operators: After upgrading, sign in to check, and run `clearotron connect` again for each person whose assistant uses a key.

### Patch Changes

- 8ff52d4: Fixed: Installed under a folder named with `#` or `%`, setup's register check now reads the provider's cost instead of calling it unknown. It built the address of the provider's own declaration by hand, and those characters broke it. It now uses the address Node builds, which is also what Windows needs.
- 350e0ed: New: `clearotron framework <your-framework.md>` reads a risk framework and its manifest, and reports what they declare.
  
  Run it before either rates a matter. It prints the ladder in the framework's own order, the company the deck names, and the shape it is. Where the deck and the manifest disagree, it names the band and says what the deck did not do. It creates nothing, rates nothing and contacts nobody, and it exits non-zero when the pair is not ready. `clearotron brandowner add --dry-run` prints the same report.
  
  Getting the deck's shape wrong used to fail quietly. The profile screen showed the framework's title and your band colours, and silently omitted the box saying what the bands mean. The new command answers that question directly, using the screen's own read of the deck.
  
  Fixed: When you have a configuration store set and a risk framework comes from the product's own files instead, the product now says so.
  
  Your store is looked in first, and the product's files answer when it is silent. The product ships decks under names you may also have chosen. So a deck that went missing from your store was replaced by ours rather than reported absent. Same band words, different rubric, nothing raised anywhere. The profile screen now writes one line naming what happened, and the new command reports it.
  
  Fixed: The built-in triage framework's profile page explains its bands again.
  
  Its band sections stated their meanings as plain paragraphs, which the screen does not read. Every company without a framework of its own saw band colours and no explanation. The wording is unchanged.
- cfb9a9f: Fixed: `clearotron doctor` now lists the companies your portal's key may start runs for.
  
  The key carries a list of the companies it may start runs for. A company added after the key was minted is outside it. Doctor reported the key's expiry and never its coverage. So the one command whose job is to tell you what a machine is configured for said nothing about it.
  
  It reads the company list the background services read, not the one a command run in a terminal would find, and it says which. The two can differ, and when they do, that difference is the answer.
  
  The line is a note, not a failure. Your portal takes a fresh credential at the start of every call, so a company outside the key is not normally refused. It is refused when the portal cannot take a fresh one, and the line says so and gives you the command to widen the key.
- ba2899b: Fixed: On reports searched through Signa, each register finding now links to the office's own page for that record, where the office publishes one. Singapore publishes no such page, so its registrations are cited by number, and the report says why. A number that an office's page cannot take is cited the same way.
- c4d2768: New: The configuration guide now explains how to write your own risk framework, step by step.
  
  It gives the manifest in full. It says which fields are required, and what each one may contain. It shows the shape a deck needs for the profile screen to explain your bands.
  
  That shape was undocumented, and getting it wrong fails quietly. The screen still shows the framework's title and your band colours. The box saying what the bands mean does not appear at all.
  
  The guide also says what is checked and what is not. Nothing reads your rubric for sense. A framework that is subtly wrong produces confident ratings that look exactly like right ones.

## 0.2.4

### Patch Changes

- d35dd9b: Fixed: A search that was planned and never run is disclosed on the report again, even when another search mentions the same word.
  
  One row on the coverage section says a planned search never reached the register. That row was removed whenever another row's heading carried the same words. A row for a search that had run and found nothing could remove it.
  
  So a report could mention a term in its coverage section and say nothing was left undone. The only disclosure of the gap had been dropped. A completed search no longer stands in for an uncompleted one.
  
  Re-rendering an archived report restores the row where this had removed it.
- b47be41: Fixed: Seven fixed sentences on the clearance report are now written for the person reading it.
  
  These lines print on every report and none of them was written for a client. The footer explained the risk-band vocabulary to a developer. A paragraph defined a label most readers never saw on their page. An internal coverage note ran to about a thousand characters of the engine's own search names and ended mid-word.
  
  Registration numbers no longer carry "(placeholder)" where the register has no per-record link — the number stands on its own. A gap that was disclosed twice, once in the model's words and once in the engine's, is disclosed once. Three section captions say what the section is rather than how it was produced. And a use check that found nothing no longer prints an evidence tag beside it, which read as a contradiction.
  
  The page also no longer calls itself a working draft for legal review. That sentence printed on every report and went with the footer rewrite; it is a deliberate removal, not a casualty of one.
  
  Nothing here changes what was searched, counted, rated or judged. Every fact about where a record came from is still there: the registration numbers, the dates they were read, the year each was registered.
- a4c9045: Fixed: The demo now names the register its example run was captured against.
  
  `clearotron demo` said the run came from a production EU register. It did not. All four frozen runs were captured against Clarivate Compumark, which is what their own records and the reports say. The label also carried a capture date that matches none of the four runs, so it has gone.
  
  The line now says what it is: a real run against Clarivate Compumark, and replaying it needs no account, no key and no network. That last part was always true and is worth saying where a reader meets it.
- f3bab16: Fixed: The lines a client reads first are now checked for the profession's vocabulary and for sentences carrying more than one idea. The reviewing pass rewrites them before delivery. Nothing about the check is shown to the client, and no run fails over it. A report clearing a name like PREVAIL is unaffected, because the mark being cleared is never read as a legal term.
- 862f76a: Fixed: The screen that will not start a search now gives advice that fits your machine.
  
  An install with the engine program present, but invisible to the engine service, was told to install a program it already had. That advice cannot work. Following it changes nothing, because the engine reads its PATH when it starts. Until it is restarted, every screen reports what it saw at startup. Nothing said so.
  
  The New clearance notice now tells those two states apart. Where the program is absent it gives the install advice as before. It adds that the service has to be restarted afterwards before it will notice. Where the program is present and the engine cannot see it, the notice says that instead, and names the restart as the remedy. Staff also get a link from that notice to the configuration page.
  
  The configuration page's engine row now names the program it could not find. It names the command that installs it too, and `clearotron doctor` says the same, in the same words.

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
