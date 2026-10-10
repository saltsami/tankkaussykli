import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

async function worker(windows: unknown[] = []) {
  const handlers: Record<string, (event: unknown) => void> = {};
  const notifications: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const cache = new Map<string, Response>();
  const self = { location: { origin: "https://tankkaus.test" },
    addEventListener(name: string, fn: (event: unknown) => void) { handlers[name] = fn; },
    skipWaiting() {}, registration: { async showNotification(title: string, options: Record<string, unknown>) { notifications.push({ title, options }); } },
    clients: { async claim() {}, async matchAll() { return windows; }, async openWindow(url: string) { opened.push(url); } } };
  vm.runInNewContext(await readFile(new URL("../../public/sw.js", import.meta.url), "utf8"), {
    self, URL, Request, Response, Date, Promise, encodeURIComponent,
    caches: { async open() { return {
      async match(req: Request) { return cache.get(req.url)?.clone(); },
      async put(req: Request, response: Response) { cache.set(req.url, response); },
      async keys() { return [...cache.keys()].map((url) => new Request(url)); },
      async delete(req: Request) { return cache.delete(req.url); },
    }; } },
  });
  async function fire(name: string, props: Record<string, unknown>) {
    const promises: Promise<unknown>[] = [];
    handlers[name]({ ...props, waitUntil(p: Promise<unknown>) { promises.push(p); } });
    await Promise.all(promises);
  }
  return { notifications, opened, fire };
}
const payload = { title: "Hintavahti", body: "Diesel 1,999 €/l", tag: "delivery-1",
  expiresAt: new Date(Date.now() + 60000).toISOString(), url: "/?station=node-42&fuel=DIESEL" };
test("service worker receives push with no open windows, and deduplicates concurrent deliveries", async () => {
  const sw = await worker();
  await Promise.all([sw.fire("push", { data: { json: () => payload } }), sw.fire("push", { data: { json: () => payload } })]);
  assert.equal(sw.notifications.length, 1);
  assert.equal(sw.notifications[0].options.tag, "delivery-1");
});
test("service worker drops expired or malformed payloads", async () => {
  const sw = await worker();
  for (const value of [null, {}, { ...payload, expiresAt: "invalid" }, { ...payload, expiresAt: new Date(Date.now() - 1).toISOString() }]) await sw.fire("push", { data: { json: () => value } });
  await sw.fire("push", { data: { json() { throw new Error("invalid"); } } });
  assert.equal(sw.notifications.length, 0);
});
test("notification clicks open the correct station and reject foreign origins", async () => {
  const sw = await worker();
  let closed = 0;
  await sw.fire("notificationclick", { notification: { close() { closed++; }, data: { url: payload.url } } });
  assert.equal(sw.opened[0], "https://tankkaus.test/?station=node-42&fuel=DIESEL");
  await sw.fire("notificationclick", { notification: { close() {}, data: { url: "https://evil.test/" } } });
  assert.equal(sw.opened[1], "https://tankkaus.test/"); assert.equal(closed, 1);
});
test("notification clicks navigate and focus an existing app window", async () => {
  let navigated = ""; let focused = false;
  const sw = await worker([{ url: "https://tankkaus.test/", async navigate(url: string) { navigated = url; }, async focus() { focused = true; } }]);
  await sw.fire("notificationclick", { notification: { close() {}, data: { url: payload.url } } });
  assert.match(navigated, /station=node-42/); assert.equal(focused, true); assert.equal(sw.opened.length, 0);
});
