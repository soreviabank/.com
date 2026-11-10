importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");
/* Même moteur de traduction que le site (10 langues, intégré, sans service externe) */
importScripts("./i18n.js");

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(clients.claim()));

/* Langue du destinataire, enregistrée par push.js sur CE téléphone (IndexedDB) */
function storedLang() {
  return new Promise(res => {
    try {
      const r = indexedDB.open("sorevia-i18n", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => {
        try { const g = r.result.transaction("kv").objectStore("kv").get("lang"); g.onsuccess = () => res(g.result || null); g.onerror = () => res(null); }
        catch (_) { res(null); }
      };
      r.onerror = () => res(null);
    } catch (_) { res(null); }
  });
}

firebase.initializeApp({apiKey:"AIzaSyA_iq7zGnD4100DM06D9sXgMjbCwfqq3JU",authDomain:"sorevia-bank.firebaseapp.com",projectId:"sorevia-bank",storageBucket:"sorevia-bank.firebasestorage.app",messagingSenderId:"729316261396",appId:"1:729316261396:web:bfeebed60e968c65433101"});
const messaging = firebase.messaging();

/* Notification reçue quand le site est fermé ou en arrière-plan */
messaging.onBackgroundMessage(payload => {
  const d = payload.data || {};
  return storedLang().then(stored => {
    /* priorité : langue mémorisée du téléphone > langue du token envoyée par le serveur > langue du navigateur */
    const I = self.__i18n, ok = l => l && I.langs.indexOf(l) > -1;
    const lang = ok(stored) ? stored : ok(d.lang) ? d.lang : I.lang;
    const n = I.notif(d, lang);
    return self.registration.showNotification(n.title || "Sorevia Bank", {
    body: n.body || "",
    icon: "icon-192.png",
    badge: "icon-192.png",
    tag: d.tag || undefined,
    data: { url: d.url || "./espace.html" }
    });
  });
});

/* Clic sur la notification : ouvre ou ramène l'espace */
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "./", self.registration.scope).href;
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      for (const c of list) { if (c.url.split("?")[0] === target.split("?")[0] && "focus" in c) return c.focus(); }
      return clients.openWindow(target);
    })
  );
});
