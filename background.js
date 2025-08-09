// background.js — Mini GIF Footer (MV3)
// Injecte GIF + drag/clamp, support "Afficher partout", persistance URL + position.

const api = chrome;

// Storage keys
const KEY_ENABLED = "enabledEverywhere";   // bool
const KEY_GIF_URL = "currentGifUrl";       // string (http(s) ou dataURL)
const KEY_POS     = "currentGifPos";       // { top:number, left:number } en pixels

// Domain filters pour tabs.query (évite les pages "chrome://")
const URL_FILTERS = ["http://*/*", "https://*/*", "file://*/*"];

// Helper: lit l'état courant (enabled, url, position)
async function getState() {
  const st = await chrome.storage.local.get(["enabledEverywhere","currentGifUrl","currentGifPos"]);
  return {
    enabled: !!st.enabledEverywhere,
    url: st.currentGifUrl || "",
    pos: st.currentGifPos || null
  };
}

// Met à jour la position (appelé depuis la page injectée)
async function setPosition(top, left) {
  await api.storage.local.set({ [KEY_POS]: { top: Math.round(top), left: Math.round(left) } });
}

// Injecte CSS + DOM + logique drag/clamp dans un onglet donné
async function injectInto(tabId, { url, pos }) {
  if (!url) return;
  try {
    // 1) CSS
    await api.scripting.insertCSS({
      target: { tabId },
      files: ["inject.css"]
    });

    // 2) Script (isolated world) — crée/MAJ le DOM + DRAG + CLAMP + PERSIST → sendMessage SET_POS
    await api.scripting.executeScript({
      target: { tabId },
      func: (gifUrl, storedPos) => {
        const HOST_ID = "mini-gif-footer__host";
        const BOX_ID  = "mini-gif-footer";
        const IMG_ID  = "mini-gif-footer__img";
        const EDGE_PAD = 8; // marge intérieure
        const hasChrome = typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage;

        // 1) DOM host/box/img
        let host = document.getElementById(HOST_ID);
        if (!host) {
          host = document.createElement("div");
          host.id = HOST_ID;

          const box = document.createElement("div");
          box.id = BOX_ID;

          const img = document.createElement("img");
          img.id = IMG_ID;
          img.alt = "Mini GIF";

          box.appendChild(img);
          host.appendChild(box);
          document.documentElement.appendChild(host);
        }

        const box = document.getElementById(BOX_ID);
        const img = document.getElementById(IMG_ID);
        img.src = gifUrl;

        // 2) Position initiale
        // Si on a une position stockée (commune à tous les onglets), on l'applique en mode "libre" (top/left)
        if (storedPos && typeof storedPos.top === "number" && typeof storedPos.left === "number") {
          box.style.position = "fixed";
          box.style.transform = "none";
          box.style.bottom = "auto";
          box.style.right  = "auto";
          box.style.top  = `${storedPos.top}px`;
          box.style.left = `${storedPos.left}px`;
          reclamp(); // on s'assure que ça ne dépasse pas
        } else {
          // Sinon, on laisse le CSS par défaut (bas centré).
          // Rien à faire ici : `inject.css` gère bottom:10px + translateX(-50%).
        }

        // 3) Drag/clamp — attacher une seule fois
        if (!box.dataset.dragReady) {
          box.dataset.dragReady = "1";

          let dragging = false;
          let startX = 0, startY = 0;
          let startTop = 0, startLeft = 0;

          const onMouseDown = (e) => {
            dragging = true;
            box.style.cursor = "grabbing";

            const rect = box.getBoundingClientRect();

            // Passe en mode libre : écraser les contraintes CSS
            box.style.position = "fixed";
            box.style.transform = "none"; // plutôt que "", pour écraser la règle CSS
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

            // Clamp aux bords
            nextTop  = Math.max(EDGE_PAD, Math.min(nextTop,  vh - rect.height - EDGE_PAD));
            nextLeft = Math.max(EDGE_PAD, Math.min(nextLeft, vw - rect.width  - EDGE_PAD));

            box.style.top  = `${Math.round(nextTop)}px`;
            box.style.left = `${Math.round(nextLeft)}px`;
          };

          const onMouseUp = () => {
            if (!dragging) return;
            dragging = false;
            box.style.cursor = "grab";
            // Persister position globale (tous onglets partagent)
            const rect = box.getBoundingClientRect();
            if (hasChrome) {
              try { chrome.runtime.sendMessage({ type: "SET_POS", top: rect.top, left: rect.left }); } catch {}
            }
          };

          box.addEventListener("mousedown", onMouseDown);
          window.addEventListener("mousemove", onMouseMove);
          window.addEventListener("mouseup", onMouseUp);

          // Re-clamp si la fenêtre change (zoom/resize) et persister
          window.addEventListener("resize", () => {
            reclamp(true);
          });
        }

        // Reclamp helper (et persiste si demandé)
        function reclamp(persist = false) {
          const rect = box.getBoundingClientRect();
          const vw = window.innerWidth;
          const vh = window.innerHeight;

          let top  = rect.top;
          let left = rect.left;

          top  = Math.max(EDGE_PAD, Math.min(top,  vh - rect.height - EDGE_PAD));
          left = Math.max(EDGE_PAD, Math.min(left, vw - rect.width  - EDGE_PAD));

          box.style.position = "fixed";
          box.style.transform = "none";
          box.style.bottom = "auto";
          box.style.right  = "auto";
          box.style.top  = `${Math.round(top)}px`;
          box.style.left = `${Math.round(left)}px`;

          if (persist && hasChrome) {
            try { chrome.runtime.sendMessage({ type: "SET_POS", top, left }); } catch {}
          }
        }
      },
      args: [url, pos]
    });
  } catch (e) {
    // ex: chrome://, chromewebstore… => ignore
  }
}

// Active/désactive le mode "Afficher partout"
async function setEnabledEverywhere(enabled) {
  await api.storage.local.set({ [KEY_ENABLED]: !!enabled });
  if (!enabled) return;
  const st = await getState();
  if (!st.url) return;
  // Injecte dans tous les onglets visibles (HTTP/HTTPS/FILE)
  const tabs = await api.tabs.query({ url: URL_FILTERS });
  for (const t of tabs) {
    if (t.id) await injectInto(t.id, { url: st.url, pos: st.pos });
  }
}

// === Listeners cycle de vie ===

// Au démarrage / installation : si "enabled", ré-injecter là où c'est possible
api.runtime.onInstalled.addListener(async () => {
  const st = await getState();
  if (st.enabled && st.url) {
    const tabs = await api.tabs.query({ url: URL_FILTERS });
    for (const t of tabs) if (t.id) await injectInto(t.id, { url: st.url, pos: st.pos });
  }
});
api.runtime.onStartup?.addListener(async () => {
  const st = await getState();
  if (st.enabled && st.url) {
    const tabs = await api.tabs.query({ url: URL_FILTERS });
    for (const t of tabs) if (t.id) await injectInto(t.id, { url: st.url, pos: st.pos });
  }
});

// À chaque navigation complétée : si enabled, injecter
api.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== "complete") return;
  const st = await getState();
  if (st.enabled && st.url) {
    await injectInto(tabId, { url: st.url, pos: st.pos });
  }
});

// === Messages depuis la popup ===
// - SET_GIF_URL: définit l'URL courante, et si enabled → injecte partout
// - SET_ENABLED: active/désactive le mode partout (et injecte si on active)
// - INJECT_CURRENT_TAB: injecte seulement dans l'onglet actif
// - SET_POS: (provenant de la page injectée) met à jour la position globale partagée
api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "SET_GIF_URL") {
        await api.storage.local.set({ [KEY_GIF_URL]: msg.url });
        const st = await getState();
        if (st.enabled) {
          // injecte dans tous les onglets ouverts
          const tabs = await api.tabs.query({ url: URL_FILTERS });
          for (const t of tabs) if (t.id) await injectInto(t.id, { url: msg.url, pos: st.pos });
        } else {
          // Si pas enabled, on ne force pas partout (la popup peut demander l'onglet courant)
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
        if (tab?.id && st.url) {
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
  return true; // async response
});
