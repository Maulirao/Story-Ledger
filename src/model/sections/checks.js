// ──────────────────────────────────────────────────────────────────────────────
// 🎲 checks — skill checks resolved with dice the extension rolled for this turn.
// Two styles: DnD (RF/FF — locked DC, delta bands) and Wind's Arrow (Sola — d20 ±
// context: Drift / Grazing Shot / Bullseye). Shown in this reply's block only. Pure.
// ──────────────────────────────────────────────────────────────────────────────

import { esc } from "../text.js";

const arrow = ctx => ctx && ctx.checkStyle === "arrow";

export default {
    key: "checks",
    title: ctx => (arrow(ctx) ? "🏹 WIND'S ARROW" : "🎲 DND TASK SIM"),
    match: /^(DND TASK SIM|WIND S ARROW)$/,
    change: "Check",
    carried: false,
    empty: () => ({ rolls: [], lines: [] }),
    isEmpty: v => !v.rolls.length && !v.lines.length,
    render: value => [
        ...(value.rolls.length ? [`- <b>Rolls:</b> ${value.rolls.join(", ")}`] : []),
        ...value.lines.map(l => `- ${esc(l)}`),
    ],
    parse: () => ({ value: { rolls: [], lines: [] }, errors: [] }),
    apply(state, lines, ctx) {
        state.perTurn.checks.rolls = Array.isArray(ctx.rolls) ? [...ctx.rolls] : [];
        for (const l of lines) if (String(l).trim()) state.perTurn.checks.lines.push(String(l).trim());
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
        ? "Checks (Wind's Arrow): only uncertain, high-stakes kinetic gambles roll; mundane or conversational actions auto-pass. Commit to the outcome before writing: Wind Drift fails or is intercepted with a real setback, Grazing Shot succeeds at an immediate physical or tactical cost, Bullseye is clean. Report each as `Check: Actor, gamble · d20 n ±m · Trajectory · the price`."
        : "Checks (DnD): only a skilled action that can actually fail rolls; trivial tasks auto-pass. Lock the DC first from proficiency, items and titles (Easy 1–5, Moderate 5–10, Hard 10–15, Impossible 15–20), then Delta = d20 + mods − DC: Nat 20 or +8 crit success · 0 to +7 success · −1 to −3 near miss · −4 to −7 failure · Nat 1 or −8 crit failure. Dice are law; never fudge. Never name DCs, dice or stats in prose. Report each as `Check: Actor, action · DC n · d20 n +m · Outcome`."),
    template: () => ["Check:", "- [Actor, action · DC n · d20 n +m · Outcome — one per roll used]"],
};
