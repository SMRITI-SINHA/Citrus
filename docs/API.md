# CITRUS Trade API

Base path `/api`. Shared types: `Page<T>`, `CataloguePage`, `HomeResponse`, `ReorderPreview`, `RetailerProfile`, `AdminOverview`, `LowStockRow`, `DistributorScore`. JSON in and out. Types live in `packages/shared/src/index.ts`.
Auth: `Authorization: Bearer <accessToken>` (15 min). A rotating refresh token sits in an httpOnly cookie `ct_refresh` (30 days); call `POST /api/auth/refresh` when a request returns 401.
Every response carries `x-request-id`. Errors: `{ "code": "SOME_CODE", "message": "Plain sentence" }`.

## Auth (retailer, distributor and admin all sign in by mobile OTP)
| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | /auth/invite/:token | | `InviteInfo` (QR/link landing: store card with masked phone) |
| POST | /auth/otp | `OtpRequest & { channel?: 'sms'\|'whatsapp'\|'voice' }` | `OtpRequestResult` (`devCode` only when `OTP_DEV_ECHO=1`) |
| POST | /auth/verify | `OtpVerify` | `Session` (sets refresh cookie) |
| POST | /auth/refresh | | `Session` · `204` when not signed in on this browser |
| POST | /auth/logout | | 204 |
| GET | /me | | `Me` |

Unknown numbers never create accounts: `POST /auth/otp` for a phone not on any customer returns `403 UNKNOWN_NUMBER` and logs an activation exception for CITRUS.

## Catalogue and stock (retailer)
| GET | /catalogue?category=&q=&fit=&pattern=&color=&inStock=1&sort=best\|avail\|new\|points&cursor= | | `{ items: StyleCard[], nextCursor?: string }` |
| GET | /styles/:id | | `StyleCard` |
| GET | /styles/:id/pairs?color= | | `StyleCard[]` with `reason` (complete the look) |
| GET | /catalogue/upcoming | | coming-soon list |
| GET | /home | | `HomeResponse` (buy again within the reorder window, recommendations with real reasons, looks, open orders, points, own size ratios) |
| GET | /stock?keys=styleId\|color,styleId\|color | | `Availability[]` |

## Cart (server-side, autosaved; one cart per retailer)
| GET | /cart | | `Cart` |
| PUT | /cart/lines | `{ lines: CartLine[], version? }` set absolute qty per size (0 removes) | `Cart` · `409 CART_CHANGED {cart}` if version is stale |
| PUT | /cart/meta | `{ note?, po?, version? }` | `Cart` · `409 CART_CHANGED` |
| POST | /cart/reorder/:orderId/preview | | `ReorderPreview` · `400 TOO_OLD` outside the reorder window |
| POST | /cart/reorder/:orderId | | `Cart` |
| DELETE | /cart | | `Cart` |
Quantities above live availability are capped by the server and reported in `x-capped` header.

## Orders (retailer)
| POST | /orders | `PlaceOrderRequest` | `201 Order` · `409 StockConflict` · replay of same `idempotencyKey` returns the original order |
| GET | /orders?status=open\|done&cursor= | | `Page<Order>` |
| GET | /orders/:id | | `Order` |
| POST | /orders/:id/changes | `RetailerChangeDecision` | `Order` |

## Distributor
| GET | /distributor/queue | | `{ items: Order[], counts }` oldest first |
| GET | /distributor/history?cursor= | | `Page<Order>` |
| GET | /distributor/retailers?q=&cursor= | | stores mapped to this distributor |
| GET | /distributor/retailers/:id | | `RetailerProfile` |
| GET | /distributor/retailers/:id/credit | | `Credit & { stats, profile }` (Ginesys customer master) |
| POST | /distributor/orders/:id/decision | `DistributorDecision` | `Order` |

## Admin (CITRUS control room)
| GET | /admin/overview | | `AdminOverview` |
| GET | /admin/orders?status=&q=&cursor= | | `Page<Order>` |
| GET | /admin/orders/:id | | order + integration log + notifications |
| POST | /admin/orders/:id/retry | | `Order` (re-queues failed ERP sync) |
| POST | /admin/orders/:id/decision | `DistributorDecision` | `Order` (CITRUS acts for the distributor; audited) |
| POST | /admin/exceptions/:id/resolve | | |
| GET | /admin/retailers?q=&state=&status=&cursor= | | stores with activation and last order |
| PUT | /admin/retailers/:id/phone | `{ phone }` | re-bind mobile; signs out old sessions; audited |
| GET | /admin/distributors | | `DistributorScore[]` |
| GET | /admin/assumptions | | the ASSUMPTIONS register |
| GET | /admin/low-stock | | rows |
| POST | /admin/sync/stock | | asks Ginesys for an inventory snapshot |

## Live updates
`GET /api/events?token=<accessToken>` is a Server-Sent Events stream of `LiveEvent`.

## Webhooks
`POST /webhooks/whatsapp` (Meta Cloud API format, `X-Hub-Signature-256`): Approve works straight from WhatsApp; Modify/Reject reply with a link to the order.
`POST /webhooks/ginesys` (signed): inventory snapshots, delivery challan, invoice, delivery and customer-master events. Stored once in an inbox, processed asynchronously.
