// The ledger fix-up: find a reply that lacks its Story_Ledger comment or its Thoughts, read what
// the model wrote for it, and splice only that in. Pure: no SillyTavern, no DOM.

import { parseChanges } from "./changes.js";
import { lastLedgerBlock } from "./notebook.js";
import { stripBlocks } from "./turn.js";
import { diceFromBlock } from "./dice.js";
import { parseThoughtLine } from "./sections/thoughts.js";

const COMMENT = /<!--\s*Story_Ledger\b[\s\S]*?-->/i;

/** The lines the Thoughts section would apply, trimmed. */
export function validThoughts(lines) {
    return (lines || []).filter(l => parseThoughtLine(l)).map(l => String(l).trim());
}

/** null, "missing" (no ledger comment) or "thoughts" (a comment, but no valid Thought while Thoughts are on). */
export function needsFixup(mes, sections = {}) {
    const text = stripBlocks(mes);
    const changes = parseChanges(text);
    if (changes === null) return "missing";
    if (lastLedgerBlock(text).kind === "tag") return null;
    return sections.thoughts !== false && !validThoughts(changes.sections.Thoughts).length ? "thoughts" : null;
}

/** The first complete <!-- Story_Ledger … --> comment in the model's output, or null. */
export function extractComment(output) {
    return String(output || "").match(COMMENT)?.[0] ?? null;
}

/** The dice a reply already shows, and the fudges stored as applied to it: what a fix-up runs on. */
export function fixupConfigInputs(mes, storedFudges, index) {
    return {
        dice: diceFromBlock(mes),
        fudges: storedFudges && storedFudges.appliedTo === index ? storedFudges : null,
    };
}
