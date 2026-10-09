// The lean fix-up prompt: a short message list asking for the ledger comment alone, sent in
// place of the whole chat prompt. Pure: no SillyTavern, no DOM.

export const LEAN_WRITER_INSTRUCTION = "You write the hidden Story_Ledger comment for the last roleplay reply. The reply is finished. Output only the comment, nothing before or after it.";

const MAX_HISTORY = 20;

const tagged = (tag, lines) => `<${tag}>\n${lines.join("\n")}\n</${tag}>`;
const named = (name, text) => name ? `${name}: ${text}` : text;

function charactersSection(characters, personaName) {
    const blocks = [];
    for (const c of characters || []) {
        const fields = [["Description", c.description], ["Personality", c.personality]].filter(([, v]) => v && String(v).trim());
        if (fields.length) blocks.push([c.name, ...fields.map(([k, v]) => `${k}: ${String(v).trim()}`)].join("\n"));
    }
    if (personaName) blocks.push(`User persona: ${personaName}`);
    return blocks.length ? tagged("characters", [blocks.join("\n\n")]) : "";
}

/** The chat messages for the lean fix-up. `input` is described in the design spec, section 5. */
export function buildLeanPrompt(input) {
    const { mainPrompt = "", writerInstruction = LEAN_WRITER_INSTRUCTION, characters, personaName, summary = "",
        statePrompt, rules, template, turnFacts, history = [], historyCount, reply, reminder } = input;
    const count = Number.isFinite(Number(historyCount)) ? Math.max(0, Math.min(MAX_HISTORY, Math.trunc(Number(historyCount)))) : 0;
    const messages = [{ role: "system", content: mainPrompt ? `${mainPrompt}\n\n${writerInstruction}` : writerInstruction }];
    const cast = charactersSection(characters, personaName);
    if (cast) messages.push({ role: "system", content: cast });
    if (summary) messages.push({ role: "system", content: tagged("summary", [summary]) });
    messages.push({ role: "system", content: tagged("story_ledger", [statePrompt, rules, template, turnFacts].filter(Boolean)) });
    for (const h of count ? history.slice(-count) : []) messages.push({ role: h.role, content: named(h.name, h.text) });
    messages.push({ role: "assistant", content: named(reply.name, reply.text) });
    messages.push({ role: "user", content: reminder });
    return messages;
}
