// ──────────────────────────────────────────────────────────────────────────────
// Importing a chat that ran under another preset: before the chat has any Story
// Ledger block, the newest foreign state block is read by code (not the model)
// into the starting state. Bonds stay with the model's handover. Pure.
// ──────────────────────────────────────────────────────────────────────────────

import { BLOCK_MARK } from "../block.js";
import { parseFf } from "./ff.js";

const FF = /<internal_states>|<!--\s*GFX_START\s*-->/i;

const SOURCES = [
    ["ff", mes => FF.test(mes), parseFf],
];

/**
 * { source: "ff"|"aa"|"sola"|null, index, state, imported, rules, unread } — the newest
 * foreign block before any Story Ledger block, read into a partial state.
 */
export function importForeign(chat, config) {
    const msgs = chat || [];
    if (msgs.some(m => m && String(m.mes || "").includes(BLOCK_MARK))) return { source: null, index: -1, state: null, imported: [], rules: [], unread: [] };
    for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (!m || m.is_user || m.is_system) continue;
        const mes = String(m.mes || "");
        const hit = SOURCES.find(([, test]) => test(mes));
        if (hit) return { source: hit[0], index: i, ...hit[2](mes, config) };
    }
    return { source: null, index: -1, state: null, imported: [], rules: [], unread: [] };
}
