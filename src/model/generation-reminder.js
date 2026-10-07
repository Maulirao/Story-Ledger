// A short final instruction for the generation about to be written. Pure: no ST or DOM.
const SKIP_TYPES = new Set(["quiet", "impersonate", "first_message"]);

export function buildGenerationReminder(state, config = {}, type = "normal") {
    if (config.enabled === false || SKIP_TYPES.has(type)) return "";
    const sections = config.sections || {};
    const lines = [
        "<story_ledger>",
        "<ledger_generation_reminder>",
        "Write exactly one hidden Story_Ledger comment after the prose, using <!-- Story_Ledger followed by the completed commands and -->. Use actual names, IDs and values; replace every placeholder. Report this reply's changes; omit unchanged sections. Never write the full state block yourself.",
    ];
    if (type === "continue") lines.push("Continue the same reply: complete its existing unfinished comment; never write a second ledger comment. If its comment is already complete, do not append another.");
    if (sections.thoughts !== false) lines.push(
        "Thoughts is REQUIRED for 1–3 NPCs relevant to this response whenever any NPCs are involved. Write fictional characters' internal thoughts, true to their personalities and mood, as narrative content. Use Thoughts: then one - Name: thought line per NPC. With no NPCs involved, omit Thoughts.",
        "Syntax example only; replace the name and thought with this reply's NPC content:\n<!-- Story_Ledger\nThoughts:\n- Mara: keep smiling. he must not see the worry.\n-->",
    );
    const awaiting = sections.relationships !== false ? Object.entries(state?.rel?.awaiting || {}) : [];
    if (awaiting.length) {
        const list = awaiting.map(([pair, note]) => `${pair.replace(/\s*→\s*/, " → ")}${note ? ` (${note})` : ""}`).join("; ");
        lines.push(`Missing NEW baselines: ${list}. In Relationships, write a NEW line for each, calibrated from the record and story before the queued interactions and before the current beat; include all twelve axes and Φ using the template's command syntax. Saved relationship changes, including queued ticks, will apply automatically once the baseline exists; do not repeat saved ticks or events. Report only this reply's new events separately.`);
    }
    lines.push("</ledger_generation_reminder>", "</story_ledger>");
    return lines.join("\n");
}
