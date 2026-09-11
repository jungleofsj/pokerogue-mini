const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mini", {
  set: patch => ipcRenderer.send("set", patch),
  reload: () => ipcRenderer.send("reload"),
  boss: () => ipcRenderer.send("boss"),
  preset: () => ipcRenderer.send("preset"),
  focusGame: () => ipcRenderer.send("focus-game"),
  openBrowser: url => ipcRenderer.send("open-browser", url, !url),
  height: h => ipcRenderer.send("toolbar-height", h),
  onState: cb => ipcRenderer.on("state", (_e, s) => cb(s)),
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
