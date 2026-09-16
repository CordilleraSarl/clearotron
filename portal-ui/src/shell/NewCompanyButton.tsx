// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// `+ New company` on the three Company settings pages — one control, drawn in one place.
//
// THE ONLY ROUTE TO MAKING A COMPANY, ONCE ONE IS SELECTED, used to live on the pick panel alone, and
// choosing a company is exactly what hides that panel. The Company settings pages are where somebody
// already is when they think of it, so each carries it in its header — as a secondary outline button,
// beside the page's own primary action where it has one, because making a company is not what these
// pages are for.
//
// One component rather than three copies, so the three pages cannot come to disagree about who may create
// or where it goes: the gate is `canManage` and the destination is the path the pick panel and the rail
// switcher use.
import type { Permissions } from '../contract/api.ts'
import { canManage } from './permissions.ts'
import { NEW_COMPANY_PATH } from './CompanyPicker.tsx'

export function NewCompanyButton({
  ctx,
}: {
  readonly ctx: { readonly me: { readonly permissions: Permissions }; readonly go: (path: string) => void }
}) {
  if (!canManage(ctx.me)) return null
  return (
    <button type="button" className="btn-ghost btn-sm" onClick={() => ctx.go(NEW_COMPANY_PATH)}>
      + New company
    </button>
  )
}
