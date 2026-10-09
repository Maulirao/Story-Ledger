// The lean fix-up prompt: the message list sent in place of the whole chat prompt.
import test from "node:test";
import assert from "node:assert/strict";
import { buildLeanPrompt, LEAN_WRITER_INSTRUCTION } from "../src/model/lean-prompt.js";

const input = (more = {}) => ({
    mainPrompt: "MAIN {{char}}",
    characters: [{ name: "Mara", description: "A baker.", personality: "Warm." }],
    personaName: "Jan",
    summary: "They met at the mill.",
    statePrompt: "STATE",
    rules: "RULES",
    template: "TEMPLATE",
    turnFacts: "FACTS",
    history: [
        { role: "user", name: "Jan", text: "one" },
        { role: "assistant", name: "Mara", text: "two" },
        { role: "user", name: "Jan", text: "three" },
    ],
    historyCount: 2,
    reply: { name: "Mara", text: "The reply." },
    reminder: "REMINDER",
    ...more,
});

test("the writer instruction is the exact fixed text", () => {
    assert.equal(LEAN_WRITER_INSTRUCTION, "You write the hidden Story_Ledger comment for the last roleplay reply. The reply is finished. Output only the comment, nothing before or after it.");
});

test("order: system, characters, summary, ledger, history, reply, reminder", () => {
    const m = buildLeanPrompt(input());
    assert.deepEqual(m.map(x => x.role), ["system", "system", "system", "system", "assistant", "user", "assistant", "user"]);
    assert.equal(m[0].content, `MAIN {{char}}\n\n${LEAN_WRITER_INSTRUCTION}`);
    assert.ok(m[1].content.startsWith("<characters>") && m[1].content.endsWith("</characters>"));
    assert.ok(m[2].content.startsWith("<summary>") && m[2].content.includes("They met at the mill.") && m[2].content.endsWith("</summary>"));
    const ledger = m[3].content;
    assert.ok(ledger.startsWith("<story_ledger>") && ledger.endsWith("</story_ledger>"));
    const at = ["STATE", "RULES", "TEMPLATE", "FACTS"].map(s => ledger.indexOf(s));
    assert.ok(at.every(i => i > 0) && at.every((v, i) => i === 0 || v > at[i - 1]), String(at));
    assert.deepEqual(m.slice(4).map(x => x.content), ["Mara: two", "Jan: three", "Mara: The reply.", "REMINDER"]);
    assert.deepEqual(m.slice(4).map(x => x.role), ["assistant", "user", "assistant", "user"]);
});

test("empty main prompt sends only the writer instruction", () => {
    assert.equal(buildLeanPrompt(input({ mainPrompt: "" }))[0].content, LEAN_WRITER_INSTRUCTION);
});

test("empty summary, empty characters and empty fields are left out", () => {
    const tags = m => m.map(x => x.content.match(/^<(\w+)>/)?.[1]).filter(Boolean);
    assert.ok(!tags(buildLeanPrompt(input({ summary: "" }))).includes("summary"));
    const onlyDescription = buildLeanPrompt(input({ characters: [{ name: "Mara", description: "A baker.", personality: "" }] }))[1].content;
    assert.ok(onlyDescription.includes("A baker.") && !onlyDescription.includes("Personality"));
    const nothing = buildLeanPrompt(input({ characters: [{ name: "Mara", description: "", personality: "" }], personaName: "" }));
    assert.ok(!tags(nothing).includes("characters"));
});

test("group: every member is listed", () => {
    const characters = [{ name: "Mara", description: "A baker." }, { name: "Odo", description: "A miller." }];
    const text = buildLeanPrompt(input({ characters }))[1].content;
    assert.ok(text.includes("Mara") && text.includes("A baker.") && text.includes("Odo") && text.includes("A miller."));
    assert.ok(text.includes("User persona: Jan"));
});

test("historyCount is clamped", () => {
    const history = Array.from({ length: 30 }, (_, i) => ({ role: "user", name: "Jan", text: `m${i}` }));
    const count = n => buildLeanPrompt(input({ history, historyCount: n })).length - 6;   // 4 system + reply + reminder
    assert.equal(count(-1), 0);
    assert.equal(count(0), 0);
    assert.equal(count(99), 20);
    assert.equal(count(5), 5);
});

test("names prefix history and reply", () => {
    const m = buildLeanPrompt(input({ history: [{ role: "user", name: "Jan", text: "hi" }], historyCount: 1 }));
    assert.deepEqual(m[4], { role: "user", content: "Jan: hi" });
    assert.deepEqual(m[5], { role: "assistant", content: "Mara: The reply." });
});
