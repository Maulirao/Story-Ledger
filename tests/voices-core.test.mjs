// Dialogue voices in core: the reader's overrides, the fill-in when a reply arrives, the
// list the painter reads, and the Voices tab. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import * as core from "../src/host/core.js";
import { emptyState } from "../src/model/state.js";
import { AUTO_POOL } from "../src/model/voices.js";

const settings = core.normalizeSettings({});
const config = core.engineConfig(settings, "Jan");
const reply = mes => ({ mes, is_user: false, is_system: false, name: "", swipe_id: 0 });
const withJim = () => { const s = emptyState(); s.voices = { Jim: { colour: "#3fa7a0", source: "model" } }; return s; };

test("an override wins on screen and in the prompt but is never written into a block", () => {
    const chat = [
        reply(`Hi.\n\n${core.blockFor(withJim(), { settings, chatData: core.normalizeChatData({}), userName: "Jan" })}`),
        reply('"Ok."\n\n<!-- Story_Ledger\nNow: Day 1\n-->'),
    ];
    const chatData = core.normalizeChatData({ storyLedger: { voiceOverrides: { Jim: "orchid" } } });
    assert.deepEqual(core.voiceList({ chat, settings, chatData, userName: "Jan" }).Jim, { colour: "orchid", hex: "#da70d6", source: "you" });
    assert.match(core.ledgerPromptParts(chat, config, chatData, settings).statePrompt, /Jim orchid/);
    const out = core.rebuildMessage({ chat, index: 1, settings, chatData, userName: "Jan" });
    assert.match(out.mes, /<b>Jim<\/b> \| #3fa7a0 \| model/);
    assert.doesNotMatch(out.mes, /orchid/);
});
test("a reply's new speakers are filled in when it arrives", () => {
    const chat = [reply('<kael>"Hi."\n\n<!-- Story_Ledger\nNow: Day 1\n-->')];
    const out = core.rebuildMessage({ chat, index: 0, settings, chatData: core.normalizeChatData({}), userName: "Jan" });
    assert.match(out.mes, new RegExp(`<b>kael</b> \\| ${AUTO_POOL[0]} \\| auto`));
});
test("the reader can add a voice before it speaks, and remove it", () => {
    const d = core.normalizeChatData({});
    const add = core.setVoice(d, "Kael", "#C0392B");
    assert.deepEqual(add, { ok: true, chatDataPatch: { voiceOverrides: { Kael: "#c0392b" } } });
    assert.deepEqual(core.setVoice({ ...d, ...add.chatDataPatch }, "kael", null), { ok: true, chatDataPatch: { voiceOverrides: {} } });
});
test("setVoice refuses mind, blanks and non-colours", () => {
    const d = core.normalizeChatData({});
    assert.equal(core.setVoice(d, "Mind", "red").error, '"mind" is reserved for telepathy.');
    assert.equal(core.setVoice(d, " ", "red").error, "Give the voice a name.");
    assert.equal(core.setVoice(d, "Jim", "blurple").error, "Not a colour: blurple. Use a CSS colour name or #hex.");
});
