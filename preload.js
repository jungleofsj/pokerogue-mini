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
});
