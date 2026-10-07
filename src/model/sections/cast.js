// ──────────────────────────────────────────────────────────────────────────────
// 👥 SCENE CAST — who is present, where each is, what they wear and hold, and their
// physical state. People who leave the scene drop out of it. Pure.
// ──────────────────────────────────────────────────────────────────────────────

import { esc, unesc, ROW, fieldsOf } from "../text.js";
import { findName, hasName } from "./people.js";

const FIELDS = ["position", "wearing", "holding", "condition"];
const LABEL = { position: "Position", wearing: "Wearing", holding: "Holding", condition: "Condition" };
const blank = () => Object.fromEntries(FIELDS.map(f => [f, ""]));
const show = v => (v ? esc(v) : "—");
const read = v => { const t = unesc(v ?? ""); return t === "—" ? "" : t; };

export default {
    key: "cast",
    title: "👥 SCENE CAST",
    match: /^SCENE CAST$/,
    change: "Cast",
    aliases: ["Scene cast"],
    carried: true,
    empty: () => ({}),
    render: value => Object.entries(value).map(([n, c]) => `- <b>${esc(n)}</b> | ${FIELDS.map(k => `${LABEL[k]}: ${show(c[k])}`).join(" | ")}`),
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
            const line = String(raw).trim();
            const m = line.match(/^(.+?)\s*:\s*(position|wearing|holding|condition)\s*:\s*(.+)$/i);
            if (!m) { unparsed.push(line); continue; }
            const n = findName([...Object.keys(state.cast), ...state.scene.present], m[1]);
            state.cast[n] = state.cast[n] || blank();
            state.cast[n][m[2].toLowerCase()] = m[3].trim();
        }
        return unparsed;
    },
    after(state) {
        for (const n of Object.keys(state.cast)) if (!hasName(state.scene.present, n)) delete state.cast[n];
    },
    prompt(value) {
        const rows = Object.entries(value).map(([n, c]) => `- ${n}: ${FIELDS.filter(k => c[k]).map(k => `${k} ${c[k]}`).join(" · ")}`);
        return rows.length ? ["In the scene:", ...rows].join("\n") : "";
    },
    rules: () => "Cast: for each person present — where they are relative to the others, what they are wearing now, what is in their hands, notable physical state (injured, wet, tired, drunk, hungry, aroused). Report only what changed; clothes and objects do not reappear once removed or put down.",
    template: () => ["Cast:", "- [Name: position|wearing|holding|condition: text — only what changed]"],
};
