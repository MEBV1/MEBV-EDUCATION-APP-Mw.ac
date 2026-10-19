const PUSH_CATEGORY_LABELS = {
  books: "Books",
  vacancies: "Vacancies",
  videos: "Videos",
  python: "Python Academy",
  blogs: "Blogs"
};
const PUSH_TOKEN_DATABASE = "mebv-push-management";
let deferredInstallPrompt = null;
let pushWorkerRegistration = null;
let anonymousTokenPromise = null;

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  updateInstallButton();
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  updateInstallButton();
});

document.addEventListener("DOMContentLoaded", initializePushPwa);

async function initializePushPwa() {
  injectPushControls();
  updateInstallButton();
  window.matchMedia("(display-mode: standalone)").addEventListener?.("change", updateInstallButton);
  if (navigator.serviceWorker && window.isSecureContext) {
    try {
      pushWorkerRegistration = await navigator.serviceWorker.register("/service-worker.js", {
        scope: "/",
        updateViaCache: "none"
      });
      await navigator.serviceWorker.ready;
      pushWorkerRegistration.addEventListener("updatefound", () => {
        const installing = pushWorkerRegistration.installing;
        installing?.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            window.showToast?.("A MEBV update is ready. Reload to use the latest version.", "info");
          }
        });
      });
      await associateSubscriptionAfterLogin();
    } catch (error) {
      console.error("PWA service worker could not be registered:", error);
    }
  }
  initializeInstallInstructions();
  window.supabaseClient?.auth.onAuthStateChange((event, session) => {
    if (session?.user && ["INITIAL_SESSION", "SIGNED_IN", "TOKEN_REFRESHED"].includes(event)) {
      void associateSubscription(session.user.id);
    }
  });
}

function injectPushControls() {
  const actions = document.querySelector(".header-actions");
  if (actions && !document.getElementById("install-app-button")) {
    const controls = document.createElement("div");
    controls.className = "pwa-header-actions";
    controls.innerHTML = `
      <button type="button" class="btn btn-outline btn-sm pwa-action-button" id="notification-settings-button" aria-haspopup="dialog">
        <span aria-hidden="true">🔔</span><span>Notifications</span>
      </button>
      <button type="button" class="btn btn-primary btn-sm pwa-action-button" id="install-app-button" aria-haspopup="dialog">
        <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 17v3h14v-3"/></svg>
        <span>Install App</span>
      </button>`;
    actions.insertBefore(controls, actions.querySelector("#mobile-menu-btn"));
    document.getElementById("install-app-button").addEventListener("click", installOrExplain);
    document.getElementById("notification-settings-button").addEventListener("click", openNotificationSettings);
  }

  if (!document.getElementById("pwa-install-help")) {
    const help = document.createElement("div");
    help.id = "pwa-install-help";
    help.className = "modal-overlay";
    help.setAttribute("aria-hidden", "true");
    help.innerHTML = `
      <section class="modal-box pwa-help-dialog" role="dialog" aria-modal="true" aria-labelledby="pwa-help-title">
        <button class="modal-close-btn" type="button" data-close-pwa-help aria-label="Close">&times;</button>
        <h2 class="modal-title" id="pwa-help-title">Install MEBV Education</h2>
        <div class="modal-body" id="pwa-help-content"></div>
        <div class="modal-footer"><button type="button" class="btn btn-primary" data-close-pwa-help>Done</button></div>
      </section>`;
    document.body.appendChild(help);
    help.querySelectorAll("[data-close-pwa-help]").forEach(button => button.addEventListener("click", () => closeDialog(help)));
    help.addEventListener("click", event => { if (event.target === help) closeDialog(help); });
  }

  if (!document.getElementById("push-settings-modal")) {
    const modal = document.createElement("div");
    modal.id = "push-settings-modal";
    modal.className = "modal-overlay";
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = `
      <section class="modal-box push-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="push-settings-title">
        <button class="modal-close-btn" type="button" data-close-push-settings aria-label="Close">&times;</button>
        <h2 class="modal-title" id="push-settings-title">Notification preferences</h2>
        <p class="push-settings-intro">Choose which new content updates you want. General announcements are always included while notifications are enabled.</p>
        <div id="push-settings-status" class="push-settings-status" role="status" aria-live="polite"></div>
        <fieldset class="push-preference-list" id="push-preference-list" disabled>
          <legend>Content categories</legend>
          <label class="push-preference"><input type="checkbox" checked disabled><span>General Announcements <small>Always included</small></span></label>
          ${Object.entries(PUSH_CATEGORY_LABELS).map(([category, label]) =>
            `<label class="push-preference"><input type="checkbox" data-push-category="${category}" checked><span>${label}</span></label>`
          ).join("")}
        </fieldset>
        <div class="modal-footer push-settings-actions">
          <button type="button" class="btn btn-outline" id="push-subscribe-button">Enable Notifications</button>
          <button type="button" class="btn btn-primary" id="push-save-preferences-button" disabled>Save preferences</button>
          <button type="button" class="btn btn-outline" id="push-unsubscribe-button" hidden>Turn off</button>
        </div>
      </section>`;
    document.body.appendChild(modal);
    modal.querySelectorAll("[data-close-push-settings]").forEach(button => button.addEventListener("click", () => closeDialog(modal)));
    modal.addEventListener("click", event => { if (event.target === modal) closeDialog(modal); });
    document.getElementById("push-subscribe-button").addEventListener("click", subscribeToPush);
    document.getElementById("push-save-preferences-button").addEventListener("click", savePushPreferences);
    document.getElementById("push-unsubscribe-button").addEventListener("click", unsubscribeFromPush);
  }
}

function closeDialog(dialog) {
  dialog.classList.remove("active");
  dialog.setAttribute("aria-hidden", "true");
}

function openDialog(dialog) {
  dialog.classList.add("active");
  dialog.setAttribute("aria-hidden", "false");
  dialog.querySelector("button")?.focus();
}

function isInstalled() {
  return window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    navigator.standalone === true;
}

function isAppleMobileDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function updateInstallButton() {
  const button = document.getElementById("install-app-button");
  if (button) button.hidden = isInstalled();
}

function initializeInstallInstructions() {
  const help = document.getElementById("pwa-install-help");
  if (!help) return;
  const ios = isAppleMobileDevice();
  const content = document.getElementById("pwa-help-content");
  if (ios) {
    content.innerHTML = `<p>In Safari, tap <strong>Share</strong>, then choose <strong>Add to Home Screen</strong> and confirm.</p>`;
  } else if (/Android/i.test(navigator.userAgent)) {
    content.innerHTML = `<p>Open this page in Chrome or another supported browser, tap its menu, then choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</p>`;
  } else {
    content.innerHTML = `<p>In your browser menu, choose <strong>Install MEBV Education</strong> or <strong>Create shortcut</strong>, then select the option to open it as a window if offered.</p>`;
  }
}

async function installOrExplain() {
  if (isInstalled()) {
    updateInstallButton();
    return;
  }
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    updateInstallButton();
    return;
  }
  openDialog(document.getElementById("pwa-install-help"));
}

function setPushStatus(message, isError = false) {
  const status = document.getElementById("push-settings-status");
  if (!status) return;
  status.textContent = message;
  status.dataset.error = isError ? "true" : "false";
}

async function invokePush(body) {
  if (!window.supabaseClient) throw new Error("The secure connection is not ready. Reload and try again.");
  const { data, error } = await window.supabaseClient.functions.invoke("push-api", { body });
  if (error) {
    const response = error.context && typeof error.context.clone === "function"
      ? await error.context.clone().json().catch(() => null)
      : null;
    throw new Error(response?.error || error.message || "The notification request failed.");
  }
  return data;
}

function openPushTokenDatabase() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("This browser cannot securely remember anonymous notification settings."));
      return;
    }
    const request = indexedDB.open(PUSH_TOKEN_DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("secrets");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Secure notification settings could not be opened."));
  });
}

async function readPushTokenRecords() {
  const database = await openPushTokenDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("secrets", "readonly");
    const store = transaction.objectStore("secrets");
    const keyRequest = store.get("key");
    const tokenRequest = store.get("token");
    transaction.oncomplete = () => resolve({ key: keyRequest.result, token: tokenRequest.result });
    transaction.onerror = () => reject(new Error("Secure notification settings could not be read."));
  });
}

async function writePushTokenRecords(key, token) {
  const database = await openPushTokenDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("secrets", "readwrite");
    const store = transaction.objectStore("secrets");
    store.put(key, "key");
    store.put(token, "token");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(new Error("Secure notification settings could not be saved."));
  });
}

async function getAnonymousToken() {
  if (!anonymousTokenPromise) {
    anonymousTokenPromise = (async () => {
      const records = await readPushTokenRecords();
      if (records.key && records.token) {
        try {
          const plaintext = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: records.token.iv },
            records.key,
            records.token.ciphertext
          );
          return new TextDecoder().decode(plaintext);
        } catch {
          throw new Error("The saved anonymous notification settings could not be unlocked.");
        }
      }
      const key = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
      );
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const token = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(""))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        new TextEncoder().encode(token)
      );
      await writePushTokenRecords(key, { iv, ciphertext });
      return token;
    })().catch(error => {
      anonymousTokenPromise = null;
      throw error;
    });
  }
  return anonymousTokenPromise;
}

async function openNotificationSettings() {
  const modal = document.getElementById("push-settings-modal");
  openDialog(modal);
  const supported = "serviceWorker" in navigator && "PushManager" in window &&
    "Notification" in window && window.isSecureContext;
  const subscribeButton = document.getElementById("push-subscribe-button");
  const preferences = document.getElementById("push-preference-list");
  const saveButton = document.getElementById("push-save-preferences-button");
  const unsubscribeButton = document.getElementById("push-unsubscribe-button");
  if (!supported) {
    setPushStatus("Web Push is not supported in this browser. Try a current browser on HTTPS.", true);
    subscribeButton.hidden = true;
    preferences.disabled = true;
    saveButton.disabled = true;
    unsubscribeButton.hidden = true;
    return;
  }
  if (isAppleMobileDevice() && !isInstalled()) {
    setPushStatus("On iPhone and iPad, install MEBV to the Home Screen first, then open the installed app to enable notifications.");
    subscribeButton.hidden = false;
    subscribeButton.disabled = true;
    preferences.disabled = true;
    saveButton.disabled = true;
    unsubscribeButton.hidden = true;
    return;
  }
  subscribeButton.hidden = false;
  subscribeButton.disabled = false;
  const registration = pushWorkerRegistration || await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    setPushStatus(Notification.permission === "denied"
      ? "Notifications are blocked in browser settings. Allow them there, then return here."
      : "Enable notifications to receive general announcements and choose content categories.");
    preferences.disabled = true;
    saveButton.disabled = true;
    unsubscribeButton.hidden = true;
    return;
  }
  try {
    const token = await getAnonymousToken();
    const result = await invokePush({
      action: "get-preferences",
      endpoint: subscription.endpoint,
      anonymousToken: token
    });
    const selected = new Set(result.preferences || []);
    document.querySelectorAll("[data-push-category]").forEach(input => {
      input.checked = selected.has(input.dataset.pushCategory);
    });
    preferences.disabled = false;
    saveButton.disabled = false;
    unsubscribeButton.hidden = false;
    subscribeButton.hidden = true;
    setPushStatus("Notifications are enabled on this device.");
  } catch (error) {
    preferences.disabled = true;
    saveButton.disabled = true;
    unsubscribeButton.hidden = true;
    setPushStatus(error.message, true);
  }
}

async function subscribeToPush() {
  const button = document.getElementById("push-subscribe-button");
  button.disabled = true;
  try {
    if (isAppleMobileDevice() && !isInstalled()) {
      throw new Error("First add MEBV to your Home Screen and open the installed app.");
    }
    if (!window.isSecureContext || !("Notification" in window) || !("PushManager" in window)) {
      throw new Error("Web Push requires a supported browser on HTTPS.");
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error("Notification permission was not granted.");
    const registration = pushWorkerRegistration || await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      const config = await invokePush({ action: "config" });
      const key = decodeVapidPublicKey(config.vapidPublicKey);
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key
      });
    }
    const result = await invokePush({
      action: "subscribe",
      subscription: subscription.toJSON(),
      anonymousToken: await getAnonymousToken()
    });
    document.querySelectorAll("[data-push-category]").forEach(input => {
      input.checked = (result.preferences || []).includes(input.dataset.pushCategory);
    });
    document.getElementById("push-preference-list").disabled = false;
    document.getElementById("push-save-preferences-button").disabled = false;
    document.getElementById("push-unsubscribe-button").hidden = false;
    button.hidden = true;
    setPushStatus("Notifications are enabled on this device. Choose your content categories and save.");
  } catch (error) {
    setPushStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
}

function decodeVapidPublicKey(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("The notification service has an invalid public key configuration.");
  }
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  const bytes = Uint8Array.from(raw, character => character.charCodeAt(0));
  if (bytes.byteLength !== 65) throw new Error("The notification service has an invalid public key.");
  return bytes;
}

async function savePushPreferences() {
  const button = document.getElementById("push-save-preferences-button");
  button.disabled = true;
  try {
    const subscription = await (pushWorkerRegistration || await navigator.serviceWorker.ready)
      .pushManager.getSubscription();
    if (!subscription) throw new Error("This browser is not subscribed.");
    const preferences = ["general"];
    document.querySelectorAll("[data-push-category]").forEach(input => {
      if (input.checked) preferences.push(input.dataset.pushCategory);
    });
    await invokePush({
      action: "preferences",
      endpoint: subscription.endpoint,
      anonymousToken: await getAnonymousToken(),
      preferences
    });
    setPushStatus("Your notification preferences have been saved.");
  } catch (error) {
    setPushStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function unsubscribeFromPush() {
  const button = document.getElementById("push-unsubscribe-button");
  button.disabled = true;
  try {
    const registration = pushWorkerRegistration || await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await invokePush({
        action: "unsubscribe",
        endpoint: subscription.endpoint,
        anonymousToken: await getAnonymousToken()
      });
      await subscription.unsubscribe();
    }
    document.getElementById("push-preference-list").disabled = true;
    document.getElementById("push-save-preferences-button").disabled = true;
    document.getElementById("push-subscribe-button").hidden = false;
    button.hidden = true;
    setPushStatus("Notifications have been turned off for this device.");
  } catch (error) {
    setPushStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function associateSubscriptionAfterLogin() {
  const { data } = await window.supabaseClient?.auth.getSession() || {};
  if (data?.session?.user) await associateSubscription(data.session.user.id);
}

async function associateSubscription() {
  try {
    const registration = pushWorkerRegistration || await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;
    await invokePush({
      action: "associate",
      endpoint: subscription.endpoint,
      anonymousToken: await getAnonymousToken()
    });
  } catch (error) {
    console.warn("Push device association was not completed:", error.message);
  }
}

window.MEBVPush = {
  invoke: invokePush,
  categories: {
    general: "General Announcements",
    books: "Books",
    vacancies: "Vacancies",
    videos: "Videos",
    python: "Python Academy",
    blogs: "Blogs"
  }
};
