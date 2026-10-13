// The LocalChar server entry (localchar/server.mjs), called the way LocalChar's extension worker
// calls it: data in, data out. Held to the same pre-extraction recording as the core.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import * as server from "../localchar/server.mjs";
import { toStChat, proposalSource } from "../localchar/st-chat.mjs";
import { BLOCK_MARK } from "../src/model/block.js";
import { DICE_LOCKS, COMMENTS, PROSE } from "./support/st-scenarios.mjs";

const golden = JSON.parse(readFileSync(new URL("./fixtures/host-core-goldens.json", import.meta.url), "utf8"));
const clone = value => JSON.parse(JSON.stringify(value));
const NO_COMMENT_WARNING = "No ledger comment in this reply — the turn still advanced. Press ✎ on the block to have it written, or swipe.";

let counter = 0;
const message = (role, content) => ({ id: `msg_${++counter}`, variant_id: `ver_${counter}`, role, name: "", content, is_system: false });
const lock = () => ({ dice: clone(DICE_LOCKS), appliedTo: null });
const notifies = effects => effects.filter(e => e.type === "notify");
const setData = effects => effects.filter(e => e.type === "set_chat_data");
const shape = n => ({ kind: n.kind, title: n.title, message: n.text });

function prepareInput(history, extra = {}) {
    return {
        st_type: "normal", operation: "send", fixup: null, history, user_name: "Jan", char_name: "Mara",
        chat_data: { fudges: lock() }, chat_data_revision: 0, settings: {}, ...extra,
    };
}

/** What LocalChar does around one reply: prepare, then finalize with the patch applied. */
async function playTurn(history, doc, revision, prose) {
    const prepared = await server.prepare(prepareInput(history, { chat_data: doc, chat_data_revision: revision }));
    const patch = prepared.chat_data_patch;
    const chatData = patch ?? doc;   // the host stores the returned document as the new chat data
    const reply = message("assistant", prose);
    const finalized = await server.finalize({
        st_type: "normal", operation: "normal", message_id: reply.id, variant_id: null,
        full_content: prose, generated_part: prose, previous_content: "", pending: prepared.pending,
        history, user_name: "Jan", char_name: "Mara", chat_data: chatData, chat_data_revision: revision, settings: {},
    });
    const written = setData(finalized.effects).at(-1);
    return { prepared, finalized, reply: { ...reply, content: finalized.content }, doc: written ? written.data : chatData };
}

test("the manifest declares the entry points the host loads", () => {
    const manifest = JSON.parse(readFileSync(new URL("../localchar-extension.json", import.meta.url), "utf8"));
    const st = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
    assert.equal(manifest.id, "story_ledger");
    assert.equal(manifest.name, "Story Ledger");
    assert.equal(manifest.version, st.version);
    assert.equal(manifest.host_api, 1);
    assert.equal(manifest.server, "localchar/server.mjs");
    assert.equal(manifest.browser, "localchar/dist/browser.mjs");
    assert.equal(manifest.css, "localchar/dist/style.css");
    assert.ok(existsSync(new URL("../localchar/server.mjs", import.meta.url)));
});

test("toStChat maps LocalChar history to SillyTavern-shaped messages", () => {
    const chat = toStChat([
        { id: "msg_a", variant_id: "v1", role: "user", name: "", content: "Hi.", is_system: false },
        { id: "msg_b", variant_id: "v2", role: "assistant", name: "Mara", content: "Hello.", is_system: false },
        { id: "msg_c", variant_id: "v3", role: "system", name: "", content: "Note.", is_system: true },
    ], { userName: "Jan", charName: "Mara" });
    assert.deepEqual(chat.map(m => [m.mes, m.is_user, m.is_system, m.name, m.swipe_id]), [
        ["Hi.", true, false, "Jan", 0], ["Hello.", false, false, "Mara", 0], ["Note.", false, true, "", 0],
    ]);
    assert.equal(proposalSource({ id: "msg_b", variant_id: "v2" }), "msg_b", "the message id alone survives an edit");
});

test("replaying the recorded turns through prepare and finalize writes the recorded blocks and notices", async () => {
    let history = [], doc = {}, revision = 0;
    for (let turn = 0; turn < 3; turn++) {
        history = [...history, message("user", `Turn ${turn + 1}: what happens next?`)];
        doc = { ...doc, fudges: lock() };
        const out = await playTurn(history, doc, revision, `${PROSE[turn]}\n${COMMENTS[turn]}`);
        const want = golden.sixTurns.injections[turn];
        const [main, reminder] = out.prepared.in_chat;
        assert.equal(main.key, "story_ledger");
        assert.equal(main.value, want.prompt[0], `turn ${turn} injection`);
        assert.deepEqual([main.depth, main.role], [1, 0]);
        assert.deepEqual([reminder.key, reminder.depth, reminder.role], ["story_ledger_reminder", 0, 0]);
        assert.equal(reminder.value, want.reminder[0], `turn ${turn} reminder`);
        assert.equal(out.finalized.content, golden.sixTurns.blocks[turn], `turn ${turn} block`);
        assert.deepEqual(notifies(out.finalized.effects).map(e => shape(e)), golden.sixTurns.toasts[turn].map(t => ({ kind: t.kind, title: t.title, message: t.message })));
        history = [...history, out.reply];
        doc = out.doc;
        revision += 1;
    }
    const [proposal] = doc.notebook.inbox;
    assert.match(proposal.source, /^msg_/, "a proposal is keyed by the message id, not ST's m<i>s<swipe>");
    const withoutSource = notebook => ({ ...notebook, inbox: notebook.inbox.map(({ source, ...rest }) => rest) });
    assert.deepEqual(withoutSource(doc.notebook), withoutSource(golden.sixTurns.chatData.notebook), "the rule proposal reached the notebook inbox");
});

test("prepare returns the strip transform flag, the pending turn and a chat-data patch for the fudge lifecycle", async () => {
    const out = await server.prepare(prepareInput([message("user", "Hello.")]));
    assert.equal(out.transform, true);
    assert.deepEqual(out.macros, {});
    assert.equal(out.pending.turn.index, 1);
    assert.equal(out.chat_data_patch.fudges.appliedTo, 1, "the armed fudge is marked as applied to this reply");
});

test("a prepare with nothing to change patches nothing", async () => {
    const out = await server.prepare(prepareInput([message("user", "Hello.")], { chat_data: {} }));
    assert.equal(out.chat_data_patch, null);
});

test("macro placement puts nothing in_chat and the text under {{story_ledger}}", async () => {
    const history = golden.sixTurns.blocks.flatMap((block, i) => [
        message("user", `Turn ${i + 1}: what happens next?`), message("assistant", block)]);
    const out = await server.prepare(prepareInput(history, {
        settings: { placement: "macro" }, chat_data: { ...clone(golden.sixTurns.chatData), fudges: lock() },
    }));
    assert.deepEqual(out.in_chat, []);
    assert.equal(out.macros.story_ledger, golden.macro.macro);
});

test("the injection is skipped for turns the ledger ignores and when it is switched off", async () => {
    // index.js strips old blocks at CHAT_COMPLETION_PROMPT_READY for every generation while the ledger
    // is on, impersonate included; only the injection, dice and fudges are skipped.
    for (const st_type of ["impersonate", "quiet"]) {
        const out = await server.prepare(prepareInput([message("user", "Hi.")], { st_type }));
        assert.deepEqual(out.in_chat, [], st_type);
        assert.deepEqual(out.macros, {}, st_type);
        assert.equal(out.transform, true, st_type);
        assert.equal(out.pending, null, st_type);
        assert.equal(out.chat_data_patch, null, st_type);
    }
    const offImpersonate = await server.prepare(prepareInput([message("user", "Hi.")], { st_type: "impersonate", settings: { enabled: false } }));
    assert.equal(offImpersonate.transform, false);
    const off = await server.prepare(prepareInput([message("user", "Hi.")], { settings: { enabled: false } }));
    assert.deepEqual([off.in_chat, off.transform], [[], false]);
});

test("transformMessages strips old blocks and comments from the final message list, and the text-completion prompt", async () => {
    const block = golden.sixTurns.blocks[0];
    const out = await server.transformMessages({
        messages: [{ role: "assistant", content: block }, { role: "user", content: "next" }, { role: "assistant", content: golden.sixTurns.blocks[1] }],
    });
    assert.ok(out.messages.every(m => !m.content.includes(BLOCK_MARK)));
    assert.ok(!out.messages[0].content.includes("Story_Ledger"), "an older comment goes too");
    assert.match(out.messages[2].content, /Story_Ledger/, "the newest comment stays");
    const text = await server.transformMessages({ prompt: `user: hi\nassistant: ${block}` });
    assert.ok(!text.prompt.includes(BLOCK_MARK));
});

test("a fix-up continue is prepared with the ledger-only reminder and without touching dice or fudges", async () => {
    const history = [message("user", "Hi."), message("assistant", PROSE[0])];
    const out = await server.prepare(prepareInput(history, {
        st_type: "continue", operation: "continue", fixup: { kase: "missing", mode: "full" }, chat_data: { fudges: { dice: { world: 20 }, appliedTo: 1 } },
    }));
    assert.match(out.in_chat[1].value, /The reply above is finished\. Do not continue the story/);
    assert.equal(out.chat_data_patch, null);
});

test("finalize on a continue of a reply cut mid-comment yields one block", async () => {
    const user = message("user", "Go on.");
    const previous = "She poured the tea.\n<!-- Story_Ledger\nNow: Day 1 — Monday, 09:00 | the kitchen\nPres";
    const generated = "ent: Mara\nThoughts:\n- Mara: hello.\n-->";
    const out = await server.finalize({
        st_type: "continue", operation: "continue", message_id: "msg_cut", variant_id: "ver_cut",
        full_content: previous + generated, generated_part: generated, previous_content: previous, pending: null,
        history: [user], user_name: "Jan", char_name: "Mara", chat_data: {}, chat_data_revision: 0, settings: {},
    });
    assert.equal(out.content.split(BLOCK_MARK).length - 1, 1);
    assert.match(out.content, /Mara<\/b> \| hello/);
    assert.deepEqual(notifies(out.effects), []);
});

test("finalize on a pre-ledger reply writes one block from the initial state", async () => {
    const history = [message("user", "Hello."), message("assistant", "An old reply from before the ledger existed."), message("user", "And now?")];
    const previous = "A reply from before the ledger existed.";
    const generated = "\n<!-- Story_Ledger\nNow: Day 3\nPresent: Mara\n-->";
    const out = await server.finalize({
        st_type: "continue", operation: "continue", message_id: "msg_old", variant_id: "ver_old",
        full_content: previous + generated, generated_part: generated, previous_content: previous, pending: null,
        history: history.slice(0, 1), user_name: "Jan", char_name: "Mara", chat_data: {}, chat_data_revision: 0, settings: {},
    });
    assert.equal(out.content.split(BLOCK_MARK).length - 1, 1);
    assert.ok(out.content.startsWith(previous));
});

test("a missing comment gives the exact index.js warning, sticky, and still writes a block", async () => {
    const out = await server.finalize({
        st_type: "normal", operation: "send", message_id: "msg_x", variant_id: null,
        full_content: "Only prose.", generated_part: "Only prose.", previous_content: "", pending: null,
        history: [message("user", "Hi.")], user_name: "Jan", char_name: "Mara", chat_data: {}, chat_data_revision: 0, settings: {},
    });
    const [note] = notifies(out.effects);
    assert.deepEqual([note.kind, note.text, note.sticky], ["warning", NO_COMMENT_WARNING, true]);
    assert.match(out.content, /story-ledger-state v1/);
});

test("notices are not sticky when the setting says so", async () => {
    const out = await server.finalize({
        st_type: "normal", operation: "send", message_id: "msg_x", variant_id: null,
        full_content: "Only prose.", generated_part: "Only prose.", previous_content: "", pending: null,
        history: [message("user", "Hi.")], user_name: "Jan", char_name: "Mara", chat_data: {}, chat_data_revision: 0,
        settings: { stickyNotices: false },
    });
    assert.equal(notifies(out.effects)[0].sticky, false);
});

// ── actions ─────────────────────────────────────────────────────────────────

async function snapshotOf(blocks = golden.sixTurns.blocks, chatData = golden.sixTurns.chatData) {
    let history = [];
    blocks.forEach((block, i) => { history = [...history, message("user", `Turn ${i + 1}: what happens next?`), message("assistant", block)]; });
    return { history, chat_data: clone(chatData), chat_data_revision: 4, settings: {}, user_name: "Jan", char_name: "Mara" };
}
const act = async (name, args, snapshot) => server.actions[name]({ name, args, snapshot });
const dataOf = out => setData(out.effects).at(-1)?.data;

test("relationships_prune saves the choice atomically and restoration reaches the next prompt", async () => {
    assert.equal(typeof server.actions.relationships_prune, "function");
    const snap = await snapshotOf();
    const pruned = await act("relationships_prune", { key: "Mara→Jan", pruned: true }, snap);
    assert.equal(pruned.result.ok, true);
    const data = dataOf(pruned);
    assert.equal(data.relationshipOverrides["Mara→Jan"].pruned, true);
    assert.equal(setData(pruned.effects)[0].expected_revision, snap.chat_data_revision);
    const prepared = await server.prepare(prepareInput(snap.history, { chat_data: data }));
    assert.doesNotMatch(prepared.in_chat[0].value, /Mara → Jan · Φ/);
    const restored = await act("relationships_prune", { key: "Mara→Jan", pruned: false }, { ...snap, chat_data: data });
    assert.equal(dataOf(restored).relationshipOverrides["Mara→Jan"].pruned, false);
    const next = await server.prepare(prepareInput(snap.history, { chat_data: dataOf(restored) }));
    assert.match(next.in_chat[0].value, /Mara → Jan · Φ/);
});

test("rebuild persists the block index that consumed a relationship restoration", async () => {
    const snap = await snapshotOf();
    const pruned = await act("relationships_prune", { key: "Mara→Jan", pruned: true }, snap);
    const restored = await act("relationships_prune", { key: "Mara→Jan", pruned: false }, { ...snap, chat_data: dataOf(pruned) });
    const out = await act("rebuild", { message_id: snap.history.at(-1).id }, { ...snap, chat_data: dataOf(restored) });
    assert.equal(dataOf(out)?.relationshipOverrides["Mara→Jan"].savedAt, snap.history.length - 1);
});

test("chat import maps relationship restoration positions and a fork reseeds a dropped restored block", async () => {
    const source = { relationshipOverrides: {
        "Mara→Jan": { from: "Mara", to: "Jan", pruned: false, atLength: 4, savedAt: 3, restoreSwipeId: 2 },
        "Boatman→Jan": { from: "Boatman", to: "Jan", pruned: true },
    } };
    const imported = await server.importStChat({ chat_metadata: { storyLedger: source }, boundary_map: { 4: 2 }, message_map: { 3: { index: 1 } } });
    assert.equal(imported.data.relationshipOverrides["Mara→Jan"].atLength, 2);
    assert.equal(imported.data.relationshipOverrides["Mara→Jan"].savedAt, 1);
    assert.equal(imported.data.relationshipOverrides["Mara→Jan"].restoreSwipeId, 0);
    const forked = await server.onFork({ data: source, fork_boundary: 1, kept_message_ids: [] });
    assert.equal(forked.data.relationshipOverrides["Mara→Jan"].atLength, 2);
    assert.equal(forked.data.relationshipOverrides["Mara→Jan"].savedAt, undefined);
    assert.equal(forked.data.relationshipOverrides["Boatman→Jan"].pruned, true);
});

test("every popup handler and flow has an action", () => {
    for (const name of ["rebuild", "save_rules", "decide_proposal", "import_legacy_notebook", "save_threads", "set_clock", "clear_clock",
        "save_fudges", "clear_fudges", "quests_send", "save_config", "reset_config", "set_notebook_enabled", "preview_turn",
        "popup_view", "lean_prompt", "accept_fixup"]) assert.equal(typeof server.actions[name], "function", name);
});

test("rebuild recomputes the block of one message with an edit effect guarded by its version", async () => {
    const snap = await snapshotOf();
    const target = snap.history.at(-1);
    const out = await act("rebuild", { message_id: target.id }, snap);
    const [edit] = out.effects.filter(e => e.type === "edit_message");
    assert.deepEqual([edit.id, edit.variant_id], [target.id, target.variant_id]);
    assert.equal(edit.content.split(BLOCK_MARK).length - 1, 1);
});

test("rules: save, approve and reject a proposal, toggle the notebook", async () => {
    const snap = await snapshotOf();
    assert.deepEqual(dataOf(await act("save_rules", { rules: ["Be kind.", "Be brief."] }, snap)).notebook.rules, ["Be kind.", "Be brief."]);
    const item = snap.chat_data.notebook.inbox[0];
    const approved = dataOf(await act("decide_proposal", { id: item.id, decision: "approve" }, snap));
    assert.ok(approved.notebook.rules.includes("Keep chapters short."));
    assert.equal(approved.notebook.inbox.length, 0);
    const rejected = dataOf(await act("decide_proposal", { id: item.id, decision: "reject" }, snap));
    assert.equal(rejected.notebook.inbox.length, 0);
    assert.equal(dataOf(await act("set_notebook_enabled", { enabled: false }, snap)).notebook.enabled, false);
    const effect = setData((await act("save_rules", { rules: [] }, snap)).effects)[0];
    assert.equal(effect.expected_revision, 4, "writes carry the revision the snapshot was read at");
});

test("clock correction and starting threads", async () => {
    const snap = await snapshotOf();
    const set = dataOf(await act("set_clock", { text: "Day 12 — Tuesday, 21:44 | the lawn" }, snap));
    assert.deepEqual(set.notebook.clockOverride, { text: "Day 12 — Tuesday, 21:44 | the lawn", atLength: snap.history.length });
    const cleared = dataOf(await act("clear_clock", {}, { ...snap, chat_data: set }));
    assert.equal(cleared.notebook.clockOverride, undefined);
    assert.deepEqual(dataOf(await act("save_threads", { threads: ["A.", "B."] }, snap)).notebook.threads, ["A.", "B."]);
});

test("fudges: save for the next turn and clear", async () => {
    const snap = await snapshotOf();
    const saved = dataOf(await act("save_fudges", { fudge: { dice: { world: 7 }, calm: true } }, snap));
    assert.deepEqual(saved.fudges, { dice: { world: 7 }, calm: true, appliedTo: null });
    assert.equal(dataOf(await act("save_fudges", { fudge: { appliedTo: null } }, snap)).fudges, null, "no settings means no fudge");
    assert.equal(dataOf(await act("clear_fudges", {}, snap)).fudges, null);
});

test("preview_turn returns the turn facts for the chosen dice and fudges", async () => {
    const snap = await snapshotOf();
    const out = await act("preview_turn", { fudge: { dice: { world: 3 } }, base_dice: { fate: { a: 1, b: 2, c: 3 }, world: 9, checks: [4, 5, 6] } }, snap);
    assert.equal(typeof out.result.text, "string");
    assert.deepEqual(out.effects, []);
});

test("quests_send edits the newest block's quest rows, or says why it cannot", async () => {
    const snap = await snapshotOf();
    const out = await act("quests_send", { ids: "all", on: true }, snap);
    assert.ok(["ok", "nosection", "noblock", "unreadable"].includes(out.result.status));
    const none = await act("quests_send", { ids: "all", on: true }, { ...snap, history: snap.history.slice(0, 1) });
    assert.equal(none.result.status, "noblock");
    assert.equal(none.effects.filter(e => e.type === "notify")[0].kind, "warning");
});

test("engine numbers: save sanitizes, reset returns the defaults", async () => {
    const snap = await snapshotOf();
    const out = await act("save_config", { form: { cfg: { tickCap: "5" }, chekhov: { firing: "fate", cap: "3" }, fate: { worldKeep: "4" } } }, snap);
    assert.equal(out.result.config.tickCap, 5);
    assert.equal(out.result.config.sectionConfig.chekhov.firing, "fate");
    assert.equal((await act("reset_config", {}, snap)).result.config && Object.keys((await act("reset_config", {}, snap)).result.config).length, 0);
});

test("popup_view hands the browser one consistent snapshot", async () => {
    const snap = await snapshotOf();
    const { result } = await act("popup_view", {}, snap);
    assert.deepEqual(Object.keys(result).sort(), ["chat_data", "chat_data_revision", "history", "settings", "user_name"]);
    assert.equal(result.settings.theme, "frankenstein");
});

test("import_legacy_notebook reads the previous preset's rules and threads without saving them", async () => {
    const snap = await snapshotOf();
    const out = await act("import_legacy_notebook", {}, snap);
    assert.deepEqual(Object.keys(out.result).sort(), ["rules", "threads"]);
});

test("lean_prompt builds the writer prompt from the snapshot", async () => {
    const snap = await snapshotOf();
    snap.history.push(message("assistant", "A reply with no comment."));
    const target = snap.history.at(-1);
    const out = await act("lean_prompt", { message_id: target.id, fixup: { kase: "missing", mode: "lean" } }, snap);
    assert.equal(out.result.messages[0].role, "system");
    assert.equal(out.result.messages.at(-1).role, "user");
    assert.ok(out.result.messages.some(m => m.content.includes("A reply with no comment.")));
});

test("accept_fixup splices a usable comment (lean) and rebuilds the block", async () => {
    const snap = { history: [message("user", "Hi."), message("assistant", PROSE[0])], chat_data: { fudges: null }, chat_data_revision: 2, settings: {}, user_name: "Jan", char_name: "Mara" };
    const target = snap.history[1];
    const out = await act("accept_fixup", {
        message_id: target.id, snapshot_content: target.content, generated_part: COMMENTS[0], fixup: { kase: "missing", mode: "lean" },
    }, snap);
    assert.equal(out.result.accepted, true);
    const [edit] = out.effects.filter(e => e.type === "edit_message");
    assert.deepEqual([edit.id, edit.variant_id], [target.id, target.variant_id]);
    assert.equal(edit.content.split(BLOCK_MARK).length - 1, 1);
    assert.ok(edit.content.startsWith(PROSE[0]));
});

test("accept_fixup (full): the continuation is read off the reply it was appended to", async () => {
    const reply = message("assistant", PROSE[0]);
    const snap = { history: [message("user", "Hi."), { ...reply, content: PROSE[0] }], chat_data: {}, chat_data_revision: 0, settings: {}, user_name: "Jan", char_name: "Mara" };
    const out = await act("accept_fixup", {
        message_id: reply.id, snapshot_content: PROSE[0], generated_part: `\n${COMMENTS[0]}`, fixup: { kase: "missing", mode: "full" },
    }, snap);
    assert.equal(out.result.accepted, true);
    assert.equal(out.effects.filter(e => e.type === "edit_message")[0].content.split(BLOCK_MARK).length - 1, 1);
});

test("accept_fixup keeps nothing when the output is unusable, and says so", async () => {
    const snap = { history: [message("user", "Hi."), message("assistant", PROSE[0])], chat_data: {}, chat_data_revision: 0, settings: {}, user_name: "Jan", char_name: "Mara" };
    const target = snap.history[1];
    const out = await act("accept_fixup", {
        message_id: target.id, snapshot_content: target.content, generated_part: "I cannot do that.", fixup: { kase: "missing", mode: "lean" },
    }, snap);
    assert.equal(out.result.accepted, false);
    assert.deepEqual(out.effects.filter(e => e.type !== "notify"), []);
    const [note] = notifies(out.effects);
    assert.match(note.text, /^Ledger fix-up kept nothing: /);
});

// ── imports and forks ───────────────────────────────────────────────────────

const identity = (n, extra = {}) => Object.fromEntries(Array.from({ length: n }, (_, i) => [i, { index: i, message_id: `msg_${i}`, variant_id: null }])
    .map(([k, v]) => [k, extra[k] ?? v]));
const boundaries = n => Object.fromEntries(Array.from({ length: n + 1 }, (_, i) => [i, i]));

test("importStChat: atLength at the end boundary maps through the boundary map", async () => {
    const meta = { storyLedger: { notebook: { rules: ["R."], clockOverride: { text: "Day 9", atLength: 4 } }, corrections: [{ atLength: 2, ct: 3 }], fudges: null } };
    const shifted = { ...boundaries(4), 4: 5 };   // ST had 4 messages; LocalChar has 5 after the append
    const out = await server.importStChat({ chat_metadata: meta, message_map: identity(4), boundary_map: shifted });
    assert.deepEqual(out.claimed, ["storyLedger"]);
    assert.equal(out.data.notebook.clockOverride.atLength, 5);
    assert.equal(out.data.corrections[0].atLength, 2);
    assert.deepEqual(out.data.notebook.rules, ["R."]);
});

test("importStChat: message indices, imported marker and proposal sources go through the message map", async () => {
    const meta = { storyLedger: {
        notebook: { inbox: [{ id: "p1", op: "add", text: "T", targetText: "", source: "m3s0", signature: "s" }] },
        fudges: { dice: { world: 5 }, appliedTo: 3 }, imported: { source: "ff", index: 1 },
    } };
    const map = identity(4, { 3: { index: 7, message_id: "msg_new", variant_id: null } });
    const out = await server.importStChat({ chat_metadata: meta, message_map: map, boundary_map: boundaries(4) });
    assert.equal(out.data.fudges.appliedTo, 7);
    assert.equal(out.data.imported.index, 1);
    assert.equal(out.data.notebook.inbox[0].source, "msg_new");
});

test("importStChat: a target that was skipped refuses the import", async () => {
    const meta = { storyLedger: { fudges: { dice: {}, appliedTo: 2 }, notebook: {} } };
    await assert.rejects(server.importStChat({ chat_metadata: meta, message_map: identity(4, { 2: "skipped" }), boundary_map: boundaries(4) }), /skipped|no counterpart/i);
    const outOfRange = { storyLedger: { notebook: { clockOverride: { text: "x", atLength: 99 } } } };
    await assert.rejects(server.importStChat({ chat_metadata: outOfRange, message_map: identity(4), boundary_map: boundaries(4) }), /boundary|range/i);
});

test("importStChat: a chat without Story Ledger data has nothing to import", async () => {
    const out = await server.importStChat({ chat_metadata: { main_chat: "x" }, message_map: {}, boundary_map: { 0: 0 } });
    assert.deepEqual(out, { data: null, claimed: [] });
});

test("importStSettings normalizes extension_settings.storyLedger", async () => {
    const out = await server.importStSettings({ extension_settings: { storyLedger: { theme: "sola", clock: false } } });
    assert.equal(out.settings.theme, "sola");
    assert.equal(out.settings.sections.scene, false, "the 0.1 migration applies");
    assert.deepEqual((await server.importStSettings({ extension_settings: {} })).settings, {});
});

test("onFork drops a clock override and corrections past the fork, fudges and proposals from dropped messages", async () => {
    const data = {
        notebook: {
            rules: ["Keep."], clockOverride: { text: "Day 9", atLength: 8 },
            inbox: [
                { id: "p1", op: "add", text: "A", source: "msg_keep", signature: "a" },
                { id: "p2", op: "add", text: "B", source: "msg_gone", signature: "b" },
            ],
        },
        corrections: [{ atLength: 2, ct: 1 }, { atLength: 6, ct: 2 }],
        fudges: { dice: { world: 4 }, appliedTo: 6 },
        imported: { source: "ff", index: 1 },
    };
    const out = await server.onFork({ data, fork_boundary: 4, kept_message_ids: ["msg_a", "msg_b", "msg_keep"] });
    assert.equal(out.data.notebook.clockOverride, undefined);
    assert.deepEqual(out.data.corrections, [{ atLength: 2, ct: 1 }]);
    assert.equal(out.data.fudges, null);
    assert.deepEqual(out.data.notebook.inbox.map(i => i.id), ["p1"]);
    assert.deepEqual(out.data.notebook.rules, ["Keep."]);
    assert.deepEqual(out.data.imported, { source: "ff", index: 1 });
    const early = await server.onFork({ data: { ...data, fudges: { dice: {}, appliedTo: 2 }, notebook: { ...data.notebook, clockOverride: { text: "t", atLength: 3 } } }, fork_boundary: 4, kept_message_ids: [] });
    assert.deepEqual(early.data.fudges, { dice: {}, appliedTo: 2 });
    assert.equal(early.data.notebook.clockOverride.atLength, 3);
});

test("finalize leaves the reply untouched when Story Ledger is switched off (index.js onMessageReceived returns early)", async () => {
    const history = [message("user", "Hi.")];
    const prose = "She smiled.\n<!-- Story_Ledger\nNow: Day 1 — Monday, 09:00 | the kitchen\nPresent: Mara\n-->";
    for (const extra of [{ settings: { enabled: false } }, { st_type: "impersonate" }]) {
        const out = await server.finalize({
            st_type: "normal", operation: "send", message_id: "msg_off", variant_id: null,
            full_content: prose, generated_part: prose, previous_content: "", pending: null,
            history, user_name: "Jan", char_name: "Mara", chat_data: {}, chat_data_revision: 0, settings: {}, ...extra,
        });
        assert.equal(out.content, prose, JSON.stringify(extra));
        assert.deepEqual(out.effects, [], JSON.stringify(extra));
    }
});

test("onFork for a swipe (the fork at the reply's own index) keeps armed fudges and a correction made after that reply", async () => {
    // LocalChar makes every swipe a fork with fork_boundary = the reply's index. ST keeps fudges for a
    // swipe of the reply they were applied to (dice.js: index === appliedTo) and applies a clock
    // correction to it (withClockOverride: atLength > blockIndex).
    const data = {
        notebook: { rules: [], clockOverride: { text: "Day 2, 08:00", atLength: 5 }, inbox: [] },
        corrections: [{ atLength: 5, ct: 1 }, { atLength: 7, ct: 2 }],
        fudges: { dice: { world: 4 }, appliedTo: 4 },
    };
    const out = await server.onFork({ data, fork_boundary: 4, kept_message_ids: [] });
    assert.deepEqual(out.data.fudges, { dice: { world: 4 }, appliedTo: 4 });
    assert.equal(out.data.notebook.clockOverride.atLength, 5);
    assert.deepEqual(out.data.corrections, [{ atLength: 5, ct: 1 }]);
});

test("the server entry imports no host and no DOM", () => {
    for (const file of ["server.mjs", "st-chat.mjs"]) {
        const code = readFileSync(new URL(`../localchar/${file}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
        for (const forbidden of [/SillyTavern/, /\bdocument\b/, /\bwindow\b/, /toastr/, /\bjQuery\b/]) assert.doesNotMatch(code, forbidden, `${file} ${forbidden}`);
    }
});
