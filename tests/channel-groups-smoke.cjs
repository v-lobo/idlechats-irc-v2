"use strict";

// Exercise the real Electron renderer, preload and IPC with isolated local data.
const { app, BrowserWindow, safeStorage } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const dataPath = fs.mkdtempSync(path.join(app.getPath("temp"), "idlechats-groups-"));
const setPath = app.setPath.bind(app);
app.setPath = (name, value) => setPath(name, name === "userData" ? dataPath : value);
app.setPath("userData", dataPath);
app.getVersion = () => require("../package.json").version;
app.on("browser-window-created", (_event, window) => window.hide());
fs.writeFileSync(path.join(dataPath, "channels.json"), JSON.stringify([{ name: "existing_channel" }]));
global.fetch = async () => ({ ok: true, text: async () => "offline" });
app.whenReady().then(() => {
  fs.writeFileSync(path.join(dataPath, "accounts.json"), JSON.stringify(["alpha", "beta"].map((id) => ({
    id, login: id, encryptedTokens: safeStorage.encryptString(JSON.stringify({ accessToken: "", expiresAt: 0 })).toString("base64")
  }))));
});
require("../src/irc-main");

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await sleep(50);
  }
  throw new Error(message);
}

app.whenReady().then(async () => {
  try {
    await until(() => BrowserWindow.getAllWindows().length, "Main window missing");
    const main = BrowserWindow.getAllWindows()[0];
    if (process.platform === "win32") {
      const handle = main.getNativeWindowHandle();
      const hwnd = handle.length === 8 ? handle.readBigUInt64LE().toString() : String(handle.readUInt32LE());
      const nativePreview = path.join(__dirname, "..", "dist", "native-window-icon.png");
      fs.mkdirSync(path.dirname(nativePreview), { recursive: true });
      await require("node:util").promisify(require("node:child_process").execFile)("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "assert-native-icon.ps1"), hwnd, nativePreview], { windowsHide: true, timeout: 10000 });
    }
    const evaluate = code => main.webContents.executeJavaScript(code);
    await until(() => evaluate('document.querySelector("#channel-count-pokedream")?.textContent === "4"'), "PokeDream not seeded");
    const state = await evaluate("window.idleChats.getState()");
    assert.equal(state.version, "2.2.0");
    assert.deepEqual(state.channelGroups.map(group => group.maxChannels), [5, 1]);
    assert.deepEqual(state.channels.filter(channel => channel.groupId === "pokeidleworld").map(channel => channel.name), ["existing_channel"]);
    assert.deepEqual(state.channels.filter(channel => channel.groupId === "pokedream").map(channel => channel.name), ["brucescottt", "safnaww", "StormBomb", "surtoo_"]);
    assert.ok(state.discord);
    assert.equal(await evaluate('document.querySelector(".brand-mark").complete && document.querySelector(".brand-mark").naturalWidth > 0'), true, "App icon did not load");
    assert.equal(await evaluate('document.querySelectorAll(".gear-button .settings-icon use").length'), 3);
    assert.equal(await evaluate('document.querySelectorAll(".group-management[open]").length'), 0);
    main.showInactive();
    await sleep(300);
    const layout = await evaluate('({ width: innerWidth, height: innerHeight, contentHeight: document.querySelector(".app-shell").getBoundingClientRect().height })');
    console.log("Initial layout:", layout);
    assert.equal(await evaluate('document.documentElement.scrollHeight > innerHeight'), false, "Default layout needs scrolling");
    const compactPreview = path.join(__dirname, "..", "dist", "compact-layout-preview.png");
    fs.mkdirSync(path.dirname(compactPreview), { recursive: true });
    fs.writeFileSync(compactPreview, (await main.webContents.capturePage()).toPNG());
    await evaluate('document.querySelector("#group-settings").click(); document.querySelector("#group-settings-pokedream").click()');
    assert.equal(await evaluate('document.querySelectorAll(".group-management[open]").length'), 2);
    assert.equal(await evaluate('document.querySelector("#group-settings-pokedream").getAttribute("aria-expanded")'), "true");
    await evaluate('document.querySelector("#channel-limit-pokedream").value = "3"; document.querySelector("#limit-form-pokedream").requestSubmit()');
    await until(() => evaluate('window.idleChats.getState().then(state => state.channelGroups[1].maxChannels === 3)'), "Custom channel limit was not applied");
    await until(() => evaluate('document.querySelector("#limit-feedback-pokedream").textContent === "Salvo"'), "Custom channel limit was not saved");
    assert.equal(JSON.parse(fs.readFileSync(path.join(dataPath, "settings.json"), "utf8")).groupChannelLimits.pokedream, 3);
    assert.equal(await evaluate('document.querySelectorAll("#group-account-list-pokedream input:checked").length'), 2);
    await evaluate('document.querySelector("#group-account-list-pokedream input").click()');
    await until(() => evaluate('document.querySelector("#group-account-count-pokedream").textContent === "1/2"'), "Group account selection did not update");
    assert.equal(await evaluate('document.querySelectorAll("#group-account-list input:checked").length'), 2);
    const settings = JSON.parse(fs.readFileSync(path.join(dataPath, "settings.json"), "utf8"));
    assert.equal(settings.groupAccountOverrides.pokedream.alpha, false);
    assert.deepEqual((await evaluate("window.idleChats.getState()")).channelGroups[1].activeAccountIds, ["beta"]);
    await evaluate('document.querySelector("#channels-section").open = document.querySelector("#channels-section-pokedream").open = true');

    await evaluate(`
      document.querySelector("#channel-input-pokedream").value = "new_dream_channel";
      document.querySelector("#channel-form-pokedream").requestSubmit();
    `);
    await until(() => evaluate('document.querySelector("#channel-count-pokedream").textContent === "5"'), "Dream form did not add to its group");
    assert.equal(await evaluate('document.querySelector("#channel-count").textContent'), "1");
    await evaluate('document.querySelector("#channel-list-pokedream .channel-row:last-child button").click()');
    await until(() => evaluate('document.querySelector("#channel-count-pokedream").textContent === "4"'), "Dream remove did not update its group");
    assert.equal(await evaluate('document.querySelector("#channel-count").textContent'), "1");

    await evaluate(`
      document.querySelector("#channel-input").value = "new_idle_channel";
      document.querySelector("#channel-form").requestSubmit();
    `);
    await until(() => evaluate('document.querySelector("#channel-count").textContent === "2"'), "Idle form did not add to its group");
    assert.equal(await evaluate('document.querySelector("#channel-count-pokedream").textContent'), "4");
    const saved = JSON.parse(fs.readFileSync(path.join(dataPath, "channels.json"), "utf8"));
    assert.equal(saved.version, 2);
    assert.equal(saved.channels.filter(channel => channel.groupId === "pokedream").length, 4);
    assert.equal(saved.channels.filter(channel => channel.groupId === "pokeidleworld").length, 2);
    assert.equal(await evaluate('Boolean(document.querySelector("#channel-form-pokedream").compareDocumentPosition(document.querySelector("#limit-form-pokedream")) & Node.DOCUMENT_POSITION_FOLLOWING)'), true, "Limit must follow add-channel form");
    await evaluate('document.querySelector("#discord-options").click()');
    assert.equal(await evaluate('document.querySelector("#discord-controls").open'), true);
    assert.equal(await evaluate('document.querySelector("#discord-options").getAttribute("aria-expanded")'), "true");
    await evaluate('document.querySelector("#channel-list-pokedream .channel-copy").open = true');
    await evaluate('document.querySelector("#settings-section").open = true; document.querySelector("#live-only").click()');
    await until(() => evaluate('document.querySelector("#live-only").checked === false'), "Live-only setting did not update");
    assert.equal(await evaluate('document.querySelector("#channel-list-pokedream .channel-copy").open'), true, "Account details collapsed on state update");
    await evaluate('document.querySelector("#settings-section").open = document.querySelector("#accounts-section").open = document.querySelector("#discord-controls").open = document.querySelector("#discord-settings").open = true');
    await evaluate('document.querySelector("#minimize-to-tray").click()');
    await until(() => evaluate('window.idleChats.getState().then(state => state.preferences.minimizeToTray)'), "Tray setting did not persist");
    await evaluate('document.querySelector("#check-live").click()');
    await until(() => evaluate('document.querySelector("#check-live").disabled === false'), "Global channel refresh did not finish");

    main.setContentSize(600, 920);
    main.showInactive();
    await sleep(300);
    const preview = path.join(__dirname, "..", "dist", "channel-groups-preview.png");
    fs.mkdirSync(path.dirname(preview), { recursive: true });
    fs.writeFileSync(preview, (await main.webContents.capturePage()).toPNG());
    main.setContentSize(440, 600);
    await sleep(100);
    assert.equal(await evaluate("document.documentElement.scrollWidth > innerWidth"), false, "Narrow layout overflows horizontally");
    main.setContentSize(360, 600);
    await sleep(100);
    assert.equal(await evaluate("document.documentElement.scrollWidth > innerWidth"), false, "Minimum layout overflows horizontally");
    assert.equal(await evaluate('document.querySelector("#notice").textContent'), "");
    console.log("PASS: real Electron migration, preload, group forms, removal, persistence, Discord panel and narrow layout.");
    console.log(`Preview: ${preview}`);
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
setTimeout(() => app.exit(2), 20_000).unref();
