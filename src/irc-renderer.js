"use strict";

const channelManagers = ["pokeidleworld", "pokedream"].map((groupId) => {
  const suffix = groupId === "pokedream" ? "-pokedream" : "";
  const element = (id) => document.querySelector(`#${id}${suffix}`);
  return {
    groupId, form: element("channel-form"), input: element("channel-input"),
    list: element("channel-list"), count: element("channel-count"),
    emptyState: element("empty-state"),
    accountList: element("group-account-list"), accountCount: element("group-account-count"),
    liveUpdated: element("live-updated"),
    settingsButton: element("group-settings"), settings: element("channels-section"),
    limitForm: element("limit-form"), limitInput: element("channel-limit"), limitFeedback: element("limit-feedback")
  };
});
const toggleButton = document.querySelector("#toggle-button");
const addAccountButton = document.querySelector("#add-account");
const accountList = document.querySelector("#account-list");
const accountCount = document.querySelector("#account-count");
const pendingList = document.querySelector("#pending-list");
const accountSummary = document.querySelector("#account-summary");
const accountsSection = document.querySelector("#accounts-section");
const accountsPanel = document.querySelector(".accounts-panel");
const liveOnlySetting = document.querySelector("#live-only");
const traySetting = document.querySelector("#minimize-to-tray");
const checkLiveButton = document.querySelector("#check-live");
const lastChecked = document.querySelector("#last-checked");
const expandedChannels = new Set();
const subhead = document.querySelector("#subhead");
const globalStatus = document.querySelector("#global-status");
const notice = document.querySelector("#notice");
const connectionIndicator = document.querySelector("#connection-indicator");
const runtimeMetrics = document.querySelector("#runtime-metrics");
const appVersion = document.querySelector("#app-version");
const checkUpdatesButton = document.querySelector("#app-version");
const updateStatus = document.querySelector("#update-status");
const testRenewalButton = document.querySelector("#test-renewal");
const testReconnectButton = document.querySelector("#test-reconnect");
const diagnosticSummary = document.querySelector("#diagnostic-summary");
const diagnosticResults = document.querySelector("#diagnostic-results");
let state = { channels: [], accounts: [], pendingLogins: [], running: false, preferences: {} };
let updateAvailable = false;
let versionVerified = false;

window.history.scrollRestoration = "manual";
window.addEventListener("load", () => window.scrollTo(0, 0), { once: true });
window.addEventListener("online", () => { void window.idleChats.networkRestored().catch(reportError); });
accountsSection.addEventListener("toggle", () => accountsPanel.classList.toggle("collapsed", !accountsSection.open));

function makeButton(text, className, handler, title = text) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  button.title = title;
  button.addEventListener("click", handler);
  return button;
}

function reportError(error) { notice.textContent = error?.message || String(error); }

function quantity(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatLive(channel) {
  if (channel.liveStatus === "live") return "AO VIVO";
  if (channel.liveStatus === "offline") return "OFFLINE";
  if (channel.liveStatus === "checking") return "VERIFICANDO";
  if (channel.liveStatus === "unavailable") return "INDISPONÍVEL";
  return "AGUARDANDO";
}

function formatAccountState(account) {
  if (account.connectionState === "configuration-error") return "Configuração Twitch";
  if (!account.authenticated) return "Precisa reconectar";
  if (account.connectionState === "connected") return quantity(account.joinedChannels.length, "presença");
  if (account.connectionState === "connecting") return "Conectando…";
  if (account.connectionState === "reconnecting") return "Reconectando…";
  if (account.connectionState === "authentication-error") return "Reconecte esta conta";
  return "Pronta";
}

function renderPending() {
  pendingList.replaceChildren();
  for (const pending of state.pendingLogins || []) {
    const row = document.createElement("div");
    row.className = "pending-row";
    const copy = document.createElement("div");
    copy.className = "pending-copy";
    const heading = document.createElement("strong");
    heading.textContent = `Código de autorização: ${pending.userCode}`;
    const detail = document.createElement("span");
    detail.textContent = `A página de ativação foi aberta no navegador. Expira às ${new Date(pending.expiresAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.`;
    copy.append(heading, detail);
    row.append(copy, makeButton("Cancelar", "quiet", async () => {
      try { state = await window.idleChats.cancelLogin(pending.id); render(); }
      catch (error) { reportError(error); }
    }));
    pendingList.append(row);
  }
}

function renderAccounts() {
  accountList.replaceChildren();
  const connected = state.accounts.filter((account) => account.authenticated && account.connectionState === "connected").length;
  const needsLogin = state.accounts.filter((account) => !account.authenticated).length;
  accountSummary.textContent = needsLogin ? `${needsLogin} para reconectar` : quantity(connected, "conectada");
  accountCount.textContent = String(state.accounts.length);
  accountsPanel.classList.toggle("collapsed", !accountsSection.open);
  for (const account of state.accounts) {
    const row = document.createElement("div");
    row.className = "account-card";
    const identity = document.createElement("div");
    identity.className = "account-identity";
    const avatar = document.createElement("img");
    avatar.className = "account-avatar";
    avatar.alt = "";
    avatar.src = account.avatar || "";
    avatar.hidden = !account.avatar;
    const placeholder = document.createElement("span");
    placeholder.className = "account-placeholder";
    placeholder.textContent = "T";
    placeholder.hidden = Boolean(account.avatar);
    avatar.addEventListener("error", () => { avatar.hidden = true; placeholder.hidden = false; });
    identity.append(avatar, placeholder);
    const copy = document.createElement("div");
    copy.className = "account-copy";
    const name = document.createElement("strong");
    name.textContent = account.login ? `@${account.login}` : account.displayName || "Conta Twitch";
    copy.append(name);
    identity.append(copy);
    const pill = document.createElement("span");
    pill.className = "state-pill";
    pill.dataset.state = account.connectionState;
    pill.textContent = !account.authenticated || state.running || account.connectionState === "reconnecting"
      ? formatAccountState(account)
      : "Pronta";
    pill.title = account.detail || pill.textContent;
    row.append(identity, pill, makeButton("×", "quiet remove", async () => {
      try { state = await window.idleChats.removeAccount(account.id); render(); }
      catch (error) { reportError(error); }
    }, `Remover @${account.login}`));
    accountList.append(row);
  }
}

function renderChannels() {
  const checking = state.channels.some((channel) => channel.liveStatus === "checking");
  checkLiveButton.disabled = !state.channels.length || checking;
  lastChecked.textContent = checking ? "Consultando…" : state.liveCheckedAt
    ? `Às ${new Date(state.liveCheckedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "A cada minuto";
  lastChecked.title = "Consulta automática a cada minuto";
  for (const manager of channelManagers) {
    const { groupId, count, emptyState, list, liveUpdated } = manager;
    const channels = state.channels.filter((channel) => channel.groupId === groupId);
    count.textContent = String(channels.length);
    emptyState.hidden = channels.length > 0;
    list.replaceChildren();
    const group = state.channelGroups?.find((item) => item.id === groupId);
    const activeIds = group?.activeAccountIds || state.accounts.map((account) => account.id);
    manager.accountCount.textContent = `${activeIds.length}/${state.accounts.length}`;
    manager.accountList.replaceChildren();
    if (!state.accounts.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "Adicione uma conta Twitch para configurar este grupo.";
      manager.accountList.append(empty);
    }
    for (const account of state.accounts) {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = activeIds.includes(account.id);
      checkbox.dataset.accountId = account.id;
      checkbox.addEventListener("change", async () => {
        checkbox.disabled = true;
        try { state = await window.idleChats.setGroupAccountActive(groupId, account.id, checkbox.checked); render(); }
        catch (error) { checkbox.checked = !checkbox.checked; reportError(error); }
        finally { checkbox.disabled = false; }
      });
      const name = document.createElement("span");
      name.textContent = `@${account.login || account.displayName || "conta"}`;
      label.append(checkbox, name);
      manager.accountList.append(label);
    }
    const online = channels.filter((channel) => channel.liveStatus === "live").length;
    liveUpdated.textContent = `${online} ao vivo · ${quantity(activeIds.length, "conta ativa", "contas ativas")}`;
    if (document.activeElement !== manager.limitInput && !manager.limitInput.dataset.edited) manager.limitInput.value = group?.maxChannels ?? (groupId === "pokedream" ? 1 : 5);
    for (const channel of channels) {
      const row = document.createElement("div");
      row.className = "channel-row";
      row.dataset.live = channel.liveStatus;
      const dot = document.createElement("i");
      dot.className = "live-dot";
      const copy = document.createElement("details");
      copy.className = "channel-copy";
      const key = `${groupId}:${channel.name.toLowerCase()}`;
      copy.open = expandedChannels.has(key);
      copy.addEventListener("toggle", () => { if (copy.isConnected) { if (copy.open) expandedChannels.add(key); else expandedChannels.delete(key); } });
      const summary = document.createElement("summary");
      const name = document.createElement("strong");
      name.textContent = `#${channel.name}`;
      const labels = { inactive: "inativa", joined: "presença confirmada", stopped: "parada", waiting: "aguardando", connected: "conectada", connecting: "conectando", reconnecting: "reconectando", "authentication-error": "reconecte a conta", "configuration-error": "erro de configuração" };
      const statuses = document.createElement("div");
      statuses.className = "channel-account-details";
      for (const account of channel.accountStates || []) {
        const status = document.createElement("p");
        status.textContent = `@${account.login}: ${labels[account.state] || account.state}`;
        status.title = account.detail || "";
        statuses.append(status);
      }
      if (!statuses.childElementCount) statuses.textContent = "Nenhuma conta cadastrada.";
      const detail = document.createElement("span");
      const joined = (channel.accountStates || []).filter((account) => account.state === "joined").length;
      detail.textContent = `${formatLive(channel).toLocaleLowerCase("pt-BR")} · ${quantity(joined, "presença")} ⌄`;
      detail.title = channel.liveDetail || "Expandir estados por conta";
      summary.append(name, detail);
      copy.append(summary, statuses);
      row.append(dot, copy, makeButton("×", "quiet remove", async () => {
        try { state = await window.idleChats.removeChannel(channel.name, groupId); render(); }
        catch (error) { reportError(error); }
      }, `Remover ${channel.name}`));
      list.append(row);
    }
  }
}

function render() {
  renderDiscord();
  if (!updateAvailable) appVersion.textContent = `v${state.version || "—"}${versionVerified ? " ✅" : ""}`;
  if (state.pendingLogins?.length) accountsSection.open = true;
  toggleButton.disabled = !state.running && (!state.channels.length || !state.accounts.some((account) => account.authenticated));
  toggleButton.textContent = state.running ? "Parar IRC" : "Iniciar IRC";
  const hasConnection = state.accounts.some((account) => account.authenticated && account.connectionState === "connected");
  const hasConfigurationError = state.accounts.some((account) => account.connectionState === "configuration-error");
  connectionIndicator.dataset.running = String(state.running && hasConnection);
  connectionIndicator.querySelector("span").textContent = hasConfigurationError && !hasConnection ? "IRC: configuração" : state.running ? hasConnection ? "IRC ativo" : "IRC reconectando…" : "IRC parado";
  const joined = state.accounts.reduce((total, account) => total + account.joinedChannels.length, 0);
  subhead.textContent = `${quantity(state.accounts.length, "conta")} · ${quantity(joined, "presença")}`;
  subhead.title = "Presenças confirmadas pelo IRC; o jogo pode levar alguns minutos para atualizar o bônus.";
  globalStatus.textContent = "";
  if (hasConfigurationError) globalStatus.textContent = "O cadastro Twitch do app precisa usar Client Type Public. Aguarde a correção do responsável pelo IdleChats.";
  else if (state.accounts.some((account) => account.connectionState === "authentication-error")) globalStatus.textContent = "Use + em Contas Twitch para autorizar novamente as contas indicadas.";
  if (state.message) notice.textContent = state.message;
  const metrics = state.runtimeMetrics || {};
  const memory = metrics.privateMb == null ? "medindo" : `${metrics.privateMb} MB privados`;
  const cpu = metrics.cpuPercent == null ? "medindo" : `${metrics.cpuPercent}%`;
  runtimeMetrics.textContent = `${memory} · CPU ${cpu} · ${metrics.joinedCount || 0} presenças IRC`;
  renderAccounts();
  renderPending();
  renderChannels();
  liveOnlySetting.checked = state.preferences.liveOnly !== false;
  traySetting.checked = state.preferences.minimizeToTray === true;
  const diagnostic = state.diagnostic || { busy: false, summary: "", results: [] };
  testRenewalButton.disabled = testReconnectButton.disabled = !state.running || diagnostic.busy;
  diagnosticSummary.textContent = diagnostic.summary;
  diagnosticResults.replaceChildren();
  for (const result of diagnostic.results) {
    const row = document.createElement("li");
    row.dataset.status = result.status;
    const label = { running: "Em andamento", passed: "Passou", failed: "Falhou", inconclusive: "Inconclusivo" }[result.status] || result.status;
    row.textContent = `@${result.login}: ${label} · ${result.detail}`;
    diagnosticResults.append(row);
  }
}

async function runDiagnostic(kind) {
  testRenewalButton.disabled = testReconnectButton.disabled = true;
  try { state = await window.idleChats.testConnections(kind); render(); }
  catch (error) { diagnosticSummary.textContent = error.message || String(error); }
  finally {
    testRenewalButton.disabled = testReconnectButton.disabled = !state.running || state.diagnostic?.busy === true;
  }
}
testRenewalButton.addEventListener("click", () => { void runDiagnostic("renewal"); });
testReconnectButton.addEventListener("click", () => { void runDiagnostic("reconnect"); });

for (const { groupId, form, input, settingsButton, settings, limitForm, limitInput, limitFeedback } of channelManagers) {
  settingsButton.addEventListener("click", () => {
    settings.open = !settings.open;
    settingsButton.setAttribute("aria-expanded", String(settings.open));
  });
  settings.addEventListener("toggle", () => settingsButton.setAttribute("aria-expanded", String(settings.open)));
  limitInput.addEventListener("input", () => { limitInput.dataset.edited = "true"; limitInput.setCustomValidity(""); limitFeedback.textContent = ""; });
  limitForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = limitForm.querySelector("button");
    button.disabled = true;
    limitFeedback.textContent = "";
    try {
      state = await window.idleChats.setGroupChannelLimit(groupId, Number(limitInput.value));
      delete limitInput.dataset.edited;
      limitFeedback.textContent = "Salvo";
      render();
    } catch (error) { limitFeedback.textContent = error.message || String(error); }
    finally { button.disabled = false; }
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      state = await window.idleChats.addChannel(input.value.trim(), groupId);
      input.value = "";
      render();
    } catch (error) { input.setCustomValidity(error.message); input.reportValidity(); }
  });
  input.addEventListener("input", () => input.setCustomValidity(""));
}
checkLiveButton.addEventListener("click", async () => {
    checkLiveButton.disabled = true;
    lastChecked.textContent = "Consultando…";
    try { state = await window.idleChats.checkOnline(); render(); }
    catch (error) { reportError(error); }
    finally { renderChannels(); }
  });

addAccountButton.addEventListener("click", async () => {
  notice.textContent = "";
  try { state = await window.idleChats.beginLogin(); render(); }
  catch (error) { reportError(error); }
});

toggleButton.addEventListener("click", async () => {
  toggleButton.disabled = true;
  try { state = await window.idleChats.toggleChats(); }
  catch (error) { reportError(error); }
  render();
});

liveOnlySetting.addEventListener("change", async () => {
  try { state = await window.idleChats.setLiveOnly(liveOnlySetting.checked); render(); }
  catch (error) { reportError(error); }
});

traySetting.addEventListener("change", async () => {
  try { state = await window.idleChats.setMinimizeToTray(traySetting.checked); render(); }
  catch (error) { reportError(error); }
});

window.idleChats.onState((next) => { state = next; render(); });
window.idleChats.getState().then((next) => { state = next; render(); }).catch(reportError);

function renderDiscord() {
  const discord = state.discord || {};
  const voice = discord.voice || { state: "closed", label: "Fechado", detail: "Discord encerrado." };
  const indicator = document.querySelector("#discord-voice");
  indicator.dataset.state = voice.state;
  indicator.querySelector("span").textContent = voice.state === "connected" ? "Discord ativo" : `Discord: ${voice.label.toLocaleLowerCase("pt-BR")}`;
  indicator.title = voice.detail;
  document.querySelector("#discord-status").textContent = voice.state === "connected" ? "Conexão na sala configurada." : `${voice.detail}${discord.hidden ? " · em segundo plano" : ""}`;
  document.querySelector("#discord-status").title = discord.status || "Fechado";
  document.querySelector("#discord-open").textContent = discord.active ? "Mostrar Discord" : "Abrir Discord";
  document.querySelector("#discord-room").disabled = !discord.url;
  document.querySelector("#discord-stop").disabled = !discord.active;
  const input = document.querySelector("#discord-url");
  if (!input.dataset.edited && document.activeElement !== input) input.value = discord.url || "";
}
async function discordAction(action, value) {
  try {
    state.discord = await window.idleChats.discordAction(action, value);
    renderDiscord();
    document.querySelector("#discord-notice").textContent = action === "save" ? "Sala salva. Use Ir para sala e conecte pelo Discord." : "";
    return true;
  } catch (error) { document.querySelector("#discord-notice").textContent = error.message; return false; }
}
for (const action of ["open", "room", "stop"]) document.querySelector(`#discord-${action}`).addEventListener("click", () => discordAction(action));
const discordOptions = document.querySelector("#discord-options");
const discordControls = document.querySelector("#discord-controls");
discordOptions.addEventListener("click", () => {
  discordControls.open = !discordControls.open;
  discordOptions.setAttribute("aria-expanded", String(discordControls.open));
});
discordControls.addEventListener("toggle", () => discordOptions.setAttribute("aria-expanded", String(discordControls.open)));
document.querySelector("#discord-url").addEventListener("input", event => { event.target.dataset.edited = "true"; });
document.querySelector("#discord-form").addEventListener("submit", async event => {
  event.preventDefault();
  const input = document.querySelector("#discord-url");
  if (await discordAction("save", input.value)) { delete input.dataset.edited; document.querySelector("#discord-settings").open = false; }
});

checkUpdatesButton.addEventListener("click", async () => {
  checkUpdatesButton.disabled = true;
  versionVerified = false;
  if (!updateAvailable) appVersion.textContent = `v${state.version || "—"}`;
  updateStatus.textContent = "Verificando…";
  try {
    if (updateAvailable) {
      await window.idleChats.openLatestRelease();
      updateStatus.textContent = "Página da versão aberta no navegador.";
    } else {
      const result = await window.idleChats.checkForUpdates();
      updateAvailable = result.updateAvailable;
      if (!result.releaseExists) {
        appVersion.textContent = `v${result.currentVersion}`;
        updateStatus.textContent = "Ainda não há versão publicada.";
      } else if (result.updateAvailable) {
        appVersion.textContent = `v${result.currentVersion} → v${result.latestVersion} 💫`;
        checkUpdatesButton.title = "Clique novamente para abrir a atualização no GitHub";
        updateStatus.textContent = "Nova versão disponível. Clique no texto novamente para baixar.";
      } else {
        versionVerified = true;
        appVersion.textContent = `v${result.currentVersion} ✅`;
        checkUpdatesButton.title = "Você está na versão mais recente. Clique para verificar novamente.";
        updateStatus.textContent = "";
      }
    }
  } catch (error) {
    appVersion.textContent = `v${state.version || "—"}`;
    updateAvailable = false;
    checkUpdatesButton.title = "Clique para verificar atualizações";
    updateStatus.textContent = `Falha ao verificar: ${error.message}`;
  } finally {
    checkUpdatesButton.disabled = false;
  }
});
