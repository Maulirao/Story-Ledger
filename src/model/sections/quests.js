// ──────────────────────────────────────────────────────────────────────────────
// 📜 QUESTS — main and side goals with ids. Finished and dropped quests stay in
// the block for good (the reader's choice); ids are counted, never reused. Pure.
// ──────────────────────────────────────────────────────────────────────────────

import { esc, unesc, ROW, fieldsOf, closedForm } from "../text.js";
import { nextId } from "../state.js";
import { commandTemplate } from "../commands.js";

const STATUS = ["active", "done", "dropped"];
const show = v => (v ? esc(v) : "—");
const read = v => { const t = unesc(v ?? ""); return t === "—" ? "" : t; };
const byId = (state, id) => state.quests.find(q => q.id.toLowerCase() === String(id).toLowerCase());

const COMMANDS = [
    { id: "quests.add-main", form: "+ Main: objective (reward)", example: "+ Main: find the missing ferryman (the title Harbour Friend)", keywords: ["Main"] },
    { id: "quests.add-side", form: "+ Side: objective (reward)", example: "+ Side: return the lost dog (a free meal)", keywords: ["Side"] },
    { id: "quests.progress", form: "Q# progress: text", example: "Q1 progress: the ferryman was seen at the mill", keywords: ["progress"] },
    { id: "quests.done", form: "done Q#", example: "done Q1", keywords: ["done"] },
    { id: "quests.drop", form: "drop Q#", example: "drop Q1", keywords: ["drop"] },
    { id: "quests.reopen", form: "reopen Q#", example: "reopen Q1", keywords: ["reopen"] },
];

export default {
    key: "quests",
    title: "📜 QUESTS",
    match: /^QUESTS$/,
    change: "Quests",
    aliases: ["Quest"],
    carried: true,
    empty: () => [],
    render: value => value.map(q => `- <b>${q.id} ${q.kind}</b> | ${q.status}${q.status !== "active" && q.send ? " · sent" : ""} | Objective: ${show(q.objective)} | Progress: ${show(q.progress)} | Reward: ${show(q.reward)}`),
    parse(rows, prevValue) {
        const value = [], errors = [];
        for (const row of rows) {
            const m = row.match(ROW);
            const head = m && unesc(m[1]).match(/^(Q\d+)\s+(Main|Side)$/i);
            const seg = m && (m[2].split("|").map(p => p.trim()).find(p => STATUS.includes(p.split("·")[0].trim().toLowerCase())) || "");
            const status = seg && seg.split("·")[0].trim();
            const send = Boolean(seg) && /·\s*sent\b/i.test(seg);
            const f = m && fieldsOf(m[2]);
            if (head && status && f && "objective" in f) {
                value.push({ id: head[1].toUpperCase(), kind: head[2][0].toUpperCase() + head[2].slice(1).toLowerCase(), status: status.toLowerCase(),
                    objective: read(f.objective), progress: read(f.progress), reward: read(f.reward), send });
            } else {
                errors.push(row);
                const old = head && (prevValue || []).find(q => q.id === head[1].toUpperCase());
                if (old) value.push(old);
            }
        }
        return { value, errors };
    },
    apply(state, lines, ctx) {
        const unparsed = [];
        // the comment path accepts one terminal punctuation mark on a closed form
        const closed = ctx && ctx.normalizedChanges ? closedForm : s => s;
        for (const raw of lines) {
            const line = String(raw).trim();   // parseChanges already removed the list bullet
            let m, q;
            if ((m = line.match(/^\+\s*(Main|Side)\s*:\s*(.+?)\s*(?:\(([^()]*)\))?$/i))) {
                state.quests.push({ id: nextId(state, "Q", state.quests.map(x => x.id)), kind: m[1][0].toUpperCase() + m[1].slice(1).toLowerCase(), status: "active",
                    objective: m[2].trim(), progress: "", reward: (m[3] || "").trim(), send: false });
            } else if ((m = line.match(/^(Q\d+)\s*:?\s+(?:(?:Main|Side)\s+)?progress\s*:\s*(.+)$/i)) && (q = byId(state, m[1]))) q.progress = m[2].trim();   // "Q1 Main progress:" and "Q1: progress:" too
            else if ((m = closed(line).match(/^(done|drop|reopen)\s+(Q\d+)$/i)) && (q = byId(state, m[2]))) {
                q.status = { done: "done", drop: "dropped", reopen: "active" }[m[1].toLowerCase()];
            } else if ((m = line.match(/^(Q\d+)\b\s*(.*:.*)$/i)) && (q = byId(state, m[1]))) {
                // any other "Q# …: text" is a progress update ("Q1 Main — <title> · Day 3: …"):
                // the kind and the quest's own title are dropped, the rest (a time, say) is kept
                let rest = m[2].replace(/^[\s:·—–-]*(?:(?:Main|Side)\b)?[\s:·—–-]*/i, "");
                if (q.objective && rest.toLowerCase().startsWith(q.objective.toLowerCase())) rest = rest.slice(q.objective.length);
                q.progress = rest.replace(/^[\s:·—–-]+/, "").trim();
            } else unparsed.push(line);
        }
        return unparsed;
    },
    prompt(value) {
        const active = value.filter(q => q.status === "active").map(q => `- ${q.id} ${q.kind} — ${q.objective}${q.progress ? ` · ${q.progress}` : ""}${q.reward ? ` · reward: ${q.reward}` : ""}`);
        // Finished quests reach the model only when the reader marked them "send" (📜 Quests tab).
        const finished = value.filter(q => q.status !== "active" && q.send).map(q => `${q.id} ${q.objective} (${q.status})`);
        const parts = [];
        if (active.length) parts.push("Quests:", ...active);
        if (finished.length) parts.push(`Finished: ${finished.join("; ")}`);
        return parts.join("\n");
    },
    rules: () => "Quests: a Main quest is the story's spine, Side quests are optional; rewards are new titles or items. Mark progress when the story moves a quest, done or drop when it ends.",
    commands: COMMANDS,
    template: ctx => commandTemplate("Quests", COMMANDS, ctx),
};

/** Mark finished quests as sent to the model or not: `ids` names them, "all" means every finished quest. Mutates. */
export function setSend(state, ids, on) {
    for (const q of state.quests || []) {
        if (q.status === "active") continue;
        if (ids === "all" || ids.some(id => id.toLowerCase() === q.id.toLowerCase())) q.send = Boolean(on);
    }
}
