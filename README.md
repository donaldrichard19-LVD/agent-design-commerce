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
This is what was run to validate the build: search finds the checkout form, `get_component` returns full detail, a purchase attempt without `confirmed_by_human: true` is correctly rejected, a confirmed purchase succeeds and returns a download token, and `get_asset` delivers the actual component files.

## What's mocked vs. production-shaped

| Piece | Status |
|---|---|
| Discovery file schema, MCP tool shapes, human-in-the-loop gate | Production-shaped — this is the real contract |
| Payment | Mocked. `gate-kit/server.js` has inline comments marking exactly where a real Stripe PaymentIntent + webhook confirmation replaces the synchronous mock |
| Registry crawling | Real polling logic, but the seed list is one local domain — production points it at real designer domains on a schedule |
| Designer dashboard | Functional (add/gate/toggle components, view sales) but unstyled — this is the piece the build plan flags as the real engineering investment for P1 |

## Next step, per the build plan

This covers P0's technical validation (protocol works, purchase flow works, agent can complete the loop). What's still manual: getting 3-5 real designers to put real components behind this, and testing whether the delivered code is actually good enough to drop into a real project untouched. That's the part no amount of local testing substitutes for.

## P1 status

See `agent-design-commerce-p1-requirements.md` in Drive for the full P1 scope. This local project is where P1 workstream 1 (real Stripe Connect) is being built, replacing the mock in `gate-kit/server.js`.
