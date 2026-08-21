# Open Commerce — Landing Page Content Brief

Compiled from the codebase (`protocol/`, `gate-kit/`, `registry/`, `storefront/`) and the project's Drive docs (`agent-design-commerce-spec.md` v0, `agent-design-commerce-p1-requirements.md`) as of 2026-08-21. Hand this to Claude Design as the factual basis for a landing page — it's real product state, not aspirational copy, except where explicitly marked "not built yet."

---

## 1. Positioning (for the hero / one-liner)

**What it is, per the v0 spec:** an infrastructure layer, not a hosted marketplace, and not limited to design. A business keeps its existing site exactly as-is and adds a small drop-in snippet that makes its products discoverable and purchasable by AI agents — coding agents, shopping agents, browsing agents, and general-purpose assistants doing an ordinary web search.

**The core reframe worth putting front and center:** the primary discovery surface is the open web itself, not a registry. Any agent that can fetch a URL or run a search should be able to land on a business's existing page and understand what's for sale, the price, and how to buy it. A registry (MCP or otherwise) is an *additional* channel layered on top, not the backbone.

**Why design components first:** the schema.org `Product`/`Offer` pattern is generic — a bakery's custom cakes or a boutique's inventory could use the identical embed shape. Design components are the first vertical because they're a clean, well-understood asset with obvious per-unit pricing, not because the protocol is design-only. Worth a line on the landing page ("starting with design components, built for any product") rather than positioning this as a design-only tool.

**Zero-migration pitch:** "Installable in minutes, not a dashboard project." No login required to generate the embed snippet in v0. Business's existing page stays exactly where it is.

---

## 2. How it works — three layers (the protocol explainer section)

Ship this as a 3-step or 3-layer visual — it's the clearest way to explain the mechanism:

1. **The embed** (the actual v0 product) — a script tag / JSON-LD block pasted into a business's existing product page `<head>`. Emits standard `schema.org` `Product`/`Offer` data (so any crawler or browsing agent gets a usable minimum) *plus* an `openCommerce` extension block (component id, purchase endpoint, license type) for agents that understand the richer protocol.
2. **The discovery file** — a `.well-known/agent-commerce.json` a business's site exposes, listing everything they sell in one fetch. Convenience channel for agents that already know the pattern — not required for baseline discoverability.
3. **Registry listing** (optional, additive) — MCP registry submission and downstream directories (Smithery, Glama, PulseMCP, Claude's connector directory). An accelerant, not a prerequisite.

**Naming note for copy:** the protocol/brand is now called **Open Commerce** (renamed from "Agent Commerce" on 2026-08-21 across all visible copy, wordmarks, and the `openCommerce` JSON-LD key). The literal discovery-file path (`.well-known/agent-commerce.json`) and the `agent-commerce-gate-kit.onrender.com` hostname were deliberately *not* renamed — they're live infrastructure. Copy should say "Open Commerce" everywhere a human reads it; code samples showing the actual `.well-known` URL can keep the old path without it reading as inconsistent (it's a filename, not a brand mention).

### Example embed JSON-LD (good as a code-sample visual on the page)

```json
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "Multi-step Checkout Form",
  "description": "React + Tailwind checkout flow component, dark-mode ready.",
  "offers": {
    "@type": "Offer",
    "price": "10.00",
    "priceCurrency": "USD",
    "availability": "https://schema.org/InStock",
    "url": "https://priyaramesh.design/components/checkout-form"
  },
  "openCommerce": {
    "protocol_version": "0.1",
    "component_id": "cmp_8f2a1c",
    "purchase_endpoint": "https://priyaramesh.design/api/open-commerce/purchase",
    "license_type": "non-exclusive"
  }
}
```

### Purchase flow (good for a "how a purchase actually happens" diagram)

Request to the seller's own `purchase_endpoint`:
```json
{ "product_id": "cmp_8f2a1c", "buyer_token": "tok_dev_9f1a", "confirmed_by_human": true }
```
Response:
```json
{
  "transaction_id": "txn_a91f",
  "status": "completed",
  "asset_download_url": "https://priyaramesh.design/api/open-commerce/download/dl_xxxxx",
  "expires_at": "2026-08-20T00:00:00Z"
}
```
Money flows buyer → Stripe Connect → seller directly. The registry, if used at all, never sits in the payment path.

**Trust/safety points worth a section** (these are real, implemented constraints, good for a "why this is safe" trust bar):
- `confirmed_by_human` is a required field on every purchase — an agent cannot complete a charge without explicit human confirmation.
- Payments run through real Stripe Connect destination charges to the seller's own account; the platform never touches card data.
- Purchases only complete on a verified, signature-checked `payment_intent.succeeded` webhook — not on the request/response cycle.
- Download links are single-use, expiring tokens, not permanent URLs.
- Licensing is non-exclusive and trust-based (stated on every listing) — no DRM beyond token expiry.

---

## 3. Sellers section

**Who's live today (real example, not a mock):** Priya Ramesh, credentialed as "Ex-Shopify design systems lead." One seller, two live components, both $10 flat, non-exclusive license.

**What a seller gets** (from the P1 requirements' seller-facing dashboard, `gate-kit`):
- A dashboard listing their published components with gate/un-gate controls (require agent purchase, or leave open)
- A form to publish a new component (name, category, framework, price, code)
- A recent-sales panel
- Their `.well-known` discovery file URL, shown so they can verify what agents actually read
- A "Connect with Stripe" flow (Stripe Connect Express) so purchases pay out to them directly — no card handling on their end

**Onboarding pitch:** the v0 spec's own stated *target* is "under 30 minutes from 'I have a component' to 'it's purchasable by an agent.'" That's an aspirational goal from the spec doc, not a measured result — nobody's timed a real seller through the flow yet (see P1 requirements, workstream 2). The actual flow today is two steps (connect Stripe, publish one component) with no account-creation step at all, since there's no auth. Prefer copy grounded in that real shape ("two steps, no account to create") over restating an unverified minute count — landing-page copy in this brief has been updated accordingly (2026-08-21).

**Live reference pages** (use these as visual/content reference, not to copy pixel-for-pixel — they're already on the Open Commerce Stack design system):
- Seller dashboard: `agent-commerce-gate-kit.onrender.com` (source: `gate-kit/public/index.html`)
- Public storefront / components index: `checkout-form-product.vercel.app` (source: `storefront/index.html`)
- Individual component listing pages: `checkout-form-product.vercel.app/checkout-form`, `/command-palette`

---

## 4. Components section

**Current catalog (real data, from `gate-kit/data/seed.json`):**

| Component | Category | Framework | Price | Tags |
|---|---|---|---|---|
| Multi-step Checkout Form | forms | react-tailwind | $10.00 | WCAG AA, keyboard navigable, minimal, high-density, dark-mode-ready |
| Command Palette (Cmd+K) | navigation | react-tailwind | $10.00 | keyboard-first, cmdk, minimal |

**Pricing/licensing model (flat, simple — good for an FAQ or pricing callout):**
- Flat price per component, no tiers or bundles (explicit non-goal for now)
- Non-exclusive license — buyer gets to use it, seller can resell it to others
- No subscription, no revenue share disclosed publicly (Stripe Connect handles payout mechanics)

**What a listing page includes** (per `component-detail.schema.json`, useful for describing "what an agent sees before buying"): full description, dependencies, design tokens used, accessibility info (WCAG level, keyboard nav), a code preview snippet, and a compatibility score (0–1) — enough for an agent to evaluate fit without exposing the paid asset.

---

## 5. "Sign in" — status: not built yet, flag this explicitly

There is **no authentication system implemented today.** `gate-kit/public/index.html` (the seller dashboard) has no login — it's currently a single hard-coded seller (Priya Ramesh), publicly reachable with no session/auth layer at all. This is a known, explicitly scoped gap: the P1 requirements doc lists "Dashboard itself requires designer auth/login" as an open acceptance criterion under the (not-yet-built) designer-dashboard workstream.

**Recommendation for the landing page:** don't design a functioning "Sign in" flow as if it exists. Two honest options:
- **Primary CTA = "Connect with Stripe"** (or "Get started"), framed as the real first step a seller takes today, rather than a generic "Sign in" button that has nowhere to go.
- If a "Sign in" button is wanted for future-proofing the design, treat it as a placeholder/waitlist-style CTA ("Sign in — coming soon" or routes to a contact/waitlist form), not a real auth flow, until the dashboard-auth workstream ships.

There's also no buyer-facing sign-in — buyers are AI agents acting on a human's behalf, identified by a `buyer_token` tied to a saved Stripe payment method, not a login account.

---

## 6. Design system tokens already established (for visual consistency)

The dashboard and storefront pages already ship a defined "Open Commerce Stack" (formerly "Agent Commerce Stack") design system — reuse these tokens rather than inventing new ones, so the landing page feels like the same product:

**Color**
- `--surface-page`: `#F5F7FA` · `--surface-card`: `#FFFFFF` · `--surface-sunken`: `#EDF0F5` · `--surface-hover`: `#F2F5F9`
- `--border-subtle`: `#DFE4EC` · `--border-default`: `#CBD3E0`
- `--text-primary`: `#161C25` · `--text-secondary`: `#55606F` · `--text-tertiary`: `#737F92`
- `--blue-100`: `#DCE9FC` (avatar/badge bg) · `--blue-500`: `#1A73E8` (accent/links) · `--blue-700`: `#1552B0` (link hover)
- Semantic: warning amber for "Gated" states, success green for "Open"/connected states, danger red for "not connected" states

**Typography**
- Display serif (headings, prices): **Newsreader**
- UI sans (body, labels, buttons): **Instrument Sans**
- Mono (code, prices where tabular, URLs): **JetBrains Mono**, tabular figures for numerals
- Loaded via Google Fonts: `family=Newsreader:wght@400;500;600&family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500`

**Spacing / Radius / Shadow**
- Card radius: `--radius-lg` = 12px · pill/tag radius: `--radius-sm` = 6px
- Card shadow: `--shadow-sm` = `0 1px 2px rgba(22,28,37,.06), 0 1px 1px rgba(22,28,37,.04)`
- Section rhythm: 32px vertical gap between major sections is the established pattern site-wide

**Wordmark:** "Open Commerce Stack" — serif, 19px, weight 600, letter-spacing -0.03em (as it appears in the dashboard/listing-page headers today).

---

## 7. Suggested landing page structure (optional starting point)

1. Header: wordmark + primary CTA ("Connect with Stripe" / "Get started")
2. Hero: the core reframe — "the open web is the discovery surface, not a registry" — with the embed as the headline product
3. How it works: the 3-layer explainer (embed → discovery file → registry), with the JSON-LD code sample
4. Trust bar: human-confirmed purchases, real Stripe Connect, signature-verified webhooks, expiring download tokens
5. For sellers: dashboard preview (gate/ungate, publish, sales, discovery URL), "two steps, no account to create" onboarding framing
6. Live example: pull in the real Priya Ramesh listings (checkout form, command palette) as social proof / a live demo link
7. For agents/builders: MCP registry tools (`search_components`, `get_component`, `purchase_component`, `get_asset`) for anyone building an agent host integration
8. Footer CTA + links to the live storefront and dashboard
