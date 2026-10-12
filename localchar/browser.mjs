// ──────────────────────────────────────────────────────────────────────────────
// Story Ledger on LocalChar: the browser entry. LocalChar imports the bundle of this file from a Blob
// URL and calls the default export with its host object; it returns the dispose that takes everything
// back out. Display is the same themes ST uses, applied to a rendered preset message; the panel is
// core.popupHtml; every change to the chat is an action the server applies atomically.
// ──────────────────────────────────────────────────────────────────────────────

import * as core from "../src/host/core.js";
import { latestState } from "../src/model/turn.js";
import { BLOCK_MARK } from "../src/model/block.js";
import * as frankensteinTheme from "../src/ui/themes/frankenstein.js";
import * as solaTheme from "../src/ui/themes/sola.js";
import * as meguminTheme from "../src/ui/themes/megumin.js";
import { undecorate } from "../src/ui/themes/common.js";
import { mountLedger } from "./panel.mjs";

const THEMES = { frankenstein: frankensteinTheme, sola: solaTheme, megumin: meguminTheme };
const TITLE = "📒 Story Ledger";
const noop = () => {};

// ── Pure helpers (exported for the tests) ───────────────────────────────────

const OPENER = "<!-- story_ledger";

/**
 * While a reply streams, hide the ledger comment: a finished one (a continue streams the old reply, its
 * comment already closed) goes on its own; an unfinished one is cut from its opener, or from a
 * half-written opener at the very end ("<!-- Story_Led", "<!-"), to the end of what has arrived.
 */
export function hideStreamingComment(text) {
    const source = String(text ?? "").replace(/\s*<!--\s*Story_Ledger[\s\S]*?-->/gi, "");
    const full = source.search(/<!--\s*Story_Ledger/i);
    if (full >= 0) return source.slice(0, full).replace(/\s+$/, "");
    const lt = source.lastIndexOf("<");
    if (lt >= 0 && OPENER.startsWith(source.slice(lt).toLowerCase().replace(/\s+/g, " "))) return source.slice(0, lt).replace(/\s+$/, "");
    return source;
}

/** Route a click on the block's own buttons; true when it was one (and it must not toggle the fold). */
export function handleBlockClick(event, { rebuild, fixup, nextTurn }) {
    for (const [selector, fn] of [[".sl-rebuild", rebuild], [".sl-fixup", fixup], [".sl-next-turn", nextTurn]]) {
        if (event.target && event.target.closest && event.target.closest(selector)) {
            event.preventDefault();
            event.stopPropagation();
            fn();
            return true;
        }
    }
    return false;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** ↻: recompute one block from the one before it and its own comment. */
export async function rebuildFlow({ host, message, confirm }) {
    const ok = await confirm("Rebuild this block?", "It is recomputed from the block before it and this reply's ledger comment. Hand edits to this block are replaced.");
    if (!ok) return;
    try {
        await host.callAction("rebuild", { message_id: message.id });
        await host.chat.reload();
    } catch (error) {
        if (error?.code !== "extension_stale_bundle") host.notify("error", error?.message || "The rebuild failed.", TITLE);
    }
}

/**
 * ✎: ask the model for the missing ledger comment (or Thoughts) in a server-side job and keep only
 * that. Full mode continues the reply; Lean mode sends a short prompt. The server judges the output and
 * either splices it in or leaves the reply exactly as it was; this only starts the job and shows how it ended.
 */
export async function startFixupFlow({ host, settings, message, kase, confirm, refresh = noop, pollMs = 1500 }) {
    const mode = settings.fixupMode === "lean" ? "lean" : "full";
    const ok = await confirm("Write the missing ledger part?",
        `${kase === "missing" ? "This reply has no ledger comment; one will be written." : "This reply's ledger comment has no Thoughts; they will be added."} The prose is never changed, and nothing is kept unless the answer is usable. ${mode === "lean" ? "Lean: short prompt" : "Full: normal prompt"}`);
    if (!ok) return;
    refresh(true);
    try {
        const fixup = { kase, mode };
        const jobId = mode === "lean"
            ? await host.startJob("raw_then_action", { message_id: message.id, prompt_action: "lean_prompt", accept_action: "accept_fixup", fixup })
            : await host.startJob("continue_then_action", { message_id: message.id, accept_action: "accept_fixup", fixup });
        let job = await host.getJob(jobId);
        while (job.status === "running") {
            await sleep(pollMs);
            job = await host.getJob(jobId);
        }
        for (const note of job.notices || []) host.notify(note.kind, note.text, note.title || TITLE, { sticky: note.sticky });
        if (job.status === "failed") {
            host.notify("error", `The ledger fix-up failed: ${job.result?.error || "unknown error"}`, TITLE);
        } else if (job.result?.outcome === "kept_nothing") {
            host.notify("warning", "The reply changed during the ledger fix-up; it was left as it is.", TITLE, { sticky: true });
        } else if (job.result?.outcome === "applied") {
            await host.chat.reload();
        }
    } catch (error) {
        if (error?.code !== "extension_stale_bundle") host.notify("error", `The ledger fix-up could not start: ${error?.message || error}`, TITLE);
    } finally {
        refresh(false);
    }
}

// ── Registration ────────────────────────────────────────────────────────────

export default function register(host) {
    let settings = core.normalizeSettings({});
    let busy = false;
    let disposed = false;
    let offHook = noop;
    let userName = "";
    let learningUser = false;

    const confirm = (title, body) => Promise.resolve(typeof globalThis.confirm === "function" ? globalThis.confirm(`${title}\n\n${body}`) : true);

    const stChat = () => host.chat.messages().map(m => ({
        mes: typeof m.content === "string" ? m.content : "",
        is_user: m.role === "user",
        is_system: false,
        name: "",
        swipe_id: 0,
    }));

    /** Redraw every decorated message: re-registering the hook is what makes the host run them again. */
    function refreshDecorations() {
        if (disposed) return;
        offHook();
        offHook = host.onMessageRendered(decorate);
    }

    // The host does not hand an extension the reader's name; the server knows it. Learned once, quietly.
    function learnUserName() {
        if (userName || learningUser || !host.chat.branchId()) return;
        learningUser = true;
        host.callAction("popup_view", {})
            .then(view => { if (view && view.user_name) { userName = view.user_name; refreshDecorations(); } })
            .catch(noop)
            .finally(() => { learningUser = false; });
    }

    function decorate(el, message) {
        if (!settings.enabled || !String(message.content ?? "").includes(BLOCK_MARK)) { undecorate(el); return noop; }
        learnUserName();
        const theme = THEMES[settings.theme] || THEMES.frankenstein;
        const config = core.engineConfig(settings, userName);
        const messages = host.chat.messages();
        const chat = stChat();
        const index = messages.findIndex(m => m.id === message.id);
        const newest = latestState(chat, chat.length, config)?.index ?? -1;
        const isNewest = index >= 0 && index === newest;
        const fixup = isNewest ? core.fixupCaseFor({ chat, index, settings, busy }) : null;
        theme.decorate(el, { config, mesIndex: index, isNewest, fixup });

        const onClick = event => handleBlockClick(event, {
            rebuild: () => rebuildFlow({ host, message, confirm }),
            fixup: () => {
                const kase = core.fixupCaseFor({ chat: stChat(), index: host.chat.messages().findIndex(m => m.id === message.id), settings, busy });
                if (kase) startFixupFlow({ host, settings, message, kase, confirm, refresh: state => { busy = state; refreshDecorations(); } });
            },
            nextTurn: () => openPanel("dice"),
        });
        el.addEventListener("click", onClick);
        return () => { el.removeEventListener("click", onClick); undecorate(el); };
    }

    async function setSettings(next) {
        settings = core.normalizeSettings(next);
        await host.settings.set(settings);
        refreshDecorations();
    }

    const panelArgs = body => ({ host, body, getSettings: () => settings, setSettings });
    function openPanel(startTab = "rules") {
        host.openPanel({ title: TITLE, render: body => mountLedger({ ...panelArgs(body), startTab }) });
    }

    offHook = host.onMessageRendered(decorate);
    const offFilter = host.streamingFilter(text => (settings.enabled ? hideStreamingComment(text) : text));
    const offMenu = host.addChatMenuItem("Story Ledger", () => openPanel("rules"));
    const offPage = host.settingsPanel(body => mountLedger({ ...panelArgs(body), fixedTab: "settings" }));

    host.settings.get()
        .then(raw => { settings = core.normalizeSettings(raw); refreshDecorations(); })
        .catch(noop);

    return () => {
        disposed = true;
        offHook();
        offFilter();
        offMenu();
        offPage();
    };
}
