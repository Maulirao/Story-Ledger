// ──────────────────────────────────────────────────────────────────────────────
// Layout decisions shared by the display themes, kept pure so they can be tested
// without a DOM: Sola's HUD chips and Megumin's tab groups.
// ──────────────────────────────────────────────────────────────────────────────

const key = t => String(t).replace(/[^A-Za-z ]/g, " ").replace(/\s+/g, " ").trim().toUpperCase();

/** Sola's HUD strip: Now · Present · Fate (tier + source); empty values are left out. */
export function hudChips({ now = "", present = "", tier = "", source = "" } = {}) {
    const out = [];
    if (now) out.push({ label: "Now", value: now, kind: "now" });
    if (present) out.push({ label: "Present", value: present, kind: "present" });
    if (tier) out.push({ label: "Fate", value: source ? `${tier} + ${source}` : tier, kind: tier.toLowerCase() });
    return out;
}

const TABS = [
    ["Scene", k => /^SCENE( CAST)?$/.test(k)],
    ["People", k => /AGENDAS|LOCATIONS|FACTIONS/.test(k)],
    ["Relationships", k => /RELATIONSHIPS/.test(k)],
    ["Story", k => /QUESTS|CHEKHOV|^LAST$|THOUGHTS/.test(k)],
    ["Fate", k => /FATE|WORLD|DND|ARROW|PHYSICS/.test(k)],
];

/** Megumin's tabs: every section title in exactly one tab, tabs in a fixed order, empty tabs left out. */
export function sectionGroups(titles) {
    const groups = [...TABS.map(([tab]) => ({ tab, titles: [] })), { tab: "Notes", titles: [] }];
    for (const t of titles) {
        const k = key(t);
        const ix = TABS.findIndex(([, test]) => test(k));
        groups[ix < 0 ? groups.length - 1 : ix].titles.push(t);
    }
    return groups.filter(g => g.titles.length);
}
