// ──────────────────────────────────────────────────────────────────────────────
// Story Ledger on LocalChar: the server entry. LocalChar's extension worker imports this file
// and calls the exports below with plain data; the host applies every effect they return.
//
// It is the LocalChar twin of index.js and calls the same shared core (src/host/core.js), so a
// block written here means what the same block means in SillyTavern. Names deliberately follow
// index.js: prepare = the interceptor + buildInjection, finalize = onMessageReceived +
// rebuildMessage, actions = the popup's handlers and the fix-up flow.
//
// Exports (host_api 1): prepare, transformMessages, finalize, actions, importStChat,
// importStSettings, onFork.
// ──────────────────────────────────────────────────────────────────────────────

import * as core from "../src/host/core.js";
import { toStChat, proposalSource } from "./st-chat.mjs";
import { configFromForm } from "./panel-logic.mjs";
import { applyDecision, importFromLegacyNotebook } from "../src/model/notebook.js";
import { setSend } from "../src/model/sections/quests.js";
import { rewriteNewestSection } from "../src/model/turn.js";
import { stripForPrompt, stripPromptText, renderTurnFacts } from "../src/model/prompt.js";
import { buildLeanPrompt } from "../src/model/lean-prompt.js";
import { withFudges } from "../src/model/dice.js";

const clone = value => JSON.parse(JSON.stringify(value ?? null));
const PROMPT_KEY = "story_ledger";
const REMINDER_KEY = "story_ledger_reminder";
const TITLE = "📒 Story Ledger";

// ── Shared plumbing ─────────────────────────────────────────────────────────

/** The host passes the raw chat-data document; the core wants it inside a metadata-shaped object. */
const docOf = chatData => core.normalizeChatData({ storyLedger: clone(chatData) || {} });

/** What every hook needs, from the payload (prepare/finalize) or the action snapshot. */
function context(source) {
    const userName = source.user_name || "";
    const charName = source.char_name || "";
    const settings = core.normalizeSettings(source.settings);
    return {
        settings, userName, charName,
        history: source.history || [],
        chat: toStChat(source.history, { userName, charName }),
        doc: docOf(source.chat_data),
        revision: source.chat_data_revision ?? 0,
        // The host's compiler runs the full macro engine over in-chat prompts; macro VALUES it only
        // inserts, so the two the ledger text uses are resolved here for both.
        substitute: text => String(text).replace(/\{\{user\}\}/gi, userName).replace(/\{\{char\}\}/gi, charName),
    };
}

const notifyEffect = (notice, settings) => ({
    type: "notify", kind: notice.kind, title: notice.title, text: notice.text, sticky: settings.stickyNotices !== false,
});
const quietNotice = (kind, title, text) => ({ type: "notify", kind, title, text, sticky: false });
const writeData = (doc, revision) => ({ type: "set_chat_data", expected_revision: revision, data: doc });
const editReply = (history, index, content) => ({
    type: "edit_message", id: history[index].id, variant_id: history[index].variant_id ?? null, content,
});
const indexOfMessage = (history, id) => history.findIndex(m => m.id === id);

// ── prepare: the interceptor ────────────────────────────────────────────────

const NOTHING = { in_chat: [], macros: {}, transform: false, pending: null, chat_data_patch: null };

export async function prepare(payload) {
    const ctx = context(payload);
    const { settings, chat, doc } = ctx;
    const type = payload.st_type || "normal";
    if (!settings.enabled) return { ...NOTHING };
    // index.js strips old blocks at CHAT_COMPLETION_PROMPT_READY on every generation while the ledger
    // is on (impersonate included); only the injection, dice and fudges belong to ledger turns.
    if (core.SKIP_TYPES.has(type)) return { ...NOTHING, transform: true };

    const fixup = payload.fixup || null;
    let turn = null;
    let givenConfig = null;
    let patched = false;
    if (fixup) {
        // The fix-up's own continue: the reply's dice and fudges stay as they were, and the
        // reminder asks for the ledger comment alone.
        givenConfig = core.fixupConfig({ chat, index: chat.length - 1, settings, chatData: doc, userName: ctx.userName });
    } else {
        turn = core.prepareTurn({ chat, type, settings, chatData: doc, pendingSame: null });
        if (turn.fudgesChanged) { doc.fudges = turn.fudgesNext; patched = true; }
    }

    const out = core.buildInjection({
        chat, type: fixup ? "continue" : type, settings, chatData: doc, userName: ctx.userName,
        pending: turn ? turn.pending : null, kase: fixup ? fixup.kase : null, givenConfig,
    });
    if (out.chatDataPatch) { Object.assign(doc, out.chatDataPatch); patched = true; }

    const text = ctx.substitute(out.text);
    const reminder = ctx.substitute(out.reminder);
    const inChat = settings.placement === "macro" ? [] : [
        { key: PROMPT_KEY, value: text, depth: Number(settings.depth) || 0, role: Number(settings.role) || 0 },
        { key: REMINDER_KEY, value: reminder, depth: 0, role: 0 },
    ];
    return {
        in_chat: inChat.filter(entry => entry.value),
        macros: settings.placement === "macro" && text ? { [PROMPT_KEY]: text } : {},
        transform: true,
        pending: { turn: turn ? turn.pending : null, fixup, notices: out.notices },
        chat_data_patch: patched ? clone(doc) : null,
    };
}

// ── transformMessages: CHAT_COMPLETION_PROMPT_READY / GENERATE_AFTER_COMBINE_PROMPTS ─────────

export async function transformMessages(payload) {
    if (typeof payload.prompt === "string") return { prompt: stripPromptText(payload.prompt) };
    return { messages: stripForPrompt(clone(payload.messages)) };
}

// ── finalize: MESSAGE_RECEIVED ──────────────────────────────────────────────

export async function finalize(payload) {
    const ctx = context(payload);
    const { settings, doc } = ctx;
    // index.js onMessageReceived: nothing is written while the ledger is off, or for a skipped type.
    if (!settings.enabled || core.SKIP_TYPES.has(payload.st_type || "normal")) return { content: payload.full_content, effects: [] };
    const chat = [...ctx.chat, { mes: payload.full_content, is_user: false, is_system: false, name: ctx.charName, swipe_id: 0 }];
    const index = chat.length - 1;
    const turn = payload.pending && payload.pending.turn && payload.pending.turn.index === index ? payload.pending.turn : null;
    const out = core.rebuildMessage({
        chat, index, settings, chatData: doc, userName: ctx.userName, pending: turn, collect: true,
        proposalSource: proposalSource({ id: payload.message_id, variant_id: payload.variant_id }),
    });
    const notices = [...((payload.pending && payload.pending.notices) || []), ...out.notices];
    const effects = notices.map(n => notifyEffect(n, settings));
    if (out.chatDataPatch) effects.push(writeData({ ...doc, ...out.chatDataPatch }, ctx.revision));
    return { content: out.mes, effects };
}

// ── actions: the popup's handlers and the fix-up flow ───────────────────────

const answer = (result = null, effects = []) => ({ result, effects });
const withData = (snapshot, ctx, mutate) => {
    const doc = clone(ctx.doc);
    mutate(doc);
    return writeData(doc, snapshot.chat_data_revision ?? 0);
};

/** The args every action carries are plain data; the snapshot is what the host read. */
function act(handler) {
    return async ({ args = {}, snapshot }) => handler(args || {}, snapshot, context(snapshot));
}

const rebuild = act(async (args, snapshot, ctx) => {
    const index = indexOfMessage(ctx.history, args.message_id);
    if (index < 0) return answer({ ok: false }, [quietNotice("warning", TITLE, "That reply is no longer in the chat.")]);
    // ↻ keeps the dice its block already shows; rule proposals are not collected again.
    const out = core.rebuildMessage({ chat: ctx.chat, index, settings: ctx.settings, chatData: ctx.doc, userName: ctx.userName, collect: false });
    if (!out) return answer({ ok: false });
    return answer({ ok: true }, [editReply(ctx.history, index, out.mes), ...(out.chatDataPatch ? [writeData({ ...ctx.doc, ...out.chatDataPatch }, snapshot.chat_data_revision ?? 0)] : []), ...out.notices.map(n => notifyEffect(n, ctx.settings))]);
});

const saveRules = act(async (args, snapshot, ctx) => {
    const rules = (args.rules || []).map(String);
    return answer({ rules }, [withData(snapshot, ctx, d => { d.notebook.rules = rules; })]);
});

const decideProposal = act(async (args, snapshot, ctx) => {
    const decision = args.decision === "approve" ? "approve" : "reject";
    return answer(null, [withData(snapshot, ctx, d => {
        const item = d.notebook.inbox.find(i => i.id === args.id);
        d.notebook = item && item.stale && decision === "reject"
            ? { ...d.notebook, inbox: d.notebook.inbox.filter(i => i.id !== args.id) }
            : applyDecision(d.notebook, args.id, decision);
    })]);
});

const importLegacyNotebook = act(async (args, snapshot, ctx) => {
    const got = importFromLegacyNotebook(ctx.chat);
    if (!got.rules.length && !got.threads.length) {
        return answer(got, [quietNotice("warning", TITLE, "No previous notebook found in this chat.")]);
    }
    const effects = [quietNotice("info", TITLE, `Imported ${got.rules.length} rule(s), ${got.threads.length} thread(s). Review the rules, edit any that name the old preset's mechanics, then Save.`)];
    if (got.threads.length && !ctx.doc.notebook.threads.length) {
        effects.unshift(withData(snapshot, ctx, d => { d.notebook.threads = got.threads; }));
    }
    return answer(got, effects);
});

const saveThreads = act(async (args, snapshot, ctx) => {
    const threads = (args.threads || []).map(String);
    return answer({ threads }, [withData(snapshot, ctx, d => { d.notebook.threads = threads; })]);
});

const setClock = act(async (args, snapshot, ctx) => {
    const text = String(args.text || "").trim();
    if (!text) return answer({ ok: false });
    return answer({ ok: true }, [withData(snapshot, ctx, d => { d.notebook.clockOverride = { text, atLength: ctx.chat.length }; })]);
});

const clearClock = act(async (args, snapshot, ctx) =>
    answer(null, [withData(snapshot, ctx, d => { delete d.notebook.clockOverride; })]));

const saveFudges = act(async (args, snapshot, ctx) => {
    const fudge = args.fudge && core.hasFudgeSettings(args.fudge) ? { ...args.fudge, appliedTo: null } : null;
    return answer({ armed: fudge ? core.fudgeSummary(fudge) : "none" }, [withData(snapshot, ctx, d => { d.fudges = fudge; })]);
});

const clearFudges = act(async (args, snapshot, ctx) => answer(null, [withData(snapshot, ctx, d => { d.fudges = null; })]));

const setNotebookEnabled = act(async (args, snapshot, ctx) =>
    answer(null, [withData(snapshot, ctx, d => { d.notebook.enabled = Boolean(args.enabled); })]));

const previewTurn = act(async (args, snapshot, ctx) => {
    const config = core.engineConfig(ctx.settings, ctx.userName);
    const state = core.stateBefore(ctx.chat, ctx.chat.length, config, ctx.doc);
    const fudge = args.fudge || {};
    const applied = withFudges(args.base_dice, fudge);
    const text = renderTurnFacts(state, core.engineConfig(ctx.settings, ctx.userName, {
        dice: applied.dice, fudges: fudge, fudgedDice: applied.fudged, rolls: applied.dice.checks,
    }));
    return answer({ text: text || "" });
});

const questsSend = act(async (args, snapshot, ctx) => {
    const r = rewriteNewestSection(ctx.chat, ctx.chat.length, core.engineConfig(ctx.settings, ctx.userName), "quests",
        st => setSend(st, args.ids === "all" ? "all" : (args.ids || []).map(String), Boolean(args.on)));
    const result = { status: r.status };
    if (r.status === "ok") return answer(result, [editReply(ctx.history, r.index, r.mes)]);
    const why = {
        unreadable: `The newest block has row(s) that no longer read — fix them first, so they are not overwritten: ${(r.errors || []).map(e => `${e.section}: ${e.row}`).join("; ")}`,
        nosection: "The newest block has no 📜 QUESTS section (is the Quests section switched off?).",
        noblock: "No reply carries a Story Ledger block yet.",
    }[r.status];
    return answer(result, [quietNotice("warning", "🗺️ Story Ledger", why)]);
});

const relationshipsPrune = act(async (args, snapshot, ctx) => {
    const out = core.setRelationshipPruned({ chat: ctx.chat, settings: ctx.settings, chatData: ctx.doc, userName: ctx.userName }, String(args.key || ""), Boolean(args.pruned));
    if (!out.ok) return answer({ ok: false }, [quietNotice("warning", "💞 Story Ledger", "That relationship is no longer available. Reopen the Relationships tab.")]);
    return answer({ ok: true }, [writeData({ ...ctx.doc, ...out.chatDataPatch }, snapshot.chat_data_revision ?? 0)]);
});

/** The engine-number form -> a sanitized settings.config. The host stores it as a global setting. */
const saveConfig = act(async (args, snapshot, ctx) => answer({ config: configFromForm(ctx.settings.config, args.form || {}) }));

const resetConfig = act(async () => answer({ config: {} }));

const popupView = act(async (args, snapshot, ctx) => answer({
    history: snapshot.history, chat_data: ctx.doc, chat_data_revision: snapshot.chat_data_revision ?? 0,
    settings: ctx.settings, user_name: ctx.userName,
}));

// The lean prompt is written from what the snapshot has: LocalChar's main prompt, cards and summary
// are not part of it yet, so those three are empty and the model sees the state, the rules, the
// template and the recent messages. Full mode is unaffected.
function leanRun(args, snapshot, ctx) {
    const index = indexOfMessage(ctx.history, args.message_id);
    if (index < 0) return null;
    const fixup = args.fixup || {};
    return {
        index,
        run: {
            index, mes: ctx.history[index].content, kase: fixup.kase, mode: fixup.mode === "full" ? "full" : "lean", swipeId: 0,
            config: core.fixupConfig({ chat: ctx.chat, index, settings: ctx.settings, chatData: ctx.doc, userName: ctx.userName }),
        },
    };
}

const leanPrompt = act(async (args, snapshot, ctx) => {
    const found = leanRun(args, snapshot, ctx);
    if (!found) return answer({ messages: [] });
    const input = core.leanInputs({
        chat: ctx.chat, index: found.index, run: found.run, settings: ctx.settings, chatData: ctx.doc, userName: ctx.userName,
        mainPrompt: "", characters: [{ name: ctx.charName, description: "", personality: "" }], personaName: ctx.userName,
        summary: "", substitute: ctx.substitute,
    });
    return answer({ messages: buildLeanPrompt(input) });
});

/** finalizeFixup's decision: judge the output, splice it in, rebuild the block; or keep nothing. */
const acceptFixup = act(async (args, snapshot, ctx) => {
    const index = indexOfMessage(ctx.history, args.message_id);
    if (index < 0) return answer({ accepted: false, reason: "the reply is gone" }, [quietNotice("warning", TITLE, "Ledger fix-up kept nothing: the reply is gone.")]);
    const found = leanRun({ ...args, fixup: args.fixup }, snapshot, ctx);
    const run = { ...found.run, mes: String(args.snapshot_content ?? found.run.mes) };
    const generated = String(args.generated_part ?? "");
    // Full mode reads the continuation off the reply it was appended to.
    const chat = run.mode === "full"
        ? ctx.chat.map((m, i) => (i === index ? { ...m, mes: run.mes + generated } : m))
        : ctx.chat;
    const judged = core.judgeFixup({ run, chat, settings: ctx.settings, chatData: ctx.doc, userName: ctx.userName, output: generated });
    if (!judged.ok) {
        return answer({ accepted: false, reason: judged.reason }, [quietNotice("warning", TITLE, `Ledger fix-up kept nothing: ${judged.reason}.`)]);
    }
    const spliced = chat.map((m, i) => (i === index ? { ...m, mes: judged.mes } : m));
    const out = core.rebuildMessage({
        chat: spliced, index, settings: ctx.settings, chatData: ctx.doc, userName: ctx.userName, collect: true,
        givenConfig: run.config, proposalSource: proposalSource(ctx.history[index]),
    });
    const effects = [editReply(ctx.history, index, out.mes), ...out.notices.map(n => notifyEffect(n, ctx.settings))];
    if (out.chatDataPatch) effects.push(writeData({ ...ctx.doc, ...out.chatDataPatch }, snapshot.chat_data_revision ?? 0));
    return answer({ accepted: true }, effects);
});

export const actions = {
    rebuild: rebuild,
    save_rules: saveRules,
    decide_proposal: decideProposal,
    import_legacy_notebook: importLegacyNotebook,
    save_threads: saveThreads,
    set_clock: setClock,
    clear_clock: clearClock,
    save_fudges: saveFudges,
    clear_fudges: clearFudges,
    quests_send: questsSend,
    relationships_prune: relationshipsPrune,
    save_config: saveConfig,
    reset_config: resetConfig,
    set_notebook_enabled: setNotebookEnabled,
    preview_turn: previewTurn,
    popup_view: popupView,
    lean_prompt: leanPrompt,
    accept_fixup: acceptFixup,
};

// ── Moving a chat in from SillyTavern, and forking one ──────────────────────

function lookup(map, key, what) {
    const hit = map[key];
    if (hit === undefined) throw new Error(`${what} ${key} is outside the imported chat (out of range)`);
    return hit;
}
const messageAt = (map, index) => {
    const hit = lookup(map, index, "Message");
    if (hit === "skipped") throw new Error(`Message ${index} has no counterpart in LocalChar (skipped); the import cannot keep what points at it`);
    return hit;
};
const boundaryAt = (map, boundary) => lookup(map, boundary, "Boundary");

/**
 * ST's chat_metadata.storyLedger -> this chat's document. Two kinds of position are rewritten: message
 * indices (through the message map) and boundaries (through the boundary map). A position with no
 * counterpart refuses the import; nothing shifts silently.
 */
export async function importStChat({ chat_metadata, message_map, boundary_map }) {
  const source = chat_metadata && chat_metadata.storyLedger;
  if (!source) return { data: null, claimed: [] };
  const doc = docOf(source);
  if (doc.notebook.clockOverride) {
    doc.notebook.clockOverride = { ...doc.notebook.clockOverride, atLength: boundaryAt(boundary_map, doc.notebook.clockOverride.atLength) };
  }
  if (Array.isArray(doc.corrections)) {
    doc.corrections = doc.corrections.map(c => ({ ...c, atLength: boundaryAt(boundary_map, c.atLength) }));
  }
  for (const entry of Object.values(doc.relationshipOverrides || {})) {
    if (Number.isInteger(entry.atLength)) entry.atLength = boundaryAt(boundary_map, entry.atLength);
    if (Number.isInteger(entry.savedAt)) entry.savedAt = messageAt(message_map, entry.savedAt).index;
    if (entry.restoreSwipeId !== undefined) entry.restoreSwipeId = 0; // LocalChar imports one selected variant per message.
  }
  if (doc.fudges && Number.isInteger(doc.fudges.appliedTo)) {
    doc.fudges = { ...doc.fudges, appliedTo: messageAt(message_map, doc.fudges.appliedTo).index };
  }
  if (doc.imported && Number.isInteger(doc.imported.index) && doc.imported.index >= 0) {
    doc.imported = { ...doc.imported, index: messageAt(message_map, doc.imported.index).index };
  }
  doc.notebook.inbox = (doc.notebook.inbox || []).map(item => {
    const m = /^m(\d+)s\d+$/.exec(String(item.source || ""));
    if (!m) return item;
    const target = messageAt(message_map, Number(m[1]));
    return target.message_id ? { ...item, source: target.message_id } : item;
  });
  return { data: doc, claimed: ["storyLedger"] };
}

/** ST's extension_settings.storyLedger -> global settings (the 0.1 migration included). */
export async function importStSettings({ extension_settings }) {
  const raw = extension_settings && extension_settings.storyLedger;
  return { settings: raw ? core.normalizeSettings(raw) : {} };
}

/**
 * A new branch keeps only what still describes the history that was kept: a clock correction or
 * correction past the fork, fudges aimed at a dropped message, and proposals from dropped messages go.
 * (ST copies chat_metadata wholesale and can carry a correction from a future that no longer exists.)
 * LocalChar's swipe is a fork at the reply's own index (`fork_boundary`), and the next reply lands on
 * that same index, so what ST keeps for a swipe stays: fudges applied to that index, and a clock
 * correction or correction made right after that reply (atLength = fork_boundary + 1).
 */
export async function onFork({ data, fork_boundary, kept_message_ids }) {
  const doc = docOf(data);
  const kept = new Set(kept_message_ids || []);
  if (doc.notebook.clockOverride && doc.notebook.clockOverride.atLength > fork_boundary + 1) delete doc.notebook.clockOverride;
  if (Array.isArray(doc.corrections)) doc.corrections = doc.corrections.filter(c => c.atLength <= fork_boundary + 1);
  // Pruning is a reader preference and follows the branch. A restore whose block
  // was dropped must seed the saved values again, at the new branch's boundary.
  for (const entry of Object.values(doc.relationshipOverrides || {})) {
    if (entry.pruned) continue;
    entry.atLength = Math.min(entry.atLength, fork_boundary + 1);
    if (entry.savedAt > fork_boundary) delete entry.savedAt;
    if (fork_boundary === entry.atLength - 1) {
      delete entry.restoreMessage;
      delete entry.seenRelations;
    }
  }
  if (doc.fudges && Number.isInteger(doc.fudges.appliedTo) && doc.fudges.appliedTo > fork_boundary) doc.fudges = null;
  doc.notebook.inbox = (doc.notebook.inbox || []).filter(item => !/^msg_/.test(String(item.source || "")) || kept.has(item.source));
  return { data: doc };
}
