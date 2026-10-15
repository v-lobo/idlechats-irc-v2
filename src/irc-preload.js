"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("idleChats", {
  getState: () => ipcRenderer.invoke("get-state"),
  beginLogin: () => ipcRenderer.invoke("begin-login"),
  cancelLogin: (id) => ipcRenderer.invoke("cancel-login", id),
  removeAccount: (id) => ipcRenderer.invoke("remove-account", id),
  addChannel: (name) => ipcRenderer.invoke("add-channel", name),
  removeChannel: (name) => ipcRenderer.invoke("remove-channel", name),
  toggleChats: () => ipcRenderer.invoke("toggle-chats"),
  checkOnline: () => ipcRenderer.invoke("check-online"),
  setMinimizeToTray: (value) => ipcRenderer.invoke("set-minimize-to-tray", value),
  setLiveOnly: (value) => ipcRenderer.invoke("set-live-only", value),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("app-state", listener);
    return () => ipcRenderer.removeListener("app-state", listener);
  }
});
