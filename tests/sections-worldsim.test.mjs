// 🌎 WORLD SIM — d20 events shown for this reply only. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/model/config.js";
import { emptyState } from "../src/model/state.js";
import { postTurn } from "../src/model/turn.js";
import { renderBlock, parseBlock } from "../src/model/block.js";
import worldsim from "../src/model/sections/worldsim.js";

const C = { ...resolveConfig(), userName: "Jan", sections: {}, dice: { world: 7 } };

test("Duo with two named NPCs or none off-screen, Standard otherwise", () => {
    const s = emptyState();
    s.agendas = { Mara: {}, Ana: {} };
    s.scene.present = ["Mara", "Jan"];
    assert.equal(worldsim.decide(s, { config: C }).table, "Duo");

    s.agendas = { Mara: {}, Ana: {}, Bo: {}, Ren: {} };
    s.scene.present = ["Mara", "Ana", "Bo", "Ren", "Jan"];
    assert.equal(worldsim.decide(s, { config: C }).table, "Duo");

    s.scene.present = ["Mara", "Ana", "Bo", "Jan"];
    assert.equal(worldsim.decide(s, { config: C }).table, "Standard");
});

test("the roll picks the entry on the table, 1–2 and 19–20 both CALM", () => {
    const duo = emptyState();
    const standard = emptyState();
    standard.agendas = { Mara: {}, Ana: {}, Bo: {} };
    standard.scene.present = ["Mara", "Ana", "Jan"];
    for (const [tableState, key] of [[duo, "duo"], [standard, "standard"]]) {
        for (const roll of [1, 2, 19, 20]) {
            const event = worldsim.decide(tableState, { config: { ...C, dice: { world: roll } } });
            assert.equal(event.name, "CALM", `${key} roll ${roll}`);
        }
        const entries = C.sectionConfig.worldsim[key];
        for (let roll = 1; roll <= 20; roll++) {
            const event = worldsim.decide(tableState, { config: { ...C, dice: { world: roll } } });
            const expected = entries.find(item => item.from <= roll && roll <= item.to);
            assert.ok(event && event.name && event.text, `${key} roll ${roll} has an event`);
            assert.equal(event.name, expected.name, `${key} roll ${roll} picks its entry`);
        }
    }
});

test("no dice, no event", () => {
    assert.equal(worldsim.decide(emptyState(), { config: { ...C, dice: {} } }), null);
    assert.deepEqual(postTurn(emptyState(), null, { ...C, dice: {} }).state.perTurn.worldsim, null);
});

test("the block shows roll, table and event and nothing is carried", () => {
    const s = emptyState();
    s.scene.present = ["Mara", "Jan"];
    const { state } = postTurn(s, null, C);
    const block = renderBlock(state, { config: C, sections: {} });
    assert.match(block, /🌎 WORLD SIM/);
    assert.match(block, /<b>Roll:<\/b> 7/);
    assert.match(block, /<b>Table:<\/b> Duo/);
    assert.match(block, /<b>Event:<\/b>/);

    const parsed = parseBlock(block, { config: C }).state;
    assert.equal(Object.hasOwn(parsed, "worldsim"), false);
    assert.equal(Object.hasOwn(parsed.perTurn, "worldsim"), false);
    assert.equal(postTurn(state, null, { ...C, dice: {} }).state.perTurn.worldsim, null);
});

test("the event is surfaced with its Life Gate", () => {
    const facts = worldsim.facts(emptyState(), { config: C, turn: { worldsim: worldsim.decide(emptyState(), { config: C }) } }).join("\n");
    assert.match(facts, /World Sim: .+ — .+Use it only if Fate's cell is TRUE; discard it on a WEIGHTED turn; skip it in an intimate scene\./);
});

test("worldsim event text is configurable without dropping the other table", () => {
    const config = resolveConfig({ sectionConfig: { worldsim: { duo: [{ from: 1, to: 20, name: "CUSTOM", text: "custom text" }] } } });
    assert.equal(config.sectionConfig.worldsim.duo[0].name, "CUSTOM");
    assert.equal(config.sectionConfig.worldsim.standard.length, 10);
});
