"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { fakeClock, loadSource, flush } = require("./helpers.cjs");
const { ensureChatScopes, isClientConfigurationError } = require("../src/twitch-oauth");

function setup(refreshToken, savedAccounts = [], oauthOverrides = {}) {
  const clock = fakeClock();
  const created = [];
  const handlers = new Map();
  const writes = [];
  const app = Object.assign(new EventEmitter(), {
    setName() {}, setPath() {}, getPath: () => "unused-test-directory",
    requestSingleInstanceLock: () => true, whenReady: () => new Promise(() => {}),
    getVersion: () => require("../package.json").version, getAppMetrics: () => [], quit() {}
  });
  class FakeClient extends EventEmitter {
    constructor() { super(); this.joinedChannels = new Set(); this.ready = false; created.push(this); }
    connect() { this.ready = true; this.emit("status", { state: "connected", reason: "authenticated", detail: "Connected" }); }
    disconnect() { this.ready = false; this.joinedChannels.clear(); this.emit("status", { state: "stopped", detail: "Stopped" }); }
    setDesiredChannels() {}
    reconnect() {
      this.recovered = true; this.ready = false; this.joinedChannels.clear();
      this.emit("status", { state: "reconnecting", detail: "Reconnecting" });
    }
  }
  const source = loadSource("irc-main.js", {
    electron: {
      app, powerMonitor: new EventEmitter(), ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
      safeStorage: { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(value), decryptString: (value) => value.toString() }
    },
    "./twitch-irc": { TwitchIrcClient: FakeClient },
    "./twitch-oauth": { refreshToken, ensureChatScopes, isClientConfigurationError, ...oauthOverrides },
    "node:fs/promises": { readFile: async (file) => JSON.stringify(file.endsWith("accounts.json") ? savedAccounts : file.endsWith("channels.json") ? [] : {}) },
    "./local-files": { writeJson: async (file, value) => { writes.push({ file, value }); }, appendConnectionLog: async () => {} }
  }, clock.globals, `
    module.exports = { attachClient, renewAccountToken, syncClients, recoverConnections, stopChats, startChats, publicState, loadData, restoreAccounts, pollAccountLogin, pendingLogins, runConnectionTest,
      setChannels(value) { channels = value.map((name) => ({ name })); preferences.liveOnly = false; },
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

test("missing client secret is a configuration error and is never retried as a network failure", async () => {
  let requests = 0;
  const { source, accounts, clock, created } = setup(async () => {
    requests += 1;
    throw Object.assign(new Error("missing client secret"), { code: "missing client secret", status: 400 });
  });
  source.setAccounts([accounts[0]]);
  source.syncClients();
  await source.renewAccountToken(accounts[0].id);
  assert.equal(accounts[0].configurationError, true);
  assert.equal(accounts[0].refreshTimer, null);
  assert.equal(source.publicState().accounts[0].connectionState, "configuration-error");
  assert.equal(source.publicState().accounts[0].authenticated, false);
  source.syncClients();
  source.recoverConnections("network-online");
  clock.advance(600_000);
  await flush();
  assert.equal(requests, 1);
  assert.equal(created.length, 1);
  assert.equal(source.clients.size, 0);
});

test("accounts linked to the previous Client ID request reauthorization without losing their profiles", async () => {
  let requests = 0;
  const { source } = setup(async () => { requests += 1; return freshToken(); }, [{
    id: "previous", login: "example", displayName: "Example", avatar: "https://example.invalid/avatar.png",
    clientId: "previousclientid000000000000",
    encryptedTokens: Buffer.from(JSON.stringify({ accessToken: "old", refreshToken: "refresh", expiresAt: 10_000_000 })).toString("base64")
  }]);
  await source.loadData();
  await source.restoreAccounts();
  source.syncClients();
  assert.equal(requests, 0);
  assert.equal(source.clients.size, 0);
  const [account] = source.publicState().accounts;
  assert.equal(account.displayName, "Example");
  assert.equal(account.avatar, "https://example.invalid/avatar.png");
  assert.equal(account.authenticated, false);
  assert.equal(account.connectionState, "authentication-error");
  assert.match(account.detail, /Use \+/);
});

test("reauthorizing an existing account clears previous errors without duplicating the profile", async () => {
  const { source, accounts, clock } = setup(async (_clientId, refresh) => {
    assert.equal(refresh, "issuedrefresh");
    return freshToken();
  }, [], {
    pollDeviceToken: async () => ({ access_token: "issuedtoken", refresh_token: "issuedrefresh" }),
    validateToken: async () => ({ login: "example0", scopes: ["chat:read", "chat:edit"] }),
    ensureChatScopes() {}, getUserProfile: async () => ({ login: "example0", displayName: "Example" })
  });
  source.setAccounts([accounts[0]]);
  accounts[0].needsLogin = true;
  accounts[0].configurationError = true;
  accounts[0].tokenRejected = true;
  source.stopChats();
  const pending = { id: "login", clientId: "newpublicclientid000000000000", deviceCode: "code", intervalMs: 1, expiresAt: clock.now() + 60_000 };
  source.pendingLogins.set(pending.id, pending);
  const done = source.pollAccountLogin(pending);
  clock.advance(1);
  await done;
  const state = source.publicState();
  assert.equal(state.accounts.length, 1);
  assert.equal(state.accounts[0].authenticated, true);
  assert.equal(state.accounts[0].connectionState, "stopped");
  assert.equal(accounts[0].configurationError, false);
  assert.equal(accounts[0].tokenRejected, false);
  assert.equal(accounts[0].accessToken, "newtoken");
  assert.equal(accounts[0].refreshToken, "newrefresh");
  source.startChats();
  assert.equal(source.clients.size, 1);
});

test("new logins must successfully refresh before they can be linked", async () => {
  const { source, clock, writes } = setup(async () => {
    throw Object.assign(new Error("missing client secret"), { code: "missing client secret" });
  }, [], { pollDeviceToken: async () => freshToken() });
  source.setAccounts([]);
  const pending = { id: "login", clientId: "exampleclientid00000000000000", deviceCode: "code", intervalMs: 1, expiresAt: clock.now() + 60_000 };
  source.pendingLogins.set(pending.id, pending);
  const done = source.pollAccountLogin(pending);
  clock.advance(1);
  await done;
  assert.equal(source.publicState().accounts.length, 0);
  assert.equal(writes.length, 0);
  assert.equal(source.pendingLogins.size, 0);
  assert.match(source.publicState().message, /Client Type Public/);
});

test("renewal diagnostic waits for actual JOINs before reporting success", async () => {
  const clientId = "exampleclientid00000000000000";
  const { source, accounts, clock } = setup(async () => freshToken(), [], {
    validateToken: async () => ({ client_id: clientId, scopes: ["chat:read", "chat:edit"], expires_in: 14_000 })
  });
  accounts[0].clientId = clientId;
  source.setAccounts([accounts[0]]);
  source.setChannels(["channel1", "channel2"]);
  source.syncClients();
  const before = source.clients.get(accounts[0].id);
  const pending = source.runConnectionTest("renewal");
  await flush();
  const after = source.clients.get(accounts[0].id);
  assert.notEqual(before, after);
  assert.equal(source.publicState().diagnostic.busy, true);
  assert.equal(source.publicState().diagnostic.results[0].status, "running");
  after.joinedChannels.add("channel1");
  clock.advance(500);
  assert.equal(source.publicState().diagnostic.busy, true);
  after.joinedChannels.add("channel2");
  clock.advance(500);
  const result = await pending;
  assert.equal(result.diagnostic.busy, false);
  assert.equal(result.diagnostic.results[0].status, "passed");
  assert.match(result.diagnostic.results[0].detail, /renovada, salva e validada/);
});

test("renewal diagnostic reports configuration rejection without waiting or claiming success", async () => {
  const { source, accounts } = setup(async () => { throw new Error("missing client secret"); });
  source.setAccounts([accounts[0]]);
  source.setChannels(["channel1"]);
  source.syncClients();
  const result = await source.runConnectionTest("renewal");
  assert.equal(result.diagnostic.busy, false);
  assert.equal(result.diagnostic.results[0].status, "failed");
  assert.match(result.diagnostic.results[0].detail, /Client Type Public/);
});

test("reconnect diagnostic times out without confirmed chat membership", async () => {
  const { source, accounts, clock } = setup(async () => freshToken());
  source.setAccounts([accounts[0]]);
  source.setChannels(["channel1"]);
  source.syncClients();
  const pending = source.runConnectionTest("reconnect");
  assert.equal(source.clients.get(accounts[0].id).recovered, true);
  clock.advance(60_000);
  const result = await pending;
  assert.equal(result.diagnostic.results[0].status, "failed");
  assert.match(result.diagnostic.results[0].detail, /60s/);
});

test("diagnostics reject overlap and report a changed channel list as inconclusive", async () => {
  const { source, accounts, clock } = setup(async () => freshToken());
  source.setAccounts([accounts[0]]);
  source.setChannels(["channel1"]);
  source.syncClients();
  const pending = source.runConnectionTest("reconnect");
  await assert.rejects(source.runConnectionTest("renewal"), /andamento/);
  source.setChannels(["different"]);
  clock.advance(500);
  const result = await pending;
  assert.equal(result.diagnostic.results[0].status, "inconclusive");
});
