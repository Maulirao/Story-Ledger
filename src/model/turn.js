// ──────────────────────────────────────────────────────────────────────────────
// One turn on the snapshot: the newest block's state + this reply's changes →
// the state written into this reply's block. Plus finding the newest block, the
// starting state for a chat that has none, and putting the block into a reply.
// Pure: no SillyTavern, no DOM.
// ──────────────────────────────────────────────────────────────────────────────

import { emptyState } from "./state.js";
import { parseBlock, findBlock, BLOCK_MARK } from "./block.js";
import { enabledSections, CORE_KEYS } from "./sections/registry.js";
import { applyTurn, replayRelations } from "./relations.js";
import { importFromLegacyNotebook, notebookBody, parseNotebookBlock } from "./notebook.js";
import { parseChanges } from "./changes.js";

const clone = o => JSON.parse(JSON.stringify(o));
const key = s => String(s).trim().toLowerCase();

/** The change lines a reply wrote under `heading` (case-insensitive). */
const linesUnder = (changes, heading) => {
    if (!changes || !changes.sections) return [];
    const k = Object.keys(changes.sections).find(h => h.toLowerCase() === heading.toLowerCase());
    return k ? changes.sections[k] : [];
};

/** The context every section hook receives. */
export function sectionContext(state, prevPresent, config) {
    return {
        config, userName: config.userName, present: state.scene.present, prevPresent: prevPresent || [],
        touched: new Set(), sections: config.sections || {}, checkStyle: config.checkStyle || "dnd", rolls: config.rolls,
    };
}

/** `prev` + this reply's changes (null when the reply has none) → { state, log, unparsed }. */
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
    const ctx = sectionContext(s, prev.scene.present, config);
    const unparsed = [];
    const on = enabledSections(config.sections);
    for (const sec of on) {
        if (sec.carried) { if (s[sec.key] === undefined) s[sec.key] = sec.empty(); }
        else s.perTurn[sec.key] = sec.empty();
        for (const line of sec.apply(s, linesUnder(changes, sec.change), ctx)) unparsed.push({ section: sec.change, line });
    }
    for (const sec of on) if (sec.after) sec.after(s, ctx);
    return { state: s, log: rel.log, unparsed };
}

/** Lines for <story_ledger_turn>: what the sections announce before the reply is written. */
export function preTurnFacts(state, config) {
    const ctx = sectionContext(state, state.scene.present, config);
    return enabledSections(config.sections).flatMap(sec => (sec.facts ? sec.facts(state, ctx) : []));
}

/**
 * The newest Story Ledger block before `beforeIndex`: { state, index, errors }, or null.
 * A section the block lacks (switched off when it was written) and a row that no longer
 * parses (a hand-edit typo) keep the value from the block before it.
 */
export function latestState(chat, beforeIndex, config) {
    for (let i = Math.min(beforeIndex, (chat || []).length) - 1; i >= 0; i--) {
        const mes = chat[i] && chat[i].mes;
        if (!mes || !mes.includes(BLOCK_MARK)) continue;
        const first = parseBlock(mes, { config });
        if (!first) continue;
        const want = [...CORE_KEYS.filter(k => (config.sections || {})[k] !== false),
            ...enabledSections(config.sections).filter(sec => sec.carried).map(sec => sec.key)];
        if (!first.errors.length && want.every(k => first.sections.includes(k))) return { state: first.state, index: i, errors: [] };
        const older = latestState(chat, i, config);
        if (!older) return { state: first.state, index: i, errors: first.errors };
        const again = parseBlock(mes, { prev: older.state, config });
        return { state: again.state, index: i, errors: first.errors };
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

/**
 * A 0.1 chat: Story_Ledger comments, no block. 0.1 recomputed relationships by replaying
 * every comment from the first, with the reader's corrections stamped by chat length.
 */
function replayLegacy(chat, config, { ctOffset = null, corrections = [] }) {
    const msgs = chat || [];
    const first = msgs.findIndex(m => m && !m.is_user && !m.is_system && notebookBody(m.mes) !== null);
    if (first < 0) return null;
    const turns = [], indexes = [];
    let newest = null, threads = null;
    for (let i = first; i < msgs.length; i++) {
        const m = msgs[i];
        if (!m || m.is_user || m.is_system) continue;
        const ch = parseChanges(m.mes);
        if (ch) newest = ch;
        const nb = ch && parseNotebookBlock(m.mes);
        if (nb && nb.threads.length) threads = nb.threads;
        const present = new Set(ch && ch.present ? ch.present : []);
        if (config.userName) present.add(config.userName);
        turns.push({ events: ch ? ch.relations : null, present: [...present] });
        indexes.push(i);
    }
    const at = c => indexes.filter(i => i < c.atLength).length;
    const offset = ctOffset ?? importFfTurn(msgs.slice(0, first)) ?? 0;
    const { state } = replayRelations(turns, (corrections || []).map(({ atLength, ...rest }) => ({ at: at({ atLength }), ...rest })), config, offset);
    return { state, newest, threads };
}

/**
 * Starting state for a chat with no Story Ledger block yet: an FF turn count and
 * notebook, or a 0.1 chat's replayed comments (`legacy` = the 0.1 chat metadata's
 * { ctOffset, corrections }).
 */
export function initialState(chat, config, legacy = {}) {
    const s = emptyState();
    s.ct = importFfTurn(chat) ?? 0;
    s.threads = importFromLegacyNotebook(chat).threads;
    const old = replayLegacy(chat, config, legacy);
    if (old) {
        s.ct = old.state.ct;
        s.rel = { pairs: old.state.pairs, selves: old.state.selves };
        if (old.newest && old.newest.now !== null) s.scene.now = old.newest.now;
        if (old.newest && old.newest.present !== null) s.scene.present = old.newest.present;
        if (old.threads) s.threads = old.threads;   // 0.1 wrote the full list each reply
    }
    return s;
}

/** The reply with every closed state block removed (ours or another preset's). */
export function stripBlocks(mes) {
    let text = String(mes || "");
    let at;
    while ((at = findBlock(text))) text = text.slice(0, at.start) + text.slice(at.end);
    return text;
}

/** The reply with every state block removed and `blockText` appended. */
export function writeBlockInto(mes, blockText) {
    return `${stripBlocks(mes).replace(/\s+$/, "")}\n\n${blockText}`;
}

/** How many messages of the raw chat a generation builds on: a swiped or continued reply is not its own past. */
export function generationBase(chatLength, type) {
    return type === "swipe" || type === "continue" ? chatLength - 1 : chatLength;
}
