"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("discordPanel", {
  action: (action, value) => ipcRenderer.invoke("discord-action", action, value),
  onState: callback => ipcRenderer.on("discord-state", (_event, state) => callback(state))
});
