// ──────────────────────────────────────────────────────────────────────────────
// 🌎 WORLD SIM — one configured d20 event for the current reply. Never carried.
// Pure: the previous state, dice, and table config determine the result.
// ──────────────────────────────────────────────────────────────────────────────

import { esc } from "../text.js";
import { DEFAULT_SECTION_CONFIG } from "../config.js";

const userKey = ctx => String(ctx?.config?.userName || "{{user}}").trim().toLowerCase();
const nameKey = name => String(name || "").trim().toLowerCase();

function namedNpcNames(state, ctx) {
    const present = new Set((state?.scene?.present || []).map(nameKey).filter(Boolean));
    const user = userKey(ctx);
    const names = new Map();
    for (const name of [
        ...Object.keys(state?.agendas || {}),
        ...Object.keys(state?.locations || {}),
        ...Object.keys(state?.cast || {}),
        ...(state?.scene?.present || []),
    ]) {
        const key = nameKey(name);
        if (!key || key === user || key === "{{user}}") continue;
        if (!names.has(key)) names.set(key, { name: String(name).trim(), offScreen: !present.has(key) });
    }
    return [...names.values()];
}

function tableFor(state, ctx) {
    const names = namedNpcNames(state, ctx);
    const offScreen = names.some(item => item.offScreen);
    return names.length <= 2 || !offScreen ? "Duo" : "Standard";
}

function entryFor(entries, roll) {
    return Array.isArray(entries) ? entries.find(item => roll >= item.from && roll <= item.to) : null;
}

export default {
    key: "worldsim",
    title: "🌎 WORLD SIM",
    match: /^WORLD SIM$/,
    change: "World Sim",
    carried: false,
    empty: () => null,
    isEmpty: value => !value,
    decide(prev, ctx) {
        const roll = ctx?.config?.dice?.world;
        if (!Number.isInteger(roll) || roll < 1 || roll > 20) return null;
        const table = tableFor(prev, ctx);
        const tableKey = table.toLowerCase();
        const config = ctx.config.sectionConfig?.worldsim || DEFAULT_SECTION_CONFIG.worldsim;
        const entries = config[tableKey] || DEFAULT_SECTION_CONFIG.worldsim[tableKey];
        const entry = entryFor(entries, roll);
        if (!entry) return null;
        return {
            roll,
            table,
            name: entry.name,
            text: entry.text,
            fudged: ctx.config.fudgedDice?.includes("world") || ctx.config.fudges?.dice?.world !== undefined,
        };
    },
    render(value) {
        if (!value) return [];
        return [
            `- <b>Roll:</b> ${value.roll}${value.fudged ? " (fudged)" : ""}`,
            `- <b>Table:</b> ${value.table}`,
            `- <b>Event:</b> ${esc(value.name)} — ${esc(value.text)}`,
        ];
    },
    parse: () => ({ value: null, errors: [] }),
    apply(state, lines, ctx) {
        state.perTurn.worldsim = ctx.turn.worldsim;
        return lines.map(line => String(line).trim()).filter(Boolean);
    },
    facts(state, ctx) {
        const event = ctx.turn.worldsim;
        if (!event) return [];
        return [`World Sim: ${event.name} — ${event.text}. Use it only if Fate's cell is TRUE; discard it on a WEIGHTED turn; skip it in an intimate scene.`];
    },
    prompt: () => "",
    rules: () => "",
    template: () => [],
};
