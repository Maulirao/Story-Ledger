// ──────────────────────────────────────────────────────────────────────────────
// Text helpers shared by the block and its sections: escaping values for a row,
// and reading a row back. Pure.
// ──────────────────────────────────────────────────────────────────────────────

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
