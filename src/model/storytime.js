// ──────────────────────────────────────────────────────────────────────────────
// Story time as numbers, for Chekhov time locks: { day, minutes since midnight }.
// Read from the free-text Now line or a header; null when it holds no clock time.
// Pure.
// ──────────────────────────────────────────────────────────────────────────────

const dayOf = text => { const m = String(text || "").match(/\bDay\s+(\d+)\b/i); return m ? Number(m[1]) : null; };

function minutesOf(text) {
    const t = String(text || "");
    let m = t.match(/\b(\d{1,2}):(\d{2})\s*([ap])\.?\s*m\.?\b/i);
    if (m) return ((Number(m[1]) % 12) + (m[3].toLowerCase() === "p" ? 12 : 0)) * 60 + Number(m[2]);
    m = t.match(/\b(\d{1,2}):(\d{2})\b/);
    if (m && Number(m[1]) < 24 && Number(m[2]) < 60) return Number(m[1]) * 60 + Number(m[2]);
    m = t.match(/\b(\d{1,2})\s*([ap])\.?\s*m\.?\b/i);
    if (m) return ((Number(m[1]) % 12) + (m[2].toLowerCase() === "p" ? 12 : 0)) * 60;
    return null;
}

/** { day: number|null, minutes } from text like "Day 3 — Tuesday, 22:05", or null without a clock time. */
export function parseStoryTime(text) {
    const minutes = minutesOf(text);
    return minutes === null ? null : { day: dayOf(text), minutes };
}

/** A lock from "18:00", "6 pm" or "Day 4 18:00". Without a day: today if still ahead, else tomorrow. */
export function lockTime(spec, now) {
    const minutes = minutesOf(spec);
    if (minutes === null) return null;
    const day = dayOf(spec);
    if (day !== null) return { day, minutes };
    if (!now || now.day === null || now.day === undefined) return { day: null, minutes };
    return { day: minutes > now.minutes ? now.day : now.day + 1, minutes };
}

/** True when `now` is at or past `at`; when either has no day, only the clock is compared. */
export function isAtOrPast(now, at) {
    if (!now || !at) return false;
    if (now.day === null || now.day === undefined || at.day === null || at.day === undefined) return now.minutes >= at.minutes;
    return now.day > at.day || (now.day === at.day && now.minutes >= at.minutes);
}
