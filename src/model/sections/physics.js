// 🌌 PHYSICS, ENGINE & WORLD — this reply's environment and spatial positioning. Never carried. Pure.

import { esc } from "../text.js";

export default {
    key: "physics",
    title: "🌌 PHYSICS, ENGINE & WORLD",
    match: /^PHYSICS ENGINE WORLD$/,
    change: "Physics",
    carried: false,
    empty: () => ({ env: "", scene: "" }),
    isEmpty: v => !v.env && !v.scene,
    render: value => [
        ...(value.env ? [`- <b>Env:</b> ${esc(value.env)}`] : []),
        ...(value.scene ? [`- <b>Scene:</b> ${esc(value.scene)}`] : []),
    ],
    parse: () => ({ value: { env: "", scene: "" }, errors: [] }),
    apply(state, lines) {
        const unparsed = [];
        for (const raw of lines) {
            const m = String(raw).trim().match(/^(env|scene|physics)\s*:\s*(.+)$/i);
            if (m) state.perTurn.physics[m[1].toLowerCase() === "env" ? "env" : "scene"] = m[2].trim();
            else unparsed.push(String(raw).trim());
        }
        return unparsed;
    },
    prompt: () => "",
    rules: () => "",
    template: () => ["Physics:", "- [Env: hazards, weather, light · Scene: positions, distances, line of sight]"],
};
