// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
import type { ReactNode } from 'react'

/**
 * ONE HEADER LINE PER PAGE, AND ONE AUTHOR OF IT.
 *
 * Every screen used to open with an eyebrow and a heading, hand-styled in place: `People` over
 * `People`, `Custom searches` over `Custom searches`, `Home` over `Now`. Two lines saying one thing
 * is not a header, it is a header and its echo — and because each screen wrote its own, the size,
 * the spacing and the colour drifted between them as well.
 *
 * So: the title is the page's name, once, in the words of the rail item that leads here, and nothing
 * sits above it. `lede` is for a sentence that says something the title does not — never a restatement
 * of it, which is the thing this component exists to stop. `actions` is the page's own controls, kept
 * on the header row so a reader finds them where the page starts rather than inside a band further
 * down.
 *
 * WHY THIS IS A COMPONENT AND NOT A RULE. A rule about header markup is followed by the screens that
 * existed when it was written. Ten screens each carrying `fontSize: 27` inline is how the rule was
 * held before, and two of them had already drifted to different margins by the time anybody counted.
 */
export function PageHeader({
  title,
  lede,
  actions,
}: {
  /** The page's name, in the rail's own words where the rail leads here. */
  readonly title: ReactNode
  /** A sentence the title does not already say. Omit it rather than restate the title. */
  readonly lede?: ReactNode
  /** The page's controls — primary last, so the strongest action sits at the end of the row. */
  readonly actions?: ReactNode
}) {
  return (
    <header className="page-header">
      <div className="page-header-text">
        <h1 className="page-title">{title}</h1>
        {lede ? <p className="page-lede">{lede}</p> : null}
      </div>
      {actions ? <div className="page-header-actions">{actions}</div> : null}
    </header>
  )
}
