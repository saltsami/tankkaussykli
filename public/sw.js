self.addEventListener("install", () => { self.skipWaiting(); });
self.addEventListener("activate", (event) => { event.waitUntil(self.clients.claim()); });
// Serialize notification work so concurrently delivered retries cannot race cache checks.
let pushWork = Promise.resolve();
self.addEventListener("push", (event) => {
  let data;
  try { data = event.data?.json(); } catch { return; }
  if (!data || typeof data.title !== "string" || typeof data.body !== "string") return;
  // A delayed provider delivery must not revive an expired observation.
  const expires = Date.parse(data.expiresAt);
  if (!Number.isFinite(expires) || expires <= Date.now()) return;
  pushWork = pushWork.catch(() => undefined).then(async () => {
    // CacheStorage survives browser closure. Suppress retries after an ambiguous server send.
    const cache = await caches.open("tankkaussykli.push-dedup.v1");
    const key = new Request(new URL(`/__push-dedup/${encodeURIComponent(data.tag)}`, self.location.origin));
    if (await cache.match(key)) return;
    let url = "/";
    try {
      const target = new URL(data.url, self.location.origin);
      if (target.origin === self.location.origin && target.pathname === "/") url = target.pathname + target.search;
    } catch { /* Open the application root for malformed links. */ }
    await self.registration.showNotification(data.title, {
      body: data.body, icon: "/app-icon.svg", tag: data.tag, data: { url },
    });
    await cache.put(key, new Response(String(expires)));
    // Bound the cache and remove old delivery identifiers.
    for (const oldKey of await cache.keys()) {
      const response = await cache.match(oldKey);
      if (response && Number(await response.text()) <= Date.now()) await cache.delete(oldKey);
    }
  });
  event.waitUntil(pushWork);
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  let target = new URL("/", self.location.origin);
  try {
    const requested = new URL(event.notification.data?.url ?? "/", self.location.origin);
    if (requested.origin === self.location.origin && requested.pathname === "/") target = requested;
  } catch { /* Use root. */ }
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
    const existing = clients.find((client) => new URL(client.url).origin === self.location.origin && "focus" in client);
    if (existing) { await existing.navigate(target.href); return existing.focus(); }
    return self.clients.openWindow(target.href);
  }));
});
