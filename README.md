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
  crawler.js        polls seed domains on a schedule, validates + builds index.json
  server.js         self-serve domain submission (form + API), guards against SSRF
  mcp-server.js     the actual MCP server — search/get/purchase/get_asset
  test-client.js    drives mcp-server.js over stdio to prove it works
```

## Registry: self-serve domain submission (P1 workstream 2/3)

A designer can add themselves to the registry without anyone hand-editing `registry/seed-domains.json` — the manual step P1's designer-onboarding acceptance criteria explicitly calls out as needing to go away.

```
cd registry
npm install
npm run serve
# -> http://localhost:3002 (submission form)
```

`POST /api/submit-domain` (what the form calls) fetches `{domain}/.well-known/agent-commerce.json`, validates it against `protocol/schema/agent-commerce.schema.json` (the same validator `crawler.js` uses), and on success appends the domain to `seed-domains.json` — picked up automatically by the next `crawl:watch` run, no manual step in between.

Since this fetches a URL an anonymous visitor supplies, `registry/lib/ssrf-guard.js` rejects non-http(s) schemes and any hostname/resolved IP in loopback, private, or link-local ranges (localhost, 127.0.0.1, 10.0.0.0/8, 192.168.0.0/16, 169.254.0.0/16 incl. cloud metadata endpoints, etc.) before ever fetching it. This is a reasonable guard for a prototype's public form, not a DNS-rebinding-proof implementation — the actual fetch re-resolves the hostname rather than pinning the IP that was checked. For local testing against your own `gate-kit` instance, set `ALLOW_PRIVATE_SUBMIT_TARGETS=true` to bypass the guard.

**Known gap, same shape as gate-kit's:** `seed-domains.json` is written to at runtime and would be reset by Render's free-tier redeploy, same issue the last few gate-kit commits worked around for `seed.json`. Not yet addressed here — worth fixing the same way (bake state back in and commit) if this gets real submissions before workstream 3's planned move to a real datastore replacing the flat `index.json`/`seed-domains.json` files entirely.

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
Point your MCP host's config at `node /path/to/registry/mcp-server.js`. It exposes five tools: `search_components`, `get_component`, `purchase_component`, `get_asset`, `check_purchase_status`.

**Or, prove it works without a full agent host** — the included test client drives the same MCP protocol directly:
```
node test-client.js
```
Search finds the checkout form, `get_component` returns full detail, a purchase attempt without `confirmed_by_human: true` is correctly rejected — and, as of P1, a confirmed purchase now correctly stops at `seller_not_onboarded` until the designer has completed real Stripe Connect onboarding (see below). That gate replaces P0's always-succeeds mock.

## What's mocked vs. production-shaped (P0 baseline)

| Piece | Status |
|---|---|
| Discovery file schema, MCP tool shapes, human-in-the-loop gate | Production-shaped — this is the real contract |
| Registry crawling | Production-shaped as of P1 workstream 3: validates every discovery file against `protocol/schema/agent-commerce.schema.json` (ajv), and `npm run crawl:watch` runs it on a cron schedule (`CRAWL_CRON`, default every 15m) instead of a one-off manual pass. Still gated on workstream 2: the seed list (`registry/seed-domains.json`) is one local domain until there are real designers to crawl. |
| Designer dashboard | Functional (add/gate/toggle components, view sales) but unstyled — this is the piece the build plan flags as the real engineering investment for P1 |

## P1: real Stripe Connect (this is now live in `gate-kit/`)

Replaces the mocked payment with a real Connect integration, per `agent-design-commerce-p1-requirements.md` (workstream 1) in Drive:

- **Onboarding** — `POST /api/stripe/connect` creates a v2 recipient connected account (`dashboard: express`, `fees_collector`/`losses_collector: application`, `stripe_balance.stripe_transfers` capability) and returns a hosted Account Link. This replaces the legacy OAuth flow the P0 comment described — Stripe's current guidance is v2 Accounts + Account Links, not `stripe.oauth.token()`.
- **Purchase** — `POST /api/purchase` creates a real destination-charge PaymentIntent (`transfer_data.destination` + optional `application_fee_amount`, off-session against a saved buyer payment method). It does **not** decide completion itself — that only ever happens inside the `payment_intent.succeeded` webhook handler (`POST /webhooks/stripe`, signature-verified). The request handler waits briefly for that webhook to land (fast in practice) and falls back to a `status: "processing"` + poll URL if it doesn't.
- **Idempotency** — retried purchases for the same `buyer_token` + `component_id` reuse the existing PaymentIntent instead of double-charging (dedupe key passed as the Stripe idempotency key too).
- **Buyers** — since this is a machine-to-machine purchase (no browser at purchase time), a buyer's payment method has to be saved once, out of band. `scripts/create-test-buyer.js <buyer_token>` does this in test mode with a saved test card. Production uses the real buyer payment setup flow (below), a one-time Stripe Checkout Session in `setup` mode.
- **Registry** — `mcp-server.js`'s `purchase_component` tool polls the gate-kit's status endpoint a few more times if it comes back `processing`; a `check_purchase_status` tool lets an agent check later.

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

**Production (`agent-commerce-gate-kit.onrender.com`), not just local, is now live-validated too.** Deploying the new connected-account ID without also updating Render's `STRIPE_SECRET_KEY`/`STRIPE_PUBLISHABLE_KEY` (set directly in Render's dashboard, not synced from `render.yaml`) briefly broke production purchases with `No such destination` — the discovery file advertised a connected account the configured key couldn't reach. There was also no webhook endpoint registered against the live URL at all, which would have left completions stuck pending indefinitely even with the right key. Both are fixed: a real webhook endpoint (`we_1U6ikHDO6LUr92PKqvLicyQG`) is registered for `payment_intent.succeeded`/`payment_intent.payment_failed`, Render's env vars match the claimed sandbox, and a real `purchase_component` call against the live URL completed on the first attempt — `payment_intent.succeeded` → `completeSale` → asset delivered via `GET /api/download/:token`, all over the public internet, not localhost.

## Buyer payment setup (closes the "how does a buyer get a `buyer_token`" gap)

Purchase was always machine-to-machine — an agent calls `purchase_component` with a `buyer_token` — but until now the only way to attach a real payment method to one was `scripts/create-test-buyer.js`, a dev-only script hardcoding a test card. This is the real, production-usable flow:

- `POST /api/buyer/setup` mints a `buyer_token` (`tok_...`), creates a Stripe Customer, and returns a hosted Checkout Session URL (`mode: setup`) — no charge, just card capture. The agent relays this URL to the human buyer.
- `GET /api/buyer/setup/return?session_id=...` runs once the human completes the hosted page: retrieves the Checkout Session, pulls the saved payment method off it, and registers it against the `buyer_token`.
- `GET /api/buyer/setup/cancel` handles the abandoned-checkout path.
- A purchase attempt against an unregistered `buyer_token` returns `402 buyer_payment_method_required` with a `message` pointing at this endpoint, replacing the old guidance that only mentioned the dev script.

Tested locally: `POST /api/buyer/setup` returns a real `checkout_url`; the error paths (missing/invalid `session_id`, cancel) behave correctly; existing purchases are unaffected. Completing the hosted Checkout page itself isn't verifiable in this sandbox (no browser) — that leg still wants a real click-through before calling it fully live-validated, same caveat as the scroll-story landing page's visual checks.

## Refunds and dispute tracking

- **Refunds** — `POST /api/sales/:transaction_id/refund` (seller-only, `requireAuth`). Scoped to the caller's own sales (`403` otherwise) and only for sales in `completed` status (`409 not_refundable` otherwise). Issues a real Stripe refund with `reverse_transfer: true` and `refund_application_fee: true` — required because this is a destination charge, so the payout already left the platform account for the seller's connected account; without reversing it, the platform would eat the refund with no balance to pay it from. The dashboard's sales panel has a Refund button and status badges reflecting the result.
- **Disputes** — new webhook handlers for `charge.dispute.created`/`charge.dispute.closed` record `dispute_id`/`dispute_status`/`dispute_updated_at` on the sale (`recordDispute`). A chargeback is opened by the buyer's bank, not through this API — Stripe is the only source of truth, and evidence response still happens in the seller's own Stripe Express dashboard, same pattern as Connect onboarding.
- **`charge.refunded`** is also handled, so a refund issued directly in Stripe's dashboard (bypassing the API above) still updates the sale's status here instead of drifting out of sync.

## Workstream 5 dry run: delivered-code quality (seed components)

Workstream 5's actual acceptance criterion is "for each real component from workstream 2" — blocked, same as workstream 2's own recruiting step, since no real designers exist yet. What's done here is a dry run of the *validation process itself* against the two seed/demo components, since they're what currently stands in as the project's reference example.

Method: pulled each component through the real MCP chain (`search_components` → `get_component` → `purchase_component` → `get_asset`, real Stripe test-mode charge), then dropped the delivered files into a fresh `npm create vite -- --template react-ts` project using *only* the declared `dependencies`/`install_instructions` — nothing extra.

**Found, and fixed:**

| Component | Was promised | Was actually true | Fix |
|---|---|---|---|
| Both | Ships as `.tsx` (implies TypeScript) | Failed `tsc -b` in a stock Vite React-TS scaffold — untyped props (`implicitly has an 'any' type`) | Added proper prop interfaces / zod-inferred types to both |
| Checkout Form | `dependencies: ["zod"]` | `zod` was never imported or used | Added a real schema, validated via `safeParse` in the submit handler, errors surfaced through `formState.errors` |
| Checkout Form | `accessibility.wcag_level: "AA"` | Inputs had no `<label>`, just `placeholder` — a standard AA failure; no focus movement between steps | Added labeled inputs and focus management (`ref` + `useEffect` moving focus to each step's legend) |
| Checkout Form | `design_tokens_used: ["color.brand.primary", ...]` | The submit button used literal `bg-black`, not any token | Now reads `var(--color-brand-primary, #000000)` — a real, verifiable CSS custom property with a sensible fallback |
| Both | `framework: "react-tailwind"` | Tailwind wasn't in `dependencies`/`install_instructions` at all — following the instructions exactly ships an unstyled component | `install_instructions` now states the Tailwind-already-configured prerequisite explicitly, rather than implying `npm install` alone covers it (which no single install line honestly can, since Tailwind needs build-tool config) |
| Command Palette | `design_tokens_used: ["color.surface.overlay", "radius.lg"]` | Zero styling props anywhere in the file | Wired real `cmdk` props (`overlayClassName`, `contentClassName` — verified against `cmdk`'s own `.d.ts`, not guessed) referencing the same CSS-custom-property pattern |

Re-verified after the fix: both components pulled fresh through the same real MCP chain, dropped into a clean scaffold, `tsc -b && vite build` — clean build, no errors, on both.

One process note worth keeping: an earlier draft of the Command Palette fix used a fabricated `overlayStyle` prop that doesn't exist on `cmdk`'s `Dialog` — caught by checking the library's actual `.d.ts` before shipping it, not by assuming the analogous-sounding prop name was real. Exactly the class of gap this workstream exists to catch, this time caught before delivery instead of after.

## Workstream 4: multi-tenant auth on the seller dashboard

`gate-kit` moved from one hardcoded seller (Priya Ramesh) to real signup/login — the acceptance criterion the P1 doc calls out explicitly ("Dashboard itself requires designer auth/login"), delivered as one shared hosted instance per the spec's "Option 1" (not a self-hosted package per designer).

- **Auth**: `gate-kit/lib/auth.js` — Node's built-in `crypto.scrypt` for password hashing (no dependency, avoids `bcrypt`'s native-compile risk on Render's plain `npm install` build), `crypto.timingSafeEqual` for comparison. Sessions via `cookie-session` — the signed session lives entirely in the cookie, no server-side store to lose on a Render redeploy.
- **Data model**: `seed.json` moved from one global `seller`/`stripe_connect` to a `sellers` array, with `seller_id` added to every `components`/`sales` record. One-off `gate-kit/scripts/migrate-to-multi-tenant.js` converted the live data; `gate-kit/scripts/set-seller-password.js` sets a password without ever committing a plaintext credential (only the hash+salt land in `seed.json`).
- **Discovery files are now per-seller**: `GET /sellers/:seller_id/.well-known/agent-commerce.json` is the real per-seller route (the protocol schema requires one `seller` object per discovery file, so multiple sellers on one instance need distinct URLs). The legacy root `/.well-known/agent-commerce.json` keeps working unchanged — it resolves whichever seller is flagged `legacy_root: true` (Priya) — so existing links and `registry/seed-domains.json` needed zero changes. Confirmed `registry/crawler.js`, `registry/server.js`, and the SSRF guard all handle a discovery URL with a path prefix correctly with no code changes, since none of them parse anything past `.protocol`/`.hostname`.
- **Ownership, not just login**: every mutating route scopes to the session's own `seller_id` server-side; `toggle-gate` additionally checks the target component actually belongs to the caller (`403` otherwise) — verified live: seller B attempting to toggle Priya's component was rejected and her data was unchanged.
- **Verified live, not just read**: two independent sellers signed up/logged in with isolated dashboard data; the real Stripe purchase flow was re-run end to end after the refactor (`POST /api/purchase` now resolves the seller — and their connected account — through the purchased component instead of a single global object) and completed on the first attempt with the correct `seller_id` on the resulting sale; a brand-new seller's discovery file correctly *fails* schema validation and gets skipped by the crawler until she connects Stripe, which is the schema doing its job, not a bug.
- **Known, accepted gaps** (documented, not solved, consistent with this project's existing posture — e.g. the registry's SSRF guard is explicitly "reasonable, not bulletproof"): no rate-limiting on login attempts; password strength is only an 8-character minimum, no breached-password check; `cookie-session` has no server-side store, so there's no way to revoke a single compromised session — only rotating `SESSION_SECRET` invalidates sessions, and that logs out every seller at once; seller account data still lives in `seed.json`, so a real production signup still needs the same pull-and-commit mitigation already documented for `seed-domains.json` if it needs to survive a Render redeploy.

## Next step, per the build plan / P1 requirements

Workstreams 1 (real Stripe Connect), 3 (production registry crawling), and 4 (multi-tenant dashboard auth) are complete. Workstream 2's engineering half is done too — self-serve domain submission (above) — but its actual acceptance criterion, "3-5 designers identified and recruited," is explicitly scoped in the requirements doc as "a manual/BD task, not engineering," so it's still outstanding until real designers exist to submit through it. Workstream 5 is dry-run validated against the seed components (above) but, like workstream 2, its real acceptance criterion needs real designer components to run against. See `agent-design-commerce-p1-requirements.md` in Drive for full scope.
