// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A sentence whose backtick pairs are a literal the reader types, drawn as code.
//
// The server's refusal to the person who runs an install names the command that sets it up in backticks, as the
// terminal prints it. Nothing else in the text is interpreted, so a sentence can never carry markup the page trusts.
export function Ticked({ text }: { readonly text: string }) {
  const parts = text.split(/(`[^`]+`)/g).filter((p) => p !== '')
  return (
    <>
      {parts.map((p, n) =>
        p.length > 2 && p.startsWith('`') && p.endsWith('`') ? <code key={n}>{p.slice(1, -1)}</code> : <span key={n}>{p}</span>)}
    </>
  )
}
