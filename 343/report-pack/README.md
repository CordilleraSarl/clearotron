# Report pack — what a reader sees, before and after

Two changes on the 0.3.2-beta.8 integration branch alter a page a client reads. Every image below is a
real report published by the real publisher from the demo runs in this repository: invented marks,
invented owners, no client matter. "Before" is the branch point; "after" is the same run published
from the same tree with the change in it.

## The verdict's conditions

`verdict-conditions-before-light-1280.png` — the fourth condition is the engine's own run-record
sentence: an identifier, its counts and four register record addresses, in the list a client reads as
the conditions on their result.

`verdict-conditions-after-*.png` — the same four conditions, the fourth now in the sentence the engine
had already written for a reader and then thrown away. The other three are unchanged. Light and dark
at 1280, light at 390.

## The knockout's Export control

`knockout-export-before-light-1280.png` — the top bar carries Ask AI and nothing else. A reader who
opened the file had no route to a PDF.

`knockout-export-*.png` — the control in the bar and its menu open, which is the only state worth
photographing. The board puts Ask AI and Export in one menu and draws the button and its caret; it
does not draw what the menu contains, so the menu carries no heading and its entries are the clearance
report's own words. There is no tick wording: a knockout has nothing to tick. Light and dark, 1280 and
390.

## What is no longer in this pack

An earlier version added a line to the What-was-searched fold for a search that cannot report how many
register records it read, and a line for each check a search decided to make and did not. Both were
sentences written by a developer for a page whose presentation is designed, and both are out. The
images for them have been removed rather than left here to be read as current.

## The report on a phone

`report-phone-old-light.png` — the document is 425px wide in a 390px viewport, so the page scrolls
sideways and the Export button sits off the right edge. `report-phone-new-light.png` and
`report-phone-new-dark.png` — the same report at the same width, fitting exactly.

An earlier version of this file said the document was 500px wide. That figure was wrong and worth
naming: headless Chrome clamps `--window-size` at a floor near 500px, so a page asked for at 390 was
laid out at 500 and the number measured the browser rather than the page. The layout viewport has to be
set through the browser's own device metrics. Every image in this folder is now taken that way.
