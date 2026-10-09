// Every public command against its formatting variations and malformed inputs (spec §5).
// Fixtures live in tests/support/command-fixtures.mjs; generators in tests/support/variants.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { CORE_COMMANDS, buildTemplate } from "../src/model/prompt.js";
import { THREAD_COMMANDS, PROPOSAL_COMMANDS } from "../src/model/notebook.js";
import { RELATION_COMMANDS } from "../src/model/relations.js";
import { SECTIONS } from "../src/model/sections/registry.js";
import { formOf } from "../src/model/commands.js";
import { parseChanges } from "../src/model/changes.js";
import { postTurn } from "../src/model/turn.js";
import { FIXTURES } from "./support/command-fixtures.mjs";
import {
    variants, skeleton, exampleOf, canonicalLine, runFixture, runComment, comparable, mentions, seeded, commentBody, configOf,
} from "./support/variants.mjs";

const INVENTORY = [...CORE_COMMANDS, ...THREAD_COMMANDS, ...RELATION_COMMANDS, ...SECTIONS.flatMap(s => s.commands || []), ...PROPOSAL_COMMANDS];
// a ctx-dependent command (Check) runs under both check styles
const stylesOf = c => (typeof c.example === "function" || typeof c.form === "function" ? ["dnd", "arrow"] : [null]);
const ctxOf = style => ({ checkStyle: style || "dnd", config: { sections: {} }, sections: {} });
const ran = new Map(INVENTORY.map(c => [c.id, new Set()]));

/**
 * Malformed lines for a command: the fixture's own, plus a square-wrapped echo even
 * though the public template no longer teaches that wrapper. A core field's template line is its placeholder, which is
 * skipped silently today.
 */
function malformedOf(command, fixture, style) {
    const ctx = ctxOf(style);
    const template = buildTemplate({ sections: {}, checkStyle: ctx.checkStyle }).split("\n");
    const out = [...fixture.malformed];
    if (fixture.heading === null) {
        const form = formOf(command, ctx);
        if (template.includes(form)) out.push({ line: form, expect: (r, base) => { assert.deepEqual(r.unparsed, []); assert.deepEqual(r.state, base.state); } });
    } else out.push(skeleton(command, ctx));
    return out;
}

// a syntactic failure: reported, and state and notebook as if the line were absent
function assertRejected(r, base, line, heading) {
    assert.ok(mentions(r, line, heading), `not reported: ${line}\n${JSON.stringify({ unparsed: r.unparsed, rel: r.relationUnparsed, diagnostics: r.diagnostics })}`);
    assert.deepEqual(r.state, base.state);
    assert.deepEqual(r.notebook, base.notebook);
}

for (const command of INVENTORY) {
    const f = FIXTURES[command.id];
    if (!f) continue;   // "every command has a fixture" reports it
    for (const style of stylesOf(command)) {
        const ctx = ctxOf(style);
        const tag = style ? `${command.id} [${style}]` : command.id;
        const opts = { style };
        const canonical = () => runFixture(f, [canonicalLine(exampleOf(command, ctx), f.heading)], f.heading, opts);

        test(`${tag} canonical`, () => {
            f.expect(canonical(), seeded(f), { style });
            ran.get(command.id).add("canonical");
        });
        for (const v of variants(command, f, ctx)) {
            test(`${tag} variant: ${v.name}`, () => {
                assert.deepEqual(comparable(runComment(f, v.comment, opts)), comparable(canonical()));
                ran.get(command.id).add("variant");
            });
        }
        for (const m of malformedOf(command, f, style)) {
            const line = typeof m === "string" ? m : m.line;
            test(`${tag} malformed: ${line}`, () => {
                const r = runFixture(f, [canonicalLine(line, f.heading)], f.heading, opts);
                const base = runFixture(f, [], f.heading, opts);
                if (typeof m === "string") assertRejected(r, base, line, f.heading);
                else m.expect(r, base);
            });
        }
        for (const line of f.valid || []) {
            test(`${tag} valid: ${line}`, () => {
                const r = runFixture(f, [canonicalLine(line, f.heading)], f.heading, opts);
                assert.deepEqual([r.unparsed, r.relationUnparsed, r.diagnostics], [[], [], []]);
            });
        }
    }
}

// ── mixed: malformed lines beside valid ones cannot corrupt state ───────────

// Mixed runs give every command its own identity: the n-th command whose example names
// X1 (Q1, B1, D1, W1) works on Xn, seeded under that id, and a fixture's `isolate`
// renames anything else it would share. So no valid example acts on another's target.
function isolated(commands, counts = {}) {
    return commands.map(c => {
        const f = FIXTURES[c.id];
        const letter = (exampleOf(c, ctxOf(null)).match(/\b([QBDWI])1\b/) || [])[1];
        const n = letter ? (counts[letter] = (counts[letter] || 0) + 1) : 1;
        const id = x => (letter && x === `${letter}1` ? `${letter}${n}` : x);
        const rename = text => (f.isolate || (t => t))(letter ? text.replace(new RegExp(`\\b${letter}1\\b`, "g"), `${letter}${n}`) : text);
        return { c, f, id, rename };
    });
}

// one fixture standing for a group: seeds composed in order under their ids, configs merged, the fullest notebook
function composite(members, heading) {
    const notebooks = members.map(m => m.f.notebook).filter(Boolean).sort((a, b) => b.rules.length - a.rules.length);
    return {
        heading,
        seed: s => { for (const m of members) if (m.f.seed) m.f.seed(s, m.id); },
        config: Object.assign({}, ...members.map(m => m.f.config || {})),
        notebook: notebooks[0] || null,
    };
}

// [{ heading, commands }] in inventory order
const groups = [];
for (const command of INVENTORY) {
    const f = FIXTURES[command.id];
    if (!f) continue;
    let g = groups.find(x => x.heading === f.heading);
    if (!g) groups.push(g = { heading: f.heading, commands: [] });
    g.commands.push(command);
}

const FREE_LINES = new Set(["Last", "Check"]);

// a group's lines: each valid example, then its malformed lines beside it
function groupLines(heading, members) {
    const ctx = ctxOf(null);
    const valid = [], mixed = [], rejected = [], awaiting = [], pending = [];
    for (const { c, f, rename } of members) {
        const line = canonicalLine(rename(exampleOf(c, ctx)), heading);
        valid.push(line);
        mixed.push(line);
        for (const m of malformedOf(c, f, null)) {
            const text = rename(typeof m === "string" ? m : m.line);
            mixed.push(canonicalLine(text, heading));
            if (typeof m === "string") rejected.push(text);
            awaiting.push(...(m.awaiting || []));
            pending.push(...(m.pending || []));
        }
    }
    // a heading-looking empty field must not open a section and swallow later lines
    // (Last and Check keep any line, so there it would be a line like any other)
    if (heading !== null && !FREE_LINES.has(heading)) { mixed.push("- Mara:"); rejected.push("Mara:"); }
    mixed.push(...valid.slice(0, 1));
    valid.push(...valid.slice(0, 1));
    return { valid, mixed, rejected, awaiting, pending };
}

// the valid-only run applies every line cleanly; then the mixed run's target state and notebook
// equal it, except the semantic awaiting bookkeeping its refusals declare
function assertMixed(validRun, mixedRun, awaiting, pending) {
    assert.deepEqual([validRun.unparsed, validRun.relationUnparsed, validRun.diagnostics], [[], [], []], "valid-only run is not clean");
    assert.deepEqual(validRun.log.filter(l => l.kind === "refused"), [], "valid-only run has refusals");
    const target = r => ({ ...r.state, rel: { ...r.state.rel, awaiting: null, pending: null } });
    assert.deepEqual(target(mixedRun), target(validRun));
    assert.deepEqual(mixedRun.state.rel.awaiting, { ...validRun.state.rel.awaiting, ...Object.fromEntries(awaiting.map(k => [k, ""])) });
    const sort = events => [...events].sort((a, b) => `${a.kind}|${a.from}|${a.to}`.localeCompare(`${b.kind}|${b.from}|${b.to}`));
    assert.deepEqual(sort(mixedRun.state.rel.pending || []), sort([...(validRun.state.rel.pending || []), ...pending.map(p => ({ ct: mixedRun.state.ct, ...p }))]));
    assert.deepEqual(mixedRun.notebook && mixedRun.notebook.inbox, validRun.notebook && validRun.notebook.inbox);
}

for (const g of groups) {
    const name = g.heading === null ? "core fields" : g.heading;
    test(`mixed: ${name}`, () => {
        const members = isolated(g.commands);
        const fx = composite(members, g.heading);
        const { valid, mixed, rejected, awaiting, pending } = groupLines(g.heading, members);
        const a = runFixture(fx, valid);
        const b = runFixture(fx, mixed);
        assertMixed(a, b, awaiting, pending);
        for (const line of rejected) assert.ok(mentions(b, line, g.heading), `not reported: ${line}`);
    });
}

test("mixed: every section in one reply", () => {
    const counts = {};
    const parts = groups.map(g => {
        const members = isolated(g.commands, counts);
        return { g, members, ...groupLines(g.heading, members) };
    });
    const fx = composite(parts.flatMap(p => p.members), null);
    const body = pick => parts.map(p => commentBody(p.g.heading === null ? null : `${p.g.heading}:`, p[pick])).join("\n");
    const a = runComment(fx, body("valid"));
    const b = runComment(fx, body("mixed"));
    assertMixed(a, b, parts.flatMap(p => p.awaiting), parts.flatMap(p => p.pending));
    for (const { g, rejected } of parts) for (const line of rejected) assert.ok(mentions(b, line, g.heading), `not reported: ${g.heading}: ${line}`);
});

test("tagged replies keep their readings (the fixes are comment-path only)", () => {
    const fx = { heading: null, seed: s => { s.quests.push({ id: "Q1", kind: "Main", status: "active", objective: "x", progress: "", reward: "", send: false }); } };
    const changes = parseChanges("<Story_Ledger>\nNwo: Day 2\nQuests:\n- Q1 progress:\nProposed rules:\n- [add: rule]\n</Story_Ledger>");
    assert.deepEqual(changes.unparsed, []);
    assert.equal(postTurn(seeded(fx), changes, configOf(fx)).state.quests[0].progress, "progress:");
});

test("every command has a fixture", () => {
    assert.deepEqual(Object.keys(FIXTURES).sort(), INVENTORY.map(c => c.id).sort());
    for (const [id, kinds] of ran) assert.deepEqual([...kinds].sort(), ["canonical", "variant"], `${id} did not run`);
});
