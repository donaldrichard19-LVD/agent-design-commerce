// The submission endpoint fetches a URL supplied by an anonymous visitor —
// classic SSRF surface (someone submits a domain pointing at localhost,
// a cloud metadata endpoint, or an internal service). This blocks the
// obvious cases: non-http(s) schemes, and hostnames/resolved IPs in
// loopback/private/link-local ranges. It is not a full DNS-rebinding-proof
// implementation (the actual fetch re-resolves the hostname rather than
// using the IP checked here) — reasonable for a prototype's public
// self-serve form, not a substitute for network-level egress controls in
// a higher-stakes deployment.

const dns = require('dns').promises;

const BLOCKED_HOSTNAMES = new Set(['localhost', '0.0.0.0']);

function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  const [a, b] = parts;
  if (a === 127) return true; // loopback
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
  if (a === 0) return true; // 0.0.0.0/8
  return false;
}

function isPrivateIPv6(ip) {
  const lower = ip.toLowerCase();
  return (
    lower === '::1' || // loopback
    lower.startsWith('fc') || lower.startsWith('fd') || // unique local fc00::/7
    lower.startsWith('fe80') // link-local
  );
}

async function assertPublicHttpUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('not a valid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('only http/https URLs are allowed');
  }
  const hostname = parsed.hostname;
  if (BLOCKED_HOSTNAMES.has(hostname.toLowerCase())) {
    throw new Error('local/loopback hosts are not allowed');
  }
  if (isPrivateIPv4(hostname) || isPrivateIPv6(hostname)) {
    throw new Error('private/internal IP addresses are not allowed');
  }
  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new Error('could not resolve hostname');
  }
  for (const { address } of addresses) {
    if (isPrivateIPv4(address) || isPrivateIPv6(address)) {
      throw new Error('domain resolves to a private/internal IP address');
    }
  }
  return parsed;
}

module.exports = { assertPublicHttpUrl };
