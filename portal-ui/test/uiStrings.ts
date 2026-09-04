// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The strings a USER can read, extracted from the UI source. 's terminology map is measured with
// this, and TERMINOLOGY.md states the method so its figures can be re-taken.
//
// WHY NOT JUST GREP THE SOURCE. `name` matches `Icon name=`, `markName`, and a dozen props; a
// vocabulary count built on that measures the codebase rather than the product. The first version of
// this returned 683 "strings" and two of its classes were SVG path data and code spans caught between
// `=>` and a generic's `<`.
//
// DELIBERATELY CONSERVATIVE, AND THAT IS A LIMIT NOT A FEATURE. It drops any string containing code
// punctuation, so `Saved searches{' '}` and a template literal with `${…}` never enter the corpus. It
// would rather miss a real string than count a token — an overcount publishes a confident wrong figure,
// an undercount is visible and stated. **This is why the guard does not use it**: see terminology.test.ts.
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const ROOT = fileURLToPath(new URL('../src/', import.meta.url))

const walk = (dir: string, pre = ''): string[] =>
  readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name), `${pre}${e.name}/`)
    : /\.tsx?$/.test(e.name) ? [`${pre}${e.name}`] : [])

/** Every source file under src/, WALKED rather than listed. scopes this work as "twelve screens;
 *  AppShell.tsx and the components", which misses nav/nav.config.ts — where the navigation labels live,
 *  the most-read strings in the product — and the contract/ modules where field hints are authored. */
export const FILES: readonly string[] = readdirSync(ROOT, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(e.name, `${e.name}/`) : /\.tsx?$/.test(e.name) ? [e.name] : []))
  .sort()

/** Source with comments blanked — a comment explaining a term is not the product saying it.
 *
 *  LINE-COUNT PRESERVING, on purpose. Deleting comment lines shifts every line number after them, and a
 *  guard that reports `NewClearance.tsx:623` for a string that lives at `:880` sends its reader to the
 *  wrong place — which is worse than not reporting a line at all. Block comments keep their newlines. */
export const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((l) => (/^\s*(\/\/|\*)/.test(l) ? '' : l))
    .join('\n')

export const readSrc = (file: string): string => readFileSync(join(ROOT, file), 'utf8')

const SVG_PATH = /^[MmLlHhVvCcSsQqTtAaZz\d\s.,+-]+$/          // "M12 2 2 7l10 5…" is not English
const CODE_PUNCT = /[;={}()[\]<>|&$\\]|=>|\+\+/
const CSS_CLASSES = /^[a-z][a-z0-9-]*( [a-z][a-z0-9-]*)+$/    // "start-pill start-pill-saved"

const isProse = (t: string): boolean =>
  t.length > 2 && /[A-Za-z]{2}/.test(t) && !SVG_PATH.test(t) && !CODE_PUNCT.test(t)
  && !CSS_CLASSES.test(t) && !/^\//.test(t)
  && !/\b(const|return|useState|readonly|import|export|null|undefined)\b/.test(t)

export function uiStrings(file: string): string[] {
  const src = stripComments(readSrc(file))
  const out: string[] = []
  for (const m of src.matchAll(/(^|[^=!<>-])>([^<>{}]*)</g)) {
    const t = m[2].replace(/\s+/g, ' ').trim()
    if (isProse(t)) out.push(t)
  }
  for (const m of src.matchAll(/(['"`])([^'"`\n]{4,})\1/g)) {
    const t = m[2].replace(/\s+/g, ' ').trim()
    if (/ /.test(t) && /[a-z]/.test(t) && isProse(t)) out.push(t)
  }
  return out
}
