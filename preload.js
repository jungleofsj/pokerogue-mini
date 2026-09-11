const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mini", {
  set: patch => ipcRenderer.send("set", patch),
  reload: () => ipcRenderer.send("reload"),
  boss: () => ipcRenderer.send("boss"),
  preset: () => ipcRenderer.send("preset"),
  focusGame: () => ipcRenderer.send("focus-game"),
  height: h => ipcRenderer.send("chrome-height", h),
  onState: cb => ipcRenderer.on("state", (_e, s) => cb(s)),
  // tabs
  tabNew: () => ipcRenderer.send("tab-new"),
  tabClose: id => ipcRenderer.send("tab-close", id),
  tabActivate: id => ipcRenderer.send("tab-activate", id),
  nav: dir => ipcRenderer.send("nav", dir),
  navigate: url => ipcRenderer.send("navigate", url),
  onTabs: cb => ipcRenderer.on("tabs", (_e, tabs) => cb(tabs)),
  onUrl: cb => ipcRenderer.on("url", (_e, u) => cb(u)),
  onFocusAddress: cb => ipcRenderer.on("focus-address", cb),
  // Claude chat panel
  chatToggle: open => ipcRenderer.send("chat-toggle", open),
  pickupWeek: () => ipcRenderer.invoke("pickup-week"),
  chatSend: text => ipcRenderer.send("chat-send", text),
  setKey: key => ipcRenderer.send("chat-set-key", key),
  onChatDelta: cb => ipcRenderer.on("chat-delta", (_e, t) => cb(t)),
  onChatStatus: cb => ipcRenderer.on("chat-status", (_e, t) => cb(t)),
  onChatDone: cb => ipcRenderer.on("chat-done", cb),
  onChatError: cb => ipcRenderer.on("chat-error", (_e, m) => cb(m)),
  onNeedKey: cb => ipcRenderer.on("chat-need-key", cb),
});
