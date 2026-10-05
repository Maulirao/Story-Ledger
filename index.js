// ──────────────────────────────────────────────────────────────────────────────
// Story Ledger — a SillyTavern extension. Rules notebook, story clock and a
// FrankenSIM-axis relationship engine that work with any preset.
//
// The model writes one hidden comment per reply, <!-- Story_Ledger … -->, holding
// only what changed. This extension keeps the books: it reads the state from the
// newest reply's block, applies the changes, and writes the full state block into
// the reply (FF's <internal_states> layout). The newest block is the truth, so a
// hand edit to it sticks. Pure logic lives in src/model/; display in src/ui/.
// Uses only SillyTavern's public getContext() API.
// ──────────────────────────────────────────────────────────────────────────────

import {
    emptyNotebook, collectProposals, applyDecision, importFromLegacyNotebook, storyTime, dayRegression,
} from "./src/model/notebook.js";
import { resolveConfig } from "./src/model/config.js";
import { describePair, PATTERN_GLOSS } from "./src/model/relations.js";
import { parseChanges } from "./src/model/changes.js";
import { renderBlock, BLOCK_MARK } from "./src/model/block.js";
import { postTurn, latestState, initialState, writeBlockInto, stripBlocks, generationBase } from "./src/model/turn.js";
import { renderStatePrompt, needsHandover, stripForPrompt, stripPromptText, buildTemplate, renderRules, renderTurnFacts, HANDOVER } from "./src/model/prompt.js";
import { SECTIONS } from "./src/model/sections/registry.js";
import { rollD20s } from "./src/model/dice.js";
import { decorate as decorateFrankenstein, undecorate } from "./src/ui/themes/frankenstein.js";

const NAME = "storyLedger";
const PROMPT_KEY = "story_ledger";
const IN_CHAT = 1;
const ctx = () => SillyTavern.getContext();

// ── Settings (global) and chat data (per chat) ──────────────────────────────

const DEFAULT_SECTIONS = { scene: true, relationships: true, notebook: true, ...Object.fromEntries(SECTIONS.map(sec => [sec.key, true])) };
const DEFAULT_SETTINGS = { enabled: true, depth: 1, role: 0, placement: "auto", theme: "frankenstein", checkStyle: "dnd", config: {} };

function settings() {
    const all = ctx().extensionSettings;
    const s = all[NAME] = { ...DEFAULT_SETTINGS, ...(all[NAME] || {}) };
    if (!s.sections) {
        // 0.1 had one switch per part; carry the reader's choices over.
        s.sections = {
            scene: s.clock !== false,
            relationships: s.relations !== false,
            notebook: s.notebook !== false,
        };
        delete s.clock; delete s.relations; delete s.notebook;
    }
    s.sections = { ...DEFAULT_SECTIONS, ...s.sections };
    return s;
}
const saveSettings = () => ctx().saveSettingsDebounced();
const engineConfig = (extra = {}) => ({
    ...resolveConfig(settings().config), userName: ctx().name1,
    sections: settings().sections, checkStyle: settings().checkStyle, ...extra,
});

function chatData() {
    const meta = ctx().chatMetadata || {};
    if (!meta.storyLedger) {
        // A chat that ran the Megumin fork keeps its notebook.
        const legacy = meta.meguminNotebook;
        meta.storyLedger = { notebook: legacy ? { ...emptyNotebook(), ...legacy } : emptyNotebook() };
    }
    const d = meta.storyLedger;
    d.notebook = { ...emptyNotebook(), ...(d.notebook || {}) };
    // d.ctOffset / d.corrections are 0.1's replay inputs. They are kept: a 0.1 chat with
    // no block yet is replayed from its comments with them (initialState).
    return d;
}
async function saveChatData(mutator) {
    const d = chatData();
    mutator(d);
    await ctx().saveMetadata();
}

const activeRules = nb => (nb.enabled === false ? [] : nb.rules);

// ── The state before message `index` ────────────────────────────────────────

function stateBefore(chat, index, config) {
    return startOf(chat, index, config).state;
}

/** { state, errors } — errors are rows of the previous block that no longer parse. */
function startOf(chat, index, config) {
    const found = latestState(chat, index, config);
    if (found) return { state: found.state, errors: found.errors };
    const d = chatData();
    const s = initialState(chat.slice(0, index), config, { ctOffset: d.ctOffset ?? null, corrections: d.corrections || [] });
    if (!s.threads.length && d.notebook.threads.length) s.threads = [...d.notebook.threads];   // reader's starting list
    return { state: s, errors: [] };
}

function blockFor(state) {
    const s = settings();
    return renderBlock(state, { rules: activeRules(chatData().notebook), config: engineConfig(), sections: s.sections });
}

// ── What the model reads ────────────────────────────────────────────────────

// The raw chat, never the interceptor's coreChat: prompt-side regex may already have
// trimmed the blocks out of that copy. `base` = how many messages this generation builds on.
function buildInjection(type = "normal") {
    const s = settings();
    if (!s.enabled) return "";
    const raw = ctx().chat || [];
    const c = raw.slice(0, generationBase(raw.length, type));
    const config = engineConfig({ rolls: pendingTurn ? pendingTurn.rolls : undefined });
    const nb = chatData().notebook;
    const state = stateBefore(c, c.length, config);
    const time = storyTime(c, nb);
    if (state.scene.now && (!time.now || time.now.source !== "reader")) time.now = { text: state.scene.now, source: "notebook" };
    const parts = [];
    if (needsHandover(c)) parts.push(HANDOVER);
    const st = renderStatePrompt(state, {
        notebook: nb.enabled === false ? { ...nb, rules: [], inbox: [] } : nb, config, sections: s.sections, time,
    });
    if (st) parts.push(st);
    parts.push(renderRules(config));
    parts.push(buildTemplate(config));
    const facts = renderTurnFacts(state, config);
    if (facts) parts.push(facts);
    return ctx().substituteParams(`<story_ledger>\n${parts.join("\n\n")}\n</story_ledger>`);
}

let lastInjection = "";
// This generation's dice, rolled when it starts and written into the reply's block when
// it arrives. A continue keeps the dice of the reply it continues.
let pendingTurn = null;
const SKIP_TYPES = new Set(["quiet", "impersonate", "first_message"]);

globalThis.storyLedgerInterceptor = async function (_chat, _contextSize, _abort, type) {
    try {
        const s = settings();
        // Background generations (summaries, other extensions' tasks) get nothing.
        if (!SKIP_TYPES.has(type) && s.enabled && !(type === "continue" && pendingTurn)) {
            pendingTurn = { rolls: s.sections.checks !== false ? rollD20s(3) : [] };
        }
        lastInjection = (SKIP_TYPES.has(type) || !s.enabled) ? "" : buildInjection(type);
        const auto = s.placement !== "macro" ? lastInjection : "";
        ctx().setExtensionPrompt(PROMPT_KEY, auto, IN_CHAT, Number(s.depth) || 0, false, Number(s.role) || 0);
    } catch (e) {
        console.error("[Story Ledger] interceptor failed", e);
        ctx().setExtensionPrompt(PROMPT_KEY, "", IN_CHAT, 1);
    }
};

// ── Writing the block into a reply ──────────────────────────────────────────

/** Recompute message `i`'s block from the block before it and its own comment. */
async function rebuildMessage(i, { announce = true } = {}) {
    const c = ctx().chat || [];
    const msg = c[i];
    if (!msg || msg.is_user || msg.is_system) return;
    // The newest reply takes this generation's dice; an older one (↻ rebuild) keeps the
    // dice its block already shows.
    const shown = String(msg.mes || "").match(/<b>Rolls:<\/b>\s*([\d,\s]+)/);
    const rolls = i === c.length - 1 && pendingTurn ? pendingTurn.rolls
        : shown ? shown[1].split(/[,\s]+/).filter(Boolean).map(Number) : [];
    const config = engineConfig({ rolls });
    const start = startOf(c, i, config);
    const prev = start.state;
    // Read the comment with every block taken out: after a continue, the rest of a
    // cut-off comment sits after the block, and the block's own "-->" would end it early.
    const changes = parseChanges(stripBlocks(msg.mes));
    const { state, log, unparsed } = postTurn(prev, changes, config);
    msg.mes = writeBlockInto(msg.mes, blockFor(state));
    if (Array.isArray(msg.swipes) && msg.swipe_id !== undefined && msg.swipes[msg.swipe_id] !== undefined) msg.swipes[msg.swipe_id] = msg.mes;
    ctx().updateMessageBlock(i, msg);
    await ctx().saveChat();
    decorateMessage(i);
    if (!announce) return;

    const s = settings();
    if (start.errors.length) toastr.warning(`${start.errors.length} row(s) in the previous block could not be read and kept their earlier values: ${start.errors.map(e => `${e.section}: ${e.row}`).join("; ")}`, "📒 Story Ledger");
    if (!changes) {
        toastr.warning("No ledger comment in this reply — the turn still advanced. Swipe if you want it written.", "📒 Story Ledger");
        return;
    }
    if (s.sections.scene) {
        const back = dayRegression([prev.scene.now, state.scene.now]);
        if (back) toastr.warning(`The story went from Day ${back.from} back to Day ${back.to}. Swipe, or edit the block's Now line.`, "🕰️ Story clock");
    }
    const refused = log.filter(l => l.kind === "refused").length + changes.relations.unparsed.length;
    if (s.sections.relationships && refused) toastr.info(`${refused} relationship line(s) could not be applied.`, "💞 Story Ledger");
    const unread = [...changes.unparsed, ...unparsed];
    if (unread.length) toastr.info(`Could not read: ${unread.map(u => `${u.section}: "${u.line}"`).join("; ")}`, "📒 Story Ledger");
    if (s.sections.notebook && changes.proposals.length) {
        const before = chatData().notebook;
        const after = collectProposals(before, changes.proposals, `m${i}s${msg.swipe_id ?? 0}`);
        const added = after.inbox.length - before.inbox.length;
        if (added > 0) {
            await saveChatData(d => { d.notebook = after; });
            toastr.info(`${added} rule proposal${added > 1 ? "s" : ""} waiting.`, "📜 Story Ledger");
        }
    }
}

async function onMessageReceived(id, type) {
    if (!settings().enabled || SKIP_TYPES.has(type)) return;
    const c = ctx().chat || [];
    const i = Number.isInteger(Number(id)) && c[Number(id)] ? Number(id) : c.length - 1;
    try { await rebuildMessage(i); } catch (e) { console.error("[Story Ledger] could not write the block", e); }
}

// ── Display ─────────────────────────────────────────────────────────────────

function decorateMessage(i) {
    const el = document.querySelector(`#chat .mes[mesid="${i}"] .mes_text`);
    if (!el) return;
    const s = settings();
    if (!s.enabled || !String(((ctx().chat || [])[i] || {}).mes || "").includes(BLOCK_MARK)) { undecorate(el); return; }
    decorateFrankenstein(el, { config: engineConfig(), mesIndex: i });
}
const decorateAll = () => document.querySelectorAll("#chat .mes[mesid]").forEach(el => decorateMessage(Number(el.getAttribute("mesid"))));

// While a reply streams, the unfinished comment is shown as text until "-->"
// arrives. Hide it in the live view.
function hideStreamingLedger() {
    const last = document.querySelector("#chat .mes.last_mes .mes_text");
    if (!last) return;
    let hiding = false;
    for (const child of last.children) {
        if (!hiding && /<!--\s*Story_Ledger/.test(child.textContent)) hiding = true;
        if (hiding) child.style.display = "none";
    }
}

// ── The popup ───────────────────────────────────────────────────────────────

const esc = s => String(s ?? "").replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
const lines = text => String(text || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);

function pairCard(state, from, to, config) {
    const rel = { ct: state.ct, pairs: state.rel.pairs, selves: state.rel.selves };
    const d = describePair(rel, from, to, config);
    const rows = config.axes.filter(a => a.kind === "fond").map(f => {
        const m = config.axes.find(a => a.key === f.mirror);
        const fv = d.axes[f.key], mv = d.axes[m.key];
        const val = v => `<b>${v.value}</b>${v.acc ? `<small> +${v.acc}</small>` : ""}`;
        return `<div class="sl-row">
            <span class="sl-lab sl-fond" title="${esc(f.meaning)}">${esc(f.name)} ${val(fv)}</span>
            <span class="sl-bar sl-bar-fond"><i style="width:${(fv.value / config.axisMax) * 100}%"></i></span>
            <span class="sl-bar sl-bar-friction"><i style="width:${(mv.value / config.axisMax) * 100}%"></i></span>
            <span class="sl-lab sl-friction" title="${esc(m.meaning)}">${val(mv)} ${esc(m.name)}</span>
        </div>`;
    }).join("");
    const chips = [
        `<span class="sl-chip">Φ(${esc(from)}) ${d.phi}</span>`,
        `<span class="sl-chip ${d.romance === "allowed" ? "sl-ok" : "sl-locked"}">romance ${d.romance}</span>`,
        ...d.walls.map(w => `<span class="sl-chip sl-wall">WALL ${esc(w)}</span>`),
        ...d.patterns.map(p => `<span class="sl-chip sl-pattern" title="${esc(PATTERN_GLOSS[p])}">${esc(p)}</span>`),
    ].join("");
    return `<div class="sl-pair"><div class="sl-pair-head"><b>${esc(from)} → ${esc(to)}</b></div>
        <div class="sl-chips">${chips}</div>
        <div class="sl-mirror-head"><span>fondness</span><span>friction</span></div>${rows}</div>`;
}

function popupHtml(tab) {
    const c = ctx().chat || [];
    const s = settings();
    const config = engineConfig({ rolls: pendingTurn ? pendingTurn.rolls : undefined });
    const nb = chatData().notebook;
    const state = stateBefore(c, c.length, config);
    const T = (id, label) => `<button class="sl-tab${tab === id ? " sl-on" : ""}" data-sl-popup-tab="${id}">${label}</button>`;
    let body = "";
    if (tab === "rules") {
        const inbox = nb.inbox.map(i => `<div class="sl-item${i.stale ? " sl-stale" : ""}">
            <div>${i.op === "add" ? `<b>Add</b> ${esc(i.text)}` : i.op === "edit" ? `<b>Edit</b> “${esc(i.targetText)}”<br>→ ${esc(i.text)}` : `<b>Remove</b> “${esc(i.targetText)}”${i.text ? `<br><i>${esc(i.text)}</i>` : ""}`}${i.stale ? "<br><small>The rule this pointed at no longer exists.</small>" : ""}</div>
            <div class="sl-btns">${i.stale ? "" : `<button class="menu_button sl-approve" data-id="${i.id}">Approve</button>`}<button class="menu_button sl-reject" data-id="${i.id}">${i.stale ? "Dismiss" : "Reject"}</button></div>
        </div>`).join("") || "<p><i>No proposals waiting.</i></p>";
        body = `<label class="checkbox_label"><input type="checkbox" id="sl-nb-enabled" ${nb.enabled === false ? "" : "checked"}> Use the notebook in this chat</label>
            <h4>Rules [R] <small>— one per line, sent verbatim every turn. Only you change these.</small></h4>
            <textarea id="sl-rules" class="text_pole" rows="12">${esc(nb.rules.join("\n"))}</textarea>
            <div class="sl-btns"><button class="menu_button" id="sl-save-rules">Save rules</button>
                <button class="menu_button" id="sl-import" title="Fill the boxes from the newest Freaky/Realistic Frankenstein, Sola, Ancient Access or Megumin-fork notebook in this chat. Rules are not saved until you press Save.">Import from previous preset</button></div>
            <h4>Proposals from the model</h4>${inbox}`;
    } else if (tab === "threads") {
        body = `<h4>Open threads [T] <small>— kept in the newest reply's block; edit them there</small></h4>
            <ul class="sl-list">${state.threads.map(t => `<li>${esc(t)}</li>`).join("") || "<li><i>None yet.</i></li>"}</ul>
            <h4>Starting list <small>— used only until the first reply carries a block</small></h4>
            <textarea id="sl-threads" class="text_pole" rows="6">${esc(nb.threads.join("\n"))}</textarea>
            <div class="sl-btns"><button class="menu_button" id="sl-save-threads">Save as starting list</button></div>`;
    } else if (tab === "clock") {
        const time = storyTime(c, nb);
        const now = time.now && time.now.source === "reader" ? time.now : (state.scene.now ? { text: state.scene.now, source: "notebook" } : time.now);
        const label = { notebook: "from the newest block", world_state: "from World State", ff_header: "from an old header", reader: "your correction — used until the next reply states a time" };
        body = `<h4>🕰️ Story clock</h4>
            <div>${now ? `<b>${esc(now.text)}</b> <small>(${label[now.source] || now.source})</small>` : "<i>No time stated yet.</i>"}</div>
            ${time.timeline.length > 1 ? `<div class="sl-timeline">${time.timeline.map(esc).join(" → ")}</div>` : ""}
            <div class="sl-btns"><input type="text" id="sl-clock" class="text_pole" placeholder="Correct the time, e.g. Day 12 — Tuesday, 21:44 | the lawn" value="${esc(nb.clockOverride ? nb.clockOverride.text : "")}">
                <button class="menu_button" id="sl-clock-set">Set correction</button>${nb.clockOverride ? `<button class="menu_button" id="sl-clock-clear">Clear</button>` : ""}</div>`;
    } else if (tab === "rel") {
        const here = new Set([...state.scene.present, config.userName]);
        const pairs = Object.values(state.rel.pairs).sort((a, b) => (here.has(b.from) || here.has(b.to)) - (here.has(a.from) || here.has(a.to)));
        body = `<div class="sl-meta">Turn ${state.ct} · present: ${state.scene.present.map(esc).join(", ") || "—"}</div>
            <p class="sl-meta">Edit the numbers in the newest reply's block to correct them; the next turn starts from your edit.</p>
            ${pairs.map(p => pairCard(state, p.from, p.to, config)).join("") || "<p><i>No relationships yet. The model creates them with NEW lines; on a chat that ran another preset, the first reply calibrates them from its old state.</i></p>"}`;
    } else {
        const cf = config;
        const axisRows = cf.axes.map(a => `<tr><td title="${esc(a.meaning)}">${esc(a.name)} (${a.key})</td><td><input type="number" class="text_pole sl-num" data-cfg-axis="${a.key}" data-field="period" value="${a.period}"></td><td><input type="number" class="text_pole sl-num" data-cfg-axis="${a.key}" data-field="threshold" value="${a.threshold}"></td></tr>`).join("");
        const decayRows = cf.decay.map((d, i) => `<tr><td>${d.pair.join(" ↔ ")}</td><td><input type="number" class="text_pole sl-num" data-cfg-decay="${i}" value="${d.period}"></td></tr>`).join("");
        const num = (k, label) => `<label>${label} <input type="number" class="text_pole sl-num" data-cfg="${k}" value="${cf[k]}"></label>`;
        const sec = { scene: "🕰️ Scene & story clock", relationships: "💞 Relationships", notebook: "📓 Rules notebook & threads",
            ...Object.fromEntries(SECTIONS.map(x => [x.key, typeof x.title === "function" ? x.title({ checkStyle: s.checkStyle }) : x.title])) };
        body = `<label class="checkbox_label"><input type="checkbox" data-set="enabled" ${s.enabled ? "checked" : ""}> Story Ledger on</label>
            <h4>Sections</h4>
            ${Object.entries(sec).map(([k, label]) => `<label class="checkbox_label"><input type="checkbox" data-section="${k}" ${s.sections[k] ? "checked" : ""}> ${label}</label>`).join("")}
            <h4>Look</h4>
            <div class="sl-grid"><label>Theme <select class="text_pole" data-set="theme"><option value="frankenstein" selected>Frankenstein</option></select></label>
                <label>Check style <select class="text_pole" data-set="checkStyle"><option value="dnd" ${s.checkStyle !== "arrow" ? "selected" : ""}>DnD (locked DC)</option><option value="arrow" ${s.checkStyle === "arrow" ? "selected" : ""}>Wind's Arrow (Sola)</option></select></label></div>
            <h4>Prompt placement</h4>
            <div class="sl-grid">
                <label>Placement <select class="text_pole" data-set="placement"><option value="auto" ${s.placement === "auto" ? "selected" : ""}>automatic, in chat at depth</option><option value="macro" ${s.placement === "macro" ? "selected" : ""}>only where a preset uses {{story_ledger}}</option></select></label>
                <label>Depth <input type="number" class="text_pole sl-num" data-set="depth" value="${s.depth}" min="0"></label>
                <label>Role <select class="text_pole" data-set="role"><option value="0" ${+s.role === 0 ? "selected" : ""}>system</option><option value="1" ${+s.role === 1 ? "selected" : ""}>user</option><option value="2" ${+s.role === 2 ? "selected" : ""}>assistant</option></select></label>
            </div>
            <h4>Relationship engine numbers <small>— FrankenSIM 3.0's defaults; they apply from the next reply on</small></h4>
            <div class="sl-grid">${num("tickCap", "Tick cap / acc / turn")}${num("directMax", "DIRECT max")}${num("axisMin", "Axis min")}${num("axisMax", "Axis max")}${num("decayLead", "Decay gap")}${num("floorDivisor", "Floor divisor")}${num("floorMax", "Floor max")}${num("wallMin", "WALL min")}${num("gravityMin", "Gravity Well min")}</div>
            <div class="sl-grid"><label>Romance gate E ≥ <input type="number" class="text_pole sl-num" data-cfg-gate="E" value="${cf.romanceGate.E}"></label><label>or L ≥ <input type="number" class="text_pole sl-num" data-cfg-gate="L" value="${cf.romanceGate.L}"></label>
                <label>Offstage skip values <input type="text" class="text_pole" data-cfg-skip value="${cf.offstageSkip.join(", ")}"></label></div>
            <div class="sl-grid"><label>Φ period <input type="number" class="text_pole sl-num" data-cfg-phi="period" value="${cf.phi.period}"></label><label>Φ threshold <input type="number" class="text_pole sl-num" data-cfg-phi="threshold" value="${cf.phi.threshold}"></label><label>Φ acc cap <input type="number" class="text_pole sl-num" data-cfg-phi="accCap" value="${cf.phi.accCap}"></label></div>
            <table class="sl-table"><tr><th>Axis</th><th>Convert every N turns</th><th>at accumulator ≥</th></tr>${axisRows}</table>
            <table class="sl-table"><tr><th>Mirror decay</th><th>every N turns</th></tr>${decayRows}</table>
            <div class="sl-btns"><button class="menu_button" id="sl-save-config">Save engine numbers</button><button class="menu_button" id="sl-reset-config">Reset to FrankenSIM defaults</button></div>`;
    }
    return `<div class="sl-popup">
        <h3>📒 Story Ledger</h3>
        <div class="sl-tabs sl-popup-tabs">${T("rules", "📜 Rules")}${T("threads", "🧵 Threads")}${T("clock", "🕰️ Clock")}${T("rel", "💞 Relationships")}${T("settings", "⚙️ Settings")}</div>
        <div class="sl-popup-body">${body}</div>
    </div>`;
}

export async function openLedgerPopup(startTab = "rules") {
    let tab = startTab;
    const popup = new (ctx().Popup)(popupHtml(tab), ctx().POPUP_TYPE.TEXT, "", { wide: true, large: true, allowVerticalScrolling: true, okButton: "Close" });
    const $root = $(popup.dlg);
    const refresh = () => $root.find(".sl-popup").replaceWith(popupHtml(tab));
    const done = (msg) => { if (msg) toastr.success(msg, "📒 Story Ledger"); refresh(); };

    $root.on("click", "[data-sl-popup-tab]", e => { tab = $(e.currentTarget).data("sl-popup-tab"); refresh(); });
    $root.on("change", "#sl-nb-enabled", async e => { await saveChatData(d => { d.notebook.enabled = e.target.checked; }); });
    $root.on("click", "#sl-save-rules", async () => { await saveChatData(d => { d.notebook.rules = lines($root.find("#sl-rules").val()); }); done("Rules saved. The next reply's block shows them."); });
    $root.on("click", "#sl-save-threads", async () => { await saveChatData(d => { d.notebook.threads = lines($root.find("#sl-threads").val()); }); done("Starting threads saved."); });
    $root.on("click", "#sl-import", async () => {
        const got = importFromLegacyNotebook(ctx().chat || []);
        if (!got.rules.length && !got.threads.length) { toastr.warning("No previous notebook found in this chat.", "📒 Story Ledger"); return; }
        const current = lines($root.find("#sl-rules").val());
        $root.find("#sl-rules").val([...current, ...got.rules.filter(x => !current.includes(x))].join("\n"));
        if (got.threads.length) await saveChatData(d => { if (!d.notebook.threads.length) d.notebook.threads = got.threads; });
        toastr.info(`Imported ${got.rules.length} rule(s), ${got.threads.length} thread(s). Review the rules, edit any that name the old preset's mechanics, then Save.`, "📒 Story Ledger");
    });
    $root.on("click", ".sl-approve, .sl-reject", async e => {
        const id = $(e.currentTarget).data("id");
        const decision = $(e.currentTarget).hasClass("sl-approve") ? "approve" : "reject";
        await saveChatData(d => {
            const item = d.notebook.inbox.find(i => i.id === id);
            d.notebook = item && item.stale && decision === "reject"
                ? { ...d.notebook, inbox: d.notebook.inbox.filter(i => i.id !== id) }
                : applyDecision(d.notebook, id, decision);
        });
        done();
    });
    $root.on("click", "#sl-clock-set", async () => {
        const text = String($root.find("#sl-clock").val() || "").trim();
        if (!text) return;
        await saveChatData(d => { d.notebook.clockOverride = { text, atLength: (ctx().chat || []).length }; });
        done("Story time corrected.");
    });
    $root.on("click", "#sl-clock-clear", async () => { await saveChatData(d => { delete d.notebook.clockOverride; }); done(); });
    $root.on("change", "[data-set]", e => {
        const el = e.currentTarget, k = el.dataset.set;
        settings()[k] = el.type === "checkbox" ? el.checked : (el.type === "number" ? Number(el.value) : el.value);
        saveSettings();
        decorateAll();
    });
    $root.on("change", "[data-section]", e => {
        settings().sections[e.currentTarget.dataset.section] = e.currentTarget.checked;
        saveSettings();
    });
    $root.on("click", "#sl-save-config", () => {
        const c = resolveConfig(settings().config);
        $root.find("[data-cfg]").each((_, el) => { c[el.dataset.cfg] = Number(el.value); });
        $root.find("[data-cfg-gate]").each((_, el) => { c.romanceGate[el.dataset.cfgGate] = Number(el.value); });
        $root.find("[data-cfg-phi]").each((_, el) => { c.phi[el.dataset.cfgPhi] = Number(el.value); });
        $root.find("[data-cfg-axis]").each((_, el) => { const a = c.axes.find(x => x.key === el.dataset.cfgAxis); a[el.dataset.field] = Number(el.value); });
        $root.find("[data-cfg-decay]").each((_, el) => { c.decay[Number(el.dataset.cfgDecay)].period = Number(el.value); });
        c.offstageSkip = String($root.find("[data-cfg-skip]").val() || "").split(/[,\s]+/).map(Number).filter(Number.isFinite);
        settings().config = c;
        saveSettings();
        done("Engine numbers saved. They apply from the next reply on.");
    });
    $root.on("click", "#sl-reset-config", () => { settings().config = {}; saveSettings(); done("Reset to FrankenSIM defaults."); });

    await popup.show();
}

// ── Wiring ──────────────────────────────────────────────────────────────────

async function confirmRebuild(i) {
    const ok = await ctx().Popup.show.confirm("Rebuild this block?", "It is recomputed from the block before it and this reply's ledger comment. Hand edits to this block are replaced.");
    if (ok) await rebuildMessage(i, { announce: false });
}

function init() {
    const c = ctx();
    const t = c.eventTypes;
    c.eventSource.on(t.MESSAGE_RECEIVED, onMessageReceived);
    c.eventSource.on(t.CHAT_COMPLETION_PROMPT_READY, data => {
        const messages = data && (data.chat || data.messages);
        if (Array.isArray(messages) && settings().enabled) stripForPrompt(messages);
    });
    // Text completion builds one prompt string instead of a message list.
    if (t.GENERATE_AFTER_COMBINE_PROMPTS) c.eventSource.on(t.GENERATE_AFTER_COMBINE_PROMPTS, data => {
        if (data && typeof data.prompt === "string" && settings().enabled) data.prompt = stripPromptText(data.prompt);
    });
    for (const ev of [t.CHARACTER_MESSAGE_RENDERED, t.MESSAGE_UPDATED, t.MESSAGE_SWIPED, t.MESSAGE_EDITED]) {
        if (ev) c.eventSource.on(ev, id => setTimeout(() => decorateMessage(Number(id)), 0));
    }
    for (const ev of [t.CHAT_CHANGED, t.MORE_MESSAGES_LOADED]) if (ev) c.eventSource.on(ev, () => setTimeout(decorateAll, 0));
    if (t.STREAM_TOKEN_RECEIVED) c.eventSource.on(t.STREAM_TOKEN_RECEIVED, () => hideStreamingLedger());

    c.registerMacro("story_ledger", () => lastInjection || buildInjection());

    $(document).on("click", ".sl-rebuild", e => {
        e.preventDefault(); e.stopPropagation();
        const i = Number($(e.currentTarget).closest(".mes").attr("mesid"));
        if (Number.isInteger(i)) confirmRebuild(i);
    });
    if (!$("#sl-menu").length) {
        $("#extensionsMenu").append(`<div id="sl-menu" class="list-group-item flex-container flexGap5 interactable" tabindex="0" title="Story Ledger"><div class="fa-solid fa-book-bookmark extensionsMenuExtensionButton"></div><span>Story Ledger</span></div>`);
        $("#sl-menu").on("click", () => openLedgerPopup());
    }
    decorateAll();
}

jQuery(() => {
    try { init(); } catch (e) { console.error("[Story Ledger] failed to start", e); }
});
