// ──────────────────────────────────────────────────────────────────────────────
// The story state the block holds. One plain object; every field the next turn
// needs is written into the reply's block and read back from it (snapshot model:
// the newest block is the truth). Sections from the registry add their own keys.
// Every consumer must tolerate keys it does not know. Pure: no SillyTavern, no DOM.
// ──────────────────────────────────────────────────────────────────────────────

import { SECTIONS } from "./sections/registry.js";

export function emptyState() {
    const s = {
        ct: 0,
        scene: { now: "", present: [], public: false },
        threads: [],
        rel: { pairs: {}, selves: {}, awaiting: {} },
        perTurn: {},
    };
    for (const sec of SECTIONS) if (sec.carried) s[sec.key] = sec.empty();
    return s;
}

/**
 * The next id of `kind` ("Q1", "Q2", …). Ids are counted, so one is never handed out
 * twice; `existing` are ids already in the state (a row the reader added by hand), which
 * the count also skips past. Mutates.
 */
export function nextId(state, kind, existing = []) {
    state.ids = state.ids || {};
    const seen = existing.map(id => Number(String(id).slice(kind.length))).filter(Number.isFinite);
    state.ids[kind] = Math.max(state.ids[kind] || 0, ...seen) + 1;
    return `${kind}${state.ids[kind]}`;
}
