"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { closeDiscordPage, flushDiscordSession } = require("../src/discord-session-lifecycle");

test("closing the embedded page waits for its normal beforeunload handler", async () => {
  const contents = new EventEmitter();
  let saved = false;
  contents.isDestroyed = () => false;
  contents.close = options => {
    assert.equal(options.waitForBeforeUnload, true);
    saved = true;
    contents.emit("destroyed");
  };
  await closeDiscordPage(contents);
  assert.equal(saved, true);
  assert.equal(contents.listenerCount("will-prevent-unload"), 0);
});

test("a page cannot indefinitely veto an explicit app shutdown", async () => {
  const contents = new EventEmitter();
  let allowed = false;
  contents.isDestroyed = () => false;
  contents.close = () => {
    contents.emit("will-prevent-unload", { preventDefault: () => { allowed = true; } });
    assert(allowed);
    contents.emit("destroyed");
  };
  await closeDiscordPage(contents);
});

test("a stuck renderer times out and removes lifecycle listeners", async () => {
  const contents = new EventEmitter();
  contents.isDestroyed = () => false;
  contents.close = () => {};
  await assert.rejects(closeDiscordPage(contents, { timeoutMs: 5 }), /fechamento seguro/);
  assert.equal(contents.listenerCount("destroyed"), 0);
  assert.equal(contents.listenerCount("will-prevent-unload"), 0);
});

test("storage and cookies are flushed in order and failures remain visible", async () => {
  const calls = [];
  await flushDiscordSession({
    flushStorageData() { calls.push("storage"); },
    cookies: { async flushStore() { calls.push("cookies"); } }
  });
  assert.deepEqual(calls, ["storage", "cookies"]);
  await assert.rejects(flushDiscordSession({ flushStorageData() {}, cookies: { async flushStore() { throw new Error("disk unavailable"); } } }), /disk unavailable/);
});
