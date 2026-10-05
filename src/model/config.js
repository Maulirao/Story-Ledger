// ──────────────────────────────────────────────────────────────────────────────
// Relationship engine settings. Every number from FrankenSIM 3.0's bond tracker is
// here, as the default, so the rules are data the reader can change rather than
// constants buried in code. Pure: no SillyTavern, no DOM.
// ──────────────────────────────────────────────────────────────────────────────

/** The twelve paired axes. `period`/`threshold` drive accumulator → axis conversion. */
export const DEFAULT_AXES = [
    { key: "E",  name: "Eros",      kind: "fond",     mirror: "M",  period: 5,  threshold: 10, meaning: "romantic fondness" },
    { key: "M",  name: "Misos",     kind: "friction", mirror: "E",  period: 5,  threshold: 10, meaning: "romantic friction" },
    { key: "L",  name: "Ludus",     kind: "fond",     mirror: "Er", period: 3,  threshold: 8,  meaning: "playful fondness" },
    { key: "Er", name: "Eris",      kind: "friction", mirror: "L",  period: 3,  threshold: 8,  meaning: "playful friction" },
    { key: "Ph", name: "Philia",    kind: "fond",     mirror: "Ec", period: 5,  threshold: 10, meaning: "friendship fondness" },
    { key: "Ec", name: "Echthros",  kind: "friction", mirror: "Ph", period: 5,  threshold: 10, meaning: "friendship friction" },
    { key: "Pr", name: "Pragma",    kind: "fond",     mirror: "St", period: 7,  threshold: 12, meaning: "practical fondness" },
    { key: "St", name: "Stasis",    kind: "friction", mirror: "Pr", period: 7,  threshold: 12, meaning: "practical friction" },
    { key: "Sg", name: "Storge",    kind: "fond",     mirror: "Ad", period: 11, threshold: 12, meaning: "familial fondness" },
    { key: "Ad", name: "Adiaphora", kind: "friction", mirror: "Sg", period: 11, threshold: 12, meaning: "familial friction" },
    { key: "Ag", name: "Agape",     kind: "fond",     mirror: "Pt", period: 7,  threshold: 10, meaning: "selfless fondness" },
    { key: "Pt", name: "Phthonos",  kind: "friction", mirror: "Ag", period: 7,  threshold: 10, meaning: "giving friction / resentment" },
];

export const DEFAULT_RELATION_CONFIG = {
    axes: DEFAULT_AXES,
    axisMin: 1,            // "NEVER 0"
    axisMax: 20,
    tickCap: 2,            // +2 per accumulator per turn
    directMax: 2,          // DIRECT_SHIFT is +1 or +2
    phi: { min: -20, max: 20, accCap: 30, period: 23, threshold: 12 },
    // MIRROR DECAY: on each period, if the gap between a pair is ≥ lead, the trailing
    // axis loses 1, never below floor = min(floorMax, max(1, ⌈leading / floorDivisor⌉)).
    decay: [
        { pair: ["L", "Er"], period: 6 },
        { pair: ["E", "M"], period: 10 },
        { pair: ["Ph", "Ec"], period: 10 },
        { pair: ["Ag", "Pt"], period: 14 },
        { pair: ["Pr", "St"], period: 14 },
        { pair: ["Sg", "Ad"], period: 22 },
    ],
    decayLead: 5,
    floorDivisor: 4,
    floorMax: 4,
    offstageSkip: [4, 8, 12, 15],   // trailing value at which an offstage pair does not decay
    wallMin: 5,                     // WALL: tied pair, both ≥ this → conversion and decay freeze
    gravityMin: 6,                  // GRAVITY WELL: fondness converts while its mirror ≥ this → mirror acc +1
    romanceGate: { E: 6, L: 6 },    // romantic/sexual initiation allowed when E or L reaches these
    tiers: [
        { min: 1, max: 5, fond: "Fond", friction: "Distant" },
        { min: 6, max: 10, fond: "Affectionate", friction: "Cold" },
        { min: 11, max: 15, fond: "Devoted", friction: "Hostile" },
        { min: 16, max: 20, fond: "Ultimate", friction: "Murderous" },
    ],
};

/** Numbers the state sections use (anything not part of the relationship engine). */
export const DEFAULT_SECTION_CONFIG = {
    lastBeats: 3,   // 🧾 LAST keeps this many newest beats
    chekhov: {
        eligibleAge: 6,     // a bullet may fire from this age
        pruneAge: 12,       // unfired bullets this old are pruned to Fired
        cap: 20,            // at most this many active bullets
        maxLoadsPerTurn: 1, // more loads in one reply are kept but warned about
        firedKeep: 10,      // Fired keeps this many newest; 0 = all
        firing: "fate",     // Fate's pick; "model" keeps the reader-selected timing.
    },
    fate: {
        modifiers: { recentMajor: -3, deferred3: 4, deferred12: 2, public: 2 },
        ladder: [{ q: 0, minor: 16, major: 20 }, { q: 3, minor: 12, major: 19 }, { q: 7, minor: 8, major: 17 }],
        newsMax: 6,
        trueFloor: 3,
        hpLadder: [{ hp: 1, weighted: 14 }, { hp: 3, weighted: 9 }, { hp: 5, weighted: 5 }],
        collision: { minorDefer: 12, majorComplicate: 10 },
        dangerC: 20,
        deferredExpire: 6,
        worldKeep: 5,
        reach1Drop: 15,
        minorWorld: { reach: 2, age: 4 },
        majorWorld: { reach: 3, age: 8 },
        ripe: { reach: 3, age: 12 },
        pursuitLimit: 8,
        residueKeep: 12,
    },
};

/** Deep-merge a reader's saved overrides onto the defaults. Unknown keys are ignored. */
export function resolveConfig(overrides) {
    const base = JSON.parse(JSON.stringify(DEFAULT_RELATION_CONFIG));
    base.sectionConfig = JSON.parse(JSON.stringify(DEFAULT_SECTION_CONFIG));
    const sc = overrides && typeof overrides === "object" ? overrides.sectionConfig : null;
    if (sc && typeof sc === "object") {
        for (const [k, v] of Object.entries(sc)) {
            if (k === "chekhov" && v && typeof v === "object") base.sectionConfig.chekhov = validChekhov(v, base.sectionConfig.chekhov);
            else if (k === "fate" && v && typeof v === "object") base.sectionConfig.fate = mergeKnown(base.sectionConfig.fate, v);
            else if (k in base.sectionConfig && typeof v === typeof base.sectionConfig[k]) base.sectionConfig[k] = v;
        }
    }
    if (!overrides || typeof overrides !== "object") return base;
    for (const [k, v] of Object.entries(overrides)) {
        if (!(k in base)) continue;
        if (k === "sectionConfig") continue;   // merged above, key by key
        if (Array.isArray(base[k])) base[k] = Array.isArray(v) ? JSON.parse(JSON.stringify(v)) : base[k];
        else if (base[k] && typeof base[k] === "object") base[k] = { ...base[k], ...(v || {}) };
        else if (typeof v === typeof base[k]) base[k] = v;
    }
    return base;
}

export const axisByKey = (config, key) => config.axes.find(a => a.key === key);
/** Merge only declared config keys, replacing arrays and recursively merging objects. */
function mergeKnown(defaults, input) {
    const out = JSON.parse(JSON.stringify(defaults));
    for (const [key, value] of Object.entries(input || {})) {
        if (!(key in defaults)) continue;
        const initial = defaults[key];
        if (Array.isArray(initial)) {
            if (Array.isArray(value)) out[key] = JSON.parse(JSON.stringify(value));
        } else if (initial && typeof initial === "object") {
            if (value && typeof value === "object" && !Array.isArray(value)) out[key] = mergeKnown(initial, value);
        } else if (typeof value === typeof initial && (typeof value !== "number" || Number.isFinite(value))) out[key] = value;
    }
    return out;
}

/** Saved Chekhov overrides, allowlisted and validated: anything unknown or out of range keeps the default. */
function validChekhov(v, defaults) {
    const out = { ...defaults };
    const MIN = { eligibleAge: 0, pruneAge: 1, cap: 1, maxLoadsPerTurn: 1, firedKeep: 0 };
    for (const [k, min] of Object.entries(MIN)) {
        const n = v[k];
        if (typeof n === "number" && Number.isInteger(n) && n >= min) out[k] = n;
    }
    if (v.firing === "model" || v.firing === "fate") out.firing = v.firing;
    if (out.pruneAge <= out.eligibleAge) out.pruneAge = defaults.pruneAge > out.eligibleAge ? defaults.pruneAge : out.eligibleAge + 1;
    return out;
}

/**
 * Chekhov numbers from the Settings form: a blank keeps the old value; every number is
 * at least 1 except eligibleAge and firedKeep (0 = keep all), and prune age stays above
 * eligible age so a setup can fire before it is pruned.
 */
export function sanitizeChekhov(input, prev) {
    const num = (k, min) => {
        const raw = input[k];
        if (raw === undefined || raw === null || String(raw).trim() === "" || !Number.isFinite(Number(raw))) return prev[k];
        return Math.max(min, Math.round(Number(raw)));
    };
    const out = {
        eligibleAge: num("eligibleAge", 0),
        pruneAge: num("pruneAge", 1),
        cap: num("cap", 1),
        maxLoadsPerTurn: num("maxLoadsPerTurn", 1),
        firedKeep: num("firedKeep", 0),
        firing: input.firing === "fate" ? "fate" : "model",
    };
    if (out.pruneAge <= out.eligibleAge) out.pruneAge = out.eligibleAge + 1;
    return out;
}
