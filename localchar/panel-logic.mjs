// The panel's form reading, kept free of the DOM: panel.mjs lifts plain values out of the controls and
// these turn them into what the actions take. (index.js reads the same controls through jQuery.)

const validDie = value => Number.isInteger(Number(value)) && String(value).trim() !== "" && Number(value) >= 1 && Number(value) <= 20;

/**
 * The Next-turn tab's controls -> a fudge record (the shape ST's readFudgePanel produced).
 * `dice` is { "fate.a": { locked, value }, ..., world }, `checks` { locked, values: [3] }.
 */
export function fudgeFromControls({ dice = {}, checks = { locked: false, values: [] }, tier = "", source = "", calm = false, fire = "" } = {}) {
    const fudge = { appliedTo: null };
    const locks = {};
    for (const key of ["fate.a", "fate.b", "fate.c", "world"]) {
        const control = dice[key];
        if (control && control.locked && validDie(control.value)) locks[key] = Number(control.value);
    }
    if (checks && checks.locked && Array.isArray(checks.values) && checks.values.length === 3 && checks.values.every(validDie)) {
        locks.checks = checks.values.map(Number);
    }
    if (Object.keys(locks).length) fudge.dice = locks;
    if (tier) fudge.tier = tier;
    if (source) fudge.source = source;
    if (calm) fudge.calm = true;
    if (fire) fudge.fire = fire;
    return fudge;
}

/**
 * The Settings tab's engine-number inputs -> the `form` the save_config action takes. Every list is
 * [[key, value], ...] straight off the data- attributes, values still strings (the action converts and
 * sanitizes).
 */
export function configFormFromControls({ cfg = [], gate = [], phi = [], axes = [], decay = [], skip = undefined, chekhov = [], firing = "model", fate = [] } = {}) {
    const pairs = list => Object.fromEntries(list);
    const nested = {};
    for (const [key, field, value] of axes) (nested[key] ||= {})[field] = value;
    const form = {
        cfg: pairs(cfg), gate: pairs(gate), phi: pairs(phi), axes: nested,
        decay: pairs(decay), chekhov: { ...pairs(chekhov), firing }, fate: pairs(fate),
    };
    if (skip !== undefined) form.skip = skip;
    return form;
}

/** A control's value as the settings store it: checkboxes are booleans, number inputs numbers. */
export function settingFromControl({ type, checked, value }) {
    return type === "checkbox" ? Boolean(checked) : type === "number" ? Number(value) : value;
}
