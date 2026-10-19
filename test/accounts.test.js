"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { fakeClock, loadSource, flush } = require("./helpers.cjs");

function setup(refreshToken) {
  const clock = fakeClock();
  const created = [];
  const handlers = new Map();
  const writes = [];
  const app = Object.assign(new EventEmitter(), {
    setName() {}, setPath() {}, getPath: () => "unused-test-directory",
    requestSingleInstanceLock: () => true, whenReady: () => new Promise(() => {}),
    getVersion: () => "2.0.5", getAppMetrics: () => [], quit() {}
  });
  class FakeClient extends EventEmitter {
    constructor() { super(); this.joinedChannels = new Set(); this.ready = false; created.push(this); }
    connect() { this.ready = true; this.emit("status", { state: "connected", reason: "authenticated", detail: "Connected" }); }
    disconnect() { this.ready = false; this.joinedChannels.clear(); this.emit("status", { state: "stopped", detail: "Stopped" }); }
    setDesiredChannels() {}
    reconnect() { this.recovered = true; }
  }
  const source = loadSource("irc-main.js", {
    electron: {
      app, powerMonitor: new EventEmitter(), ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
      safeStorage: { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(value) }
    },
    "./twitch-irc": { TwitchIrcClient: FakeClient },
    "./twitch-oauth": { refreshToken },
    "./local-files": { writeJson: async (file, value) => { writes.push({ file, value }); }, appendConnectionLog: async () => {} }
  }, clock.globals, `
    module.exports = { attachClient, renewAccountToken, syncClients, recoverConnections, stopChats, startChats, publicState,
      clients, setAccounts(value) { accounts = value; running = true; }, setQuitting() { isQuitting = true; } };`);
  const accounts = Array.from({ length: 4 }, (_, index) => ({
    id: String(index), login: `example${index}`, accessToken: "oldtoken", refreshToken: "refresh",
    expiresAt: clock.now() + 3_600_000
  }));
  source.setAccounts(accounts);
  return { source, clock, created, accounts, handlers, writes };
}

const freshToken = () => ({ access_token: "newtoken", refresh_token: "newrefresh", expires_in: 14_400 });

test("all accounts reconnect when tokens are renewed simultaneously", async () => {
  const { source, accounts, created, writes } = setup(async () => freshToken());
  source.syncClients();
  await Promise.all(accounts.map((account) => source.renewAccountToken(account.id)));
  assert.equal(source.clients.size, 4);
  assert.equal(created.length, 8);
  assert.ok(accounts.every((account) => account.accessToken === "newtoken" && !account.refreshing));
  assert.ok(source.publicState().accounts.every((account) => account.connectionState === "connected"));
  assert.equal(writes.length, 4);
});

test("rejected IRC token retries renewal instead of reconnecting with the old token", async () => {
  let requests = 0;
  const { source, accounts, created, clock } = setup(async () => {
    if (++requests === 1) throw new Error("Network offline");
    return freshToken();
  });
  source.setAccounts([accounts[0]]);
  source.syncClients();
  created[0].emit("authentication-error", "Token rejected");
  await flush();
  assert.equal(accounts[0].needsLogin, undefined);
  assert.equal(source.clients.size, 0);
  source.syncClients();
  assert.equal(created.length, 1);
  clock.advance(15_000);
  await flush();
  assert.equal(source.clients.size, 1);
  assert.equal(created.length, 2);
  assert.equal(source.publicState().accounts[0].connectionState, "connected");
});

test("temporary renewal failure does not label a working IRC connection as disconnected", async () => {
  const { source, accounts } = setup(async () => { throw new Error("Network offline"); });
  source.syncClients();
  await source.renewAccountToken(accounts[0].id);
  assert.equal(source.publicState().accounts[0].connectionState, "connected");
  assert.equal(source.clients.get(accounts[0].id).ready, true);
});

test("resume refreshes expired accounts and restarts valid sockets", async () => {
  const { source, accounts, clock } = setup(async () => freshToken());
  source.syncClients();
  const validClient = source.clients.get(accounts[1].id);
  accounts[0].expiresAt = clock.now() - 1000;
  source.recoverConnections("system-resume");
  await flush();
  assert.equal(accounts[0].accessToken, "newtoken");
  assert.equal(validClient.recovered, true);
  assert.equal(source.clients.size, 4);
});

test("removing an account during renewal does not create a ghost connection", async () => {
  let finish;
  const { source, accounts, handlers, created } = setup(() => new Promise((resolve) => { finish = resolve; }));
  source.setAccounts([accounts[0]]);
  const pending = source.renewAccountToken(accounts[0].id);
  await handlers.get("remove-account")({}, accounts[0].id);
  finish(freshToken());
  await pending;
  assert.equal(created.length, 0);
  assert.equal(source.clients.size, 0);
});

test("revoked refresh tokens require reauthorization instead of endless reconnects", async () => {
  const { source, accounts } = setup(async () => { throw Object.assign(new Error("invalid refresh token"), { code: "invalid_grant" }); });
  source.syncClients();
  await source.renewAccountToken(accounts[0].id);
  assert.equal(accounts[0].needsLogin, true);
  assert.equal(source.clients.has(accounts[0].id), false);
  assert.equal(source.publicState().accounts[0].connectionState, "authentication-error");
});
