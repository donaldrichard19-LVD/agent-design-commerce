# Agent design commerce — working prototype

Three pieces, matching the build plan: **(a) protocol**, **(b) gate + checkout kit**, **(c) registry**. This is real, runnable code, not a mockup — it's been tested end to end, including a real MCP tool call sequence over stdio.

## What's here

```
protocol/       the schema spec (a)
  schema/       JSON Schema for the discovery file and component detail file
  examples/     a worked example agent-commerce.json

gate-kit/       what a designer runs (b)
  server.js         Express app: discovery file, purchase/download, dashboard API
  public/index.html designer dashboard UI
  data/seed.json    demo designer + 2 components (Priya Ramesh, from the earlier spec)

registry/       what agents query (c)
  crawler.js        polls seed domains, builds index.json
  mcp-server.js     the actual MCP server — search/get/purchase/get_asset
  test-client.js    drives mcp-server.js over stdio to prove it works
```

## Run it yourself

**1. Start the gate kit** (the designer's site):
```
cd gate-kit
npm install
npm start
# -> http://localhost:3001 (dashboard)
# -> http://localhost:3001/.well-known/agent-commerce.json (what agents read)
```

**2. Crawl it into the registry:**
```
cd registry
npm install
npm run crawl
# writes registry/index.json
```

**3. Run the MCP server and connect a real agent host** (Claude Code, Claude Desktop, Cursor, etc.):
```
npm run mcp
```
Point your MCP host's config at `node /path/to/registry/mcp-server.js`. It exposes four tools: `search_components`, `get_component`, `purchase_component`, `get_asset`.

**Or, prove it works without a full agent host** — the included test client drives the same MCP protocol directly:
```
node test-client.js
```
Search finds the checkout form, `get_component` returns full detail, a purchase attempt without `confirmed_by_human: true` is correctly rejected — and, as of P1, a confirmed purchase now correctly stops at `seller_not_onboarded` until the designer has completed real Stripe Connect onboarding (see below). That gate replaces P0's always-succeeds mock.

## What's mocked vs. production-shaped (P0 baseline)

| Piece | Status |
|---|---|
| Discovery file schema, MCP tool shapes, human-in-the-loop gate | Production-shaped — this is the real contract |
| Registry crawling | Real polling logic, but the seed list is one local domain — production points it at real designer domains on a schedule |
| Designer dashboard | Functional (add/gate/toggle components, view sales) but unstyled — this is the piece the build plan flags as the real engineering investment for P1 |

## P1: real Stripe Connect (this is now live in `gate-kit/`)

Replaces the mocked payment with a real Connect integration, per `agent-design-commerce-p1-requirements.md` (workstream 1) in Drive:

- **Onboarding** — `POST /api/stripe/connect` creates a v2 recipient connected account (`dashboard: express`, `fees_collector`/`losses_collector: application`, `stripe_balance.stripe_transfers` capability) and returns a hosted Account Link. This replaces the legacy OAuth flow the P0 comment described — Stripe's current guidance is v2 Accounts + Account Links, not `stripe.oauth.token()`.
- **Purchase** — `POST /api/purchase` creates a real destination-charge PaymentIntent (`transfer_data.destination` + optional `application_fee_amount`, off-session against a saved buyer payment method). It does **not** decide completion itself — that only ever happens inside the `payment_intent.succeeded` webhook handler (`POST /webhooks/stripe`, signature-verified). The request handler waits briefly for that webhook to land (fast in practice) and falls back to a `status: "processing"` + poll URL if it doesn't.
- **Idempotency** — retried purchases for the same `buyer_token` + `component_id` reuse the existing PaymentIntent instead of double-charging (dedupe key passed as the Stripe idempotency key too).
- **Buyers** — since this is a machine-to-machine purchase (no browser at purchase time), a buyer's payment method has to be saved once, out of band. `scripts/create-test-buyer.js <buyer_token>` does this in test mode with a saved test card. Production replaces that script with a one-time Stripe Checkout Session in `setup` mode.
- **Registry** — `mcp-server.js`'s `purchase_component` tool polls the gate-kit's status endpoint a few more times if it comes back `processing`; a new `check_purchase_status` tool lets an agent check later.

### Running the P1 flow locally

```
cd gate-kit
cp .env.example .env   # fill in your own Stripe test keys
npm install
npm start

# in another terminal — forwards webhooks to your local server:
stripe listen --forward-to localhost:3001/webhooks/stripe
# copy the printed whsec_... into .env as STRIPE_WEBHOOK_SECRET, restart npm start

# register a test buyer's saved card:
node scripts/create-test-buyer.js tok_dev_9f1a

# from the dashboard (http://localhost:3001) or via POST /api/stripe/connect,
# complete Stripe's hosted onboarding for the designer's connected account
```

### What was and wasn't live-validated

Built and tested against a real Stripe test-mode sandbox (`stripe sandbox create`) in this session:

| Path | Live-tested |
|---|---|
| Buyer setup (Customer + saved test card) | ✅ |
| `seller_not_onboarded` gate before onboarding | ✅ |
| Clean, non-crashing error handling on an invalid Stripe request (proves the catch path a declined card would also hit) | ✅ |
| Webhook signature verification (valid signature accepted, forged signature rejected with 400) | ✅ |
| `payment_intent.succeeded` → `completeSale` (download token issued, `sold_count` incremented) | ✅ |
| Webhook idempotency (same event delivered twice → sale completes once, no double-increment) | ✅ |
| Asset delivery via the issued download token | ✅ |
| Full `search_components` → `get_component` → `purchase_component` → `get_asset` MCP chain | ✅ (stops correctly at `seller_not_onboarded`, as expected pre-onboarding) |
| v2 connected-account creation + Account Link onboarding, and a real destination charge against an active connected account | ✅ — validated against a claimed Stripe sandbox with Connect enabled: hosted Express onboarding completed, capabilities went active, and a real `purchase_component` call through the MCP chain produced a genuine `payment_intent.succeeded` → `transfer.created` → `charge.updated` sequence (confirmed via Stripe's own event log, not just local state) landing in the connected account. |

Workstream 1 is now fully validated end to end, including the one gap flagged above. One operational note from getting there: `stripe listen` must be started with `--api-key <the sandbox's test-mode key>` — without it, the CLI silently forwards from whatever account it's currently configured for (e.g. a stale/previous sandbox), and purchases against the *actual* target account will sit stuck at `status: "pending"` with no error, since the webhook that would complete them never arrives.

## Next step, per the build plan / P1 requirements

Workstream 1 (real Stripe Connect) is complete. Outstanding from P1 overall (workstreams 2–5, unstarted): recruiting 3-5 real designers, production registry crawling, the designer dashboard rebuild, and delivered-code quality validation. See `agent-design-commerce-p1-requirements.md` in Drive for full scope.
