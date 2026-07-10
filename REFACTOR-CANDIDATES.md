# Refactor candidates

Structural improvements spotted while porting `HomeLegacy.jsx` into the new
dashboard components on `feat/home-restructure`. Logged here instead of
applied — each one gets its own deliberate commit after Stage 1 is accepted,
not bundled into the port.

## 1. Collapse the optimisticBalance/optimisticIncome overlay into direct state patches

**Where:** `app/dashboard/HomeDashboard.jsx` (`displayAccount`/`displayIncome`
overlay + `balanceSaveRequestRef`) and `app/dashboard/components/BalanceEditor.jsx`
(balance/income save handlers).

**What:** `HomeLegacy.jsx` keeps `account`/`income` as the Firestore-canonical
values loaded once per user, and layers `optimisticBalance`/`optimisticIncome`
on top via a `displayAccount`/`displayIncome` memo — collapsed back to `null`
only on save failure. An initial pass at this port collapsed that into a
single state slot, patching `account`/`income` directly and reverting to a
manually-captured "previous value" on failure. Fewer state variables, same
visible behavior in the common case.

**Why not applied:** the split exists specifically so canonical account/income
state is only ever written by the normal Firestore load path — an in-flight
or failed write can never leave `account.currentBalance` (or `income`)
holding a number that was never confirmed saved. `balanceSaveRequestRef`
also guards against a stale save resolving after a newer one has already
started (e.g. the user edits balance twice in quick succession, or the tab
backgrounds mid-save). Collapsing the two state slots loses both guarantees.
`BalanceEditor` is also reused inside `SetupWizard`, so onboarding inherits
whatever this component does. Revisit only with an explicit plan for
replacing both guarantees, not as an incidental simplification while porting.
