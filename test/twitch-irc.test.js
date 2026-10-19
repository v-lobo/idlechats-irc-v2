"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { fakeClock, loadSource } = require("./helpers.cjs");

function setup() {
  const clock = fakeClock();
  const sockets = [];
  class FakeSocket extends EventEmitter {
    constructor() { super(); this.writes = []; this.destroyed = false; }
    setEncoding() {}
    setKeepAlive() {}
    write(line) { this.writes.push(line.trim()); }
    destroy() { this.destroyed = true; this.emit("close"); }
    receive(line) { this.emit("data", line + "\r\n"); }
  }
  const { TwitchIrcClient } = loadSource("twitch-irc.js", {
    "node:tls": { connect() { const socket = new FakeSocket(); sockets.push(socket); return socket; } }
  }, clock.globals);
  const client = new TwitchIrcClient({ login: "example", accessToken: "faketoken" });
  const states = [];
  client.on("status", (state) => states.push(state));
  client.setDesiredChannels(["channel1", "channel2"]);
  const ready = (socket = sockets.at(-1)) => {
    socket.emit("secureConnect");
    socket.receive(":tmi.twitch.tv 001 example :Welcome");
    socket.receive(":tmi.twitch.tv CAP * ACK :twitch.tv/membership twitch.tv/commands");
  };
  return { client, clock, sockets, states, ready };
}

test("a stalled TLS connection or IRC login is destroyed after 30 seconds", () => {
  for (const partialLogin of [false, true]) {
    const { client, clock, sockets, states } = setup();
    client.connect();
    if (partialLogin) { sockets[0].emit("secureConnect"); sockets[0].receive(":tmi.twitch.tv 001 example :Welcome"); }
    clock.advance(30_000);
    assert.equal(sockets[0].destroyed, true);
    assert.equal(states.at(-1).reason, "connect-timeout");
    clock.advance(5000);
    assert.equal(sockets.length, 2);
    client.disconnect();
  }
});

test("server RECONNECT immediately destroys the old socket and rejoins desired channels", () => {
  const { client, clock, sockets, ready } = setup();
  client.connect(); ready();
  sockets[0].receive(":example!example@example JOIN #channel1");
  assert.equal(client.joinedChannels.size, 1);
  sockets[0].receive(":tmi.twitch.tv RECONNECT");
  assert.equal(sockets[0].destroyed, true);
  assert.equal(client.joinedChannels.size, 0);
  clock.advance(5000); ready();
  assert.ok(sockets[1].writes.includes("JOIN #channel1"));
  assert.ok(sockets[1].writes.includes("JOIN #channel2"));
  sockets[0].receive(":tmi.twitch.tv NOTICE * :Login authentication failed");
  sockets[0].emit("end"); sockets[0].emit("close");
  assert.equal(client.socket, sockets[1]);
  assert.equal(client.ready, true);
  client.disconnect();
});

test("a silent connection is detected even if no close or error arrives", () => {
  const { client, clock, sockets, states, ready } = setup();
  client.connect(); ready();
  clock.advance(60_000);
  assert.ok(sockets[0].writes.some((line) => line.startsWith("PING :idlechats-")));
  // Chat traffic must not masquerade as the server's heartbeat response.
  const ping = sockets[0].writes.findLast((line) => line.startsWith("PING :"));
  sockets[0].receive(`:other!other@other PRIVMSG #channel1 :PONG tmi.twitch.tv ${ping.slice(5)}`);
  clock.advance(30_000);
  assert.equal(sockets[0].destroyed, true);
  assert.equal(states.at(-1).reason, "pong-timeout");
  clock.advance(5000);
  assert.equal(sockets.length, 2);
  client.disconnect();
});

test("matching PONG preserves the connection and server PING is answered without chat messages", () => {
  const { client, clock, sockets, ready } = setup();
  client.connect(); ready();
  for (let index = 0; index < 5; index += 1) {
    clock.advance(60_000);
    const ping = sockets[0].writes.findLast((line) => line.startsWith("PING :"));
    sockets[0].receive(`:tmi.twitch.tv PONG tmi.twitch.tv ${ping.slice(5)}`);
  }
  sockets[0].receive("PING :tmi.twitch.tv");
  assert.ok(sockets[0].writes.includes("PONG :tmi.twitch.tv"));
  assert.equal(sockets.length, 1);
  assert.equal(client.ready, true);
  assert.equal(sockets[0].writes.some((line) => line.startsWith("PRIVMSG")), false);
  client.disconnect();
});

test("network failures back off and stopping cancels all connection timers", () => {
  const { client, clock, sockets } = setup();
  client.connect();
  for (const delay of [5000, 10_000, 20_000, 40_000, 60_000, 60_000]) {
    const count = sockets.length;
    sockets.at(-1).emit("error", new Error("offline"));
    clock.advance(delay - 1);
    assert.equal(sockets.length, count);
    clock.advance(1);
    assert.equal(sockets.length, count + 1);
  }
  client.disconnect();
  assert.equal(clock.count(), 0);
  const count = sockets.length;
  clock.advance(300_000);
  assert.equal(sockets.length, count);
});

test("resume replaces the socket and a late confirmation for a removed channel is parted", () => {
  const { client, clock, sockets, ready } = setup();
  client.connect(); ready();
  client.reconnect("System resumed");
  assert.equal(sockets[0].destroyed, true);
  clock.advance(1000); ready();
  client.setDesiredChannels(["channel2"]);
  sockets[1].receive(":example!example@example JOIN #channel1");
  assert.equal(client.joinedChannels.has("channel1"), false);
  assert.ok(sockets[1].writes.includes("PART #channel1"));
  client.disconnect();
});

test("a lost JOIN confirmation is retried without reconnecting the whole account", () => {
  const { client, clock, sockets, ready } = setup();
  client.connect(); ready();
  clock.advance(60_000);
  assert.equal(sockets[0].writes.filter((line) => line === "JOIN #channel1").length, 2);
  sockets[0].receive(":example!example@example JOIN #channel1");
  const ping = sockets[0].writes.findLast((line) => line.startsWith("PING :"));
  sockets[0].receive(`:tmi.twitch.tv PONG tmi.twitch.tv ${ping.slice(5)}`);
  clock.advance(60_000);
  assert.equal(sockets[0].writes.filter((line) => line === "JOIN #channel1").length, 2);
  client.disconnect();
});

test("fragmented login replies work in either order and chat content cannot trigger authentication errors", () => {
  const { client, sockets } = setup();
  client.connect();
  sockets[0].emit("secureConnect");
  sockets[0].emit("data", ":tmi.twitch.tv CAP * ACK :twitch.tv/member");
  sockets[0].emit("data", "ship twitch.tv/commands\r\n:tmi.twitch.tv 001 example :Welcome\r\n");
  assert.equal(client.ready, true);
  sockets[0].receive(":other!other@other PRIVMSG #channel1 :NOTICE Login authentication failed");
  assert.equal(client.stopped, false);
  assert.equal(client.ready, true);
  client.disconnect();
});

test("authentication rejection clears the old connection and waits for token renewal", () => {
  const { client, sockets, clock } = setup();
  let errors = 0;
  client.on("authentication-error", () => { errors += 1; });
  client.connect();
  sockets[0].receive(":tmi.twitch.tv NOTICE * :Login authentication failed");
  clock.advance(300_000);
  assert.equal(errors, 1);
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].destroyed, true);
  assert.equal(clock.count(), 0);
});
