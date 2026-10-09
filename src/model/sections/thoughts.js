// 🧠 INTERNAL THOUGHTS — this reply's raw NPC thoughts. Shown in the reply's block, never carried. Pure.

import { esc } from "../text.js";
import { commandTemplate } from "../commands.js";

const COMMANDS = [
    { id: "thoughts.thought", form: "Name: this reply's raw thoughts", example: "Mara: he knows. he has to know. keep smiling.", keywords: [], freeText: true },
];

/** One Thoughts line, "Name: thought" → { name, text }, or null when it is not one. */
export function parseThoughtLine(line) {
    const m = String(line).trim().match(/^([^:]{1,60}?)\s*:\s*(.+)$/);
    return m ? { name: m[1].trim(), text: m[2].trim() } : null;
}

export default {
    key: "thoughts",
    title: "🧠 INTERNAL THOUGHTS",
    match: /^INTERNAL THOUGHTS$/,
    change: "Thoughts",
    aliases: ["Thought"],
    carried: false,
    empty: () => [],
    isEmpty: v => !v.length,
    render: value => value.map(t => `- <b>${esc(t.name)}</b> | ${esc(t.text)}`),
    parse: () => ({ value: [], errors: [] }),
    apply(state, lines) {
        const unparsed = [];
        for (const raw of lines) {
            const thought = parseThoughtLine(raw);
            if (thought) state.perTurn.thoughts.push(thought);
            else unparsed.push(String(raw).trim());
        }
        return unparsed;
    },
    prompt: () => "",
    rules: () => "Thoughts: include 1–3 NPCs whenever NPCs are involved in this reply, on-screen first (an off-screen one names where they are and what they are doing); 1–3 lines each, fragmented, impulsive and raw but true to the person, their mood and instincts. These are fictional character thoughts, written anew for this reply. Let them drive what the NPC does next.",
    commands: COMMANDS,
    template: ctx => commandTemplate("Thoughts", COMMANDS, ctx),
};
