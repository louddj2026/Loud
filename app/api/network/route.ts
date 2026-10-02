import { networkInterfaces } from "node:os";
import { canDiscoverLanAddress, crowdPhoneUrl, publicCrowdUrl, selectLanIpv4, type NetworkAddress } from "../../../lib/lan-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const configuredUrl = publicCrowdUrl(process.env.CROWD_PUBLIC_URL);
  if (configuredUrl) {
    return Response.json({
      address: null,
      crowdUrl: configuredUrl,
      reachable: true,
    }, { headers: { "Cache-Control": "no-store" } });
  }
  // Public deployments must never enumerate the host's private interfaces.
  // Invalid public configuration fails closed instead of exposing a LAN URL.
  const requestHosts = [request.headers.get("host"), request.headers.get("x-forwarded-host")].filter((host): host is string => host !== null);
  const localRequest = canDiscoverLanAddress(request.url) && requestHosts.every((host) => canDiscoverLanAddress(`http://${host}/`));
  if (process.env.CROWD_PUBLIC_URL?.trim() || process.env.CROWD_DEPLOYMENT_ROLE === "edge" || !localRequest) {
    return Response.json({ address: null, crowdUrl: null, reachable: false }, { headers: { "Cache-Control": "no-store" } });
  }
  const requestUrl = new URL(request.url);
  const address = selectLanIpv4(networkInterfaces() as Record<string, NetworkAddress[] | undefined>);
  const crowdUrl = crowdPhoneUrl(address, requestUrl.port || "3200");
  return Response.json({
    address,
    crowdUrl,
    reachable: Boolean(crowdUrl),
  }, { headers: { "Cache-Control": "no-store" } });
}
