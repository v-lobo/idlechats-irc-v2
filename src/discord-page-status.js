"use strict";

const PAGE_OPEN = "Página aberta · confira a conexão no Discord";

// Chromium's loading spinner includes iframes. Track the main document instead,
// so a background frame cannot put an already usable Discord page back in loading.
function watchDiscordPageStatus(contents, update, { loadTimeoutMs = 30_000 } = {}) {
  let phase = "idle";
  let timer;
  const clearTimer = () => { clearTimeout(timer); timer = undefined; };
  const setPhase = (next, message) => {
    clearTimer();
    phase = next;
    update(message);
  };
  const begin = (details, _url, isInPlace, isMainFrame) => {
    const mainFrame = details.isMainFrame ?? isMainFrame;
    const sameDocument = details.isSameDocument ?? isInPlace;
    if (!mainFrame || sameDocument) return;
    setPhase("loading", "Carregando Discord…");
    timer = setTimeout(() => {
      setPhase("slow", "Discord demorando para carregar · tente Recarregar");
    }, loadTimeoutMs);
    timer.unref?.();
  };
  const ready = () => {
    // Error pages can emit DOM/load events after did-fail-load.
    if (phase === "error" || phase === "interrupted") return;
    setPhase("open", PAGE_OPEN);
  };
  const stopped = () => {
    if ((phase === "loading" || phase === "slow") && !contents.isLoadingMainFrame()) ready();
  };
  const failed = (_event, code, _description, _url, mainFrame) => {
    if (!mainFrame || code === -3) return;
    setPhase("error", "Falha ao carregar · tente Recarregar");
  };
  const interrupted = () => setPhase("interrupted", "Discord interrompido · recarregue para entrar novamente");
  const listeners = {
    "did-start-navigation": begin,
    "dom-ready": ready,
    "did-finish-load": ready,
    "did-stop-loading": stopped,
    "did-fail-load": failed,
    "render-process-gone": interrupted
  };
  for (const [event, listener] of Object.entries(listeners)) contents.on(event, listener);
  const dispose = () => {
    clearTimer();
    for (const [event, listener] of Object.entries(listeners)) contents.removeListener(event, listener);
    contents.removeListener("destroyed", dispose);
  };
  contents.once("destroyed", dispose);
  return dispose;
}

module.exports = { watchDiscordPageStatus, PAGE_OPEN };
