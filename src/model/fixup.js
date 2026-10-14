// The ledger fix-up: find a reply that lacks its Story_Ledger comment or its Thoughts, read what
// the model wrote for it, and splice only that in. Pure: no SillyTavern, no DOM.

import { parseChanges } from "./changes.js";
import { lastLedgerBlock } from "./notebook.js";
import { stripBlocks, postTurn } from "./turn.js";
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
        fudges: storedFudges && Number.isInteger(storedFudges.appliedTo) && storedFudges.appliedTo <= index ? storedFudges : null,
    };
}

const EMPTY_COMMENT = "<!-- Story_Ledger\n-->";
const reject = reason => ({ ok: false, reason });

/**
 * Judge the model's output for a fix-up. "missing": a whole comment worth keeping.
 * "thoughts": only the valid Thought lines, which spliceThoughts adds to the existing comment.
 */
export function acceptFixup(output, kase, { sections, prev, config }) {
    const comment = extractComment(output);
    if (!comment) return reject("no ledger comment");
    const changes = parseChanges(comment);
    const thoughtsOn = (sections ?? config?.sections ?? {}).thoughts !== false;
    const thoughts = validThoughts(changes.sections.Thoughts);
    if (kase === "thoughts") return thoughts.length ? { ok: true, thoughts } : reject("no valid Thoughts");
    if (thoughtsOn) return thoughts.length ? { ok: true, comment } : reject("no valid Thoughts");
    const stateOf = c => JSON.stringify(postTurn(prev, c, config).state);
    return stateOf(changes) === stateOf(parseChanges(EMPTY_COMMENT)) ? reject("no readable changes") : { ok: true, comment };
}

/** `text` is the reply without its blocks. The comment goes after the prose, which keeps its bytes. */
export function spliceMissing(text, comment) {
    return text.replace(/\s+$/, "") + "\n\n" + comment;
}

/** Add the Thought lines inside the reply's last Story_Ledger comment; every other byte stays. */
export function spliceThoughts(text, thoughts) {
    const opening = /<!--\s*Story_Ledger\b/gi;
    let start = -1, m;
    while ((m = opening.exec(text))) start = m.index;
    if (start < 0) return text;
    const insert = "\nThoughts:\n" + thoughts.map(l => "- " + l).join("\n") + "\n";
    const close = text.indexOf("-->", start);
    return close < 0 ? text + insert + "-->" : text.slice(0, close) + insert + text.slice(close);
}
