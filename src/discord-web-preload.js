"use strict";

const { contextBridge, ipcRenderer } = require("electron");

// Run before Discord's scripts in the page's own context. No privileged API is
// exposed to remote content. Password and QR login remain available; WebAuthn
// requests are declined instead of opening a native Windows credential dialog.
contextBridge.executeInMainWorld({
  func: () => {
    const declinePasskey = () => Promise.reject(new DOMException(
      "Chaves de acesso desativadas no IdleChats. Entre com e-mail e senha ou código QR.",
      "NotAllowedError"
    ));
    const container = globalThis.CredentialsContainer?.prototype;
    if (container) {
      for (const method of ["get", "create"]) {
        const original = container[method];
        if (typeof original !== "function") continue;
        Object.defineProperty(container, method, {
          configurable: true,
          writable: true,
          value: function (options) {
            if (options?.publicKey) return declinePasskey();
            return Reflect.apply(original, this, arguments);
          }
        });
      }
    }
    const credential = globalThis.PublicKeyCredential;
    if (credential) {
      for (const method of ["isConditionalMediationAvailable", "isUserVerifyingPlatformAuthenticatorAvailable"]) {
        if (typeof credential[method] !== "function") continue;
        Object.defineProperty(credential, method, {
          configurable: true, writable: true, value: () => Promise.resolve(false)
        });
      }
    }
  }
});

// Read only the account's voice controls, never the chat or Discord's private
// stores/tokens. The selected page URL alone is not evidence of voice presence.
function readVoicePanel() {
  if (!navigator.onLine) return { kind: "offline" };
  if (/^\/(login|register)(\/|$)/.test(location.pathname)
    || document.querySelector('input[type="password"]')) return { kind: "login-required" };
  const panels = document.querySelectorAll('[class*="panels_"]');
  if (!panels.length) return { kind: "unknown" };
  const visible = element => element.getClientRects().length > 0;
  const normalize = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  let disconnectFound = false;
  for (const panel of panels) {
    for (const button of panel.querySelectorAll('button[aria-label], button[title], [role="button"][aria-label]')) {
      const label = normalize(button.getAttribute("aria-label") || button.getAttribute("title"));
      if (!visible(button) || !/^(disconnect|desconectar)(\b|$)/.test(label)) continue;
      disconnectFound = true;
      for (let group = button.parentElement; group && panel.contains(group); group = group.parentElement) {
        const labels = [group, ...group.querySelectorAll("*")].filter(visible).map(element => normalize(element.innerText));
        if (labels.some(text => /^(conectando|connecting|aguardando|awaiting|sem rota|no route|ice checking)\b/.test(text))) return { kind: "connecting" };
        if (!labels.some(text => /^(voz conectada|voice connected)$/.test(text))) continue;
        const links = new Set();
        for (const link of group.querySelectorAll('a[href]')) {
          if (!visible(link)) continue;
          try {
            const url = new URL(link.getAttribute("href"), location.origin);
            if (url.origin === "https://discord.com" && /^\/channels\/\d{17,20}\/\d{17,20}\/?$/.test(url.pathname)) {
              links.add(`https://discord.com${url.pathname.replace(/\/$/, "")}`);
            }
          } catch {}
        }
        if (links.size === 1) return { kind: "connected", channelUrl: [...links][0] };
        if (links.size > 1) return { kind: "unknown" };
      }
    }
  }
  return { kind: disconnectFound ? "unknown" : "disconnected" };
}

let presenceScheduled;
function reportVoice() {
  clearTimeout(presenceScheduled);
  presenceScheduled = undefined;
  try { ipcRenderer.send("discord-presence", readVoicePanel()); }
  catch { ipcRenderer.send("discord-presence", { kind: "unknown" }); }
}
function startPresenceObserver() {
  reportVoice();
  const observer = new MutationObserver(() => {
    if (!presenceScheduled) presenceScheduled = setTimeout(reportVoice, 200);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ["class", "href", "aria-label", "title", "hidden", "style"] });
  const heartbeat = setInterval(reportVoice, 5_000);
  window.addEventListener("pagehide", () => {
    observer.disconnect(); clearInterval(heartbeat); clearTimeout(presenceScheduled);
  }, { once: true });
}
ipcRenderer.on("discord-presence-request", () => {
  if (document.readyState !== "loading") reportVoice();
});
window.addEventListener("online", reportVoice);
window.addEventListener("offline", reportVoice);
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startPresenceObserver, { once: true });
else startPresenceObserver();
