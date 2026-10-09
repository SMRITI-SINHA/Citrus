# CITRUS Trade

Mobile-first B2B ordering for CITRUS retailers, their distributors and the CITRUS team, on top of Ginesys.
Three panels in one PWA: **Retailer**, **Distributor**, **Admin (control room)**.

- How it works and why: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Endpoints: [docs/API.md](docs/API.md) · UX rules: [docs/UX-RULES.md](docs/UX-RULES.md)
- Anything not yet confirmed by CITRUS or WFX is listed in `ASSUMPTIONS` (`packages/shared/src/index.ts`) and shown to admins as "Pending confirmation".

## Run it locally
Needs Node 22, Postgres 16 (user/password `citrus`, databases `citrus` and `citrus_test`) and Redis.

```bash
npm install
scripts/stack.sh --fresh        # stand-in Ginesys :4100, full-scale seed, API :4000 (one process per core)
npm run dev -w apps/web         # PWA on http://localhost:5173
```
`SEED_SCALE=demo scripts/stack.sh --fresh` seeds only the 12 curated styles and 7 named stores (seconds instead of minutes).

### Sign in (the OTP code is filled in automatically in dev)
| Panel | How |
|---|---|
| Retailer, first activation | open `/i/sbm-kochi-7f3k`, phone `9847041736` (Sree Balaji Menswear, Kochi) |
| Retailer, already active | phone `9847038812` (Om Sai Collection, Thrissur) |
| Distributor | phone `9847012345` (Malabar Trade Links, Kozhikode): three live orders are waiting |
| CITRUS admin | phone `9845000001` |

### Try the failure paths
- Ginesys outage: `curl -XPOST localhost:4100/_admin/outage -H 'content-type: application/json' -d '{"paused":true}'` then place an order (it waits as "placed", retries, and continues when you set `paused` back to `false`).
- Move an approved order through the warehouse: `curl -XPOST localhost:4100/_admin/orders/<orderId>/advance` (DC → invoice/AWB → delivered, each sent to the API as a signed webhook).
- New inventory snapshot: `curl -XPOST localhost:4100/_admin/snapshot`.

## Tests
```bash
npm test                         # 20 API tests: races, idempotency, outage/retry, ERP shortfall, full lifecycle, auth, webhooks
npm run load -w apps/api -- 600 30   # 600 stores browsing + ordering within 30 s
```

### Measured (4-core cloud VM; API ×4, Postgres, Redis, stand-in Ginesys and the load generator all on the same box)
Measured on the full-scale dataset (3,000 styles / 67,330 SKUs, 2,800 stores, 25,939 orders / 980k lines). The current seed has smaller, more realistic orders: 25,593 orders / 499k lines, ₹90.6 cr over 12 months, average order ₹35k.

| Step | 600 stores over 30 s: p50 / p95 | Single user |
|---|---|---|
| Home (personalised) | 19 / 68 ms | 13–82 ms |
| Catalogue page (24 of 1,640 shirts, facets) | 13 / 42 ms | 8–14 ms |
| Next page | 12 / 41 ms | |
| Search "navy slim" | 9 / 41 ms | 7–9 ms |
| Product | 3 / 16 ms | 2–3 ms |
| Cart edit | 21 / 75 ms | 9–18 ms |
| Place order (incl. Ginesys reservation, 120 ms simulated latency) | 181 / 323 ms | |

No negative stock and no duplicate Sales Orders in any run. Orders refused with 409 were stores asking for sizes another store had just taken; they were told exactly which sizes changed.
Worst case, 300 stores starting at the same instant: p95 0.6 s browse, 3.1 s place order.

## Layout
`packages/shared` contract and policy · `apps/api` API + workers · `apps/mock-ginesys` stand-in Ginesys · `apps/web` PWA · `scripts/stack.sh` local stack.
