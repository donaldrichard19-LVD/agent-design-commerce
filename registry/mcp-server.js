// This is the actual MCP entrypoint — run via `node mcp-server.js` and point
// an MCP-compatible host (Claude Code, Claude Desktop, Cursor, etc.) at it
// over stdio. It never touches payment or asset storage directly: purchase
// and download calls are proxied straight through to the component's own
// designer-hosted endpoints, per the "registry stays discovery-only"
// architecture call from the spec.

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const INDEX_PATH = path.join(__dirname, 'index.json');

function loadIndex() {
  if (!fs.existsSync(INDEX_PATH)) return { components: [] };
  return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
}

const server = new McpServer({
  name: 'agent-commerce-registry',
  version: '0.1.0',
});

server.registerTool(
  'search_components',
  {
    title: 'Search components',
    description: 'Search the registry for purchasable design components across all indexed designer sites.',
    inputSchema: {
      query: z.string().optional().describe('Free-text search across name/tags/category'),
      framework: z.string().optional(),
      category: z.string().optional(),
      max_price: z.number().optional(),
    },
  },
  async ({ query, framework, category, max_price }) => {
    const { components } = loadIndex();
    let results = components;
    if (framework) results = results.filter((c) => c.framework === framework);
    if (category) results = results.filter((c) => c.category === category);
    if (typeof max_price === 'number') results = results.filter((c) => c.price_usd <= max_price);
    if (query) {
      const q = query.toLowerCase();
      results = results.filter((c) =>
        c.name.toLowerCase().includes(q) ||
        (c.style_tags || []).some((t) => t.toLowerCase().includes(q))
      );
    }
    const summarized = results.map((c) => ({
      component_id: c.component_id,
      name: c.name,
      designer: c.seller.name,
      category: c.category,
      framework: c.framework,
      price_usd: c.price_usd,
      style_tags: c.style_tags,
    }));
    return { content: [{ type: 'text', text: JSON.stringify({ results: summarized }, null, 2) }] };
  }
);

server.registerTool(
  'get_component',
  {
    title: 'Get component detail',
    description: 'Fetch full detail for one component (dependencies, code preview, compatibility) before purchase.',
    inputSchema: { component_id: z.string() },
  },
  async ({ component_id }) => {
    const { components } = loadIndex();
    const c = components.find((x) => x.component_id === component_id);
    if (!c) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'not_found' }) }], isError: true };
    }
    const res = await fetch(c.detail_url);
    const detail = await res.json();
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ...detail,
          name: c.name,
          designer: c.seller.name,
          price_usd: c.price_usd,
          purchase_endpoint: c.purchase_endpoint,
        }, null, 2),
      }],
    };
  }
);

server.registerTool(
  'purchase_component',
  {
    title: 'Purchase component',
    description:
      'Purchase a component on behalf of the developer. Must only be called after the developer has explicitly approved this specific purchase — confirmed_by_human must be true.',
    inputSchema: {
      component_id: z.string(),
      buyer_token: z.string(),
      confirmed_by_human: z.boolean(),
    },
  },
  async ({ component_id, buyer_token, confirmed_by_human }) => {
    if (!confirmed_by_human) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'human_confirmation_required' }) }],
        isError: true,
      };
    }
    const { components } = loadIndex();
    const c = components.find((x) => x.component_id === component_id);
    if (!c) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'not_found' }) }], isError: true };
    }
    // Proxy straight to the designer's own purchase_endpoint — the registry
    // never holds funds. See build plan (c) / spec's payment section.
    const res = await fetch(c.purchase_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ component_id, buyer_token, confirmed_by_human }),
    });
    let result = await res.json();

    // P1: completion is webhook-driven on the gate-kit side, so a purchase
    // can come back 'pending' even after the gate-kit's own bounded wait.
    // Poll a few more times before handing the agent a non-final result —
    // in the common case (webhook already landed) this loop never runs.
    if (result.status === 'pending' && result.poll_url) {
      for (let i = 0; i < 10 && result.status === 'pending'; i++) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const pollRes = await fetch(result.poll_url);
        result = await pollRes.json();
      }
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  'check_purchase_status',
  {
    title: 'Check purchase status',
    description: 'Check on a purchase that purchase_component returned as still pending. Returns the download token once the payment has cleared.',
    inputSchema: { component_id: z.string(), transaction_id: z.string() },
  },
  async ({ component_id, transaction_id }) => {
    const { components } = loadIndex();
    const c = components.find((x) => x.component_id === component_id);
    if (!c) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'not_found' }) }], isError: true };
    }
    const statusUrl = `${c.seller.site_url}/api/purchase/${transaction_id}`;
    const res = await fetch(statusUrl);
    const result = await res.json();
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  'get_asset',
  {
    title: 'Get purchased asset',
    description: 'Download the licensed files for a component after purchase, using the access token from purchase_component.',
    inputSchema: {
      component_id: z.string(),
      access_token: z.string(),
    },
  },
  async ({ component_id, access_token }) => {
    const { components } = loadIndex();
    const c = components.find((x) => x.component_id === component_id);
    if (!c) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'not_found' }) }], isError: true };
    }
    const downloadUrl = `${c.seller.site_url}/api/download/${access_token}`;
    const res = await fetch(downloadUrl);
    const result = await res.json();
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main();
