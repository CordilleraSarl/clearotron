// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// portal-routes/me.mjs — who the signed-in reader is and what they may do (/portal/api/me), the about page's facts, and
// the searches an account can order.
//
// One of the portal service's route groups, moved out of its dispatcher unchanged; makePortalService says how it asks them.
import { ADMINISTRATOR_CONTACT, ORGANISATION_NAME } from "../../shared/brand.mjs";
import { browserCommand, installRoute } from "../../shared/invocation.mjs";
import { productIdentity } from "../../shared/product-identity.mjs";
import { assertPrincipal, principalView, seesEverything } from "../portal-access.mjs";
import { flagView } from "../portal-config-view.mjs";
import { concurrentRunsCap } from "../portal-runs.mjs";

export async function meRoutes({ poolRoot, stopControl, demo, orderRefusal, loadProfilesImpl, searchesFor, engineProgramDisputed, INSTALL_CHANNEL, refusalFor }, { method, parts, principal, grantsHere, query }) {
  // /portal/api/me
  if (parts[1] === "api" && parts[2] === "me" && method === "GET") {
    assertPrincipal(principal, { door: true });   // door check only — a multi-account client enters and gets the picker list
    // `accountNames` — the DISPLAY name of each account this identity holds, and nothing else.
    //
    // Every profile carries a name ("Vantor Labs", "Foxglade Interactive"); the account KEY is a
    // slug ("vantor"). Staff read names because the account picker fetches the staff-only
    // roster; a client had no name source at all, so the identical screen printed the slug at them.
    // The same brand owner therefore read two different ways depending on who signed in, which is
    // what this field ends.
    //
    // SCOPED TO THE GRANTED ACCOUNTS, never the roster. A name map covering everything would put
    // Cordillera's customer list on the one route every signed-in identity can reach — the exact
    // leak /profiles is never proxied for (portal-upstream: "a client reaching it would learn the
    // customer base"). `"*"` identities get {} and keep using the roster, which is staff-gated.
    //
    // `accountFacts` rides in the SAME loop, under the SAME scoping decision, for the same reason
    // the names do: the pick panel shows industry, marketplace count and territories per company,
    // and a client with several grants meets that panel. One loop, so there is one answer to
    // "which accounts may this identity learn about" rather than two that can drift apart. A `"*"`
    // identity gets {} here exactly as it does for names and keeps reading the staff-only roster.
    let accountNames = {};
    let accountFacts = {};
    let meRoster = null;   // read once for this answer: the names below and the house marketplaces
    // GENERIC IS NAMED TOO when the person sees an organisation's Generic. It is not a company, so it is
    // never in `accounts`, and without a name here the switcher printed the raw key at everyone below
    // everything. An organisation with no company yet is the case with an empty `accounts`, so the
    // guard is on the names to look up, not on the company list.
    const named = Array.isArray(principal.accounts)
      ? [...principal.accounts, ...(principal.genericOrgs?.length ? ["generic"] : [])] : [];
    if (named.length) {
      try {
        const { companyFactsOf } = await import("../profiles.mjs");
        const profiles = meRoster = await loadProfilesImpl();
        for (const key of named) {
          const profile = profiles.get(key);
          const name = profile?.name;
          if (typeof name === "string" && name) accountNames[key] = name;
          if (profile) accountFacts[key] = companyFactsOf(profile);
        }
      } catch {
        // A name is a nicety; the door is not. An unreadable profile store must not lock a user
        // out of the portal, so this degrades to the keys the UI already falls back to.
        accountNames = {};
        accountFacts = {};
      }
    }
    // HOW MANY RUNS THIS DEPLOYMENT EXECUTES AT ONCE. Deployment-wide, not account-scoped, which is
    // why it rides here rather than on /usage: it is the same number for everyone, /me is fetched
    // once by every screen, and a multi-brand account has no single /usage to read it from.
    //
    // Home states it in its section header. It was written into the UI as a literal `2` — right on
    // the day, and silently wrong the moment CLEAROTRON_MAX_CONCURRENT_RUNS is set to anything else,
    // which is exactly the shape of over-promise this screen exists to avoid.
    // WHO OPERATES THIS DEPLOYMENT. The portal named the operator in three places as a
    // string literal — the role label was the operator's own name, which a fork would have shipped
    // about a company it has nothing to do with. `CLEAROTRON_BRAND_NAME` has been the brand seam all
    // along and TRADEMARKS.md already listed portal nav as a consumer; it simply was not one.
    // Riding on /me because that is where the ROLE comes from, and the label is role plus operator.
    // WHICH MODE THIS INSTALL IS. Same rationale as concurrentRuns above: it is the
    // same answer for everyone, /me is fetched once by every screen, and the screen that needs it
    // most — New clearance — has no other deployment-wide source.
    //
    // READ, NEVER COMPUTED. This process deliberately has no engine environment (see this file's
    // own header, three times over), so `engineInventory(process.env)` here would report demo on
    // every install — a confident wrong answer. `flagView` reads the snapshot `bin/start.mjs`
    // writes at boot and derives the mode from `binaryPresent`, which that snapshot already
    // carries. NULL when there is no snapshot to read, and null means THIS CANNOT ANSWER — the UI
    // must leave the button alone rather than infer demo from an absent file.
    // READ ONCE. The payload names it and the program reading below is gated on it; two calls to
    // `flagView` here would be two reads of the same file that could disagree with each other.
    //
    // A DEMO ANSWERS NULL. No order in a demo reaches an engine: the run route below resolves each one
    // to the finished example for the search picked (`if (demo)`), which is what the demo's banner
    // promises. The demo's snapshot still describes the machine, so on a machine with no engine program
    // this read "demo", and New clearance drew the no-engine notice where Review search belongs: the
    // one flow the demo exists to show could not be started. Null leaves the button alone, as it does
    // on a fresh install, and the configuration page still reads the snapshot for itself.
    const meEngineMode = demo ? null : flagView(poolRoot).engineMode;
    const searchRefusal = demo ? null : await orderRefusal();
    // THE HOUSE MARKETPLACES, offered as suggestions wherever a company's marketplaces are edited. A new
    // company starts with none (the owner's ruling of 2026-09-23) and somebody picks; these are the
    // Generic default's own list, read from the store so an install that changed it offers its own.
    // Deployment-wide and the same for everyone, like concurrentRuns. [] when the store cannot be read:
    // the box still takes any marketplace typed into it.
    let houseMarketplaces = [];
    try {
      const house = (meRoster ?? await loadProfilesImpl()).get("generic")?.platforms;
      if (Array.isArray(house)) houseMarketplaces = house.filter((d) => typeof d === "string" && d.trim());
    } catch { /* a suggestion list is a nicety; the door is not */ }
    return { status: 200, json: { email: principal.email, ...principalView(principal, grantsHere, accountNames),
      accounts: principal.accounts, accountNames, accountFacts,
      concurrentRuns: concurrentRunsCap(), brand: ORGANISATION_NAME, engineMode: meEngineMode, houseMarketplaces,
      // WHERE A PERSON ASKS FOR A CHANGE TO THEIR SIGN-IN, beside the brand and read where it is read:
      // an href Preferences links "Clearotron administrator" to, or null, and then the words are plain.
      administratorContact: ADMINISTRATOR_CONTACT,
      // WHETHER THE PROGRAM IS ON THIS BOX WHILE THE ENGINE CANNOT SEE IT — true, false, or null
      // for "this could not be checked". The screen above renders one of three remedies from it,
      // and they are different remedies: install the CLI, restart the service that cannot see it,
      // or the general advice when nothing could be read. Only `engineMode: "demo"` can make this
      // anything but false; see `engineProgramDisputed`.
      engineProgramDisputed: await engineProgramDisputed(meEngineMode),
      // WHETHER THIS INSTALL CAN RUN A SEARCH AT ALL, by the runner's own order-time test (`orderRefusal`), and when
      // it cannot, the refusal the review would give this person: Home shows it in place of its invite, and New
      // clearance shows it and holds its start, so nobody fills in a search the install would refuse. A demo walks
      // its own ordering flow, so it reads as able.
      canSearch: !searchRefusal,
      ...(searchRefusal ? { searchRefusal: refusalFor(principal, searchRefusal) } : {}),
      // HOW THIS INSTALL ARRIVED, so a screen can name the setup command the reader can actually
      // type. `npm run setup` and `npx clearotron install` are the same wizard and each one is
      // unrunnable on the other route; the no-engine notice named one of them and was wrong for
      // half its readers. A WORD, never a command line and never a prefix: `invocationForm` can
      // answer with this machine's absolute path, and this value is rendered in a browser.
      setupRoute: installRoute(),
      // WHICH RELEASE CHANNEL THIS INSTALL CAME FROM, read off its own version as `update` reads it, so the
      // setup command a screen names fetches this channel. `npx clearotron install` fetches the stable, and
      // the stable's setup then moves itself into ~/.local over a beta. A WORD, like the route above.
      channel: INSTALL_CHANNEL,
      // THE COMMAND THAT FILES AN ORGANISATION, for the screen that cannot create a company without one.
      // `browserCommand`'s rule: no path on this machine, and from npx's cache the published version
      // rather than a bare name that reader does not have.
      organisationCommand: browserCommand('start --organisation "<name>"'),
      // — a button that always fails must not render as available. The reason is
      // operator-shaped and staff-only; a client reads the generic sentence the button carries.
      controls: { stop: { available: stopControl.available !== false,
        reason: seesEverything(principal) ? (stopControl.reason ?? null) : null } } } };
  }
  // /portal/api/about — the AGPL §13 source offer ()
  //
  // UNAUTHENTICATED, DELIBERATELY, and it is the only route here that is. §13 obliges an operator
  // running a modified version to offer the source to the users interacting with it — the offer is
  // owed to whoever reaches the service, and a licence notice you must first sign in to read is not
  // an offer. Nothing here is private either: the product's name, its version, its licence and the
  // commit it is running are all facts about code that is published under a licence requiring
  // exactly that. The sha is not a secret; it is the thing being offered.
  //
  // SERVED, NOT BUILT. The bundle cannot carry its own commit — portal-ui/dist is committed and CI
  // fails when dist and source disagree, so a hash baked in at build time is not known until after
  // the commit that would carry it. The server knows what it is running; the page asks.
  if (parts[1] === "api" && parts[2] === "about" && method === "GET") {
    return { status: 200, json: productIdentity() };
  }
  // /portal/api/searches
  if (parts[1] === "api" && parts[2] === "searches" && method === "GET") {
    const account = assertPrincipal(principal, { account: query.account ?? null });
    if (!account) return { status: 400, json: { error: "name an account (?account=)" } };
    return { status: 200, json: { account, ...searchesFor(account, principal) } };
  }
  return undefined;
}
