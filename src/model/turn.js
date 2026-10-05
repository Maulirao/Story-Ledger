// ──────────────────────────────────────────────────────────────────────────────
// One turn on the snapshot: the newest block's state + this reply's changes →
// the state written into this reply's block. Plus finding the newest block, the
// starting state for a chat that has none, and putting the block into a reply.
// Pure: no SillyTavern, no DOM.
// ──────────────────────────────────────────────────────────────────────────────

import { emptyState } from "./state.js";
import { parseBlock, findBlock, BLOCK_MARK } from "./block.js";
import { applyTurn } from "./relations.js";
import { importFromLegacyNotebook } from "./notebook.js";

const clone = o => JSON.parse(JSON.stringify(o));
const key = s => String(s).trim().toLowerCase();

/** `prev` + this reply's changes (null when the reply has none) → { state, log }. */
export function postTurn(prev, changes, config) {
    const s = clone(prev);
    if (changes) {
        if (changes.now !== null) s.scene.now = changes.now;
        if (changes.present !== null) s.scene.present = changes.present;
        if (changes.public !== null) s.scene.public = changes.public;
        const gone = new Set(changes.threads.remove.map(key));
        s.threads = s.threads.filter(t => !gone.has(key(t)));
        for (const t of changes.threads.add) if (!s.threads.some(x => key(x) === key(t))) s.threads.push(t);
    }
    const present = [...new Set([...s.scene.present, ...(config.userName ? [config.userName] : [])])];
    const rel = applyTurn({ ct: prev.ct, pairs: prev.rel.pairs, selves: prev.rel.selves }, changes ? changes.relations : null, present, config);
    s.ct = rel.state.ct;
    s.rel = { pairs: rel.state.pairs, selves: rel.state.selves };
    s.perTurn = {};
    return { state: s, log: rel.log };
}

/** The newest Story Ledger block before `beforeIndex`: { state, index }, or null. */
export function latestState(chat, beforeIndex, config) {
    for (let i = Math.min(beforeIndex, (chat || []).length) - 1; i >= 0; i--) {
        const mes = chat[i] && chat[i].mes;
        if (!mes || !mes.includes(BLOCK_MARK)) continue;
        const parsed = parseBlock(mes, { config });
        if (parsed) return { state: parsed.state, index: i };
    }
    return null;
}

/** The turn number of the newest Freaky/Realistic Frankenstein internal-states block, or null. */
export function importFfTurn(chat) {
    for (let i = (chat || []).length - 1; i >= 0; i--) {
        const m = chat[i];
        if (!m || m.is_user) continue;
        const hit = String(m.mes || "").match(/INTERNAL STATES\s*\(Turn:\s*(\d+)\)/i);
        if (hit) return Number(hit[1]);
    }
    return null;
}

/** Starting state for a chat with no Story Ledger block yet. */
export function initialState(chat, config) {
    const s = emptyState();
    s.ct = importFfTurn(chat) ?? 0;
    s.threads = importFromLegacyNotebook(chat).threads;
    return s;
}

/** The reply with every state block removed (ours or another preset's) and `blockText` appended. */
export function writeBlockInto(mes, blockText) {
    let text = String(mes || "");
    let at;
    while ((at = findBlock(text))) text = text.slice(0, at.start) + text.slice(at.end);
    return `${text.replace(/\s+$/, "")}\n\n${blockText}`;
}
