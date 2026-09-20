# portal-ui

## 0.3.2-beta.15

No changes in this release.

## 0.3.2-beta.14

No changes in this release.

## 0.3.2-beta.13

No changes in this release.

## 0.3.2-beta.12

### Patch Changes

- New: A report's section strip sits under its Reads and fills in as you scroll, marking each section you have reached; a click still jumps.

## 0.3.2-beta.11

No changes in this release.

## 0.3.2-beta.10

### Patch Changes

- Fixed: For a Global preliminary search, the bar at the foot of New clearance now says worldwide, not the company's own territories.
- New: A report opened in the portal now follows the portal's light or dark theme, and changes with it straight away.

## 0.3.2-beta.9

### Patch Changes

- Fixed: New clearance no longer marks a company's saved territories as not available on a register that covers them.
- Fixed: A report's section links now sit in the header and stay on screen while you read, instead of scrolling away.
- Fixed: on a phone, a table wider than the screen, such as Clearances or People, keeps its sideways scrollbar at the bottom of the screen.
- New: a worldwide search names the register service that searches it, on the New clearance form and on the report's coverage line.
- Fixed: each finding's "Ask AI about this finding" button in a report now opens Ask AI, with that finding's number in the question.
- New: on Clearances, Ask AI sits in each row's "···" menu beside Retire, leaving the Open button alone in its column.
- Fixed: The Ask AI panel now points at the button that opened it, and that button shows when it is open. Pressing "Ask AI about this finding" a second time closes the panel.
- Fixed: on a wide screen, the Clearances columns take the widths of the approved design, with a quarter of the table for each row's buttons.
- Fixed: Clearances no longer scrolls sideways on a wide screen with a full list, and a long risk word no longer runs into its date.
- Fixed: on a narrow window, Clearances no longer splits a risk word such as "Manageable" in two or runs a group's status into its risk.
- Fixed: clicking Company settings in the side menu a second time closes its pages again, and a third click opens them.
- Fixed: Connect your AI sits at the bottom of the portal's side menu, just above Collapse, where it stays whatever the window's height.
- Fixed: New clearance no longer asks for the name twice when it opens with a search already picked for a company.
- Fixed: when the company list cannot load, screens no longer narrow to one default company, and a company whose settings cannot be read is named.
- Fixed: The new clearance form no longer repeats in paragraphs what each product row and each place already say.
- Fixed: The Goods or services field no longer carries a line explaining it; the field itself is unchanged and still optional.

## 0.3.2-beta.8

No changes in this release.

## 0.3.2-beta.7

No changes in this release.

## 0.3.2-beta.6

No changes in this release.

## 0.3.2-beta.5

No changes in this release.

## 0.3.2-beta.4

No changes in this release.

## 0.3.2-beta.3

### Patch Changes

- New: every name on Clearances has an Open button in one column, and a name re-read while a search waits still shows its latest report's risk.
  
  New: groups on Clearances say how many of their names' searches are queued, and retire and ungroup sit in each row's menu.
  
  Fixed: the counts on Clearances count names, so the total over the table matches the company headings.
  
  Fixed: a stopped clearance says no report will be produced and that its completed work stays readable through Ask AI.
- New: Company settings opens in the rail into Profile, Projects and Search templates.
  
  New: Projects and Search templates lead with New project and New template, and all three Company settings pages offer + New company.
  
  New: Profile folds what each risk band means and the search variant calculation, keeping the framework, its bands and its settings in view.
  
  New: Profile and New company mark the legal name Required and every other field Optional.
  
  New: Save on Profile checks the settings and saves them in one press, with no separate Check.
  
  New: default classes on Profile and New company are added by typing a number or a word, and are shown by name.
  
  New: archiving a project, and retiring or bringing back a search template, are in each row's menu.
  
  New: New company uses the same cards and tags as Profile, and asks for a key only when the name cannot make one.
  
  Fixed: Permitted searches on Profile names each search template the way Search templates does, instead of printing its key.
  
  Fixed: Default search depth and the Builds on column name each search once instead of twice.
  
  Fixed: saving changes to a search template returns to Search templates without warning that the changes were not saved.
- New: an installation can name its administrator contact, a mail or web address, and Preferences links "Clearotron administrator" to it.
  
  New: Preferences carries the top bar's blur button, and the blur now stays as you left it in this browser, reloads included.
  
  New: Global config is now Installation settings, with one sign-in row, the engine's own web search under Engine, and providers grouped by category.
  
  New: a provider needing action says what it needs in a few words and links its setup guide, instead of naming settings and files.
  
  New: About lists its facts in one card, and its source link reads as the repository's name, with the build just above.
  
  New: the sign-in page leads with one line, "This Clearotron signs in one person: you.", and keeps the reset and sign-on steps under Administrator help.
- New: New clearance is one form, top to bottom, and selects the search that fits the places and names entered, saying why.
  
  New: the review before a search starts lists the registers to search, the goods, native-language coverage, the turnaround and the searches left today.
  
  New: stopping a clearance offers "Stop after this step" or "Stop now", and the button names the one chosen.
  
  New: saved set-ups are called search templates, and New clearance applies one from a dropdown and says what it sets.
  
  Fixed: a clearance just ordered is shown as queued and waiting for a slot, instead of as started.
- New: New clearance and Clearances show one allowance line, in the same words, once five or fewer searches are left.
  
  Fixed: the composer and the review step say what a search spends in searches, replacing an effort meter that carried no unit.
- New: People explains each permission word under the list, and an address listed with nothing set reads "View reports", which is what it can do.
  
  New: adding a person says they also need access through the organisation's sign-in service, and the button that grants it reads Give access.
  
  New: before anything is chosen, Give access says the choice is also what the person's AI assistant can see.
  
  New: People, its two forms and the other pages in the avatar menu name themselves in the top bar, with the avatar highlighted.
  
  Fixed: People's activity panel no longer reads as a list of who has access; it is called Recent activity and says what it counts.
  
  Fixed: Recent activity on People names each company instead of printing its internal key.
- New: a report's header labels both of its dates, searched and issued, with Ask AI and Export beside them as two buttons.
  
  New: Ask AI on a report offers four questions, and opens Claude with the one you pick typed in, ready for you to send.
  
  New: Use your AI is now Connect your AI, and shows whether your assistant is connected, folding the setup steps away once it is.
  
  New: after Set it up on a report's Ask AI, Connect your AI offers a button back to that report once your assistant connects.
  
  Fixed: Claude's steps no longer tell you to ignore an authentication warning, and copy the address and the key with separate buttons.
  
  New: where your installation offers another way to connect, Connect your AI keeps those steps in a closed fold under the sign-in steps.
- Fixed: The documentation says organisation for who owns an installation and company for whose names are cleared, never client, customer or tenant.
  
  Fixed: The README now opens with a company clearing its own names, and describes the law-firm setup after it.
- Fixed: Every screen says organisation for who owns the installation and company for whose names are cleared. The same thing is no longer called an account on one screen, a client on the next and a brand on a third.
- Fixed: On WSL, the "on this computer" connect line now says its command is for an assistant on the Windows side. It no longer invites a paste inside the WSL terminal, where it cannot work.

## 0.3.2-beta.2

No changes in this release.

## 0.3.2-beta.1

### Patch Changes

- New: Home's in-flight band breaks the count down into running, paused and queued instead of one total.
  
  New: a running card carries the standing quote for its search — "usually 1.5 to 2.5 h" — and says "taking longer than usual" past it.
  
  Fixed: a stopping card now says finished work stays readable, instead of only what was lost.

## 0.3.2-beta.0

No changes in this release.

## 0.3.1

### Patch Changes

- Fixed: Changing or removing a person now explains why it cannot be done on a Clearotron that signs in one person. It used to show an internal code.
  
  Fixed: Modify and Remove are switched off on that kind of install, the way Add already was, with the reason beside them.
- Fixed: When Clearotron cannot check how your assistant will be let in, Use your own AI now shows both ways and says so. It used to show one.
- Fixed: The home page now says what it is for. With nothing running it tells you how to start a clearance, rather than showing an empty list. It ends with the last few finished clearances and a line to all of them.
- Fixed: Every page in the portal now has one heading instead of two saying nearly the same thing. The home page is called Home, and the All Clearances and New clearance buttons sit together at the top of it.
- Fixed: The archive of finished clearances is called All Clearances everywhere, and the route to it from the home page is a button you can see.
- New: The People page can now change what somebody may do and see, and take their access away. Modify on a row opens the same form used to add them, filled in. Unticking a row removes that access. Remove sits below Save and asks once before it acts. Your own row has neither, so nobody can lock themselves out.
  
  Fixed: Somebody listed only in a company's access list, with no permissions of their own, is now shown as that. They used to read as a view-only person, which is a different thing.
- Fixed: Searches that stopped no longer sit in Home's In flight band. They have their own list below it, with a count you can see without opening it.
  
  Fixed: That list clears itself after a week, whether or not anyone pressed Acknowledge. Signing in for the first time no longer means meeting every search that has ever failed.
- Fixed: When two attempts at one search both await dismissal, the dashboard shows which is which instead of two identical cards.

## 0.3.1-beta.4

### Patch Changes

- Fixed: Changing or removing a person now explains why it cannot be done on a Clearotron that signs in one person. It used to show an internal code.
  
  Fixed: Modify and Remove are switched off on that kind of install, the way Add already was, with the reason beside them.
- Fixed: When Clearotron cannot check how your assistant will be let in, Use your own AI now shows both ways and says so. It used to show one.
- Fixed: Searches that stopped no longer sit in Home's In flight band. They have their own list below it, with a count you can see without opening it.
  
  Fixed: That list clears itself after a week, whether or not anyone pressed Acknowledge. Signing in for the first time no longer means meeting every search that has ever failed.

## 0.3.1-beta.3

### Patch Changes

- Fixed: Every page in the portal now has one heading instead of two saying nearly the same thing. The home page is called Home, and the All Clearances and New clearance buttons sit together at the top of it.
- New: The People page can now change what somebody may do and see, and take their access away. Modify on a row opens the same form used to add them, filled in. Unticking a row removes that access. Remove sits below Save and asks once before it acts. Your own row has neither, so nobody can lock themselves out.
  
  Fixed: Somebody listed only in a company's access list, with no permissions of their own, is now shown as that. They used to read as a view-only person, which is a different thing.

## 0.3.1-beta.2

### Patch Changes

- Fixed: The home page now says what it is for. With nothing running it tells you how to start a clearance, rather than showing an empty list. It ends with the last few finished clearances and a line to all of them.
- Fixed: The archive of finished clearances is called All Clearances everywhere, and the route to it from the home page is a button you can see.
- Fixed: When two attempts at one search both await dismissal, the dashboard shows which is which instead of two identical cards.

## 0.3.1-beta.1

No changes in this release.

## 0.3.1-beta.0

No changes in this release.

## 0.3.0

No changes in this release.

## 0.3.0-beta.10

No changes in this release.

## 0.3.0-beta.9

No changes in this release.

## 0.3.0-beta.8

No changes in this release.

## 0.3.0-beta.7

No changes in this release.

## 0.3.0-beta.6

No changes in this release.

## 0.3.0-beta.5

### Patch Changes

- Fixed: When the company store cannot record a new company, the New company page now says why and what fixes it, instead of "Try again shortly". Someone who does not run the installation is told to ask whoever does.

## 0.3.0-beta.4

No changes in this release.

## 0.3.0-beta.3

No changes in this release.

## 0.3.0-beta.2

No changes in this release.

## 0.3.0-beta.1

No changes in this release.

## 0.2.4

## 0.2.3

## 0.2.2

## 0.3.0-beta.0

## 0.2.1

## 0.2.1-beta.2

## 0.2.1-beta.1

## 0.2.1-beta.0

## 0.2.0

## 0.1.12

## 0.1.11

## 0.1.10

## 0.1.9

## 0.1.8

## 0.1.7

## 0.1.6

## 0.1.5

## 0.1.4

### Patch Changes

- Fixed: The portal now runs on the current React, TypeScript and Vite, and its download is smaller because build comments no longer ship to the browser.

## 0.1.3

## 0.1.2

## 0.1.1

### Patch Changes

- For operators: The portal now reports its screens as out of date when they are older than the sources they were built from, instead of ready.
- Fixed: The demo now says plainly when a search type has no sample run, and lists the ones it has. Nothing is started and nothing is charged.

## 0.1.1-beta.1

## 0.1.1-beta.0

### Patch Changes

- The health check now says when the portal screens are older than the sources they were built from, instead of reporting them as ready. Pulling an update leaves the built screens behind, and nothing used to say so.
- Asking the demo for a search it has no example of now explains what happened, that nothing was started or charged, and what to pick instead.
