// Semantic refusals the tolerant reader must keep (spec §5.3). Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/model/config.js";
import { emptyState } from "../src/model/state.js";
import { parseChanges } from "../src/model/changes.js";
import { postTurn } from "../src/model/turn.js";

const C = { ...resolveConfig(), userName: "Jan", sections: {} };
const DICE = { fate: { a: 10, b: 1, c: 5 } };
const ch = body => parseChanges(`<!-- Story_Ledger\n${body}\n-->`);
const run = (s, body, config = { ...C, dice: DICE }) => postTurn(s, ch(body), config);
const list = (heading, lines) => `${heading}:\n${lines.map(l => `- ${l}`).join("\n")}`;
const unread = (section, lines) => lines.map(line => ({ section, line }));
const AXES = "E 3, M 4, L 3, Er 3, Ph 4, Ec 5, Pr 3, St 4, Sg 3, Ad 3, Ag 3, Pt 4";

test("a Fate recap naming another tier or source stays unparsed", () => {
    // dice a10 b1 c5 compute AMBIENT + TRUE
    const lines = ["MAJOR: x", "AMBIENT + WEIGHTED: x"];
    const r = run(emptyState(), list("Fate", lines));
    assert.deepEqual(r.unparsed, unread("Fate", lines));
    assert.equal(r.state.fate.lastTurn.tier, "AMBIENT");
    assert.equal(r.state.fate.lastTurn.source, "TRUE");
    assert.deepEqual(r.state, run(emptyState(), "").state);
});

test("landed story aftermath cannot replace the selected World Sim event", () => {
    const config = { ...C, dice: { ...DICE, world: 3 } };
    const line = "World BAD NEWS landed as x";
    const r = run(emptyState(), list("Fate", [line]), config);
    assert.equal(r.state.perTurn.worldsim.name, "GOOD NEWS");
    assert.deepEqual(r.unparsed, []);
    assert.deepEqual(r.state.fate.residue, ["BAD NEWS — x"]);
    assert.deepEqual({ ...r.state, fate: { ...r.state.fate, residue: [] } }, run(emptyState(), "", config).state);
});

test("a tick awaiting NEW is saved without inventing a baseline and keeps the import note", () => {
    let s = run(emptyState(), list("Relationships", [`NEW Jan → Mara: ${AXES} | Φ 2 (old friends)`])).state;
    assert.ok(s.rel.pairs["Jan→Mara"]);
    s = { ...s, rel: { ...s.rel, awaiting: { "Mara→Jan": "BOND 18" } } };
    const r = run(s, list("Relationships", ["Mara → Jan: E_acc +1 (helped)"]));
    const refused = r.log.filter(l => l.kind === "refused");
    assert.equal(refused.length, 0);
    assert.deepEqual(r.state.rel.pending, [{ ct: r.state.ct, kind: "tick", from: "Mara", to: "Jan", acc: "E", amount: 1, reason: "helped" }]);
    assert.deepEqual(r.state.rel.pairs, run(s, "").state.rel.pairs);
    assert.equal(r.state.rel.pairs["Mara→Jan"], undefined);
    assert.deepEqual(r.state.rel.awaiting, { "Mara→Jan": "BOND 18" });
    assert.deepEqual(r.unparsed, []);
});

test("a NEW line missing an axis is refused before any pair is created", () => {
    const r = run(emptyState(), list("Relationships", ["NEW Nora → Emilia: Ph 4"]));
    const refused = r.log.filter(l => l.kind === "refused");
    assert.equal(refused.length, 1);
    assert.match(refused[0].text, /NEW Nora → Emilia refused: missing E, M, L, Er, Ec/);
    assert.deepEqual(r.state.rel.pairs, {});
    assert.deepEqual(r.state.rel.selves, {});
    assert.deepEqual(r.state.rel.awaiting, { "Nora→Emilia": "" });
});

test("agenda progress 3/2 and 0/0 stays unparsed and changes no agenda", () => {
    const s = emptyState();
    s.agendas.Dean = { task: "officiate the race", step: 1, max: 3, aware: "the rules", fibs: "", circle: "", body: "" };
    const lines = ["Dean: officiate the race (3/2)", "Dean: officiate the race (0/0)", 'Dean: new "judge" 3/2', 'Dean: new "judge" 0/0', 'Nora: new "repair" 3/2'];
    const r = run(s, list("Agendas", lines));
    assert.deepEqual(r.unparsed, unread("Agendas", lines));
    assert.deepEqual(r.state.agendas, run(s, "").state.agendas);
    assert.equal(r.state.agendas.Nora, undefined);
});

test("ambition +1 with no matching ambition stays unparsed", () => {
    const s = emptyState();
    s.fate.ambitions = [{ desc: "Mara wants her own boat", progress: 2 }];
    const line = "ambition +1 nothing-like-it";
    const r = run(s, list("Fate", [line]));
    assert.deepEqual(r.unparsed, unread("Fate", [line]));
    assert.deepEqual(r.state.fate.ambitions, s.fate.ambitions);
    assert.deepEqual(r.state, run(s, "").state);
});

test("unknown item and title removals stay unparsed; absent status removals are harmless", () => {
    const s = emptyState();
    s.inv.items = ["key"];
    s.inv.titles = ["Captain"];
    s.inv.status = ["Tired", "Injured"];
    const lines = ["- lantern", "title - Duke", "status - Unknown"];
    const r = run(s, list("Inventory", lines));
    assert.deepEqual(r.unparsed, unread("Inventory", lines.slice(0, 2)));
    assert.deepEqual(r.state.inv, { ...s.inv, itemIds: ["I1"] });
    assert.deepEqual(r.state, run(s, "").state);
    const partial = run(s, list("Inventory", ["status - Tired; Unknown"]));
    assert.deepEqual(partial.state.inv.status, ["Injured"]);
    assert.deepEqual(partial.unparsed, []);
});

test("fire, lock, unlock and prune for a pruned or unknown bullet stay unparsed", () => {
    let s = run(emptyState(), list("Chekhov", ["load: the locked cellar door (w2)"])).state;
    s = run(s, list("Chekhov", ["load: a letter in the drawer (w1)"])).state;
    s = run(s, list("Chekhov", ["prune B1"])).state;
    assert.deepEqual(s.chekhov.bullets.map(b => b.id), ["B2"]);
    assert.deepEqual(s.chekhov.fired.map(f => [f.id, f.how]), [["B1", "pruned"]]);
    const lines = ["fire B1: x", "lock B99: x", "unlock B99", "prune B99"];
    const r = run(s, list("Chekhov", lines));
    assert.deepEqual(r.unparsed, unread("Chekhov", lines));
    assert.deepEqual(r.state.chekhov, run(s, "").state.chekhov);
    assert.deepEqual(r.state, run(s, "").state);
});

test("a grouped faction line with an unknown label is unparsed whole and changes no field", () => {
    const s = emptyState();
    s.factions.Pack = { goal: "old goal", intel: "", fibs: "", state: "old state", conflict: "", relations: "" };
    const line = "Pack: goal|rumour: judged";
    const r = run(s, list("Factions", [line]));
    assert.deepEqual(r.unparsed, unread("Factions", [line]));
    assert.deepEqual(r.state.factions, s.factions);
    assert.deepEqual(r.state, run(s, "").state);
});
