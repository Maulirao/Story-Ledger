// ──────────────────────────────────────────────────────────────────────────────
// One alias map for the ledger comment's section headings (`Quests:`, `### Quest`,
// `- Fate & Routine:`). Canonical names come from the section registry plus the
// core four; headingOf says whether a line is a heading and which. Pure: no
// SillyTavern, no DOM.
// ──────────────────────────────────────────────────────────────────────────────

import { SECTIONS } from "./sections/registry.js";

const CORE = [
    { change: "Threads", aliases: ["Thread"] },
    { change: "Relationships", aliases: ["Relationship"] },
    { change: "Proposed rules", aliases: ["Proposed rule"] },
    { change: "World" },
];

const WORDS = /^[A-Za-z][A-Za-z &'’]*$/;
const UNKNOWN = /^([A-Za-z][A-Za-z ]{0,30}):$/;

/** Lower-case, letters only: `&`, punctuation and spaces are dropped. */
export function headingKey(s) {
    return String(s).toLowerCase().replace(/[^a-z]/g, "");
}

/** Build key -> canonical name from sections (and the core four); throws on a key clash. */
export function buildHeadings(sections) {
    const map = new Map();
    for (const sec of [...sections, ...CORE]) {
        for (const label of [sec.change, ...(sec.aliases || [])]) {
            const key = headingKey(label);
            if (map.has(key) && map.get(key) !== sec.change) throw new Error(`heading alias collision: ${key}`);
            map.set(key, sec.change);
        }
    }
    return map;
}

/** Heading key -> canonical change name. */
export const HEADINGS = buildHeadings(SECTIONS);

/**
 * Classify a normalized record: `{ name, known }` for a heading line, else null. Its one
 * list marker is already gone; a bulleted record is a heading only with its colon
 * (`- Quests:`), so a one-word value such as `- Physics` stays a line.
 */
export function headingOf(rec) {
    const text = String(rec.text).trim();
    const bare = text.replace(/^#{1,6}\s+/, "").replace(/\s*:$/, "").trim();
    if (WORDS.test(bare) && (!rec.bulleted || /:$/.test(text))) {
        const name = HEADINGS.get(headingKey(bare));
        if (name) return { name, known: true };
    }
    const m = !rec.bulleted && UNKNOWN.exec(text);
    return m ? { name: m[1].trim(), known: false } : null;
}
