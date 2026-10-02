import assert from "node:assert/strict";
import test from "node:test";
import { createListenerWakeLock } from "../lib/listener-wake-lock.ts";

const flush = () => new Promise(resolve => setImmediate(resolve));
class Lock extends EventTarget {
  releases = 0;
  async release() { this.releases++; this.dispatchEvent(new Event("release")); }
}

test("a visible listener acquires once, releases in background and reacquires on return", async () => {
  let visible = true;
  const locks = [], states = [];
  const controller = createListenerWakeLock({ visible: () => visible, report: s => states.push(s), request: async () => { const lock = new Lock(); locks.push(lock); return lock; } });
  controller.setEnabled(true);
  await flush();
  await controller.refresh();
  assert.equal(locks.length, 1);
  assert.equal(states.at(-1), "held");
  visible = false;
  await controller.refresh();
  assert.equal(locks[0].releases, 1);
  assert.equal(states.at(-1), "background");
  visible = true;
  await controller.refresh();
  assert.equal(locks.length, 2);
  controller.setEnabled(false);
  assert.equal(locks[1].releases, 1);
  await controller.refresh();
  assert.equal(locks.length, 2, "paused listener never reacquires");
  controller.dispose();
});

test("a grant arriving after unmount is released with no late state update", async () => {
  let grant;
  const states = [];
  const lock = new Lock();
  const controller = createListenerWakeLock({ visible: () => true, report: s => states.push(s), request: () => new Promise(resolve => { grant = resolve; }) });
  controller.setEnabled(true);
  controller.dispose();
  grant(lock);
  await flush();
  assert.equal(lock.releases, 1);
  assert.deepEqual(states, []);
});

test("hide and return during pending request discards the old grant then acquires once", async () => {
  let visible = true, grant, calls = 0;
  const locks = [new Lock(), new Lock()];
  const controller = createListenerWakeLock({ visible: () => visible, report: () => {}, request: () => ++calls === 1 ? new Promise(resolve => { grant = resolve; }) : Promise.resolve(locks[1]) });
  controller.setEnabled(true);
  visible = false;
  await controller.refresh();
  visible = true;
  await controller.refresh();
  grant(locks[0]);
  await flush();
  assert.equal(locks[0].releases, 1);
  assert.equal(calls, 2);
  controller.dispose();
  assert.equal(locks[1].releases, 1);
});

test("denial and unsupported connections report unavailable without failing playback", async () => {
  for (const request of [undefined, async () => { throw new Error("NotAllowedError"); }]) {
    const states = [];
    const controller = createListenerWakeLock({ request, visible: () => true, report: s => states.push(s) });
    controller.setEnabled(true);
    await flush();
    assert.equal(states.at(-1), "unavailable");
    controller.dispose();
  }
});

test("OS release is reported; next visible interaction may request again", async () => {
  const states = [], locks = [];
  const controller = createListenerWakeLock({ visible: () => true, report: s => states.push(s), request: async () => { const lock = new Lock(); locks.push(lock); return lock; } });
  controller.setEnabled(true);
  await flush();
  await locks[0].release();
  assert.equal(states.at(-1), "unavailable");
  await controller.refresh();
  assert.equal(locks.length, 2);
  controller.dispose();
});
