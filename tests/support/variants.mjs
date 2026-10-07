// ──────────────────────────────────────────────────────────────────────────────
// Variation generators and the fixture runner for tests/variations.test.mjs. A
// variation changes only the framing of a command's example (spec §5.1): bullets,
// heading spelling, keyword casing, spacing, label emphasis, glyphs, a closed form's
// period and ID case. Tokens are located in the example, never by blind replacement.
// ──────────────────────────────────────────────────────────────────────────────

import { resolveConfig } from "../../src/model/config.js";
import { emptyState } from "../../src/model/state.js";
import { parseChanges } from "../../src/model/changes.js";
import { postTurn, unreadNotices } from "../../src/model/turn.js";
import { collectProposals } from "../../src/model/notebook.js";
import { normalizeLine } from "../../src/model/normalize.js";
import { HEADINGS, headingKey } from "../../src/model/headings.js";
import { SECTIONS } from "../../src/model/sections/registry.js";
import { formOf } from "../../src/model/commands.js";

/** The eight closed-form commands that accept one terminal period. */
export const CLOSED_FORMS = new Set(["quests.done", "quests.drop", "quests.reopen", "chekhov.unlock", "chekhov.prune", "fate.defer", "fate.resolve", "world.escalate"]);

// how the core headings' aliases are written (headings.js keeps them private)
const CORE_ALIASES = { Threads: ["Thread"], Relationships: ["Relationship"], "Proposed rules": ["Proposed rule"], World: [] };
const ID = /\b[QBDWR]\d+\b/g;

/** A command's example under `ctx` (Check depends on the check style). */
export const exampleOf = (command, ctx) => (typeof command.example === "function" ? command.example(ctx) : command.example);

/** The echoed template skeleton of a command. */
export const skeleton = (command, ctx) => `[${formOf(command, ctx)}]`;

/** The line as the template teaches it: bulleted under a heading, bare for a core field. */
export const canonicalLine = (text, heading) => (heading === null ? text : `- ${text}`);

/** A comment body: the heading line (or none), then the lines. */
export const commentBody = (headLine, lines) => [...(headLine === null ? [] : [headLine]), ...lines].join("\n");

/** Every alias HEADINGS maps to `heading`, written as its section declares it. */
export function headingAliases(heading) {
    const sec = SECTIONS.find(s => s.change === heading);
    const written = sec ? sec.aliases || [] : CORE_ALIASES[heading] || [];
    const keys = [...HEADINGS].filter(([k, v]) => v === heading && k !== headingKey(heading)).map(([k]) => k);
    return keys.map(k => written.find(a => headingKey(a) === k) || k);
}

// colons that are command syntax: the form's, outside a core placeholder and not in a clock time
const COLON = /(?<!\d):(?!\d)/g;
const syntaxColonCount = form => (form.replace(/\[[^\]]*\]/g, "").match(COLON) || []).length;
const colonIndexes = (text, n) => [...text.matchAll(COLON)].slice(0, n).map(m => m.index);

// the first whole-word occurrence of a keyword, case as declared
function tokenAt(text, word) {
    const m = new RegExp(`(?<![A-Za-z])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z])`).exec(text);
    return m ? m.index : -1;
}

const CASES = [
    ["lower", s => s.toLowerCase()],
    ["upper", s => s.toUpperCase()],
    ["title", s => s[0].toUpperCase() + s.slice(1).toLowerCase()],
];

/** The applicable framing variations of a command's example: [{ name, comment }]. */
export function variants(command, fixture, ctx) {
    const heading = fixture.heading;
    const head = heading === null ? null : `${heading}:`;
    const example = exampleOf(command, ctx);
    const line = canonicalLine(example, heading);
    const out = [];
    const add = (name, text, headLine = head) => out.push({ name, comment: commentBody(headLine, [text]) });

    // bullets; a bare line is skipped when the command itself starts with + or -
    for (const b of ["* ", "• ", "1. ", "1) "]) add(`bullet ${b.trim()}`, b + example);
    if (heading === null) add("bullet -", `- ${example}`);
    else if (!/^[+-]/.test(example)) add("bullet none", example);

    if (heading !== null) {
        add("heading lower", line, `${heading.toLowerCase()}:`);
        add("heading upper", line, `${heading.toUpperCase()}:`);
        add("heading bold", line, `**${heading}:**`);
        add("heading ###", line, `### ${heading}`);
        add("heading space colon", line, `${heading} :`);
        for (const alias of headingAliases(heading)) add(`heading alias ${alias}`, line, `${alias}:`);
    }

    for (const k of command.keywords) {
        const at = tokenAt(example, k);
        if (at < 0) throw new Error(`${command.id}: keyword "${k}" is not in its example`);
        for (const [name, f] of CASES) {
            const w = f(k);
            if (w !== k) add(`keyword ${k} ${name}`, canonicalLine(example.slice(0, at) + w + example.slice(at + k.length), heading));
        }
    }

    add("doubled spaces", line.replace(/ /g, "  "));
    const colons = colonIndexes(example, syntaxColonCount(formOf(command, ctx)));
    colons.forEach((at, i) => add(`space before colon ${i + 1}`, canonicalLine(`${example.slice(0, at)} ${example.slice(at)}`, heading)));
    add("tab", line.replace(/ /g, "\t"));
    add("nbsp", line.replace(/ /g, " "));
    add("trailing space", `${line}  `);

    if (colons.length) add("bold label", canonicalLine(`**${example.slice(0, colons[0] + 1)}**${example.slice(colons[0] + 1)}`, heading));
    add("backticks", `\`${line}\``);

    if (example.includes("\"")) {
        let open = true;
        add("curly quotes", canonicalLine(example.replace(/"/g, () => ((open = !open) ? "”" : "“")), heading));
    }
    if (example.includes("→")) add("ascii arrow", canonicalLine(example.replace("→", "->"), heading));
    if (CLOSED_FORMS.has(command.id)) add("trailing period", `${line}.`);
    if (ID.test(example)) add("lower-case id", canonicalLine(example.replace(ID, id => id.toLowerCase()), heading));
    ID.lastIndex = 0;
    return out;
}

/** The engine configuration a fixture runs under. */
export function configOf(fixture, style = null) {
    return {
        ...resolveConfig(), userName: "Jan", sections: {}, dice: { fate: { a: 10, b: 1, c: 5 } },
        ...(fixture.config || {}),
        ...(style ? { checkStyle: style } : {}),
    };
}

/** A fresh state with the fixture's seed applied. */
export function seeded(fixture) {
    const s = emptyState();
    if (fixture.seed) fixture.seed(s);
    return s;
}

/**
 * One reply carrying `comment` (a body without the <!-- --> wrapper), read the way the
 * live notice is: engine state/log/warnings, the parser's `changes`, combined `unparsed`
 * (parser diagnostics filtered by switched-off sections, plus the engine's), the
 * relationship lines it could not read, and the proposal notebook with its diagnostics.
 */
export function runComment(fixture, comment, { style = null } = {}) {
    const config = configOf(fixture, style);
    const changes = parseChanges(`<!-- Story_Ledger\n${comment}\n-->`);
    const r = postTurn(seeded(fixture), changes, config);
    const diagnostics = [];
    const notebook = fixture.notebook ? collectProposals(fixture.notebook, changes.proposals, "t", diagnostics) : null;
    return {
        state: r.state, log: r.log, warnings: r.warnings, changes,
        unparsed: unreadNotices(changes, r.unparsed, config.sections),
        relationUnparsed: changes.relations.unparsed,
        notebook, diagnostics,
    };
}

/** `lines` under the fixture's heading (none for a core field). */
export function runFixture(fixture, lines, heading = fixture.heading, opts = {}) {
    return runComment(fixture, commentBody(heading === null ? null : `${heading}:`, lines), opts);
}

/** The parts of a result two harmless variations must share. */
export const comparable = r => ({
    state: r.state, log: r.log, warnings: r.warnings, unparsed: r.unparsed,
    relationUnparsed: r.relationUnparsed, notebook: r.notebook, diagnostics: r.diagnostics,
});

/** True when a diagnostic names `line` (as written under `heading`). */
export function mentions(r, line, heading) {
    const t = normalizeLine(canonicalLine(line, heading)).text;
    return r.unparsed.some(u => u.line === t) || r.relationUnparsed.includes(t)
        || r.diagnostics.some(d => d.line === t || t.startsWith(`${d.line}:`) || t.startsWith(`${d.line} `));
}
