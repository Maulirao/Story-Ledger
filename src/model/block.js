// ──────────────────────────────────────────────────────────────────────────────
// The state block the extension writes into each reply — FF's <internal_states>
// layout, so the reader's FF/RF regex still folds and colours it — and the parser
// that reads it back as the next turn's starting state. Every value the next turn
// needs is visible in plain text, so editing the block by hand is how the reader
// corrects state. One fixed row grammar per section. Pure: no SillyTavern, no DOM.
// ──────────────────────────────────────────────────────────────────────────────

import { emptyState } from "./state.js";
import { describePair } from "./relations.js";
import { esc, unesc, ROW } from "./text.js";
import { SECTIONS, enabledSections, CORE_KEYS, needsPresent } from "./sections/registry.js";

export const BLOCK_MARK = "<!-- story-ledger-state v1 -->";

const clone = o => JSON.parse(JSON.stringify(o));

// ── Writing ─────────────────────────────────────────────────────────────────

// the relationships section's row for pairs the model ticked before writing their NEW line
const AWAITING = "Awaiting NEW";

const sectionHtml = (title, rows) => [`<details><summary>${title}</summary>`, ...rows, "</details>"];

function relationRows(state, config) {
    const rows = [];
    const rel = { ct: state.ct, pairs: state.rel.pairs, selves: state.rel.selves };
    for (const p of Object.values(state.rel.pairs)) {
        const axes = config.axes.map(a => `${a.key} ${p.axes[a.key]}·${p.acc[a.key] ?? 0}`).join(" ");
        const d = describePair(rel, p.from, p.to, config);
        const flags = [`romance ${d.romance}`];
        if (d.walls.length) flags.push(`WALL ${d.walls.join(", ")}`);
        if (d.patterns.length) flags.push(`reads as ${d.patterns.join(", ")}`);
        rows.push(`- <b>${esc(p.from)} → ${esc(p.to)}</b> | ${axes} | ${flags.join(" · ")}`);
    }
    for (const [who, self] of Object.entries(state.rel.selves)) rows.push(`- <b>${esc(who)}</b> | Φ ${self.phi}·${self.acc}`);
    for (const [k, note] of Object.entries(state.rel.awaiting || {})) rows.push(`- <b>${AWAITING}: ${esc(k.replace("→", " → "))}</b> | ${note ? esc(note) : "—"}`);
    return rows;
}

/** The block for `state`. `rules` are the reader's [R] list (shown, never read back). */
export function renderBlock(state, { rules = [], config, sections = {} }) {
    const on = k => (sections || {})[k] !== false;
    const ids = Object.entries(state.ids || {}).filter(([, n]) => n > 0).map(([k, n]) => `${k}${n}`).join(" ");
    const out = ["<!-- GFX_START -->", BLOCK_MARK, ...(ids ? [`<!-- story-ledger-ids ${ids} -->`] : []), "<internal_states>",
        `<details><summary>🎬 INTERNAL STATES (Turn: ${state.ct}) </summary>`];
    const presentRow = `- <b>Present:</b> ${state.scene.present.map(esc).join(", ")}`;
    if (on("scene")) out.push(...sectionHtml("🕰️ SCENE", [
        `- <b>Now:</b> ${esc(state.scene.now)}`,
        presentRow,
        `- <b>Public:</b> ${state.scene.public ? "yes" : "no"}`,
    ]));
    else if (needsPresent(sections)) out.push(...sectionHtml("🕰️ SCENE", [presentRow]));   // agendas/cast need it
    if (on("relationships")) out.push(...sectionHtml("💞 RELATIONSHIPS", relationRows(state, config)));
    if (on("notebook")) out.push(...sectionHtml("📓 NOTEBOOK", [
        ...rules.map(r => `- [R] ${esc(r)}`),
        ...state.threads.map(t => `- [T] ${esc(t)}`),
    ]));
    const ctx = { config, checkStyle: (config && config.checkStyle) || "dnd", state };
    for (const sec of enabledSections(sections)) {
        const value = sec.carried ? (state[sec.key] ?? sec.empty()) : (state.perTurn || {})[sec.key];
        if (!sec.carried && (value === undefined || (sec.isEmpty && sec.isEmpty(value)))) continue;
        const title = typeof sec.title === "function" ? sec.title(ctx) : sec.title;
        out.push(...sectionHtml(title, sec.render(value, ctx)));
    }
    out.push("</details>", "</internal_states>", "<!-- GFX_END -->");
    return out.join("\n");
}

// ── Reading ─────────────────────────────────────────────────────────────────

// A block is only ever cut out when it is CLOSED. A lazy match may not run across
// another block's start or a Story_Ledger comment, so an unclosed foreign block can
// never take the prose (or the model's comment) after it along.
const NO_COMMENT = String.raw`(?!<!--\s*Story_Ledger\b)`;
const GFX_CLOSED = new RegExp(String.raw`<!--\s*GFX_START\s*-->(?:(?!<!--\s*GFX_START\s*-->)${NO_COMMENT}[\s\S])*?<!--\s*GFX_END\s*-->`, "i");
const IS_CLOSED = new RegExp(String.raw`(?:<!--\s*GFX_START\s*-->\s*)?<internal_states>(?:(?!<internal_states>)${NO_COMMENT}[\s\S])*?<\/internal_states>(?:\s*<!--\s*GFX_END\s*-->)?`, "i");

/** Our block or any FF-style block in a message, closed: { start, end } of the first one, or null. */
export function findBlock(mes) {
    const text = String(mes || "");
    const m = text.match(GFX_CLOSED) || text.match(IS_CLOSED);
    return m ? { start: m.index, end: m.index + m[0].length } : null;
}

const titleKey = t => t.replace(/[^A-Za-z ]/g, " ").replace(/\s+/g, " ").trim().toUpperCase();

/** Section title → its row lines (between its </summary> and the next <details> or </details>). */
function sectionsOf(text) {
    const out = {};
    const re = /<summary>([\s\S]*?)<\/summary>/gi;
    let m;
    while ((m = re.exec(text))) {
        const rest = text.slice(re.lastIndex);
        const stop = rest.search(/<\/?details\b/i);
        const body = stop < 0 ? rest : rest.slice(0, stop);
        out[titleKey(m[1])] = body.split(/\r?\n/).map(l => l.trim()).filter(l => /^[-*•]/.test(l));
    }
    return out;
}

/** Every carried section key: the phase-1 three and the registry's. */
export const SECTION_KEYS = [...CORE_KEYS, ...SECTIONS.filter(s => s.carried).map(s => s.key)];

function parseScene(rows, base, errors) {
    for (const row of rows) {
        const m = row.match(ROW);
        const field = m && m[1].replace(/:\s*$/, "").trim().toLowerCase();
        const value = m ? unesc(m[2].replace(/^:\s*/, "")) : "";
        if (field === "now") base.scene.now = value;
        else if (field === "present") base.scene.present = value ? value.split(/\s*,\s*/).filter(Boolean) : [];
        else if (field === "public") base.scene.public = /^(yes|true)/i.test(value);
        else errors.push({ section: "SCENE", row });
    }
}

function parseRelations(rows, base, prev, config, errors) {
    const pairs = {}, selves = {}, awaiting = {};
    for (const row of rows) {
        const m = row.match(ROW);
        if (!m) { errors.push({ section: "RELATIONSHIPS", row }); continue; }
        const name = unesc(m[1]);
        const fields = m[2].replace(/^\|\s*/, "");
        if (name === AWAITING) {   // the first build's one-row form: "Awaiting NEW | A → B · C → D"
            for (const k of fields.split(/\s+·\s+/).map(x => unesc(x).trim()).filter(Boolean)) awaiting[k.replace(/\s*→\s*/, "→")] = "";
            continue;
        }
        if (name.startsWith(`${AWAITING}:`)) {
            const note = unesc(fields).trim();
            awaiting[name.slice(AWAITING.length + 1).trim().replace(/\s*→\s*/, "→")] = note === "—" ? "" : note;
            continue;
        }
        const arrow = name.lastIndexOf(" → ");
        if (arrow > 0) {
            const from = name.slice(0, arrow).trim(), to = name.slice(arrow + 3).trim();
            const key = `${from}→${to}`;
            const axes = {}, acc = {};
            for (const t of fields.matchAll(/\b([A-Za-z]{1,3})\s+(-?\d+)·(-?\d+)/g)) { axes[t[1]] = Number(t[2]); acc[t[1]] = Number(t[3]); }
            if (config.axes.every(a => a.key in axes)) pairs[key] = { from, to, axes, acc };
            else {
                errors.push({ section: "RELATIONSHIPS", row });
                if (prev?.rel?.pairs?.[key]) pairs[key] = clone(prev.rel.pairs[key]);
            }
        } else {
            const phi = fields.match(/Φ\s*(-?\d+)·(-?\d+)/);
            if (phi) selves[name] = { phi: Number(phi[1]), acc: Number(phi[2]) };
            else {
                errors.push({ section: "RELATIONSHIPS", row });
                if (prev?.rel?.selves?.[name]) selves[name] = clone(prev.rel.selves[name]);
            }
        }
    }
    base.rel = { pairs, selves, awaiting };
}

/**
 * The state a block holds, or null when the text has no Story Ledger block. A section
 * that is missing keeps `prev`'s value; a row that does not parse keeps `prev`'s value
 * for that item and is reported in `errors`.
 */
export function parseBlock(text, { prev = null, config }) {
    const t = String(text || "");
    const at = t.indexOf(BLOCK_MARK);
    if (at < 0) return null;
    const endAt = t.search(/<!--\s*GFX_END\s*-->/i);
    const block = t.slice(at, endAt > at ? endAt : undefined);
    const base = prev ? clone(prev) : emptyState();
    const errors = [];
    const ct = block.match(/INTERNAL STATES\s*\(Turn:\s*(\d+)\)/i);
    if (ct) base.ct = Number(ct[1]);
    const ids = t.slice(at).match(/<!--\s*story-ledger-ids([^>]*?)-->/);
    if (ids) {
        base.ids = { ...(base.ids || {}) };
        for (const m of ids[1].matchAll(/([A-Z])(\d+)/g)) base.ids[m[1]] = Math.max(base.ids[m[1]] || 0, Number(m[2]));
    }
    const secs = sectionsOf(block);
    const found = [];
    if (secs.SCENE) { parseScene(secs.SCENE, base, errors); found.push("scene"); }
    if (secs.RELATIONSHIPS) { parseRelations(secs.RELATIONSHIPS, base, prev, config, errors); found.push("relationships"); }
    if (secs.NOTEBOOK) {
        base.threads = secs.NOTEBOOK
            .map(r => r.match(/^[-*•]\s*\[T\]\s*(.*)$/i)).filter(Boolean).map(m => unesc(m[1])).filter(Boolean);
        found.push("notebook");
    }
    for (const sec of SECTIONS.filter(x => x.carried)) {
        const title = Object.keys(secs).find(k => sec.match.test(k));
        if (!title) { if (base[sec.key] === undefined) base[sec.key] = sec.empty(); continue; }
        const r = sec.parse(secs[title], prev ? prev[sec.key] : undefined);
        base[sec.key] = r.value;
        for (const row of r.errors) errors.push({ section: title, row });
        found.push(sec.key);
    }
    base.perTurn = {};
    return { state: base, errors, sections: found };
}

/**
 * The message with one section's rows replaced in its Story Ledger block — nothing else
 * in the text changes (per-turn sections, which are never read back, survive). `match`
 * is tested against the section title with its emoji and punctuation removed. Null when
 * the message has no Story Ledger block or no such section.
 */
export function replaceSectionRows(mes, match, rows) {
    const text = String(mes || "");
    const at = text.indexOf(BLOCK_MARK);
    if (at < 0) return null;
    const endRel = text.slice(at).search(/<!--\s*GFX_END\s*-->/i);
    const end = endRel < 0 ? text.length : at + endRel;   // never look past the block
    const eol = /\r\n/.test(text) ? "\r\n" : "\n";         // keep the message's line endings
    const re = /<summary>([\s\S]*?)<\/summary>/gi;
    re.lastIndex = at;
    let m;
    while ((m = re.exec(text)) && m.index < end) {
        if (!match.test(titleKey(m[1]))) continue;
        const start = re.lastIndex;
        const stop = text.slice(start, end).search(/<\/?details\b/i);
        if (stop < 0) return null;
        const body = text.slice(start, start + stop).startsWith("\r\n") || !/\r\n/.test(text) ? "" : "";
        return `${text.slice(0, start)}${eol}${rows.join(eol)}${rows.length ? eol : ""}${text.slice(start + stop)}${body}`;
    }
    return null;
}
