// ──────────────────────────────────────────────────────────────────────────────
// A preset's own dialogue colours: the colour prompts and colour regexes of the FF, RF, AA
// and Sola families. Story Ledger handles dialogue colours itself, so SillyTavern offers to
// turn these off when it finds any still on. Pure: the host reads and writes the preset.
// ──────────────────────────────────────────────────────────────────────────────

/** The families' colour prompts, by name. */
export const COLOUR_PROMPTS = new Set([
    "🌈 Colored Dialogue 2.0 VN🖍️", "🌈 Colored Dialogue VN🖍️ copy", "🌈 Colored Dialogue VN🖍️", "🌈 Colored Dialogue",
    "[Module] Default Voice: NPC Dialogue Colors (Pick 1)🎨",
]);

const FF5 = ["Tremble Dialogue Regex", "Measured Dialogue Regex", "Whisper Dialogue Regex", "Shout Dialogue Regex", "FF5 - Universal Dialogue Colorizer"];

/** The families' colour regexes, by name (Sola's are every "Sola Voice:" script, see isColourScript). */
export const COLOUR_REGEX = new Set([
    ...FF5,
    ...FF5.map(n => `[FF history] ${n}`),
    "SillyTavern Tremble Dialogue Regex", "SillyTavern Measured Dialogue Regex", "SillyTavern Whisper Dialogue Regex",
    "SillyTavern Shout Dialogue Regex", "SillyTavern Universal Dialogue Colorizer",
    "AA Dialogue – Tremble", "AA Dialogue – Measured", "AA Dialogue – Whisper", "AA Dialogue – Shout", "AA Dialogue – Color",
]);

/** True for a regex script that colours or styles dialogue tags. */
export function isColourScript(name) {
    const n = String(name ?? "").trim();
    return COLOUR_REGEX.has(n) || n.startsWith("Sola Voice:");
}

/**
 * The colour pieces still on: { prompts: [{ identifier, name }], presetRegex: [scriptName],
 * globalRegex: [scriptName] }. A prompt counts when any prompt order has it enabled.
 */
export function colourPieces({ prompts = [], order = [], presetRegex = [], globalRegex = [] }) {
    const on = new Set((order || []).flatMap(o => o.order || []).filter(e => e.enabled).map(e => e.identifier));
    const live = scripts => (scripts || []).filter(s => isColourScript(s.scriptName) && !s.disabled).map(s => s.scriptName);
    return {
        prompts: (prompts || []).filter(p => COLOUR_PROMPTS.has(String(p.name ?? "").trim()) && on.has(p.identifier))
            .map(p => ({ identifier: p.identifier, name: p.name })),
        presetRegex: live(presetRegex),
        globalRegex: live(globalRegex),
    };
}
