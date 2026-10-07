// ──────────────────────────────────────────────────────────────────────────────
// 🎒 INV & SKILLS — {{user}}'s items, titles, conditions and roll modifiers.
// Tracked for {{user}} only. Lists are "; "-separated; a ";" inside a value is
// written as &#59;. Pure.
// ──────────────────────────────────────────────────────────────────────────────

import { esc, unesc, ROW } from "../text.js";

const ROWS = [["items", "Inv"], ["titles", "Titles/Skills"], ["status", "Status"]];
const writeList = list => list.map(v => esc(v).replace(/;/g, "&#59;")).join("; ") || "—";
// split on ";" that is not the end of an entity such as &amp; or &#124;
const readList = text => {
    const t = String(text || "").trim();
    if (!t || t === "—") return [];
    return t.split(/(?<!&(?:amp|lt|gt|#\d+));\s*/).map(v => unesc(v.replace(/&#59;/g, ";"))).filter(Boolean);
};
const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
const remove = (list, v) => { const i = list.findIndex(x => same(x, v)); if (i < 0) return false; list.splice(i, 1); return true; };

function removeItem(list, text) {
    if (remove(list, text)) return true;
    // Strip a removal explanation, but keep name qualifiers such as "(blue)" significant.
    const item = text.replace(/\s+\((?:dropped|lost|used|left|given|consumed|discarded|spent|handed)\b[^()]*\)\s*$/i, "").trim();
    if (item !== text && remove(list, item)) return true;
    const single = item.match(/^1\s+(.+)$/);
    return Boolean(single && remove(list, single[1]));
}

export default {
    key: "inv",
    title: "🎒 INV & SKILLS",
    match: /^INV SKILLS$/,
    change: "Inventory",
    aliases: ["Inv", "Inv & Skills"],
    carried: true,
    empty: () => ({ items: [], titles: [], status: [], mods: "" }),
    render: value => [
        ...ROWS.map(([k, label]) => `- <b>${label}:</b> ${writeList(value[k])}`),
        `- <b>Mods:</b> ${value.mods ? esc(value.mods) : "—"}`,
    ],
    parse(rows, prevValue) {
        const value = { items: [], titles: [], status: [], mods: "" }, errors = [];
        for (const row of rows) {
            const m = row.match(ROW);
            const label = m && m[1].replace(/:\s*$/, "").trim().toLowerCase();
            const hit = m && ROWS.find(([, l]) => l.toLowerCase() === label);
            if (hit) value[hit[0]] = readList(m[2]);
            else if (label === "mods") { const t = unesc(m[2]); value.mods = t === "—" ? "" : t; }
            else errors.push(row);
        }
        if (errors.length && prevValue) for (const k of ["items", "titles", "status"]) if (!value[k].length) value[k] = prevValue[k];
        return { value, errors };
    },
    apply(state, lines) {
        const inv = state.inv;
        const unparsed = [];
        for (const raw of lines) {
            const line = String(raw).trim();   // parseChanges already removed the list bullet
            let m;
            if ((m = line.match(/^title\s*:\s*(.+)$/i))) { if (!inv.titles.some(t => same(t, m[1]))) inv.titles.push(m[1].trim()); }
            else if ((m = line.match(/^title\s*-\s*(.+)$/i))) { if (!remove(inv.titles, m[1])) unparsed.push(line); }
            else if ((m = line.match(/^status\s*[:+]\s*(.+)$/i))) {
                // A model's semicolon-separated status recap adds conditions; only status - removes one.
                const conditions = readList(m[1]);
                if (!conditions.length) unparsed.push(line);
                for (const condition of conditions) if (!inv.status.some(t => same(t, condition))) inv.status.push(condition);
            }
            else if ((m = line.match(/^status\s*-\s*(.+)$/i))) {
                // Keep literal legacy values containing semicolons removable by their exact name.
                if (remove(inv.status, m[1])) continue;
                const conditions = readList(m[1]);
                if (!conditions.length) unparsed.push(line);
                for (const condition of conditions) if (!remove(inv.status, condition)) unparsed.push(`status - ${condition}`);
            }
            else if ((m = line.match(/^mods\s*:\s*(.*)$/i))) inv.mods = m[1].trim();
            else if ((m = line.match(/^\+\s*(.+)$/))) inv.items.push(m[1].trim());
            else if ((m = line.match(/^-\s*(.+)$/))) { if (!removeItem(inv.items, m[1])) unparsed.push(line); }
            else unparsed.push(line);
        }
        return unparsed;
    },
    prompt(value) {
        const parts = [];
        if (value.items.length) parts.push(`carries ${value.items.join("; ")}`);
        if (value.titles.length) parts.push(`titles ${value.titles.join("; ")}`);
        if (value.status.length) parts.push(`status ${value.status.join("; ")}`);
        if (value.mods) parts.push(`mods ${value.mods}`);
        return parts.length ? `{{user}}: ${parts.join(" · ")}` : "";
    },
    rules: () => "Inventory is {{user}}'s alone: add items when found, remove them when lost or used; award a title for a real accomplishment; track temporary conditions (Injured, Tired, Inspired) and clear them with time or action. Mods are ±1–2 on rolls in the domain they fit only. Never put stats, modifiers or title names in prose.",
    template: () => ["Inventory:", "- [+ item · - item · title: … · title - … · status + X · status - X · mods: … — {{user}} only]"],
};
