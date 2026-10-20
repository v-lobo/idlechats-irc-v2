"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup() {
  const calls = [];
  class CredentialsContainer {
    get(options) { calls.push({ method: "get", receiver: this, options }); return Promise.resolve("password-result"); }
    create(options) { calls.push({ method: "create", receiver: this, options }); return Promise.resolve("password-created"); }
  }
  class PublicKeyCredential {
    static isConditionalMediationAvailable() { return Promise.resolve(true); }
    static isUserVerifyingPlatformAuthenticatorAvailable() { return Promise.resolve(true); }
  }
  const container = new CredentialsContainer();
  const context = vm.createContext({ CredentialsContainer, PublicKeyCredential, DOMException,
    window: { addEventListener() {} }, document: { readyState: "loading", addEventListener() {} } });
  context.require = name => {
    assert.equal(name, "electron");
    return { contextBridge: { executeInMainWorld: ({ func }) => vm.runInContext(`(${func.toString()})()`, context) },
      ipcRenderer: { on() {}, send() {} } };
  };
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "src", "discord-web-preload.js"), "utf8"), context);
  return { container, credential: PublicKeyCredential, calls };
}

test("public-key login and registration never reach the native credential APIs", async () => {
  const { container, calls } = setup();
  for (const method of ["get", "create"]) {
    await assert.rejects(container[method]({ publicKey: { challenge: new Uint8Array(32) } }), error => {
      assert.equal(error.name, "NotAllowedError");
      assert.match(error.message, /Entre com e-mail e senha ou código QR/);
      return true;
    });
  }
  assert.equal(calls.length, 0);
});

test("password credential requests retain their receiver, arguments and result", async () => {
  const { container, calls } = setup();
  const options = { password: true, mediation: "optional" };
  assert.equal(await container.get(options), "password-result");
  assert.equal(await container.create(options), "password-created");
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.receiver === container && call.options === options));
});

test("the embedded page does not advertise conditional passkeys or Windows Hello", async () => {
  const { credential } = setup();
  assert.equal(await credential.isConditionalMediationAvailable(), false);
  assert.equal(await credential.isUserVerifyingPlatformAuthenticatorAvailable(), false);
});
