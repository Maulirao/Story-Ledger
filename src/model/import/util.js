// ──────────────────────────────────────────────────────────────────────────────
// Helpers shared by the importers: other presets' blocks are written by models,
// so everything here is tolerant — markup optional, separators varied. Pure.
// ──────────────────────────────────────────────────────────────────────────────

/** Text with tags removed, entities decoded and whitespace collapsed. */
export const plain = s => String(s ?? "")
    .replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#124;/g, "|").replace(/&amp;/g, "&")
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
