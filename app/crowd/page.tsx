import type { Metadata } from "next";
import CrowdRoom from "./crowd-room";
import "./crowd-room.css";

export const metadata: Metadata = {
  title: "Loudlink — Loud",
  description: "Join the live mix and send reactions straight to the DJ booth.",
};

export const dynamic = "force-dynamic";

// DJ, 27 Aug 2026: a crowd page whose script chunks died (server restarted
// since the page was cached) renders this shell and then does NOTHING — dead
// buttons, no beacons, no way to see why. This inline script ships INSIDE the
// HTML, so it runs even when every chunk 404s: if the client component hasn't
// stamped itself alive within 8 s, the page says so and one tap reloads it.
const staleShellWatch = `
setTimeout(function () {
  if (window.__crowd2Hydrated) return;
  var banner = document.createElement("div");
  banner.style.cssText = "position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:rgba(2,5,8,.96);color:#ffd7dc;font-family:monospace;text-align:center;cursor:pointer;padding:24px";
  banner.innerHTML = "<div style='font-size:22px;font-weight:700;letter-spacing:.08em'>PAGE OUT OF DATE</div><div style='font-size:14px;color:#8fc5ff'>The booth restarted since this page loaded.<br/>TAP ANYWHERE TO RELOAD</div>";
  banner.addEventListener("click", function () { location.reload(); });
  document.body.appendChild(banner);
}, 8000);
`;

export default function CrowdPage() {
  return <>
    <script dangerouslySetInnerHTML={{ __html: staleShellWatch }} />
    <CrowdRoom />
  </>;
}
