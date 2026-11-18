// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The engine's prose carries markdown, and this is how the portal reads it without ever building HTML.
//
// WHY THERE IS ANY MARKDOWN TO READ. The assessment paragraphs are model-authored, and the model writes
// markdown because every other surface it feeds renders markdown — `driver/publish/render-knockout.mjs`
// says exactly that above its own `inlineMd`, which it added after a delivered summary reading
// "BRIMSTONE rates **High (Classes 9, 28, 41)**." printed its asterisks verbatim to a client. The reports
// have rendered it ever since. A portal that showed the same sentence with the asterisks in it would be
// two surfaces disagreeing about one paragraph.
//
// WHY SPANS AND NOT HTML. The obvious way to match the reports is to run the same string replacement and
// set the result as innerHTML — and `portal-ui/test/no-danger.test.ts` closes that door for the whole
// bundle, correctly: this prose is model-authored and reaches the browser from the wire, so an HTML path
// here is a stored-XSS path on a client's legal opinion. Returning SPANS means the screen renders text
// nodes, React escapes every one of them, and no string in this file is ever markup. `<script>` in an
// assessment renders as the characters `<script>`, which is what a reader should see.

/** The four inline forms the engine's renderers honour (shared/inline-markdown.mjs). Anything else is prose. */
export type InlineStyle = 'link' | 'strong' | 'em' | 'code'

export type InlineSpan = {
  readonly text: string
  /** Null means plain prose — the common case, and the reason this is nullable rather than a list. */
  readonly style: InlineStyle | null
  /** A link's target, on a `link` span only: http(s) or mailto, never anything that runs. */
  readonly href?: string
}

// The forms, IN THE ORDER shared/inline-markdown.mjs applies them: links, then bold, so the inner asterisks of a
// `**bold**` run are never read as a pair of italics. One alternation rather than four passes, which keeps the
// precedence in one place instead of in the order of four statements.
const INLINE = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`/g

// THE REPORTS' LINK GUARD, mirrored. http(s) and mailto become links; any other scheme (javascript:, data:, …) is the
// label as prose. An in-page `#` anchor, which a report page can land on, has nothing to land on here, so it is prose
// too. A label is text: the reports run their emphasis over a link's label, and this does not, as with nesting below.
const isLinkTarget = (href: string) => /^https?:\/\//i.test(href) || /^mailto:/i.test(href)

// Provenance honesty, as the reports apply it: a 'Corsearch · <name>' label on a link that is NOT a Corsearch page
// names the link's real host instead — a storefront must never read as the register vendor's record.
function linkLabel(label: string, href: string): string {
  const vend = /^(Corsearch)\s*·\s*(.+)$/i.exec(label)
  if (!vend || !/^https?:\/\//i.test(href) || /corsearch\./i.test(href)) return label
  try {
    return `${new URL(href).host.replace(/^www\./, '')} · ${vend[2]}`
  } catch {
    return label
  }
}

/**
 * One paragraph of engine prose, as spans to render.
 *
 * NESTED EMPHASIS IS NOT CLAIMED, and the divergence is pinned by a test rather than left to be
 * discovered. `***x***` renders as italic-bold in a report and as bold between two literal asterisks
 * here, because the report's second pass runs over a string that already contains the first pass's tags
 * and this one does not. The composer does not write nested emphasis; if it starts, the pinned test is
 * what will say so.
 *
 * An unmatched marker is prose and stays visible — `2 * 3` is a multiplication, not an unterminated
 * italic, and swallowing the character would silently edit a client's document.
 */
export function inlineSpans(text: string): readonly InlineSpan[] {
  const src = String(text ?? '')
  const out: InlineSpan[] = []
  let at = 0
  INLINE.lastIndex = 0
  for (let m = INLINE.exec(src); m !== null; m = INLINE.exec(src)) {
    if (m.index > at) out.push({ text: src.slice(at, m.index), style: null })
    const [, label, href, bold, italic, code] = m
    if (label !== undefined && href !== undefined) {
      const text = linkLabel(label, href)
      out.push(isLinkTarget(href) ? { text, style: 'link', href } : { text, style: null })
    } else if (bold !== undefined) out.push({ text: bold, style: 'strong' })
    else if (italic !== undefined) out.push({ text: italic, style: 'em' })
    else out.push({ text: code as string, style: 'code' })
    at = m.index + m[0].length
  }
  if (at < src.length) out.push({ text: src.slice(at), style: null })
  return out
}
