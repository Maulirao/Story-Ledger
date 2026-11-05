// ──────────────────────────────────────────────────────────────────────────────
// Id counters (Q1, B1, …). Its own module, so a section can count ids without importing
// state.js, which imports the section registry: that import made a cycle, and a
// section loaded first (index.js loads quests.js first) crashed it. Pure.
// ──────────────────────────────────────────────────────────────────────────────

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
