// ──────────────────────────────────────────────────────────────────────────────
// 🎒 INV & SKILLS — {{user}}'s items, titles, conditions and roll modifiers.
// Tracked for {{user}} only. Lists are "; "-separated; a ";" inside a value is
// written as &#59;. Pure.
// ──────────────────────────────────────────────────────────────────────────────

import { esc, unesc, ROW, removeByName } from "../text.js";
import { commandTemplate } from "../commands.js";

const COMMANDS = [
    { id: "inv.add", form: "+ item", example: "+ brass key", keywords: [] },
    { id: "inv.remove", form: "- item", example: "- brass key", keywords: [] },
    { id: "inv.title-add", form: "title: name", example: "title: Harbour Friend", keywords: ["title"] },
    { id: "inv.title-remove", form: "title - name", example: "title - Harbour Friend", keywords: ["title"] },
    { id: "inv.status-add", form: "status + condition", example: "status + Tired", keywords: ["status"] },
    { id: "inv.status-remove", form: "status - condition", example: "status - Tired", keywords: ["status"] },
    { id: "inv.mods", form: "mods: text", example: "mods: +1 Stealth (soft boots)", keywords: ["mods"] },
];

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

// a removal explanation; name qualifiers such as "(blue)" stay significant
const EXPLAINED = /\s+\((?:dropped|lost|used|left|given|consumed|discarded|spent|handed)\b[^()]*\)\s*$/i;

// `del(list, value, rawValue)` removes one entry; the raw value follows each fallback step
function removeItem(list, text, rawText, del) {
    if (del(list, text, rawText)) return true;
    const item = text.replace(EXPLAINED, "").trim();
    const rawItem = rawText === undefined ? undefined : rawText.replace(EXPLAINED, "").trim();
    if (item !== text && del(list, item, rawItem)) return true;
    const single = item.match(/^1\s+(.+)$/);
    const rawSingle = rawItem === undefined ? null : rawItem.match(/^1\s+(.+)$/);
    return Boolean(single && del(list, single[1], rawSingle ? rawSingle[1] : undefined));
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
    apply(state, lines, ctx) {
        const inv = state.inv;
        const unparsed = [];
        // the comment path removes by raw name with a quote fallback; tagged replies stay exact
        const normalized = Boolean(ctx && ctx.normalizedChanges);
        const raws = normalized ? ctx.rawLinesUnder("Inventory") : [];
        const del = normalized ? removeByName : (list, v) => remove(list, v);
        lines.forEach((text, i) => {
            const line = String(text).trim();   // parseChanges already removed the list bullet
            const rawLine = normalized && raws[i] !== undefined ? String(raws[i]).trim() : null;
            // the same capture from the unfolded line
            const rawOf = re => { const r = rawLine && rawLine.match(re); return r ? r[1] : undefined; };
            let m;
            if ((m = line.match(/^title\s*:\s*(.+)$/i))) { if (!inv.titles.some(t => same(t, m[1]))) inv.titles.push(m[1].trim()); }
            else if ((m = line.match(/^title\s*-\s*(.+)$/i))) { if (!del(inv.titles, m[1], rawOf(/^title\s*-\s*(.+)$/i))) unparsed.push(line); }
            else if ((m = line.match(/^status\s*[:+]\s*(.+)$/i))) {
                // A model's semicolon-separated status recap adds conditions; only status - removes one.
                const conditions = readList(m[1]);
                if (!conditions.length) unparsed.push(line);
                for (const condition of conditions) if (!inv.status.some(t => same(t, condition))) inv.status.push(condition);
            }
            else if ((m = line.match(/^status\s*-\s*(.+)$/i))) {
                // Keep literal legacy values containing semicolons removable by their exact name.
                const rawValue = rawOf(/^status\s*-\s*(.+)$/i);
                if (del(inv.status, m[1], rawValue)) return;
                const conditions = readList(m[1]);
                // folding never moves a ";", so both forms split into the same members
                const rawConditions = rawValue === undefined ? [] : readList(rawValue);
                const aligned = rawConditions.length === conditions.length;
                if (!conditions.length) unparsed.push(line);
                conditions.forEach((condition, j) => {
                    if (!del(inv.status, condition, aligned ? rawConditions[j] : undefined)) unparsed.push(`status - ${condition}`);
                });
            }
            else if ((m = line.match(/^mods\s*:\s*(.*)$/i))) inv.mods = m[1].trim();
            else if ((m = line.match(/^\+\s*(.+)$/))) inv.items.push(m[1].trim());
            else if ((m = line.match(/^-\s*(.+)$/))) { if (!removeItem(inv.items, m[1], rawOf(/^-\s*(.+)$/), del)) unparsed.push(line); }
            else unparsed.push(line);
        });
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
    commands: COMMANDS,
    template: ctx => commandTemplate("Inventory", COMMANDS, ctx),
};
