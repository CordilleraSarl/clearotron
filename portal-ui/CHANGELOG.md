# portal-ui

## 0.3.1-beta.3

### Patch Changes

- f1c5925: Fixed: Every page in the portal now has one heading instead of two saying nearly the same thing. The home page is called Home, and the All Clearances and New clearance buttons sit together at the top of it.
- 56a760f: New: The People page can now change what somebody may do and see, and take their access away. Modify on a row opens the same form used to add them, filled in. Unticking a row removes that access. Remove sits below Save and asks once before it acts. Your own row has neither, so nobody can lock themselves out.
  
  Fixed: Somebody listed only in a company's access list, with no permissions of their own, is now shown as that. They used to read as a view-only person, which is a different thing.

## 0.3.1-beta.2

### Patch Changes

- 240673c: Fixed: The home page now says what it is for. With nothing running it tells you how to start a clearance, rather than showing an empty list. It ends with the last few finished clearances and a line to all of them.
- 240673c: Fixed: The archive of finished clearances is called All Clearances everywhere, and the route to it from the home page is a button you can see.
- f96c089: Fixed: When two attempts at one search both await dismissal, the dashboard shows which is which instead of two identical cards.

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

- 2878809: Fixed: When the company store cannot record a new company, the New company page now says why and what fixes it, instead of "Try again shortly". Someone who does not run the installation is told to ask whoever does.

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

- a637d3e: Fixed: The portal now runs on the current React, TypeScript and Vite, and its download is smaller because build comments no longer ship to the browser.

## 0.1.3

## 0.1.2

## 0.1.1

### Patch Changes

- f7c1570: For operators: The portal now reports its screens as out of date when they are older than the sources they were built from, instead of ready.
- f7c1570: Fixed: The demo now says plainly when a search type has no sample run, and lists the ones it has. Nothing is started and nothing is charged.

## 0.1.1-beta.1

## 0.1.1-beta.0

### Patch Changes

- f7c1570: The health check now says when the portal screens are older than the sources they were built from, instead of reporting them as ready. Pulling an update leaves the built screens behind, and nothing used to say so.
- f7c1570: Asking the demo for a search it has no example of now explains what happened, that nothing was started or charged, and what to pick instead.
