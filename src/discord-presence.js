"use strict";

function roomIdentity(value) {
  try {
    const url = new URL(value);
    if (url.origin !== "https://discord.com") return null;
    const match = url.pathname.match(/^\/channels\/(\d{17,20})\/(\d{17,20})\/?$/);
    return match ? `${match[1]}/${match[2]}` : null;
  } catch { return null; }
}

function discordPresence({ active, targetUrl, report, lastSeen = 0, now = Date.now() }) {
  const result = (state, label, detail) => ({ state, label, detail });
  if (!active) return result("closed", "Fechado", "Discord encerrado.");
  if (!report) return result("checking", "Verificando voz", "Aguardando a leitura do painel de voz do Discord.");
  if (now < lastSeen || now - lastSeen > 15_000) return result("unknown", "Não verificado", "A leitura do Discord está desatualizada. Mostre a janela para conferir.");
  if (report.kind === "connected") {
    const actual = roomIdentity(report.channelUrl);
    const expected = roomIdentity(targetUrl);
    if (!actual || !expected) return result("unknown", "Não verificado", "Conexão de voz detectada, mas não foi possível identificar a sala.");
    return actual === expected
      ? result("connected", "Discord ativo", "Conexão na sala configurada.")
      : result("wrong-room", "Outra sala", "A conta está conectada em voz em outra sala. Use Ir para sala.");
  }
  const states = {
    "login-required": ["login-required", "Faça login", "Entre com a conta secundária no Discord."],
    disconnected: ["disconnected", "Fora da sala", "O painel do Discord não mostra uma conexão de voz ativa."],
    connecting: ["connecting", "Conectando voz", "O Discord ainda está estabelecendo a conexão de voz."],
    offline: ["offline", "Sem conexão", "O Discord está sem conexão de rede."],
    unknown: ["unknown", "Não verificado", "Não foi possível confirmar a sala pelo painel de voz do Discord."]
  };
  return result(...(states[report.kind] || states.unknown));
}

module.exports = { discordPresence, roomIdentity };
