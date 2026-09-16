// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A row's secondary actions, behind one "More actions" button.
//
// Retiring a search template and archiving a project are rare, reversible, and not what anyone opens a
// list to do. Drawn as buttons on every row, they stood level with Edit and with the row itself; in the
// row's menu they are one press further away and still one press from being undone.
//
// The menu is the same shape as the report screen's Ask AI and Export menus: a `.float` list of menu
// items under its button, closed by a press outside it or by Escape.
import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon.tsx'

export type RowAction = { readonly label: string; readonly onSelect: () => void }

export function RowMenu({ actions, disabled = false }: { readonly actions: readonly RowAction[]; readonly disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // A menu with nothing in it is a button that opens nothing. The caller decides who gets which actions;
  // a reader who may take none of them gets no button.
  if (!actions.length) return null

  return (
    <div ref={box} className="actions-menu">
      <button
        type="button"
        className="icon-btn actions-menu-button"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="more" size={18} />
      </button>
      {open ? (
        <div className="float actions-menu-list" role="menu">
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              role="menuitem"
              className="nav-item"
              onClick={() => { setOpen(false); a.onSelect() }}
            >
              {a.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
