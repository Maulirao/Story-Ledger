// ──────────────────────────────────────────────────────────────────────────────
// One turn on the snapshot: the newest block's state + this reply's changes →
// the state written into this reply's block. Plus finding the newest block, the
// starting state for a chat that has none, and putting the block into a reply.
// Pure: no SillyTavern, no DOM.
// ──────────────────────────────────────────────────────────────────────────────

import { emptyState } from "./state.js";
import { parseBlock, findBlock, BLOCK_MARK, replaceSectionRows } from "./block.js";
import { enabledSections, CORE_KEYS, sectionByKey, needsPresent, SECTIONS } from "./sections/registry.js";
import { HEADINGS, headingKey } from "./headings.js";
import { applyTurn, replayRelations } from "./relations.js";
import { importFromLegacyNotebook, notebookBody, parseNotebookBlock } from "./notebook.js";
import { parseChanges } from "./changes.js";
import { importForeign } from "./import/index.js";
import { nameMatches } from "./text.js";

const clone = o => JSON.parse(JSON.stringify(o));
const key = s => String(s).trim().toLowerCase();

// lines of `lists` under `heading` (case-insensitive)
const under = (lists, heading) => {
    const k = Object.keys(lists || {}).find(h => h.toLowerCase() === heading.toLowerCase());
    return k ? lists[k] : [];
};

/** The change lines a reply wrote under `heading` (case-insensitive). */
const linesUnder = (changes, heading) => under(changes && changes.sections, heading);

/** The same lines before quote folding, index for index; a reply without them falls back to `linesUnder`. */
const rawLinesUnder = (changes, heading) => changes && changes.raw ? under(changes.raw, heading) : linesUnder(changes, heading);

// Threads without the removed ones. Each removal picks its tier against the threads as they
// stood, so an exact removal never lets a later fallback take a quote-distinct counterpart.
// Without raw values (tagged replies) only exact matches go.
function removeThreads(threads, remove, rawRemove) {
    if (!rawRemove) {
        const gone = new Set(remove.map(key));
        return threads.filter(t => !gone.has(key(t)));
    }
    const gone = new Set(remove.flatMap((v, i) => nameMatches(threads, v, rawRemove[i])));
    return threads.filter((t, i) => !gone.has(i));
}

/** The context every section hook receives. */
export function sectionContext(state, prevPresent, config, prevNow = "", changes = null) {
    return {
        config, userName: config.userName, present: state.scene.present, prevPresent: prevPresent || [], prevNow,
        touched: new Set(), warnings: [], turn: {}, linesUnder: heading => linesUnder(changes, heading),
        // Comments preserve source order across headings; legacy/tagged inputs keep their grouped reading.
        linesAcross: headings => changes?.orderedSections
            ? changes.orderedSections.filter(record => headings.includes(record.section))
            : headings.flatMap(section => linesUnder(changes, section).map(line => ({ section, line }))),
        rawLinesUnder: heading => rawLinesUnder(changes, heading), normalizedChanges: Boolean(changes && changes.raw), sections: config.sections || {}, checkStyle: config.checkStyle || "dnd",
        rolls: Array.isArray(config.dice?.checks) ? config.dice.checks : config.rolls, fudgedDice: config.fudgedDice || [],
    };
}

/** `prev` + this reply's changes (null when the reply has none) → { state, log, unparsed, warnings }. */
export function postTurn(prev, changes, config) {
    const s = clone(prev);
    // a switched-off section ignores its lines (Present stays while a section needs it)
    const coreOn = k => (config.sections || {})[k] !== false;
    if (changes) {
        if (coreOn("scene") && changes.now !== null) s.scene.now = changes.now;
        if (needsPresent(config.sections) && changes.present !== null) s.scene.present = changes.present;
        if (coreOn("scene") && changes.public !== null) s.scene.public = changes.public;
        if (coreOn("notebook")) {
            s.threads = removeThreads(s.threads, changes.threads.remove, changes.rawThreads && changes.rawThreads.remove);
            for (const t of changes.threads.add) if (!s.threads.some(x => key(x) === key(t))) s.threads.push(t);
        }
    }
    const present = [...new Set([...s.scene.present, ...(config.userName ? [config.userName] : [])])];
    const events = changes && coreOn("relationships") ? changes.relations : null;   // the turn count still advances
    const rel = applyTurn({ ct: prev.ct, pairs: prev.rel.pairs, selves: prev.rel.selves, awaiting: prev.rel.awaiting || {}, ...(prev.rel.pending?.length ? { pending: prev.rel.pending } : {}) }, events, present, config);
    s.ct = rel.state.ct;
    s.rel = { pairs: rel.state.pairs, selves: rel.state.selves, awaiting: rel.state.awaiting, ...(rel.state.pending?.length ? { pending: rel.state.pending } : {}) };
    s.perTurn = {};
    const ctx = sectionContext(s, prev.scene.present, config, prev.scene.now, changes);
    const unparsed = [];
    const on = enabledSections(config.sections);
    for (const sec of on) if (sec.decide) ctx.turn[sec.key] = sec.decide(prev, ctx);
    for (const sec of on) {
        if (sec.carried) { if (s[sec.key] === undefined) s[sec.key] = sec.empty(); }
        else s.perTurn[sec.key] = sec.empty();
        for (const line of sec.apply(s, linesUnder(changes, sec.change), ctx)) unparsed.push({ section: sec.change, line });
    }
    for (const sec of on) if (sec.after) sec.after(s, ctx);
    return { state: s, log: rel.log, unparsed, warnings: ctx.warnings };
}

// a heading's owning switch; core grammars have no section module of their own
const CORE_OWNER = { Threads: "notebook", "Proposed rules": "notebook", Relationships: "relationships", World: "fate" };
const ownerOf = name => {
    const canonical = HEADINGS.get(headingKey(name));
    return canonical && (CORE_OWNER[canonical] || SECTIONS.find(sec => sec.change === canonical)?.key);
};

/**
 * Parser and engine "could not read" lines for the reply notice. Diagnostics of a known
 * heading whose section is switched off are dropped; unknown headings stay visible.
 */
export function unreadNotices(changes, unparsed, sections = {}) {
    const off = u => { const k = ownerOf(u.section); return Boolean(k) && (sections || {})[k] === false; };
    return [...((changes && changes.unparsed) || []).filter(u => !off(u)), ...(unparsed || [])];
}

/** Lines for <story_ledger_turn>: what the sections announce before the reply is written. */
export function preTurnFacts(state, config) {
    const on = enabledSections(config.sections);
    const ctx = sectionContext(state, state.scene.present, config);
    for (const sec of on) if (sec.decide) ctx.turn[sec.key] = sec.decide(state, ctx);
    return on.flatMap(sec => (sec.facts ? sec.facts(state, ctx) : []));
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
    // the other preset's newest block, read by code: its sections replace the empty defaults
    const imp = importForeign(chat, config);
    if (imp.source) {
        for (const k of imp.imported) {
            if (k === "ct") s.ct = imp.state.ct;
            else if (k === "scene") s.scene = { ...s.scene, ...imp.state.scene };
            else if (k === "rel") s.rel = { ...s.rel, awaiting: { ...imp.state.rel.awaiting } };   // bonds await their NEW lines
            else s[k] = imp.state[k];
        }
        s.ids = { ...(s.ids || {}), ...(imp.state.ids || {}) };
    }
    const old = replayLegacy(chat, config, legacy);
    if (old) {
        s.ct = old.state.ct;
        s.rel = { pairs: old.state.pairs, selves: old.state.selves, awaiting: old.state.awaiting || {}, ...(old.state.pending?.length ? { pending: old.state.pending } : {}) };
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

/**
 * Rewrite one section of the newest block the way a hand edit would (only that section's
 * rows change). Refuses when the newest block has rows that no longer parse — rewriting
 * would silently replace them. Returns { status: "ok"|"noblock"|"unreadable"|"nosection",
 * index, mes, errors }.
 */
export function rewriteNewestSection(chat, beforeIndex, config, key, mutator) {
    const found = latestState(chat, beforeIndex, config);
    if (!found) return { status: "noblock", errors: [] };
    if (found.errors.length) return { status: "unreadable", index: found.index, errors: found.errors };
    const sec = sectionByKey(key);
    mutator(found.state);
    const mes = replaceSectionRows(chat[found.index].mes, sec.match, sec.render(found.state[key], { config }));
    if (mes === null) return { status: "nosection", index: found.index, errors: [] };
    return { status: "ok", index: found.index, mes, errors: [] };
}

/**
 * The state with the reader's clock correction applied, when that correction is newer than
 * the block the state came from (`blockIndex`): the correction is the story time until a
 * later reply states one. Returns `state` itself when nothing applies.
 */
export function withClockOverride(state, override, blockIndex) {
    if (!override || !override.text || !(override.atLength > blockIndex)) return state;
    const s = clone(state);
    s.scene.now = override.text;
    return s;
}
