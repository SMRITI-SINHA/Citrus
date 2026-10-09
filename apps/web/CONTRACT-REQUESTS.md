# Contract requests from apps/web

The coordinator has shipped round 1 (see the end of this file). These items are still open.

## Open

1. **`reservationRef` reaches retailers.** The contract says it is admin only, but `GET /api/orders/:id` with a retailer token returns `erp.reservationRef`. The web ignores the field, but the API should not send it.
2. **Unauthorised SO number before approval.** At `review`, a retailer's order already has `erp.soNumber` (the stand-in holds stock on an unauthorised SO). The `reserved` event message tells the retailer about it too: "Stock reserved in Ginesys (SO/KL/…)". The web shows the SO number to retailers only from `confirmed` onwards (`soShown()` in `src/state/orders.ts`). Please either send `soNumber` only once the SO is authorised, or add `erp.soAuthorised`, and drop the SO number from the `reserved` event message.
3. **"Order not moving" exceptions flood the list.** On a fresh seed, the reconcile job raises 35 info exceptions for seeded `confirmed` orders older than 72 hours. The web groups info items by title and collapses them. A dedup key per order, or skipping seeded history, would keep the list meaningful.
4. **Typed admin list rows.** `GET /api/admin/retailers` items, and `GET /api/admin/orders/:id` (`{order, integration[], notifications[]}`), are typed locally in the web. Please export `AdminRetailerRow` and `AdminOrderDetail`.
5. **`retryIn` on OTP rate limits.** `RESEND_TOO_SOON` carries `retryIn`, and the web counts down on it. `TOO_MANY_CODES` says "try again in 15 minutes" but has no `retryIn`. Please add it so the button can count down instead of failing again.

## Not doing (agreed)

- GST estimate: the cart says "GST as per invoice".
- Server PDF: print CSS.
- `statusHistory`: the web derives step times from the `events` types (`reserved`, `approved`, `changes_accepted`, `confirmed`, …).

## Done in round 1

- Shared types (`Page`, `CataloguePage`, `Facet`, `PastOrderCard`, `Look`, `HomeResponse` with `ratios`, `ReorderPreview`, `Credit`, `RetailerProfile`, `AdminOverview`, `AdminException`, `LowStockRow`, `DistributorScore`). The web now imports them, and its local copies are gone.
- `PUT /api/cart/lines` and `/api/cart/meta` check `version` and return `409 CART_CHANGED {cart}`. The web uses `body.cart` and re-applies unsent edits on top.
- Refresh without a cookie returns 204.
- OTP `channel` accepts `sms`, `whatsapp` and `voice`. "Get the code on a call" sends `voice`.
- `GET /api/catalogue/upcoming` feeds the Coming soon tab.
- Reorder preview has `totalValue`, which is shown in the sheet. `400 TOO_OLD` is shown inline.
