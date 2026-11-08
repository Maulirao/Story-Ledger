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

test("the reader's colour wins on screen and in the prompt, and goes into the next block as a you row", () => {
    const chat = [
        reply(`Hi.\n\n${core.blockFor(withJim(), { settings, chatData: core.normalizeChatData({}), userName: "Jan" })}`),
        reply('"Ok."\n\n<!-- Story_Ledger\nNow: Day 1\n-->'),
    ];
    const chatData = core.normalizeChatData({ storyLedger: { voiceOverrides: { Jim: "orchid" } } });
    assert.deepEqual(core.voiceList({ chat, settings, chatData, userName: "Jan" }).Jim, { colour: "orchid", hex: "#da70d6", source: "you" });
    assert.match(core.ledgerPromptParts(chat, config, chatData, settings).statePrompt, /Jim orchid/);
    const out = core.rebuildMessage({ chat, index: 1, settings, chatData, userName: "Jan" });
    assert.match(out.mes, /<b>Jim<\/b> \| orchid \| you/);
});
test("a reply's new speakers are filled in when it arrives", () => {
    const chat = [reply('<kael>"Hi."\n\n<!-- Story_Ledger\nNow: Day 1\n-->')];
    const out = core.rebuildMessage({ chat, index: 0, settings, chatData: core.normalizeChatData({}), userName: "Jan" });
    assert.match(out.mes, new RegExp(`<b>kael</b> \\| ${AUTO_POOL[0]} \\| auto`));
});
test("the reader can add a voice before it speaks, and delete it", () => {
    const d = core.normalizeChatData({});
    const add = core.setVoice(d, "Kael", "#C0392B");
    assert.deepEqual(add, { ok: true, chatDataPatch: { voiceOverrides: { Kael: "#c0392b" } } });
    assert.deepEqual(core.setVoice({ ...d, ...add.chatDataPatch }, "kael", null), { ok: true, chatDataPatch: { voiceOverrides: { kael: null } } });
});
test("setVoice refuses mind, blanks and non-colours", () => {
    const d = core.normalizeChatData({});
    assert.equal(core.setVoice(d, "Mind", "red").error, '"mind" is reserved for telepathy.');
    assert.equal(core.setVoice(d, " ", "red").error, "Give the voice a name.");
    assert.equal(core.setVoice(d, "Jim", "blurple").error, "Not a colour: blurple. Use a CSS colour name or #hex.");
});

test("the Voices tab lists voices, the reserved mind and look-alikes", () => {
    const s = emptyState();
    s.voices = { Kael: { colour: "#c0392b", source: "model" }, Mara: { colour: "#b03a2e", source: "model" } };
    const chat = [reply(`Hi.\n\n${core.blockFor(s, { settings, chatData: core.normalizeChatData({}), userName: "Jan" })}`)];
    const html = core.popupHtml("voices", { chat, settings, userName: "Jan",
        chatData: core.normalizeChatData({ storyLedger: { voiceOverrides: { Jim: "orchid" } } }) });
    for (const bit of ['data-voice-colour="Jim"', 'data-voice-delete="Jim"', 'data-voice-delete="Kael"', "reserved for telepathy", "⚠ Kael and Mara look alike (#c0392b / #b03a2e)"]) assert.ok(html.includes(bit), bit);
});

test("the Voices tab says when the section is switched off", () => {
    const off = core.normalizeSettings({ sections: { voices: false } });
    assert.match(core.popupHtml("voices", { chat: [], settings: off, userName: "Jan", chatData: core.normalizeChatData({}) }), /switched off in Settings/);
});

test("✕ deletes a voice however its key is spelled", () => {
    const d = core.normalizeChatData({ storyLedger: { voiceOverrides: { Jim: "orchid" } } });
    assert.deepEqual(core.setVoice(d, "Jim Hawkins", null), { ok: true, chatDataPatch: { voiceOverrides: { "Jim Hawkins": null } } });
    assert.deepEqual(core.setVoice(d, "Jim Hawkins", "red"), { ok: true, chatDataPatch: { voiceOverrides: { "Jim Hawkins": "red" } } });
});

test("the Voices tab shows the mind sample on its starry band", () => {
    const html = core.popupHtml("voices", { chat: [], settings, userName: "Jan", chatData: core.normalizeChatData({}) });
    assert.match(html, /<span class="sl-voice-band"><span class="sl-voice sl-voice-mind"/);
});

test("Settings has the telepathy-with-a-listener switch, band by default", () => {
    assert.equal(core.normalizeSettings({}).mindListener, "band");
    const html = core.popupHtml("settings", { chat: [], settings, userName: "Jan", chatData: core.normalizeChatData({}) });
    assert.match(html, /<select class="text_pole" data-set="mindListener">/);
    assert.match(html, /<option value="ring"[^>]*>Eclipse ring<\/option>/);
});

test("a deleted voice disappears from the list", () => {
    const s = emptyState(); s.voices = { Bob: { colour: "#00ffff", source: "auto" } };
    const chat = [reply(`Hi.\n\n${core.blockFor(s, { settings, chatData: core.normalizeChatData({}), userName: "Jan" })}`)];
    const chatData = core.normalizeChatData({ storyLedger: { voiceOverrides: { Bob: null } } });
    assert.equal(core.voiceList({ chat, settings, chatData, userName: "Jan" }).Bob, undefined);
});

test("saving a voice rewrites the newest block's VOICES rows straight away", () => {
    const chat = [reply(`Hi.\n\n${core.blockFor(withJim(), { settings, chatData: core.normalizeChatData({}), userName: "Jan" })}`)];
    const chatData = core.normalizeChatData({ storyLedger: { voiceOverrides: { Jim: "orchid", Kael: "#c0392b" } } });
    const r = core.voicesIntoNewestBlock({ chat, settings, chatData, userName: "Jan" });
    assert.equal(r.status, "ok");
    assert.match(r.mes, /<b>Jim<\/b> \| orchid \| you/);
    assert.match(r.mes, /<b>Kael<\/b> \| #c0392b \| you/);
});

test("a reply adds the voices tagged in the reader's message before it", () => {
    const chat = [{ mes: '<Bob+jan+mind:whisper>*"Papibaquígrafo".*', is_user: true, is_system: false, name: "Jan", swipe_id: 0 },
        reply('"Ok."\n\n<!-- Story_Ledger\nNow: Day 1\n-->')];
    const out = core.rebuildMessage({ chat, index: 1, settings, chatData: core.normalizeChatData({}), userName: "Jan" });
    assert.match(out.mes, /<b>Bob<\/b> \| \S+ \| auto/);
    assert.match(out.mes, /<b>jan<\/b> \| \S+ \| auto/);
});
