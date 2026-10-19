"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadSource } = require("./helpers.cjs");

const clientId = "exampleclientid00000000000000";

function setup(body, status = 200) {
  const requests = [];
  const oauth = loadSource("twitch-oauth.js", {}, {
    fetch: async (url, options) => {
      requests.push({ url, ...options });
      return { ok: status < 400, status, json: async () => body };
    }
  });
  return { oauth, requests };
}

test("public refresh requests use URL encoding and never send a Client Secret", async () => {
  const { oauth, requests } = setup({ access_token: "new", refresh_token: "rotated", expires_in: 14_400 });
  const result = await oauth.refreshToken(clientId, "refresh+with/special=characters");
  assert.equal(result.refresh_token, "rotated");
  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.equal(request.headers["content-type"], "application/x-www-form-urlencoded");
  assert.equal(request.body.get("client_id"), clientId);
  assert.equal(request.body.get("grant_type"), "refresh_token");
  assert.equal(request.body.get("refresh_token"), "refresh+with/special=characters");
  assert.equal(request.body.has("client_secret"), false);
});

test("device activation does not infer Client Type from an absent public URL parameter", async () => {
  const { oauth } = setup({ device_code: "device", user_code: "ABCD", verification_uri: "https://www.twitch.tv/activate?device-code=ABCD" });
  const device = await oauth.requestDeviceCode(clientId);
  assert.equal(device.verificationUri, "https://www.twitch.tv/activate?device-code=ABCD");
});

test("Public device authorization preserves the provider URL and uses the documented scopes", async () => {
  const url = "https://www.twitch.tv/activate?public=true&device-code=ABCD";
  const { oauth, requests } = setup({ device_code: "device", user_code: "ABCD", verification_uri: url });
  const device = await oauth.requestDeviceCode(clientId);
  assert.equal(device.verificationUri, url);
  assert.equal(requests[0].body.get("scopes"), "chat:read chat:edit");
});

test("configuration errors, expired authorizations and transient rate limits remain distinguishable", async () => {
  for (const [message, configurationError, status] of [
    ["missing client secret", true, 400], ["invalid client", true, 400],
    ["Invalid refresh token", false, 400], ["Too Many Requests", false, 429]
  ]) {
    const { oauth } = setup({ message }, status);
    await assert.rejects(oauth.refreshToken(clientId, "refresh"), (error) => {
      assert.equal(error.status, status);
      assert.equal(oauth.isClientConfigurationError(error), configurationError);
      return true;
    });
  }
});
