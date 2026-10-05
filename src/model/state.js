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
        rel: { pairs: {}, selves: {} },
        perTurn: {},
    };
    for (const sec of SECTIONS) if (sec.carried) s[sec.key] = sec.empty();
    return s;
}

/** The next id of `kind` ("Q1", "Q2", …). Ids are counted, so one is never handed out twice. Mutates. */
export function nextId(state, kind) {
    state.ids = state.ids || {};
    state.ids[kind] = (state.ids[kind] || 0) + 1;
    return `${kind}${state.ids[kind]}`;
}
