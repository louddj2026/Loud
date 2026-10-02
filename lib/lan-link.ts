export type NetworkAddress = {
  address: string;
  family: string | number;
  internal: boolean;
};

function privateIpv4Rank(address: string) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return 0;
  if (octets[0] === 192 && octets[1] === 168) return 4;
  if (octets[0] === 10) return 3;
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return 2;
  // Never advertise public, link-local or other non-private interfaces.
  return 0;
}

export function selectLanIpv4(interfaces: Record<string, NetworkAddress[] | undefined>) {
  return Object.values(interfaces)
    .flatMap((addresses) => addresses ?? [])
    .filter((entry) => !entry.internal && (entry.family === "IPv4" || entry.family === 4))
    .map((entry) => ({ address: entry.address, rank: privateIpv4Rank(entry.address) }))
    .filter((entry) => entry.rank > 0)
    .sort((left, right) => right.rank - left.rank || left.address.localeCompare(right.address))[0]?.address ?? null;
}

export function crowdPhoneUrl(address: string | null, port: string | number) {
  if (!address || !privateIpv4Rank(address)) return null;
  const safePort = String(port).replace(/\D/g, "") || "3200";
  return `http://${address}:${safePort}/crowd`;
}

export function canDiscoverLanAddress(requestUrl: string) {
  try {
    const { hostname, username, password } = new URL(requestUrl);
    if (username || password) return false;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
      || privateIpv4Rank(hostname) > 0;
  } catch { return false; }
}

export function publicCrowdUrl(value: string | undefined) {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    // A configured public link must not carry credentials or private tokens.
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    if (!url.hostname.includes(".") || /^[\d.]+$/.test(url.hostname) || url.hostname.includes(":")) return null;
    if (/\.(localhost|local|internal|lan|home|test|invalid)$/.test(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}
