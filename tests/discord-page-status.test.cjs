"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { watchDiscordPageStatus, PAGE_OPEN } = require("../src/discord-page-status");

function setup(options) {
  const contents = new EventEmitter();
  contents.isLoadingMainFrame = () => false;
  let status;
  const dispose = watchDiscordPageStatus(contents, value => { status = value; }, options);
  const navigate = () => contents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
  return { contents, dispose, navigate, status: () => status };
}

test("background frames and SPA navigation cannot reset a ready page to loading", () => {
  const state = setup();
  state.navigate();
  assert.equal(state.status(), "Carregando Discord…");
  state.contents.emit("dom-ready");
  assert.equal(state.status(), PAGE_OPEN);
  state.contents.emit("did-start-loading");
  state.contents.emit("did-start-navigation", { isMainFrame: false, isSameDocument: false });
  state.contents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true });
  assert.equal(state.status(), PAGE_OPEN);
  state.dispose();
});

test("an actual reload returns to loading and stop-loading settles the indicator", () => {
  const state = setup();
  state.navigate();
  state.contents.emit("dom-ready");
  state.navigate();
  assert.equal(state.status(), "Carregando Discord…");
  state.contents.emit("did-stop-loading");
  assert.equal(state.status(), PAGE_OPEN);
  state.dispose();
});

test("error-page events preserve failure and a subsequent navigation can recover", () => {
  const state = setup();
  state.navigate();
  state.contents.emit("did-fail-load", {}, -105, "ERR_NAME_NOT_RESOLVED", "https://discord.com", true);
  state.contents.emit("dom-ready");
  state.contents.emit("did-finish-load");
  state.contents.emit("did-stop-loading");
  assert.match(state.status(), /^Falha ao carregar/);
  state.navigate();
  state.contents.emit("did-fail-load", {}, -3, "ERR_ABORTED", "https://discord.com", true);
  state.contents.emit("did-fail-load", {}, -105, "ERR_NAME_NOT_RESOLVED", "https://other.test", false);
  state.contents.emit("dom-ready");
  assert.equal(state.status(), PAGE_OPEN);
  state.contents.emit("render-process-gone");
  state.contents.emit("did-stop-loading");
  assert.match(state.status(), /^Discord interrompido/);
  state.dispose();
});

test("an unresponsive main document leaves loading and can still recover", async () => {
  const state = setup({ loadTimeoutMs: 5 });
  state.navigate();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.match(state.status(), /^Discord demorando para carregar/);
  state.contents.emit("dom-ready");
  assert.equal(state.status(), PAGE_OPEN);
  state.contents.emit("destroyed");
  assert.equal(state.contents.listenerCount("did-start-navigation"), 0);
});
