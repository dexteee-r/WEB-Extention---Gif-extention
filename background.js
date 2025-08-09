// background.js — Mini GIF Footer (MV3)
// - Injection GIF + drag/clamp
// - "Afficher partout" (toutes fenêtres/onglets)
// - Persistance URL + position partagée
// - Réinjection: onInstalled, onStartup, onUpdated, onActivated, onFocusChanged, onCreated

const api = chrome;

// Storage keys
const KEY_ENABLED = "enabledEverywhere";   // bool
const KEY_GIF_URL = "currentGifUrl";       // string (http(s) ou dataURL)
const KEY_POS     = "currentGifPos";       // { top:number, left:number }

const URL_FILTERS = ["http://*/*", "https://*/*", "file://*/*"];

// ===== Helpers =====
async function getState() {
  const st = await api.storage.local.get([KEY_ENABLED, KEY_GIF_URL, KEY_POS]);
  return {
    enabled: !!st[KEY_ENABLED],
    url: st[KEY_GIF_URL] || "",
    pos: st[KEY_POS] || null
  };
}

async function setPosition(top, left) {
  await api.storage.local.set({ [KEY_POS]: { top: Math.round(top), left: Math.round(left) } });
}

function isInjectableUrl(url) {
  return /^https?:|^file:/.test(url || "");
}

// ===== Injection =====
async function injectInto(tabId, { url, pos }) {
  if (!url) return;
  try {
    // 1) CSS
    await api.scripting.insertCSS({ target: { tabId }, files: ["inject.css"] });

    // 2) JS (recrée DOM + handlers à chaque injection)
    await api.scripting.executeScript({
      target: { tabId },
      func: (gifUrl, storedPos) => {
        const HOST_ID = "mini-gif-footer__host";
        const BOX_ID  = "mini-gif-footer";
        const IMG_ID  = "mini-gif-footer__img";
        const EDGE_PAD = 8;

        // Nettoyage: supprime toute instance précédente -> évite handlers "fantômes"
        const prev = document.getElementById(HOST_ID);
        if (prev) prev.remove();

        // DOM
        const host = document.createElement("div");
        host.id = HOST_ID;

        const box = document.createElement("div");
        box.id = BOX_ID;
        box.style.cursor = "grab"; // curseur par défaut

        const img = document.createElement("img");
        img.id = IMG_ID;
        img.alt = "Mini GIF";

        box.appendChild(img);
        host.appendChild(box);
        document.documentElement.appendChild(host);

        // Applique le GIF
        img.src = gifUrl;

        // Position initiale:
        // si position stockée -> mode libre (top/left, transform none)
        if (storedPos && typeof storedPos.top === "number" && typeof storedPos.left === "number") {
          box.style.position = "fixed";
          box.style.transform = "none";
          box.style.bottom = "auto";
          box.style.right  = "auto";
          box.style.top  = `${storedPos.top}px`;
          box.style.left = `${storedPos.left}px`;
          reclamp(false); // clamp sans persist immédiat
        }
        // sinon: laisse le CSS par défaut (bas, centré) défini dans inject.css

        // Drag + clamp
        let dragging = false;
        let startX = 0, startY = 0;
        let startTop = 0, startLeft = 0;

        const onMouseDown = (e) => {
          dragging = true;
          box.style.cursor = "grabbing";

          const rect = box.getBoundingClientRect();
          // Passe en mode libre et écrase toute contrainte CSS
          box.style.position = "fixed";
          box.style.transform = "none";
          box.style.bottom = "auto";
          box.style.right  = "auto";
          box.style.top  = `${rect.top}px`;
          box.style.left = `${rect.left}px`;

          startX = e.clientX;
          startY = e.clientY;
          startTop = rect.top;
          startLeft = rect.left;
          e.preventDefault();
        };

        const onMouseMove = (e) => {
          if (!dragging) return;
          const dx = e.clientX - startX;
          const dy = e.clientY - startY;

          const rect = box.getBoundingClientRect();
          const vw = window.innerWidth;
          const vh = window.innerHeight;

          let nextTop  = startTop + dy;
          let nextLeft = startLeft + dx;

          nextTop  = Math.max(EDGE_PAD, Math.min(nextTop,  vh - rect.height - EDGE_PAD));
          nextLeft = Math.max(EDGE_PAD, Math.min(nextLeft, vw - rect.width  - EDGE_PAD));

          box.style.top  = `${Math.round(nextTop)}px`;
          box.style.left = `${Math.round(nextLeft)}px`;
        };

        const onMouseUp = () => {
          if (!dragging) return;
          dragging = false;
          box.style.cursor = "grab";
          const rect = box.getBoundingClientRect();
          // Persiste position globale
          if (chrome?.runtime?.sendMessage) {
            try { chrome.runtime.sendMessage({ type: "SET_POS", top: rect.top, left: rect.left }); } catch {}
          }
        };

        box.addEventListener("mousedown", onMouseDown);
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);

        // Reclamp sur resize + persist
        window.addEventListener("resize", () => reclamp(true));

        function reclamp(persist) {
          const rect = box.getBoundingClientRect();
          const vw = window.innerWidth;
          const vh = window.innerHeight;

          let top  = Math.max(EDGE_PAD, Math.min(rect.top,  vh - rect.height - EDGE_PAD));
          let left = Math.max(EDGE_PAD, Math.min(rect.left, vw - rect.width  - EDGE_PAD));

          box.style.position = "fixed";
          box.style.transform = "none";
          box.style.bottom = "auto";
          box.style.right  = "auto";
          box.style.top  = `${Math.round(top)}px`;
          box.style.left = `${Math.round(left)}px`;

          if (persist && chrome?.runtime?.sendMessage) {
            try { chrome.runtime.sendMessage({ type: "SET_POS", top, left }); } catch {}
          }
        }
      },
      args: [url, pos]
    });
  } catch {
    // ex: chrome:// ou pages protégées => ignore
  }
}

// ===== Mode "Afficher partout" =====
async function setEnabledEverywhere(enabled) {
  await api.storage.local.set({ [KEY_ENABLED]: !!enabled });
  if (!enabled) return;
  const st = await getState();
  if (!st.url) return;
  const tabs = await api.tabs.query({ url: URL_FILTERS });
  for (const t of tabs) {
    if (t.id && isInjectableUrl(t.url)) {
      await injectInto(t.id, { url: st.url, pos: st.pos });
    }
  }
}

// ===== Réinjections automatiques =====
api.runtime.onInstalled.addListener(async () => {
  const st = await getState();
  if (st.enabled && st.url) {
    const tabs = await api.tabs.query({ url: URL_FILTERS });
    for (const t of tabs) if (t.id && isInjectableUrl(t.url)) {
      await injectInto(t.id, { url: st.url, pos: st.pos });
    }
  }
});

api.runtime.onStartup?.addListener(async () => {
  const st = await getState();
  if (st.enabled && st.url) {
    const tabs = await api.tabs.query({ url: URL_FILTERS });
    for (const t of tabs) if (t.id && isInjectableUrl(t.url)) {
      await injectInto(t.id, { url: st.url, pos: st.pos });
    }
  }
});

// Quand la page finit de charger
api.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== "complete") return;
  const st = await getState();
  if (st.enabled && st.url && isInjectableUrl(tab?.url)) {
    await injectInto(tabId, { url: st.url, pos: st.pos });
  }
});

// Quand on change d’onglet actif
api.tabs.onActivated.addListener(async ({ tabId }) => {
  const st = await getState();
  if (!st.enabled || !st.url) return;
  try {
    const tab = await api.tabs.get(tabId);
    if (tab?.url && isInjectableUrl(tab.url)) {
      await injectInto(tabId, { url: st.url, pos: st.pos });
    }
  } catch {}
});

// Quand on change de fenêtre
api.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === api.windows.WINDOW_ID_NONE) return;
  const st = await getState();
  if (!st.enabled || !st.url) return;
  try {
    const [tab] = await api.tabs.query({ active: true, windowId });
    if (tab?.id && isInjectableUrl(tab.url)) {
      await injectInto(tab.id, { url: st.url, pos: st.pos });
    }
  } catch {}
});

// Quand un onglet est créé
api.tabs.onCreated.addListener(async (tab) => {
  const st = await getState();
  if (!st.enabled || !st.url) return;
  if (tab.id && isInjectableUrl(tab.url)) {
    await injectInto(tab.id, { url: st.url, pos: st.pos });
  }
});

// ===== Messages depuis popup =====
api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "SET_GIF_URL") {
        await api.storage.local.set({ [KEY_GIF_URL]: msg.url });
        const st = await getState();
        if (st.enabled) {
          const tabs = await api.tabs.query({ url: URL_FILTERS });
          for (const t of tabs) if (t.id && isInjectableUrl(t.url)) {
            await injectInto(t.id, { url: msg.url, pos: st.pos });
          }
        }
        sendResponse({ ok: true });
        return;
      }

      if (msg?.type === "SET_ENABLED") {
        await setEnabledEverywhere(Boolean(msg.enabled));
        sendResponse({ ok: true });
        return;
      }

      if (msg?.type === "INJECT_CURRENT_TAB") {
        const [tab] = await api.tabs.query({ active: true, currentWindow: true });
        const st = await getState();
        if (tab?.id && st.url && isInjectableUrl(tab.url)) {
          await injectInto(tab.id, { url: st.url, pos: st.pos });
        }
        sendResponse({ ok: true });
        return;
      }

      if (msg?.type === "SET_POS") {
        if (typeof msg.top === "number" && typeof msg.left === "number") {
          await setPosition(msg.top, msg.left);
        }
        sendResponse({ ok: true });
        return;
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  })();
  return true;
});
