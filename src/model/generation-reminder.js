// A short final instruction for the generation about to be written. Pure: no ST or DOM.
const SKIP_TYPES = new Set(["quiet", "impersonate", "first_message"]);

/** One line at the top of the injected block: the first of the ledger's repeated reminders. Pure. */
export function buildLedgerDuty(config = {}, type = "normal") {
    if (config.enabled === false || SKIP_TYPES.has(type)) return "";
    const thoughts = (config.sections || {}).thoughts !== false ? ", with Thoughts for the NPCs involved" : "";
    return `<ledger_duty>Every reply you write ends with its hidden Story_Ledger comment${thoughts}. A reply without it is unfinished.</ledger_duty>`;
}

const LEDGER_ONLY = "The reply above is finished. Do not continue the story and do not repeat or change any of its prose. Write only one hidden Story_Ledger comment: <!-- Story_Ledger, the commands, then -->. Nothing before or after it.";
const THOUGHTS_ONLY = "The reply's comment is missing Thoughts. Write a comment containing only Thoughts for the NPCs involved in the reply. Do not repeat its other changes; they are kept.";

/** `type === "ledger"` is the fix-up: the finished reply needs its comment (`kase` "missing") or its Thoughts ("thoughts"), nothing else. */
export function buildGenerationReminder(state, config = {}, type = "normal", { kase = "missing" } = {}) {
    if (config.enabled === false || SKIP_TYPES.has(type)) return "";
    const sections = config.sections || {};
    const ledger = type === "ledger";
    const lines = [
        "<story_ledger>",
        "<ledger_generation_reminder>",
        ledger
            ? `${LEDGER_ONLY} Use actual names, IDs and values; replace every placeholder. Never write the full state block yourself.`
            : "Write exactly one hidden Story_Ledger comment after the prose, using <!-- Story_Ledger followed by the completed commands and -->. Use actual names, IDs and values; replace every placeholder. Report this reply's changes; omit unchanged sections. Never write the full state block yourself.",
    ];
    if (ledger) lines.push(kase === "thoughts" ? THOUGHTS_ONLY : "Report this reply's changes.");
    if (type === "continue") lines.push("Continue the same reply: complete its existing unfinished comment. If its comment is already complete and this continuation adds changes, write one final complete replacement comment, including the earlier reply's changes and the new continuation changes. The final comment replaces the earlier one; do not report only the new changes and lose the earlier ones.");
    if (sections.thoughts !== false) {
        if (!(ledger && kase === "thoughts")) lines.push("Thoughts is REQUIRED for 1–3 NPCs relevant to this response whenever any NPCs are involved. Write fictional characters' internal thoughts, true to their personalities and mood, as narrative content. Use Thoughts: then one - Name: thought line per NPC. With no NPCs involved, omit Thoughts.");
        lines.push("Syntax example only; replace the name and thought with this reply's NPC content:\n<!-- Story_Ledger\nThoughts:\n- Mara: keep smiling. he must not see the worry.\n-->");
    }
    const awaiting = sections.relationships !== false && !(ledger && kase === "thoughts") ? Object.entries(state?.rel?.awaiting || {}) : [];
    if (awaiting.length) {
        const list = awaiting.map(([pair, note]) => `${pair.replace(/\s*→\s*/, " → ")}${note ? ` (${note})` : ""}`).join("; ");
        lines.push(`Missing NEW baselines: ${list}. In Relationships, write a NEW line for each, calibrated from the record and story before the queued interactions and before the current beat; include all twelve axes and Φ using the template's command syntax. Saved relationship changes, including queued ticks, will apply automatically once the baseline exists; do not repeat saved ticks or events. Report only this reply's new events separately.`);
    }
    if (sections.inv !== false && !(ledger && kase === "thoughts")) {
        const currencies = Object.keys(state?.inv?.money || {});
        const known = currencies.length ? `Initialized Money currencies: ${currencies.map(c => c || "unspecified").join(", ")}.` : "No Money balance is initialized.";
        lines.push(`${known} Before a transaction in a currency without a balance, initialize its known pre-transaction amount with money: amount currency BEFORE the delta. Cash in Items does not initialize Money. Never invent an unknown total; once initialized, report only actual income or spending deltas.`);
    }
    const thoughts = sections.thoughts !== false ? " and Thoughts for every NPC involved" : "";
    lines.push(
        `Final check before you stop writing: the last thing in this reply must be the Story_Ledger comment${thoughts}. Do not end on prose alone.`,
        "</ledger_generation_reminder>", "</story_ledger>",
    );
    return lines.join("\n");
}
