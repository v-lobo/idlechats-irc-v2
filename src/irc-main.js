"use strict";

const { app, BrowserWindow, ipcMain, Menu, nativeImage, powerMonitor, safeStorage, shell, Tray } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { TwitchIrcClient } = require("./twitch-irc");
const { writeJson, appendConnectionLog } = require("./local-files");
const {
  ensureChatScopes, getUserProfile, isClientConfigurationError, pollDeviceToken, refreshToken, requestDeviceCode, validateClientId, validateToken
} = require("./twitch-oauth");

app.setName("IdleChats IRC V2");
app.setPath("userData", path.join(app.getPath("appData"), "IdleChats IRC V2"));
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

const CHANNEL_PATTERN = /^[a-zA-Z0-9_]{1,25}$/;
const MAX_CHANNELS_PER_ACCOUNT = 5;
const LIVE_CHECK_INTERVAL_MS = 60_000;
const DEFAULT_CHANNELS = ["gglippe", "macabeel", "dirmo1", "neegannnn", "lugontv", "stigalzera", "raku_m", "daldreak"];
const TWITCH_CLIENT_ID = "mjqfe51tvku6pa0ymtkitjwlpi0x6k";
const GITHUB_RELEASES_API = "https://api.github.com/repos/v-lobo/idlechats-irc-v2/releases/latest";
const settingsFile = () => path.join(app.getPath("userData"), "settings.json");
const channelsFile = () => path.join(app.getPath("userData"), "channels.json");
const accountsFile = () => path.join(app.getPath("userData"), "accounts.json");
const connectionLogFile = () => path.join(app.getPath("userData"), "connections.log");

let mainWindow;
let tray;
let isQuitting = false;
let channels = [];
let accounts = [];
let clientId = "";
let preferences = { minimizeToTray: false, liveOnly: true };
let running = false;
let liveCheckTimer;
let liveCheckBusy = false;
let uiMessage = "";
let metricsTimer;
let lastConnectionRecoveryAt = 0;
let diagnostic = { busy: false, summary: "", results: [] };
let runtimeMetrics = { privateMb: null, cpuPercent: null, processCount: 0, joinedCount: 0 };
const clients = new Map();
const pendingLogins = new Map();
const liveStates = new Map();
const accountStates = new Map();

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch (error) {
    if (error.code !== "ENOENT") console.error(`Não foi possível ler ${path.basename(file)}:`, error.message);
    return fallback;
  }
}

function logConnection(event, fields = {}) {
  void appendConnectionLog(connectionLogFile(), { event, ...fields }).catch(() => {
    console.warn("Não foi possível gravar o registro de conexões.");
  });
}

function encryptTokens(tokens) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("O armazenamento seguro do Windows não está disponível.");
  return safeStorage.encryptString(JSON.stringify(tokens)).toString("base64");
}

function decryptTokens(value) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("O armazenamento seguro do Windows não está disponível.");
  return JSON.parse(safeStorage.decryptString(Buffer.from(value, "base64")));
}

async function saveSettings() {
  await writeJson(settingsFile(), { preferences });
}

async function saveChannels() {
  await writeJson(channelsFile(), channels);
}

async function saveAccounts() {
  await writeJson(accountsFile(), accounts.map((account) => ({
    id: account.id,
    login: account.login,
    displayName: account.displayName,
    avatar: account.avatar || "",
    clientId: account.clientId || clientId,
    encryptedTokens: encryptTokens({ accessToken: account.accessToken, refreshToken: account.refreshToken, expiresAt: account.expiresAt })
  })));
}

async function loadData() {
  const savedSettings = await readJson(settingsFile(), {});
  clientId = TWITCH_CLIENT_ID;
  preferences = {
    minimizeToTray: savedSettings.preferences?.minimizeToTray === true,
    liveOnly: savedSettings.preferences?.liveOnly !== false
  };
  const savedChannels = await readJson(channelsFile(), null);
  channels = Array.isArray(savedChannels)
    ? savedChannels.filter((item) => item && CHANNEL_PATTERN.test(item.name || "")).map(({ name }) => ({ name }))
    : DEFAULT_CHANNELS.map((name) => ({ name }));
  const savedAccounts = await readJson(accountsFile(), []);
  accounts = [];
  for (const item of Array.isArray(savedAccounts) ? savedAccounts : []) {
    if (!item || typeof item.id !== "string" || typeof item.encryptedTokens !== "string") continue;
    try {
      const account = { id: item.id, login: item.login || "", displayName: item.displayName || item.login || "", avatar: item.avatar || "", clientId: item.clientId || clientId, ...decryptTokens(item.encryptedTokens) };
      if (account.clientId !== clientId) {
        account.needsLogin = true;
        accountStates.set(account.id, { state: "authentication-error", detail: "O cadastro Twitch do app foi atualizado. Use + para autorizar esta conta novamente.", joinedChannels: [] });
      }
      accounts.push(account);
    } catch (error) {
      console.error("Uma sessão Twitch não pôde ser descriptografada; será necessário autenticar novamente.", error.message);
      accounts.push({ id: item.id, login: item.login || "", displayName: item.displayName || item.login || "", avatar: item.avatar || "", clientId: item.clientId || clientId, accessToken: "", refreshToken: "", expiresAt: 0, needsLogin: true });
    }
  }
}

function safeAccountState(accountId) {
  return accountStates.get(accountId) || { state: "stopped", detail: "Conexão parada.", joinedChannels: [] };
}

function priorityOrderedChannels() {
  return channels
    .map((channel, index) => ({ channel, index }))
    .sort((a, b) => {
      const aLive = liveStates.get(a.channel.name.toLowerCase())?.liveStatus === "live";
      const bLive = liveStates.get(b.channel.name.toLowerCase())?.liveStatus === "live";
      return Number(bLive) - Number(aLive) || a.index - b.index;
    })
    .map(({ channel }) => channel);
}

function targetChannels() {
  const ordered = priorityOrderedChannels();
  const eligible = preferences.liveOnly
    ? ordered.filter(({ name }) => liveStates.get(name.toLowerCase())?.liveStatus === "live")
    : ordered;
  return eligible.slice(0, MAX_CHANNELS_PER_ACCOUNT).map(({ name }) => name.toLowerCase());
}

function publicState() {
  const desired = targetChannels();
  return {
    version: app.getVersion(),
    diagnostic: { ...diagnostic, results: diagnostic.results.map((result) => ({ ...result })) },
    channels: priorityOrderedChannels().map(({ name }) => {
      const live = liveStates.get(name.toLowerCase()) || { liveStatus: "unchecked", liveDetail: "", checkedAt: null };
      return {
        name,
        ...live,
        accountStates: accounts.map((account) => {
          const state = safeAccountState(account.id);
          const joined = state.joinedChannels.includes(name.toLowerCase());
          const target = desired.includes(name.toLowerCase());
          return { id: account.id, login: account.login, state: !running ? "stopped" : joined ? "joined" : target ? state.state : "waiting", detail: state.detail || "" };
        })
      };
    }),
    accounts: accounts.map((account) => {
      const state = safeAccountState(account.id);
      return {
        id: account.id,
        login: account.login,
        displayName: account.displayName,
        avatar: account.avatar || "",
        authenticated: !account.needsLogin && !account.configurationError && Boolean(account.accessToken),
        connectionState: running || ["authentication-error", "configuration-error", "reconnecting"].includes(state.state) ? state.state : "stopped",
        detail: state.detail,
        joinedChannels: state.joinedChannels,
        targetChannels: running ? desired.length : 0
      };
    }),
    pendingLogins: [...pendingLogins.values()].map(({ id, userCode, verificationUri, expiresAt }) => ({ id, userCode, verificationUri, expiresAt })),
    message: uiMessage,
    running,
    runtimeMetrics: { ...runtimeMetrics, joinedCount: [...accountStates.values()].reduce((total, state) => total + state.joinedChannels.length, 0) },
    preferences: { ...preferences },
    liveCheckedAt: [...liveStates.values()].reduce((latest, item) => item.checkedAt && (!latest || item.checkedAt > latest) ? item.checkedAt : latest, null)
  };
}

function compareVersions(left, right) {
  const parse = (value) => String(value).replace(/^v/i, "").split(".").map((part) => Number.parseInt(part, 10));
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0);
  }
  return 0;
}

async function getLatestRelease() {
  const response = await fetch(GITHUB_RELEASES_API, {
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "IdleChats-IRC-V2" },
    signal: AbortSignal.timeout(10_000)
  });
  if (response.status === 404) return { currentVersion: app.getVersion(), latestVersion: null, updateAvailable: false, releaseExists: false };
  if (!response.ok) throw new Error(`GitHub respondeu HTTP ${response.status}.`);
  const release = await response.json();
  const match = typeof release.tag_name === "string" && release.tag_name.match(/^v?(\d+)\.(\d+)\.(\d+)$/i);
  const releaseUrl = typeof release.html_url === "string" ? new URL(release.html_url) : null;
  if (!match || releaseUrl?.origin !== "https://github.com" || releaseUrl.pathname !== "/v-lobo/idlechats-irc-v2/releases/tag/" + release.tag_name) {
    throw new Error("A versão mais recente do GitHub tem dados inválidos.");
  }
  const latestVersion = `${match[1]}.${match[2]}.${match[3]}`;
  return {
    currentVersion: app.getVersion(),
    latestVersion,
    updateAvailable: compareVersions(latestVersion, app.getVersion()) > 0,
    releaseExists: true
  };
}

function sampleRuntimeMetrics() {
  const processes = app.getAppMetrics();
  const privateKb = processes.reduce((sum, process) => sum + (process.memory?.privateBytes ?? 0), 0);
  const hasPrivateBytes = processes.some((process) => Number.isFinite(process.memory?.privateBytes));
  const cpuPercent = processes.reduce((sum, process) => sum + (process.cpu?.percentCPUUsage || 0), 0);
  const joinedCount = [...accountStates.values()].reduce((sum, state) => sum + state.joinedChannels.length, 0);
  runtimeMetrics = {
    privateMb: hasPrivateBytes ? Math.round(privateKb / 1024) : null,
    cpuPercent: Math.round(cpuPercent * 10) / 10,
    processCount: processes.length,
    joinedCount
  };
  broadcastState();
}

function broadcastState() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("app-state", publicState());
  updateTrayMenu();
}

function setAccountState(id, next) {
  const previous = safeAccountState(id);
  accountStates.set(id, { ...safeAccountState(id), ...next });
  if (next.state && (previous.state !== next.state || previous.detail !== next.detail)) {
    logConnection("account-state", { account: accounts.find((item) => item.id === id)?.login, state: next.state, reason: next.reason || next.state });
  }
  broadcastState();
}

function desiredChannelsFor(accountId) {
  const account = accounts.find((item) => item.id === accountId);
  if (!running || !account || account.needsLogin || account.configurationError || !account.accessToken) return [];
  return targetChannels();
}

function attachClient(account) {
  if (isQuitting || !running || !account?.accessToken || !accounts.includes(account) || account.needsLogin || account.configurationError || account.refreshing) return;
  if (account.tokenRejected || account.expiresAt <= Date.now()) {
    if (!account.refreshTimer) void renewAccountToken(account.id);
    return;
  }
  const existing = clients.get(account.id);
  clients.delete(account.id);
  if (existing) existing.disconnect();
  const client = new TwitchIrcClient({ login: account.login, accessToken: account.accessToken });
  clients.set(account.id, client);
  client.on("status", ({ state, detail, reason }) => {
    if (clients.get(account.id) !== client) return;
    setAccountState(account.id, { state, detail, reason, joinedChannels: [...client.joinedChannels] });
  });
  client.on("joined", (channel) => {
    if (clients.get(account.id) !== client) return;
    const current = safeAccountState(account.id);
    setAccountState(account.id, { state: "connected", joinedChannels: [...new Set([...current.joinedChannels, channel])] });
  });
  client.on("parted", (channel) => {
    if (clients.get(account.id) !== client) return;
    const current = safeAccountState(account.id);
    setAccountState(account.id, { joinedChannels: current.joinedChannels.filter((item) => item !== channel) });
  });
  client.on("authentication-error", (detail) => {
    if (clients.get(account.id) !== client) return;
    clients.delete(account.id);
    client.disconnect();
    account.tokenRejected = true;
    clearTimeout(account.refreshTimer);
    account.refreshTimer = null;
    setAccountState(account.id, { state: "reconnecting", reason: "irc-token-rejected", detail: `${detail} Renovando a sessão…`, joinedChannels: [] });
    void renewAccountToken(account.id);
  });
  client.setDesiredChannels(desiredChannelsFor(account.id));
  client.connect();
  scheduleTokenRefresh(account.id);
}

function scheduleTokenRefresh(accountId, delayOverride) {
  const account = accounts.find((item) => item.id === accountId);
  if (isQuitting || !account || !account.expiresAt || account.configurationError || account.needsLogin) return;
  clearTimeout(account.refreshTimer);
  const delay = Number.isFinite(delayOverride)
    ? Math.max(5_000, delayOverride)
    : Math.max(20_000, account.expiresAt - Date.now() - 5 * 60_000);
  account.refreshTimer = setTimeout(() => {
    account.refreshTimer = null;
    void renewAccountToken(accountId);
  }, delay);
  account.refreshTimer.unref?.();
}

function requiresUserAuthorization(error) {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  return code === "missing_scopes"
    || /^http_40[013]$/.test(code)
    || /invalid refresh token|invalid_grant|revoked|unauthorized/.test(`${code} ${message}`);
}

function pauseForClientConfiguration(account) {
  account.configurationError = true;
  clearTimeout(account.refreshTimer);
  account.refreshTimer = null;
  const client = clients.get(account.id);
  clients.delete(account.id);
  client?.disconnect();
  setAccountState(account.id, {
    state: "configuration-error", reason: "oauth-client-configuration", joinedChannels: [],
    detail: "O cadastro Twitch do app exige Client Secret. O responsável pelo IdleChats precisa usar Client Type Public e publicar o Client ID correto."
  });
}

async function renewAccountToken(accountId) {
  const account = accounts.find((item) => item.id === accountId);
  if (!account || !account.refreshToken || account.needsLogin || account.configurationError || account.refreshing) return;
  account.refreshing = true;
  try {
    const tokens = await refreshToken(account.clientId || clientId, account.refreshToken);
    if (!accounts.includes(account)) return;
    if (!tokens.access_token) throw new Error("Resposta de renovação sem token de acesso.");
    account.accessToken = tokens.access_token;
    account.refreshToken = tokens.refresh_token || account.refreshToken;
    account.expiresAt = Date.now() + (Number(tokens.expires_in) || 14_400) * 1000;
    account.needsLogin = false;
    account.tokenRejected = false;
    account.refreshAttempts = 0;
    let saved = true;
    try { await saveAccounts(); }
    catch {
      saved = false;
      logConnection("credentials-save-failed", { account: account.login });
      uiMessage = "A sessão foi renovada, mas não pôde ser salva no disco.";
    }
    logConnection("token-refreshed", { account: account.login, reason: saved ? "saved" : "not-saved" });
    account.refreshing = false;
    if (running) attachClient(account);
    else {
      setAccountState(accountId, { state: "stopped", detail: "Sessão renovada.", joinedChannels: [] });
      scheduleTokenRefresh(accountId);
    }
    return { renewed: true, saved };
  } catch (error) {
    if (!accounts.includes(account)) return;
    if (isClientConfigurationError(error)) {
      pauseForClientConfiguration(account);
    } else if (requiresUserAuthorization(error)) {
      account.needsLogin = true;
      clearTimeout(account.refreshTimer);
      const client = clients.get(accountId);
      client?.disconnect();
      clients.delete(accountId);
      setAccountState(accountId, { state: "authentication-error", reason: "oauth-session-invalid", detail: `A Twitch invalidou a sessão. Reconecte esta conta. (${error.message})`, joinedChannels: [] });
    } else {
      account.refreshAttempts = (account.refreshAttempts || 0) + 1;
      const delay = Math.min(5 * 60_000, 15_000 * (2 ** Math.min(account.refreshAttempts - 1, 4)));
      scheduleTokenRefresh(accountId, delay);
      logConnection("token-refresh-retry", { account: account.login });
      const currentClient = clients.get(accountId);
      if (!currentClient?.ready) setAccountState(accountId, {
        state: "reconnecting", reason: "oauth-refresh-retry",
        detail: `Falha temporária ao renovar a sessão. Nova tentativa em ${Math.round(delay / 1000)}s. (${error.message})`,
        joinedChannels: currentClient ? [...currentClient.joinedChannels] : []
      });
    }
  } finally {
    account.refreshing = false;
  }
}

function waitForChatRecovery(account, expectedChannels) {
  return new Promise((resolve) => {
    const finish = (result) => {
      clearInterval(interval);
      clearTimeout(timeout);
      resolve(result);
    };
    const check = () => {
      if (!running || isQuitting || !accounts.includes(account)) return finish({ status: "inconclusive", detail: "Teste interrompido." });
      if (account.needsLogin || account.configurationError) return finish({ status: "failed", detail: safeAccountState(account.id).detail });
      const currentTargets = targetChannels();
      if (currentTargets.length !== expectedChannels.length || currentTargets.some((channel) => !expectedChannels.includes(channel))) {
        return finish({ status: "inconclusive", detail: "Os canais selecionados mudaram durante o teste. Tente novamente." });
      }
      const client = clients.get(account.id);
      if (client?.ready && expectedChannels.every((channel) => client.joinedChannels.has(channel))) {
        finish({ status: "passed", detail: `${expectedChannels.length} JOIN(s) confirmado(s).` });
      }
    };
    const interval = setInterval(check, 500);
    const timeout = setTimeout(() => finish({ status: "failed", detail: "Os chats não foram confirmados em 60s. Consulte connections.log." }), 60_000);
    interval.unref?.();
    timeout.unref?.();
    check();
  });
}

async function runConnectionTest(kind) {
  if (!["renewal", "reconnect"].includes(kind)) throw new Error("Teste de conexão inválido.");
  if (diagnostic.busy) throw new Error("Já existe um teste em andamento.");
  if (!running) throw new Error("Inicie o IRC antes de testar.");
  if (!accounts.length) throw new Error("Conecte uma conta Twitch antes de testar.");
  if (accounts.some((account) => account.refreshing)) throw new Error("Aguarde a renovação em andamento e tente novamente.");
  if (liveCheckBusy) throw new Error("Aguarde a consulta dos canais terminar e tente novamente.");
  const expectedChannels = targetChannels();
  if (!expectedChannels.length) throw new Error("É necessário ter ao menos um canal selecionado para confirmar a volta aos chats.");
  const selectedAccounts = [...accounts];
  diagnostic = {
    busy: true, summary: kind === "renewal" ? "Renovando sessões e confirmando os chats…" : "Reconectando IRC e confirmando os chats…",
    results: selectedAccounts.map((account) => ({ id: account.id, login: account.login, status: "running", detail: "Aguardando…" }))
  };
  const setResult = (account, result) => {
    Object.assign(diagnostic.results.find((row) => row.id === account.id), result);
    broadcastState();
  };
  logConnection("diagnostic-start", { reason: kind });
  broadcastState();
  try {
    await Promise.all(selectedAccounts.map(async (account) => {
      try {
        if (account.needsLogin || account.configurationError || !account.accessToken) {
          return setResult(account, { status: "failed", detail: safeAccountState(account.id).detail || "Autorize esta conta novamente." });
        }
        if (kind === "renewal") {
          setResult(account, { status: "running", detail: "Renovando e salvando a sessão…" });
          const renewal = await renewAccountToken(account.id);
          if (!renewal?.renewed || !renewal.saved) {
            return setResult(account, { status: "failed", detail: renewal?.renewed ? "A sessão foi renovada, mas não foi salva no disco." : safeAccountState(account.id).detail || "Não foi possível renovar a sessão." });
          }
          const validation = await validateToken(account.accessToken);
          ensureChatScopes(validation.scopes);
          if (!Number.isFinite(validation.expires_in) || validation.expires_in <= 0) throw new Error("A sessão renovada não tem validade confirmada.");
          if (validation.client_id !== (account.clientId || clientId)) throw new Error("A sessão pertence a outro cadastro Twitch.");
        } else {
          const client = clients.get(account.id);
          if (!client) return setResult(account, { status: "failed", detail: "Esta conta não tem conexão IRC para reiniciar." });
          client.reconnect("Teste manual de reconexão IRC.");
        }
        setResult(account, { status: "running", detail: "Confirmando a volta aos chats…" });
        const recovery = await waitForChatRecovery(account, expectedChannels);
        if (kind === "renewal" && recovery.status === "passed") recovery.detail = `Sessão renovada, salva e validada. ${recovery.detail}`;
        setResult(account, recovery);
      } catch (error) {
        setResult(account, { status: "failed", detail: error.message || "Não foi possível concluir o teste." });
      }
    }));
    const passed = diagnostic.results.filter((result) => result.status === "passed").length;
    diagnostic.summary = `${passed} de ${selectedAccounts.length} conta(s) passaram no teste de ${kind === "renewal" ? "renovação" : "reconexão"}.`;
    logConnection("diagnostic-complete", { reason: `${kind}-${passed}-of-${selectedAccounts.length}` });
  } finally {
    diagnostic.busy = false;
    broadcastState();
  }
  return publicState();
}

function syncClients() {
  if (!running) return;
  for (const account of accounts) {
    if (account.needsLogin || account.configurationError || !account.accessToken || account.refreshing) continue;
    const client = clients.get(account.id);
    if (client) client.setDesiredChannels(desiredChannelsFor(account.id));
    else attachClient(account);
  }
}

function recoverConnections(reason) {
  if (isQuitting || !running || Date.now() - lastConnectionRecoveryAt < 10_000) return;
  lastConnectionRecoveryAt = Date.now();
  logConnection("connection-recovery", { reason });
  for (const account of accounts) {
    if (account.needsLogin || account.configurationError || !account.accessToken || account.refreshing) continue;
    if (account.tokenRejected || account.expiresAt <= Date.now() + 60_000) {
      clearTimeout(account.refreshTimer);
      account.refreshTimer = null;
      void renewAccountToken(account.id);
    } else {
      const client = clients.get(account.id);
      if (client) client.reconnect("Retomando a conexão após suspensão ou retorno da rede.");
      else attachClient(account);
    }
  }
  void checkChannelsOnline();
}

async function requestChannelStatus(name) {
  const key = name.toLowerCase();
  const previous = liveStates.get(key) || { liveStatus: "unchecked", liveDetail: "", checkedAt: null };
  liveStates.set(key, { ...previous, liveStatus: "checking", liveDetail: "Consultando status…" });
  broadcastState();
  try {
    const response = await fetch(`https://decapi.me/twitch/uptime/${encodeURIComponent(name)}`, {
      headers: { accept: "text/plain" }, signal: AbortSignal.timeout(12_000)
    });
    const text = (await response.text()).trim();
    if (!response.ok || !text) throw new Error(`HTTP ${response.status || "sem resposta"}`);
    const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    let liveStatus = "unavailable";
    let liveDetail = "Resposta não reconhecida pelo verificador.";
    if (/\boffline\b|\best[aá] offline\b/.test(normalized)) {
      liveStatus = "offline";
      liveDetail = "O verificador informa offline.";
    } else if (/\blive\b|\bao vivo\b|\bh[aá]\s+\d/.test(normalized)
      || /\b\d+(?:\.\d+)?\s*(?:seconds?|minutes?|hours?|days?|weeks?)\b/.test(normalized)) {
      liveStatus = "live";
      liveDetail = text;
    } else if (/not found|not exist|nao existe|nao encontrado|invalid channel/.test(normalized)) {
      liveDetail = "Canal não localizado.";
    } else liveDetail = text.slice(0, 180);
    liveStates.set(key, { liveStatus, liveDetail, checkedAt: new Date().toISOString() });
  } catch (error) {
    liveStates.set(key, { liveStatus: previous.liveStatus === "live" ? "live" : "unavailable", liveDetail: `Não foi possível consultar: ${error.message}`, checkedAt: new Date().toISOString() });
  }
  broadcastState();
}

async function checkChannelsOnline() {
  if (liveCheckBusy || !channels.length) return publicState();
  liveCheckBusy = true;
  try {
    for (let i = 0; i < channels.length; i += 5) {
      await Promise.all(channels.slice(i, i + 5).map(({ name }) => requestChannelStatus(name)));
      if (i + 5 < channels.length) await new Promise((resolve) => setTimeout(resolve, 300));
    }
  } finally {
    liveCheckBusy = false;
    syncClients();
    broadcastState();
  }
  return publicState();
}

function startLiveChecks() {
  clearInterval(liveCheckTimer);
  liveCheckTimer = setInterval(() => { void checkChannelsOnline(); }, LIVE_CHECK_INTERVAL_MS);
  liveCheckTimer.unref?.();
  if (channels.length) void checkChannelsOnline();
}

function startChats() {
  if (running) return publicState();
  running = true;
  syncClients();
  if (preferences.liveOnly && channels.some(({ name }) => !liveStates.get(name.toLowerCase())?.checkedAt)) void checkChannelsOnline();
  broadcastState();
  return publicState();
}

function stopChats() {
  running = false;
  for (const [id, client] of clients) {
    client.disconnect();
    accountStates.set(id, { state: "stopped", detail: "Conexão parada.", joinedChannels: [] });
  }
  clients.clear();
  broadcastState();
  return publicState();
}

function toggleChats() { return running ? stopChats() : startChats(); }

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function hideMainWindow() { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide(); }

function updateTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Abrir IdleChats IRC", click: showMainWindow },
    { label: running ? "Parar conexões IRC" : "Iniciar conexões IRC", enabled: accounts.some((item) => item.accessToken) && channels.length > 0, click: toggleChats },
    { type: "separator" },
    { label: "Sair", click: () => { isQuitting = true; app.quit(); } }
  ]));
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, "tray.png")));
  tray.setToolTip("IdleChats IRC · Twitch");
  tray.on("click", showMainWindow);
  tray.on("double-click", showMainWindow);
  updateTrayMenu();
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 507, height: 613, minWidth: 420, minHeight: 480, resizable: true,
    title: "IdleChats IRC V2", backgroundColor: "#f8f7fb",
    webPreferences: { preload: path.join(__dirname, "irc-preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  mainWindow.loadFile(path.join(__dirname, "irc.html"));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.on("minimize", () => { if (preferences.minimizeToTray) hideMainWindow(); });
  mainWindow.on("close", (event) => { if (preferences.minimizeToTray && !isQuitting) { event.preventDefault(); hideMainWindow(); } });
  mainWindow.on("closed", () => { mainWindow = null; });
}

function wait(ms, pending) {
  return new Promise((resolve) => {
    const finish = () => {
      pending.timer = null;
      pending.finishWait = null;
      resolve();
    };
    pending.finishWait = finish;
    pending.timer = setTimeout(finish, ms);
    pending.timer.unref?.();
  });
}

async function startAccountLogin() {
  const normalizedClientId = validateClientId(clientId);
  const device = await requestDeviceCode(normalizedClientId);
  const id = randomUUID();
  const pending = { id, ...device, cancelled: false, timer: null };
  pendingLogins.set(id, pending);
  const verificationUrl = new URL(device.verificationUri);
  if (verificationUrl.protocol !== "https:" || verificationUrl.hostname !== "www.twitch.tv") {
    pendingLogins.delete(id);
    throw new Error("A Twitch retornou um endereço de ativação inesperado.");
  }
  try { await shell.openExternal(verificationUrl.toString()); }
  catch (error) { pendingLogins.delete(id); throw new Error(`Não foi possível abrir a página da Twitch: ${error.message}`); }
  uiMessage = "Aguardando a autorização da Twitch no navegador…";
  broadcastState();
  void pollAccountLogin(pending);
  return publicState();
}

async function pollAccountLogin(pending) {
  let interval = pending.intervalMs;
  try {
    while (!pending.cancelled && Date.now() < pending.expiresAt) {
      await wait(interval, pending);
      if (pending.cancelled) return;
      try {
        const issuedTokens = await pollDeviceToken(pending.clientId, pending.deviceCode);
        if (!issuedTokens.refresh_token || !issuedTokens.access_token) throw new Error("A Twitch não retornou os tokens necessários para manter a sessão.");
        // Confirm renewable authorization before saving; the activation URL alone
        // does not reliably indicate whether the Twitch registration is Public.
        let tokens;
        try { tokens = await refreshToken(pending.clientId, issuedTokens.refresh_token); }
        catch (error) {
          if (isClientConfigurationError(error)) throw new Error("O cadastro Twitch do IdleChats precisa ter Client Type Public para renovar sessões. O responsável pelo app deve corrigir o Client ID integrado.");
          throw error;
        }
        const validation = await validateToken(tokens.access_token);
        ensureChatScopes(validation.scopes);
        if (!tokens.refresh_token || !tokens.access_token) throw new Error("A Twitch não retornou os tokens necessários para manter a sessão.");
        let profile = {};
        try { profile = await getUserProfile(pending.clientId, tokens.access_token); }
        catch (error) { console.warn("Não foi possível carregar o perfil Twitch:", error.message); }
        const login = String(profile.login || validation.login || "").toLowerCase();
        if (!CHANNEL_PATTERN.test(login)) throw new Error("A Twitch não retornou um nome de conta válido.");
        const duplicate = accounts.find((item) => item.login.toLowerCase() === login);
        if (duplicate) {
          duplicate.clientId = pending.clientId;
          duplicate.displayName = profile.displayName || duplicate.displayName || login;
          duplicate.avatar = profile.avatar || duplicate.avatar || "";
          duplicate.accessToken = tokens.access_token;
          duplicate.refreshToken = tokens.refresh_token;
          duplicate.expiresAt = Date.now() + (Number(tokens.expires_in) || 14_400) * 1000;
          duplicate.needsLogin = false;
          duplicate.configurationError = false;
          duplicate.tokenRejected = false;
          duplicate.refreshAttempts = 0;
        } else {
          accounts.push({ id: randomUUID(), login, displayName: profile.displayName || login, avatar: profile.avatar || "", clientId: pending.clientId, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: Date.now() + (Number(tokens.expires_in) || 14_400) * 1000 });
        }
        await saveAccounts();
        const linkedAccount = accounts.find((item) => item.login === login);
        scheduleTokenRefresh(linkedAccount?.id);
        pendingLogins.delete(pending.id);
        uiMessage = `Conta @${login} autorizada.`;
        if (running && linkedAccount) attachClient(linkedAccount);
        else if (linkedAccount) setAccountState(linkedAccount.id, { state: "stopped", reason: "authorized", detail: "Conta autorizada. Pronta para iniciar IRC.", joinedChannels: [] });
        broadcastState();
        return;
      } catch (error) {
        if (error.code === "authorization_pending") continue;
        if (error.code === "slow_down") { interval += 5000; continue; }
        if (error.code === "access_denied" || error.code === "expired_token") throw new Error("Autorização recusada ou expirada.");
        throw error;
      }
    }
    if (!pending.cancelled) throw new Error("O código de autorização expirou. Tente novamente.");
  } catch (error) {
    if (!pending.cancelled) uiMessage = error.message;
  } finally {
    if (pending.timer) clearTimeout(pending.timer);
    pendingLogins.delete(pending.id);
    broadcastState();
  }
}

function cancelAccountLogin(id) {
  const pending = pendingLogins.get(id);
  if (pending) {
    pending.cancelled = true;
    if (pending.timer) clearTimeout(pending.timer);
    pending.finishWait?.();
    pendingLogins.delete(id);
  }
  broadcastState();
  return publicState();
}

async function restoreAccounts() {
  for (const account of accounts) {
    if (account.needsLogin) continue;
    if (!account.accessToken || !account.refreshToken) { account.needsLogin = true; continue; }
    try {
      let validation;
      try { validation = await validateToken(account.accessToken); }
      catch (error) {
        if (error.code !== "http_401") throw error;
        const tokens = await refreshToken(account.clientId || clientId, account.refreshToken);
        account.accessToken = tokens.access_token;
        account.refreshToken = tokens.refresh_token;
        account.expiresAt = Date.now() + (Number(tokens.expires_in) || 14_400) * 1000;
        validation = await validateToken(account.accessToken);
        await saveAccounts();
      }
      ensureChatScopes(validation.scopes);
      try {
        const profile = await getUserProfile(account.clientId || clientId, account.accessToken);
        account.login = profile.login || account.login;
        account.displayName = profile.displayName || account.login;
        account.avatar = profile.avatar || account.avatar || "";
      } catch (error) {
        console.warn(`Não foi possível carregar o perfil Twitch de @${account.login}:`, error.message);
        account.login = String(validation.login || account.login).toLowerCase();
        account.displayName ||= account.login;
      }
      account.expiresAt = Date.now() + (Number(validation.expires_in) || 14_400) * 1000;
      account.needsLogin = false;
      await saveAccounts();
      scheduleTokenRefresh(account.id);
    } catch (error) {
      if (isClientConfigurationError(error)) {
        pauseForClientConfiguration(account);
      } else if (requiresUserAuthorization(error)) {
        account.needsLogin = true;
        accountStates.set(account.id, { state: "authentication-error", detail: `Reconecte esta conta Twitch. ${error.message}`, joinedChannels: [] });
      } else {
        account.needsLogin = false;
        accountStates.set(account.id, { state: "reconnecting", detail: `Falha temporária ao verificar sessão; o app tentará renovar novamente. (${error.message})`, joinedChannels: [] });
        scheduleTokenRefresh(account.id, 30_000);
      }
    }
  }
  broadcastState();
}

ipcMain.handle("get-state", () => publicState());
ipcMain.handle("test-connections", (_event, kind) => runConnectionTest(kind));
ipcMain.handle("network-restored", () => recoverConnections("network-online"));
ipcMain.handle("check-for-updates", () => getLatestRelease());
ipcMain.handle("open-latest-release", async () => {
  const release = await getLatestRelease();
  if (!release.releaseExists) throw new Error("Ainda não há uma versão publicada no GitHub.");
  if (!release.updateAvailable) throw new Error("Este app já está na versão mais recente.");
  await shell.openExternal(`https://github.com/v-lobo/idlechats-irc-v2/releases/tag/v${release.latestVersion}`);
  return release;
});
ipcMain.handle("begin-login", startAccountLogin);
ipcMain.handle("cancel-login", (_event, id) => cancelAccountLogin(id));
ipcMain.handle("remove-account", async (_event, id) => {
  const client = clients.get(id);
  client?.disconnect();
  clients.delete(id);
  const account = accounts.find((item) => item.id === id);
  clearTimeout(account?.refreshTimer);
  accounts = accounts.filter((item) => item.id !== id);
  accountStates.delete(id);
  await saveAccounts();
  broadcastState();
  return publicState();
});
ipcMain.handle("add-channel", async (_event, value) => {
  const name = String(value || "").trim().replace(/^[@#]/, "");
  if (!CHANNEL_PATTERN.test(name)) throw new Error("Use letras, números ou sublinhado (até 25 caracteres).");
  if (channels.some((item) => item.name.toLowerCase() === name.toLowerCase())) throw new Error("Este canal já está cadastrado.");
  channels.push({ name });
  await saveChannels();
  syncClients();
  void checkChannelsOnline();
  broadcastState();
  return publicState();
});
ipcMain.handle("remove-channel", async (_event, name) => {
  channels = channels.filter((item) => item.name.toLowerCase() !== String(name).toLowerCase());
  liveStates.delete(String(name).toLowerCase());
  await saveChannels();
  syncClients();
  broadcastState();
  return publicState();
});
ipcMain.handle("toggle-chats", () => toggleChats());
ipcMain.handle("check-online", () => checkChannelsOnline());
ipcMain.handle("set-minimize-to-tray", async (_event, value) => {
  preferences.minimizeToTray = Boolean(value);
  await saveSettings();
  broadcastState();
  return publicState();
});
ipcMain.handle("set-live-only", async (_event, value) => {
  preferences.liveOnly = Boolean(value);
  await saveSettings();
  syncClients();
  broadcastState();
  return publicState();
});

if (hasSingleInstanceLock) app.whenReady().then(async () => {
  await loadData();
  if (!safeStorage.isEncryptionAvailable()) throw new Error("A criptografia local do Windows está indisponível; as contas não serão carregadas.");
  createMainWindow();
  createTray();
  logConnection("app-start", { reason: app.getVersion() });
  powerMonitor.on("suspend", () => logConnection("system-suspend"));
  powerMonitor.on("resume", () => recoverConnections("system-resume"));
  sampleRuntimeMetrics();
  metricsTimer = setInterval(sampleRuntimeMetrics, 30_000);
  metricsTimer.unref?.();
  startLiveChecks();
  await restoreAccounts();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); else showMainWindow(); });
}).catch((error) => {
  console.error("Falha ao iniciar IdleChats IRC V2:", error);
  app.quit();
});

app.on("before-quit", () => {
  isQuitting = true;
  clearInterval(liveCheckTimer);
  clearInterval(metricsTimer);
  for (const account of accounts) clearTimeout(account.refreshTimer);
  logConnection("app-stop");
  for (const pending of pendingLogins.values()) {
    pending.cancelled = true;
    if (pending.timer) clearTimeout(pending.timer);
  }
  stopChats();
});

app.on("second-instance", showMainWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
