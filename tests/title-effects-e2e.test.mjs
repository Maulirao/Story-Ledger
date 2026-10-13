// End to end with the user's real pasted title lists. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/model/config.js";
import { emptyState } from "../src/model/state.js";
import { renderBlock, parseBlock } from "../src/model/block.js";
import { entryNames } from "../src/model/sections/inventory.js";
import { parseChanges } from "../src/model/changes.js";
import { postTurn, preTurnFacts } from "../src/model/turn.js";

const C = { ...resolveConfig(), userName: "Jan", sections: {} };
const LIST_A = "Mon Ancre, Mon Unique, Love of Her Life, Promise Keeper, Belle-Maman Claimed, Stood Up to Marie, Gilles Approval, Bon Garçon, Silent Understanding, Her Defender, Taste of Heaven, The One Who Remembers, Oblivious Devotion, Got Your Nose, The Whole Time, Foot Worshipper, Marked, Her Rules, Towel Burrito Architect, The Dresser, Oversized, Grandpa Shorts, Love You Maman, Sandwich Coup, Compromis, Mustard Thief, Faithful Steed, Tactical Koala, Uppies Service, Dream Carrier, Mon Vacher, Constitutional Loophole, Kisses Per Second, The Dozen, Tummy Whisperer, The Forklift, Human Scaffolding, Peer Review, Assembly Line, The Breakdown, Lost Count, Two Hours, Kitchen Sobber, Chin Licker, Spoon Privileges Revoked, Fork Loophole Lawyer, Premier Mot Keeper, Complete Inventory, One Hour Negotiator, Lumière de Ma Vie, Drool Sommelier, One Hour Watcher, The Forklift, Premier Mot Keeper, His Father's Hands, Ninety Years, Non-Négociable, Mon Toujours, Bitten (First), Cedar Kit, Daily Brusher (contracted), Royal Chariot, Chief of Staff, + NEW: Undefeated Charioteer (passive +1 to all carry momentum checks), Undefeated Charioteer (twice verified), + Casino Architect (earned — constructed a bet that cannot be won), all prior";
const LIST_B = "Mon Ancre (+2 social Emilia), Mon Unique (+2 social Emilia), Promise Keeper (+1 trust checks), Stood Up to Marie (+2 family standing, -2 social Marie), Bon Garçon (+1 social Sofia, +1 social Gilles), Got Your Nose (+1 comedy Emilia)";

const withRows = rows => renderBlock(emptyState(), { rules: [], config: C, sections: {} })
    .replace(/- <b>Inv:<\/b>[^\n]*\n[\s\S]*?- <b>Mods:<\/b>[^\n]*/, `- <b>Inv:</b> —\n${rows}`);
const titlesOf = list => parseBlock(withRows(`- <b>Titles/Skills:</b> ${list}`), { config: C }).state.inv.titles;
const count = (titles, name) => titles.filter(t => t.name === name).length;

test("list A splits, drops 'all prior', merges duplicates, keeps the hint", () => {
    const titles = titlesOf(LIST_A);
    const names = entryNames(titles);
    assert.ok(!names.some(n => /all prior/i.test(n)), "all prior dropped");
    assert.equal(count(titles, "The Forklift"), 1);
    assert.equal(count(titles, "Premier Mot Keeper"), 1);
    assert.equal(count(titles, "Undefeated Charioteer"), 1);
    assert.equal(titles.find(t => t.name === "Undefeated Charioteer").hint, "passive +1 to all carry momentum checks");
});

test("list B (numbered) gives effects to Mon Ancre and Bon Garçon, hints to the rest", () => {
    const titles = titlesOf(LIST_B);
    const by = n => titles.find(t => t.name === n);
    assert.deepEqual(by("Mon Ancre").effects, [{ kind: "numeric", n: 2, category: "social", focus: "Emilia" }]);
    assert.ok(by("Bon Garçon").effects.length > 0);
    for (const n of ["Promise Keeper", "Got Your Nose", "Stood Up to Marie"]) {
        assert.equal(by(n).effects.length, 0, n);
        assert.ok(by(n).hint, n);
    }
});

test("preTurnFacts lists exactly 10 needs-effect titles", () => {
    const s = emptyState(); s.inv.titles = titlesOf(LIST_A);
    const facts = preTurnFacts(s, C).filter(l => /^Titles that need an effect/.test(l));
    assert.equal(facts.length, 1);
    const listed = facts[0].replace(/^[^:]*\):\s*/, "").split(/;\s*/).filter(Boolean);
    assert.equal(listed.length, 10, facts[0]);
});

test("a turn that gives two titles effects and cites them in a correct check raises nothing", () => {
    const s = emptyState(); s.inv.titles = titlesOf(LIST_A);
    const cfg = { ...C, dice: { checks: [11] } };
    const body = "Inventory:\n- title: Mon Ancre | +2 social: Emilia\n- title: Mon Unique | +1 social: Emilia\n"
        + "Check:\n- Jan, makes Emilia laugh · social · DC 8 · d20 11 + Mon Ancre +2 + Mon Unique +1 = +3 · total 14 · success";
    const r = postTurn(s, parseChanges(`<!-- Story_Ledger\n${body}\n-->`), cfg);
    assert.deepEqual(r.warnings.filter(w => w.section === "Check"), []);
    assert.equal(r.state.perTurn.checks.lines.length, 1);
    assert.ok(!r.state.perTurn.checks.lines.some(l => /ledger:/.test(l)));
});
