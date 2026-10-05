// 🧠 INTERNAL THOUGHTS — this reply's raw NPC thoughts. Shown in the reply's block, never carried. Pure.

import { esc } from "../text.js";

export default {
    key: "thoughts",
    title: "🧠 INTERNAL THOUGHTS",
    match: /^INTERNAL THOUGHTS$/,
    change: "Thoughts",
    carried: false,
    empty: () => [],
    isEmpty: v => !v.length,
    render: value => value.map(t => `- <b>${esc(t.name)}</b> | ${esc(t.text)}`),
    parse: () => ({ value: [], errors: [] }),
    apply(state, lines) {
        const unparsed = [];
        for (const raw of lines) {
            const m = String(raw).trim().match(/^([^:]{1,60}?)\s*:\s*(.+)$/);
            if (m) state.perTurn.thoughts.push({ name: m[1].trim(), text: m[2].trim() });
            else unparsed.push(String(raw).trim());
        }
        return unparsed;
    },
    prompt: () => "",
    rules: () => "Thoughts: up to 3 NPCs, on-screen first (an off-screen one names where they are and what they are doing); 1–3 lines each, fragmented, impulsive and raw but true to the person, their mood and instincts. Let them drive what the NPC does next.",
    template: () => ["Thoughts:", "- [Name: this reply's raw thoughts]"],
};
