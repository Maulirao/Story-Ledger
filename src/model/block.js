// ──────────────────────────────────────────────────────────────────────────────
// The state block the extension writes into each reply — FF's <internal_states>
// layout, so the reader's FF/RF regex still folds and colours it — and the parser
// that reads it back as the next turn's starting state. Every value the next turn
// needs is visible in plain text, so editing the block by hand is how the reader
// corrects state. One fixed row grammar per section. Pure: no SillyTavern, no DOM.
// ──────────────────────────────────────────────────────────────────────────────

import { emptyState } from "./state.js";
import { describePair } from "./relations.js";

export const BLOCK_MARK = "<!-- story-ledger-state v1 -->";

const esc = v => String(v ?? "").replace(/\r?\n/g, " ")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\|/g, "&#124;");
const unesc = v => String(v ?? "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#124;/g, "|").replace(/&amp;/g, "&").trim();
const clone = o => JSON.parse(JSON.stringify(o));

// ── Writing ─────────────────────────────────────────────────────────────────

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
    return rows;
}

/** The block for `state`. `rules` are the reader's [R] list (shown, never read back). */
export function renderBlock(state, { rules = [], config, sections = {} }) {
    const out = ["<!-- GFX_START -->", BLOCK_MARK, "<internal_states>",
        `<details><summary>🎬 INTERNAL STATES (Turn: ${state.ct}) </summary>`];
    if (sections.scene) out.push(...sectionHtml("🕰️ SCENE", [
        `- <b>Now:</b> ${esc(state.scene.now)}`,
        `- <b>Present:</b> ${state.scene.present.map(esc).join(", ")}`,
        `- <b>Public:</b> ${state.scene.public ? "yes" : "no"}`,
    ]));
    if (sections.relationships) out.push(...sectionHtml("💞 RELATIONSHIPS", relationRows(state, config)));
    if (sections.notebook) out.push(...sectionHtml("📓 NOTEBOOK", [
        ...rules.map(r => `- [R] ${esc(r)}`),
        ...state.threads.map(t => `- [T] ${esc(t)}`),
    ]));
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

export const SECTION_KEYS = ["SCENE", "RELATIONSHIPS", "NOTEBOOK"];

const ROW = /^[-*•]\s*<b>([\s\S]*?)<\/b>\s*(.*)$/;

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
    const pairs = {}, selves = {};
    for (const row of rows) {
        const m = row.match(ROW);
        if (!m) { errors.push({ section: "RELATIONSHIPS", row }); continue; }
        const name = unesc(m[1]);
        const fields = m[2].replace(/^\|\s*/, "");
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
    base.rel = { pairs, selves };
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
    const secs = sectionsOf(block);
    if (secs.SCENE) parseScene(secs.SCENE, base, errors);
    if (secs.RELATIONSHIPS) parseRelations(secs.RELATIONSHIPS, base, prev, config, errors);
    if (secs.NOTEBOOK) base.threads = secs.NOTEBOOK
        .map(r => r.match(/^[-*•]\s*\[T\]\s*(.*)$/i)).filter(Boolean).map(m => unesc(m[1])).filter(Boolean);
    base.perTurn = {};
    return { state: base, errors, sections: Object.keys(secs).filter(k => SECTION_KEYS.includes(k)) };
}
