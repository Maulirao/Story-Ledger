// The handover after an import, and imported rules. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { buildHandover, HANDOVER } from "../src/model/prompt.js";
import { proposeImportedRules } from "../src/model/import/index.js";
import { emptyNotebook } from "../src/model/notebook.js";

test("the handover asks only for what the import did not bring", () => {
    const h = buildHandover(["agendas", "quests", "chekhov", "inv"], { hasNow: true });
    assert.match(h, /NEW/);
    assert.doesNotMatch(h, /\bNow:/);
    assert.doesNotMatch(h, /Agendas/);
    assert.match(h, /Factions/);
    assert.match(h, /Stop writing the old preset's state block/);
});

test("a switched-off section is not asked for", () => {
    assert.doesNotMatch(buildHandover([], { hasNow: true, sections: { factions: false } }), /Factions/);
});

test("with nothing imported the handover asks for everything, Now included", () => {
    assert.match(HANDOVER, /\bNow:/);
    assert.match(HANDOVER, /Agendas/);
});

test("imported rules are proposed once", () => {
    const once = proposeImportedRules(emptyNotebook(), ["Ana does not know about the key."], null);
    assert.equal(once.notebook.inbox.length, 1);
    assert.ok(once.done);
    const again = proposeImportedRules(once.notebook, ["Ana does not know about the key."], once.done);
    assert.equal(again.notebook.inbox.length, 1);
});
