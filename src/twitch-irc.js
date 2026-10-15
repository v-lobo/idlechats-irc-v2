"use strict";

const { EventEmitter } = require("node:events");
const tls = require("node:tls");

const IRC_HOST = "irc.chat.twitch.tv";
const IRC_PORT = 6697;
const LOGIN_PATTERN = /^[a-zA-Z0-9_]{1,25}$/;
const CHANNEL_PATTERN = /^[a-zA-Z0-9_]{1,25}$/;

class TwitchIrcClient extends EventEmitter {
  constructor({ login, accessToken }) {
    super();
    if (!LOGIN_PATTERN.test(login || "")) throw new Error("Login Twitch inválido para conexão IRC.");
    if (!/^[a-zA-Z0-9]+$/.test(accessToken || "")) throw new Error("Token Twitch inválido para conexão IRC.");
    this.login = login.toLowerCase();
    this.accessToken = accessToken;
    this.desiredChannels = new Set();
    this.joinedChannels = new Set();
    this.pendingChannels = new Set();
    this.socket = null;
    this.buffer = "";
    this.registered = false;
    this.membershipCapability = false;
    this.stopped = true;
    this.reconnectTimer = null;
    this.reconnectDelayMs = 5000;
  }

  connect() {
    if (!this.stopped || this.socket) return;
    this.stopped = false;
    this.#openSocket();
  }

  setDesiredChannels(channels) {
    this.desiredChannels = new Set(channels.filter((name) => CHANNEL_PATTERN.test(name)).map((name) => name.toLowerCase()));
    this.#syncChannels();
  }

  disconnect() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.socket && !this.socket.destroyed) {
      const socket = this.socket;
      this.#send("QUIT");
      socket.end();
      const cleanupTimer = setTimeout(() => socket.destroy(), 1000);
      cleanupTimer.unref?.();
    }
    this.socket = null;
    this.joinedChannels.clear();
    this.pendingChannels.clear();
    this.emit("status", { state: "stopped", detail: "Conexão encerrada." });
  }

  #openSocket() {
    if (this.stopped) return;
    this.buffer = "";
    this.registered = false;
    this.membershipCapability = false;
    this.joinedChannels.clear();
    this.pendingChannels.clear();
    this.emit("status", { state: "connecting", detail: "Conectando ao IRC seguro da Twitch…" });

    const socket = tls.connect({ host: IRC_HOST, port: IRC_PORT, servername: IRC_HOST });
    this.socket = socket;
    socket.setEncoding("utf8");
    socket.once("secureConnect", () => {
      if (socket !== this.socket || this.stopped) return;
      this.#send(`PASS oauth:${this.accessToken}`);
      this.#send(`NICK ${this.login}`);
      this.#send("CAP REQ :twitch.tv/membership");
    });
    socket.on("data", (chunk) => this.#receive(chunk));
    socket.on("error", (error) => {
      if (socket === this.socket && !this.stopped) {
        this.emit("status", { state: "reconnecting", detail: `Conexão interrompida: ${error.message}` });
      }
    });
    socket.on("close", () => {
      if (socket !== this.socket) return;
      this.socket = null;
      this.registered = false;
      this.membershipCapability = false;
      this.joinedChannels.clear();
      if (!this.stopped) {
        this.emit("status", { state: "reconnecting", detail: "Reconectando ao IRC em 5 segundos…" });
        this.reconnectTimer = setTimeout(() => this.#openSocket(), this.reconnectDelayMs);
        this.reconnectTimer.unref?.();
      }
    });
  }

  #receive(chunk) {
    this.buffer += chunk;
    if (this.buffer.length > 256 * 1024) {
      this.socket?.destroy(new Error("Buffer IRC excedeu o limite esperado."));
      this.buffer = "";
      return;
    }
    let lineBreak;
    while ((lineBreak = this.buffer.indexOf("\r\n")) !== -1) {
      const line = this.buffer.slice(0, lineBreak);
      this.buffer = this.buffer.slice(lineBreak + 2);
      this.#handleLine(line);
    }
  }

  #handleLine(line) {
    if (line.startsWith("PING ")) {
      this.#send(`PONG ${line.slice(5)}`);
      return;
    }

    if (line.includes(" CAP * ACK ") && line.includes("twitch.tv/membership")) {
      this.membershipCapability = true;
      this.#syncChannels();
      return;
    }

    if (line.includes(" 001 ")) {
      this.registered = true;
      this.emit("status", { state: "connected", detail: "Autenticado no IRC da Twitch." });
      this.#syncChannels();
      return;
    }

    if (/\bNOTICE\b/i.test(line) && /login authentication failed|improperly formatted auth|invalid oauth token/i.test(line)) {
      this.stopped = true;
      this.emit("authentication-error", "A Twitch recusou o token. Reconecte esta conta.");
      this.socket?.destroy();
      return;
    }

    if (line === ":tmi.twitch.tv RECONNECT") {
      this.socket?.end();
      return;
    }

    const joined = line.match(/^:([^! ]+)!([^ ]+) JOIN #([a-zA-Z0-9_]+)$/i);
    if (joined && joined[1].toLowerCase() === this.login) {
      const channel = joined[3].toLowerCase();
      this.pendingChannels.delete(channel);
      this.joinedChannels.add(channel);
      this.emit("joined", channel);
      return;
    }

    const parted = line.match(/^:([^! ]+)!([^ ]+) PART #([a-zA-Z0-9_]+)/i);
    if (parted && parted[1].toLowerCase() === this.login) {
      const channel = parted[3].toLowerCase();
      this.pendingChannels.delete(channel);
      this.joinedChannels.delete(channel);
      this.emit("parted", channel);
      return;
    }

    // PRIVMSG and all other chat content are deliberately discarded.
  }

  #syncChannels() {
    if (!this.socket || !this.registered || !this.membershipCapability) return;
    for (const channel of this.joinedChannels) {
      if (!this.desiredChannels.has(channel)) {
        this.#send(`PART #${channel}`);
        this.joinedChannels.delete(channel);
      }
    }
    for (const channel of this.pendingChannels) {
      if (!this.desiredChannels.has(channel)) {
        this.#send(`PART #${channel}`);
        this.pendingChannels.delete(channel);
      }
    }
    for (const channel of this.desiredChannels) {
      if (!this.joinedChannels.has(channel) && !this.pendingChannels.has(channel)) {
        this.#send(`JOIN #${channel}`);
        this.pendingChannels.add(channel);
      }
    }
  }

  #send(line) {
    if (!this.socket || this.socket.destroyed) return;
    this.socket.write(`${line}\r\n`);
  }
}

module.exports = { TwitchIrcClient };
