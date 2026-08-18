// Not part of the shipped product — proves the MCP server works end to end
// by acting as a minimal agent host: spawn the server over stdio, call each
// tool in sequence, print what an agent would see.

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const path = require('path');

function parse(result) {
  return JSON.parse(result.content[0].text);
}

async function main() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.join(__dirname, 'mcp-server.js')],
  });
  const client = new Client({ name: 'test-agent', version: '0.1.0' });
  await client.connect(transport);

  console.log('=== 1. search_components(query="checkout") ===');
  const search = await client.callTool({
    name: 'search_components',
    arguments: { query: 'checkout' },
  });
  const searchResult = parse(search);
  console.log(JSON.stringify(searchResult, null, 2));
  const top = searchResult.results[0];

  console.log(`\n=== 2. get_component(${top.component_id}) ===`);
  const detail = await client.callTool({
    name: 'get_component',
    arguments: { component_id: top.component_id },
  });
  console.log(JSON.stringify(parse(detail), null, 2));

  console.log('\n=== 3. purchase_component WITHOUT confirmation (should be rejected) ===');
  const rejected = await client.callTool({
    name: 'purchase_component',
    arguments: { component_id: top.component_id, buyer_token: 'tok_dev_9f1a', confirmed_by_human: false },
  });
  console.log(JSON.stringify(parse(rejected), null, 2), '| isError:', !!rejected.isError);

  console.log('\n=== 4. purchase_component WITH human confirmation ===');
  const purchase = await client.callTool({
    name: 'purchase_component',
    arguments: { component_id: top.component_id, buyer_token: 'tok_dev_9f1a', confirmed_by_human: true },
  });
  const purchaseResult = parse(purchase);
  console.log(JSON.stringify(purchaseResult, null, 2));

  // P1: purchases only succeed once the designer has completed real Stripe
  // Connect onboarding (POST /api/stripe/connect on the gate-kit, then the
  // hosted onboarding flow). Until then this is the correct, expected
  // response — not a bug. See gate-kit/README section on P1 status.
  if (purchaseResult.error === 'seller_not_onboarded') {
    console.log('\n(seller has not completed Stripe Connect onboarding yet — this is the correct P1 gate, not a failure)');
    await client.close();
    return;
  }
  if (purchaseResult.error === 'buyer_payment_method_required') {
    console.log('\n(no saved payment method for this buyer_token — run `node scripts/create-test-buyer.js tok_dev_9f1a` in gate-kit/ first)');
    await client.close();
    return;
  }

  console.log('\n=== 5. get_asset (download purchased files) ===');
  const asset = await client.callTool({
    name: 'get_asset',
    arguments: { component_id: top.component_id, access_token: purchaseResult.asset_download.access_token },
  });
  const assetResult = parse(asset);
  console.log('files delivered:', assetResult.files.map((f) => f.path).join(', '));
  console.log('install:', assetResult.install_instructions);

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
