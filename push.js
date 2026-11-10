/* Sorevia Bank — notifications push (FCM). Utilisé par espace.html et index.html */
import { getMessaging, getToken, onMessage, isSupported, deleteToken } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";
import { doc, setDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* >>> Colle ici ta clé VAPID PUBLIQUE (Firebase > Paramètres du projet > Cloud Messaging > Certificats Web Push) <<< */
export const VAPID_KEY = "BJ1z0-bJheONGicu3IAvCP6C5xyGCePHlIcaBPRgIZbkJexCPS--ojK7tbdCXrdKM5tvTLNIMhxvg95aSmrVy1U";

/* ---- Langue du destinataire : mémorisée pour le premier plan ET pour le service worker (site fermé) ---- */
const I18N = () => window.__i18n || { lang: "fr", T: s => s, notif: d => ({ title: d.title || "Sorevia Bank", body: d.body || d.message || "" }) };
export const currentLang = () => I18N().lang || "fr";
function idbPut(key, val) {
  return new Promise(res => {
    try {
      const r = indexedDB.open("sorevia-i18n", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => { try { const t = r.result.transaction("kv", "readwrite"); t.objectStore("kv").put(val, key); t.oncomplete = () => res(true); t.onerror = () => res(false); } catch (_) { res(false); } };
      r.onerror = () => res(false);
    } catch (_) { res(false); }
  });
}
export async function saveLang() {
  const lang = currentLang();
  try { localStorage.setItem("sorevia_lang", lang); } catch (_) {}
  await idbPut("lang", lang);
  return lang;
}
saveLang();

const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

async function sha(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].slice(0, 10).map(x => x.toString(16).padStart(2, "0")).join("");
}

/* "ios-install" | "unsupported" | "default" | "denied" | "granted" */
export async function pushStatus() {
  if (isIOS && !standalone) return "ios-install";
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
  try { if (!(await isSupported())) return "unsupported"; } catch (_) { return "unsupported"; }
  return Notification.permission;
}

async function register() {
  const reg = await navigator.serviceWorker.register("./firebase-messaging-sw.js");
  await navigator.serviceWorker.ready;
  return reg;
}

async function saveToken(app, db, uid) {
  if (VAPID_KEY.startsWith("COLLE_ICI")) throw Object.assign(new Error("Clé VAPID manquante dans push.js"), { code: "config" });
  const reg = await register();
  const token = await getToken(getMessaging(app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
  if (!token) return false;
  await setDoc(doc(db, "pushTokens", uid + "_" + await sha(token)),
    { uid, token, ua: navigator.userAgent.slice(0, 200), updatedAt: serverTimestamp() }, { merge: true });
  /* langue du destinataire, lisible par le serveur d'envoi (champ « lang » du token et du profil) */
  const lang = await saveLang();
  try { await setDoc(doc(db, "pushTokens", uid + "_" + await sha(token)), { lang }, { merge: true }); } catch (e) { console.warn("Langue (token) :", e); }
  try { await setDoc(doc(db, "users", uid), { lang }, { merge: true }); } catch (e) { console.warn("Langue (profil) :", e); }
  return true;
}

/* Appelé quand la personne clique sur « Activer » : demande la permission puis enregistre le téléphone */
export async function enablePush(app, db, uid) {
  const st = await pushStatus();
  if (st === "ios-install" || st === "unsupported" || st === "denied") return st;
  const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (perm !== "granted") return perm;
  try { return (await saveToken(app, db, uid)) ? "granted" : "error"; }
  catch (e) { console.error("Push :", e); return e.code === "config" ? "config" : "error"; }
}

/* Appelé à chaque ouverture : remet à jour le token sans rien demander si c'est déjà autorisé */
export async function refreshPush(app, db, uid) {
  if ((await pushStatus()) !== "granted") return;
  try { await saveToken(app, db, uid); } catch (e) { console.warn("Push :", e); }
}

/* Appelé à la déconnexion : ce téléphone ne reçoit plus les alertes de ce compte */
export async function disablePush(app, db, uid) {
  if ((await pushStatus()) !== "granted" || VAPID_KEY.startsWith("COLLE_ICI")) return;
  const m = getMessaging(app);
  const reg = await register();
  const token = await getToken(m, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
  if (token) { try { await deleteDoc(doc(db, "pushTokens", uid + "_" + await sha(token))); } catch (_) {} }
  try { await deleteToken(m); } catch (_) {}
}

/* Affiche une notification système (fenêtre en haut du téléphone) depuis la page, sans serveur */
export async function showLocal(title, body, url, tag) {
  if (!("Notification" in window) || Notification.permission !== "granted" || !("serviceWorker" in navigator)) return false;
  try {
    const n = I18N().notif({ title, body }, currentLang());   // traduit dans la langue de l'utilisateur
    title = n.title; body = n.body.slice(0, 180);
    const reg = await register();
    await reg.showNotification(title, { body, icon: "icon-192.png", badge: "icon-192.png", tag: tag || undefined, data: { url: url || "./" }, vibrate: [120, 60, 120] });
    return true;
  } catch (e) { console.warn("Notification locale :", e); return false; }
}

/* Message reçu quand le site est ouvert au premier plan */
export function onForeground(app, cb) {
  try {
    onMessage(getMessaging(app), p => {
      const d = p.data || {}, n = I18N().notif(d, currentLang());   // langue du destinataire (pas celle de l'admin)
      cb({ ...d, title: n.title, body: n.body });
    });
  } catch (_) {}
}
