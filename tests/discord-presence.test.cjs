"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { discordPresence, roomIdentity } = require("../src/discord-presence");
const targetUrl = "https://discord.com/channels/1516313244057337908/1551936385030824056";
const sample = { active: true, targetUrl, now: 100_000, lastSeen: 99_000 };

test("only a fresh confirmed voice connection in the configured room turns green", () => {
  assert.equal(discordPresence({ ...sample, report: { kind: "connected", channelUrl: targetUrl } }).state, "connected");
  assert.equal(discordPresence({ ...sample }).state, "checking");
  assert.equal(discordPresence({ ...sample, report: { kind: "unknown", channelUrl: targetUrl } }).state, "unknown");
  assert.equal(discordPresence({ ...sample, report: { kind: "disconnected", channelUrl: targetUrl } }).state, "disconnected");
});

test("a different channel or guild is never the configured room", () => {
  for (const channelUrl of [targetUrl.replace("1551936385030824056", "1551936385030824057"), targetUrl.replace("1516313244057337908", "1516313244057337909")]) {
    assert.equal(discordPresence({ ...sample, report: { kind: "connected", channelUrl } }).state, "wrong-room");
  }
});

test("closed, expired and clock-shifted observations never keep a green indicator", () => {
  const connected = { ...sample, report: { kind: "connected", channelUrl: targetUrl } };
  assert.equal(discordPresence({ ...connected, active: false }).state, "closed");
  assert.equal(discordPresence({ ...connected, now: sample.lastSeen + 15_001 }).state, "unknown");
  assert.equal(discordPresence({ ...connected, now: sample.lastSeen - 1 }).state, "unknown");
});

test("invalid URLs and unrecognized reports cannot confirm a room", () => {
  for (const channelUrl of ["https://evil.test/channels/1516313244057337908/1551936385030824056", "https://discord.com/login", "javascript:alert(1)", ""]) {
    assert.equal(roomIdentity(channelUrl), null);
    assert.equal(discordPresence({ ...sample, report: { kind: "connected", channelUrl } }).state, "unknown");
  }
  assert.equal(discordPresence({ ...sample, report: { kind: "anything" } }).state, "unknown");
});

test("network, login and connecting states have distinct non-green indicators", () => {
  for (const kind of ["offline", "login-required", "connecting"]) {
    assert.equal(discordPresence({ ...sample, report: { kind } }).state, kind);
  }
});
