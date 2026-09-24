// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE FONTS TRAVEL WITH THE PAGE. A report used to link its typefaces from two font services, so opening
// one told those services the reader's address and that a report had been opened, from the portal, from
// disk or from an email alike. Every page this product writes now carries its fonts inside itself, as
// data, and fetches nothing to draw its text.
//
// ONE PLACE. The files are shared/fonts/*.woff2 (their provenance is in shared/fonts/README.md), and every
// surface that sets text takes its @font-face rules from here: the report renderers, the pool index pages,
// the portal's own sign-in pages and the staff profile page. The portal's browser bundle is the one
// exception: it imports the same files through its own stylesheet, because a bundle serves files rather
// than inlining them.
//
// EACH LICENCE RIDES BESIDE ITS FONT. Both are under the SIL Open Font License 1.1, which asks that every
// copy of the font carry its copyright notice and the licence. The font files carry both in their name
// records, and the full licence text goes into the page as a stylesheet comment right before the rules
// that embed the font, so a copy saved out of a report still has it.
//
// NOT FOR EMAIL. A mail client strips web fonts, and the embedded face would add tens of kilobytes to
// every message. Email keeps its font stack by name only.

import { readFileSync } from "node:fs";

const at = (name) => new URL(`./fonts/${name}`, import.meta.url);

/** The text face, as every stylesheet names it. */
export const TEXT_FACE = "Plus Jakarta Sans";
/** The code face, as every stylesheet names it. */
export const CODE_FACE = "Fira Code";

// The code points each file holds, from shared/fonts/README.md. Stated so a browser never asks a face for
// a character it does not have: Japanese, Greek and the rest go straight to the reader's system fonts.
export const FONT_UNICODE_RANGE = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,"
  + "U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2190-2193,U+2212,U+2215,U+FEFF,U+FFFD,U+0100-02BA,U+02BD-02C5,"
  + "U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,"
  + "U+2113,U+2C60-2C7F,U+A720-A7FF";

export const FONT_FILES = [
  { family: TEXT_FACE, file: "plus-jakarta-sans.woff2", licence: "OFL-plus-jakarta-sans.txt", weight: "200 800" },
  { family: CODE_FACE, file: "fira-code.woff2", licence: "OFL-fira-code.txt", weight: "300 700" },
];

function faceCss({ family, file, licence, weight }) {
  const licenceText = readFileSync(at(licence), "utf8").trim();
  // A licence containing the comment terminator would end the comment early and spill into the stylesheet.
  if (licenceText.includes("*/")) throw new Error(`${licence} contains "*/" and cannot be carried in a stylesheet comment`);
  const data = readFileSync(at(file)).toString("base64");
  return `/*\n${family}\n\n${licenceText}\n*/\n`
    + `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:swap;`
    + `src:url(data:font/woff2;base64,${data}) format('woff2');unicode-range:${FONT_UNICODE_RANGE}}\n`;
}

const [TEXT, CODE] = FONT_FILES.map(faceCss);

/** The text face alone, for pages that set no code: the pool index, the sign-in pages, the profile page. */
export const TEXT_FONT_STYLE = `<style>${TEXT}</style>`;
/** Both faces, for a report, which sets identifiers and dates in the code face. */
export const REPORT_FONT_STYLE = `<style>${TEXT}${CODE}</style>`;
