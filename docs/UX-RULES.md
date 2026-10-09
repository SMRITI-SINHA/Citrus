# CITRUS Trade UX rules (from the research playbook)

Full playbook with sources: https://claude.ai/code/artifact/202a15f0-8acd-434d-af2e-eea324c8ea3d
Reference implementation of the look and flows: `docs/reference-demo.html` (single-file clickable demo approved by Smriti). The React app must match or beat it.

## Brand and look
- Premium, production-grade: Inter for headings, UI and codes (the face Shopify Polaris, Linear, Flipkart and Udaan load; checked 9 Oct 2026), Noto Sans Devanagari for Hindi. Semibold headings with tight tracking, no display serif. Deep navy `#0F1B2D` hero panels, ink `#111312`, warm off-white `#F3F4F3`, a single citrus accent `#E5A50A` used sparingly. Light and dark themes.
- Real CITRUS photography only (see `apps/web/public/photos/README.md`). No drawn garments.
- CITRUS tagline "Defining Modern Menswear with Classic Elegance" on sign-in only. Retailer copy is plain trade language.
- Every screen size: phone (bottom tab bar), tablet/desktop (side rail). No horizontal scroll. Safe-area insets. Touch targets ≥ 44px.
- English numerals, lakh grouping (₹1,20,000). Colours always shown as swatches. English/Hindi toggle always visible.

## Retailer journey
1. **Activation**: QR/link opens a store card (store, city, code, GSTIN, distributor) → mobile → OTP with auto-read, "Resend code", "Get the code on a call". Unknown numbers never create accounts.
2. **Home**: greeting, active-order strip (says "Your answer needed" when changes are proposed), search with voice button, hero "Reorder last order", Buy again (last 3 orders, shows skipped sizes), Recommended (with one-line reason), New styles (more points), Complete the look, Rewards progress ("220 points away from Air fryer").
3. **Catalogue**: search (Hinglish tolerant), category chips, filters sheet, sort sheet ("Best for your store", "Most available", "New first", "Most points"), "Coming soon" season preview locked. Tiles show size·stock chips and a + quick-add button.
4. **Product / quick add grid** (never make buyers tap + 50 times):
   - Typed input per size with −/+ either side, numeric keypad, select-on-focus, Enter moves to next size, cap at live stock with inline note "Only 13 available, set to 13".
   - "Total pieces" field + "Split by my ratio" (1:3:3:2:1, overflow redistributed to sizes with stock).
   - Set chips (1/2/3 sets), "Same as last order", "Clear", "Add these sizes in all N colours".
   - "Last order n" per size, stock meter per size, exact counts ("L · 13 available", "Only 3 left").
   - Sticky bar with live pieces · value · points and Add to cart. No "Update" buttons anywhere.
5. **Cart** (a working order, edit everything in place): every size of each style is a typed cell with live stock; 0 removes; colour dropdown moves quantities; "Add colour"; "Split a total"; remove with Undo toast; per-line totals; summary updates live; optional note and optional PO; Share cart on WhatsApp; phone has sticky bottom bar with total + Place order; autosaved server-side.
6. **Place order**: server re-checks stock; if it changed, show a blocking "Availability changed" note with per-line "Update to n" / "Remove this size". Button locks while placing (no double orders).
7. **Placed**: order number, "is with <distributor>", note/PO echo, Track order, Download PDF, "What happens next" 3 steps.
8. **Orders**: list with status badges; detail with vertical timeline (retailer labels), WhatsApp log, items grouped by style; distributor changes shown as per-line `old → new` with impact and net change, Accept changes / Cancel order, "reminder after 24h, never auto-cancelled".
9. **Rewards**: big points number, progress bar to next tier, tiers list, points per product everywhere.

## Distributor
- Queue cards decidable without opening: store, town, pcs, styles, value, note, "Waiting 3h 10m" (info < 2h, amber 2–4h, red > 4h). Auto-advance after a decision.
- Order panel: WhatsApp preview with Approve/Modify/Reject, items grouped, retailer credit (limit, outstanding, overdue from Ginesys), "stock held in Ginesys" note.
- Modify: typed quantities, can only reduce, mandatory reason chips. Reject: mandatory reason chips.

## Admin
- Alerts strip first (sync failed, approvals past SLA, activations to verify, low NOS sizes), KPI cards with sparklines (6), live orders table (retailer label vs Ginesys status, tabular numbers), top styles bars, sell-in by region, exceptions with "Retry now", low stock table, image QA.

## Interaction rules
- Errors that need action are inline, never only a toast. Toasts confirm; destructive actions offer Undo.
- Status badges: short, sentence case, colour + dot.
- Never show an ambiguous "processing" screen; show what is happening ("Checking live stock…", "Placing order…").
- Optimistic UI for cart edits with server reconciliation (debounce ~300ms, version numbers).

## Designing for buyers used to face-to-face and phone ordering (Smriti, 8 Oct)
Retailers and distributors today order by talking to a salesman or calling. The app must feel like that conversation, only faster:
- **A person is always one tap away**: "Call Imran (your CITRUS rep)" and "WhatsApp us" on home, product, cart and every error. HUL Shikhar kept the salesman in the loop (mirror app) rather than replacing him.
- **Panels**: only three for now: Retailer, Distributor, CITRUS Admin. A salesperson panel may come later; keep the role model extensible (role enum) but build no salesperson UI.
- **Talk like the salesman**: "Your usual", "Same as last time", "Want the trouser that goes with this?", not system words. Confirm in human terms: "Malabar Trade Links will check it today".
- **Start from what they already buy**: home opens on Buy again / Your usual with one-tap reorder; past offline orders from Ginesys appear too.
- **Voice and Hinglish search**, big tap targets, English numerals, swatches, Hindi toggle; nothing hidden behind a hamburger.
- **Reassure at every irreversible step**: what happens next, who acts, when they'll hear back on WhatsApp. No surprise changes: every change is shown and needs their OK.
- **Forgiving**: Undo on removes, autosaved cart, a lost connection never loses the cart, a double tap never makes two orders.
