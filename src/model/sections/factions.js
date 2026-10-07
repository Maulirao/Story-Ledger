// ──────────────────────────────────────────────────────────────────────────────
// 🏳️ FACTIONS — groups with their own goals. Pure.
// ──────────────────────────────────────────────────────────────────────────────

import { esc, unesc, ROW, fieldsOf } from "../text.js";
import { findName } from "./people.js";
import { commandTemplate } from "../commands.js";

const FIELDS = ["goal", "intel", "fibs", "state", "conflict", "relations"];
const LABEL = { goal: "Goal", intel: "Intel", fibs: "Fibs", state: "State", conflict: "Conflict", relations: "Relations" };
const blank = () => Object.fromEntries(FIELDS.map(f => [f, ""]));
const show = v => (v ? esc(v) : "—");
const read = v => { const t = unesc(v ?? ""); return t === "—" ? "" : t; };

// one field per line; the "|"-grouped form stays readable but is not taught
const COMMANDS = [
    { id: "factions.goal", form: "Name: goal: text", example: "Harbour Guild: goal: control the docks", keywords: ["goal"] },
    { id: "factions.intel", form: "Name: intel: text", example: "Harbour Guild: intel: knows about the smuggling", keywords: ["intel"] },
    { id: "factions.fibs", form: "Name: fibs: text", example: "Harbour Guild: fibs: claims the tolls fund repairs", keywords: ["fibs"] },
    { id: "factions.state", form: "Name: state: text", example: "Harbour Guild: state: shaken after the fire", keywords: ["state"] },
    { id: "factions.conflict", form: "Name: conflict: text", example: "Harbour Guild: conflict: the fishermen's union", keywords: ["conflict"] },
    { id: "factions.relations", form: "Name: relations: text", example: "Harbour Guild: relations: courts the mayor", keywords: ["relations"] },
    { id: "factions.drop", form: "drop: Name", example: "drop: Harbour Guild", keywords: ["drop"] },
];

/** Read field updates, grouped labels sharing a value, and continuation notes. */
function fieldParts(text) {
    const parts = String(text).split(/\s*([|·])\s*/);
    const updates = [], pending = [];
    const field = label => label.toLowerCase() === "fib" ? "fibs" : label.toLowerCase();
    let current = [];
    for (let i = 0; i < parts.length; i += 2) {
        const part = parts[i].trim();
        const valued = part.match(/^(goal|intel|fibs?|state|conflict|relations)(?:\s*:\s*|\s+(?!:))(\S.*)$/i);
        const bare = part.match(/^(goal|intel|fibs?|state|conflict|relations)$/i);
        if (valued) {
            current = [...pending.splice(0), field(valued[1])].map(k => [k, valued[2].trim()]);
            updates.push(...current);
        } else if (bare) pending.push(field(bare[1]));
        else {
            // Unknown labels and incomplete groups must not silently overwrite known fields.
            if (!part || pending.length || !current.length || /^[^:]+:/.test(part)) return null;
            for (const update of current) update[1] += ` ${parts[i - 1]} ${part}`;
        }
    }
    return updates.length && !pending.length ? updates : null;
}

export default {
    key: "factions",
    title: "🏳️ FACTIONS",
    match: /^FACTIONS$/,
    change: "Factions",
    aliases: ["Faction"],
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
    commands: COMMANDS,
    template: ctx => commandTemplate("Factions", COMMANDS, ctx),
};
