// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// phonetic-key.mjs — the sound-alike key for the FORM neighbourhood (Layer A).
//
// PURE: node built-ins only, ZERO dependencies, no imports (matches form-neighbourhood.mjs / core.js style).
// ESM, named `export function`s. Imported by form-neighbourhood.mjs, which expects EXACTLY:
//
//   doubleMetaphone(word) -> [primary, secondary]   // uppercase A–Z codes; secondary may equal primary; "" -> ["",""]
//   phoneticKey(word)     -> primary                 // convenience wrapper around the primary code
//
// WHY DOUBLE METAPHONE (not Soundex): the form neighbourhood must collapse sound-alike RESPELLINGS to one
// shared key so a single register query retrieves the whole phonetic family (VENZY / VENSEE / VYNZEE …).
// Soundex is too coarse (first letter pinned, vowels dropped after position 1) and emits no dual code for the
// genuinely ambiguous English clusters (CH as K vs X, G as K vs J, the -OUGH family, etc.). Double Metaphone
// returns a PRIMARY plus a SECONDARY pronunciation, both consonant skeletons with vowels kept ONLY when they
// begin the code.
//
// This is a faithful implementation of Lawrence Philips' canonical Double Metaphone (the algorithm shipped by
// the widely-used `double-metaphone` JS package and CPAN Text::DoubleMetaphone). The digraph rules — C/CH/CC,
// GH/GN, PH→F, SCH, TH→0, X→KS, the dual codes for ambiguous clusters — match that reference exactly. It is
// verified against the reference's published known-answer fixtures in test/phonetic-key.test.mjs (≥25 vectors).

// ── normalization ──────────────────────────────────────────────────────────────────────────────────────
// Case-insensitive; tolerant of digits/punctuation. We fold Latin diacritics to their base letter, uppercase,
// and collapse every run of non-letters to a single SPACE. Spaces are kept (not stripped) on purpose: the
// canonical algorithm's Germanic/Spanish prefix tests ("VAN ", "VON ", "SCH", "SAN ", "JOSE ") and its
// `Mac Gregor`/`San Jacinto` look-aheads are space-aware. Spaces never emit a metaph (they fall through the
// default case), so an all-letters input behaves identically whether or not a caller pre-stripped it.
function normalize(value) {
  let s = String(value ?? "");
  try {
    s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");
  } catch {
    // normalize exists in every supported node; the guard is belt-and-suspenders only.
  }
  return s.toUpperCase().replace(/[^A-Z]+/g, " ").replace(/^ | $/g, "");
}

// Regexes mirroring the canonical reference's named matchers.
const vowels = /[AEIOUY]/;
const slavoGermanic = /W|K|CZ|WITZ/;
const germanic = /^(VAN |VON |SCH)/;
const initialExceptions = /^(GN|KN|PN|WR|PS)/;
const initialGreekCh = /^CH(IA|EM|OR([^E])|YM|ARAC|ARIS)/;
const greekCh = /ORCHES|ARCHIT|ORCHID/;
const chForKh = /[ BFHLMNRVW]/;
const gForF = /[CGLRT]/;
const initialGForKj = /Y[\s\S]|E[BILPRSY]|I[BELN]/;
const initialAngerException = /^[DMR]ANGER/;
const gForKj = /[EGIR]/;
const jForJException = /[LTKSNMBZ]/;
const alle = /AS|OS/;
const hForS = /EIM|OEK|OLM|OLZ/;
const dutchSch = /E[DMNR]|UY|OO/;

// ── the algorithm ──────────────────────────────────────────────────────────────────────────────────────
// Walk the word once, building primary + secondary. Most rules append the same metaph to both; ambiguous
// clusters append different metaphs. The index advances by 1–4 per cluster consumed. Vowels emit "A" only at
// index 0 (word start). Returns ["",""] for empty / letter-free input.

export function doubleMetaphone(value) {
  const normalized = normalize(value) + "     "; // right-pad so look-aheads never read undefined
  const length = normalize(value).length;
  const last = length - 1;

  if (length === 0) return ["", ""];

  const characters = normalized.split("");
  const isSlavoGermanic = slavoGermanic.test(normalized);
  const isGermanic = germanic.test(normalized);

  let primary = "";
  let secondary = "";
  let index = 0;
  let subvalue;

  // Skip a silent initial letter: GN / KN / PN / WR / PS at the very start.
  if (initialExceptions.test(normalized)) {
    index++;
  }

  // Initial X is pronounced Z → S (e.g. `Xavier`).
  if (characters[0] === "X") {
    primary += "S";
    secondary += "S";
    index++;
  }

  while (index < length) {
    const character = characters[index];
    const previous = characters[index - 1];
    const next = characters[index + 1];
    const nextnext = characters[index + 2];

    switch (character) {
      case "A":
      case "E":
      case "I":
      case "O":
      case "U":
      case "Y":
        // Vowels are only kept when they begin the code.
        if (index === 0) {
          primary += "A";
          secondary += "A";
        }
        index++;
        break;

      case "B":
        primary += "P";
        secondary += "P";
        if (next === "B") index++;
        index++;
        break;

      case "C":
        // Various Germanic, such as `Bach`.
        if (
          previous === "A" &&
          next === "H" &&
          nextnext !== "I" &&
          !vowels.test(characters[index - 2]) &&
          (nextnext !== "E" ||
            ((subvalue = normalized.slice(index - 2, index + 4)) &&
              (subvalue === "BACHER" || subvalue === "MACHER")))
        ) {
          primary += "K";
          secondary += "K";
          index += 2;
          break;
        }

        // Special case `Caesar`.
        if (index === 0 && normalized.slice(index + 1, index + 6) === "AESAR") {
          primary += "S";
          secondary += "S";
          index += 2;
          break;
        }

        // Italian `Chianti`.
        if (normalized.slice(index + 1, index + 4) === "HIA") {
          primary += "K";
          secondary += "K";
          index += 2;
          break;
        }

        if (next === "H") {
          // Find `Michael`.
          if (index > 0 && nextnext === "A" && characters[index + 3] === "E") {
            primary += "K";
            secondary += "X";
            index += 2;
            break;
          }

          // Greek roots such as `chemistry`, `chorus`.
          if (index === 0 && initialGreekCh.test(normalized)) {
            primary += "K";
            secondary += "K";
            index += 2;
            break;
          }

          // Germanic, Greek, or otherwise `CH` for a `KH` sound.
          if (
            isGermanic ||
            greekCh.test(normalized.slice(index - 2, index + 4)) ||
            nextnext === "T" ||
            nextnext === "S" ||
            ((index === 0 ||
              previous === "A" ||
              previous === "E" ||
              previous === "O" ||
              previous === "U") &&
              chForKh.test(nextnext))
          ) {
            primary += "K";
            secondary += "K";
          } else if (index === 0) {
            primary += "X";
            secondary += "X";
          } else if (normalized.slice(0, 2) === "MC") {
            // Such as `McHugh`.
            primary += "K";
            secondary += "K";
          } else {
            primary += "X";
            secondary += "K";
          }

          index += 2;
          break;
        }

        // Such as `Czerny`.
        if (next === "Z" && normalized.slice(index - 2, index) !== "WI") {
          primary += "S";
          secondary += "X";
          index += 2;
          break;
        }

        // Such as `Focaccia`.
        if (normalized.slice(index + 1, index + 4) === "CIA") {
          primary += "X";
          secondary += "X";
          index += 3;
          break;
        }

        // Double `C`, but not `McClellan`.
        if (next === "C" && !(index === 1 && characters[0] === "M")) {
          // Such as `Bellocchio`, but not `Bacchus`.
          if (
            (nextnext === "I" || nextnext === "E" || nextnext === "H") &&
            normalized.slice(index + 2, index + 4) !== "HU"
          ) {
            subvalue = normalized.slice(index - 1, index + 4);
            // Such as `Accident`, `Accede`, `Succeed`.
            if (
              (index === 1 && previous === "A") ||
              subvalue === "UCCEE" ||
              subvalue === "UCCES"
            ) {
              primary += "KS";
              secondary += "KS";
            } else {
              // Such as `Bacci`, `Bertucci`, other Italian.
              primary += "X";
              secondary += "X";
            }
            index += 3;
            break;
          } else {
            // Pierce's rule.
            primary += "K";
            secondary += "K";
            index += 2;
            break;
          }
        }

        if (next === "G" || next === "K" || next === "Q") {
          primary += "K";
          secondary += "K";
          index += 2;
          break;
        }

        // Italian, such as `Cieto`.
        if (next === "I" && (nextnext === "E" || nextnext === "O")) {
          primary += "S";
          secondary += "X";
          index += 2;
          break;
        }

        if (next === "I" || next === "E" || next === "Y") {
          primary += "S";
          secondary += "S";
          index += 2;
          break;
        }

        primary += "K";
        secondary += "K";

        // Skip two extra characters ahead, such as `Mac Caffrey`, `Mac Gregor`.
        if (next === " " && (nextnext === "C" || nextnext === "G" || nextnext === "Q")) {
          index += 3;
          break;
        }

        index++;
        break;

      case "D":
        if (next === "G") {
          // Such as `edge`.
          if (nextnext === "E" || nextnext === "I" || nextnext === "Y") {
            primary += "J";
            secondary += "J";
            index += 3;
          } else {
            // Such as `Edgar`.
            primary += "TK";
            secondary += "TK";
            index += 2;
          }
          break;
        }

        if (next === "T" || next === "D") {
          primary += "T";
          secondary += "T";
          index += 2;
          break;
        }

        primary += "T";
        secondary += "T";
        index++;
        break;

      case "F":
        if (next === "F") index++;
        index++;
        primary += "F";
        secondary += "F";
        break;

      case "G":
        if (next === "H") {
          if (index > 0 && !vowels.test(previous)) {
            primary += "K";
            secondary += "K";
            index += 2;
            break;
          }

          // Such as `Ghislane`, `Ghiradelli`.
          if (index === 0) {
            if (nextnext === "I") {
              primary += "J";
              secondary += "J";
            } else {
              primary += "K";
              secondary += "K";
            }
            index += 2;
            break;
          }

          // Parker's rule (with some further refinements).
          if (
            ((subvalue = characters[index - 2]),
            subvalue === "B" || subvalue === "H" || subvalue === "D") ||
            ((subvalue = characters[index - 3]),
            subvalue === "B" || subvalue === "H" || subvalue === "D") ||
            ((subvalue = characters[index - 4]),
            subvalue === "B" || subvalue === "H")
          ) {
            index += 2;
            break;
          }

          // Such as `laugh`, `McLaughlin`, `cough`, `gough`, `rough`, `tough`.
          if (index > 2 && previous === "U" && gForF.test(characters[index - 3])) {
            primary += "F";
            secondary += "F";
          } else if (index > 0 && previous !== "I") {
            primary += "K";
            secondary += "K";
          }

          index += 2;
          break;
        }

        if (next === "N") {
          if (index === 1 && vowels.test(characters[0]) && !isSlavoGermanic) {
            primary += "KN";
            secondary += "N";
          } else if (
            // Not like `Cagney`.
            normalized.slice(index + 2, index + 4) !== "EY" &&
            normalized.slice(index + 1) !== "Y" &&
            !isSlavoGermanic
          ) {
            primary += "N";
            secondary += "KN";
          } else {
            primary += "KN";
            secondary += "KN";
          }
          index += 2;
          break;
        }

        // Such as `Tagliaro`.
        if (normalized.slice(index + 1, index + 3) === "LI" && !isSlavoGermanic) {
          primary += "KL";
          secondary += "L";
          index += 2;
          break;
        }

        // -ges-, -gep-, -gel- at beginning.
        if (index === 0 && initialGForKj.test(normalized.slice(1, 3))) {
          primary += "K";
          secondary += "J";
          index += 2;
          break;
        }

        // -ger-, -gy-.
        if (
          (normalized.slice(index + 1, index + 3) === "ER" &&
            previous !== "I" &&
            previous !== "E" &&
            !initialAngerException.test(normalized.slice(0, 6))) ||
          (next === "Y" && !gForKj.test(previous))
        ) {
          primary += "K";
          secondary += "J";
          index += 2;
          break;
        }

        // Italian, such as `biaggi`.
        if (
          next === "E" ||
          next === "I" ||
          next === "Y" ||
          ((previous === "A" || previous === "O") && next === "G" && nextnext === "I")
        ) {
          // Obvious Germanic.
          if (normalized.slice(index + 1, index + 3) === "ET" || isGermanic) {
            primary += "K";
            secondary += "K";
          } else {
            primary += "J";
            // Always soft if French ending.
            secondary += normalized.slice(index + 1, index + 5) === "IER " ? "J" : "K";
          }
          index += 2;
          break;
        }

        if (next === "G") index++;
        index++;
        primary += "K";
        secondary += "K";
        break;

      case "H":
        // Only keep if first & before a vowel, or between two vowels.
        if (vowels.test(next) && (index === 0 || vowels.test(previous))) {
          primary += "H";
          secondary += "H";
          index++;
        }
        index++;
        break;

      case "J":
        // Obvious Spanish, such as `Jose`, `San Jacinto`.
        if (
          normalized.slice(index, index + 4) === "JOSE" ||
          normalized.slice(0, 4) === "SAN "
        ) {
          if (
            normalized.slice(0, 4) === "SAN " ||
            (index === 0 && characters[index + 4] === " ")
          ) {
            primary += "H";
            secondary += "H";
          } else {
            primary += "J";
            secondary += "H";
          }
          index++;
          break;
        }

        if (index === 0) {
          primary += "J";
          // Such as `Yankelovich` / `Jankelowicz`.
          secondary += "A";
        } else if (
          // Spanish pron. of such as `bajador`.
          !isSlavoGermanic &&
          (next === "A" || next === "O") &&
          vowels.test(previous)
        ) {
          primary += "J";
          secondary += "H";
        } else if (index === last) {
          primary += "J";
        } else if (
          previous !== "S" &&
          previous !== "K" &&
          previous !== "L" &&
          !jForJException.test(next)
        ) {
          primary += "J";
          secondary += "J";
        } else if (next === "J") {
          index++;
        }

        index++;
        break;

      case "K":
        if (next === "K") index++;
        index++;
        primary += "K";
        secondary += "K";
        break;

      case "L":
        if (next === "L") {
          // Spanish, such as `cabrillo`, `gallegos`.
          if (
            (index === length - 3 &&
              ((previous === "A" && nextnext === "E") ||
                (previous === "I" && (nextnext === "O" || nextnext === "A")))) ||
            (previous === "A" &&
              nextnext === "E" &&
              (characters[last] === "A" ||
                characters[last] === "O" ||
                alle.test(normalized.slice(last - 1, length))))
          ) {
            primary += "L";
            index += 2;
            break;
          }
          index++;
        }
        primary += "L";
        secondary += "L";
        index++;
        break;

      case "M":
        if (
          next === "M" ||
          // Such as `dumb`, `thumb`.
          (previous === "U" &&
            next === "B" &&
            (index + 1 === last || normalized.slice(index + 2, index + 4) === "ER"))
        ) {
          index++;
        }
        index++;
        primary += "M";
        secondary += "M";
        break;

      case "N":
        if (next === "N") index++;
        index++;
        primary += "N";
        secondary += "N";
        break;

      case "P":
        if (next === "H") {
          // PH → F.
          primary += "F";
          secondary += "F";
          index += 2;
          break;
        }
        // Also account for `campbell`, `raspberry`.
        if (next === "P" || next === "B") index++;
        index++;
        primary += "P";
        secondary += "P";
        break;

      case "Q":
        if (next === "Q") index++;
        index++;
        primary += "K";
        secondary += "K";
        break;

      case "R":
        // French such as `Rogier`, but exclude `Hochmeier`.
        if (
          index === last &&
          !isSlavoGermanic &&
          previous === "E" &&
          characters[index - 2] === "I" &&
          characters[index - 4] !== "M" &&
          characters[index - 3] !== "E" &&
          characters[index - 3] !== "A"
        ) {
          secondary += "R";
        } else {
          primary += "R";
          secondary += "R";
        }
        if (next === "R") index++;
        index++;
        break;

      case "S":
        // Special cases `island`, `isle`, `carlisle`, `carlysle`.
        if (next === "L" && (previous === "I" || previous === "Y")) {
          index++;
          break;
        }

        // Special case `sugar-`.
        if (index === 0 && normalized.slice(1, 5) === "UGAR") {
          primary += "X";
          secondary += "S";
          index++;
          break;
        }

        if (next === "H") {
          // Germanic.
          if (hForS.test(normalized.slice(index + 1, index + 5))) {
            primary += "S";
            secondary += "S";
          } else {
            primary += "X";
            secondary += "X";
          }
          index += 2;
          break;
        }

        if (next === "I" && (nextnext === "O" || nextnext === "A")) {
          if (isSlavoGermanic) {
            primary += "S";
            secondary += "S";
          } else {
            primary += "S";
            secondary += "X";
          }
          index += 3;
          break;
        }

        // German anglicizations, such as `Smith` ~ `Schmidt`, `snider` ~ `Schneider`; also slavic -sz-.
        if (next === "Z" || (index === 0 && (next === "L" || next === "M" || next === "N" || next === "W"))) {
          primary += "S";
          secondary += "X";
          if (next === "Z") index++;
          index++;
          break;
        }

        if (next === "C") {
          // Schlesinger's rule.
          if (nextnext === "H") {
            subvalue = normalized.slice(index + 3, index + 5);
            // Dutch origin, such as `school`, `schooner`.
            if (dutchSch.test(subvalue)) {
              // Such as `schermerhorn`, `schenker`.
              if (subvalue === "ER" || subvalue === "EN") {
                primary += "X";
                secondary += "SK";
              } else {
                primary += "SK";
                secondary += "SK";
              }
              index += 3;
              break;
            }
            if (index === 0 && !vowels.test(characters[3]) && characters[3] !== "W") {
              primary += "X";
              secondary += "S";
            } else {
              primary += "X";
              secondary += "X";
            }
            index += 3;
            break;
          }

          if (nextnext === "I" || nextnext === "E" || nextnext === "Y") {
            primary += "S";
            secondary += "S";
            index += 3;
            break;
          }

          primary += "SK";
          secondary += "SK";
          index += 3;
          break;
        }

        subvalue = normalized.slice(index - 2, index);
        // French such as `resnais`, `artois`.
        if (index === last && (subvalue === "AI" || subvalue === "OI")) {
          secondary += "S";
        } else {
          primary += "S";
          secondary += "S";
        }
        if (next === "S") index++;
        index++;
        break;

      case "T":
        if (next === "I" && nextnext === "O" && characters[index + 3] === "N") {
          // -TION → X.
          primary += "X";
          secondary += "X";
          index += 3;
          break;
        }

        if ((next === "I" && nextnext === "A") || (next === "C" && nextnext === "H")) {
          // -TIA-, -TCH- → X.
          primary += "X";
          secondary += "X";
          index += 3;
          break;
        }

        if (next === "H" || (next === "T" && nextnext === "H")) {
          // TH → 0 (theta), except `Thomas`/`Thames`/Germanic → T.
          if (
            isGermanic ||
            ((nextnext === "O" || nextnext === "A") && characters[index + 3] === "M")
          ) {
            primary += "T";
            secondary += "T";
          } else {
            primary += "0";
            secondary += "T";
          }
          index += 2;
          break;
        }

        if (next === "T" || next === "D") index++;
        index++;
        primary += "T";
        secondary += "T";
        break;

      case "V":
        if (next === "V") index++;
        primary += "F";
        secondary += "F";
        index++;
        break;

      case "W":
        // WR → R (already handled at the start for initial WR; also fires mid-word).
        if (next === "R") {
          primary += "R";
          secondary += "R";
          index += 2;
          break;
        }

        if (index === 0) {
          // `Wasserman` should match `Vasserman`.
          if (vowels.test(next)) {
            primary += "A";
            secondary += "F";
          } else if (next === "H") {
            // `Uomo` should match `Womo`.
            primary += "A";
            secondary += "A";
          }
        }

        // `Arnow` should match `Arnoff`.
        if (
          ((previous === "E" || previous === "O") &&
            next === "S" &&
            nextnext === "K" &&
            (characters[index + 3] === "I" || characters[index + 3] === "Y")) ||
          normalized.slice(0, 3) === "SCH" ||
          (index === last && vowels.test(previous))
        ) {
          secondary += "F";
          index++;
          break;
        }

        // Polish, such as `Filipowicz`.
        if (next === "I" && (nextnext === "C" || nextnext === "T") && characters[index + 3] === "Z") {
          primary += "TS";
          secondary += "FX";
          index += 4;
          break;
        }

        index++;
        break;

      case "X":
        // French such as `breaux` (terminal -AUX/-OUX drops the X).
        if (
          !(
            index === last &&
            previous === "U" &&
            (characters[index - 2] === "A" || characters[index - 2] === "O")
          )
        ) {
          primary += "KS";
          secondary += "KS";
        }
        if (next === "C" || next === "X") index++;
        index++;
        break;

      case "Z":
        // Chinese pinyin, such as `Zhao`.
        if (next === "H") {
          primary += "J";
          secondary += "J";
          index += 2;
          break;
        } else if (
          (next === "Z" && (nextnext === "A" || nextnext === "I" || nextnext === "O")) ||
          (isSlavoGermanic && index > 0 && previous !== "T")
        ) {
          primary += "S";
          secondary += "TS";
        } else {
          primary += "S";
          secondary += "S";
        }
        if (next === "Z") index++;
        index++;
        break;

      default:
        // Spaces and any stray character: contribute nothing, just advance.
        index++;
        break;
    }
  }

  return [primary, secondary];
}

// Convenience wrapper: the PRIMARY code only.
export function phoneticKey(value) {
  return doubleMetaphone(value)[0];
}
