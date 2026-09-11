/*
 * Companion browser window with Chrome-style top tabs: browse wikis and
 * pickup calendars while the game keeps running in the main window.
 */
const { BrowserWindow, WebContentsView, ipcMain } = require("electron");
const path = require("path");

const TABBAR_H = 30;
const ADDRBAR_H = 34;
const HOME_URL = "https://wiki.pokerogue.net/";

let deps = null; // { settings, save }
let win = null;
let tabs = []; // { id, view }
let activeId = null;
let nextId = 1;

function init(d) {
  deps = d;
  registerIpc();
}

function normalizeUrl(input) {
  let target = String(input).trim();
  if (!/^[a-z]+:\/\//i.test(target)) {
    target =
      /\s/.test(target) || !target.includes(".")
        ? `https://www.google.com/search?q=${encodeURIComponent(target)}`
        : `https://${target}`;
  }
  return target;
}

function activeTab() {
  return tabs.find(t => t.id === activeId) || null;
}

function panelSend(channel, payload) {
  if (win && !win.webContents.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

function layout() {
  if (!win) {
    return;
  }
  const [w, h] = win.getContentSize();
  const top = TABBAR_H + ADDRBAR_H;
  for (const t of tabs) {
    t.view.setBounds({ x: 0, y: top, width: w, height: Math.max(0, h - top) });
  }
}

function sendTabs() {
  panelSend(
    "tabs",
    tabs.map(t => ({
      id: t.id,
      title: t.view.webContents.getTitle() || t.view.webContents.getURL() || "새 탭",
      active: t.id === activeId,
    })),
  );
}

function sendUrl() {
  const t = activeTab();
  panelSend("url", t ? t.view.webContents.getURL() : "");
}

function activate(id) {
  if (!tabs.some(t => t.id === id)) {
    return;
  }
  activeId = id;
  for (const t of tabs) {
    t.view.setVisible(t.id === id);
  }
  sendTabs();
  sendUrl();
  const t = activeTab();
  if (t) {
    t.view.webContents.focus();
  }
}

function newTab(url, background = false) {
  const view = new WebContentsView({
    webPreferences: {
      partition: "persist:pokerogue-browser",
      preload: path.join(__dirname, "web-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const id = nextId++;
  tabs.push({ id, view });
  win.contentView.addChildView(view);
  view.setVisible(false);
  layout();

  const wc = view.webContents;
  wc.setWindowOpenHandler(({ url: u }) => {
    newTab(u);
    return { action: "deny" };
  });
  const refresh = () => {
    sendTabs();
    if (id === activeId) {
      sendUrl();
    }
  };
  wc.on("did-navigate", refresh);
  wc.on("did-navigate-in-page", refresh);
  wc.on("page-title-updated", sendTabs);
  attachHotkeys(wc);

  wc.loadURL(normalizeUrl(url || HOME_URL)).catch(() => {});
  if (!background) {
    activate(id);
  } else {
    sendTabs();
  }
  return id;
}

function closeTab(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) {
    return;
  }
  const [t] = tabs.splice(idx, 1);
  win.contentView.removeChildView(t.view);
  t.view.webContents.close();
  if (tabs.length === 0) {
    win.close();
    return;
  }
  if (activeId === id) {
    activate(tabs[Math.min(idx, tabs.length - 1)].id);
  } else {
    sendTabs();
  }
}

function cycleTab(dir) {
  if (tabs.length < 2) {
    return;
  }
  const idx = tabs.findIndex(t => t.id === activeId);
  activate(tabs[(idx + dir + tabs.length) % tabs.length].id);
}

function attachHotkeys(wc) {
  wc.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || !input.control || input.alt || input.meta || input.isAutoRepeat) {
      return;
    }
    const key = input.key.toLowerCase();
    if (key === "l") {
      panelSend("focus-address");
      win.webContents.focus();
    } else if (key === "r") {
      activeTab()?.view.webContents.reload();
    } else if (key === "t") {
      newTab(HOME_URL);
    } else if (key === "w") {
      closeTab(activeId);
    } else if (key === "tab") {
      cycleTab(input.shift ? -1 : 1);
    } else {
      return;
    }
    event.preventDefault();
  });
}

function create() {
  const b = deps.settings.browserBounds || {};
  win = new BrowserWindow({
    width: b.width || 1000,
    height: b.height || 680,
    x: b.x,
    y: b.y,
    backgroundColor: "#141416",
    title: "PokeRogue Mini Browser",
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#141416", symbolColor: "#7c7c82", height: TABBAR_H },
    webPreferences: {
      preload: path.join(__dirname, "browser-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenu(null);
  win.loadFile(path.join(__dirname, "browser.html"));
  win.on("resize", layout);
  attachHotkeys(win.webContents);

  win.on("close", () => {
    deps.settings.browserBounds = win.getBounds();
    deps.save();
  });
  win.on("closed", () => {
    for (const t of tabs) {
      t.view.webContents.close();
    }
    tabs = [];
    activeId = null;
    win = null;
  });
}

function open(url, focusAddress) {
  if (!win) {
    create();
    newTab(url || HOME_URL);
  } else {
    if (win.isMinimized()) {
      win.restore();
    }
    if (url) {
      newTab(url);
    }
  }
  win.show();
  win.focus();
  if (focusAddress) {
    panelSend("focus-address");
    win.webContents.focus();
  }
}

function registerIpc() {
  ipcMain.on("b-nav", (_e, dir) => {
    const t = activeTab();
    if (!t) {
      return;
    }
    const nav = t.view.webContents.navigationHistory;
    if (dir === "back" && nav.canGoBack()) {
      nav.goBack();
    } else if (dir === "forward" && nav.canGoForward()) {
      nav.goForward();
    }
  });
  ipcMain.on("b-navigate", (_e, url) => {
    const t = activeTab();
    if (t && typeof url === "string") {
      t.view.webContents.loadURL(normalizeUrl(url)).catch(() => {});
    }
  });
  ipcMain.on("b-reload", () => activeTab()?.view.webContents.reload());
  ipcMain.on("b-focus-view", () => activeTab()?.view.webContents.focus());
  ipcMain.on("b-tab-new", () => win && newTab(HOME_URL));
  ipcMain.on("b-tab-close", (_e, id) => closeTab(id));
  ipcMain.on("b-tab-activate", (_e, id) => activate(id));
}

module.exports = { init, open };
