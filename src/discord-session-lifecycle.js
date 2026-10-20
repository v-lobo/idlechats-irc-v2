"use strict";

function closeDiscordPage(contents, { timeoutMs = 8_000 } = {}) {
  if (!contents || contents.isDestroyed()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const allowClose = event => event.preventDefault();
    const cleanup = () => {
      clearTimeout(timer);
      contents.removeListener("destroyed", finished);
      contents.removeListener("will-prevent-unload", allowClose);
    };
    const finished = () => { cleanup(); resolve(); };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("O Discord não respondeu ao fechamento seguro da sessão."));
    }, timeoutMs);
    contents.once("destroyed", finished);
    contents.on("will-prevent-unload", allowClose);
    try {
      // Discord must get the normal page-exit event before its renderer is
      // destroyed, so it can commit its own authentication state to storage.
      contents.close({ waitForBeforeUnload: true });
    } catch (error) { cleanup(); reject(error); }
  });
}

async function flushDiscordSession(browserSession) {
  if (!browserSession) return;
  browserSession.flushStorageData();
  await browserSession.cookies.flushStore();
}

module.exports = { closeDiscordPage, flushDiscordSession };
