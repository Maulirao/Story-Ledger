// ──────────────────────────────────────────────────────────────────────────────
// 🎲 checks — skill checks resolved with dice the extension rolled for this turn.
// Two styles: DnD (RF/FF — locked DC, delta bands) and Wind's Arrow (Sola — d20 ±
// context: Drift / Grazing Shot / Bullseye). Shown in this reply's block only. Pure.
// ──────────────────────────────────────────────────────────────────────────────

import { esc } from "../text.js";
import { commandTemplate } from "../commands.js";
import { parseCheckLine, verifyCheck } from "../check-line.js";
import { DEFAULT_SECTION_CONFIG } from "../config.js";

const arrow = ctx => ctx && ctx.checkStyle === "arrow";
const signed = n => (n < 0 ? `-${-n}` : `+${n}`);
const capsOf = ctx => ctx?.config?.sectionConfig?.titles || DEFAULT_SECTION_CONFIG.titles;

// the "·" inside a check is the command's own field separator
const COMMANDS = [
    {
        id: "checks.check",
        form: ctx => (arrow(ctx) ? "Actor, gamble · d20 n ±m · Trajectory · the price" : "Actor, action · category · DC n · d20 n + Title ±n … = ±sum · total t · Outcome"),
        example: ctx => (arrow(ctx) ? "Mara, leaps the gap · d20 11 +1 · Grazing Shot · she drops her lantern" : "Jan, makes Emilia laugh · social · DC 8 · d20 11 + Got Your Nose +1 + Mon Ancre +2 + Love of Her Life +2 = +5 → +4 (soft cap) · total 15 · success"),
        keywords: [],
    },
];

const dndRules = ({ softCap, hardCap, situationalMax }) => [
    "Checks (DnD): only a skilled action that can actually fail rolls; trivial tasks auto-pass.",
    "Lock the DC first, from the task's difficulty and {{user}}'s proficiencies (Easy 1–5, Moderate 5–10, Hard 10–15, Impossible 15–20); titles and conditions go on the roll, by name, never into the DC.",
    "Every check names its category: physical, social or mental.",
    "On {{user}}'s roll, name every title and condition whose effect applies in that category, each with its number: `+ Mon Ancre +2`. Penalties always count, in full.",
    `Positive title and condition bonuses on one roll are capped: up to ${signed(softCap)} counts in full, half of anything beyond (rounded down), never more than ${signed(hardCap)}; naming more titles past the cap adds nothing. Write \`= ±sum\` for the plain sum of every number, then \`→ ±capped (soft cap)\` (or hard cap) only when the cap changes it.`,
    `Help or tools that are not titles go in at most one \`situational ±n (why)\`, at most ±${situationalMax}, not capped.`,
    "Delta = total − DC: Nat 20 or +8 crit success · 0 to +7 success · −1 to −3 near miss · −4 to −7 failure · Nat 1 or −8 crit failure. Dice are law; never fudge. Never name DCs, dice or stats in prose.",
    "Under `Check:`, one line per roll used: `Actor, action · category · DC n · d20 n + Title ±n … [+ situational ±n (why)] = ±sum [→ ±capped (soft cap)] · total t · Outcome`. Use the dice in order, one per line. With no bonus: `d20 14 · total 14`. The ledger checks the die, every name and number, the cap, the total and the outcome, and adds its own line when they disagree.",
].join(" ");

export default {
    key: "checks",
    title: ctx => (arrow(ctx) ? "🏹 WIND'S ARROW" : "🎲 DND TASK SIM"),
    match: /^(DND TASK SIM|WIND S ARROW)$/,
    change: "Check",
    aliases: ["Checks"],
    carried: false,
    empty: () => ({ rolls: [], lines: [] }),
    isEmpty: v => !v.rolls.length && !v.lines.length,
    render: value => [
        ...(value.rolls.length ? [`- <b>Rolls:</b> ${value.rolls.join(", ")}${value.fudged ? " (fudged)" : ""}`] : []),
        ...value.lines.map(l => `- ${esc(l)}`),
    ],
    parse: () => ({ value: { rolls: [], lines: [] }, errors: [] }),
    apply(state, lines, ctx) {
        state.perTurn.checks.rolls = Array.isArray(ctx.rolls) ? [...ctx.rolls] : [];
        state.perTurn.checks.fudged = ctx.fudgedDice.includes("checks");
        const out = state.perTurn.checks.lines;
        let n = 0;
        for (const l of lines) {
            const line = String(l).trim();
            if (!line) continue;
            const parsed = arrow(ctx) ? null : parseCheckLine(line);
            // a read DnD line shows the cap arrow as →; Wind's Arrow and unread lines stay as written
            out.push(parsed ? line.replace(/->/g, "→") : line);
            if (!parsed) continue;
            const r = verifyCheck(parsed, { die: state.perTurn.checks.rolls[n++], inv: state.inv, user: ctx.userName, caps: capsOf(ctx) });
            if (r.ok) continue;
            out.push(r.ledgerLine);
            ctx.warnings.push({ section: "Check", text: `${parsed.actor}: ${r.problems.join("; ")}` });
        }
        return [];
    },
    facts(state, ctx) {
        const r = Array.isArray(ctx.rolls) ? ctx.rolls : [];
        if (!r.length) return [];
        return [arrow(ctx)
            ? `Wind Rolls: ${r.join(", ")} — one per kinetic gamble, in order, ±1–3 for context; 1–7 Wind Drift, 8–14 Grazing Shot, 15–20 Bullseye.`
            : `Dice for skill checks: d20s ${r.join(", ")} — use them in order, one per check; lock the DC first.`];
    },
    prompt: () => "",
    rules: ctx => (arrow(ctx)
        ? "Checks (Wind's Arrow): only uncertain, high-stakes kinetic gambles roll; mundane or conversational actions auto-pass. Commit to the outcome before writing: Wind Drift fails or is intercepted with a real setback, Grazing Shot succeeds at an immediate physical or tactical cost, Bullseye is clean. Under `Check:`, one line per roll used: `Actor, gamble · d20 n ±m · Trajectory · the price`."
        : dndRules(capsOf(ctx))),
    commands: COMMANDS,
    template: ctx => commandTemplate("Check", COMMANDS, ctx),
};
