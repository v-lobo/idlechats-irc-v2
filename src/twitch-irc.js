"use strict";

const { EventEmitter } = require("node:events");
const tls = require("node:tls");

const IRC_HOST = "irc.chat.twitch.tv";
const IRC_PORT = 6697;
const LOGIN_PATTERN = /^[a-zA-Z0-9_]{1,25}$/;
const CHANNEL_PATTERN = /^[a-zA-Z0-9_]{1,25}$/;
const CONNECTION_TIMEOUT_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 60_000;
const PONG_TIMEOUT_MS = 30_000;
const JOIN_RETRY_MS = 60_000;

class TwitchIrcClient extends EventEmitter {
  constructor({ login, accessToken }) {
    super();
    if (!LOGIN_PATTERN.test(login || "")) throw new Error("Login Twitch inválido para conexão IRC.");
    if (!/^[a-zA-Z0-9]+$/.test(accessToken || "")) throw new Error("Token Twitch inválido para conexão IRC.");
    this.login = login.toLowerCase();
    this.accessToken = accessToken;
    this.desiredChannels = new Set();
    this.joinedChannels = new Set();
    this.pendingChannels = new Map();
    this.socket = null;
    this.buffer = "";
    this.registered = false;
    this.membershipCapability = false;
    this.ready = false;
    this.stopped = true;
    this.reconnectTimer = null;
    this.connectionTimer = null;
    this.healthTimer = null;
    this.reconnectAttempts = 0;
    this.pendingPing = null;
    this.lastPingAt = 0;
  }

  connect() {
    if (!this.stopped || this.socket) return;
    this.stopped = false;
    this.reconnectAttempts = 0;
    this.#openSocket();
  }

  reconnect(reason = "Retomando a conexão IRC.") {
    if (this.stopped) return;
    this.#retry(reason, "connection-recovery", 1000 + Math.floor(Math.random() * 2000));
  }

  setDesiredChannels(channels) {
    this.desiredChannels = new Set(channels.filter((name) => CHANNEL_PATTERN.test(name)).map((name) => name.toLowerCase()));
    this.#syncChannels();
  }

  disconnect() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.#send("QUIT");
    this.#clearConnection();
    this.emit("status", { state: "stopped", detail: "Conexão encerrada.", reason: "stopped" });
  }

  #clearConnection() {
    clearTimeout(this.connectionTimer);
    clearInterval(this.healthTimer);
    this.connectionTimer = null;
    this.healthTimer = null;
    const socket = this.socket;
    this.socket = null;
    this.registered = false;
    this.membershipCapability = false;
    this.ready = false;
    this.buffer = "";
    this.pendingPing = null;
    this.joinedChannels.clear();
    this.pendingChannels.clear();
    socket?.destroy();
  }

  #retry(detail, reason, delayOverride) {
    this.#clearConnection();
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.stopped) return;
    const delay = delayOverride ?? Math.min(60_000, 5000 * (2 ** Math.min(this.reconnectAttempts++, 4))) + Math.floor(Math.random() * 1000);
    this.emit("status", { state: "reconnecting", detail: `${detail} Nova tentativa em ${Math.ceil(delay / 1000)}s.`, reason });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.#openSocket();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  #openSocket() {
    if (this.stopped || this.socket) return;
    this.emit("status", { state: "connecting", detail: "Conectando ao IRC seguro da Twitch…", reason: "connecting" });
    let socket;
    try {
      socket = tls.connect({ host: IRC_HOST, port: IRC_PORT, servername: IRC_HOST });
    } catch {
      this.#retry("Não foi possível iniciar a conexão segura.", "connect-error");
      return;
    }
    this.socket = socket;
    socket.setEncoding("utf8");
    socket.setKeepAlive(true, 30_000);
    this.connectionTimer = setTimeout(() => {
      if (socket === this.socket && !this.ready) this.#retry("A Twitch não concluiu a conexão em 30s.", "connect-timeout");
    }, CONNECTION_TIMEOUT_MS);
    this.connectionTimer.unref?.();
    this.healthTimer = setInterval(() => {
      if (socket === this.socket && !this.stopped) this.#checkHealth();
    }, 15_000);
    this.healthTimer.unref?.();
    socket.once("secureConnect", () => {
      if (socket !== this.socket || this.stopped) return;
      this.#send(`PASS oauth:${this.accessToken}`);
      this.#send(`NICK ${this.login}`);
      this.#send("CAP REQ :twitch.tv/membership twitch.tv/commands");
    });
    socket.on("data", (chunk) => {
      if (socket === this.socket && !this.stopped) this.#receive(socket, chunk);
    });
    socket.on("error", (error) => {
      const code = /^[A-Z0-9_]+$/.test(error?.code || "") ? error.code : "UNKNOWN";
      if (socket === this.socket && !this.stopped) this.#retry(`Falha de rede na conexão IRC (${code}).`, `socket-${code.toLowerCase()}`);
    });
    socket.on("end", () => {
      if (socket === this.socket && !this.stopped) this.#retry("A Twitch encerrou a conexão IRC.", "socket-end");
    });
    socket.on("close", () => {
      if (socket === this.socket && !this.stopped) this.#retry("A conexão IRC foi fechada.", "socket-close");
    });
  }

  #checkHealth() {
    if (!this.ready) return;
    const now = Date.now();
    if (this.pendingPing && now - this.pendingPing.sentAt >= PONG_TIMEOUT_MS) {
      this.#retry("A Twitch ficou 30s sem responder à checagem de conexão.", "pong-timeout");
      return;
    }
    if (!this.pendingPing && now - this.lastPingAt >= HEARTBEAT_INTERVAL_MS) {
      this.pendingPing = { id: `idlechats-${now}`, sentAt: now };
      this.lastPingAt = now;
      this.#send(`PING :${this.pendingPing.id}`);
    }
    for (const [channel, sentAt] of this.pendingChannels) {
      if (this.desiredChannels.has(channel) && now - sentAt >= JOIN_RETRY_MS) {
        this.pendingChannels.set(channel, now);
        this.#send(`JOIN #${channel}`);
      }
    }
  }

  #receive(socket, chunk) {
    this.buffer += chunk;
    if (this.buffer.length > 256 * 1024) {
      this.#retry("A resposta IRC excedeu o limite esperado.", "buffer-limit");
      return;
    }
    let lineBreak;
    while (socket === this.socket && !this.stopped && (lineBreak = this.buffer.indexOf("\r\n")) !== -1) {
      const line = this.buffer.slice(0, lineBreak);
      this.buffer = this.buffer.slice(lineBreak + 2);
      this.#handleLine(line);
    }
  }

  #markReady() {
    if (this.ready || !this.registered || !this.membershipCapability) return;
    this.ready = true;
    this.reconnectAttempts = 0;
    this.lastPingAt = Date.now();
    clearTimeout(this.connectionTimer);
    this.connectionTimer = null;
    this.emit("status", { state: "connected", detail: "Autenticado no IRC da Twitch.", reason: "authenticated" });
    this.#syncChannels();
  }

  #handleLine(line) {
    const command = line.match(/^(?::[^ ]+ )?([A-Z0-9]+)(?: |$)/i)?.[1]?.toUpperCase();
    if (command === "PING" && line.startsWith("PING ")) {
      this.#send(`PONG ${line.slice(5)}`);
      return;
    }
    if (command === "PONG" && this.pendingPing && line.endsWith(`:${this.pendingPing.id}`)) {
      this.pendingPing = null;
      return;
    }
    if (command === "CAP" && line.includes(" CAP * ACK ") && line.includes("twitch.tv/membership")) {
      this.membershipCapability = true;
      this.#markReady();
      return;
    }
    if (command === "001") {
      this.registered = true;
      this.#markReady();
      return;
    }
    if (command === "NOTICE" && /login authentication failed|improperly formatted auth|invalid oauth token/i.test(line)) {
      this.stopped = true;
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      this.#clearConnection();
      this.emit("authentication-error", "A Twitch recusou o token IRC.");
      return;
    }
    if (line === ":tmi.twitch.tv RECONNECT") {
      this.#retry("A Twitch solicitou uma nova conexão IRC.", "server-reconnect");
      return;
    }
    const joined = line.match(/^:([^! ]+)!([^ ]+) JOIN #([a-zA-Z0-9_]+)$/i);
    if (joined && joined[1].toLowerCase() === this.login) {
      const channel = joined[3].toLowerCase();
      this.pendingChannels.delete(channel);
      this.joinedChannels.add(channel);
      this.emit("joined", channel);
      this.#syncChannels();
      return;
    }
    const parted = line.match(/^:([^! ]+)!([^ ]+) PART #([a-zA-Z0-9_]+)/i);
    if (parted && parted[1].toLowerCase() === this.login) {
      const channel = parted[3].toLowerCase();
      this.pendingChannels.delete(channel);
      this.joinedChannels.delete(channel);
      this.emit("parted", channel);
      this.#syncChannels();
    }
    // PRIVMSG and all other chat content are deliberately discarded.
  }

  #syncChannels() {
    if (!this.socket || !this.ready) return;
    for (const channel of this.joinedChannels) {
      if (!this.desiredChannels.has(channel)) {
        this.#send(`PART #${channel}`);
        this.joinedChannels.delete(channel);
        this.emit("parted", channel);
      }
    }
    for (const channel of this.pendingChannels.keys()) {
      if (!this.desiredChannels.has(channel)) {
        this.#send(`PART #${channel}`);
        this.pendingChannels.delete(channel);
      }
    }
    for (const channel of this.desiredChannels) {
      if (!this.joinedChannels.has(channel) && !this.pendingChannels.has(channel)) {
        this.pendingChannels.set(channel, Date.now());
        this.#send(`JOIN #${channel}`);
      }
    }
  }

  #send(line) {
    if (!this.socket || this.socket.destroyed) return;
    this.socket.write(`${line}\r\n`);
  }
}

module.exports = { TwitchIrcClient };
