"use strict";

const { BrowserWindow, WebContentsView, ipcMain, session } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { watchDiscordPageStatus } = require("./discord-page-status");
const { discordPresence } = require("./discord-presence");
const { closeDiscordPage, flushDiscordSession } = require("./discord-session-lifecycle");

const DEFAULT_DISCORD_ROOM = "https://discord.com/channels/1516313244057337908/1551936385030824056";

function channelUrl(value) {
  const url = new URL(String(value).trim());
  if (url.origin !== "https://discord.com" || !/^\/channels\/\d{17,20}\/\d{17,20}\/?$/.test(url.pathname)) {
    throw new Error("Cole o link da sala: https://discord.com/channels/servidor/sala");
  }
  return `https://discord.com${url.pathname.replace(/\/$/, "")}`;
}

// Only cosmetic changes; keep channel navigation, account and voice controls intact.
const compactCSS = `
  nav[aria-label="Servers"], nav[aria-label="Servidores"],
  nav:has([data-list-id="guildsnav"]),
  nav[class*="guilds_"], [class*="guilds_"][aria-label],
  [class*="membersWrap_"], [class*="nowPlayingColumn_"] { display: none !important; }
`;

class DiscordSession {
  constructor({ settings, save, changed }) {
    this.settings = settings;
    if (!this.settings.url) this.settings.url = DEFAULT_DISCORD_ROOM;
    this.save = save;
    this.changed = changed;
    this.status = "Fechado";
    this.cssKey = null;
    this.quitting = false;
    this.voiceReport = null;
    this.voiceLastSeen = 0;
    this.acceptPresence = false;
    ipcMain.on("discord-presence", (event, report) => {
      if (!this.acceptPresence || event.sender !== this.view?.webContents || event.senderFrame !== event.sender.mainFrame) return;
      try { if (new URL(event.senderFrame.url).origin !== "https://discord.com") return; } catch { return; }
      if (!report || !["connected", "connecting", "disconnected", "login-required", "offline", "unknown"].includes(report.kind)) return;
      this.voiceReport = { kind: report.kind, channelUrl: typeof report.channelUrl === "string" ? report.channelUrl.slice(0, 200) : "" };
      this.voiceLastSeen = Date.now();
      this.notify();
    });
    ipcMain.handle("discord-action", async (event, action, value) => {
      const allowed = ["irc.html", "discord.html"].map(file => pathToFileURL(path.join(__dirname, file)).href);
      if (event.senderFrame !== event.sender.mainFrame || !allowed.includes(event.senderFrame.url)) throw new Error("Origem inválida.");
      if (this.stopPromise && ["open", "room", "reload"].includes(action)) throw new Error("Aguarde o salvamento da sessão do Discord antes de abrir novamente.");
      switch (action) {
        case "state": break;
        case "open": this.open(); break;
        case "hide": this.window?.hide(); this.notify(); break;
        case "stop": await this.stop(); break;
        case "save": {
          this.settings.url = channelUrl(value);
          await this.save();
          break;
        }
        case "room":
          if (!this.settings.url) throw new Error("Salve primeiro o link da sala.");
          this.open();
          await this.view.webContents.loadURL(this.settings.url);
          break;
        case "reload":
          this.open(); this.view.webContents.reload(); break;
        case "compact":
          this.settings.compact = Boolean(value);
          await this.save(); await this.applyStyle(); break;
        default: throw new Error("Ação inválida.");
      }
      this.notify();
      return this.state();
    });
  }

  state() {
    return { url: this.settings.url || "", compact: Boolean(this.settings.compact),
      voice: discordPresence({ active: Boolean(this.window), targetUrl: this.settings.url,
        report: this.voiceReport, lastSeen: this.voiceLastSeen }),
      active: Boolean(this.window), hidden: Boolean(this.window && !this.window.isVisible()), status: this.status };
  }

  notify() {
    if (this.window && !this.window.isDestroyed()) this.window.webContents.send("discord-state", this.state());
    this.changed();
  }

  async applyStyle() {
    this.resizeContents();
    const wc = this.view?.webContents;
    if (!wc || wc.isDestroyed()) return;
    if (this.cssKey) { await wc.removeInsertedCSS(this.cssKey); this.cssKey = null; }
    if (this.settings.compact) this.cssKey = await wc.insertCSS(compactCSS);
  }

  resizeContents() {
    if (!this.window || !this.view) return;
    const [width, height] = this.window.getContentSize();
    const header = this.settings.compact ? 100 : 156;
    this.view.setBounds({ x: 0, y: header, width, height: Math.max(0, height - header) });
  }

  open() {
    if (this.stopPromise) return;
    if (this.window) { this.window.show(); this.window.restore(); this.window.focus(); this.notify(); return; }
    const isolated = session.fromPartition("persist:idle-chats-discord-secondary");
    this.browserSession = isolated;
    // This integration is for silent presence: never grant recording permissions.
    isolated.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    isolated.setPermissionCheckHandler(() => false);
    if (!isolated.listenerCount("will-download")) isolated.on("will-download", event => event.preventDefault());
    this.window = new BrowserWindow({ width: 1100, height: 800, minWidth: 800, minHeight: 600,
      title: "Discord · IdleChats", backgroundColor: "#313338", autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, "discord-preload.js"), sandbox: true, contextIsolation: true, nodeIntegration: false } });
    this.window.loadFile(path.join(__dirname, "discord.html"));
    this.window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    this.window.webContents.on("will-navigate", event => event.preventDefault());
    this.view = new WebContentsView({ webPreferences: { session: isolated, sandbox: true,
      preload: path.join(__dirname, "discord-web-preload.js"),
      contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    this.window.contentView.addChildView(this.view);
    this.resizeContents();
    this.window.on("resize", () => this.resizeContents());
    const wc = this.view.webContents;
    this.presenceTimer = setInterval(() => this.notify(), 5_000);
    this.presenceTimer.unref?.();
    wc.on("did-start-navigation", details => {
      if (!details.isMainFrame || details.isSameDocument) return;
      this.acceptPresence = false; this.voiceReport = null; this.voiceLastSeen = 0;
      this.notify();
    });
    const enforceSilence = () => {
      if (!wc.isDestroyed() && !wc.isAudioMuted()) wc.setAudioMuted(true);
    };
    enforceSilence();
    wc.on("audio-state-changed", enforceSilence);
    wc.on("media-started-playing", enforceSilence);
    wc.on("did-start-navigation", enforceSilence);
    wc.setWindowOpenHandler(() => ({ action: "deny" }));
    const restrict = (event, target) => {
      try { if (new URL(target).origin === "https://discord.com") return; } catch {}
      event.preventDefault();
    };
    wc.on("will-navigate", restrict);
    wc.on("will-redirect", restrict);
    watchDiscordPageStatus(wc, status => {
      this.status = status;
      if (/^(Falha ao carregar|Discord interrompido)/.test(status)) {
        this.acceptPresence = false; this.voiceReport = null;
      }
      this.notify();
    });
    wc.on("dom-ready", () => {
      this.acceptPresence = true;
      wc.send("discord-presence-request");
      this.cssKey = null;
      void this.applyStyle().catch(() => { this.status = "Modo compacto indisponível"; this.notify(); });
    });
    this.window.on("close", event => {
      if (!this.quitting) { event.preventDefault(); this.window.hide(); this.notify(); }
    });
    this.window.on("closed", () => {
      clearInterval(this.presenceTimer);
      this.acceptPresence = false; this.voiceReport = null; this.voiceLastSeen = 0;
      if (!wc.isDestroyed()) wc.close();
      this.view = null; this.window = null; this.status = "Fechado"; this.cssKey = null; this.notify();
    });
    void wc.loadURL(this.settings.url || "https://discord.com/login").catch(() => {});
    this.notify();
  }

  stop() {
    if (this.stopPromise) return this.stopPromise;
    const window = this.window;
    const contents = this.view?.webContents;
    this.stopPromise = (async () => {
      try {
        if (window && !window.isDestroyed()) {
          this.status = "Salvando sessão do Discord…";
          this.acceptPresence = false;
          this.voiceReport = null;
          this.notify();
        }
        await closeDiscordPage(contents);
        await flushDiscordSession(this.browserSession);
      } finally {
        if (window && !window.isDestroyed()) window.destroy();
      }
    })().finally(() => { this.stopPromise = null; });
    return this.stopPromise;
  }
}

module.exports = { DiscordSession, channelUrl, DEFAULT_DISCORD_ROOM };
