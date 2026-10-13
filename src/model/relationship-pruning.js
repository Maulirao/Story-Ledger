// Reader choices live in chat metadata, so old blocks and model output cannot undo
// a prune. Restores seed the saved values until a subsequent block carries them.
import { plain } from "./import/util.js";

const clone = value => JSON.parse(JSON.stringify(value));
const identity = (name, config) => plain(/^\s*\{\{user\}\}\s*$/i.test(name) ? config.userName || name : name).normalize("NFKC").toLowerCase();
const same = (a, b, config) => identity(a, config) === identity(b, config);
const matches = (entry, from, to, config) => same(entry.from, from, config) && same(entry.to, to, config);
const prunedEntries = overrides => Object.values(overrides || {}).filter(e => e.pruned);
const blocked = (entries, event, config) => entries.some(e => matches(e, event.from, event.to, config));
const senders = rel => [...Object.values(rel.pairs).map(p => p.from), ...Object.keys(rel.awaiting || {}).map(k => k.split("→")[0])];

/** Apply pruning everywhere state is consumed; restore only while newer than its block. */
export function withRelationshipOverrides(state, overrides, blockIndex, config, rebuildIndex = null) {
    if (!Object.keys(overrides || {}).length) return state;
    const s = clone(state), rel = s.rel;
    for (const [key, entry] of Object.entries(overrides)) {
        if (entry.pruned || !((entry.savedAt ?? entry.atLength) > blockIndex)) continue;
        if (rebuildIndex !== null && rebuildIndex < entry.atLength - 1) continue;
        if (entry.pair) rel.pairs[key] = clone(entry.pair);
        if (entry.awaiting !== undefined) (rel.awaiting ||= {})[key] = entry.awaiting;
        if (entry.pending?.length) {
            rel.pending = [...(rel.pending || []).filter(p => !matches(entry, p.from, p.to, config)), ...clone(entry.pending)];
        }
        if (entry.self && (entry.restoreSelf || !rel.selves[entry.from])) rel.selves[entry.from] = clone(entry.self);
    }
    const pruned = prunedEntries(overrides);
    for (const [key, p] of Object.entries(rel.pairs)) if (blocked(pruned, p, config)) delete rel.pairs[key];
    for (const key of Object.keys(rel.awaiting || {})) {
        const [from, to] = key.split("→");
        if (blocked(pruned, { from, to }, config)) delete rel.awaiting[key];
    }
    if (rel.pending) {
        rel.pending = rel.pending.filter(p => !blocked(pruned, p, config));
        if (!rel.pending.length) delete rel.pending;
    }
    const active = senders(rel);
    for (const who of Object.keys(rel.selves)) {
        if (pruned.some(e => same(e.from, who, config)) && !active.some(from => same(from, who, config))) delete rel.selves[who];
    }
    return s;
}

/** Drop events for pruned pairs before the engine can queue or recreate them. */
export function filterPrunedRelationEvents(events, state, overrides, config) {
    const pruned = prunedEntries(overrides);
    if (!events || !pruned.length) return events;
    const out = { ...events };
    for (const kind of ["news", "ticks", "directs", "notes"]) out[kind] = (events[kind] || []).filter(e => !blocked(pruned, e, config));
    const active = [...senders(state.rel), ...out.news.map(e => e.from)];
    out.phiTicks = (events.phiTicks || []).filter(t => !pruned.some(e => same(e.from, t.who, config)) || active.some(from => same(from, t.who, config)));
    return out;
}

/** Events already present when Restore was clicked must not be replayed onto its snapshot. */
export function restoredReplyInputs(events, overrides, index, config, source) {
    const entries = Object.values(overrides || {}).filter(e => !e.pruned && index === e.atLength - 1
        && source.swipeId === e.restoreSwipeId && typeof e.restoreMessage === "string" && source.text.startsWith(e.restoreMessage));
    if (!entries.length) return { events, config };
    const out = events ? { ...events } : null;
    if (out) for (const kind of ["news", "ticks", "directs", "notes", "phiTicks"]) {
        const seen = entries.filter(e => source.ledgerCount === e.restoreLedgerCount).flatMap(e => (e.seenRelations?.[kind] || []).filter(event => kind === "phiTicks" ? e.restoreSelf && same(event.who, e.from, config) : matches(e, event.from, event.to, config))).map(e => JSON.stringify(e));
        out[kind] = (events[kind] || []).filter(event => {
            const at = seen.indexOf(JSON.stringify(event));
            if (at < 0) return true;
            seen.splice(at, 1);
            return false;
        });
    }
    // This reply's scheduled work already happened before the reader restored the
    // snapshot. New continuation events may apply, but its decay/conversion cannot repeat.
    return { events: out, config: { ...config, skipSchedulePairs: entries.map(e => `${e.from}→${e.to}`), skipScheduleSelves: entries.filter(e => e.restoreSelf).map(e => e.from) } };
}
