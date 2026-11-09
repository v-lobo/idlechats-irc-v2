"use strict";

const path = require("node:path");
const { app } = require("electron");
const APP_ID = "com.idlechats.irc.v2";
const APP_ICON = path.join(__dirname, "app-icon.ico");

function configureTaskbar(window) {
  if (process.platform !== "win32") return;
  window.setAppDetails({
    appId: APP_ID,
    appIconPath: APP_ICON,
    appIconIndex: 0,
    relaunchCommand: app.isPackaged ? `"${process.execPath}"` : `"${process.execPath}" "${path.join(__dirname, "..")}"`,
    relaunchDisplayName: "IdleChats IRC V2"
  });
}

module.exports = { APP_ID, APP_ICON, configureTaskbar };
