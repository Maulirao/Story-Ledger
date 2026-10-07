// ──────────────────────────────────────────────────────────────────────────────
// Text helpers shared by the block and its sections: escaping values for a row,
// reading a row back, and matching change-line commands and removals. Pure.
// ──────────────────────────────────────────────────────────────────────────────

import { foldQuotes } from "./normalize.js";

/** A value as it is written into a block row: one line, no markup, no bare pipes. */
export const esc = v => String(v ?? "").replace(/\r?\n/g, " ")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\|/g, "&#124;");

/** The value back from a row. */
export const unesc = v => String(v ?? "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#124;/g, "|").replace(/&amp;/g, "&").trim();

/** `- <b>Key</b> rest` → [key, rest] (both raw), or null. */
export const ROW = /^[-*•]\s*<b>([\s\S]*?)<\/b>\s*(.*)$/;

/** `| Field: value | Other: value` → { field: rawValue } (field names lower-cased). */
export function fieldsOf(rest) {
    const out = {};
    for (const part of String(rest || "").split("|").map(p => p.trim()).filter(Boolean)) {
        const m = part.match(/^([A-Za-z][A-Za-z/ ]*?)\s*:\s*([\s\S]*)$/);
        if (m) out[m[1].trim().toLowerCase()] = m[2];
    }
    return out;
}

/** A line under a change-line heading, without its list bullet. */
export const unbullet = s => String(s || "").replace(/^\s*[-*•]\s+/, "").trim();

/** A closed-form command (`done Q1.`) without one terminal `.`, `,` or `;`; an ellipsis stays. */
export const closedForm = s => String(s).replace(/(?<!\.)[.,;]$/, "").trim();

const nameKey = s => String(s).trim().toLowerCase();

/**
 * Indexes in `list` a removal of `value` names, one tier only: every exact match of
 * `rawValue`, else every exact match of `value`, else the unique quote-equivalent entry.
 */
export function nameMatches(list, value, rawValue) {
    const exact = v => list.flatMap((x, i) => (nameKey(x) === nameKey(v) ? [i] : []));
    let hits = rawValue === undefined ? [] : exact(rawValue);
    if (!hits.length) hits = exact(value);
    if (hits.length) return hits;
    const folded = nameKey(foldQuotes(value));
    hits = list.flatMap((x, i) => (nameKey(foldQuotes(x)) === folded ? [i] : []));
    return hits.length === 1 ? hits : [];
}

/** Remove one entry named by `rawValue`, then `value`, then a unique quote-equivalent. Mutates. */
export function removeByName(list, value, rawValue) {
    const hits = nameMatches(list, value, rawValue);
    if (!hits.length) return false;
    list.splice(hits[0], 1);
    return true;
}
