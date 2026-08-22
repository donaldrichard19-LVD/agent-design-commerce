# Backlog

Items here are deliberately out of scope for the current P1 production-readiness push (see `agent-design-commerce-p1-requirements.md` in Drive for that). Nothing here is scheduled.

## ACP (Agentic Commerce Protocol) interoperability

**Added:** 2026-08-22

**What it is:** ACP is the Stripe/OpenAI-codeveloped open standard powering ChatGPT's Instant Checkout — a merchant-implemented REST API (`docs.stripe.com/agentic-commerce/acp`, spec at `github.com/agentic-commerce-protocol/agentic-commerce-protocol`, current version `2026-04-17`).

**Why it's here, not in P1:** it's additive surface area with no payoff until a specific ACP-speaking agent (ChatGPT Instant Checkout, etc.) is actually trying to buy from a seller on this platform. Worth building once there's a concrete channel driving it, not as protocol-completeness for its own sake.

**What it would concretely mean for `gate-kit`** (researched 2026-08-21, grounded in the actual OpenAPI specs, not a guess):

- New routes, additive alongside the existing `POST /api/purchase` — not a replacement:
  - `POST /checkout_sessions`, `POST /checkout_sessions/{id}`, `POST /checkout_sessions/{id}/complete`, `POST /checkout_sessions/{id}/cancel`
  - `/complete` is the structural analog of today's `/api/purchase`
- A **Feed API** (`POST /feeds`, `GET /feeds/{id}/products`) re-expressing `seed.json`'s components as ACP's `Product`/`Variant` shape — each component becomes one Product with one Variant (no real size/color variants exist here). A translation layer over existing data, not new data.
- Payment: ACP splits payment into a separate `delegate_payment` call that a *payment provider* runs to vault the card and hand the agent a scoped `spt_...` token, which gets passed to `/complete` as `payment_data.instrument.credential.token`. Stripe already ships this as part of ACP, and `gate-kit` already runs real Stripe Connect — so this is accepting Stripe's existing token type instead of building new payment infra.
- Required headers: `Idempotency-Key`, `Request-Id`, `Signature`, `Timestamp`, `API-Version`. Building this forces fixing "no idempotency on the purchase endpoint," which is *already* a flagged pre-P1 risk in the v0 spec doc, independent of ACP.
- Nothing about the existing native protocol changes: `.well-known/agent-commerce.json`, the `openCommerce` JSON-LD embed, and the MCP registry's four tools (`search_components`, `get_component`, `purchase_component`, `get_asset`) all keep working unchanged for non-ACP agents.

**Sequencing note:** AP2 (Google's signed-mandate protocol) was discussed in the same session as a second interoperability target but is a bigger lift — it needs JWT/VC signing infrastructure, not just a REST reshape — and hasn't been backlogged as its own item yet. If both get picked up, ACP first: it's the closer architectural fit (gate-kit already speaks REST + Stripe Connect) and AP2's `PaymentMandate.user_authorization` would be the real fix for the v0 spec's own flagged gap that `confirmed_by_human` is a self-reported boolean the requesting agent controls — worth designing deliberately when it's picked up, not bolted on.
