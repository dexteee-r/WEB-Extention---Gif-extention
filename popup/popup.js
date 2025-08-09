// popup/popup.js
const api = chrome;

const PRESETS = [
  "https://media.giphy.com/media/Ju7l5y9osyymQ/giphy.gif",
  "https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif",
  "https://media.giphy.com/media/3o6ZsX2d6YkG2vQWFW/giphy.gif"
];

const KEY_LIB = "library";
const KEY_GIF_URL = "currentGifUrl";
const KEY_ENABLED = "enabledEverywhere";

const urlInput = document.getElementById("gifUrl");
const showBtn = document.getElementById("show");
const hideBtn = document.getElementById("hide");
const presetsEl = document.getElementById("presets");
const uploader = document.getElementById("uploader");
const libraryEl = document.getElementById("library");
const everywhereCb = document.getElementById("everywhere");

// UI init
(async function init() {
  // presets
  PRESETS.forEach((u) => {
    const b = document.createElement("button");
    const img = document.createElement("img");
    img.src = u;
    img.alt = "preset";
    b.appendChild(img);
    b.title = u;
    b.addEventListener("click", async () => {
      urlInput.value = u;
      await setCurrentGif(u, { injectCurrentTab: true });
    });
    presetsEl.appendChild(b);
  });

  // restore current gif + everywhere
  const st = await api.storage.local.get([KEY_GIF_URL, KEY_ENABLED, KEY_LIB]);
  if (st[KEY_GIF_URL]) urlInput.value = st[KEY_GIF_URL];
  everywhereCb.checked = Boolean(st[KEY_ENABLED]);

  // render library
  renderLibrary(st[KEY_LIB] || []);
})();

showBtn.addEventListener("click", async () => {
  const url = urlInput.value.trim();
  if (!url) return;
  await setCurrentGif(url, { injectCurrentTab: true });
});

hideBtn.addEventListener("click", async () => {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await api.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const host = document.getElementById("mini-gif-footer__host");
      if (host) host.remove();
    }
  });
});

everywhereCb.addEventListener("change", async () => {
  await api.runtime.sendMessage({ type: "SET_ENABLED", enabled: everywhereCb.checked });
});

// uploads → dataURL → storage.local
uploader.addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;

  const st = await api.storage.local.get(KEY_LIB);
  const lib = st[KEY_LIB] || [];

  for (const file of files) {
    if (!file.type.includes("gif")) continue;
    const dataUrl = await fileToDataURL(file);
    lib.push({
      id: crypto.randomUUID(),
      name: file.name,
      dataUrl
    });
  }
  await api.storage.local.set({ [KEY_LIB]: lib });
  renderLibrary(lib);
  uploader.value = "";
});

function renderLibrary(lib) {
  libraryEl.innerHTML = "";
  lib.forEach(item => {
    const b = document.createElement("button");
    const img = document.createElement("img");
    img.src = item.dataUrl;
    img.alt = item.name || "gif";
    b.title = item.name || "GIF";
    b.appendChild(img);
    b.addEventListener("click", async () => {
      urlInput.value = item.dataUrl;
      await setCurrentGif(item.dataUrl, { injectCurrentTab: true });
    });
    libraryEl.appendChild(b);
  });
}

async function setCurrentGif(url, opts = {}) {
  // mémorise l’URL courante (peut être DataURL)
  await api.storage.local.set({ [KEY_GIF_URL]: url });

  // demande au background d’appliquer partout si le mode est actif
  await api.runtime.sendMessage({ type: "SET_GIF_URL", url });

  // et dans l’onglet courant (usage “Afficher (onglet)”)
  if (opts.injectCurrentTab) {
    await api.runtime.sendMessage({ type: "INJECT_CURRENT_TAB" });
  }
}

function fileToDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}
