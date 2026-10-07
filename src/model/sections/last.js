// ──────────────────────────────────────────────────────────────────────────────
// 🧾 LAST — the newest few beats, concrete events and words later turns must
// honour. Each reply adds its beats; the oldest drop off. Pure.
// ──────────────────────────────────────────────────────────────────────────────

import { esc, unesc } from "../text.js";

export default {
    key: "last",
    title: "🧾 LAST",
    match: /^LAST$/,
    change: "Last",
    aliases: ["Last beats"],
    carried: true,
    empty: () => [],
    render: value => value.map(b => `- ${esc(b)}`),
    parse: rows => ({ value: rows.map(r => unesc(r.replace(/^[-*•]\s*/, ""))).filter(Boolean), errors: [] }),
    apply(state, lines) {
        for (const l of lines) if (String(l).trim()) state.last.push(String(l).trim());
        return [];
    },
    after(state, ctx) {
        const keep = (ctx.config.sectionConfig && ctx.config.sectionConfig.lastBeats) || 3;
        if (state.last.length > keep) state.last = state.last.slice(-keep);
    },
    prompt: value => (value.length ? `Last beats: ${value.join(" / ")}` : ""),
    rules: () => "Last: one line per concrete event or line of dialogue from this reply that later turns must honour.",
    template: () => ["Last:", "- [a beat from this reply that later turns must honour]"],
};
