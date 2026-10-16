"use strict";

const form = document.querySelector("#channel-form");
const channelInput = document.querySelector("#channel-input");
const channelList = document.querySelector("#channel-list");
const channelCount = document.querySelector("#channel-count");
const emptyState = document.querySelector("#empty-state");
const toggleButton = document.querySelector("#toggle-button");
const addAccountButton = document.querySelector("#add-account");
const accountList = document.querySelector("#account-list");
const accountCount = document.querySelector("#account-count");
const pendingList = document.querySelector("#pending-list");
const accountSummary = document.querySelector("#account-summary");
const accountsSection = document.querySelector("#accounts-section");
const accountsPanel = document.querySelector(".accounts-panel");
const addSection = document.querySelector("#add-section");
const liveOnlySetting = document.querySelector("#live-only");
const traySetting = document.querySelector("#minimize-to-tray");
const liveUpdated = document.querySelector("#live-updated");
const checkLiveButton = document.querySelector("#check-live");
const headline = document.querySelector("#headline");
const subhead = document.querySelector("#subhead");
const globalStatus = document.querySelector("#global-status");
const notice = document.querySelector("#notice");
const connectionIndicator = document.querySelector("#connection-indicator");
const runtimeMetrics = document.querySelector("#runtime-metrics");
let state = { channels: [], accounts: [], pendingLogins: [], running: false, preferences: {} };

window.history.scrollRestoration = "manual";
window.addEventListener("load", () => window.scrollTo(0, 0), { once: true });
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

function formatLive(channel) {
  if (channel.liveStatus === "live") return "AO VIVO";
  if (channel.liveStatus === "offline") return "OFFLINE";
  if (channel.liveStatus === "checking") return "VERIFICANDO";
  if (channel.liveStatus === "unavailable") return "INDISPONÍVEL";
  return "AGUARDANDO";
}

function formatAccountState(account) {
  if (!account.authenticated) return "Precisa reconectar";
  if (account.connectionState === "connected") return `${account.joinedChannels.length} JOIN(s) IRC confirmado(s)`;
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
  const connected = state.accounts.filter((account) => account.authenticated).length;
  accountSummary.textContent = `${connected} conectada(s) · ${state.accounts.length} cadastrada(s)`;
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
    name.textContent = account.displayName || account.login || "Conta Twitch";
    const detail = document.createElement("span");
    detail.textContent = `@${account.login || "conta"} · ${account.authenticated ? `${account.joinedChannels.length} presença(s) IRC` : "precisa reconectar"}`;
    copy.append(name, detail);
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
  channelCount.textContent = String(state.channels.length);
  emptyState.hidden = state.channels.length > 0;
  channelList.replaceChildren();
  for (const channel of state.channels) {
    const row = document.createElement("div");
    row.className = "channel-row";
    row.dataset.live = channel.liveStatus;
    const dot = document.createElement("i");
    dot.className = "live-dot";
    const copy = document.createElement("div");
    copy.className = "channel-copy";
    const name = document.createElement("strong");
    name.textContent = `#${channel.name}`;
    const statuses = (channel.accountStates || []).map((account) => `${account.login}: ${account.state}`).join(" · ");
    const detail = document.createElement("span");
    detail.textContent = `${formatLive(channel)}${statuses ? ` · ${statuses}` : ""}`;
    detail.title = channel.liveDetail || statuses;
    copy.append(name, detail);
    row.append(dot, copy, makeButton("×", "quiet remove", async () => {
      try { state = await window.idleChats.removeChannel(channel.name); render(); }
      catch (error) { reportError(error); }
    }, `Remover ${channel.name}`));
    channelList.append(row);
  }
}

function render() {
  if (state.pendingLogins?.length) accountsSection.open = true;
  toggleButton.disabled = !state.channels.length || !state.accounts.some((account) => account.authenticated);
  toggleButton.textContent = state.running ? "Parar conexões" : "Iniciar IRC";
  connectionIndicator.dataset.running = String(state.running);
  connectionIndicator.querySelector("span").textContent = state.running ? "IRC ativo" : "Parado";
  const joined = state.accounts.reduce((total, account) => total + account.joinedChannels.length, 0);
  headline.textContent = state.running ? "IRC em segundo plano" : "Conexões de chat";
  subhead.textContent = `${joined} JOIN(s) IRC confirmado(s) · ${state.accounts.length} conta(s) · ${state.channels.length} canal(is).`;
  globalStatus.textContent = state.running
    ? "IRC confirma as entradas nos chats; o jogo pode levar alguns minutos para atualizar o bônus."
    : "Pronto para conectar. Nenhuma janela ou guia de chat será criada.";
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
  const online = state.channels.filter((channel) => channel.liveStatus === "live").length;
  liveUpdated.textContent = state.liveCheckedAt
    ? `${online} ao vivo · consultado às ${new Date(state.liveCheckedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
    : "Consulta de status a cada 1 minuto.";
  checkLiveButton.disabled = !state.channels.length || state.channels.some((channel) => channel.liveStatus === "checking");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    state = await window.idleChats.addChannel(channelInput.value.trim());
    channelInput.value = "";
    addSection.open = false;
    render();
  } catch (error) { channelInput.setCustomValidity(error.message); channelInput.reportValidity(); }
});
channelInput.addEventListener("input", () => channelInput.setCustomValidity(""));

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

checkLiveButton.addEventListener("click", async () => {
  checkLiveButton.disabled = true;
  liveUpdated.textContent = "Consultando…";
  try { state = await window.idleChats.checkOnline(); render(); }
  catch (error) { reportError(error); }
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
