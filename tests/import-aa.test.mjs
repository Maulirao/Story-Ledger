// Importing an Ancient Access <ledger>. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/model/config.js";
import { importForeign } from "../src/model/import/index.js";
import { AA_LEDGER } from "./fixtures/foreign.mjs";

const C = { ...resolveConfig(), userName: "Jan", sections: {} };
const ai = mes => ({ is_user: false, is_system: false, mes });

test("an Ancient Access ledger imports turn, last beats, agendas, notebook, gun, gear, quests and factions", () => {
    const r = importForeign([ai(AA_LEDGER)], C);
    assert.equal(r.source, "aa");
    assert.equal(r.state.ct, 41);
    assert.deepEqual(r.state.last, ["Mara said the café opens at ten", "Jan dropped the key", "Ana texted"]);
    assert.deepEqual(r.state.agendas.Ana, { task: "close the café", step: 1, max: 2, aware: "", fibs: "", circle: "", body: "" });
    assert.equal(r.state.locations.Bo, "the dock");
    assert.deepEqual(r.rules, ["Ana does not know about the key."]);
    assert.deepEqual(r.state.threads, ["Race after breakfast."]);
    assert.deepEqual(r.state.chekhov.bullets.map(b => [b.id, b.desc, b.weight, b.age, b.secret, Boolean(b.at)]),
        [["B1", "the ladder by the window", 2, 5, false, false], ["B2", "Ana's shift ends", 1, 0, false, true], ["B3", "the letter", 3, 2, true, false]]);
    assert.deepEqual(r.state.chekhov.bullets[1].at, { day: 7, minutes: 23 * 60 });
    assert.equal(r.state.chekhov.fired.length, 1);
    assert.deepEqual(r.state.inv.items, ["umbrella", "spare key"]);
    assert.deepEqual(r.state.quests.map(q => [q.id, q.kind, q.objective]), [["Q1", "Main", "find the spare key"]]);
    assert.equal(r.state.factions["Harbour Guild"].goal, "wants the docks");
    assert.match(r.state.scene.now, /Day 7/);
    assert.ok(r.unread.some(u => u.startsWith("SCENE")));
    assert.ok(Object.keys(r.state.rel.awaiting).length, "BONDS are carried as relationships awaiting NEW");
});

test("AA gear titles and conditions go through the legacy list reader", () => {
    const led = `<ledger>\nTURN: 3\nGEAR: Jan — umbrella · Mon Ancre (+2 social Emilia); Charmer (+1 social: Ana) · all prior + wet (-1 physical) | Mara — mug · soaked\n</ledger>`;
    const r = importForeign([ai(led)], C);
    const [a, b] = r.state.inv.titles;
    assert.equal(a.name, "Mon Ancre");
    assert.deepEqual(a.effects, [{ kind: "numeric", n: 2, category: "social", focus: "Emilia" }]);
    assert.deepEqual(b.effects, [{ kind: "numeric", n: 1, category: "social", focus: "Ana" }]);
    assert.deepEqual(r.state.inv.status.map(e => [e.name, e.effects.length]), [["wet", 1]]);
    assert.ok(r.unread.some(u => /"all prior"/.test(u)));
});
