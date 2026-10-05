// Pure helpers behind the phase-3 settings and the 📜 Quests tab. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/model/config.js";
import { emptyState } from "../src/model/state.js";
import { parseChanges } from "../src/model/changes.js";
import { renderBlock, replaceSectionRows } from "../src/model/block.js";
import { postTurn } from "../src/model/turn.js";

test("a partial Chekhov override keeps the other defaults", () => {
    const c = resolveConfig({ sectionConfig: { chekhov: { firedKeep: 0 } } });
    assert.equal(c.sectionConfig.chekhov.firedKeep, 0);
    assert.equal(c.sectionConfig.chekhov.cap, 20);
    assert.equal(c.sectionConfig.chekhov.firing, "model");
    assert.equal(c.sectionConfig.lastBeats, 3);
});

test("replacing one section's rows leaves the rest of the reply untouched, per-turn sections included", () => {
    const C = { ...resolveConfig(), userName: "Jan", sections: {} };
    const r = postTurn(emptyState(), parseChanges("<!-- Story_Ledger\nQuests:\n- + Side: a\n- done Q1\nThoughts:\n- Mara: hm.\n-->"), { ...C, rolls: [3, 4, 5] });
    const mes = `Prose.\n<!-- Story_Ledger\nNow: x\n-->\n\n${renderBlock(r.state, { rules: [], config: C, sections: {} })}`;
    const out = replaceSectionRows(mes, /^QUESTS$/, ["- <b>Q1 Side</b> | done · sent | Objective: a | Progress: — | Reward: —"]);
    assert.match(out, /<b>Q1 Side<\/b> \| done · sent \|/);
    assert.match(out, /INTERNAL THOUGHTS[\s\S]*hm\./);
    assert.match(out, /<b>Rolls:<\/b> 3, 4, 5/);
    assert.equal(out.replace(/\| done · sent \|/, "| done |"), mes);
    assert.equal(replaceSectionRows("no block here", /^QUESTS$/, ["x"]), null);
});
