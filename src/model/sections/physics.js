// 🌌 PHYSICS, ENGINE & WORLD — this reply's environment and spatial positioning. Never carried. Pure.

import { esc } from "../text.js";
import { commandTemplate } from "../commands.js";

const COMMANDS = [
    { id: "physics.env", form: "Env: …", example: "Env: steady rain, lamplight, slick cobbles", keywords: ["Env"] },
    { id: "physics.scene", form: "Scene: …", example: "Scene: Mara at the door, Jan three paces back, the alley out of sight", keywords: ["Scene"] },
];

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
    rules: () => "Physics: Env is this reply's hazards, weather and light; Scene is positions, distances and line of sight.",
    commands: COMMANDS,
    template: ctx => commandTemplate("Physics", COMMANDS, ctx),
};
