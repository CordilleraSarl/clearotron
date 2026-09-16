// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Search templates — the named set-ups a company runs clearances under.
//
// A saved search is a name over two things: a DEPTH (which machinery runs) and a SCOPE (where it points).
// "Coastline Drinks knockouts — US focus" is exactly that: a quick screen, aimed at the US. Without the scope half
// it would only ever restate a level that is already one click away in the composer, which is why saving
// one is worth doing at all.
//
// THIS SCREEN LISTS AND RETIRES. IT DOES NOT BUILD.
//
// It used to carry its own editor: a second form, with its own depth picker, its own scope fields and its
// own idea of what a search is. That is the same form New clearance is, and once the composer learned to
// Save as search the two were duplicates — one of which quietly stopped receiving the design work the
// other got, which is exactly how "Create one" came to land on a page that looked a year older than the
// rest of the product. So the editor is gone and both roads lead to the composer: New builds one, Edit
// opens the existing one over the same levers. There is one place a search is described, and it is the
// place where you can see what it costs.
//
// TWO WORDS ARE HELD APART HERE, as they are in the engine:
//
//   LABEL — what the customer called this set-up. The only thing displayed.
//   NAME  — a profile key: the company's own legal identity. Belongs to a different record entirely,
//           and the backend keeps the two key sets provably disjoint so they can never be conflated.
//
// RETIRED, NEVER DELETED is a rule of the record, not of the UI. A saved search that produced a report is
// part of how that report came to say what it says; destroying it would orphan the reasoning. There is no
// delete door here because there is none in the engine either — retiring is a save carrying archived:true,
// and it is reversible from this screen, which is the half that was missing.
//
// WHICH LIST THIS READS MATTERS. `api.searches` is the COMPOSER's menu and filters retired rows out
// server-side; drawn from it, this screen could show a retired search neither as present nor as
// restorable, so retiring one would have made it vanish for good. `api.savedSearches` is the config
// surface: it carries `archived`, `version` and `updatedAt`, which is what a screen that MANAGES these
// rather than picks between them actually needs.

import { useState } from 'react'
import type { Product, SavedSearchRow } from '../contract/api.ts'
import { api, isOk, notCommitted } from '../contract/api.ts'
import { statusFor, isUsable, displayLabel, versionLabel, sortSavedSearches } from '../contract/savedSearches.ts'
import type { SavedSearchStatus } from '../contract/savedSearches.ts'
import { draftFromSaved } from '../contract/composerProduct.ts'
import { useLoad } from '../state/useApi.ts'
import type { ShellContext } from '../shell/AppShell.tsx'
import { CompanyGate } from '../shell/CompanyPicker.tsx'
import { NewCompanyButton } from '../shell/NewCompanyButton.tsx'
import { canRun } from '../shell/permissions.ts'
import { PageHeader } from '../components/PageHeader.tsx'
import { RowMenu } from '../components/RowMenu.tsx'

export function SavedSearches({ ctx }: { readonly ctx: ShellContext }) {
  // Who this is FOR — resolved exactly as the composer resolves it. A staff member acting for a client
  // sees that client's saved searches, and a single-account client sends null and has it resolved
  // server-side. This screen never decides tenancy; it only says who it is asking about.
  const account = ctx.owner
  const needsOwner = ctx.me.allAccounts && account === null

  const { result, reload } = useLoad(() => api.savedSearches(account), [account])
  // The OFFERING, for the "Builds on" column. A separate call because it is a different question — what
  // this deployment offers, as against what this company has saved — and a refusal of one must not
  // blank the other.
  const { result: menu } = useLoad(() => api.searches(account), [account])
  const levels: readonly Product[] = menu?.kind === 'ok' ? menu.value.products : []

  const [busy, setBusy] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  if (needsOwner) return <PickCompany ctx={ctx} />

  // Every non-ok shape is handled BEFORE the empty state, and the ordering is the whole point.
  //
  // The tidy-looking version of this screen reads the rows out with `result?.kind === 'ok' ? … : []` and
  // then renders "no saved searches yet" when the list is short. On a listing screen that turns every
  // refusal — a rate limit, a 404, a dropped tunnel, a staff identity that has not named an account —
  // into a confident statement that this company has none.
  if (!result) return <div className="screen" />
  if (result.kind === 'pickAccount') return <PickCompany ctx={ctx} />

  // A PERMANENT STATE IS NOT A TRANSIENT ONE, and this screen used to say the same sentence about both.
  // Saved searches can be switched off by configuration — the deployment answers 404 deliberately, and
  // its boot log already carries the exact reason. "Try again shortly" is advice that can never work,
  // and it left the reader with no way to learn that a setting is wrong.
  if (result.kind === 'featureOff') {
    return (
      <div className="screen">
        <Heading ctx={ctx} onNew={null} />
        <div className="notice">
          <b>Search templates are switched off on this installation</b>
          <p style={{ margin: '6px 0 0', color: 'var(--text-muted)' }}>
            Nothing has been changed or lost, and nothing you do here will turn them on — this is a
            setting on the server rather than a fault.
          </p>
          {/* STAFF ONLY, and it arrives null for anyone else because the server withholds it: it names
              environment variables and paths on the server, and a client can reach this screen. */}
          {result.detail ? (
            <p style={{ margin: '10px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>{result.detail}</p>
          ) : (
            <p style={{ margin: '10px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>
              Ask whoever runs this installation to enable them.
            </p>
          )}
        </div>
      </div>
    )
  }

  if (result.kind !== 'ok') {
    return (
      <div className="screen">
        <Heading ctx={ctx} onNew={null} />
        <div className="notice">
          <b>{result.kind === 'rateLimited' ? 'Too many requests just now' : 'Search templates could not be loaded'}</b>
          <p style={{ margin: '6px 0 0', color: 'var(--text-muted)' }}>
            {result.kind === 'rateLimited'
              ? 'The portal is pacing requests. Try again in a minute.'
              : 'Nothing has been changed or lost. Try again shortly.'}
          </p>
        </div>
      </div>
    )
  }

  /**
   * Retire, or bring back.
   *
   * A save REPLACES the record, so this reads the whole recipe back before flipping one flag. Composing a
   * patch from what the LIST carries would write a saved search stripped of everything this screen does
   * not display — its scope, its components, its notes.
   *
   * `archived: false` is sent EXPLICITLY to restore, and that is not belt and braces: recipe-service keeps
   * archive state sticky against omission, so only an explicit false brings one back.
   */
  const setRetired = async (row: SavedSearchRow, retired: boolean) => {
    setBusy(row.slug)
    setProblem(null)
    const full = await api.savedSearch(account, row.slug)
    if (!isOk(full)) {
      setBusy(null)
      setProblem('That could not be opened just now. Nothing has been changed.')
      return
    }
    const r = await api.saveSavedSearch(account, row.slug, 'save', {
      recipe: { ...full.value.recipe, archived: retired },
      // Naming the version this was based on turns a silent last-writer-wins clobber into a 409 that can
      // be acted on — someone may have edited it in the composer while this list sat open.
      expectedVersion: row.version,
    })
    setBusy(null)
    setConfirming(null)
    if (!isOk(r)) {
      setProblem(r.kind === 'conflict'
        ? 'Someone else changed this while the list was open. Reload and try again.'
        : `That could not be ${retired ? 'retired' : 'brought back'}. Nothing has been changed.`)
      return
    }
    // — live but uncommitted is a WARNING, not a failure: the change is on disk.
    const uncommitted = notCommitted(r)
    if (uncommitted) setProblem(uncommitted)
    reload()
  }

  const rows = sortSavedSearches(result.value)
  // Counted over the LIVE rows only: a retired search whose level is switched off is not a problem
  // anybody has, and reporting it as one would send someone looking for a fault in a search they
  // deliberately stopped using.
  const unusable = rows.filter((r) => !r.archived && !isUsable(statusFor(r, levels))).length

  // Building or editing a template happens on New clearance, which exists only for a person who
  // may start clearances. Without Run the list is still theirs to read — and every control that would
  // open the composer is absent rather than leading to a page that does not exist for them.
  const startNew = canRun(ctx.me) ? () => ctx.go('/portal/new') : null

  if (!rows.length) return <Empty ctx={ctx} onNew={startNew} />

  return (
    <div className="screen">
      <Heading ctx={ctx} onNew={startNew} />

      {unusable ? (
        <div className="notice" style={{ borderLeftColor: 'var(--tone-medium)' }}>
          <b>
            {unusable === 1
              ? 'One of these cannot be used as it stands'
              : `${unusable} of these cannot be used as they stand`}
          </b>
          <p style={{ margin: '6px 0 0', color: 'var(--text-muted)' }}>
            The search underneath is not available right now. The template itself is untouched — each
            row below says which one and why.
          </p>
        </div>
      ) : null}

      {problem ? (
        <div className="notice" style={{ borderColor: 'var(--tone-high)' }}>
          <b>{problem}</b>
        </div>
      ) : null}

      <div className="table-wrap" style={{ marginTop: 10 }}>
        <table className="data">
          <thead>
            <tr>
              <th>Search template</th>
              <th>Builds on</th>
              <th style={{ width: 90 }}>Version</th>
              <th style={{ width: 210 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              // The slug is the key half of `account/slug` and is unique; the label is free text and is
              // not, so the label would be an unstable React key on exactly the rows the sort had to
              // break a tie between.
              <SavedRow
                key={r.slug}
                recipe={r}
                products={levels}
                status={statusFor(r, levels)}
                busy={busy === r.slug}
                confirming={confirming === r.slug}
                onEdit={canRun(ctx.me) ? () => ctx.go(`/portal/new?search=${encodeURIComponent(r.slug)}`) : null}
                onRetire={canRun(ctx.me) ? () => (r.archived ? void setRetired(r, false) : setConfirming(r.slug)) : null}
                onConfirm={() => void setRetired(r, true)}
                onCancel={() => setConfirming(null)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** One saved search. A retired row is SHOWN, greyed — hiding it is what made retiring a one-way door. */
function SavedRow({
  recipe, products, status, busy, confirming, onEdit, onRetire, onConfirm, onCancel,
}: {
  readonly recipe: SavedSearchRow
  /** The offering, so the row can say whether the composer is able to state this record's product. */
  readonly products: readonly Product[]
  readonly status: SavedSearchStatus
  readonly busy: boolean
  readonly confirming: boolean
  /** Null for a person who may not start clearances: editing opens the composer, which is not theirs. */
  readonly onEdit: (() => void) | null
  /** Null without Run: retiring and bringing back are writes to the company's searches. */
  readonly onRetire: (() => void) | null
  readonly onConfirm: () => void
  readonly onCancel: () => void
}) {
  const version = versionLabel(recipe)
  // Whether the composer can state this record's product — decided from the base alone, which is all a
  // list row carries and all the answer depends on. A record it cannot state has no Edit button rather
  // than an Edit button that opens a form which would rewrite it; see draftFromSaved.
  const editable = draftFromSaved({ base: recipe.base }, products) !== null
  return (
    <tr style={recipe.archived ? { opacity: 0.55 } : undefined}>
      <td>
        {/* A label is customer-composed and routinely contains a brand, so it blurs with everything else
            the screen-share toggle blurs. A saved search called "SEAHORSE relaunch" is as disclosing as
            the mark itself. */}
        <b data-anon="mark" style={{ color: 'var(--text-strong)' }}>
          {displayLabel(recipe)}
        </b>
        {recipe.archived ? (
          <span className="pill" style={{ fontSize: 10.5, padding: '1px 7px', marginLeft: 8 }}>Retired</span>
        ) : null}
      </td>
      <td>
        <BuildsOn status={status} />
      </td>
      <td className="mono" style={{ color: 'var(--text-muted)', fontSize: 13 }}>
        {/* No version was ever assigned. An em-dash says that; "v1" would claim otherwise. */}
        {version ?? <span style={{ color: 'var(--text-faint)' }}>—</span>}
      </td>
      <td>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {confirming ? (
            <>
              {/* Two presses, and the second one names what it does. This is a confirm rather than a
                  warning because retiring is reversible from this same screen, one row up. */}
              <button
                type="button"
                className="pill"
                style={{ cursor: 'pointer', fontSize: 12, borderColor: 'var(--tone-high)' }}
                disabled={busy}
                onClick={onConfirm}
              >
                {busy ? 'Working…' : 'Confirm — retire'}
              </button>
              <button type="button" className="pill" style={{ cursor: 'pointer', fontSize: 12 }} onClick={onCancel}>
                Cancel
              </button>
            </>
          ) : (
            <>
              {onEdit && editable && !recipe.archived ? (
                <button type="button" className="pill" style={{ cursor: 'pointer', fontSize: 12 }} onClick={onEdit}>
                  Edit
                </button>
              ) : null}
              {/* RETIRE AND BRING BACK ARE IN THE ROW'S MENU. Edit is what a person comes to this list to
                  do; retiring is rare and reversible, and a button for it on every row stood level with
                  Edit. The menu holds whichever of the two the row can take. */}
              {onRetire ? (
                busy ? (
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Working…</span>
                ) : (
                  <RowMenu actions={[{ label: recipe.archived ? 'Bring back' : 'Retire', onSelect: onRetire }]} />
                )
              ) : null}
            </>
          )}
        </div>
      </td>
    </tr>
  )
}

/**
 * What this saved search sits on, and whether that still works.
 *
 * The three states are worded the way the composer words them, because a client meeting the same fact on
 * two screens should not have to work out that it is the same fact. In particular an unavailable level is
 * SHOWN with the server's own note rather than hidden: hiding it leaves someone with a saved search that
 * silently stopped working and no reason to ask about it.
 */
function BuildsOn({ status }: { readonly status: SavedSearchStatus }) {
  if (status.kind === 'unknownBase') {
    // The base key does not appear in the registry the server just sent, so we genuinely do not know what
    // this builds on — and the key itself is not an answer we are allowed to print. This is the honest
    // shape of "stored config outlived the level it named".
    return <span style={{ color: 'var(--text-muted)' }}>No longer available</span>
  }
  // THE PRODUCT, NAMED ONCE. Its stage label sat on a second line under the name, and the registry's
  // stage label IS the product's name now, so every row said one thing twice. Nothing replaces that line:
  // the listing carries no scope, and a second line invented from nothing would be worse than none. An
  // unavailable product keeps the server's own note under it — that is a different fact.
  if (status.kind === 'unavailable') {
    return (
      <span>
        <span style={{ color: 'var(--text-strong)' }}>{status.name}</span>
        <span style={{ display: 'block', fontSize: 12.5, color: 'var(--text-muted)' }}>{status.note}</span>
      </span>
    )
  }
  return <span style={{ color: 'var(--text-strong)' }}>{status.name}</span>
}

function Empty({ ctx, onNew }: { readonly ctx: ShellContext; readonly onNew: (() => void) | null }) {
  return (
    <div className="screen">
      {/* New template is in the header here too, so the empty list offers no second button for it. */}
      <Heading ctx={ctx} onNew={onNew} />
      <div className="notice">
        <b>No search templates yet</b>
        {onNew ? (
          <p className="prose" style={{ margin: '6px 0 0', color: 'var(--text-muted)' }}>
            A search template is a named set-up — which search, and how deep it goes. Build one on New
            clearance: set the search up, see what it costs, then press <b>Save as template</b>. It becomes a
            single choice the next time, instead of a form to fill in the same way every time.
          </p>
        ) : (
          <p className="prose" style={{ margin: '6px 0 0', color: 'var(--text-muted)' }}>
            A search template is a named set-up — which search, and how deep it goes. None has been saved
            for this company.
          </p>
        )}
      </div>
    </div>
  )
}

function PickCompany({ ctx }: { readonly ctx: ShellContext }) {
  return <CompanyGate ctx={ctx} heading="Search templates" line="Pick a company to see its search templates." />
}

/**
 * The screen's own title, and its controls. The company is named in the rail, and once is enough.
 *
 * NEW TEMPLATE IS THE PAGE'S PRIMARY BUTTON, in the header; it sat in a pill row floating at the right
 * above the table. `+ New company` is beside it and secondary. `onNew` is null for a person who may not
 * start clearances — templates are built on New clearance, which does not exist for them — and on the
 * states where there is no list to add to.
 */
function Heading({ ctx, onNew }: { readonly ctx: ShellContext; readonly onNew: (() => void) | null }) {
  return (
    <PageHeader
      title="Search templates"
      actions={
        <>
          <NewCompanyButton ctx={ctx} />
          {onNew ? (
            <button type="button" className="btn-primary btn-sm" onClick={onNew}>
              New template
            </button>
          ) : null}
        </>
      }
    />
  )
}
