const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mb", {
  nav: dir => ipcRenderer.send("b-nav", dir),
  navigate: url => ipcRenderer.send("b-navigate", url),
  reload: () => ipcRenderer.send("b-reload"),
  focusView: () => ipcRenderer.send("b-focus-view"),
  tabNew: () => ipcRenderer.send("b-tab-new"),
  tabClose: id => ipcRenderer.send("b-tab-close", id),
  tabActivate: id => ipcRenderer.send("b-tab-activate", id),
  onTabs: cb => ipcRenderer.on("tabs", (_e, tabs) => cb(tabs)),
  onUrl: cb => ipcRenderer.on("url", (_e, u) => cb(u)),
  onFocusAddress: cb => ipcRenderer.on("focus-address", cb),
});
