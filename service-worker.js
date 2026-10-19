const APP_TITLE = "Malawi Education";

self.addEventListener("install", event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", event => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data?.text() || "" };
  }

  const title = typeof payload.title === "string" && payload.title.trim()
    ? payload.title.slice(0, 120)
    : APP_TITLE;
  const target = typeof payload.url === "string" ? payload.url : "/index.html";
  let safeUrl = "/index.html";
  try {
    const url = new URL(target, self.location.origin);
    if (url.origin === self.location.origin && url.pathname.startsWith("/") &&
      !url.pathname.startsWith("//")) {
      safeUrl = `${url.pathname}${url.search}${url.hash}`;
    }
  } catch {
    safeUrl = "/index.html";
  }

  event.waitUntil(self.registration.showNotification(title, {
    body: typeof payload.body === "string" ? payload.body.slice(0, 240) : "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: typeof payload.notificationId === "string" ? payload.notificationId : undefined,
    data: { url: safeUrl }
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = typeof event.notification.data?.url === "string"
    ? event.notification.data.url
    : "/index.html";
  event.waitUntil((async () => {
    let url;
    try {
      url = new URL(target, self.location.origin);
    } catch {
      url = new URL("/index.html", self.location.origin);
    }
    if (url.origin !== self.location.origin) url = new URL("/index.html", self.location.origin);
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.navigate(url.href);
        return client.focus();
      }
    }
    return self.clients.openWindow(url.href);
  })());
});

// No application/API caching: authentication, live content and protected downloads
// always use the network and retain their existing cache/access behavior.
