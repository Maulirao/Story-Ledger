// Records what index.js produces for the scenarios in st-scenarios.mjs. Run ONCE, on the
// pre-refactor index.js:  node tests/support/record-host-goldens.mjs
// The result is committed; host-core.test.mjs fails if the extracted core drifts from it.
import { writeFileSync, mkdirSync } from "node:fs";
import { harness, playSixTurns, DICE_LOCKS, COMMENTS, PROSE, FF_FULL, fixRandom } from "./st-scenarios.mjs";

fixRandom();

const out = {};

// 1. six turns: injections, written blocks, notices
{
    const h = await harness("golden-six");
    out.sixTurns = await playSixTurns(h);
    const chatAfter = h.context.chat;

    // 2. the three generation types on the finished chat (dice locked)
    out.byType = {};
    for (const type of ["normal", "continue", "swipe"]) {
        h.prompts.clear();
        h.lock();
        h.context.chat = JSON.parse(JSON.stringify(chatAfter));
        await h.interceptor([], 1000, null, type);
        out.byType[type] = { prompt: h.prompts.get("story_ledger"), reminder: h.prompts.get("story_ledger_reminder"), fudges: JSON.parse(JSON.stringify(h.chatMetadata.storyLedger.fudges)) };
    }

    // 3. macro placement
    h.context.extensionSettings.storyLedger.placement = "macro";
    h.prompts.clear();
    h.lock();
    h.context.chat = JSON.parse(JSON.stringify(chatAfter));
    await h.interceptor([], 1000, null, "normal");
    out.macro = { prompt: h.prompts.get("story_ledger"), reminder: h.prompts.get("story_ledger_reminder"), macro: h.macros.story_ledger() };
    h.context.extensionSettings.storyLedger.placement = "auto";

    // 4. fudge lifecycle across two turns
    h.reset();
    h.context.chat = JSON.parse(JSON.stringify(chatAfter)).slice(0, 5);
    h.lock();
    await h.interceptor([], 1000, null, "normal");
    const first = JSON.parse(JSON.stringify(h.chatMetadata.storyLedger.fudges));
    const firstPrompt = h.prompts.get("story_ledger")[0];
    h.context.chat = JSON.parse(JSON.stringify(chatAfter));
    await h.interceptor([], 1000, null, "normal");
    out.fudgeLifecycle = { first, second: h.chatMetadata.storyLedger.fudges, firstPrompt, secondPrompt: h.prompts.get("story_ledger")[0] };

    // 5. a continue keeps the dice its block already shows
    h.reset();
    h.context.chat = JSON.parse(JSON.stringify(chatAfter));
    await h.interceptor([], 1000, null, "continue");
    out.continueDice = { prompt: h.prompts.get("story_ledger")[0], fudges: h.chatMetadata.storyLedger?.fudges ?? null };
    h.restore();
}

// 6. notices: no comment, a refused line, a day going backwards
{
    const h = await harness("golden-notices");
    out.notices = {};
    const run = async (name, mes, prior = []) => {
        h.reset();
        h.context.chat = [...prior, { is_user: true, name: "Jan", mes: "Go on." }];
        h.lock();
        await h.interceptor([], 1000, null, "normal");
        h.context.chat.push({ is_user: false, name: "Mara", mes, swipes: [mes], swipe_id: 0 });
        await h.context.eventSource.emit("message_received", h.context.chat.length - 1, "normal");
        out.notices[name] = { toasts: [...h.toasts], mes: h.context.chat[h.context.chat.length - 1].mes };
    };
    await run("noComment", "Only prose here.");
    await run("unreadableLine", "Prose.\n<!-- Story_Ledger\nNow: Day 1 — Monday, 09:00 | the kitchen\nPresent: Mara\nWorld:\n- gibberish that no section reads\nNonsense Heading:\n- x\n-->");
    await run("proposal", `Prose.\n${COMMENTS[2]}`);
    out.notices.dayBackwards = await (async () => {
        const g = await harness("golden-back");
        g.reset();
        g.context.chat = [{ is_user: true, name: "Jan", mes: "a" }];
        g.lock();
        await g.interceptor([], 1000, null, "normal");
        g.context.chat.push({ is_user: false, name: "Mara", mes: `P.\n${COMMENTS[2]}`, swipes: [], swipe_id: 0 });
        await g.context.eventSource.emit("message_received", 1, "normal");
        g.context.chat.push({ is_user: true, name: "Jan", mes: "b" });
        await g.interceptor([], 1000, null, "normal");
        g.context.chat.push({ is_user: false, name: "Mara", mes: "P.\n<!-- Story_Ledger\nNow: Day 1 — Monday, 09:00 | the kitchen\nPresent: Mara\n-->", swipes: [], swipe_id: 0 });
        g.toasts.length = 0;
        await g.context.eventSource.emit("message_received", 3, "normal");
        const result = { toasts: [...g.toasts], mes: g.context.chat[3].mes };
        g.restore();
        return result;
    })();
    h.restore();
}

// 7. handover from another preset: the injection, the saved rules and the notice
{
    const h = await harness("golden-handover");
    h.reset();
    h.context.chat = [
        { is_user: true, name: "Jan", mes: "Hello." },
        { is_user: false, name: "Mara", mes: FF_FULL, swipes: [FF_FULL], swipe_id: 0 },
        { is_user: true, name: "Jan", mes: "And then?" },
    ];
    h.lock();
    await h.interceptor([], 1000, null, "normal");
    await new Promise(resolve => setTimeout(resolve, 20));
    out.handover = { prompt: h.prompts.get("story_ledger"), toasts: [...h.toasts], saved: JSON.parse(JSON.stringify(h.chatMetadata.storyLedger ?? null)) };
    h.restore();
}

mkdirSync(new URL("../fixtures/", import.meta.url), { recursive: true });
writeFileSync(new URL("../fixtures/host-core-goldens.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log("recorded", Object.keys(out).join(", "));
void DICE_LOCKS; void PROSE;
