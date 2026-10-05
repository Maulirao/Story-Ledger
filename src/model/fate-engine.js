// Pure Fate & Routine engine. It derives one turn outcome from the previous state,
// the three dice, any reader fudges, and the configured ladders.
import { DEFAULT_SECTION_CONFIG } from "./config.js";
import { eligible, hotCount } from "./sections/chekhov.js";

const REACH = {
    ELSEWHERE: [1, 1, 2],
    REGIONAL: [1, 2, 3],
    LOCAL: [2, 3, 3],
};

const idNumber = id => Number(String(id || "").match(/\d+$/)?.[0] || Number.MAX_SAFE_INTEGER);
const byLowestId = (a, b) => idNumber(a.id) - idNumber(b.id);
const bulletsOf = state => (state && state.chekhov && Array.isArray(state.chekhov.bullets) ? state.chekhov.bullets : []);
const worldsOf = fate => (Array.isArray(fate && fate.world) ? fate.world : []);
const deferredOf = fate => (Array.isArray(fate && fate.deferred) ? fate.deferred : []);
const normalizeChoice = (value, allowed) => {
    const choice = typeof value === "string" ? value.trim().toUpperCase() : "";
    return allowed.includes(choice) ? choice : null;
};

function eligibleHotBullet(state, cfg) {
    const eligibilityConfig = cfg.chekhov || (cfg.eligibleAge === undefined ? DEFAULT_SECTION_CONFIG.chekhov : cfg);
    return bulletsOf(state)
        .filter(b => b.hot && eligible(b, state, eligibilityConfig))
        .sort((a, b) => (b.weight || 0) - (a.weight || 0) || (b.age || 0) - (a.age || 0))[0] || null;
}

function tierFor(q, adjusted, cfg) {
    const ladder = [...(cfg.ladder || DEFAULT_SECTION_CONFIG.fate.ladder)].sort((a, b) => a.q - b.q);
    const row = ladder.filter(item => item.q <= q).at(-1) || ladder[0];
    if (!row) return "AMBIENT";
    if (adjusted >= row.major) return "MAJOR";
    if (adjusted >= row.minor) return "MINOR";
    return "AMBIENT";
}

function sourceFor(dice, hp, cfg) {
    if (dice.b <= cfg.trueFloor || hp === 0) return "TRUE";
    const rows = [...(cfg.hpLadder || DEFAULT_SECTION_CONFIG.fate.hpLadder)].sort((a, b) => a.hp - b.hp);
    const row = rows.filter(item => item.hp <= hp).at(-1) || rows[0];
    return row && dice.b >= row.weighted ? "WEIGHTED" : "TRUE";
}

function findWorldEntry(entries, predicate, compare) {
    return entries.filter(predicate).sort(compare)[0] || null;
}

function naturalFire(state, tier, source, cfg, forcedFire, ripeEntry) {
    if (tier !== "MAJOR" || source !== "WEIGHTED") return { source, fire: null, fellBack: false };
    if (forcedFire) return { source, fire: forcedFire.id, fellBack: false };
    if (ripeEntry) return { source, fire: null, fellBack: false };
    const bullet = eligibleHotBullet(state, cfg);
    if (bullet) return { source, fire: bullet.id, fellBack: false };
    return { source: "TRUE", fire: null, fellBack: true };
}

/** Fate's reach table: ELSEWHERE 1/1/2, REGIONAL 1/2/3, LOCAL 2/3/3 for C 1–4 / 5 / 6+. */
export function reachFor(prox, c) {
    const row = REACH[String(prox || "").toUpperCase()];
    if (!row) return undefined;
    return row[c <= 4 ? 0 : c === 5 ? 1 : 2];
}

/** Compute this turn's deterministic Fate outcome. The input objects are never mutated. */
export function computeFate(prev, dice, fudges = null, config = DEFAULT_SECTION_CONFIG.fate) {
    const cfg = config || DEFAULT_SECTION_CONFIG.fate;
    const fate = (prev && prev.fate) || {};
    const rolls = dice || { a: 1, b: 1, c: 1 };
    const d = { a: rolls.a, b: rolls.b, c: rolls.c };
    const deferred = deferredOf(fate);
    const modifiers = cfg.modifiers || DEFAULT_SECTION_CONFIG.fate.modifiers;
    let mod = 0;
    if ((fate.sinceMajor ?? 99) <= 2) mod = modifiers.recentMajor;
    else if (deferred.length >= 3) mod = modifiers.deferred3;
    else if (deferred.length >= 1) mod = modifiers.deferred12;
    else if (prev && prev.scene && prev.scene.public) mod = modifiers.public;

    const adjusted = d.a + mod;
    const q = Number.isFinite(fate.q) ? fate.q : 0;
    let tier = tierFor(q, adjusted, cfg);
    const hp = hotCount(prev || {});
    let source = sourceFor(d, hp, cfg);
    const applied = [];
    const calm = Boolean(fudges && fudges.calm === true);
    if (calm) {
        tier = "AMBIENT";
        source = "TRUE";
        applied.push("calm");
    }
    const forcedTier = normalizeChoice(fudges && fudges.tier, ["AMBIENT", "MINOR", "MAJOR"]);
    if (forcedTier) {
        tier = forcedTier;
        applied.push("tier");
    }
    const forcedSource = normalizeChoice(fudges && fudges.source, ["TRUE", "WEIGHTED"]);
    if (forcedSource) {
        source = forcedSource;
        applied.push("source");
    }

    const worlds = worldsOf(fate);
    const ripeConfig = cfg.ripe || DEFAULT_SECTION_CONFIG.fate.ripe;
    const ripeEntry = tier === "MAJOR"
        ? findWorldEntry(worlds, w => w.prox === "LOCAL" && w.reach >= ripeConfig.reach && w.age >= ripeConfig.age, byLowestId)
        : null;
    const ripe = ripeEntry ? ripeEntry.id : null;

    const bullets = bulletsOf(prev || {});
    const forcedFireText = typeof (fudges && fudges.fire) === "string" ? fudges.fire.trim() : "";
    const forcedFire = /^B\d+$/i.test(forcedFireText)
        ? bullets.find(b => b.id.toLowerCase() === forcedFireText.toLowerCase()) || null
        : null;
    const natural = naturalFire(prev || {}, tier, source, cfg, forcedFire, ripeEntry);
    source = natural.source;
    let fire = natural.fire;
    const fellBack = natural.fellBack;
    if (forcedFire) {
        fire = forcedFire.id;
        applied.push("fire");
    } else if (forcedFireText.toLowerCase() === "none") {
        fire = null;
        applied.push("fire");
    }
    let warm = null;
    if (tier === "AMBIENT" && source === "WEIGHTED") {
        const bullet = eligibleHotBullet(prev || {}, cfg);
        warm = bullet ? bullet.id : null;
    }

    let world = null;
    if (ripeEntry) {
        world = { id: ripeEntry.id, action: "land" };
    } else if (tier === "MINOR") {
        const threshold = cfg.minorWorld || DEFAULT_SECTION_CONFIG.fate.minorWorld;
        const entry = findWorldEntry(worlds, w => w.reach >= threshold.reach && w.age >= threshold.age,
            (a, b) => b.reach - a.reach || b.age - a.age);
        if (entry) world = { id: entry.id, action: "first-effect" };
    } else if (tier === "MAJOR" && !fire) {
        const threshold = cfg.majorWorld || DEFAULT_SECTION_CONFIG.fate.majorWorld;
        const entry = findWorldEntry(worlds, w => w.reach >= threshold.reach && w.age >= threshold.age,
            (a, b) => b.reach - a.reach || b.age - a.age);
        if (entry) world = { id: entry.id, action: "land" };
    }

    let collision = null;
    if (fate.state === "THREAD") {
        if (tier === "MINOR") collision = d.c <= cfg.collision.minorDefer ? "DEFER" : "COMPLICATE";
        else if (tier === "MAJOR") collision = d.c <= cfg.collision.majorComplicate ? "COMPLICATE" : "DISPLACE";
    }
    const mustLandEntry = findWorldEntry(deferred, d => d.times >= 2, byLowestId);
    const mustClose = fate.state === "THREAD" && (fate.ts || 0) >= cfg.pursuitLimit;
    const dangerLifted = tier === "MAJOR" && source === "TRUE" && d.c === cfg.dangerC;
    const news = !calm && tier === "AMBIENT" && d.c <= cfg.newsMax;

    return {
        dice: d,
        mod,
        adjusted,
        tier,
        news,
        source,
        fire,
        warm,
        fellBack,
        world,
        ripe,
        collision,
        mustLand: mustLandEntry ? mustLandEntry.id : null,
        mustClose,
        dangerLifted,
        fudged: applied,
    };
}





