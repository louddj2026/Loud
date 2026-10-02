import assert from "node:assert/strict";
import test from "node:test";
import { canDiscoverLanAddress, crowdPhoneUrl, publicCrowdUrl, selectLanIpv4 } from "../lib/lan-link.ts";

test("the phone link prefers the current private Wi-Fi address", () => {
  const address = selectLanIpv4({
    VPN: [{ address: "10.20.0.4", family: "IPv4", internal: false }],
    WiFi: [{ address: "192.168.0.2", family: "IPv4", internal: false }],
    Loopback: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
  });
  assert.equal(address, "192.168.0.2");
  assert.equal(crowdPhoneUrl(address, 3200), "http://192.168.0.2:3200/crowd");
});

test("no phone link is advertised without a reachable network address", () => {
  assert.equal(selectLanIpv4({ Loopback: [{ address: "127.0.0.1", family: 4, internal: true }] }), null);
  assert.equal(crowdPhoneUrl(null, 3200), null);
});

test("QR discovery uses each installation's private interfaces and rejects internet addresses", () => {
  for (const address of ["192.168.0.2", "10.0.0.2", "172.16.0.2"]) {
    assert.equal(selectLanIpv4({ Ethernet: [{ address, family: 4, internal: false }] }), address);
    assert.equal(crowdPhoneUrl(address, 3201), `http://${address}:3201/crowd`);
  }
  for (const address of ["203.0.113.5", "198.51.100.1", "169.254.1.2", "127.0.0.1", "999.1.1.1", "::1"]) {
    assert.equal(selectLanIpv4({ Ethernet: [{ address, family: 4, internal: false }] }), null);
    assert.equal(crowdPhoneUrl(address, 3200), null);
  }
});

test("public hosts cannot trigger LAN discovery", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]", "192.168.0.2"]) assert.equal(canDiscoverLanAddress(`http://${host}:3201/api/network`), true);
  for (const host of ["example.com", "203.0.113.5"]) assert.equal(canDiscoverLanAddress(`https://${host}/api/network`), false);
});

test("configured public QR URLs reject credentials, query tokens, fragments and IPs", () => {
  assert.equal(publicCrowdUrl("https://example.com/crowd"), "https://example.com/crowd");
  for (const url of ["https://user:secret@example.com/crowd", "https://example.com/crowd?token=secret", "https://example.com/#secret", "http://example.com/crowd", "https://192.168.0.2/crowd", "https://203.0.113.5/crowd", "https://booth.local/crowd", "not a url"]) assert.equal(publicCrowdUrl(url), null);
});
