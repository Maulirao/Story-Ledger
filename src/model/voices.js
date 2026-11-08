// ──────────────────────────────────────────────────────────────────────────────
// Dialogue voices: reading <Name>"…" tags from a reply's raw text, the colour table
// (CSS named colours with Sola's palette on top), and matching a tag to a voice in the
// chat's list. Pure: no SillyTavern, no DOM.
// ──────────────────────────────────────────────────────────────────────────────

/** The reserved telepathy voice, and the fill its half of a letter gets. */
export const MIND = "mind";
export const MIND_FILL = "#111111";

export const TONES = ["whisper", "measured", "shout", "tremble"];
/** Sola's tones (and their "-ing" forms), read as the nearest of the four (the Preset Handover map). */
export const TONE_ALIASES = {
    steady: "measured", heavy: "shout", bite: "shout",
    whispering: "whisper", trembling: "tremble", biting: "shout", shouting: "shout",
};

/** Sola V2's dialogue palette. */
export const SOLA = {
    marigold: "#f4a261", amber: "#f3b74b", cider: "#e9a036", coral: "#ee6c4d",
    copper: "#e07a5f", terracotta: "#c06c54", sage: "#9aa87a", rose: "#f4845f",
    denim: "#7a8b99", slate: "#8fa4b2", indigo: "#8592e6", heather: "#b08ea2",
    ash: "#bac3c7", mist: "#98b9c7", pine: "#789e8a", obsidian: "#a3948a",
};

// CSS Color Module Level 4 named colours.
const CSS_COLOURS = `aliceblue f0f8ff antiquewhite faebd7 aqua 00ffff aquamarine 7fffd4 azure f0ffff beige f5f5dc
bisque ffe4c4 black 000000 blanchedalmond ffebcd blue 0000ff blueviolet 8a2be2 brown a52a2a burlywood deb887
cadetblue 5f9ea0 chartreuse 7fff00 chocolate d2691e coral ff7f50 cornflowerblue 6495ed cornsilk fff8dc
crimson dc143c cyan 00ffff darkblue 00008b darkcyan 008b8b darkgoldenrod b8860b darkgray a9a9a9
darkgreen 006400 darkgrey a9a9a9 darkkhaki bdb76b darkmagenta 8b008b darkolivegreen 556b2f darkorange ff8c00
darkorchid 9932cc darkred 8b0000 darksalmon e9967a darkseagreen 8fbc8f darkslateblue 483d8b
darkslategray 2f4f4f darkslategrey 2f4f4f darkturquoise 00ced1 darkviolet 9400d3 deeppink ff1493
deepskyblue 00bfff dimgray 696969 dimgrey 696969 dodgerblue 1e90ff firebrick b22222 floralwhite fffaf0
forestgreen 228b22 fuchsia ff00ff gainsboro dcdcdc ghostwhite f8f8ff gold ffd700 goldenrod daa520
gray 808080 green 008000 greenyellow adff2f grey 808080 honeydew f0fff0 hotpink ff69b4 indianred cd5c5c
indigo 4b0082 ivory fffff0 khaki f0e68c lavender e6e6fa lavenderblush fff0f5 lawngreen 7cfc00
lemonchiffon fffacd lightblue add8e6 lightcoral f08080 lightcyan e0ffff lightgoldenrodyellow fafad2
lightgray d3d3d3 lightgreen 90ee90 lightgrey d3d3d3 lightpink ffb6c1 lightsalmon ffa07a lightseagreen 20b2aa
lightskyblue 87cefa lightslategray 778899 lightslategrey 778899 lightsteelblue b0c4de lightyellow ffffe0
lime 00ff00 limegreen 32cd32 linen faf0e6 magenta ff00ff maroon 800000 mediumaquamarine 66cdaa
mediumblue 0000cd mediumorchid ba55d3 mediumpurple 9370db mediumseagreen 3cb371 mediumslateblue 7b68ee
mediumspringgreen 00fa9a mediumturquoise 48d1cc mediumvioletred c71585 midnightblue 191970 mintcream f5fffa
mistyrose ffe4e1 moccasin ffe4b5 navajowhite ffdead navy 000080 oldlace fdf5e6 olive 808000
olivedrab 6b8e23 orange ffa500 orangered ff4500 orchid da70d6 palegoldenrod eee8aa palegreen 98fb98
paleturquoise afeeee palevioletred db7093 papayawhip ffefd5 peachpuff ffdab9 peru cd853f pink ffc0cb
plum dda0dd powderblue b0e0e6 purple 800080 rebeccapurple 663399 red ff0000 rosybrown bc8f8f
royalblue 4169e1 saddlebrown 8b4513 salmon fa8072 sandybrown f4a460 seagreen 2e8b57 seashell fff5ee
sienna a0522d silver c0c0c0 skyblue 87ceeb slateblue 6a5acd slategray 708090 slategrey 708090 snow fffafa
springgreen 00ff7f steelblue 4682b4 tan d2b48c teal 008080 thistle d8bfd8 tomato ff6347 turquoise 40e0d0
violet ee82ee wheat f5deb3 white ffffff whitesmoke f5f5f5 yellow ffff00 yellowgreen 9acd32`;

const pairs = CSS_COLOURS.trim().split(/\s+/);
/** Colour names a voice or a tag may use: every CSS named colour, then Sola's palette over them. */
export const PALETTE = {
    ...Object.fromEntries(Array.from({ length: pairs.length / 2 }, (_, i) => [pairs[2 * i], `#${pairs[2 * i + 1]}`])),
    ...SOLA,
};

/** Every HTML element: a tag the browser renders, never a voice (`<b>"Hi"</b>` stays bold). A character called Mark is `<Mark_>`. */
export const HTML_TAGS = new Set(("a abbr acronym address area article aside audio b base bdi bdo big blink blockquote body br button canvas "
    + "caption center cite code col colgroup data datalist dd del details dfn dialog dir div dl dt em embed fieldset figcaption figure font "
    + "footer form frame frameset h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe img input ins kbd label legend li link main map mark "
    + "marquee math menu meta meter nav nobr noembed noframes noscript object ol optgroup option output p param picture plaintext pre progress "
    + "q rb rp rt rtc ruby s samp script search section select slot small source span strike strong style sub summary sup svg table tbody td "
    + "template textarea tfoot th thead time title tr track tt u ul var video wbr xmp").split(" "));

/**
 * Tags before a quote that are never a voice: HTML, the presets' thinking tags, and Sola's
 * typography (gradients, kinetics, template placeholders), whose own modules may still be on.
 */
const NON_VOICES = new Set([
    ...HTML_TAGS,
    "think", "thinking", "thought", "thoughts", "reasoning", "internal_monologue",
    "dusk", "solstice", "hearth", "eclipse", "wildwood", "mistveil",
    "stretch", "tilt", "echo", "crush", "fracture",
    "palette_name", "gradient_name", "tone_name", "kinetic_tag",
]);

/** `#rrggbb` (lowercase) for `#rgb`, `#rrggbb` or a palette name; null for anything else. */
export function colourHex(value) {
    const s = String(value ?? "").trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(s)) return s;
    if (/^#[0-9a-f]{3}$/.test(s)) return `#${[...s.slice(1)].map(c => c + c).join("")}`;
    return Object.hasOwn(PALETTE, s) ? PALETTE[s] : null;
}

// ── Colour maths ────────────────────────────────────────────────────────────

const lab = hex => {
    const lin = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const [r, g, b] = [1, 3, 5].map(i => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
    const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
    const y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b;
    const z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883;
    const f = t => (t > (6 / 29) ** 3 ? Math.cbrt(t) : t / (3 * (6 / 29) ** 2) + 4 / 29);
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
};

/** How different two colours look: CIE76 ΔE between their Lab values. */
export function colourDistance(a, b) {
    const [p, q] = [lab(colourHex(a)), lab(colourHex(b))];
    return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** Colours closer than this read as the same voice. */
export const NEAR = 12;

/** The colours Story Ledger hands out by itself, in order of preference: FF's ten, then Sola's. */
export const AUTO_POOL = ["cyan", "pink", "teal", "orange", "gold", "violet", "salmon", "orchid", "yellow", "plum"]
    .map(n => PALETTE[n]).concat(Object.values(SOLA));

/** The pool colour that sits farthest from every taken one (ties: pool order). Deterministic. */
export function pickColour(taken) {
    const hexes = (taken || []).map(colourHex).filter(Boolean);
    let best = AUTO_POOL[0], bestGap = -1;
    for (const c of AUTO_POOL) {
        const gap = hexes.length ? Math.min(...hexes.map(t => colourDistance(c, t))) : Infinity;
        if (gap > bestGap) { best = c; bestGap = gap; }
    }
    return best;
}

/** [name, name] pairs, in input order, whose colours are closer than NEAR. */
export function nearDuplicates(entries) {
    const out = [];
    for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
            if (colourDistance(entries[i][1], entries[j][1]) < NEAR) out.push([entries[i][0], entries[j][0]]);
        }
    }
    return out;
}

// ── Names ───────────────────────────────────────────────────────────────────

/** A voice name for comparing: accents dropped, lower-case, spaces, `_` and `-` folded to one space. */
export const voiceKey = name => String(name ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[\s_-]+/g, " ").trim();

/**
 * The key in `list` that `name` names: the one with the same voiceKey, else the only key
 * whose first word is `name` (`<jim>` → "Jim Hawkins"). Null when there is none, or several.
 */
export function findVoice(list, name) {
    const keys = Object.keys(list || {});
    const k = voiceKey(name);
    const exact = keys.find(x => voiceKey(x) === k);
    if (exact !== undefined) return exact;
    const byFirst = keys.filter(x => voiceKey(x).split(" ")[0] === k);
    return byFirst.length === 1 ? byFirst[0] : null;
}

/**
 * The block's voices with the reader's overrides ({ name: colour }) on top: an override
 * replaces the voice it names (source "you"), or adds one the block does not have yet.
 */
export function withVoiceOverrides(voices, overrides) {
    const out = { ...(voices || {}) };
    for (const [name, colour] of Object.entries(overrides || {})) out[findVoice(out, name) ?? name] = { colour, source: "you" };
    return out;
}

// ── Painting ────────────────────────────────────────────────────────────────

/**
 * What to paint for each tagged quote in `text`, given the chat's voices ({ name: { hex } }):
 * { quote, index (its place among quotesIn(text)), top, bottom (null for one voice), tone, mind,
 * listener (telepathy naming both sender and receiver) }.
 * A voice resolves to the list, then a palette name, then mind; a voice nobody named yet gets
 * the colour the fill-in will give it.
 */
export function planPaint(text, list) {
    const positions = quotesWithPositions(text).map(q => q.at);
    const taken = Object.values(list || {}).map(v => v.hex).filter(Boolean);
    const picks = new Map();
    const resolve = v => {
        const k = findVoice(list, v);
        if (k !== null && list[k].hex) return { hex: list[k].hex, mind: false };
        const named = colourHex(v);
        if (named) return { hex: named, mind: false };
        if (voiceKey(v) === MIND) return { hex: MIND_FILL, mind: true };
        if (!picks.has(voiceKey(v))) picks.set(voiceKey(v), pickColour([...taken, ...picks.values()]));
        return { hex: picks.get(voiceKey(v)), mind: false };
    };
    return readVoiceTags(text).map(tag => {
        // mind is a marker: with two names it is telepathy from the first to the second (both
        // colours, on the band); with one name or none it still fills its half in black
        const named = tag.voices.filter(v => voiceKey(v) !== MIND);
        const listener = named.length >= 2 && named.length < tag.voices.length;
        const [a, b] = (listener ? named : tag.voices).slice(0, 2).map(resolve);
        return { quote: tag.quote, index: positions.indexOf(tag.quoteAt), top: a.hex, bottom: b ? b.hex : null, tone: tag.tone, mind: listener || a.mind || Boolean(b && b.mind), listener };
    });
}

// The quote kinds SillyTavern wraps in <q>, each closing with its own mark, never across a line.
const ANY_QUOTE = /"[^"\n]{1,2000}?"|“[^”\n]{1,2000}?”|«[^»\n]{1,2000}?»|「[^」\n]{1,2000}?」|『[^』\n]{1,2000}?』|＂[^＂\n]{1,2000}?＂/g;
// comments and tags blanked to spaces, so indexes still line up with the raw text
const blankMarkup = text => String(text ?? "").replace(/<!--[\s\S]*?(?:-->|$)|<[^<>]*>/g, m => " ".repeat(m.length));
const quotesWithPositions = text => [...blankMarkup(text).matchAll(ANY_QUOTE)].map(m => ({ text: m[0], at: m.index }));

/** Every quote in a message's raw text, in order, as the host will show them (tags and comments skipped). */
export const quotesIn = text => quotesWithPositions(text).map(q => q.text);

/** A quote reduced to its letters and digits, lower-cased: markdown and quote marks drop out. */
export const quoteKey = s => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** For each planned quote, in order, the index of the next on-screen quote with the same words, or -1. */
export function matchQuotes(planned, onScreen) {
    let from = 0;
    return planned.map(q => {
        const k = quoteKey(q);
        for (let i = from; i < onScreen.length; i++) {
            if (quoteKey(onScreen[i]) === k) { from = i + 1; return i; }
        }
        return -1;
    });
}

// ── Tags ────────────────────────────────────────────────────────────────────

const NAME = String.raw`[\p{L}\p{N}][\p{L}\p{N} '’_-]{0,39}`;
const TAG = new RegExp(String.raw`<\s*(?:(?:color|gradient|kinetic)\s*:\s*)?(${NAME}(?:\s*\+\s*${NAME})*)((?:\s*:\s*[a-z][a-z0-9_-]{0,24})*)\s*>\s*(?:[*_~]{1,3}\s*)?("[^"\n]{1,2000}?"|“[^”\n]{1,2000}?”)(?:\s*<\s*\/[^<>\n\r]{0,40}>)?`, "giu");

const toneOf = segments => {
    for (const raw of segments.split(":").map(s => s.trim().toLowerCase()).filter(Boolean)) {
        if (TONES.includes(raw)) return raw;
        if (Object.hasOwn(TONE_ALIASES, raw)) return TONE_ALIASES[raw];
    }
    return null;
};

/**
 * A tag the browser kept as text at the end of `text` (a name starting with a letter it does not
 * open tags on, such as <Élodie>): { at, length }, or null. Trailing spaces are not part of it.
 */
export function trailingTagAt(text) {
    const m = /<[^<>\n]{1,60}>(?=\s*$)/.exec(String(text ?? ""));
    return m ? { at: m.index, length: m[0].length } : null;
}

/**
 * Every voice tag right before a quote, in order: { voices (as written), tone (canonical or
 * null), quote (with its marks), at (index of the `<`), quoteAt (index of the quote) }.
 * Formatting tags are skipped.
 */
export function readVoiceTags(text) {
    const out = [];
    for (const m of String(text ?? "").matchAll(TAG)) {
        const voices = m[1].split("+").map(v => v.trim()).filter(Boolean);
        // HTML, thinking and typography tags are not voices (checked as written, so <Mark_> is a voice);
        // nor is a lone tone (Sola's standalone <whisper>"…" in old chats)
        const raw = String(voices[0] ?? "").toLowerCase(), first = voiceKey(raw);
        if (!voices.length || NON_VOICES.has(raw) || TONES.includes(first) || Object.hasOwn(TONE_ALIASES, first)) continue;
        out.push({ voices, tone: toneOf(m[2] || ""), quote: m[3], at: m.index, quoteAt: m.index + m[0].lastIndexOf(m[3]) });
    }
    return out;
}
