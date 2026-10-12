// The Story Ledger panel on LocalChar: index.js's popup handlers, with jQuery replaced by delegated DOM
// listeners and every chat change made by an action (the host applies its effects atomically). The
// HTML is core.popupHtml, the same string ST renders.

import * as core from "../src/host/core.js";
import { toStChat } from "./st-chat.mjs";
import { rollTurnDice } from "../src/model/dice.js";
import { fudgeFromControls, configFormFromControls, settingFromControl } from "./panel-logic.mjs";

const TITLE = "📒 Story Ledger";
const lines = text => String(text || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
const dieValue = (dice, key) => key.startsWith("fate.") ? dice.fate[key.at(-1)] : key === "world" ? dice.world : dice.checks;

function readFudgeControls(root) {
    const q = selector => root.querySelector(selector);
    const dice = {};
    for (const key of ["fate.a", "fate.b", "fate.c", "world"]) {
        dice[key] = { locked: Boolean(q(`[data-fudge-lock="${key}"]`)?.checked), value: q(`[data-fudge-value="${key}"]`)?.value };
    }
    return fudgeFromControls({
        dice,
        checks: { locked: Boolean(q('[data-fudge-lock="checks"]')?.checked), values: [0, 1, 2].map(i => q(`[data-fudge-check="${i}"]`)?.value) },
        tier: q("#sl-fudge-tier")?.value || "", source: q("#sl-fudge-source")?.value || "",
        calm: Boolean(q("#sl-fudge-calm")?.checked), fire: q("#sl-fudge-fire")?.value || "",
    });
}

function readConfigControls(root) {
    const all = selector => [...root.querySelectorAll(selector)];
    return configFormFromControls({
        cfg: all("[data-cfg]").map(el => [el.dataset.cfg, el.value]),
        gate: all("[data-cfg-gate]").map(el => [el.dataset.cfgGate, el.value]),
        phi: all("[data-cfg-phi]").map(el => [el.dataset.cfgPhi, el.value]),
        axes: all("[data-cfg-axis]").map(el => [el.dataset.cfgAxis, el.dataset.field, el.value]),
        decay: all("[data-cfg-decay]").map(el => [el.dataset.cfgDecay, el.value]),
        skip: root.querySelector("[data-cfg-skip]")?.value,
        chekhov: all("[data-chk]").map(el => [el.dataset.chk, el.value]),
        firing: String(root.querySelector("[data-chk-firing]")?.value || "model"),
        fate: all("[data-fate]").map(el => [el.dataset.fate, el.value]),
    });
}

/**
 * Fill `body` with the ledger panel and wire it. `fixedTab` shows one tab with no tab strip (the page
 * under Settings → Extensions). Returns the cleanup the host runs when the panel closes.
 */
export function mountLedger({ host, body, startTab = "rules", fixedTab = null, getSettings, setSettings }) {
    let tab = fixedTab || startTab;
    let previewBaseDice = rollTurnDice();
    let view = null;
    let closed = false;
    let previewSeq = 0;

    const notify = (kind, text) => host.notify(kind, text, TITLE);

    async function load() {
        if (fixedTab) {
            view = { chat: [], settings: getSettings(), chatData: core.normalizeChatData({}), userName: "" };
            return;
        }
        const snapshot = await host.callAction("popup_view", {});
        view = {
            chat: toStChat(snapshot.history, { userName: snapshot.user_name }),
            settings: getSettings(),
            chatData: core.normalizeChatData({ storyLedger: snapshot.chat_data }),
            userName: snapshot.user_name,
        };
    }

    function render() {
        if (closed || !view) return;
        view.settings = getSettings();
        body.innerHTML = core.popupHtml(tab, view, previewBaseDice);
        if (fixedTab) {
            body.querySelector(".sl-popup-tabs")?.remove();
            body.querySelector(".sl-popup > h3")?.remove();
        }
        setMixed();
    }

    function setMixed() {
        const all = body.querySelector("#sl-send-all");
        if (all) all.indeterminate = all.dataset.mixed === "1";
    }

    /** Run an action, reload the snapshot it changed, redraw; `message` is shown on success. */
    async function run(name, args, message) {
        try {
            const out = await host.callAction(name, args);
            await load();
            render();
            if (message) notify("success", message);
            return out;
        } catch (error) {
            if (error?.code !== "extension_stale_bundle") notify("error", error?.message || "That did not work.");
            return null;
        }
    }

    async function updatePreview() {
        if (tab !== "dice") return;
        const seq = ++previewSeq;
        try {
            const out = await host.callAction("preview_turn", { fudge: readFudgeControls(body), base_dice: previewBaseDice });
            const target = body.querySelector("#sl-turn-preview");
            if (target && seq === previewSeq) target.textContent = out?.text || "No turn facts for the enabled sections.";
        } catch { /* a failed preview leaves the last one on screen */ }
    }

    const fudgeSummaryOf = fudge => core.fudgeSummary(fudge);

    async function onClick(event) {
        const t = event.target;
        const on = selector => t.closest?.(selector);
        let hit;
        if ((hit = on("[data-sl-popup-tab]"))) { tab = hit.dataset.slPopupTab; render(); return; }
        if (on("#sl-save-rules")) { await run("save_rules", { rules: lines(body.querySelector("#sl-rules").value) }, "Rules saved. The next reply's block shows them."); return; }
        if (on("#sl-save-threads")) { await run("save_threads", { threads: lines(body.querySelector("#sl-threads").value) }, "Starting threads saved."); return; }
        if (on("#sl-import")) {
            // Fills the rules box; nothing is saved until Save is pressed, so the panel is not redrawn.
            const got = await host.callAction("import_legacy_notebook", {});
            if (got && (got.rules.length || got.threads.length)) {
                const box = body.querySelector("#sl-rules");
                const current = lines(box.value);
                box.value = [...current, ...got.rules.filter(rule => !current.includes(rule))].join("\n");
            }
            return;
        }
        if ((hit = on(".sl-approve, .sl-reject"))) {
            await run("decide_proposal", { id: hit.dataset.id, decision: hit.classList.contains("sl-approve") ? "approve" : "reject" });
            return;
        }
        if (on("#sl-clock-set")) {
            const text = String(body.querySelector("#sl-clock").value || "").trim();
            if (text) await run("set_clock", { text }, "Story time corrected.");
            return;
        }
        if (on("#sl-clock-clear")) { await run("clear_clock", {}); return; }
        if (on("#sl-reroll-unlocked")) {
            previewBaseDice = rollTurnDice();
            for (const key of ["fate.a", "fate.b", "fate.c", "world"]) {
                if (!body.querySelector(`[data-fudge-lock="${key}"]`).checked) body.querySelector(`[data-fudge-value="${key}"]`).value = dieValue(previewBaseDice, key);
            }
            if (!body.querySelector('[data-fudge-lock="checks"]').checked) [0, 1, 2].forEach(i => { body.querySelector(`[data-fudge-check="${i}"]`).value = previewBaseDice.checks[i]; });
            updatePreview();
            return;
        }
        if (on("#sl-save-fudges")) {
            const fudge = readFudgeControls(body);
            const armed = core.hasFudgeSettings(fudge);
            await run("save_fudges", { fudge }, armed ? `Armed for the next reply: ${fudgeSummaryOf(fudge)}.` : "No fudges are set.");
            return;
        }
        if (on("#sl-clear-fudges")) { await run("clear_fudges", {}, "Fudges cleared."); return; }
        if (on("#sl-save-config")) {
            const out = await host.callAction("save_config", { form: readConfigControls(body) });
            if (out?.config) {
                const next = { ...getSettings(), config: out.config };
                await setSettings(next);
                render();
                notify("success", "Engine numbers saved. They apply from the next reply on.");
            }
            return;
        }
        if (on("#sl-reset-config")) {
            await setSettings({ ...getSettings(), config: {} });
            render();
            notify("success", "Reset to defaults.");
        }
    }

    async function onChange(event) {
        const el = event.target;
        if (el.matches?.("#sl-nb-enabled")) { await run("set_notebook_enabled", { enabled: el.checked }); return; }
        if (el.matches?.("[data-fudge-lock]")) {
            const key = el.dataset.fudgeLock;
            if (!el.checked) {
                if (key === "checks") [0, 1, 2].forEach(i => { body.querySelector(`[data-fudge-check="${i}"]`).value = previewBaseDice.checks[i]; });
                else body.querySelector(`[data-fudge-value="${key}"]`).value = dieValue(previewBaseDice, key);
            }
            updatePreview();
            return;
        }
        if (el.matches?.("#sl-fudge-tier, #sl-fudge-source, #sl-fudge-calm, #sl-fudge-fire")) { updatePreview(); return; }
        if (el.matches?.("[data-set]")) {
            const next = { ...getSettings(), [el.dataset.set]: settingFromControl(el) };
            await setSettings(next);
            if (el.dataset.set === "fixupMode") {
                const history = body.querySelector("#sl-fixup-history");
                if (history) history.style.display = el.value === "lean" ? "" : "none";
            }
            return;
        }
        if (el.matches?.("[data-section]")) {
            const current = getSettings();
            await setSettings({ ...current, sections: { ...current.sections, [el.dataset.section]: el.checked } });
            return;
        }
        if (el.matches?.(".sl-send")) { await sendQuests([String(el.dataset.id)], el.checked); return; }
        if (el.matches?.("#sl-send-all")) { await sendQuests("all", el.checked); }
    }

    function onInput(event) {
        const el = event.target;
        if (el.matches?.("[data-fudge-value]")) {
            const lock = body.querySelector(`[data-fudge-lock="${el.dataset.fudgeValue}"]`);
            if (lock) lock.checked = true;
            updatePreview();
        } else if (el.matches?.("[data-fudge-check]")) {
            const lock = body.querySelector('[data-fudge-lock="checks"]');
            if (lock) lock.checked = true;
            updatePreview();
        }
    }

    async function sendQuests(ids, on) {
        // The quest rows live in the newest reply's block, so the chat view reloads too.
        if (await run("quests_send", { ids, on })) await host.chat.reload?.();
    }

    body.addEventListener("click", onClick);
    body.addEventListener("change", onChange);
    body.addEventListener("input", onInput);
    body.textContent = "Loading…";
    load().then(render).catch(error => {
        if (!closed) body.textContent = `The ledger could not be loaded: ${error?.message || error}`;
    });

    return () => {
        closed = true;
        body.removeEventListener("click", onClick);
        body.removeEventListener("change", onChange);
        body.removeEventListener("input", onInput);
    };
}
