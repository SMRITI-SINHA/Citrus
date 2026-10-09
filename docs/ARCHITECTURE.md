# CITRUS Trade: architecture

CITRUS Trade is a mobile-first ordering layer on top of Ginesys. Ginesys stays the authority for item master, customers, stock reservation, sales orders, invoicing and dispatch. CITRUS Trade owns:
- the retailer, distributor and admin experience;
- a fast availability view;
- the cart;
- the approval workflow;
- notifications, points and the audit trail.

Research behind these choices:
- `/mnt/project-files/citrus-trade-research/ginesys-api.md` covers what Ginesys documents.
- `/mnt/project-files/citrus-trade-research/b2b-ordering-teardown.md` covers Shikhar, Udaan, JOOR, NuORDER, Pidilite, Havells, Relaxo and others.

```
Retailer / Distributor / Admin PWA (React 19, Vite, service worker for the app shell only)
        │ HTTPS JSON + SSE
        ▼
API cluster (Node 22, Fastify 5, TypeScript)  ── Redis (cache, pub/sub, rate limits, locks)
        │  Knex                                   
        ▼                                         
Oracle 12c on CITRUS server (Postgres locally/CI)  
        │  transactional outbox → ERP adapter (circuit breaker, retries)
        ▼
Ginesys Data Services REST  ◄── webhooks (inventory snapshots, DC, invoice, masters)
```

## Repository
| Path | What |
|---|---|
| `packages/shared` | The API contract (types), POLICY defaults, the ASSUMPTIONS register, and the sample-data generator |
| `apps/api` | API, background workers, DB schema, seed, tests and load test |
| `apps/mock-ginesys` | Stand-in Ginesys built on the publicly documented endpoints, with fault injection |
| `apps/web` | The PWA with all three panels |
| `docs/` | `API.md` (endpoints), `UX-RULES.md`, this file |

## Order lifecycle
| CITRUS Trade status | What happened | Ginesys call or event |
|---|---|---|
| `placed` | Retailer submitted. Final stock check passed under row locks | outbox `erp.reserve` |
| `review` | Ginesys created the SO with stock reserved; waiting for the distributor | `POST /erp/gds/api/sales-order` with `reservationRequired=Y`, `intgOrderId` = our order id |
| `modified` | Distributor proposed reductions with a reason; waiting for the retailer | none until the retailer answers |
| `approved` | Distributor approved, or the retailer accepted the changes | outbox `erp.approve` (per-line cancel of the cuts, then authorise) |
| `confirmed` ("SO created") | SO authorised | `PATCH /snd/SalesOrder/authorize` |
| `processing` | Packing | webhook `snd.deliverychallan.added` |
| `dispatched` | Invoiced and shipped, with AWB | webhook `snd.invoice.added` |
| `delivered` | Delivered; points credited | logistics delivery event (name not documented, see ASSUMPTIONS) |
| `rejected` / `cancelled` | Distributor rejected, or the retailer declined the changes | `POST /snd/SalesOrder/cancel` with `cancelFully`; stock released |

Every transition writes an `order_events` row (who, when, what), and the UI timelines read from those rows. CITRUS can decide on behalf of a slow distributor; that is recorded as `actor=admin` and in `audit_log`.

## How the hard problems are handled

### No overselling
1. The cart row is locked first (`SELECT … FOR UPDATE`), so two devices cannot submit one cart twice.
2. The order's availability rows are then locked in a fixed key order, so there are no deadlocks. Every line is checked, and the rows are decremented in the same transaction as the order insert.
3. Ginesys is the final authority. Reservation uses `partialReservation=Y` only to learn which sizes fell short. Any shortfall cancels the whole SO, and the retailer gets `409 STOCK_CHANGED` listing exactly what changed, with the cart untouched.
4. Tested:
   - Two stores racing for the last piece: one wins.
   - 50 concurrent submits: no oversell.
   - 300-store load test: no negative stock and no duplicate SOs.

### No duplicate orders
- **Client key:** the client sends an `idempotencyKey`, unique per (retailer, key). A retry returns the stored order with `idempotent-replay: true`.
- **Ginesys de-duplication:** Ginesys rejects a repeated `intgOrderId`, so a retried reservation after a lost response cannot create a second SO.
- **Tested:** the same key sent twice, including concurrently, gives one order and one SO.

### Ginesys slow or down
ERP calls are written to a transactional outbox inside the business transaction and then executed straight away (`runNow`, waiting up to 2.5–4 s).
- **Slower than that:** the user sees the order as placed, and SSE pushes the update when Ginesys answers.
- **Failures:** retried with backoff of 5 s, 30 s, 2 m, 10 m, 1 h and 6 h. A circuit breaker pauses calls for 30 s after 5 failures.
- **Retries exhausted:** the order is flagged `failed`, and the control room shows an exception with **Retry now**.

Workers claim rows with `FOR UPDATE SKIP LOCKED` plus a lease, so any number of API processes can share the queue. This is tested: an outage is followed by recovery, and the order reaches the distributor.

### Missed Ginesys webhooks
Ginesys does not document webhook retries.
- **Receiving:** webhooks are signature-checked, stored once in `inbox` (de-duplicated on `request_id`), acknowledged at once, and processed asynchronously.
- **Reconciliation:** a job flags any order that has sat in a stage longer than normal: placed or approved for more than 15 min, confirmed for more than 72 h, dispatched for more than 10 days.

### Availability at scale
- **Source:** Ginesys documents full inventory snapshots only (`site.inventory.allitem.refresh` with a DownloadURL).
- **Applying a snapshot:** availability = snapshot free quantity − our reservations made after the snapshot time. Orders placed while a snapshot is being applied are subtracted again. The rule is conservative: it may briefly show less stock, never more.
- **Reads:** Redis hashes (`av:{style}`) plus per-style totals (`av:tot`), with the DB as fallback. A browse never touches Ginesys.

### Catalogue at 3,000 styles and 67,000 SKUs
- **Item master:** about 3 MB, held in memory per process and refreshed every 5 minutes, with single-flight reloads.
- **Requests:** filter and sort in memory, return 24 per page with a cursor, and include facet counts. Per-size stock is fetched only for the page returned.
- **Search:** tolerates Hinglish and Hindi (safed, kala, pant, कमीज…).

### Recommendations
- **No invented figures:** every reason shown is computed from real data.
  - "You usually reorder this every N weeks": the store's own reorder cycle.
  - "Ordered by N stores in Kerala this month": regional popularity.
  - "Often ordered together": co-purchases from the last 90 days.
- **Background computation:** heavy aggregates run every 15 minutes on one instance under a Redis lock. Requests only read the cached results.
- **Size split:** "Split by my ratio" uses the store's own size mix from the last 180 days.

### Sign-in and identity
- **OTP:** sent only to numbers already on a CITRUS customer, distributor or staff record. A wrong number on an invite link opens a manual-verification exception and creates no account.
- **Code security:** codes are HMAC-hashed with a 5-minute expiry, at most 5 attempts, a 30 s resend gap and caps of 3 per 15 minutes and 10 per day. Delivery tries WhatsApp first, then SMS, or voice on request.
- **Sessions:** the access JWT lasts 15 minutes. The refresh token sits in an httpOnly cookie, rotates on every use and is stored hashed. Reuse of an old token revokes the whole token family.
- **Number changes:** shop numbers change, so CITRUS can re-bind a store's mobile number. This is audited and signs out old sessions.

### Live updates
Server-Sent Events go through Redis pub/sub, so any instance can push to any user. Each event reaches only its audience: the retailer, their distributor, admins, or everyone for stock. SSE was chosen over WebSockets because the traffic is server-to-client only, it reconnects by itself and it passes proxies.

### Observability
- **Logs:** structured JSON (pino). Every request carries `x-request-id`, which is copied onto its outbox rows, so one order can be traced end to end.
- **Order detail page (admin):** shows the full integration log (each ERP call: attempts, last error, timings) and every notification sent.
- **Health endpoints:** `/health` and `/ready` (checks the DB and Redis).
- **Control room shows:**
  - Ginesys state (ok, degraded or down)
  - queue depth and age of the oldest item
  - age of the latest stock snapshot
  - an exceptions inbox

## Scale and measured performance
**Expected load.** At ₹100 cr turnover and an average wholesale rate of about ₹650, that is about 15 lakh pieces a year. Spread over 2,800 stores ordering about monthly, it comes to roughly 30k orders and 1M order lines a year.

**Test dataset.** The full seed generates exactly that:
- 3,000 styles and 67,330 SKUs;
- 2,800 stores across 9 states and 42 distributors;
- 25,593 orders with 499k lines over 12 months, worth ₹90.6 cr (average order about ₹35k).

**Peak to plan for.** Roadshow peak is a few hundred stores at once. HUL Shikhar handles about 1.4M retailers and Meesho about 72 orders per second, so this volume is small. The real risks are correctness, reconciliation and distributors acting on time, not throughput.

**Load test.** `npm run load -w apps/api -- 300` simulates 300 stores. Each one opens home, browses two catalogue pages, searches, opens 3 products, edits the cart 3 times and places an order. The full flow runs at the same moment for all 300. Results for the 4-process cluster on a 4-core box are in the README.

**Oracle 12c notes.**
- **Schema and queries:**
  - The schema uses only portable types (no JSON columns; CLOB-safe text).
  - Dialect differences are isolated in `lib/sql.ts`.
  - `FOR UPDATE SKIP LOCKED` is not combined with row limits on Oracle.
- **Order-volume limits:** order tables are keyed for range partitioning on `placed_at`. Partitioning needs the Partitioning licence and is not needed at 1M lines a year with the existing indexes.
- **Risk to raise:** Oracle 12c is past Premier Support, so this should be raised with CITRUS.

## Configuration (env)
| Variable | Purpose |
|---|---|
| `DB_CLIENT=pg\|oracledb`, `DATABASE_URL` / `ORACLE_USER`, `ORACLE_PASSWORD`, `ORACLE_CONNECT_STRING` | Database |
| `REDIS_URL` | Cache, pub/sub, locks |
| `JWT_SECRET`, `OTP_PEPPER` | Secrets. Must be set in production |
| `OTP_DEV_ECHO=0` | Never show codes in production |
| `OTP_CHANNELS=whatsapp,sms` | OTP delivery order |
| `GINESYS_BASE_URL`, `GINESYS_API_KEY`, `GINESYS_SITE_CODE`, `GINESYS_WEBHOOK_SECRET`, `GINESYS_DOWNLOAD_PREFIX` | Ginesys connection |
| `WHATSAPP_PROVIDER`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `SMS_PROVIDER` | Messaging (console senders until the BSP and DLT are set up) |
| `WEB_CONCURRENCY` | API processes (default: one per CPU core) |
| `CORS_ORIGIN`, `APP_URL` | Web origin |

## What needs CITRUS or WFX before production
Every item below is listed in `ASSUMPTIONS` (`packages/shared`) and shown to admins under **Pending confirmation**:
1. **Ginesys access:** sandbox, base URL, API key and rate limits.
2. **Ginesys behaviour:**
   - whether API orders start unauthorised;
   - when credit is checked;
   - how the snapshot is generated and how often;
   - how webhooks are signed and retried;
   - which category slots hold colour and size;
   - what the delivery event is.

   The questions are in `ginesys-api.md`.
3. **CITRUS business rules:**
   - reorder window;
   - points and the reward catalogue;
   - approval SLA;
   - low-stock threshold;
   - catalogue ranking;
   - whether app orders count towards salesperson and distributor targets.
4. **Messaging:** WhatsApp BSP and Meta templates (Utility and Authentication), plus SMS DLT registration (PE ID and templates).
5. **Hosting:** the server or VM on CITRUS's network, domain and TLS, and a GitHub repository for code review and CI.
6. **DPDP:** consent text, retention periods, and the breach-response contact (core obligations apply from 13 May 2027).
