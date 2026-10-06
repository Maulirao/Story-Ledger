// ──────────────────────────────────────────────────────────────────────────────
// 🏳️ FACTIONS — groups with their own goals. Pure.
// ──────────────────────────────────────────────────────────────────────────────

import { esc, unesc, ROW, fieldsOf } from "../text.js";
import { findName } from "./people.js";

const FIELDS = ["goal", "intel", "fibs", "state", "conflict", "relations"];
const LABEL = { goal: "Goal", intel: "Intel", fibs: "Fibs", state: "State", conflict: "Conflict", relations: "Relations" };
const blank = () => Object.fromEntries(FIELDS.map(f => [f, ""]));
const show = v => (v ? esc(v) : "—");
const read = v => { const t = unesc(v ?? ""); return t === "—" ? "" : t; };

/** "intel … | state: …" → [["intel", "…"], ["state", "…"]]; null unless every part names a field. */
function fieldParts(text) {
    const parts = String(text).split(/\s+[|·]\s+/).map(p => p.match(/^(goal|intel|fibs?|state|conflict|relations)\b\s*:?\s*(.+)$/i));
    if (!parts.length || parts.some(p => !p)) return null;
    return parts.map(p => [p[1].toLowerCase() === "fib" ? "fibs" : p[1].toLowerCase(), p[2].trim()]);
}

export default {
    key: "factions",
    title: "🏳️ FACTIONS",
    match: /^FACTIONS$/,
    change: "Factions",
    carried: true,
    empty: () => ({}),
    render: value => Object.entries(value).map(([n, f]) => `- <b>${esc(n)}</b> | ${FIELDS.map(k => `${LABEL[k]}: ${show(f[k])}`).join(" | ")}`),
    parse(rows, prevValue) {
        const value = {}, errors = [];
        for (const row of rows) {
            const m = row.match(ROW);
            const f = m && fieldsOf(m[2]);
            if (m && f && FIELDS.some(k => k in f)) value[unesc(m[1])] = Object.fromEntries(FIELDS.map(k => [k, read(f[k])]));
            else {
                errors.push(row);
                const name = m && unesc(m[1]);
                if (name && prevValue && prevValue[name]) value[name] = prevValue[name];
            }
        }
        return { value, errors };
    },
    apply(state, lines) {
        const unparsed = [];
        for (const raw of lines) {
            const line = String(raw).trim();   // parseChanges already removed the list bullet
            let m;
            if ((m = line.match(/^drop\s*:\s*(.+)$/i))) {
                const n = findName(Object.keys(state.factions), m[1]);
                if (state.factions[n]) delete state.factions[n]; else unparsed.push(line);
            } else if ((m = line.match(/^(.+?)\s*:\s*(.+)$/)) && fieldParts(m[2])) {
                // "Name: field: text", or several fields the way the state shows them:
                // "Name: intel … | state …" (also "·"-separated, colon after the field optional)
                const n = findName(Object.keys(state.factions), m[1]);
                state.factions[n] = state.factions[n] || blank();
                for (const [k, text] of fieldParts(m[2])) state.factions[n][k] = text;
            } else unparsed.push(line);
        }
        return unparsed;
    },
    prompt(value) {
        const rows = Object.entries(value).map(([n, f]) => `- ${n}: ${FIELDS.filter(k => f[k]).map(k => `${k} ${f[k]}`).join(" · ")}`);
        return rows.length ? ["Factions:", ...rows].join("\n") : "";
    },
    rules: () => "Factions are groups with their own goals, intel, lies, morale and rivalries; update a field only when the story changes it.",
    template: () => ["Factions:", "- [Name: goal|intel|fibs|state|conflict|relations: text — only what changed; drop: Name]"],
};
