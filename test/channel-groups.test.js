"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { fakeClock, loadSource } = require("./helpers.cjs");
const { migrateChannels, selectTargetChannels } = require("../src/channel-groups");

const dreamNames = ["brucescottt", "safnaww", "StormBomb", "surtoo_"];
const idleNames = Array.from({ length: 7 }, (_, i) => `idle${i}`);
const initial = () => migrateChannels(idleNames.map((name) => ({ name })));

test("legacy channels keep their names and order in PokeIdleWorld", () => {
  const channels = migrateChannels([{ name: "Existing" }, { name: "StormBomb" }]);
  assert.deepEqual(channels.filter((item) => item.groupId === "pokeidleworld").map((item) => item.name), ["Existing", "StormBomb"]);
  assert.deepEqual(channels.filter((item) => item.groupId === "pokedream").map((item) => item.name), dreamNames);
});

test("first launch uses existing defaults, but an explicitly empty list stays empty", () => {
  assert.equal(migrateChannels(null, idleNames).filter((item) => item.groupId === "pokeidleworld").length, 7);
  assert.equal(migrateChannels([], idleNames).filter((item) => item.groupId === "pokeidleworld").length, 0);
});

test("saved grouped lists do not reseed channels removed by the user", () => {
  const channels = initial().filter((item) => item.groupId !== "pokedream");
  assert.deepEqual(migrateChannels(JSON.parse(JSON.stringify({ version: 2, channels }))), channels);
  assert.deepEqual(migrateChannels({ version: 2, channels: [] }), []);
});

test("each group has an independent quota, even with live-only disabled", () => {
  const channels = initial();
  assert.deepEqual(selectTargetChannels(channels, true, () => true), [...idleNames.slice(0, 5), ...dreamNames.slice(0, 1)]);
  assert.equal(selectTargetChannels(channels, false, () => false).length, 6);
  assert.deepEqual(selectTargetChannels(channels, true, (name) => name.startsWith("idle")), idleNames.slice(0, 5));
  assert.deepEqual(selectTargetChannels(channels, true, () => false), []);
});

test("a freed slot is filled by the next eligible channel of the same group", () => {
  const targets = selectTargetChannels(initial(), true, (name) => name !== "brucescottt");
  assert.deepEqual(targets, [...idleNames.slice(0, 5), "safnaww"]);
});

test("one IRC JOIN is used when a selected channel belongs to both groups", () => {
  const channels = migrateChannels([{ name: "StormBomb" }]);
  assert.deepEqual(selectTargetChannels(channels, true, () => true), ["stormbomb", "brucescottt"]);
});

function setup(savedChannels, savedSettings = {}) {
  const clock = fakeClock();
  const handlers = new Map();
  const writes = [];
  const app = Object.assign(new EventEmitter(), {
    setName() {}, setPath() {}, getPath: () => "unused-test-directory",
    requestSingleInstanceLock: () => true, whenReady: () => new Promise(() => {}),
    getVersion: () => "2.2.0", quit() {}
  });
  class Client extends EventEmitter {
    constructor() { super(); this.joinedChannels = new Set(); }
    setDesiredChannels(names) { this.desiredChannels = names; }
    connect() {}
  }
  const source = loadSource("irc-main.js", {
    electron: { app, ipcMain: { handle: (name, handler) => handlers.set(name, handler) } },
    "./discord-session": { DEFAULT_DISCORD_ROOM: "https://discord.com/channels/1/2" },
    "./twitch-irc": { TwitchIrcClient: Client },
    "node:fs/promises": { readFile: async (file) => JSON.stringify(file.endsWith("channels.json") ? savedChannels : file.endsWith("accounts.json") ? [] : savedSettings) },
    "./local-files": { writeJson: async (file, value) => writes.push({ file, value: JSON.parse(JSON.stringify(value)) }), appendConnectionLog: async () => {} }
  }, clock.globals, `
    module.exports = { loadData, publicState, syncClients, clients,
      seedAccounts() {
        accounts = ["a", "b"].map(id => ({ id, login: id, accessToken: "test", expiresAt: Date.now() + 3600000 }));
        running = true;
        liveCheckBusy = true;
      },
      setLive(names) { liveStates.clear(); for (const name of names) liveStates.set(name.toLowerCase(), { liveStatus: "live" }); }
    };`);
  return { source, handlers, writes };
}

test("migration persists once and both IRC accounts receive five plus one targets", async () => {
  const { source, writes } = setup(idleNames.map((name) => ({ name })));
  await source.loadData();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].value.version, 2);
  source.seedAccounts();
  source.setLive([...idleNames, ...dreamNames]);
  source.syncClients();
  for (const client of source.clients.values()) {
    assert.deepEqual(client.desiredChannels, [...idleNames.slice(0, 5), "brucescottt"]);
  }
  const state = source.publicState();
  assert.ok(state.accounts.every((account) => account.targetChannels === 6));
  assert.equal(state.channels.filter((channel) => channel.groupId === "pokedream").length, 4);
  source.setLive([...idleNames, "safnaww", "StormBomb", "surtoo_"]);
  source.syncClients();
  for (const client of source.clients.values()) {
    assert.deepEqual(client.desiredChannels, [...idleNames.slice(0, 5), "safnaww"]);
  }
});

test("account selection is independent per group, syncs clients and survives restart", async () => {
  const { source, handlers, writes } = setup(initial());
  await source.loadData();
  source.seedAccounts();
  source.setLive([...idleNames, ...dreamNames]);
  source.syncClients();
  const update = handlers.get("set-group-account-active");
  let state = await update({}, "pokedream", "a", false);
  assert.deepEqual(source.clients.get("a").desiredChannels, idleNames.slice(0, 5));
  assert.deepEqual(source.clients.get("b").desiredChannels, [...idleNames.slice(0, 5), "brucescottt"]);
  assert.deepEqual([...state.channelGroups.find((group) => group.id === "pokedream").activeAccountIds], ["b"]);
  assert.equal(state.channels.find((channel) => channel.groupId === "pokedream").accountStates[0].state, "inactive");
  await update({}, "pokeidleworld", "b", false);
  assert.deepEqual(source.clients.get("b").desiredChannels, ["brucescottt"]);
  const savedSettings = writes.at(-1).value;
  const restarted = setup({ version: 2, channels: initial() }, savedSettings);
  await restarted.source.loadData();
  restarted.source.seedAccounts();
  restarted.source.setLive([...idleNames, ...dreamNames]);
  restarted.source.syncClients();
  assert.deepEqual(restarted.source.clients.get("a").desiredChannels, idleNames.slice(0, 5));
  assert.deepEqual(restarted.source.clients.get("b").desiredChannels, ["brucescottt"]);
  state = await update({}, "pokeidleworld", "a", false);
  assert.deepEqual(source.clients.get("a").desiredChannels, []);
  assert.equal(state.accounts[0].targetChannels, 0);
  await update({}, "pokedream", "a", true);
  assert.deepEqual(source.clients.get("a").desiredChannels, ["brucescottt"]);
  await assert.rejects(update({}, "unknown", "a", true), /inválido/);
  await assert.rejects(update({}, "pokedream", "unknown", true), /inválida/);
  await assert.rejects(update({}, "pokedream", "a", "false"), /inválida/);
});

test("disabling a group keeps a shared channel joined through the other active group", async () => {
  const { source, handlers } = setup({ version: 2, channels: [
    { name: "shared", groupId: "pokeidleworld" }, { name: "shared", groupId: "pokedream" }
  ] });
  await source.loadData();
  source.seedAccounts();
  source.setLive(["shared"]);
  source.syncClients();
  await handlers.get("set-group-account-active")({}, "pokedream", "a", false);
  assert.deepEqual(source.clients.get("a").desiredChannels, ["shared"]);
});

test("custom group limits apply per account, persist and reject invalid values", async () => {
  const { source, handlers, writes } = setup({ version: 2, channels: initial() });
  await source.loadData();
  source.seedAccounts();
  source.setLive([...idleNames, ...dreamNames]);
  source.syncClients();
  const update = handlers.get("set-group-channel-limit");
  await update({}, "pokedream", 3);
  for (const client of source.clients.values()) assert.deepEqual(client.desiredChannels, [...idleNames.slice(0, 5), "brucescottt", "safnaww", "stormbomb"]);
  await update({}, "pokeidleworld", 2);
  for (const client of source.clients.values()) assert.deepEqual(client.desiredChannels, [...idleNames.slice(0, 2), "brucescottt", "safnaww", "stormbomb"]);
  const restarted = setup({ version: 2, channels: initial() }, writes.at(-1).value);
  await restarted.source.loadData();
  restarted.source.seedAccounts();
  restarted.source.setLive([...idleNames, ...dreamNames]);
  restarted.source.syncClients();
  assert.deepEqual(restarted.source.clients.get("a").desiredChannels, [...idleNames.slice(0, 2), "brucescottt", "safnaww", "stormbomb"]);
  assert.equal(restarted.source.publicState().channelGroups[1].maxChannels, 3);
  await handlers.get("set-group-account-active")({}, "pokedream", "a", false);
  assert.deepEqual(source.clients.get("a").desiredChannels, idleNames.slice(0, 2));
  for (const value of [0, -1, 1.5, "2", null, Infinity, Number.MAX_SAFE_INTEGER + 1]) await assert.rejects(update({}, "pokedream", value), /inteiro/);
  await assert.rejects(update({}, "unknown", 2), /inválido/);
  const invalid = setup({ version: 2, channels: initial() }, { groupChannelLimits: { pokedream: -2, pokeidleworld: "3" } });
  await invalid.source.loadData();
  assert.equal(invalid.source.publicState().channelGroups[0].maxChannels, 5);
  assert.equal(invalid.source.publicState().channelGroups[1].maxChannels, 1);
});

test("group-aware add/remove IPC preserves the other list and persists edits on restart", async () => {
  const { source, handlers, writes } = setup([]);
  await source.loadData();
  source.seedAccounts();
  await handlers.get("add-channel")({}, "StormBomb", "pokeidleworld");
  await assert.rejects(handlers.get("add-channel")({}, "stormbomb", "pokeidleworld"), /cadastrado/);
  await assert.rejects(handlers.get("add-channel")({}, "example", "unknown"), /inválido/);
  const state = await handlers.get("remove-channel")({}, "STORMBOMB", "pokedream");
  assert.ok(state.channels.some((item) => item.name === "StormBomb" && item.groupId === "pokeidleworld"));
  assert.equal(state.channels.filter((item) => item.groupId === "pokedream").length, 3);
  const saved = writes.at(-1).value;
  const restarted = setup(saved);
  await restarted.source.loadData();
  assert.equal(restarted.writes.length, 0);
  assert.equal(restarted.source.publicState().channels.filter((item) => item.groupId === "pokedream").length, 3);
});
