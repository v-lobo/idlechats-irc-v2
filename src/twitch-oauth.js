"use strict";

const CLIENT_ID_PATTERN = /^[a-z0-9]{20,40}$/i;
const REQUESTED_SCOPES = ["chat:read", "chat:edit"];
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

async function postForm(url, fields) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(fields),
    signal: AbortSignal.timeout(15_000)
  });
  let body;
  try { body = await response.json(); }
  catch { body = {}; }
  if (!response.ok) {
    const error = new Error(body.message || body.error_description || body.error || `Twitch OAuth respondeu HTTP ${response.status}.`);
    error.code = body.message || body.error || `http_${response.status}`;
    error.status = response.status;
    throw error;
  }
  return body;
}

function validateClientId(clientId) {
  const normalized = (clientId || "").trim();
  if (!CLIENT_ID_PATTERN.test(normalized)) throw new Error("Informe um Client ID válido do Twitch Developer Console.");
  return normalized;
}

async function requestDeviceCode(clientId) {
  const normalizedClientId = validateClientId(clientId);
  const result = await postForm("https://id.twitch.tv/oauth2/device", {
    client_id: normalizedClientId,
    scopes: REQUESTED_SCOPES.join(" ")
  });
  if (!result.device_code || !result.user_code || !result.verification_uri) {
    throw new Error("A Twitch não retornou os dados de autorização do dispositivo.");
  }
  const verificationUrl = new URL(result.verification_uri);
  if (verificationUrl.protocol !== "https:" || verificationUrl.hostname !== "www.twitch.tv") {
    throw new Error("A Twitch retornou um endereço de ativação inesperado.");
  }
  return {
    clientId: normalizedClientId,
    deviceCode: result.device_code,
    userCode: result.user_code,
    verificationUri: result.verification_uri,
    expiresAt: Date.now() + (Number(result.expires_in) || 1800) * 1000,
    intervalMs: Math.max(1000, (Number(result.interval) || 5) * 1000)
  };
}

async function pollDeviceToken(clientId, deviceCode) {
  return postForm("https://id.twitch.tv/oauth2/token", {
    client_id: clientId,
    scopes: REQUESTED_SCOPES.join(" "),
    device_code: deviceCode,
    grant_type: DEVICE_GRANT
  });
}

async function refreshToken(clientId, refresh) {
  return postForm("https://id.twitch.tv/oauth2/token", {
    client_id: validateClientId(clientId),
    grant_type: "refresh_token",
    refresh_token: refresh
  });
}

function isClientConfigurationError(error) {
  const text = `${error?.code || ""} ${error?.message || ""}`.toLowerCase();
  return /(?:missing|invalid) client (?:secret|id)|\binvalid client\b|\bunauthorized_client\b/.test(text);
}

async function validateToken(accessToken) {
  const response = await fetch("https://id.twitch.tv/oauth2/validate", {
    headers: { authorization: `OAuth ${accessToken}`, accept: "application/json" },
    signal: AbortSignal.timeout(15_000)
  });
  let body;
  try { body = await response.json(); }
  catch { body = {}; }
  if (!response.ok) {
    const error = new Error(body.message || `Não foi possível validar a conta Twitch (HTTP ${response.status}).`);
    error.code = `http_${response.status}`;
    throw error;
  }
  return body;
}

async function getUserProfile(clientId, accessToken) {
  const response = await fetch("https://api.twitch.tv/helix/users", {
    headers: {
      "Client-Id": validateClientId(clientId),
      authorization: `Bearer ${accessToken}`,
      accept: "application/json"
    },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`Não foi possível carregar o perfil Twitch (HTTP ${response.status}).`);
  const profile = (await response.json()).data?.[0];
  if (!profile) throw new Error("A Twitch não retornou o perfil da conta.");
  return {
    login: String(profile.login || "").toLowerCase(),
    displayName: String(profile.display_name || profile.login || ""),
    avatar: String(profile.profile_image_url || "")
  };
}

function ensureChatScopes(scopes) {
  const available = new Set(Array.isArray(scopes) ? scopes : []);
  const missing = REQUESTED_SCOPES.filter((scope) => !available.has(scope));
  if (missing.length) {
    const error = new Error(`A conta não autorizou os escopos IRC necessários: ${missing.join(", ")}. Remova e conecte novamente.`);
    error.code = "missing_scopes";
    throw error;
  }
}

module.exports = {
  REQUESTED_SCOPES,
  ensureChatScopes,
  getUserProfile,
  isClientConfigurationError,
  pollDeviceToken,
  refreshToken,
  requestDeviceCode,
  validateClientId,
  validateToken
};
