const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mb", {
  nav: dir => ipcRenderer.send("b-nav", dir),
  navigate: url => ipcRenderer.send("b-navigate", url),
  reload: () => ipcRenderer.send("b-reload"),
  chatToggle: open => ipcRenderer.send("b-chat-toggle", open),
  chatSend: text => ipcRenderer.send("b-chat-send", text),
  setKey: key => ipcRenderer.send("b-chat-set-key", key),
  focusView: () => ipcRenderer.send("b-focus-view"),
  onUrl: cb => ipcRenderer.on("url", (_e, u) => cb(u)),
  onFocusAddress: cb => ipcRenderer.on("focus-address", cb),
  onChatDelta: cb => ipcRenderer.on("chat-delta", (_e, t) => cb(t)),
  onChatStatus: cb => ipcRenderer.on("chat-status", (_e, t) => cb(t)),
  onChatDone: cb => ipcRenderer.on("chat-done", cb),
  onChatError: cb => ipcRenderer.on("chat-error", (_e, m) => cb(m)),
  onNeedKey: cb => ipcRenderer.on("chat-need-key", cb),
});
