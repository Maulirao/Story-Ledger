// 🧠 INTERNAL THOUGHTS, 🌌 PHYSICS, 🎲 checks — shown in this reply's block only. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/model/config.js";
import { emptyState } from "../src/model/state.js";
import { parseChanges } from "../src/model/changes.js";
import { renderBlock, parseBlock } from "../src/model/block.js";
import { postTurn, preTurnFacts } from "../src/model/turn.js";

const C = { ...resolveConfig(), userName: "Jan", sections: {} };
const ch = body => parseChanges(`<!-- Story_Ledger\n${body}\n-->`);

test("per-turn sections are shown but never carried to the next turn", () => {
    const r1 = postTurn(emptyState(), ch("Thoughts:\n- Mara: he saw. of course he saw.\nPhysics:\n- Env: dew on the grass\nCheck:\n- Jan, lockpicking · DC 12 · d20 14 +1 · Success"), { ...C, rolls: [14, 7, 19] });
    const txt = renderBlock(r1.state, { rules: [], config: C, sections: {} });
    assert.match(txt, /🧠 INTERNAL THOUGHTS[\s\S]*he saw/);
    assert.match(txt, /<b>Env:<\/b> dew on the grass/);
    assert.match(txt, /<b>Rolls:<\/b> 14, 7, 19/);
    assert.match(txt, /Jan, lockpicking · DC 12/);
    const back = parseBlock(txt, { config: C }).state;
    assert.deepEqual(back.perTurn, {});
    assert.deepEqual(postTurn(back, null, C).state.perTurn.thoughts, []);
});

test("an empty per-turn section writes nothing", () => {
    const r = postTurn(emptyState(), null, C);
    const txt = renderBlock(r.state, { rules: [], config: C, sections: {} });
    assert.doesNotMatch(txt, /INTERNAL THOUGHTS|PHYSICS|DND TASK SIM/);
});

test("the checks title and facts follow the check style", () => {
    const s = emptyState();
    assert.match(preTurnFacts(s, { ...C, rolls: [14, 7, 19] }).join("\n"), /d20s 14, 7, 19/);
    assert.match(preTurnFacts(s, { ...C, checkStyle: "arrow", rolls: [3, 9, 16] }).join("\n"), /Wind Rolls: 3, 9, 16/);
    const r = postTurn(s, null, { ...C, checkStyle: "arrow", rolls: [3] });
    assert.match(renderBlock(r.state, { rules: [], config: { ...C, checkStyle: "arrow" }, sections: {} }), /🏹 WIND'S ARROW/);
});
