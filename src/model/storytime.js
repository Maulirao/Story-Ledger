// ──────────────────────────────────────────────────────────────────────────────
// Story time as numbers, for Chekhov time locks and agendas: { day, minutes since midnight },
// the minutes between two Now lines, and lengths such as "2h" or "3 days".
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

/**
 * Story minutes from one Now line to the next, never negative; null when either has no
 * time of day. With a day number on both, days count too. Otherwise only the clocks are
 * compared and an earlier clock means midnight passed once — unless that would make 18
 * hours or more, which reads as a small correction of the clock and counts as no time.
 */
export function elapsedMinutes(prevNow, now) {
    const a = parseStoryTime(prevNow), b = parseStoryTime(now);
    if (!a || !b) return null;
    if (a.day !== null && b.day !== null) return Math.max(0, (b.day - a.day) * 1440 + b.minutes - a.minutes);
    if (b.minutes >= a.minutes) return b.minutes - a.minutes;
    const wrapped = 1440 + b.minutes - a.minutes;
    return wrapped >= 18 * 60 ? 0 : wrapped;
}

const UNIT_MINUTES = {
    w: 10080, wk: 10080, wks: 10080, week: 10080, weeks: 10080,
    d: 1440, day: 1440, days: 1440,
    h: 60, hr: 60, hrs: 60, hour: 60, hours: 60,
    m: 1, min: 1, mins: 1, minute: 1, minutes: 1,
};
const DURATION_PART = /\s*(\d+(?:\.\d+)?)\s*([a-z]+)?/iy;

/** Whole minutes from a length like "2h", "1h 30m", "1h30", "3 days"; null when unreadable or not above zero. */
export function parseDuration(text) {
    const t = String(text ?? "").trim();
    let total = 0, at = 0, parts = 0, last = null;
    while (at < t.length) {
        DURATION_PART.lastIndex = at;
        const m = DURATION_PART.exec(t);
        if (!m) return null;
        // a bare number straight after an hours part is its minutes ("1h30")
        const unit = m[2] ? UNIT_MINUTES[m[2].toLowerCase()] : (last === 60 ? 1 : undefined);
        if (!unit) return null;
        total += Number(m[1]) * unit;
        last = unit; at = DURATION_PART.lastIndex; parts++;
    }
    const minutes = Math.round(total);
    return parts && minutes > 0 ? minutes : null;
}

/** A length written short: "20m", "1h", "1h30m", "2d", "2d4h", "1d5m"; "0m" for zero. */
export function formatDuration(minutes) {
    const n = Math.max(0, Math.round(Number(minutes) || 0));
    const d = Math.floor(n / 1440), h = Math.floor((n % 1440) / 60), m = n % 60;
    return `${d ? `${d}d` : ""}${h ? `${h}h` : ""}${m ? `${m}m` : ""}` || "0m";
}
