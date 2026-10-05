// ──────────────────────────────────────────────────────────────────────────────
// Story time as numbers, for Chekhov time locks: { day, minutes since midnight }.
// Read from the free-text Now line or a header; null when it holds no clock time.
// Pure.
// ──────────────────────────────────────────────────────────────────────────────

const dayOf = text => { const m = String(text || "").match(/\bDay\s+(\d+)\b/i); return m ? Number(m[1]) : null; };

function minutesOf(text) {
    const t = String(text || "");
    if (/\bnoon\b|\bmidday\b/i.test(t) && !/\d{1,2}:\d{2}/.test(t)) return 12 * 60;
    if (/\bmidnight\b/i.test(t) && !/\d{1,2}:\d{2}/.test(t)) return 0;
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

/**
 * A lock from "18:00", "6 pm", "noon" or "Day 4 18:00". Without a day: today if still
 * ahead, else tomorrow. When the story time has no day number, a time already past
 * today is marked `wait: true` — it first waits for the clock to pass midnight.
 */
export function lockTime(spec, now) {
    const minutes = minutesOf(spec);
    if (minutes === null) return null;
    const day = dayOf(spec);
    if (day !== null) return { day, minutes };
    const tomorrow = /\btomorrow\b/i.test(spec), today = /\btoday\b|\btonight\b/i.test(spec);
    if (!now) return { day: null, minutes };
    // an explicit word wins; otherwise a time not yet passed (or this very minute) is today
    const later = tomorrow || (!today && minutes < now.minutes);
    if (now.day === null || now.day === undefined) return later ? { day: null, minutes, wait: true } : { day: null, minutes };
    return { day: later ? now.day + 1 : now.day, minutes };
}

/** True when `now` is at or past `at`; when either has no day, only the clock is compared. */
export function isAtOrPast(now, at) {
    if (!now || !at) return false;
    const nowDay = now.day !== null && now.day !== undefined, atDay = at.day !== null && at.day !== undefined;
    if (atDay && !nowDay) return false;   // a dated lock cannot be judged from a clock alone
    if (!atDay) return now.minutes >= at.minutes;
    return now.day > at.day || (now.day === at.day && now.minutes >= at.minutes);
}
