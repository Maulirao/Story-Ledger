// Final-review fixes for the importers. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/model/config.js";
import { importForeign } from "../src/model/import/index.js";
import { entryNames } from "../src/model/sections/inventory.js";
import { importFromLegacyNotebook } from "../src/model/notebook.js";
import { buildHandover } from "../src/model/prompt.js";
import { FF_FULL } from "./fixtures/foreign.mjs";

const C = { ...resolveConfig(), userName: "Jan", sections: {} };
const ai = mes => ({ is_user: false, is_system: false, mes });
const user = mes => ({ is_user: true, is_system: false, mes });
const ff = sections => `<internal_states>\n<details><summary>🎬 INTERNAL STATES (Turn: 5)</summary>\n${sections}\n</details>\n</internal_states>`;

test("FF Chekhov written as separate Active / Locked / Fired rows imports each once", () => {
    const r = importForeign([ai(ff("<details><summary>🔫 CHEKHOV'S GUN</summary><br>- Active: [BULLET: the ladder] (weight: 2, age: 7/12) [hot]<br>- Locked: [BULLET: the shift] (weight: 1, age: 0/12) [LOCKED: T:18:00]<br>- Fired: [BULLET: the cup] (weight: 1, age: 4/12)<br></details>"))], C);
    assert.deepEqual(r.state.chekhov.bullets.map(b => b.desc), ["the ladder", "the shift"]);
    assert.deepEqual(r.state.chekhov.fired.map(f => f.desc), ["the cup"]);
});

test("an FF quest's status comes from its status, not from words in its objective or reward", () => {
    const r = importForeign([ai(ff("<details><summary>📜 QUESTS</summary>\n- <b>Main:</b> Active — complete the ritual | <b>Progress:</b> 1/3 | <b>Reward:</b> the complete map\n- <b>Side:</b> Completed — fix the gate\n</details>"))], C);
    assert.deepEqual(r.state.quests.map(q => [q.objective, q.status]), [["complete the ritual", "active"], ["fix the gate", "done"]]);
});

test("Ancient Access's own module formats import", () => {
    const led = `<ledger>
TURN: 3
GEAR: Jan — umbrella, spare key · Charmer · wet | Mara — mug · soaked
QUESTS: Main — find the key · progress 1/3 · active | Side — fix the gate · done
FACTIONS: Harbour Guild · wants the docks · knows about the tax · claims innocence · low morale · hostile to the mayor
GUN: the ladder · weight: 2 · age: 5
FIRED: the cup, the saucer
</ledger>`;
    const r = importForeign([ai(led)], C);
    assert.deepEqual(r.state.inv.items, ["umbrella", "spare key"]);
    assert.deepEqual(entryNames(r.state.inv.titles), ["Charmer"]);
    assert.deepEqual(entryNames(r.state.inv.status), ["wet"]);
    assert.deepEqual(r.state.quests.map(q => [q.kind, q.objective, q.status, q.progress]), [["Main", "find the key", "active", "1/3"], ["Side", "fix the gate", "done", ""]]);
    assert.deepEqual(r.state.factions["Harbour Guild"], { goal: "wants the docks", intel: "knows about the tax", fibs: "claims innocence", state: "low morale", conflict: "", relations: "hostile to the mayor" });
    assert.deepEqual(r.state.chekhov.bullets.map(b => [b.desc, b.weight, b.age]), [["the ladder", 2, 5]]);
    assert.deepEqual(r.state.chekhov.fired.map(f => f.desc), ["the cup, the saucer"]);
});

test("rows a partly read section could not read are reported, and the handover asks for them", () => {
    const r = importForeign([ai(ff("<details><summary>📜 QUESTS</summary>\n- <b>Main:</b> Active — find the key\n- ??? garbled\n- !!! also garbled\n</details>"))], C);
    assert.ok(r.imported.includes("quests"));
    assert.ok(r.unread.some(u => /QUESTS/.test(u) && /2/.test(u)), r.unread.join(" | "));
    assert.match(buildHandover(r.imported, { hasNow: true, unread: r.unread }), /QUESTS/);
});

test("a pipe-separated notebook splits into its entries", () => {
    for (const sep of [" | ", " &#124; "]) {
        const mes = `<details><summary>📓 GM'S NOTEBOOK</summary>- [R] Ana does not know.${sep}- [T] Race after breakfast.${sep}[R] Bo is left-handed.</details>`;
        assert.deepEqual(importFromLegacyNotebook([ai(mes)]), { rules: ["Ana does not know.", "Bo is left-handed."], threads: ["Race after breakfast."] }, sep);
    }
});

test("a chat that already ran Story Ledger 0.1 (comments, no block) never imports a foreign block", () => {
    assert.equal(importForeign([ai(FF_FULL), user("go"), ai("x\n<!-- Story_Ledger\nNow: Day 4\n-->")], C).source, null);
});
