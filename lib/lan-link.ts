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

function lanInterfaceRank(name: string) {
  const label = name.toLowerCase();
  // These adapters commonly expose private-looking addresses that are only
  // reachable by the host or a tunnel. They must never outrank the physical
  // LAN used by a listener's phone.
  if (/vethernet|hyper-v|wsl|docker|virtualbox|\bvbox\b|vmware|bluetooth|loopback/.test(label)) return 0;
  if (/wi-?fi|wireless|\bwlan\b/.test(label)) return 4;
  if (/ethernet|\blan\b/.test(label)) return 3;
  if (/tailscale|wireguard|\bvpn\b|\btun\d*\b|\btap\d*\b/.test(label)) return 1;
  return 2;
}

export function selectLanIpv4(interfaces: Record<string, NetworkAddress[] | undefined>) {
  return Object.entries(interfaces)
    .flatMap(([name, addresses]) => (addresses ?? []).map((entry) => ({ name, entry })))
    .filter(({ entry }) => !entry.internal && (entry.family === "IPv4" || entry.family === 4))
    .map(({ name, entry }) => ({
      address: entry.address,
      addressRank: privateIpv4Rank(entry.address),
      interfaceRank: lanInterfaceRank(name),
    }))
    .filter((entry) => entry.addressRank > 0 && entry.interfaceRank > 0)
    .sort((left, right) => right.interfaceRank - left.interfaceRank
      || right.addressRank - left.addressRank
      || left.address.localeCompare(right.address))[0]?.address ?? null;
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

export function canServeLanDiscovery(requestUrl: string, requestHosts: string[], explicitlyEnabled = false) {
  if (requestHosts.length === 0 || requestHosts.some((host) => !canDiscoverLanAddress(`http://${host}/`))) return false;
  return explicitlyEnabled || canDiscoverLanAddress(requestUrl);
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
