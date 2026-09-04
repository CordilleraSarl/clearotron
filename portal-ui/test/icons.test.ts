// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Every icon name used in a screen must exist.
//
// Icon renders NOTHING for an unknown name — deliberately, because an icon should never be the reason a
// screen fails to paint. The cost of that choice is that a typo is invisible: no error, no warning, no
// broken glyph, just a missing icon that a person reading the code will not notice either. This test is
// the other half of that decision.
//
// It caught `chevron-right` (the set calls it `chevron`) on the Projects screen, after a full typecheck
// passed — the prop is a plain string, so the compiler has nothing to say about it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const SRC = new URL('../src/', import.meta.url).pathname

/** Walk the source tree. Small enough that a recursive read beats pulling in a glob dependency. */
function sources(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...sources(p))
    else if (/\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}

test('every <Icon name="…"> in the codebase resolves to a real path', () => {
  const icon = readFileSync(join(SRC, 'components/Icon.tsx'), 'utf8')
  const known = new Set([...icon.matchAll(/^\s+'?([a-z-]+)'?:\s*'M/gim)].map((m) => m[1]))
  assert.ok(known.size > 5, `the icon set should be readable — found ${known.size}`)

  const missing: string[] = []
  for (const file of sources(SRC)) {
    if (file.endsWith('components/Icon.tsx')) continue
    const src = readFileSync(file, 'utf8')
    // Only literal names can be checked. A computed name (icon={e.icon} from the nav config) is covered
    // by the nav test below instead.
    for (const m of src.matchAll(/<Icon\s+name="([^"]+)"/g)) {
      if (!known.has(m[1])) missing.push(`${file.replace(SRC, '')}: "${m[1]}"`)
    }
  }
  assert.deepEqual(missing, [], `unknown icon names render as nothing:\n${missing.join('\n')}`)
})

test('every icon named in the navigation config exists', () => {
  // The sidebar passes these through as a variable, so the literal-name scan above cannot see them —
  // and a missing one here is worse: a nav entry with no icon at all.
  const icon = readFileSync(join(SRC, 'components/Icon.tsx'), 'utf8')
  const known = new Set([...icon.matchAll(/^\s+'?([a-z-]+)'?:\s*'M/gim)].map((m) => m[1]))
  const nav = readFileSync(join(SRC, 'nav/nav.config.ts'), 'utf8')

  const used = [...nav.matchAll(/icon:\s*'([^']+)'/g)].map((m) => m[1])
  assert.ok(used.length > 3, 'the nav config should declare icons')
  for (const name of used) assert.ok(known.has(name), `nav icon "${name}" does not exist`)
})
