"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { checkElectronVersion } = require("../scripts/check-electron-version.cjs");

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "idlechats-electron-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "package-lock.json"), JSON.stringify({ packages: { "node_modules/electron": { version: "45.2.3" } } }));
  return dir;
}

function install(dir, version, binaryVersion = version) {
  const electronDir = path.join(dir, "node_modules", "electron");
  fs.mkdirSync(path.join(electronDir, "dist"), { recursive: true });
  fs.writeFileSync(path.join(electronDir, "package.json"), JSON.stringify({ version }));
  fs.writeFileSync(path.join(electronDir, "dist", "version"), binaryVersion + "\r\n");
  fs.writeFileSync(path.join(electronDir, "dist", "electron.exe"), "fixture");
}

test("fresh and outdated installations require synchronization with the release lockfile", t => {
  const dir = fixture(t);
  assert.equal(checkElectronVersion(dir), 1);
  install(dir, "44.7.2");
  assert.equal(checkElectronVersion(dir), 1);
  install(dir, "45.2.3");
  assert.equal(checkElectronVersion(dir), 0);
});

test("matching package metadata does not hide an outdated or missing Electron binary", t => {
  const dir = fixture(t);
  install(dir, "45.2.3", "44.7.2");
  assert.equal(checkElectronVersion(dir), 1);
  install(dir, "45.2.3");
  fs.unlinkSync(path.join(dir, "node_modules", "electron", "dist", "electron.exe"));
  assert.equal(checkElectronVersion(dir), 1);
});

test("missing or invalid lockfiles are reported as release errors", t => {
  const dir = fixture(t);
  for (const contents of ["invalid json", "{}", '{"packages":{"node_modules/electron":{"version":null}}}']) {
    fs.writeFileSync(path.join(dir, "package-lock.json"), contents);
    assert.equal(checkElectronVersion(dir), 2);
  }
  fs.unlinkSync(path.join(dir, "package-lock.json"));
  assert.equal(checkElectronVersion(dir), 2);
});
