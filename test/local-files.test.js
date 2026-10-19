"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { writeJson, appendConnectionLog } = require("../src/local-files");

test("concurrent account writes are serialized and retain the latest snapshot", async (t) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "idlechats-storage-test-"));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const file = path.join(folder, "accounts.json");
  await Promise.all(Array.from({ length: 30 }, (_, sequence) => writeJson(file, { sequence })));
  assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), { sequence: 29 });
  assert.deepEqual(await fs.readdir(folder), ["accounts.json"]);
});

test("connection log rotates and ignores tokens and chat content", async (t) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "idlechats-log-test-"));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const file = path.join(folder, "connections.log");
  await fs.writeFile(file, "x".repeat(256 * 1024));
  await appendConnectionLog(file, { event: "account-state", state: "reconnecting", reason: "pong-timeout", accessToken: "secret", message: "private chat" });
  const text = await fs.readFile(file, "utf8");
  assert.equal(JSON.parse(text).reason, "pong-timeout");
  assert.equal(text.includes("secret"), false);
  assert.equal(text.includes("private chat"), false);
  assert.equal((await fs.stat(`${file}.1`)).size, 256 * 1024);
  assert.ok((await fs.stat(file)).size < 256 * 1024);
});
