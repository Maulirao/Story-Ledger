// ──────────────────────────────────────────────────────────────────────────────
// 📜 QUESTS — main and side goals with ids. Finished and dropped quests stay in
// the block for good (the reader's choice); ids are counted, never reused. Pure.
// ──────────────────────────────────────────────────────────────────────────────

import { esc, unesc, ROW, fieldsOf } from "../text.js";
import { nextId } from "../state.js";

const STATUS = ["active", "done", "dropped"];
const show = v => (v ? esc(v) : "—");
const read = v => { const t = unesc(v ?? ""); return t === "—" ? "" : t; };
const byId = (state, id) => state.quests.find(q => q.id.toLowerCase() === String(id).toLowerCase());

export default {
    key: "quests",
    title: "📜 QUESTS",
    match: /^QUESTS$/,
    change: "Quests",
    carried: true,
    empty: () => [],
    render: value => value.map(q => `- <b>${q.id} ${q.kind}</b> | ${q.status} | Objective: ${show(q.objective)} | Progress: ${show(q.progress)} | Reward: ${show(q.reward)}`),
    parse(rows, prevValue) {
        const value = [], errors = [];
        for (const row of rows) {
            const m = row.match(ROW);
            const head = m && unesc(m[1]).match(/^(Q\d+)\s+(Main|Side)$/i);
            const status = m && (m[2].split("|").map(p => p.trim()).find(p => STATUS.includes(p.toLowerCase())) || "");
            const f = m && fieldsOf(m[2]);
            if (head && status && f && "objective" in f) {
                value.push({ id: head[1].toUpperCase(), kind: head[2][0].toUpperCase() + head[2].slice(1).toLowerCase(), status: status.toLowerCase(),
                    objective: read(f.objective), progress: read(f.progress), reward: read(f.reward) });
            } else {
                errors.push(row);
                const old = head && (prevValue || []).find(q => q.id === head[1].toUpperCase());
                if (old) value.push(old);
            }
        }
        return { value, errors };
    },
    apply(state, lines) {
        const unparsed = [];
        for (const raw of lines) {
            const line = String(raw).trim();   // parseChanges already removed the list bullet
            let m, q;
            if ((m = line.match(/^\+\s*(Main|Side)\s*:\s*(.+?)\s*(?:\(([^()]*)\))?$/i))) {
                state.quests.push({ id: nextId(state, "Q", state.quests.map(x => x.id)), kind: m[1][0].toUpperCase() + m[1].slice(1).toLowerCase(), status: "active",
                    objective: m[2].trim(), progress: "", reward: (m[3] || "").trim() });
            } else if ((m = line.match(/^(Q\d+)\s+progress\s*:\s*(.+)$/i)) && (q = byId(state, m[1]))) q.progress = m[2].trim();
            else if ((m = line.match(/^(done|drop|reopen)\s+(Q\d+)$/i)) && (q = byId(state, m[2]))) {
                q.status = { done: "done", drop: "dropped", reopen: "active" }[m[1].toLowerCase()];
            } else unparsed.push(line);
        }
        return unparsed;
    },
    prompt(value) {
        const active = value.filter(q => q.status === "active").map(q => `- ${q.id} ${q.kind} — ${q.objective}${q.progress ? ` · ${q.progress}` : ""}${q.reward ? ` · reward: ${q.reward}` : ""}`);
        const finished = value.filter(q => q.status !== "active").map(q => `${q.id} ${q.objective} (${q.status})`);
        const parts = [];
        if (active.length) parts.push("Quests:", ...active);
        if (finished.length) parts.push(`Finished: ${finished.join("; ")}`);
        return parts.join("\n");
    },
    rules: () => "Quests: a Main quest is the story's spine, Side quests are optional; rewards are new titles or items. Mark progress when the story moves a quest, done or drop when it ends.",
    template: () => ["Quests:", "- [+ Main|Side: objective (reward) · Q# progress: … · done Q# · drop Q# · reopen Q#]"],
};
