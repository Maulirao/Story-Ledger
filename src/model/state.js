// ──────────────────────────────────────────────────────────────────────────────
// The story state the block holds. One plain object; every field the next turn
// needs is written into the reply's block and read back from it (snapshot model:
// the newest block is the truth). Later phases add keys — every consumer must
// tolerate keys it does not know. Pure: no SillyTavern, no DOM.
// ──────────────────────────────────────────────────────────────────────────────

export function emptyState() {
    return {
        ct: 0,
        scene: { now: "", present: [], public: false },
        threads: [],
        rel: { pairs: {}, selves: {} },
        perTurn: {},
    };
}

/** The first `kind`+n id not already used; recorded so it is never handed out twice. Mutates. */
export function nextId(state, kind) {
    state.ids = state.ids || {};
    const used = new Set(state.ids[kind] || []);
    let n = 1;
    while (used.has(`${kind}${n}`)) n++;
    const id = `${kind}${n}`;
    state.ids[kind] = [...used, id];
    return id;
}
