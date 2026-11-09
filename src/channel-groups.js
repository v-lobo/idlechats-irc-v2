"use strict";

const CHANNEL_GROUPS = [
  { id: "pokeidleworld", title: "Canais - PokeIdleWorld", maxChannels: 5 },
  { id: "pokedream", title: "Canais - PokeDream", maxChannels: 1 }
];
const DEFAULT_DREAM_CHANNELS = ["brucescottt", "safnaww", "StormBomb", "surtoo_"];
const CHANNEL_PATTERN = /^[a-zA-Z0-9_]{1,25}$/;

function isChannelGroup(groupId) {
  return CHANNEL_GROUPS.some((group) => group.id === groupId);
}

function migrateChannels(saved, defaultChannels = []) {
  const migrated = saved?.version === 2 && Array.isArray(saved.channels);
  const entries = migrated ? saved.channels
    : Array.isArray(saved) ? saved : defaultChannels.map((name) => ({ name }));
  const channels = [];
  for (const item of entries) {
    if (!item || typeof item.name !== "string" || !CHANNEL_PATTERN.test(item.name)) continue;
    const groupId = migrated ? item.groupId : "pokeidleworld";
    if (!isChannelGroup(groupId)) continue;
    if (channels.some((channel) => channel.groupId === groupId && channel.name.toLowerCase() === item.name.toLowerCase())) continue;
    channels.push({ name: item.name, groupId });
  }
  if (!migrated) {
    channels.push(...DEFAULT_DREAM_CHANNELS.map((name) => ({ name, groupId: "pokedream" })));
  }
  return channels;
}

// The caller supplies the existing live-first priority order. Each group gets
// its own quota; the IRC client shares a JOIN when both lists contain a channel.
function selectTargetChannels(orderedChannels, liveOnly, isLive, limits = {}) {
  const selected = new Set();
  for (const group of CHANNEL_GROUPS) {
    const eligible = orderedChannels.filter((channel) => channel.groupId === group.id && (!liveOnly || isLive(channel.name)));
    const limit = Number.isSafeInteger(limits[group.id]) && limits[group.id] >= 1 ? limits[group.id] : group.maxChannels;
    for (const { name } of eligible.slice(0, limit)) selected.add(name.toLowerCase());
  }
  return [...selected];
}

module.exports = { CHANNEL_GROUPS, isChannelGroup, migrateChannels, selectTargetChannels };
