"use strict";

// Offline regression: a late-loading iframe must not leave either panel loading.
const { app, BrowserWindow, ipcMain } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const dataPath = path.join(app.getPath("temp"), `idlechats-status-smoke-${process.pid}`);
const setPath = app.setPath.bind(app);
app.setPath = (name, value) => setPath(name, name === "userData" ? dataPath : value);
app.getVersion = () => require("../package.json").version;
app.setPath("userData", dataPath);
fs.mkdirSync(dataPath, { recursive: true });
fs.writeFileSync(path.join(dataPath, "channels.json"), "[]");
require("../src/irc-main");
const liveFetch = global.fetch;
global.fetch = (url, options) => String(url) === "https://api.github.com/repos/v-lobo/idlechats-irc-v2/releases/latest"
  ? Promise.resolve({ ok: true, status: 200, json: async () => ({ tag_name: `v${app.getVersion()}`, html_url: `https://github.com/v-lobo/idlechats-irc-v2/releases/tag/v${app.getVersion()}` }) })
  : liveFetch(url, options);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await sleep(50);
  }
  throw new Error(message);
}

app.whenReady().then(async () => {
  const server = http.createServer((request, response) => {
    if (request.url === "/slow-frame") return; // Stay pending until teardown.
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><title>Discord status fixture</title>
      <style>body{display:flex;background:#313338;color:white;font:16px sans-serif}nav,aside,main{padding:20px;border:1px solid #666}main{flex:1}</style>
      <nav id="servers" class="guilds__fixture" aria-label="Barra lateral de servidores"><div data-list-id="guildsnav">Servidores</div></nav>
      <aside id="channels">Canais e controles de voz</aside><main>Sala de voz</main><aside id="members" class="membersWrap__fixture">Membros</aside>
      <script>
        window.passkeyAttempt = navigator.credentials.get({publicKey:{challenge:new Uint8Array(32)}})
          .then(() => "unexpected native success", error => ({name:error.name,message:error.message}));
        window.conditionalPasskey = PublicKeyCredential.isConditionalMediationAvailable();
      </script>`);
  });
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    await until(() => BrowserWindow.getAllWindows().length, "Main window missing");
    const main = BrowserWindow.getAllWindows()[0];
    await until(() => main.webContents.executeJavaScript("Boolean(window.idleChats)"), "Main panel not ready");
    await until(() => main.webContents.executeJavaScript('document.querySelector("#app-version").textContent').then(value => value === `v${app.getVersion()}`), "Version button was not restored");
    assert.equal(await main.webContents.executeJavaScript("typeof window.idleChats.checkForUpdates"), "function");
    assert.equal(await main.webContents.executeJavaScript("typeof window.idleChats.openLatestRelease"), "function");
    await main.webContents.executeJavaScript('document.querySelector("#app-version").click()');
    await until(() => main.webContents.executeJavaScript('document.querySelector("#update-status").textContent').then(value => value === "Você está na versão mais recente."), "Restored update check did not render its result");
    await main.webContents.executeJavaScript('window.idleChats.discordAction("open")');
    const panel = BrowserWindow.getAllWindows().find(window => window !== main);
    const remote = panel.contentView.children.find(view => view.webContents && view.webContents !== panel.webContents).webContents;
    const fixture = `http://127.0.0.1:${server.address().port}/`;
    await remote.loadURL(fixture);
    const passkeyAttempt = await remote.executeJavaScript("window.passkeyAttempt");
    assert.equal(passkeyAttempt.name, "NotAllowedError");
    assert.match(passkeyAttempt.message, /Chaves de acesso desativadas no IdleChats/);
    assert.equal(await remote.executeJavaScript("window.conditionalPasskey"), false);
    assert.equal(await remote.executeJavaScript("typeof require"), "undefined");
    assert.equal(await remote.executeJavaScript("typeof window.discordPanel"), "undefined");
    const getStatus = () => main.webContents.executeJavaScript("window.idleChats.getState().then(s => s.discord.status)");
    const ready = await getStatus();
    assert.match(ready, /^Página aberta/);
    await until(() => panel.webContents.executeJavaScript('document.querySelector("#status").title').then(value => value.endsWith(ready)), "Discord header did not update");
    await until(() => main.webContents.executeJavaScript('document.querySelector("#discord-status").title').then(value => value === ready), "Main panel did not update");

    fs.mkdirSync(path.join(__dirname, "..", "dist", "discord-preview"), { recursive: true });
    const screenshot = async (name, contents) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        await sleep(250);
        try {
          fs.writeFileSync(path.join(__dirname, "..", "dist", "discord-preview", name), (await contents.capturePage()).toPNG());
          return;
        } catch (error) {
          if (error.message !== "UnknownVizError" || attempt === 2) throw new Error(`Capture ${name}: ${error.message}`);
        }
      }
    };
    const view = panel.contentView.children.find(view => view.webContents === remote);
    assert.equal(view.getBounds().y, 156);
    await screenshot("discord-full-header.png", panel.webContents);
    await screenshot("discord-full-page.png", remote);
    await panel.webContents.executeJavaScript('window.discordPanel.action("compact", true)');
    assert.equal(view.getBounds().y, 100);
    await until(() => panel.webContents.executeJavaScript('document.documentElement.dataset.compact === "true"'), "Compact header did not update");
    assert.equal(await panel.webContents.executeJavaScript('getComputedStyle(document.querySelector("header > p")).display'), "none");
    assert.deepEqual(await remote.executeJavaScript('["servers","members","channels"].map(id=>getComputedStyle(document.getElementById(id)).display)'), ["none", "none", "block"]);
    await screenshot("discord-compact-header.png", panel.webContents);
    await screenshot("discord-compact-page.png", remote);
    await panel.webContents.executeJavaScript('window.discordPanel.action("compact", false)');
    assert.equal(view.getBounds().y, 156);
    await until(() => remote.executeJavaScript('["servers","members"].every(id=>getComputedStyle(document.getElementById(id)).display === "block")'), "Disabling compact mode did not restore sidebars");
    await screenshot("restored-version-main.png", main.webContents);

    const subframeStarted = new Promise(resolve => remote.once("did-start-loading", resolve));
    await remote.executeJavaScript('const frame = document.createElement("iframe"); frame.src = "/slow-frame"; document.body.append(frame);');
    await subframeStarted;
    await sleep(200);
    assert.equal(remote.isLoading(), true, "Fixture must still be loading its iframe");
    assert.equal(await getStatus(), ready);
    assert.ok((await panel.webContents.executeJavaScript('document.querySelector("#status").title')).endsWith(ready));
    assert.equal(await main.webContents.executeJavaScript('document.querySelector("#discord-status").title'), ready);

    // Recover after real errors without letting the subsequent error-page load
    // events overwrite the failure message.
    remote.emit("did-fail-load", {}, -105, "ERR_NAME_NOT_RESOLVED", fixture, true);
    remote.emit("dom-ready");
    assert.match(await getStatus(), /^Falha ao carregar/);
    remote.stop();
    await remote.loadURL(fixture);
    assert.match(await getStatus(), /^Página aberta/);

    // Serve a local voice-panel fixture under Discord's origin in this test's
    // isolated session. The production IPC origin checks remain enabled.
    remote.session.protocol.handle("https", () => new Response(`<!doctype html><title>Voice presence fixture</title>
      <main id="chat">Messages are outside the voice controls.</main>
      <section class="panels__fixture"><section id="voice"></section></section>`,
      { headers: { "content-type": "text/html; charset=utf-8" } }));
    const targetRoom = "https://discord.com/channels/1516313244057337908/1551936385030824056";
    await remote.loadURL(targetRoom);
    const voiceState = () => main.webContents.executeJavaScript("window.idleChats.getState().then(s => s.discord.voice.state)");
    const expectVoice = async state => {
      await until(() => voiceState().then(value => value === state), `Expected presence ${state}`);
      await until(() => main.webContents.executeJavaScript('document.querySelector("#discord-voice").dataset.state').then(value => value === state), "Main voice indicator did not update");
      await until(() => panel.webContents.executeJavaScript('document.querySelector("#status").dataset.state').then(value => value === state), "Discord voice indicator did not update");
    };
    const setVoicePanel = markup => remote.executeJavaScript(`document.getElementById("voice").innerHTML = ${JSON.stringify(markup)}`);
    const connectedMarkup = (url, label = "Voz conectada") => `<div><span>${label}</span><a href="${url}">Sala / Servidor</a></div><button aria-label="Desconectar">Desconectar</button>`;
    await expectVoice("disconnected"); // Correct page URL alone is not proof.
    await remote.executeJavaScript(`document.getElementById("chat").innerHTML = ${JSON.stringify(connectedMarkup(targetRoom))}`);
    await expectVoice("disconnected"); // Quoted chat content cannot turn it green.
    ipcMain.emit("discord-presence", { sender: main.webContents, senderFrame: main.webContents.mainFrame }, { kind: "connected", channelUrl: targetRoom });
    assert.equal(await voiceState(), "disconnected");
    await setVoicePanel(connectedMarkup(targetRoom));
    await expectVoice("connected");
    await main.webContents.executeJavaScript('window.idleChats.discordAction("hide")');
    assert.equal(await main.webContents.executeJavaScript('document.querySelector("#discord-status").textContent'), "Conexão na sala configurada.");
    await screenshot("discord-presence-green.png", main.webContents);
    await setVoicePanel(connectedMarkup(targetRoom.replace("1551936385030824056", "1551936385030824057")));
    await expectVoice("wrong-room"); // Observer keeps working with the window hidden.
    await setVoicePanel(connectedMarkup(targetRoom, "Conectando RTC"));
    await expectVoice("connecting");
    await setVoicePanel('<input type="password" aria-label="Senha">');
    await expectVoice("login-required");
    await setVoicePanel('<span>Voice Connected</span><button aria-label="Disconnect">Disconnect</button>');
    await expectVoice("unknown"); // No channel identity, no confirmation.
    await setVoicePanel(connectedMarkup(targetRoom, "Voice Connected"));
    await expectVoice("connected");
    await main.webContents.executeJavaScript('window.idleChats.discordAction("stop")');
    assert.equal(await voiceState(), "closed");
    console.log("PASS: presence confirms only the configured voice room, rejects page/chat/spoofed reports, updates while hidden and clears on disconnect; other Discord controls pass.");
    server.closeAllConnections();
    server.close();
    app.exit(0);
  } catch (error) {
    console.error(error);
    server.closeAllConnections();
    server.close();
    app.exit(1);
  }
});
setTimeout(() => app.exit(2), 25_000).unref();
