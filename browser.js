/*
 * Companion browser window: browse wikis/calendars while the game keeps
 * running in the main window, plus a Claude-powered strategy chat sidebar.
 */
const { BrowserWindow, WebContentsView, ipcMain, shell } = require("electron");
const path = require("path");

const TOPBAR_H = 34;
const TABSTRIP_W = 34;
const CHAT_W = 300;
const HOME_URL = "https://wiki.pokerogue.net/";

const SYSTEM_PROMPT =
  "당신은 PokéRogue(포켓로그, pokerogue.net) 공략 도우미입니다. " +
  "사용자의 주력 포켓몬(주로 전설)의 기술 배치, 성격, 아이템, 상성 등을 간결한 한국어로 조언합니다. " +
  "PokéRogue는 본가 포켓몬과 다른 점이 많습니다(스타터 코스트, 패시브 특성, 융합, 바이옴 진행, " +
  "월별 전설 알 픽업 로테이션 등). 게임 사양이 확실하지 않으면 웹 검색으로 wiki.pokerogue.net 등을 " +
  "확인한 뒤 답하세요. 답변은 짧고 실용적으로, 목록 위주로 작성하세요.";

let deps = null; // { settings, save }
let win = null;
let view = null;
let chatOpen = false;

let anthropicClient = null;
const chatHistory = [];
let chatBusy = false;

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

function layout() {
  if (!win || !view) {
    return;
  }
  const [w, h] = win.getContentSize();
  const left = TABSTRIP_W + (chatOpen ? CHAT_W : 0);
  view.setBounds({ x: left, y: TOPBAR_H, width: Math.max(0, w - left), height: Math.max(0, h - TOPBAR_H) });
}

function sendUrl() {
  if (win && !win.webContents.isDestroyed()) {
    win.webContents.send("url", view.webContents.getURL());
  }
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
    titleBarOverlay: { color: "#141416", symbolColor: "#7c7c82", height: 34 },
    webPreferences: {
      preload: path.join(__dirname, "browser-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenu(null);
  win.loadFile(path.join(__dirname, "browser.html"));

  view = new WebContentsView({
    webPreferences: {
      partition: "persist:pokerogue-browser",
      preload: path.join(__dirname, "web-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.contentView.addChildView(view);
  layout();
  win.on("resize", layout);

  // target=_blank etc. stay inside this browser view
  view.webContents.setWindowOpenHandler(({ url }) => {
    view.webContents.loadURL(url).catch(() => {});
    return { action: "deny" };
  });
  view.webContents.on("did-navigate", sendUrl);
  view.webContents.on("did-navigate-in-page", sendUrl);

  const hotkeys = wc =>
    wc.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown" || !input.control || input.alt || input.meta || input.isAutoRepeat) {
        return;
      }
      const key = input.key.toLowerCase();
      if (key === "l") {
        win.webContents.send("focus-address");
        win.webContents.focus();
      } else if (key === "r") {
        view.webContents.reload();
      } else {
        return;
      }
      event.preventDefault();
    });
  hotkeys(view.webContents);
  hotkeys(win.webContents);

  win.on("close", () => {
    deps.settings.browserBounds = win.getBounds();
    deps.save();
  });
  win.on("closed", () => {
    win = null;
    view = null;
    chatOpen = false;
  });

  view.webContents.loadURL(HOME_URL).catch(() => {});
}

function open(url, focusAddress) {
  if (!win) {
    create();
  }
  if (win.isMinimized()) {
    win.restore();
  }
  win.show();
  win.focus();
  if (url) {
    view.webContents.loadURL(normalizeUrl(url)).catch(() => {});
  }
  if (focusAddress) {
    win.webContents.send("focus-address");
    win.webContents.focus();
  }
}

// ---- Claude chat ----

function panelSend(channel, payload) {
  if (win && !win.webContents.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

function getClient() {
  if (anthropicClient) {
    return anthropicClient;
  }
  const { Anthropic } = require("@anthropic-ai/sdk");
  const opts = {};
  if (deps.settings.claudeApiKey) {
    opts.apiKey = deps.settings.claudeApiKey;
  }
  // With no stored key, the SDK resolves ANTHROPIC_API_KEY etc. from the
  // environment; if nothing is found the constructor throws.
  anthropicClient = new Anthropic(opts);
  return anthropicClient;
}

async function runChat(text) {
  if (chatBusy) {
    panelSend("chat-error", "이전 답변이 아직 진행 중입니다.");
    return;
  }
  let client;
  try {
    client = getClient();
  } catch {
    panelSend("chat-need-key");
    return;
  }
  chatBusy = true;
  chatHistory.push({ role: "user", content: text });
  // keep the last ~12 turns so history doesn't grow unbounded
  while (chatHistory.length > 24) {
    chatHistory.shift();
  }
  if (chatHistory[0].role !== "user") {
    chatHistory.shift();
  }
  try {
    for (let i = 0; i < 5; i++) {
      const stream = client.messages.stream({
        model: "claude-opus-5",
        max_tokens: 8000,
        system: SYSTEM_PROMPT,
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }],
        messages: chatHistory,
      });
      stream.on("text", t => panelSend("chat-delta", t));
      stream.on("contentBlock", b => {
        if (b.type === "server_tool_use") {
          panelSend("chat-status", "웹 검색 중…");
        }
      });
      const final = await stream.finalMessage();
      chatHistory.push({ role: "assistant", content: final.content });
      if (final.stop_reason !== "pause_turn") {
        break;
      }
    }
    panelSend("chat-done");
  } catch (err) {
    const { Anthropic } = require("@anthropic-ai/sdk");
    if (err instanceof Anthropic.AuthenticationError) {
      anthropicClient = null;
      panelSend("chat-need-key");
      panelSend("chat-error", "API 키가 유효하지 않습니다.");
    } else {
      panelSend("chat-error", err && err.message ? err.message : String(err));
    }
    // drop the failed turn so a retry starts clean
    if (chatHistory[chatHistory.length - 1]?.role === "user") {
      chatHistory.pop();
    }
  } finally {
    chatBusy = false;
  }
}

function registerIpc() {
  ipcMain.on("b-nav", (_e, dir) => {
    if (!view) {
      return;
    }
    const nav = view.webContents.navigationHistory;
    if (dir === "back" && nav.canGoBack()) {
      nav.goBack();
    } else if (dir === "forward" && nav.canGoForward()) {
      nav.goForward();
    }
  });
  ipcMain.on("b-navigate", (_e, url) => {
    if (view && typeof url === "string") {
      view.webContents.loadURL(normalizeUrl(url)).catch(() => {});
    }
  });
  ipcMain.on("b-reload", () => view && view.webContents.reload());
  ipcMain.on("b-focus-view", () => view && view.webContents.focus());
  ipcMain.on("b-chat-toggle", (_e, isOpen) => {
    chatOpen = Boolean(isOpen);
    layout();
  });
  ipcMain.on("b-chat-send", (_e, text) => {
    if (typeof text === "string" && text.trim()) {
      runChat(text.trim());
    }
  });
  ipcMain.on("b-chat-set-key", (_e, key) => {
    if (typeof key === "string" && key.trim()) {
      deps.settings.claudeApiKey = key.trim();
      deps.save();
      anthropicClient = null;
    }
  });
}

module.exports = { init, open };
