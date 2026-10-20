const { app, BrowserWindow } = require('electron');
const path = require('node:path');
process.chdir(path.join(__dirname, '..'));
const fs = require('node:fs');
const assert = require('node:assert/strict');
const dataPath = path.join(app.getPath('temp'), 'idlechats-discord-smoke-' + process.pid);
const setPath = app.setPath.bind(app);
app.setPath = (name, value) => setPath(name, name === 'userData' ? dataPath : value);
app.getVersion = () => require('../package.json').version;
app.setPath('userData', dataPath);
fs.mkdirSync(dataPath, { recursive: true });
fs.writeFileSync(path.join(dataPath, 'channels.json'), '[]');
require('../src/irc-main');
app.whenReady().then(async () => {
  await new Promise(r => setTimeout(r, 2500));
  try {
    const { channelUrl, DEFAULT_DISCORD_ROOM } = require('../src/discord-session');
    assert.equal(channelUrl('https://discord.com/channels/123456789012345678/123456789012345679?x=1'), 'https://discord.com/channels/123456789012345678/123456789012345679');
    for (const url of ['https://evil.com/channels/123/456', 'https://discord.com.evil.com/channels/123456789012345678/123456789012345679', 'javascript:alert(1)', 'https://discord.com/login']) assert.throws(() => channelUrl(url));
    const main = BrowserWindow.getAllWindows()[0];
    assert(main);
    assert.equal(await main.webContents.executeJavaScript('typeof window.idleChats.discordAction'), 'function');
    assert.equal((await main.webContents.executeJavaScript('window.idleChats.getState()')).discord.url, DEFAULT_DISCORD_ROOM);
    await main.webContents.executeJavaScript('window.idleChats.discordAction("open")');
    const panel = BrowserWindow.getAllWindows().find(w => w !== main);
    await new Promise(r => setTimeout(r, 5000));
    const view = panel.contentView.children.find(v => v.webContents && v.webContents !== panel.webContents);
    assert(view);
    const remote = view.webContents;
    assert.equal(new URL(remote.getURL()).origin, "https://discord.com");
    let loginReady = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      loginReady = await remote.executeJavaScript("Boolean(document.querySelector('input[type=password]'))");
      if (loginReady) break;
      await new Promise(r => setTimeout(r, 500));
    }
    fs.mkdirSync('dist/discord-preview', { recursive: true });
    fs.writeFileSync('dist/discord-preview/remote.png', (await remote.capturePage()).toPNG());
    assert(loginReady, 'Discord login did not render within the test timeout');
    await new Promise(r => setTimeout(r, 1500));
    assert(view.webContents.isAudioMuted());
    for (const event of ['did-start-navigation', 'media-started-playing', 'audio-state-changed']) {
      remote.setAudioMuted(false);
      remote.emit(event, {});
      assert(remote.isAudioMuted(), `Audio was not muted after ${event}`);
    }
    assert.equal(await remote.executeJavaScript("navigator.permissions.query({name:'microphone'}).then(p => p.state)"), 'denied');
    const prefs = view.webContents.getLastWebPreferences();
    assert.equal(prefs.nodeIntegration, false); assert.equal(prefs.sandbox, true);
    assert.equal(await view.webContents.executeJavaScript("typeof require"), "undefined");
    await panel.webContents.executeJavaScript('window.discordPanel.action("compact", true)');
    await panel.webContents.executeJavaScript('window.discordPanel.action("compact", false)');
    fs.mkdirSync('dist/discord-preview', { recursive: true });
    fs.writeFileSync('dist/discord-preview/main.png', (await main.webContents.capturePage()).toPNG());
    fs.writeFileSync('dist/discord-preview/remote.png', (await remote.capturePage()).toPNG());
    fs.writeFileSync('dist/discord-preview/discord.png', (await panel.webContents.capturePage()).toPNG());
    panel.close(); assert.equal(panel.isVisible(), false); assert.equal(view.webContents.isDestroyed(), false);
    await main.webContents.executeJavaScript('window.idleChats.discordAction("open")'); assert(panel.isVisible());
    await main.webContents.executeJavaScript('window.idleChats.discordAction("stop")');
    assert(panel.isDestroyed()); assert(remote.isDestroyed());
    assert.equal((await main.webContents.executeJavaScript('window.idleChats.getState()')).discord.active, false);
    console.log('PASS: URL validation, renderer bridge, isolated sandbox, muted playback, compact toggle, hide/reopen, teardown.');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
setTimeout(() => app.exit(2), 120000).unref();
