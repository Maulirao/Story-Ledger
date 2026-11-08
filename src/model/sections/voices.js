// ──────────────────────────────────────────────────────────────────────────────
// 🎨 VOICES — each speaker's dialogue colour. The model gives a new speaker a colour
// once; Story Ledger fills one in for a speaker it never named; a set colour never
// changes except by the reader (whose overrides live in chat data, not here). Pure.
// ──────────────────────────────────────────────────────────────────────────────

import { esc, unesc, ROW, unbullet, closedForm } from "../text.js";
import { commandTemplate } from "../commands.js";
import { MIND, NEAR, colourHex, colourDistance, findVoice, pickColour, readVoiceTags, voiceKey, withVoiceOverrides } from "../voices.js";

const COMMANDS = [
    { id: "voices.set", form: "Name: colour", example: "Ana: #3fa7a0", keywords: [] },
];

const LINE = /^(.+?)\s*[:=]\s*(\S+)$/;
const SOURCES = new Set(["model", "auto", "you"]);

const RULES = `Voices: tag every line of spoken dialogue with who says it, right before the opening quote: <Name>"…"</Name>. A name that is also an HTML tag (Mark, Ruby, Em) takes an underscore: <Mark_>. When it matters who is addressed, as in a group scene, name the speaker first and the listener second: <Speaker+Listener>"…". Telepathy uses the reserved voice mind, never a character's name: it marks words sent silently from one mind straight into another, heard only by the receiver and by no one else present. Write <Speaker+mind>"…" when it is clear who receives it, <Speaker+Listener+mind>"…" to name the receiver, or <mind>"…" when the sender is unknown. A character's own unspoken thoughts, which nobody receives, are not mind lines. Add a tone only when the delivery needs it: <Name:whisper>, <Name:shout>, <Name:measured>, <Name:tremble>, also after two voices (<Speaker+Listener:whisper>). The first time someone speaks, give them a colour under Voices: in the ledger comment: a CSS colour name or a #hex, readable on a dark background and far from the colours already taken. A speaker who already has a colour in earlier replies keeps it. A set colour never changes. These tags replace any other dialogue-colour instruction.`;

const hexesOf = list => Object.values(list || {}).filter(v => v != null).map(v => colourHex(typeof v === "string" ? v : v.colour)).filter(Boolean);

export default {
    key: "voices",
    title: "🎨 VOICES",
    match: /^VOICES$/,
    change: "Voices",
    aliases: ["Voice"],
    carried: true,
    empty: () => ({}),
    render: value => Object.entries(value).map(([n, v]) => `- <b>${esc(n)}</b> | ${esc(v.colour)} | ${v.source}`),
    parse(rows, prevValue) {
        const value = {}, errors = [];
        for (const row of rows) {
            const m = row.match(ROW);
            const parts = m ? m[2].split("|").map(p => p.trim()).filter(Boolean) : [];
            const colour = unesc(parts[0] ?? "");
            if (m && colourHex(colour)) value[unesc(m[1])] = { colour, source: SOURCES.has(parts[1]) ? parts[1] : "model" };
            else {
                errors.push(row);
                const name = m && unesc(m[1]);
                if (name && prevValue && prevValue[name]) value[name] = prevValue[name];
            }
        }
        return { value, errors };
    },
    apply(state, lines, ctx) {
        const unparsed = [];
        const warn = (line, text) => ctx.warnings.push({ section: "Voices", line, text });
        for (const line of lines) {
            const m = closedForm(unbullet(line)).match(LINE);
            const hex = m && colourHex(m[2]);
            if (!hex) { unparsed.push(line); continue; }
            const name = findVoice(state.voices, m[1]) ?? m[1].trim();
            if (voiceKey(name) === MIND) { warn(line, `"mind" is reserved for telepathy; give the character another tag name.`); continue; }
            // the model repeating the reader's colour for this voice changes nothing
            const o = findVoice(ctx.reply?.voiceOverrides, name);
            if (o !== null && colourHex(ctx.reply.voiceOverrides[o]) === hex) continue;
            const had = state.voices[name];
            if (had && (had.source === "model" || had.source === "you")) {
                if (colourHex(had.colour) !== hex) warn(line, `${name} already speaks in ${had.colour}; only the reader changes a set colour.`);
                continue;
            }
            const colour = m[2].toLowerCase();
            state.voices[name] = { colour, source: "model" };
            for (const [other, v] of Object.entries(state.voices)) {
                if (other !== name && colourDistance(hex, v.colour) < NEAR) warn(line, `${name}'s ${colour} looks like ${other}'s ${v.colour}.`);
            }
        }
        return unparsed;
    },
    after(state, ctx) {
        const reply = ctx.reply || {};
        const overrides = reply.voiceOverrides || {};
        for (const tag of readVoiceTags(reply.text || "")) {
            // the first two named voices: mind is a marker, so a named listener gets a colour too
            for (const v of tag.voices.filter(x => voiceKey(x) !== MIND).slice(0, 2)) {
                if (colourHex(v) || voiceKey(v) === MIND || findVoice(state.voices, v) !== null || findVoice(overrides, v) !== null) continue;
                state.voices[v] = { colour: pickColour([...hexesOf(state.voices), ...hexesOf(overrides)]), source: "auto" };
            }
        }
        // the reader's own list goes into the block: their colours as "you" rows, their deletions gone
        state.voices = withVoiceOverrides(state.voices, overrides);
    },
    prompt(value) {
        const rows = Object.entries(value || {}).map(([n, v]) => `${n} ${v.colour}`);
        return rows.length ? `Voices (each speaker keeps their colour; give a new speaker one far from these): ${rows.join(" · ")}` : "";
    },
    rules: () => RULES,
    commands: COMMANDS,
    template: ctx => commandTemplate("Voices", COMMANDS, ctx),
};
