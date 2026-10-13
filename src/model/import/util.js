// ──────────────────────────────────────────────────────────────────────────────
// Helpers shared by the importers: other presets' blocks are written by models,
// so everything here is tolerant — markup optional, separators varied. Pure.
// ──────────────────────────────────────────────────────────────────────────────

import { parseStoryTime } from "../storytime.js";

/** Text with tags removed, entities decoded and whitespace collapsed. */
export const plain = s => String(s ?? "")
    .replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "")
    .replace(/&#124&#59;/g, "|;").replace(/&#59;/g, ";").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#124;/g, "|").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim();

/** "None", "—", "-", "N/A" and empty read as "". */
export const value = s => { const t = plain(s); return /^(none|—|-|n\/a|nothing|empty)?$/i.test(t) ? "" : t; };

const titleKey = t => plain(t).replace(/[^A-Za-z ]/g, " ").replace(/\s+/g, " ").trim().toUpperCase();

/** `<details><summary>TITLE</summary> body` → [{ title, key, body }] for every summary in `text`. */
export function summarySections(text) {
    const out = [];
    const re = /<summary>([\s\S]*?)<\/summary>/gi;
    let m;
    while ((m = re.exec(text))) {
        const rest = text.slice(re.lastIndex);
        const stop = rest.search(/<\/?details\b/i);
        out.push({ title: plain(m[1]), key: titleKey(m[1]), body: stop < 0 ? rest : rest.slice(0, stop) });
    }
    return out;
}

/** A section body's rows: split on newlines and <br>, list bullets removed, blanks dropped. */
export const rowsOf = body => String(body || "").split(/\r?\n|<br\s*\/?>/i)
    .map(l => l.trim().replace(/^[-*•]\s*/, "")).filter(l => plain(l));

/** "<b>Name</b> | Key: v | Key: v" → { name, fields: { key: value } } (keys lower-cased). */
export function rowFields(row) {
    const b = row.match(/^<b>([\s\S]*?)<\/b>\s*(.*)$/);
    const name = b ? plain(b[1]).replace(/:\s*$/, "") : "";
    const rest = b ? b[2] : row;
    const fields = {};
    for (const part of rest.split("|")) {
        const m = plain(part).match(/^([A-Za-z][A-Za-z/ ]*?)\s*:\s*([\s\S]*)$/);
        if (m) fields[m[1].trim().toLowerCase()] = m[2];
    }
    return { name, rest: plain(rest), fields };
}

/** A comma/semicolon list, empties and "None" dropped. */
export const listOf = s => (value(s) ? value(s).split(/\s*[,;]\s*/).map(x => x.trim()).filter(Boolean) : []);

const HEADER = /^\s*\[\s*🕰️?\s*([^\]\n]+?)\s*\]\s*$/m;

/** An FF/AA time-and-place header line as a Now line ("Day 3 - Tuesday | 9:42 PM | Lake - Lawn"), or "". */
export function headerNow(mes) {
    const h = String(mes || "").match(HEADER);
    if (!h) return "";
    return h[1].split("|").map(p => plain(p).replace(/^[^\w]*(Time\s+)?/i, "").trim()).filter(Boolean).join(" | ");
}

/** True when an imported Now carries a clock time — without one, deadlines and due checks cannot run. */
export const nowResolved = now => Boolean(now) && parseStoryTime(now) !== null;

/** The handover note for an imported Now that has no clock time. */
export const nowUnread = now => `Now — the imported time "${now}" has no clock time; restate Now with the time of day`;

const nameWords = s => plain(s).toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^\p{L}\p{N}{} ]+/gu, " ").split(/\s+/).filter(Boolean);

/**
 * True when `name` is the reader's persona `userName`: case, punctuation and a
 * parenthetical are ignored, "{{user}}" always matches, and either name may carry
 * extra words ("Jan" ↔ "Jan Kowalski") as long as all of the shorter one's words match.
 */
export function sameName(name, userName) {
    if (/^\s*\{\{user\}\}\s*$/i.test(plain(name))) return true;
    const a = nameWords(name), b = nameWords(userName);
    if (!a.length || !b.length) return false;
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    return short.every((w, i) => long[i] === w);
}

/**
 * Bond rows ("Mara ↔ Jan · BOND: 18 · Sparks: 3", "Tom → Mara: wary, 6") → { "A→B": what the
 * row recorded }. A two-way bond is one relationship per direction, except that {{user}}'s
 * own feelings are never tracked. Unreadable rows are left out.
 */
export function bondsOf(rows, userName) {
    const out = {};
    for (const row of rows) {
        const m = plain(row).replace(/^[-*•]\s*/, "").match(/^(.+?)\s*(↔|<->|→|->)\s*(.+?)\s*(?:[:·|—–]\s*(.*))?$/);
        if (!m || !value(m[1]) || !value(m[3])) continue;
        const a = m[1].trim(), b = m[3].trim(), note = (m[4] || "").trim();
        const two = m[2] === "↔" || m[2] === "<->";
        if (!sameName(a, userName)) out[`${a}→${b}`] = note;
        if (two && !sameName(b, userName)) out[`${b}→${a}`] = note;
    }
    return out;
}

/** A section the importer could not read, quoted for the handover (the old block is stripped from the prompt). */
export function quoted(title, body, max = 600) {
    const text = plain(body);
    return text ? `${title}: "${text.length > max ? `${text.slice(0, max)}…` : text}"` : title;
}
