"use strict";
function render(state) {
  document.documentElement.dataset.compact = String(state.compact);
  const voice = state.voice || { state: "checking", label: "Verificando voz", detail: "Aguardando leitura do Discord." };
  const indicator = document.querySelector("#status");
  indicator.dataset.state = voice.state;
  indicator.querySelector("span").textContent = voice.label;
  indicator.title = `${voice.detail} ${state.status}`;
  document.querySelector("#compact").checked = state.compact;
  document.querySelector("#room").disabled = !state.url;
}
async function act(action, value) {
  try { render(await window.discordPanel.action(action, value)); }
  catch (error) { document.querySelector("#error").textContent = error.message; }
}
for (const action of ["room", "reload", "hide"]) document.querySelector(`#${action}`).addEventListener("click", () => act(action));
document.querySelector("#compact").addEventListener("change", event => act("compact", event.target.checked));
window.discordPanel.onState(render);
void act("state");
