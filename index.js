// ──────────────────────────────────────────────────────────────────────────────
// Story Ledger — a SillyTavern extension. Rules notebook, story clock and a
// FrankenSIM-axis relationship engine that work with any preset.
//
// The model writes one hidden block per reply, <!-- Story_Ledger … -->, reporting
// what happened; this extension keeps the books: it recomputes every number from
// the chat (so swipes and edits are always right), injects a compact state into the
// prompt, strips old blocks, and draws the cards. Pure logic lives in src/model/.
// Uses only SillyTavern's public getContext() API.
// ──────────────────────────────────────────────────────────────────────────────

import {
    emptyNotebook, latestThreads, collectProposals, applyDecision, renderNotebookPrompt,
    importFromLegacyNotebook, storyTime, dayRegression,
} from "./src/model/notebook.js";
import { resolveConfig } from "./src/model/config.js";
import { replayRelations, describePair, pairKey, PATTERN_GLOSS } from "./src/model/relations.js";
import {
    parseLedger, buildTurns, correctionsToTurns, importFfTurn, needsHandover, renderRelationsPrompt,
    stripOldLedgers, RELATIONSHIP_RULES, LEDGER_TEMPLATE, HANDOVER,
} from "./src/model/ledger.js";

const NAME = "storyLedger";
const PROMPT_KEY = "story_ledger";
const IN_CHAT = 1;
const ctx = () => SillyTavern.getContext();

// ── Settings (global) and chat data (per chat) ──────────────────────────────

const DEFAULT_SETTINGS = { enabled: true, notebook: true, clock: true, relations: true, depth: 1, role: 0, placement: "auto", config: {} };

function settings() {
    const all = ctx().extensionSettings;
    all[NAME] = { ...DEFAULT_SETTINGS, ...(all[NAME] || {}) };
    return all[NAME];
}
const saveSettings = () => ctx().saveSettingsDebounced();
const engineConfig = () => resolveConfig(settings().config);

function chatData() {
    const meta = ctx().chatMetadata || {};
    if (!meta.storyLedger) {
        // A chat that ran the Megumin fork keeps its notebook.
        const legacy = meta.meguminNotebook;
        meta.storyLedger = { notebook: legacy ? { ...emptyNotebook(), ...legacy } : emptyNotebook(), corrections: [], ctOffset: null };
    }
    const d = meta.storyLedger;
    d.notebook = { ...emptyNotebook(), ...(d.notebook || {}) };
    d.corrections = d.corrections || [];
    return d;
}
async function saveChatData(mutator) {
    const d = chatData();
    mutator(d);
    await ctx().saveMetadata();
}

// ── Computing everything from the chat ──────────────────────────────────────

function compute(chat) {
    const c = chat || ctx().chat || [];
    const d = chatData();
    const config = engineConfig();
    const nb = d.notebook;
    const threads = latestThreads(c, nb);
    const time = storyTime(c, nb);
    const userName = ctx().name1;
    const { turns, messageIndexes } = buildTurns(c, userName);
    // Until the reader sets one, the turn count continues from an imported FF block.
    const ctOffset = d.ctOffset ?? importFfTurn(c) ?? 0;
    const { state, log } = replayRelations(turns, correctionsToTurns(d.corrections, messageIndexes), config, ctOffset);
    const lastPresent = [...turns].reverse().find(t => t.events)?.present || [userName];
    return { chat: c, data: d, config, nb, threads, time, state, log, present: lastPresent, messageIndexes, ctOffset };
}

function buildInjection(chat) {
    const s = settings();
    if (!s.enabled) return "";
    const r = compute(chat);
    const parts = [];
    if (needsHandover(r.chat)) parts.push(HANDOVER);
    if (s.notebook || s.clock) {
        const nb = s.notebook ? r.nb : { ...r.nb, rules: [], inbox: [] };
        const nbText = r.nb.enabled === false ? "" : renderNotebookPrompt(nb, s.notebook ? r.threads : [], s.clock ? r.time : null);
        if (nbText) parts.push(nbText);
    }
    if (s.relations) {
        const rel = renderRelationsPrompt(r.state, r.present, r.config);
        if (rel) parts.push(rel);
        parts.push(RELATIONSHIP_RULES);
    }
    parts.push(LEDGER_TEMPLATE);
    return ctx().substituteParams(`<story_ledger>\n${parts.join("\n\n")}\n</story_ledger>`);
}

let lastInjection = "";

globalThis.storyLedgerInterceptor = async function (chat, _contextSize, _abort, type) {
    try {
        const s = settings();
        // Background generations (summaries, other extensions' tasks) get nothing.
        lastInjection = (type === "quiet" || !s.enabled) ? "" : buildInjection(chat);
        const auto = s.placement !== "macro" ? lastInjection : "";
        ctx().setExtensionPrompt(PROMPT_KEY, auto, IN_CHAT, Number(s.depth) || 0, false, Number(s.role) || 0);
    } catch (e) {
        console.error("[Story Ledger] interceptor failed", e);
        ctx().setExtensionPrompt(PROMPT_KEY, "", IN_CHAT, 1);
    }
};

// ── Each new reply ──────────────────────────────────────────────────────────

async function onMessageReceived() {
    const c = ctx().chat || [];
    const last = c[c.length - 1];
    if (!last || last.is_user || last.is_system || !settings().enabled) return;
    const parsed = parseLedger(last.mes);
    const r = compute(c);

    if (settings().clock && r.time.timeline.length > 1) {
        const back = dayRegression(r.time.timeline.slice(-2));
        if (back) toastr.warning(`The story went from Day ${back.from} back to Day ${back.to}. Swipe, edit the reply, or set a correction in Story Ledger.`, "🕰️ Story clock");
    }
    if (!parsed) return;
    if (settings().relations) {
        const thisTurn = r.log.filter(l => l.turn === r.messageIndexes.length - 1 && l.kind === "refused");
        const unread = parsed.relations.unparsed.length;
        if (thisTurn.length || unread) toastr.info(`${thisTurn.length + unread} relationship line(s) could not be applied — see the Relationships log.`, "💞 Story Ledger");
    }
    if (settings().notebook && parsed.proposals.length) {
        const before = chatData().notebook;
        const after = collectProposals(before, parsed.proposals, `m${c.length - 1}s${last.swipe_id ?? 0}`);
        const added = after.inbox.length - before.inbox.length;
        if (added > 0) {
            await saveChatData(d => { d.notebook = after; });
            toastr.info(`${added} rule proposal${added > 1 ? "s" : ""} waiting.`, "📜 Story Ledger");
        }
    }
}

// ── Cards under each message ────────────────────────────────────────────────

const esc = s => String(s ?? "").replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

function cardHtml(parsed, mesIndex) {
    const tabs = [];
    if (parsed.now || parsed.present.length) {
        tabs.push(["scene", "🕰️", "Scene", `${parsed.now ? `<div class="sl-now">${esc(parsed.now)}</div>` : ""}${parsed.present.length ? `<div class="sl-chips">${parsed.present.map(p => `<span class="sl-chip">${esc(p)}</span>`).join("")}</div>` : ""}`]);
    }
    if (parsed.threads.length) tabs.push(["threads", "🧵", "Threads", `<ul class="sl-list">${parsed.threads.map(t => `<li>${esc(t)}</li>`).join("")}</ul>`]);
    const rel = parsed.relations;
    const relLines = [
        ...rel.news.map(n => `<li><span class="sl-tag sl-new">NEW</span> ${esc(n.from)} → ${esc(n.to)}${n.reason ? ` <i>${esc(n.reason)}</i>` : ""}</li>`),
        ...rel.directs.map(d => `<li><span class="sl-tag sl-direct">DIRECT</span> ${esc(d.from)} → ${esc(d.to)}: ${esc(d.axis)} +${d.amount}${d.reason ? ` <i>${esc(d.reason)}</i>` : ""}</li>`),
        ...rel.ticks.map(t => `<li>${esc(t.from)} → ${esc(t.to)}: <b class="sl-axis sl-${axisKind(t.acc)}">${esc(t.acc)}</b> +${t.amount}${t.reason ? ` <i>${esc(t.reason)}</i>` : ""}</li>`),
        ...rel.phiTicks.map(t => `<li>${esc(t.who)}: <b>Φ</b> ${t.amount >= 0 ? "+" : ""}${t.amount}${t.reason ? ` <i>${esc(t.reason)}</i>` : ""}</li>`),
        ...rel.unparsed.map(u => `<li class="sl-unread">⚠ ${esc(u)}</li>`),
    ];
    if (relLines.length) tabs.push(["rel", "💞", "Relationships", `<ul class="sl-list">${relLines.join("")}</ul>`]);
    if (parsed.proposals.length) tabs.push(["rules", "📜", "Rule proposals", `<ul class="sl-list">${parsed.proposals.map(p => `<li>${esc(p.op)}${p.target ? ` R${p.target}` : ""}: ${esc(p.text)}</li>`).join("")}</ul>`]);
    if (!tabs.length) return "";
    return `<div class="sl-card" data-sl-mes="${mesIndex}">
        <div class="sl-tabs">${tabs.map(([id, icon, label], i) => `<button class="sl-tab${i === 0 ? " sl-on" : ""}" data-sl-tab="${id}" title="${label}">${icon} <span>${label}</span></button>`).join("")}</div>
        ${tabs.map(([id, , , body], i) => `<div class="sl-pane${i === 0 ? " sl-on" : ""}" data-sl-pane="${id}">${body}</div>`).join("")}
    </div>`;
}

function axisKind(key) {
    const a = engineConfig().axes.find(x => x.key === key);
    return a ? a.kind : "fond";
}

function renderCard(mesIndex) {
    const el = document.querySelector(`#chat .mes[mesid="${mesIndex}"]`);
    if (!el) return;
    el.querySelectorAll(".sl-card").forEach(n => n.remove());
    const msg = (ctx().chat || [])[mesIndex];
    if (!msg || msg.is_user || !settings().enabled) return;
    const parsed = parseLedger(msg.mes);
    if (!parsed) return;
    const html = cardHtml(parsed, mesIndex);
    if (!html) return;
    const textEl = el.querySelector(".mes_text");
    textEl && textEl.insertAdjacentHTML("afterend", html);
}

function renderAllCards() {
    document.querySelectorAll("#chat .mes[mesid]").forEach(el => renderCard(Number(el.getAttribute("mesid"))));
}

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

const lines = text => String(text || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);

function pairCard(state, from, to, config, editing) {
    const d = describePair(state, from, to, config);
    const fondAxes = config.axes.filter(a => a.kind === "fond");
    const rows = fondAxes.map(f => {
        const m = config.axes.find(a => a.key === f.mirror);
        const fv = d.axes[f.key], mv = d.axes[m.key];
        const val = (a, v) => editing
            ? `<input type="number" class="text_pole sl-num" data-axis="${a.key}" value="${v.value}" min="${config.axisMin}" max="${config.axisMax}"><input type="number" class="text_pole sl-num sl-acc" data-acc="${a.key}" value="${v.acc}" min="0" title="accumulator">`
            : `<b>${v.value}</b>${v.acc ? `<small> +${v.acc}</small>` : ""}`;
        return `<div class="sl-row">
            <span class="sl-lab sl-fond" title="${esc(f.meaning)}">${esc(f.name)} ${val(f, fv)}</span>
            <span class="sl-bar sl-bar-fond"><i style="width:${(fv.value / config.axisMax) * 100}%"></i></span>
            <span class="sl-bar sl-bar-friction"><i style="width:${(mv.value / config.axisMax) * 100}%"></i></span>
            <span class="sl-lab sl-friction" title="${esc(m.meaning)}">${val(m, mv)} ${esc(m.name)}</span>
        </div>`;
    }).join("");
    const chips = [
        `<span class="sl-chip">Φ(${esc(from)}) ${editing ? `<input type="number" class="text_pole sl-num" data-phi value="${d.phi}">` : d.phi}</span>`,
        `<span class="sl-chip ${d.romance === "allowed" ? "sl-ok" : "sl-locked"}">romance ${d.romance}</span>`,
        ...d.walls.map(w => `<span class="sl-chip sl-wall">WALL ${esc(w)}</span>`),
        ...d.patterns.map(p => `<span class="sl-chip sl-pattern" title="${esc(PATTERN_GLOSS[p])}">${esc(p)}</span>`),
    ].join("");
    return `<div class="sl-pair" data-from="${esc(from)}" data-to="${esc(to)}">
        <div class="sl-pair-head"><b>${esc(from)} → ${esc(to)}</b>
            <span class="sl-pair-actions">${editing
                ? `<button class="menu_button sl-save-pair">Save correction</button><button class="menu_button sl-cancel-pair">Cancel</button>`
                : `<button class="menu_button sl-edit-pair">Edit</button>`}</span></div>
        <div class="sl-chips">${chips}</div>
        <div class="sl-mirror-head"><span>fondness</span><span>friction</span></div>
        ${rows}
    </div>`;
}

function popupHtml(tab, view) {
    const r = compute();
    const s = settings();
    const nb = r.nb;
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
                <button class="menu_button" id="sl-import" title="Fill the boxes from the newest Freaky/Realistic Frankenstein, Sola, Ancient Access or Megumin-fork notebook in this chat, and take FF's turn number. Rules are not saved until you press Save.">Import from previous preset</button></div>
            <h4>Proposals from the model</h4>${inbox}`;
    } else if (tab === "threads") {
        body = `<h4>Open threads [T] <small>— the model keeps these up to date each turn</small></h4>
            <textarea id="sl-threads" class="text_pole" rows="10" title="Used only until the model writes its first ledger block.">${esc(r.threads.join("\n"))}</textarea>
            <div class="sl-btns"><button class="menu_button" id="sl-save-threads">Save as starting list</button></div>`;
    } else if (tab === "clock") {
        const label = { notebook: "from the ledger block", world_state: "from World State", ff_header: "from an old header", reader: "your correction — used until the next reply states a time" };
        body = `<h4>🕰️ Story clock</h4>
            <div>${r.time.now ? `<b>${esc(r.time.now.text)}</b> <small>(${label[r.time.now.source] || r.time.now.source})</small>` : "<i>No time stated yet.</i>"}</div>
            ${r.time.timeline.length > 1 ? `<div class="sl-timeline">${r.time.timeline.map(esc).join(" → ")}</div>` : ""}
            <div class="sl-btns"><input type="text" id="sl-clock" class="text_pole" placeholder="Correct the time, e.g. Day 12 — Tuesday, 21:44 | the lawn" value="${esc(nb.clockOverride ? nb.clockOverride.text : "")}">
                <button class="menu_button" id="sl-clock-set">Set correction</button>${nb.clockOverride ? `<button class="menu_button" id="sl-clock-clear">Clear</button>` : ""}</div>`;
    } else if (tab === "rel") {
        const here = new Set(r.present);
        const pairs = Object.values(r.state.pairs).sort((a, b) => (here.has(b.from) || here.has(b.to)) - (here.has(a.from) || here.has(a.to)));
        const cards = pairs.map(p => pairCard(r.state, p.from, p.to, r.config, view && view.editing === pairKey(p.from, p.to))).join("")
            || "<p><i>No relationships yet. The model creates them with NEW lines; on a chat that ran another preset, the first reply calibrates them from its old state.</i></p>";
        const log = r.log.slice(-60).reverse().map(l => `<li class="sl-log-${l.kind}"><small>turn ${l.ct}</small> ${esc(l.where)}: ${esc(l.text)}</li>`).join("");
        body = `<div class="sl-meta">Turn ${r.state.ct}${r.ctOffset ? ` (continuing from turn ${r.ctOffset})` : ""} · present: ${r.present.map(esc).join(", ")}</div>
            ${cards}
            <details class="sl-logbox"><summary>Change log (last 60)</summary><ul class="sl-list">${log || "<li><i>Nothing yet.</i></li>"}</ul></details>`;
    } else {
        const c = r.config;
        const axisRows = c.axes.map(a => `<tr><td title="${esc(a.meaning)}">${esc(a.name)} (${a.key})</td><td><input type="number" class="text_pole sl-num" data-cfg-axis="${a.key}" data-field="period" value="${a.period}"></td><td><input type="number" class="text_pole sl-num" data-cfg-axis="${a.key}" data-field="threshold" value="${a.threshold}"></td></tr>`).join("");
        const decayRows = c.decay.map((d, i) => `<tr><td>${d.pair.join(" ↔ ")}</td><td><input type="number" class="text_pole sl-num" data-cfg-decay="${i}" value="${d.period}"></td></tr>`).join("");
        const num = (k, label) => `<label>${label} <input type="number" class="text_pole sl-num" data-cfg="${k}" value="${c[k]}"></label>`;
        body = `<h4>Parts</h4>
            ${["enabled", "notebook", "clock", "relations"].map(k => `<label class="checkbox_label"><input type="checkbox" data-set="${k}" ${s[k] ? "checked" : ""}> ${{ enabled: "Story Ledger on", notebook: "Rules notebook & threads", clock: "Story clock", relations: "Relationship engine" }[k]}</label>`).join("")}
            <h4>Prompt placement</h4>
            <div class="sl-grid">
                <label>Placement <select class="text_pole" data-set="placement"><option value="auto" ${s.placement === "auto" ? "selected" : ""}>automatic, in chat at depth</option><option value="macro" ${s.placement === "macro" ? "selected" : ""}>only where a preset uses {{story_ledger}}</option></select></label>
                <label>Depth <input type="number" class="text_pole sl-num" data-set="depth" value="${s.depth}" min="0"></label>
                <label>Role <select class="text_pole" data-set="role"><option value="0" ${+s.role === 0 ? "selected" : ""}>system</option><option value="1" ${+s.role === 1 ? "selected" : ""}>user</option><option value="2" ${+s.role === 2 ? "selected" : ""}>assistant</option></select></label>
            </div>
            <h4>Relationship engine numbers <small>— FrankenSIM 3.0's defaults</small></h4>
            <div class="sl-grid">${num("tickCap", "Tick cap / acc / turn")}${num("directMax", "DIRECT max")}${num("axisMin", "Axis min")}${num("axisMax", "Axis max")}${num("decayLead", "Decay gap")}${num("floorDivisor", "Floor divisor")}${num("floorMax", "Floor max")}${num("wallMin", "WALL min")}${num("gravityMin", "Gravity Well min")}</div>
            <div class="sl-grid"><label>Romance gate E ≥ <input type="number" class="text_pole sl-num" data-cfg-gate="E" value="${c.romanceGate.E}"></label><label>or L ≥ <input type="number" class="text_pole sl-num" data-cfg-gate="L" value="${c.romanceGate.L}"></label>
                <label>Offstage skip values <input type="text" class="text_pole" data-cfg-skip value="${c.offstageSkip.join(", ")}"></label></div>
            <div class="sl-grid"><label>Φ period <input type="number" class="text_pole sl-num" data-cfg-phi="period" value="${c.phi.period}"></label><label>Φ threshold <input type="number" class="text_pole sl-num" data-cfg-phi="threshold" value="${c.phi.threshold}"></label><label>Φ acc cap <input type="number" class="text_pole sl-num" data-cfg-phi="accCap" value="${c.phi.accCap}"></label></div>
            <table class="sl-table"><tr><th>Axis</th><th>Convert every N turns</th><th>at accumulator ≥</th></tr>${axisRows}</table>
            <table class="sl-table"><tr><th>Mirror decay</th><th>every N turns</th></tr>${decayRows}</table>
            <div class="sl-btns"><button class="menu_button" id="sl-save-config">Save engine numbers</button><button class="menu_button" id="sl-reset-config">Reset to FrankenSIM defaults</button></div>
            <h4>This chat</h4>
            <div class="sl-grid"><label>Continue turn count from <input type="number" class="text_pole sl-num" id="sl-ct-offset" value="${r.ctOffset}"></label><button class="menu_button" id="sl-save-offset">Save</button></div>`;
    }
    return `<div class="sl-popup">
        <h3>📒 Story Ledger</h3>
        <div class="sl-tabs sl-popup-tabs">${T("rules", "📜 Rules")}${T("threads", "🧵 Threads")}${T("clock", "🕰️ Clock")}${T("rel", "💞 Relationships")}${T("settings", "⚙️ Settings")}</div>
        <div class="sl-popup-body">${body}</div>
    </div>`;
}

export async function openLedgerPopup(startTab = "rules") {
    let tab = startTab, view = {};
    const popup = new (ctx().Popup)(popupHtml(tab, view), ctx().POPUP_TYPE.TEXT, "", { wide: true, large: true, allowVerticalScrolling: true, okButton: "Close" });
    const $root = $(popup.dlg);
    const refresh = () => $root.find(".sl-popup").replaceWith(popupHtml(tab, view));
    const done = (msg) => { if (msg) toastr.success(msg, "📒 Story Ledger"); refresh(); renderAllCards(); };

    $root.on("click", "[data-sl-popup-tab]", e => { tab = $(e.currentTarget).data("sl-popup-tab"); view = {}; refresh(); });
    $root.on("change", "#sl-nb-enabled", async e => { await saveChatData(d => { d.notebook.enabled = e.target.checked; }); });
    $root.on("click", "#sl-save-rules", async () => { await saveChatData(d => { d.notebook.rules = lines($root.find("#sl-rules").val()); }); done("Rules saved."); });
    $root.on("click", "#sl-save-threads", async () => { await saveChatData(d => { d.notebook.threads = lines($root.find("#sl-threads").val()); }); done("Starting threads saved."); });
    $root.on("click", "#sl-import", async () => {
        const c = ctx().chat || [];
        const got = importFromLegacyNotebook(c);
        const turn = importFfTurn(c);
        if (!got.rules.length && !got.threads.length && turn === null) { toastr.warning("No previous notebook or turn count found in this chat.", "📒 Story Ledger"); return; }
        const current = lines($root.find("#sl-rules").val());
        $root.find("#sl-rules").val([...current, ...got.rules.filter(x => !current.includes(x))].join("\n"));
        if (got.threads.length) await saveChatData(d => { if (!d.notebook.threads.length) d.notebook.threads = got.threads; });
        if (turn !== null) await saveChatData(d => { d.ctOffset = turn; });
        toastr.info(`Imported ${got.rules.length} rule(s), ${got.threads.length} thread(s)${turn !== null ? `, turn ${turn}` : ""}. Review the rules, edit any that name the old preset's mechanics, then Save.`, "📒 Story Ledger");
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
    $root.on("click", ".sl-edit-pair", e => { const p = $(e.currentTarget).closest(".sl-pair"); view = { editing: pairKey(p.data("from"), p.data("to")) }; refresh(); });
    $root.on("click", ".sl-cancel-pair", () => { view = {}; refresh(); });
    $root.on("click", ".sl-save-pair", async e => {
        const p = $(e.currentTarget).closest(".sl-pair");
        const from = String(p.data("from")), to = String(p.data("to"));
        const axes = {}, acc = {};
        p.find("[data-axis]").each((_, el) => { axes[el.dataset.axis] = Number(el.value); });
        p.find("[data-acc]").each((_, el) => { acc[el.dataset.acc] = Number(el.value); });
        const phiEl = p.find("[data-phi]")[0];
        const atLength = (ctx().chat || []).length;
        const phiNow = (compute().state.selves[from] || { phi: 0 }).phi;
        await saveChatData(d => {
            d.corrections.push({ atLength, from, to, axes, acc });
            if (phiEl && Number(phiEl.value) !== phiNow) d.corrections.push({ atLength, who: from, phi: Number(phiEl.value) });
        });
        view = {};
        done(`${from} → ${to} corrected.`);
    });
    $root.on("change", "[data-set]", e => {
        const el = e.currentTarget, k = el.dataset.set;
        settings()[k] = el.type === "checkbox" ? el.checked : (el.type === "number" ? Number(el.value) : el.value);
        saveSettings();
        renderAllCards();
    });
    $root.on("click", "#sl-save-config", () => {
        const c = engineConfig();
        $root.find("[data-cfg]").each((_, el) => { c[el.dataset.cfg] = Number(el.value); });
        $root.find("[data-cfg-gate]").each((_, el) => { c.romanceGate[el.dataset.cfgGate] = Number(el.value); });
        $root.find("[data-cfg-phi]").each((_, el) => { c.phi[el.dataset.cfgPhi] = Number(el.value); });
        $root.find("[data-cfg-axis]").each((_, el) => { const a = c.axes.find(x => x.key === el.dataset.cfgAxis); a[el.dataset.field] = Number(el.value); });
        $root.find("[data-cfg-decay]").each((_, el) => { c.decay[Number(el.dataset.cfgDecay)].period = Number(el.value); });
        c.offstageSkip = String($root.find("[data-cfg-skip]").val() || "").split(/[,\s]+/).map(Number).filter(Number.isFinite);
        settings().config = c;
        saveSettings();
        done("Engine numbers saved. Every relationship is recomputed with them.");
    });
    $root.on("click", "#sl-reset-config", () => { settings().config = {}; saveSettings(); done("Reset to FrankenSIM defaults."); });
    $root.on("click", "#sl-save-offset", async () => { const v = Number($root.find("#sl-ct-offset").val()) || 0; await saveChatData(d => { d.ctOffset = v; }); done("Turn count saved."); });

    await popup.show();
}

// ── Wiring ──────────────────────────────────────────────────────────────────

function init() {
    const c = ctx();
    const t = c.eventTypes;
    c.eventSource.on(t.MESSAGE_RECEIVED, onMessageReceived);
    c.eventSource.on(t.CHAT_COMPLETION_PROMPT_READY, data => {
        const messages = data && (data.chat || data.messages);
        if (Array.isArray(messages) && settings().enabled) stripOldLedgers(messages);
    });
    for (const ev of [t.CHARACTER_MESSAGE_RENDERED, t.MESSAGE_UPDATED, t.MESSAGE_SWIPED, t.MESSAGE_EDITED]) {
        if (ev) c.eventSource.on(ev, id => setTimeout(() => renderCard(Number(id)), 0));
    }
    for (const ev of [t.CHAT_CHANGED, t.MORE_MESSAGES_LOADED]) if (ev) c.eventSource.on(ev, () => setTimeout(renderAllCards, 0));
    if (t.STREAM_TOKEN_RECEIVED) c.eventSource.on(t.STREAM_TOKEN_RECEIVED, () => hideStreamingLedger());

    c.registerMacro("story_ledger", () => lastInjection || buildInjection());

    $(document).on("click", ".sl-card .sl-tab", e => {
        const card = $(e.currentTarget).closest(".sl-card");
        card.find(".sl-tab, .sl-pane").removeClass("sl-on");
        $(e.currentTarget).addClass("sl-on");
        card.find(`[data-sl-pane="${$(e.currentTarget).data("sl-tab")}"]`).addClass("sl-on");
    });
    if (!$("#sl-menu").length) {
        $("#extensionsMenu").append(`<div id="sl-menu" class="list-group-item flex-container flexGap5 interactable" tabindex="0" title="Story Ledger"><div class="fa-solid fa-book-bookmark extensionsMenuExtensionButton"></div><span>Story Ledger</span></div>`);
        $("#sl-menu").on("click", () => openLedgerPopup());
    }
    renderAllCards();
}

jQuery(() => {
    try { init(); } catch (e) { console.error("[Story Ledger] failed to start", e); }
});
