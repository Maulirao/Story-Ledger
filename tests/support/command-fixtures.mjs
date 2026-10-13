// ──────────────────────────────────────────────────────────────────────────────
// Test-only fixtures for every public command, keyed by command id: the seeded state,
// configuration and notebook each example needs, a hand-checked expectation for the
// canonical line, malformed lines that must be reported without touching state, and
// supported compatibility forms (`valid`). Nothing here is shipped in src/.
//
// A malformed entry is a line (a syntactic failure: reported, state untouched) or
// { line, expect, awaiting? } for a semantic refusal with its own bookkeeping.
// Skeletons are generated from the public template in variants.mjs, not listed here.
// `isolate(text)` (optional) rewrites a command's lines in a mixed run so it does not
// collide with another fixture's seed.
// Mutations that are not applicable to a command are noted beside its fixture.
// ──────────────────────────────────────────────────────────────────────────────

import assert from "node:assert/strict";
import { emptyNotebook } from "../../src/model/notebook.js";
import { resolveConfig } from "../../src/model/config.js";

const AXES = ["E", "M", "L", "Er", "Ph", "Ec", "Pr", "St", "Sg", "Ad", "Ag", "Pt"];
const zeros = () => Object.fromEntries(AXES.map(k => [k, 0]));

// every diagnostic surface is empty
export function clean(r) {
    assert.deepEqual(r.unparsed, []);
    assert.deepEqual(r.relationUnparsed, []);
    assert.deepEqual(r.diagnostics, []);
}

// a refusal that leaves no diagnostic and no state change (core-field placeholders and empty fields)
const silent = line => ({
    line,
    expect(r, base) {
        assert.deepEqual(r.unparsed, []);
        assert.deepEqual(r.state, base.state);
    },
});

// a relationship refusal: logged, `key` queued in awaiting, pairs and selves untouched
const awaits = (line, key) => ({
    line,
    awaiting: [key],
    expect(r, base) {
        assert.deepEqual(r.relationUnparsed, []);
        assert.ok(r.log.some(l => l.kind === "refused"), "refusal logged");
        assert.deepEqual(r.state.rel.pairs, base.state.rel.pairs);
        assert.deepEqual(r.state.rel.selves, base.state.rel.selves);
        assert.deepEqual(r.state.rel.awaiting, { ...base.state.rel.awaiting, [key]: "" });
        assert.deepEqual({ ...r.state, rel: null }, { ...base.state, rel: null });
    },
});

// Valid changes awaiting a baseline have their own persisted bookkeeping.
const queued = (line, key, event) => ({
    line, awaiting: [key], pending: [event],
    expect(r, base) {
        clean(r);
        assert.ok(r.log.some(l => l.kind === "queued"));
        assert.equal(r.log.some(l => l.kind === "refused"), false);
        assert.deepEqual(r.state.rel.pairs, base.state.rel.pairs);
        assert.deepEqual(r.state.rel.selves, base.state.rel.selves);
        assert.deepEqual(r.state.rel.awaiting, { ...base.state.rel.awaiting, [key]: "" });
        assert.deepEqual(r.state.rel.pending, [{ ct: r.state.ct, ...event }]);
        assert.deepEqual({ ...r.state, rel: null }, { ...base.state, rel: null });
    },
});

// ── seeds (additive, so a group's seeds compose without overwriting). A seed that creates an
// id takes `id`, which the mixed runs use to give each command its own (B1 → B3).

const same = x => x;
const itemSeed = name => (s, id = same) => {
    s.inv.itemIds = s.inv.itemIds || s.inv.items.map(() => null);
    s.inv.items.push(name);
    s.inv.itemIds.push(id("I1"));
};
const moneySeed = s => { s.inv.money = { USD: "50", CAD: "50", EUR: "50", ...(s.inv.money || {}) }; };
const supplySeed = (s, id = same) => {
    itemSeed("ammunition")(s, id);
    s.inv.supplies = { ...(s.inv.supplies || {}), [id("I1")]: { amount: "12", unit: "rounds" } };
};

const present = (...names) => s => { for (const n of names) if (!s.scene.present.includes(n)) s.scene.present.push(n); };
const pairSeed = s => {
    s.rel.pairs["Mara→Jan"] = s.rel.pairs["Mara→Jan"] || { from: "Mara", to: "Jan", axes: Object.fromEntries(AXES.map(k => [k, 4])), acc: zeros() };
};
const questSeed = (more = {}) => (s, id = same) => {
    if (!s.quests.some(q => q.id === id("Q1"))) s.quests.push({ id: id("Q1"), kind: "Main", status: "active", objective: "find the missing ferryman", progress: "", reward: "", send: false, ...more });
};
const bulletSeed = (more = {}) => (s, id = same) => {
    s.scene.now = s.scene.now || "Day 3 — 12:00";
    if (!s.chekhov.bullets.some(b => b.id === id("B1"))) s.chekhov.bullets.push({ id: id("B1"), desc: "the cellar door", weight: 2, age: 2, hot: false, secret: false, lock: "", at: null, after: "", ...more });
};
const deferredSeed = (s, id = same) => {
    if (!s.fate.deferred.some(d => d.id === id("D1"))) s.fate.deferred.push({ id: id("D1"), desc: "the guild's audit", times: 1, age: 2 });
};
const worldSeed = (s, id = same) => {
    if (!s.fate.world.some(w => w.id === id("W1"))) s.fate.world.push({ id: id("W1"), desc: "a war breaks out across the sea", prox: "ELSEWHERE", reach: 1, age: 2 });
};
const items = (key, ...values) => s => { for (const v of values) if (!s.inv[key].includes(v)) s.inv[key].push(v); };
// titles and conditions are entries: { name, effects, hint }
const E = (...names) => names.map(name => ({ name, effects: [], hint: "" }));
const entries = (key, ...names) => s => { for (const e of E(...names)) if (!s.inv[key].some(x => x.name === e.name)) s.inv[key].push(e); };

// ── fixture builders for one-field families ─────────────────────────────────

const castFixture = (field, value, typo) => ({
    heading: "Cast",
    seed: present("Mara"),
    expect(r) {
        clean(r);
        assert.deepEqual(r.state.cast, { Mara: { position: "", wearing: "", holding: "", condition: "", [field]: value } });
    },
    malformed: [`Mara: ${field}:`, `Mara: ${typo}: ${value}`, `Mara: ${field} ${value}`, "Mara:"],
});

const AGENDA = { task: "", step: 0, max: 0, aware: "", fibs: "", circle: "", body: "" };
const agendaField = (keyword, field, value, typo) => ({
    heading: "Agendas",
    expect(r) {
        clean(r);
        assert.deepEqual(r.state.agendas, { Ana: { ...AGENDA, [field]: value } });
    },
    malformed: [`Ana ${keyword}:`, `Ana ${typo}: ${value}`, `Ana ${keyword} ${value}`],
});

const FACTION = { goal: "", intel: "", fibs: "", state: "", conflict: "", relations: "" };
const factionFixture = (field, value, typo, valid = []) => ({
    heading: "Factions",
    expect(r) {
        clean(r);
        assert.deepEqual(r.state.factions, { "Harbour Guild": { ...FACTION, [field]: value } });
    },
    malformed: [`Harbour Guild: ${field}:`, `Harbour Guild: ${typo}: ${value}`, `Harbour Guild ${field}: ${value}`, "Harbour Guild:"],
    valid,
});

const questAdd = (kind, objective, reward, typo) => ({
    heading: "Quests",
    expect(r) {
        clean(r);
        assert.deepEqual(r.state.quests, [{ id: "Q1", kind, status: "active", objective, progress: "", reward, send: false }]);
    },
    malformed: [`+ ${kind}:`, `+ ${typo}: ${objective} (${reward})`, `+ ${kind} ${objective}`],
    valid: [`+ ${kind}: ${objective}`],
});

const questStatus = (op, from, to, typo) => ({
    heading: "Quests",
    seed: questSeed({ status: from }),
    expect(r) {
        clean(r);
        assert.deepEqual(r.state.quests.map(q => [q.id, q.status]), [["Q1", to]]);
    },
    malformed: [`${op} Q99`, op, `${typo} Q1`],
});

const worldAdd = (prox, desc, reach, typo) => ({
    heading: "World",
    expect(r) {
        clean(r);
        assert.deepEqual(r.state.fate.world, [{ id: "W1", desc, prox, reach, age: 0 }]);
    },
    malformed: [`+ ${prox}:`, `+ ${typo}: ${desc}`, `+ ${prox} ${desc}`],
});

const fireConfig = () => {
    const base = resolveConfig();
    return { sectionConfig: { ...base.sectionConfig, chekhov: { ...base.sectionConfig.chekhov, firing: "model" } } };
};

const RULE = "Mara never lies to Jan";
// the rule R1 that edit and remove point at (distinct from RULE, so a group can also add RULE)
const R1 = "Mara keeps her word";

/** Fixtures by command id. */
export const FIXTURES = {
    // ── core fields (no heading). Empty fields and echoed placeholders are skipped silently today;
    // a truncation without its colon reads as prose under no heading and is ignored too.
    "core.now": {
        heading: null,
        expect(r) {
            clean(r);
            assert.equal(r.state.scene.now, "Day 12 — Tuesday, March 4, 21:44 | the lawn");
        },
        malformed: ["Nwo: Day 12 — Tuesday, March 4, 21:44 | the lawn", silent("Now Day 12 — Tuesday, March 4, 21:44"), silent("Now:")],
    },
    "core.present": {
        heading: null,
        expect(r) {
            clean(r);
            assert.deepEqual(r.state.scene.present, ["Mara", "Jan"]);
        },
        malformed: ["Presnt: Mara, Jan", silent("Present Mara, Jan"), silent("Present:")],
    },
    "core.public": {
        heading: null,
        seed: s => { s.scene.public = true; },
        expect(r) {
            clean(r);
            assert.equal(r.state.scene.public, false);
        },
        malformed: ["Publik: no", silent("Public no"), silent("Public:")],
    },

    // ── Threads. Misspelling is inapplicable: a bulleted thread line's [T] tag is optional,
    // so "[X] …" is free thread text.
    "threads.add": {
        heading: "Threads",
        expect(r) {
            clean(r);
            assert.deepEqual(r.state.threads, ["Meet Mara at the mill on Day 4 at dawn"]);
        },
        malformed: ["+ [T]", "[T] Meet Mara at the mill on Day 4 at dawn"],
    },
    "threads.remove": {
        heading: "Threads",
        seed: s => { if (!s.threads.includes("Ask about the letter")) s.threads.push("Ask about the letter"); },
        expect(r) {
            clean(r);
            assert.deepEqual(r.state.threads, []);
        },
        malformed: ["- [T]", "[T] Ask about the letter"],
    },

    // ── Relationships (Mara → Jan seeded at 4 on every axis; each refusal names its own pair)
    "rel.tick": {
        heading: "Relationships",
        seed: pairSeed,
        expect(r) {
            clean(r);
            assert.deepEqual(r.state.rel.pairs["Mara→Jan"].acc, { ...zeros(), E: 1, M: 2 });
            assert.deepEqual(r.log.map(l => l.text), ["E_acc +1 (he remembered her song).", "M_acc +2 (he laughed at her boat)."]);
        },
        malformed: [
            "Mara → Jan:",
            "Mara → Jan: E_acx +1 (he remembered her song)",
            "Mara → Jan: E_acc (he remembered her song)",
            queued("Mara → Nora: E_acc +1 (she waved)", "Mara→Nora", { kind: "tick", from: "Mara", to: "Nora", acc: "E", amount: 1, reason: "she waved" }),
        ],
    },
    "rel.phi": {
        heading: "Relationships",
        expect(r) {
            clean(r);
            assert.deepEqual(r.state.rel.selves, { Mara: { phi: 0, acc: 1 } });
            assert.deepEqual(r.log.map(l => l.text), ["Φ_acc +1 (she won the race)."]);
        },
        malformed: ["Mara:", "Mara: Fi_acc +1 (she won the race)", "Mara: Φ_acc (she won the race)"],
    },
    // misspelling DIRECT is inapplicable: "DIRCT Mara → Jan: E +1" reads as a tick for the pair "DIRCT Mara → Jan"
    "rel.direct": {
        heading: "Relationships",
        seed: pairSeed,
        expect(r) {
            clean(r);
            assert.equal(r.state.rel.pairs["Mara→Jan"].axes.E, 5);
            assert.deepEqual(r.log.map(l => l.text), ["E +1 (direct: he pulled her from the river)."]);
        },
        malformed: [
            "DIRECT Mara → Jan:",
            "DIRECT Mara → Jan: E (he pulled her from the river)",
            queued("DIRECT Bo → Jan: E +1 (she waved)", "Bo→Jan", { kind: "direct", from: "Bo", to: "Jan", axis: "E", amount: 1, reason: "she waved" }),
        ],
    },
    "rel.new": {
        heading: "Relationships",
        // in a mixed run the other fixtures seed Mara → Jan, so this NEW names its own pair
        isolate: text => text.replace("Mara → Jan", "Mara → Nell"),
        expect(r) {
            clean(r);
            assert.deepEqual(r.state.rel.pairs, {
                "Mara→Jan": {
                    from: "Mara", to: "Jan",
                    axes: { E: 3, M: 4, L: 5, Er: 3, Ph: 6, Ec: 4, Pr: 3, St: 4, Sg: 3, Ad: 3, Ag: 4, Pt: 3 },
                    acc: zeros(), note: "old rivals from the boat races",
                },
            });
            assert.deepEqual(r.state.rel.selves, { Mara: { phi: 2, acc: 0 } });
        },
        malformed: [
            "NEW Mara → Jan:",
            "NWE Mara → Jan: E 3, M 4, L 5, Er 3, Ph 6, Ec 4, Pr 3, St 4, Sg 3, Ad 3, Ag 4, Pt 3 | Φ 2 (old rivals)",
            awaits("NEW Ana → Jan: E 3, M 4 | Φ 2 (old rivals)", "Ana→Jan"),
        ],
    },
    "rel.note": {
        heading: "Relationships",
        seed: pairSeed,
        expect(r) {
            clean(r);
            assert.equal(r.state.rel.pairs["Mara→Jan"].note, "rivals who have started to trust each other");
            assert.deepEqual(r.log.map(l => l.text), ["Mara → Jan now reads: rivals who have started to trust each other"]);
        },
        malformed: ["NOTE Mara → Jan:", "NOET Mara → Jan: rivals who have started to trust each other"],
    },

    // ── Proposed rules: the inbox and diagnostics from collectProposals
    "rules.add": {
        heading: "Proposed rules",
        notebook: emptyNotebook(),
        expect(r) {
            clean(r);
            assert.deepEqual(r.notebook.inbox, [{ id: "p1", op: "add", targetText: "", text: RULE, source: "t", signature: "add||mara never lies to jan" }]);
        },
        malformed: ["add:", `ad: ${RULE}`, RULE],
    },
    "rules.edit": {
        heading: "Proposed rules",
        notebook: { ...emptyNotebook(), rules: [R1] },
        expect(r) {
            clean(r);
            assert.deepEqual(r.notebook.inbox, [{
                id: "p1", op: "edit", targetText: R1, text: "Mara never lies to Jan, except to protect him", source: "t",
                signature: "edit|mara keeps her word|mara never lies to jan, except to protect him",
            }]);
        },
        malformed: ["edit R99: Mara never lies", "edit R1:", `eidt R1: ${RULE}`, `edit R1 ${RULE}`],
    },
    "rules.remove": {
        heading: "Proposed rules",
        notebook: { ...emptyNotebook(), rules: [R1] },
        expect(r) {
            clean(r);
            assert.deepEqual(r.notebook.inbox, [{ id: "p1", op: "remove", targetText: R1, text: "the reader dropped it", source: "t", signature: "remove|mara keeps her word|the reader dropped it" }]);
        },
        malformed: ["remove R99: the reader dropped it", "remove", "remvoe R1: the reader dropped it"],
        valid: ["remove R1"],
    },

    // ── Cast (Mara present)
    "cast.position": castFixture("position", "by the door", "positon"),
    "cast.wearing": castFixture("wearing", "a wet coat", "waering"),
    "cast.holding": castFixture("holding", "a brass key", "holdign"),
    "cast.condition": castFixture("condition", "shivering", "conditon"),

    // ── Agendas (Ana off-screen)
    "agendas.new": {
        heading: "Agendas",
        expect(r) {
            clean(r);
            assert.deepEqual(r.state.agendas, { Ana: { ...AGENDA, task: "mend the nets", step: 0, max: 2 } });
            assert.deepEqual(r.state.locations, { Ana: "the harbour" });
        },
        // the misspelling drops "@ place", which would make it a location line
        malformed: ['Ana: new "mend the nets" 3/2 @ the harbour', "Ana: new", 'Ana: nwe "mend the nets" 0/2', 'Ana: new "mend the nets 0/2'],
        valid: ["Ana: mend the nets (1/2) — halfway", 'Ana: "mend the nets" 1/2 (halfway)', "Ana @ the market"],
    },
    "agendas.done": {
        heading: "Agendas",
        seed: s => { s.agendas.Ana = s.agendas.Ana || { ...AGENDA, task: "mend the nets", step: 1, max: 2 }; },
        expect(r) {
            clean(r);
            assert.deepEqual(r.state.agendas, { Ana: { ...AGENDA } });
        },
        malformed: ['Bo: done', 'Ana: dnoe "mend the nets"', 'Ana done "mend the nets"', "Ana:"],
        valid: ["Ana: done", 'Bo: done "mend the nets" → the boat can sail'],
    },
    "agendas.knows": agendaField("knows", "aware", "Mara took the key", "konws"),
    "agendas.fib": agendaField("fib", "fibs", "says she was home all night", "fbi"),
    "agendas.circle": agendaField("circle", "circle", "the harbour crews", "cirlce"),
    "agendas.body": agendaField("body", "body", "a bandaged hand", "bdoy"),

    // ── Locations. Misspelling is inapplicable: the command has no keyword ("@" is its delimiter).
    "locations.move": {
        heading: "Locations",
        expect(r) {
            clean(r);
            assert.deepEqual(r.state.locations, { Ana: "the harbour" });
        },
        malformed: ["Ana @", "Ana the harbour", "@ the harbour"],
        valid: ["Ana: the harbour"],
    },

    // ── Factions
    "factions.goal": factionFixture("goal", "control the docks", "gaol", ["Harbour Guild: goal | intel: control the docks"]),
    "factions.intel": factionFixture("intel", "knows about the smuggling", "intle", ["Harbour Guild: intel knows about the smuggling"]),
    "factions.fibs": factionFixture("fibs", "claims the tolls fund repairs", "fisb"),
    "factions.state": factionFixture("state", "shaken after the fire", "sate", ["Harbour Guild: state shaken | conflict the union"]),
    "factions.conflict": factionFixture("conflict", "the fishermen's union", "conflcit"),
    "factions.relations": factionFixture("relations", "courts the mayor", "relatoins"),
    "factions.drop": {
        heading: "Factions",
        seed: s => { s.factions["Harbour Guild"] = s.factions["Harbour Guild"] || { ...FACTION, goal: "control the docks" }; },
        expect(r) {
            clean(r);
            assert.deepEqual(r.state.factions, {});
        },
        malformed: ["drop:", "drop: Fishermen", "dorp: Harbour Guild"],
    },

    // ── Quests
    "quests.add-main": questAdd("Main", "find the missing ferryman", "the title Harbour Friend", "Mian"),
    "quests.add-side": questAdd("Side", "return the lost dog", "a free meal", "Sdie"),
    // misspelling is inapplicable: "Q1 progres: …" is the tolerated free-form "Q# …: text" update
    "quests.progress": {
        heading: "Quests",
        seed: questSeed(),
        expect(r) {
            clean(r);
            assert.equal(r.state.quests[0].progress, "the ferryman was seen at the mill");
        },
        malformed: ["Q99 progress: the ferryman was seen at the mill", "Q1 progress:", "Q1 the ferryman was seen at the mill"],
        valid: ["Q1: progress: the ferryman was seen at the mill", "Q1 Main — find the missing ferryman · Day 3: seen at the mill"],
    },
    "quests.done": questStatus("done", "active", "done", "dnoe"),
    "quests.drop": questStatus("drop", "active", "dropped", "dorp"),
    "quests.reopen": questStatus("reopen", "done", "active", "reopne"),

    // ── Inventory. Misspelling is inapplicable to + / - item (no keyword).
    "inv.add": {
        heading: "Inventory",
        expect(r) {
            clean(r);
            assert.deepEqual(r.state.inv, { items: ["brass key"], itemIds: ["I1"], titles: [], status: [] });
        },
        malformed: ["+", "brass key"],
    },
    "inv.remove": {
        heading: "Inventory",
        seed: items("items", "brass key"),
        expect(r) {
            clean(r);
            assert.deepEqual(r.state.inv.items, []);
        },
        malformed: ["- lantern", "-", "brass key"],
    },
    "inv.remove-id": {
        heading: "Inventory",
        seed: itemSeed("spare key"),
        expect(r) { clean(r); assert.deepEqual(r.state.inv.items, []); assert.deepEqual(r.state.inv.itemIds, []); },
        malformed: ["- I99 (left behind)", "- I1 stray command", "- I1 (left behind", "- I1:", "- I99: spare key"],
        valid: ["- I1", "- i1 (used)", "- I1.", "- I1: spare key (left behind)"],
    },
    "inv.update": {
        heading: "Inventory",
        seed: itemSeed("old key"),
        expect(r) { clean(r); assert.deepEqual(r.state.inv.items, ["brass key (on Jan)"]); assert.deepEqual(r.state.inv.itemIds, ["I1"]); },
        malformed: ["I99 update: key", "I1 update:", "I1 udpate: key", "I1 update key"],
    },
    "inv.money-set": {
        heading: "Inventory",
        expect(r) { clean(r); assert.deepEqual(r.state.inv.money, { USD: "50" }); assert.equal(r.state.inv.itemIds, undefined); },
        malformed: ["money: -5 USD", "money: USD fifty", "money: 50 USD extra", "mnoey: 50 USD"],
        valid: ["money: $50", "money: 50", "money: 0 USD"],
    },
    "inv.money-add": {
        heading: "Inventory", seed: moneySeed,
        expect(r) { clean(r); assert.deepEqual(r.state.inv.money, { USD: "55", CAD: "50", EUR: "50" }); },
        isolate: text => text.replace(/\bUSD\b/g, "CAD"),
        malformed: ["money + 1 XYZ", "money + -5 USD", "money + 5 USD (refund))", "mnoey + 5 USD"],
        valid: ["money + .25 USD", "money + 5 USD (refund) (shop)"],
    },
    "inv.money-spend": {
        heading: "Inventory", seed: moneySeed,
        expect(r) { clean(r); assert.deepEqual(r.state.inv.money, { USD: "32", CAD: "50", EUR: "50" }); },
        isolate: text => text.replace(/\bUSD\b/g, "EUR"),
        malformed: ["money - 51 USD", "money - 1 XYZ", "money - -18 USD", "money - 18 USD paid", "mnoey - 18 USD"],
    },
    "inv.supply": {
        heading: "Inventory",
        expect(r) { clean(r); assert.deepEqual(r.state.inv.items, ["9mm ammunition"]); assert.deepEqual(r.state.inv.supplies, { I1: { amount: "12", unit: "rounds" } }); },
        malformed: ["supply: -1 rounds | ammunition", "supply: 12 | ammunition", "supply: 12 rounds |", "suply: 12 rounds | ammunition"],
        valid: ["+ supply: 12 rounds | 9mm ammunition", "supply: 0.5 litres | water"],
    },
    "inv.quantity": {
        heading: "Inventory", seed: itemSeed("ammunition box"),
        expect(r) { clean(r); assert.deepEqual(r.state.inv.items, ["ammunition box"]); assert.deepEqual(r.state.inv.supplies, { I1: { amount: "12", unit: "rounds" } }); },
        malformed: ["I99 quantity: 12 rounds", "I1 quantity: -1 rounds", "I1 quantity: 12", "I1 quanttiy: 12 rounds"],
    },
    "inv.adjust": {
        heading: "Inventory", seed: supplySeed,
        expect(r) { clean(r); assert.deepEqual(r.state.inv.supplies, { I1: { amount: "9", unit: "rounds" } }); assert.deepEqual(r.state.inv.itemIds, ["I1"]); },
        malformed: ["I99 adjust: -3", "I1 adjust: -13", "I1 adjust: 3", "I1 adjust: +3 rounds", "I1 adjsut: -3"],
        valid: ["I1 adjust: +3", "I1 adjust: -12 (used)", "I1 adjust: +.5"],
    },
    "inv.title-add": {
        heading: "Inventory",
        expect(r) {
            clean(r);
            assert.deepEqual(r.state.inv.titles, [{ name: "Harbour Friend", effects: [{ kind: "numeric", n: 1, category: "social", focus: "dockworkers" }], hint: "" }]);
        },
        malformed: ["title:", "titel: Harbour Friend", "title Harbour Friend"],
    },
    "inv.title-remove": {
        heading: "Inventory",
        seed: entries("titles", "Harbour Friend"),
        expect(r) {
            clean(r);
            assert.deepEqual(r.state.inv.titles, []);
        },
        malformed: ["title - Duke", "title -", "titel - Harbour Friend"],
    },
    "inv.status-add": {
        heading: "Inventory",
        expect(r) {
            clean(r);
            assert.deepEqual(r.state.inv.status, [{ name: "Legs spent", effects: [{ kind: "numeric", n: -2, category: "physical", focus: "running" }], hint: "" }]);
        },
        malformed: ["status +", "stauts + Tired", "status Tired"],
    },
    "inv.status-remove": {
        heading: "Inventory",
        seed: entries("status", "Tired"),
        expect(r) {
            clean(r);
            assert.deepEqual(r.state.inv.status, []);
        },
        valid: ["status - Unknown"],
        malformed: ["status -", "stauts - Tired"],
    },

    // ── Chekhov (story time Day 3 — 12:00)
    "chekhov.load": {
        heading: "Chekhov",
        seed: s => { s.scene.now = s.scene.now || "Day 3 — 12:00"; },
        expect(r) {
            clean(r);
            assert.deepEqual(r.state.chekhov.bullets, [{
                id: "B1", desc: "the locked cellar door", weight: 2, age: 0, hot: true, secret: false, lock: "", at: { day: 3, minutes: 1080 }, after: "",
            }]);
            assert.deepEqual(r.warnings, []);
        },
        malformed: ["load:", "laod: the locked cellar door (w2, hot, at 18:00)", "load: the locked cellar door", "load: the locked cellar door (hot)"],
    },
    "chekhov.fire": {
        heading: "Chekhov",
        seed: bulletSeed({ age: 6 }),
        config: fireConfig(),
        expect(r) {
            clean(r);
            assert.deepEqual(r.state.chekhov, { bullets: [], fired: [{ id: "B1", desc: "the cellar door", how: "the cellar held the missing ledgers" }] });
            assert.deepEqual(r.warnings, []);
        },
        malformed: ["fire B99: the cellar held the missing ledgers", "fire B1:", "fier B1: the cellar held the missing ledgers", "fire B1 the cellar held the missing ledgers"],
    },
    "chekhov.lock": {
        heading: "Chekhov",
        seed: bulletSeed(),
        expect(r) {
            clean(r);
            assert.deepEqual(r.state.chekhov.bullets.map(b => [b.id, b.lock, b.age]), [["B1", "Mara has the only key", 2]]);
        },
        malformed: ["lock B99: Mara has the only key", "lock B1:", "lcok B1: Mara has the only key"],
    },
    "chekhov.unlock": {
        heading: "Chekhov",
        seed: bulletSeed({ lock: "the key is lost" }),
        expect(r) {
            clean(r);
            assert.deepEqual(r.state.chekhov.bullets.map(b => [b.id, b.lock, b.at, b.after, b.age]), [["B1", "", null, "", 3]]);
        },
        malformed: ["unlock B99", "unlock", "unlcok B1"],
    },
    "chekhov.prune": {
        heading: "Chekhov",
        seed: bulletSeed(),
        expect(r) {
            clean(r);
            assert.deepEqual(r.state.chekhov, { bullets: [], fired: [{ id: "B1", desc: "the cellar door", how: "pruned" }] });
        },
        malformed: ["prune B99", "prune", "pruen B1"],
    },

    // ── Fate (dice A 10 · B 1 · C 5: AMBIENT + TRUE)
    "fate.pursuit": {
        heading: "Fate",
        expect(r) {
            clean(r);
            assert.deepEqual([r.state.fate.state, r.state.fate.pursuit, r.state.fate.ts], ["THREAD", "who set the boathouse fire?", 0]);
        },
        malformed: ["pursuit:", "persuit: who set the boathouse fire?", "pursuit who set the boathouse fire?"],
    },
    "fate.close": {
        heading: "Fate",
        seed: s => { if (!s.fate.pursuit) Object.assign(s.fate, { state: "THREAD", pursuit: "who rang the bell?", ts: 2 }); },
        expect(r) {
            clean(r);
            assert.deepEqual([r.state.fate.state, r.state.fate.pursuit, r.state.fate.residue], ["ROUTINE", "", ["the arsonist fled town; the guild blames the union"]]);
        },
        malformed: ["close:", "colse: the arsonist fled town", "close the arsonist fled town"],
    },
    "fate.park": {
        heading: "Fate",
        seed: s => { if (!s.fate.pursuit) Object.assign(s.fate, { state: "THREAD", pursuit: "who rang the bell?", ts: 2 }); },
        expect(r) {
            clean(r);
            assert.deepEqual([r.state.fate.state, r.state.fate.pursuit, r.state.fate.residue], ["ROUTINE", "", ["the fire is old news; nobody talks of it"]]);
        },
        malformed: ["park:", "prak: the fire is old news", "park the fire is old news"],
    },
    "fate.defer-new": {
        heading: "Fate",
        expect(r) {
            clean(r);
            assert.deepEqual(r.state.fate.deferred, [{ id: "D1", desc: "the guild's audit of the docks", times: 1, age: 0 }]);
        },
        malformed: ["defer:", "defr: the guild's audit of the docks", "defer the guild's audit of the docks"],
    },
    "fate.defer": {
        heading: "Fate",
        seed: deferredSeed,
        expect(r) {
            clean(r);
            assert.deepEqual(r.state.fate.deferred, [{ id: "D1", desc: "the guild's audit", times: 2, age: 2 }]);
        },
        malformed: ["defer D99", "defer", "defr D1"],
    },
    "fate.resolve": {
        heading: "Fate",
        seed: deferredSeed,
        expect(r) {
            clean(r);
            assert.deepEqual(r.state.fate.deferred, []);
        },
        malformed: ["resolve D99", "resolve", "reslove D1"],
    },
    "fate.ambition": {
        heading: "Fate",
        expect(r) {
            clean(r);
            assert.deepEqual(r.state.fate.ambitions, [{ desc: "Mara wants her own boat", progress: 0 }]);
        },
        malformed: ["ambition:", "ambiton: Mara wants her own boat", "ambition Mara wants her own boat"],
    },
    "fate.ambition-progress": {
        heading: "Fate",
        seed: s => { if (!s.fate.ambitions.length) s.fate.ambitions.push({ desc: "Mara wants her own boat", progress: 1 }); },
        expect(r) {
            clean(r);
            assert.deepEqual(r.state.fate.ambitions, [{ desc: "Mara wants her own boat", progress: 2 }]);
        },
        malformed: ["ambition +1 Nobody wants this", "ambition +1", "ambiton +1 Mara wants"],
    },
    "fate.residue": {
        heading: "Fate",
        seed: s => { if (!s.fate.owed.length) s.fate.owed.push("W9 “a storm” landed; write its residue."); },
        expect(r) {
            clean(r);
            assert.deepEqual([r.state.fate.residue, r.state.fate.owed], [["the burnt pier is fenced off"], []]);
        },
        malformed: ["residue:", "residu: the burnt pier is fenced off", "residue the burnt pier is fenced off"],
    },
    "fate.consequence-landed": {
        heading: "Fate",
        expect(r) {
            clean(r);
            assert.deepEqual(r.state.fate.residue, ["CONSEQUENCE — the buoy broke during the race"]);
        },
        malformed: ["World CONSEQUENCE landed as", "World CONSEQUENCE lnaded as the buoy broke", "World CONSEQUENC landed as the buoy broke"],
    },
    // World Sim d20 15 on the Standard table (three named people off-screen): ARRIVAL
    "fate.world-landed": {
        heading: "Fate",
        seed: s => { for (const [n, p] of [["Ana", "the harbour"], ["Bo", "the mill"], ["Cy", "the inn"]]) if (!(n in s.locations)) s.locations[n] = p; },
        config: { dice: { fate: { a: 10, b: 1, c: 5 }, world: 15 } },
        expect(r) {
            clean(r);
            assert.equal(r.state.perTurn.worldsim.name, "ARRIVAL");
            assert.deepEqual([r.state.fate.residue, r.state.fate.world], [["ARRIVAL — a cousin turns up four hours early"], []]);
        },
        valid: ["World BAD NEWS landed as a cousin turns up"],
        malformed: ["World UNKNOWN landed as a cousin turns up", "World ARRIVAL landed as", "World ARRIVAL lnaded as a cousin turns up four hours early"],
    },

    // ── World (C 5: ELSEWHERE reach 1, REGIONAL 2, LOCAL 3)
    "world.add-elsewhere": worldAdd("ELSEWHERE", "a war breaks out across the sea", 1, "ELSWHERE"),
    "world.add-regional": worldAdd("REGIONAL", "the river road is flooded", 2, "REGINOAL"),
    "world.add-local": worldAdd("LOCAL", "the bakery closes for a funeral", 3, "LOACL"),
    "world.escalate": {
        heading: "World",
        seed: worldSeed,
        expect(r) {
            clean(r);
            assert.deepEqual(r.state.fate.world, [{ id: "W1", desc: "a war breaks out across the sea", prox: "REGIONAL", reach: 2, age: 3 }]);
        },
        malformed: ["escalate W99", "escalate", "esclate W1"],
    },
    "world.update": {
        heading: "World",
        seed: worldSeed,
        expect(r) {
            clean(r);
            assert.deepEqual(r.state.fate.world, [
                { id: "W1", desc: "a war breaks out across the sea", prox: "ELSEWHERE", reach: 1, age: 3,
                    updates: ["repair part sourced; Thursday earliest"] },
            ]);
        },
        malformed: ["update W99: wrong event", "update W1:", "updat W1: wrong syntax", "update W1 no colon"],
    },
    "world.escalate-note": {
        heading: "World",
        seed: worldSeed,
        expect(r) {
            clean(r);
            assert.deepEqual(r.state.fate.world, [
                { id: "W1", desc: "a war breaks out across the sea", prox: "REGIONAL", reach: 2, age: 3,
                    updates: ["fuel shortage reaches the neighbouring town"] },
            ]);
        },
        malformed: ["escalate W99: wrong event", "escalate W1:", "esclate W1: wrong syntax"],
    },
    "world.land": {
        heading: "World",
        seed: worldSeed,
        expect(r) {
            clean(r);
            assert.deepEqual([r.state.fate.world, r.state.fate.owed], [[], ["W1 “a war breaks out across the sea” landed: refugees reach the harbour"]]);
        },
        malformed: ["land W99: refugees reach the harbour", "land W1:", "lnad W1: refugees reach the harbour", "land W1 refugees reach the harbour"],
    },

    // ── Last and Check store any line: only the echoed skeleton (generated) is malformed.
    "last.beat": {
        heading: "Last",
        expect(r) {
            clean(r);
            assert.deepEqual(r.state.last, ["Mara promised to meet Jan at the mill at dawn"]);
        },
        malformed: [],
    },
    // the DnD example verifies against these titles and this die, so it adds no ledger line
    "checks.check": {
        heading: "Check",
        config: { dice: { fate: { a: 10, b: 1, c: 5 }, checks: [11] } },
        seed: s => {
            s.inv.titles = ["Got Your Nose", "Mon Ancre", "Love of Her Life"].map((name, i) => ({ name, effects: [{ kind: "numeric", n: i ? 2 : 1, category: "social", focus: "Emilia" }], hint: "" }));
        },
        expect(r, before, { style }) {
            clean(r);
            assert.deepEqual(r.state.perTurn.checks.lines, [style === "arrow"
                ? "Mara, leaps the gap · d20 11 +1 · Grazing Shot · she drops her lantern"
                : "Jan, makes Emilia laugh · social · DC 8 · d20 11 + Got Your Nose +1 + Mon Ancre +2 + Love of Her Life +2 = +5 → +4 (soft cap) · total 15 · success"]);
        },
        malformed: [],
    },
    // Thoughts' body is free text; only the actor label is syntax
    "thoughts.thought": {
        heading: "Thoughts",
        expect(r) {
            clean(r);
            assert.deepEqual(r.state.perTurn.thoughts, [{ name: "Mara", text: "he knows. he has to know. keep smiling." }]);
        },
        malformed: ["Mara:", "Mara he knows"],
    },

    // ── Physics
    "physics.env": {
        heading: "Physics",
        expect(r) {
            clean(r);
            assert.deepEqual(r.state.perTurn.physics, { env: "steady rain, lamplight, slick cobbles", scene: "" });
        },
        malformed: ["Env:", "Evn: steady rain, lamplight, slick cobbles", "Env steady rain, lamplight, slick cobbles"],
    },
    "physics.scene": {
        heading: "Physics",
        expect(r) {
            clean(r);
            assert.deepEqual(r.state.perTurn.physics, { env: "", scene: "Mara at the door, Jan three paces back, the alley out of sight" });
        },
        malformed: ["Scene:", "Scnee: Mara at the door", "Scene Mara at the door"],
    },
};
