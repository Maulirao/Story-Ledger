var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/model/normalize.js
var TAG = /<\/?[A-Za-z][^<>]*>/g;
var ODD_SPACE = /[\u00A0\u2000-\u200A\u202F\u205F\u3000\t]/g;
var MARKER = /^(?:[-*•·]|\d{1,3}[.)]|[a-z]\))\s+/;
var EMPHASIS = /^(\*\*|__)(.+?)\1/;
function stripTags(s) {
  return s.replace(TAG, "");
}
function foldQuotes(s) {
  return s.replace(/[“”„‟«»″]/g, '"').replace(/[‘’‚‛′]/g, "'");
}
function unwrapEmphasis(s) {
  const m = EMPHASIS.exec(s);
  if (!m) return s;
  const inner = m[2], rest = s.slice(m[0].length);
  if (inner.endsWith(":") || rest.startsWith(":") || rest.trim() === "") return inner + rest;
  return s;
}
function normalizeLine(raw) {
  raw = raw.replace(/\r$/, "");
  let s = stripTags(raw).replace(ODD_SPACE, " ").replace(/\s+/g, " ").trim();
  const code = /^`([^`]+)`$/.exec(s);
  if (code) s = code[1].trim();
  let bulleted = false;
  const mark = MARKER.exec(s);
  if (mark) {
    bulleted = true;
    s = s.slice(mark[0].length);
    const inner = /^`([^`]+)`$/.exec(s);
    if (inner) s = inner[1].trim();
  }
  const unfolded = unwrapEmphasis(s).trim();
  return { raw, unfolded, text: foldQuotes(unfolded).trim(), bulleted };
}
function ledgerLines(body) {
  return body.split(/\r?\n|<br\s*\/?>/i).map(normalizeLine).filter((l) => l.text !== "");
}

// src/model/text.js
var esc = (v) => String(v ?? "").replace(/\r?\n/g, " ").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\|/g, "&#124;");
var unesc = (v) => String(v ?? "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#124;/g, "|").replace(/&amp;/g, "&").trim();
var ROW = /^[-*•]\s*<b>([\s\S]*?)<\/b>\s*(.*)$/;
function fieldsOf(rest) {
  const out = {};
  for (const part of String(rest || "").split("|").map((p) => p.trim()).filter(Boolean)) {
    const m = part.match(/^([A-Za-z][A-Za-z/ ]*?)\s*:\s*([\s\S]*)$/);
    if (m) out[m[1].trim().toLowerCase()] = m[2];
  }
  return out;
}
var unbullet = (s) => String(s || "").replace(/^\s*[-*•]\s+/, "").trim();
var closedForm = (s) => String(s).replace(/(?<!\.)[.,;]$/, "").trim();
var nameKey = (s) => String(s).trim().toLowerCase();
function nameMatches(list, value2, rawValue) {
  const exact = (v) => list.flatMap((x, i) => nameKey(x) === nameKey(v) ? [i] : []);
  let hits = rawValue === void 0 ? [] : exact(rawValue);
  if (!hits.length) hits = exact(value2);
  if (hits.length) return hits;
  const folded = nameKey(foldQuotes(value2));
  hits = list.flatMap((x, i) => nameKey(foldQuotes(x)) === folded ? [i] : []);
  return hits.length === 1 ? hits : [];
}

// src/model/sections/people.js
function findName(names, name) {
  const want = String(name || "").trim();
  return (names || []).find((n) => n.toLowerCase() === want.toLowerCase()) || want;
}
var hasName = (names, name) => (names || []).some((n) => n.toLowerCase() === String(name || "").trim().toLowerCase());

// src/model/commands.js
var formOf = (command, ctx) => typeof command.form === "function" ? command.form(ctx) : command.form;
function isCommandPlaceholder(line, commands) {
  const key2 = (s) => foldQuotes(s).replace(/\s+/g, " ").replace(/\s*(?:<->|->|=>|[→↔⟶➔➜⇔])\s*/g, "→").replace(/\s*:\s*/g, ":").trim().toLowerCase();
  const value2 = key2(line);
  return commands.some((c) => ["dnd", "arrow"].some((checkStyle) => value2 === key2(formOf(c, { checkStyle }))));
}
function commandTemplate(heading, commands, ctx) {
  return [`${heading}:`, ...commands.map((c) => `- ${formOf(c, ctx)}`)];
}

// src/model/sections/cast.js
var FIELDS = ["position", "wearing", "holding", "condition"];
var LABEL = { position: "Position", wearing: "Wearing", holding: "Holding", condition: "Condition" };
var blank = () => Object.fromEntries(FIELDS.map((f) => [f, ""]));
var show = (v) => v ? esc(v) : "—";
var read = (v) => {
  const t = unesc(v ?? "");
  return t === "—" ? "" : t;
};
var COMMANDS = [
  { id: "cast.position", form: "Name: position: text", example: "Mara: position: by the door", keywords: ["position"] },
  { id: "cast.wearing", form: "Name: wearing: text", example: "Mara: wearing: a wet coat", keywords: ["wearing"] },
  { id: "cast.holding", form: "Name: holding: text", example: "Mara: holding: a brass key", keywords: ["holding"] },
  { id: "cast.condition", form: "Name: condition: text", example: "Mara: condition: shivering", keywords: ["condition"] }
];
var cast_default = {
  key: "cast",
  title: "👥 SCENE CAST",
  match: /^SCENE CAST$/,
  change: "Cast",
  aliases: ["Scene cast"],
  carried: true,
  empty: () => ({}),
  render: (value2) => Object.entries(value2).map(([n, c]) => `- <b>${esc(n)}</b> | ${FIELDS.map((k) => `${LABEL[k]}: ${show(c[k])}`).join(" | ")}`),
  parse(rows, prevValue) {
    const value2 = {}, errors = [];
    for (const row of rows) {
      const m = row.match(ROW);
      const f = m && fieldsOf(m[2]);
      if (m && f && FIELDS.some((k) => k in f)) value2[unesc(m[1])] = Object.fromEntries(FIELDS.map((k) => [k, read(f[k])]));
      else {
        errors.push(row);
        const name = m && unesc(m[1]);
        if (name && prevValue && prevValue[name]) value2[name] = prevValue[name];
      }
    }
    return { value: value2, errors };
  },
  apply(state, lines2) {
    const unparsed = [];
    for (const raw of lines2) {
      const line = String(raw).trim();
      const m = line.match(/^(.+?)\s*:\s*(position|wearing|holding|condition)\s*:\s*(.+)$/i);
      if (!m) {
        unparsed.push(line);
        continue;
      }
      const n = findName([...Object.keys(state.cast), ...state.scene.present], m[1]);
      state.cast[n] = state.cast[n] || blank();
      state.cast[n][m[2].toLowerCase()] = m[3].trim();
    }
    return unparsed;
  },
  after(state) {
    for (const n of Object.keys(state.cast)) if (!hasName(state.scene.present, n)) delete state.cast[n];
  },
  prompt(value2) {
    const rows = Object.entries(value2).map(([n, c]) => `- ${n}: ${FIELDS.filter((k) => c[k]).map((k) => `${k} ${c[k]}`).join(" · ")}`);
    return rows.length ? ["In the scene:", ...rows].join("\n") : "";
  },
  rules: () => "Cast: for each person present — where they are relative to the others, what they are wearing now, what is in their hands, notable physical state (injured, wet, tired, drunk, hungry, aroused). Report only what changed; clothes and objects do not reappear once removed or put down.",
  commands: COMMANDS,
  template: (ctx) => commandTemplate("Cast", COMMANDS, ctx)
};

// src/model/sections/locations.js
var COMMANDS2 = [
  { id: "locations.move", form: "Name @ place", example: "Ana @ the harbour", keywords: [] }
];
function locationLine(line, { normalized = false } = {}) {
  const m = (normalized ? String(line).trim() : unbullet(line)).match(/^([^@:]+?)\s*(?:@|:)\s*(.+)$/);
  return m ? [m[1].trim(), m[2].trim()] : null;
}
function setLocation(state, name, place) {
  state.locations = state.locations || {};
  state.locations[findName(Object.keys(state.locations), name)] = place;
}
var locations_default = {
  key: "locations",
  title: "👤 NPC LOCATIONS",
  match: /^NPC LOCATIONS$/,
  change: "Locations",
  aliases: ["NPC Locations", "Location"],
  carried: true,
  empty: () => ({}),
  render: (value2) => Object.entries(value2).map(([n, place]) => `- <b>${esc(n)}</b> | Location: ${esc(place)}`),
  parse(rows, prevValue) {
    const value2 = {}, errors = [];
    for (const row of rows) {
      const m = row.match(ROW);
      const f = m && fieldsOf(m[2]);
      if (m && f && "location" in f) value2[unesc(m[1])] = unesc(f.location);
      else {
        errors.push(row);
        const name = m && unesc(m[1]);
        if (name && prevValue && name in prevValue) value2[name] = prevValue[name];
      }
    }
    return { value: value2, errors };
  },
  apply(state, lines2, ctx) {
    const normalized = Boolean(ctx && ctx.normalizedChanges);
    const unparsed = [];
    for (const l of lines2) {
      const hit = locationLine(l, { normalized });
      if (hit) setLocation(state, hit[0], hit[1]);
      else unparsed.push(normalized ? String(l).trim() : unbullet(l));
    }
    return unparsed;
  },
  prompt(value2, state) {
    const away = Object.entries(value2).filter(([n]) => !hasName(state.scene.present, n));
    return away.length ? `Where people are: ${away.map(([n, p]) => `${n} — ${p}`).join("; ")}` : "";
  },
  rules: () => "Locations: write a line only when someone moved.",
  commands: COMMANDS2,
  template: (ctx) => commandTemplate("Locations", COMMANDS2, ctx)
};

// src/model/sections/agendas.js
var FIELDS2 = ["aware", "fibs", "circle", "body"];
var blank2 = () => ({ task: "", step: 0, max: 0, aware: "", fibs: "", circle: "", body: "" });
var show2 = (v) => v ? esc(v) : "—";
var read2 = (v) => {
  const t = unesc(v);
  return t === "—" ? "" : t;
};
var COMMANDS3 = [
  { id: "agendas.new", form: 'Name: new "task" 0/N @ place', example: 'Ana: new "mend the nets" 0/2 @ the harbour', keywords: ["new"] },
  { id: "agendas.done", form: 'Name: done "task" → effect', example: 'Ana: done "mend the nets" → the boat can sail', keywords: ["done"] },
  { id: "agendas.knows", form: "Name knows: …", example: "Ana knows: Mara took the key", keywords: ["knows"] },
  { id: "agendas.fib", form: "Name fib: …", example: "Ana fib: says she was home all night", keywords: ["fib"] },
  { id: "agendas.circle", form: "Name circle: …", example: "Ana circle: the harbour crews", keywords: ["circle"] },
  { id: "agendas.body", form: "Name body: …", example: "Ana body: a bandaged hand", keywords: ["body"] }
];
function progressRecap(line, normalized) {
  const bare = normalized && line.match(/^([^:]+?)\s*:\s*("[^"]+"|[^"\s][^"]*?)\s+(\d+)\s*\/\s*(\d+)\s*(?:\((.+)\)|[—–]\s*(.+)|(continues\b.*))?$/i);
  if (bare) {
    if (/^new\b/i.test(bare[2])) return null;
    const note2 = bare[5] || bare[6] || bare[7];
    line = `${bare[1]}: ${bare[2]} (${bare[3]}/${bare[4]})${note2 ? ` — ${note2}` : ""}`;
  }
  const m = line.match(/^([^:]+?)\s*:\s*(\S.*?)\s+\(\s*(\d+)\s*\/\s*(\d+)\s*\)("?)\s*(?:[—–]\s*(.+)|(continues\b.*))?$/i);
  if (!m || Number(m[4]) <= 0 || Number(m[3]) > Number(m[4])) return null;
  let task = m[2].trim();
  if (m[5] && task.startsWith('"')) task = task.slice(1).trim();
  else if (task.startsWith('"') && task.endsWith('"')) task = task.slice(1, -1).trim();
  if (!task) return null;
  const note = m[6] || m[7];
  return { name: m[1], task: task + (note ? ` — ${note.trim()}` : ""), step: Number(m[3]), max: Number(m[4]) };
}
function entry(state, name) {
  const n = findName(Object.keys(state.agendas), name);
  if (!state.agendas[n]) state.agendas[n] = blank2();
  return [n, state.agendas[n]];
}
var offScreen = (state, name) => !hasName(state.scene.present, name);
var agendas_default = {
  key: "agendas",
  title: "👤 NPC AGENDAS",
  match: /^NPC AGENDAS$/,
  change: "Agendas",
  aliases: ["NPC Agendas", "Agenda"],
  carried: true,
  empty: () => ({}),
  render: (value2) => Object.entries(value2).map(([n, a]) => `- <b>${esc(n)}</b> | Agenda: ${show2(a.task)} | (Step ${a.step}/${a.max}) | Aware: ${show2(a.aware)} | Fibs: ${show2(a.fibs)} | Circle: ${show2(a.circle)} | Body: ${show2(a.body)}`),
  parse(rows, prevValue) {
    const value2 = {}, errors = [];
    for (const row of rows) {
      const m = row.match(ROW);
      const step = m && m[2].match(/\(\s*Step\s+(\d+)\s*\/\s*(\d+)\s*\)/i);
      const f = m && fieldsOf(m[2]);
      if (m && step && f && "agenda" in f) {
        const a = { task: read2(f.agenda), step: Number(step[1]), max: Number(step[2]) };
        for (const k of FIELDS2) a[k] = read2(f[k] ?? "");
        value2[unesc(m[1])] = a;
      } else {
        errors.push(row);
        const name = m && unesc(m[1]);
        if (name && prevValue && prevValue[name]) value2[name] = prevValue[name];
      }
    }
    return { value: value2, errors };
  },
  apply(state, lines2, ctx) {
    const unparsed = [];
    for (const raw of lines2) {
      const line = String(raw).trim();
      let m;
      if (m = line.match(/^(.+?)\s*:\s*new\s+"([^"]+)"\s+(\d+)\s*\/\s*(\d+)\s*(?:@\s*(.+))?$/i)) {
        const step = Number(m[3]), max = Number(m[4]);
        if (max <= 0 || step > max) {
          unparsed.push(line);
          continue;
        }
        const [n, a] = entry(state, m[1]);
        Object.assign(a, { task: m[2].trim(), step, max });
        if (m[5]) setLocation(state, n, m[5].trim());
        ctx.touched.add(n.toLowerCase());
      } else if (m = line.match(/^(.+?)\s*:\s*done\b/i)) {
        const n = findName(Object.keys(state.agendas), m[1]);
        if (!state.agendas[n]) unparsed.push(line);
        else if (!ctx.touched.has(n.toLowerCase())) Object.assign(state.agendas[n], { task: "", step: 0, max: 0 });
      } else if (m = line.match(/^(.+?)\s+(knows|fibs?|circle|body)\s*:\s*(.+)$/i)) {
        const [, a] = entry(state, m[1]);
        const field3 = { knows: "aware", fib: "fibs", fibs: "fibs", circle: "circle", body: "body" }[m[2].toLowerCase()];
        const v = m[3].trim();
        a[field3] = (field3 === "aware" || field3 === "fibs") && a[field3] ? `${a[field3]}; ${v}` : v;
      } else if (m = progressRecap(line, ctx.normalizedChanges)) {
        const [n, a] = entry(state, m.name);
        Object.assign(a, { task: m.task, step: m.step, max: m.max });
        ctx.touched.add(n.toLowerCase());
      } else if (/@/.test(line) && locationLine(line, { normalized: ctx.normalizedChanges })) {
        const [n, place] = locationLine(line, { normalized: ctx.normalizedChanges });
        setLocation(state, n, place);
      } else unparsed.push(line);
    }
    return unparsed;
  },
  after(state, ctx) {
    for (const [n, a] of Object.entries(state.agendas)) {
      if (a.max > 0 && a.step < a.max && offScreen(state, n) && !ctx.touched.has(n.toLowerCase())) a.step += 1;
    }
  },
  facts(state) {
    const out = [];
    for (const [n, a] of Object.entries(state.agendas)) {
      if (!a.max || !offScreen(state, n)) continue;
      if (a.step < a.max && a.step + 1 >= a.max) out.push(`${n} finishes "${a.task}" off-screen this turn — apply its effect and give ${n} a new agenda.`);
      else if (a.step >= a.max) out.push(`${n}'s agenda "${a.task}" is finished — give ${n} a new one.`);
    }
    return out;
  },
  prompt(value2, state) {
    const rows = Object.entries(value2).sort(([a], [b]) => offScreen(state, b) - offScreen(state, a)).map(([n, a]) => {
      const bits = [a.task ? `${a.task}${a.max ? ` (${a.step}/${a.max})` : ""}` : "no agenda"];
      for (const k of FIELDS2) if (a[k]) bits.push(`${k}: ${a[k]}`);
      return `- ${n}${offScreen(state, n) ? " (off-screen)" : ""} — ${bits.join(" · ")}`;
    });
    return rows.length ? ["Agendas:", ...rows].join("\n") : "";
  },
  rules: () => [
    "Agendas: every named NPC has one, given on first appearance. Without a clear goal, give a mundane one of 1–3 steps drawn from the widest set that fits the person and setting (eating, cleaning, repairing, trading, training, studying, a shift, an errand, an animal, a debt, a visit, grooming, praying, gambling, drinking, arguing, resting, an idle habit); sleep and aimless wandering are last resorts.",
    "When an NPC leaves the scene, replace their agenda from personality, recent events or whim. Off-screen agendas advance on their own; the ledger tells you when one finishes.",
    "When one finishes, apply its effect through the ledger's other lines — travel: a new location; research: load a Chekhov setup and tick fondness with whoever was involved; repair/build: an item on their Body; trade/errand: move an item between people; train: a skill noted on Body; social visit: relationship ticks between the two; rest: Body improves, a little self-regard; reconcile: a DIRECT fondness shift and a subdued repair talk; confront: friction ticks. A completion never walks into {{user}}'s scene on its own.",
    "On entering the scene: unfinished — distracted, mentions what is pending; finished and mundane — neutral; finished and significant — energised, wants to share if fond of the person.",
    "Write `new` for a new or replaced agenda and `done` for one that finished; knows, fib, circle and body lines only for what changed.",
    "Never name the mechanics in prose."
  ].join("\n"),
  commands: COMMANDS3,
  template: (ctx) => commandTemplate("Agendas", COMMANDS3, ctx)
};

// src/model/sections/factions.js
var FIELDS3 = ["goal", "intel", "fibs", "state", "conflict", "relations"];
var LABEL2 = { goal: "Goal", intel: "Intel", fibs: "Fibs", state: "State", conflict: "Conflict", relations: "Relations" };
var blank3 = () => Object.fromEntries(FIELDS3.map((f) => [f, ""]));
var show3 = (v) => v ? esc(v) : "—";
var read3 = (v) => {
  const t = unesc(v ?? "");
  return t === "—" ? "" : t;
};
var COMMANDS4 = [
  { id: "factions.goal", form: "Name: goal: text", example: "Harbour Guild: goal: control the docks", keywords: ["goal"] },
  { id: "factions.intel", form: "Name: intel: text", example: "Harbour Guild: intel: knows about the smuggling", keywords: ["intel"] },
  { id: "factions.fibs", form: "Name: fibs: text", example: "Harbour Guild: fibs: claims the tolls fund repairs", keywords: ["fibs"] },
  { id: "factions.state", form: "Name: state: text", example: "Harbour Guild: state: shaken after the fire", keywords: ["state"] },
  { id: "factions.conflict", form: "Name: conflict: text", example: "Harbour Guild: conflict: the fishermen's union", keywords: ["conflict"] },
  { id: "factions.relations", form: "Name: relations: text", example: "Harbour Guild: relations: courts the mayor", keywords: ["relations"] },
  { id: "factions.drop", form: "drop: Name", example: "drop: Harbour Guild", keywords: ["drop"] }
];
function fieldParts(text) {
  const parts = String(text).split(/\s*([|·])\s*/);
  const updates = [], pending = [];
  const field3 = (label) => label.toLowerCase() === "fib" ? "fibs" : label.toLowerCase();
  let current = [];
  for (let i = 0; i < parts.length; i += 2) {
    const part = parts[i].trim();
    const valued = part.match(/^(goal|intel|fibs?|state|conflict|relations)(?:\s*:\s*|\s+(?!:))(\S.*)$/i);
    const bare = part.match(/^(goal|intel|fibs?|state|conflict|relations)$/i);
    if (valued) {
      current = [...pending.splice(0), field3(valued[1])].map((k) => [k, valued[2].trim()]);
      updates.push(...current);
    } else if (bare) pending.push(field3(bare[1]));
    else {
      if (!part || pending.length || !current.length || /^[^:]+:/.test(part)) return null;
      for (const update of current) update[1] += ` ${parts[i - 1]} ${part}`;
    }
  }
  return updates.length && !pending.length ? updates : null;
}
var factions_default = {
  key: "factions",
  title: "🏳️ FACTIONS",
  match: /^FACTIONS$/,
  change: "Factions",
  aliases: ["Faction"],
  carried: true,
  empty: () => ({}),
  render: (value2) => Object.entries(value2).map(([n, f]) => `- <b>${esc(n)}</b> | ${FIELDS3.map((k) => `${LABEL2[k]}: ${show3(f[k])}`).join(" | ")}`),
  parse(rows, prevValue) {
    const value2 = {}, errors = [];
    for (const row of rows) {
      const m = row.match(ROW);
      const f = m && fieldsOf(m[2]);
      if (m && f && FIELDS3.some((k) => k in f)) value2[unesc(m[1])] = Object.fromEntries(FIELDS3.map((k) => [k, read3(f[k])]));
      else {
        errors.push(row);
        const name = m && unesc(m[1]);
        if (name && prevValue && prevValue[name]) value2[name] = prevValue[name];
      }
    }
    return { value: value2, errors };
  },
  apply(state, lines2) {
    const unparsed = [];
    for (const raw of lines2) {
      const line = String(raw).trim();
      let m;
      if (m = line.match(/^drop\s*:\s*(.+)$/i)) {
        const n = findName(Object.keys(state.factions), m[1]);
        if (state.factions[n]) delete state.factions[n];
        else unparsed.push(line);
      } else if ((m = line.match(/^(.+?)\s*:\s*(.+)$/)) && fieldParts(m[2])) {
        const n = findName(Object.keys(state.factions), m[1]);
        state.factions[n] = state.factions[n] || blank3();
        for (const [k, text] of fieldParts(m[2])) state.factions[n][k] = text;
      } else unparsed.push(line);
    }
    return unparsed;
  },
  prompt(value2) {
    const rows = Object.entries(value2).map(([n, f]) => `- ${n}: ${FIELDS3.filter((k) => f[k]).map((k) => `${k} ${f[k]}`).join(" · ")}`);
    return rows.length ? ["Factions:", ...rows].join("\n") : "";
  },
  rules: () => "Factions are groups with their own goals, intel, lies, morale and rivalries; update a field only when the story changes it.",
  commands: COMMANDS4,
  template: (ctx) => commandTemplate("Factions", COMMANDS4, ctx)
};

// src/model/state.js
function emptyState() {
  const s = {
    ct: 0,
    scene: { now: "", present: [], public: false },
    threads: [],
    rel: { pairs: {}, selves: {}, awaiting: {} },
    perTurn: {}
  };
  for (const sec of SECTIONS) if (sec.carried) s[sec.key] = sec.empty();
  return s;
}
function nextId(state, kind, existing = []) {
  state.ids = state.ids || {};
  const seen = existing.map((id) => Number(String(id).slice(kind.length))).filter(Number.isFinite);
  state.ids[kind] = Math.max(state.ids[kind] || 0, ...seen) + 1;
  return `${kind}${state.ids[kind]}`;
}

// src/model/sections/quests.js
var STATUS = ["active", "done", "dropped"];
var show4 = (v) => v ? esc(v) : "—";
var read4 = (v) => {
  const t = unesc(v ?? "");
  return t === "—" ? "" : t;
};
var byId = (state, id) => state.quests.find((q) => q.id.toLowerCase() === String(id).toLowerCase());
var COMMANDS5 = [
  { id: "quests.add-main", form: "+ Main: objective (reward)", example: "+ Main: find the missing ferryman (the title Harbour Friend)", keywords: ["Main"] },
  { id: "quests.add-side", form: "+ Side: objective (reward)", example: "+ Side: return the lost dog (a free meal)", keywords: ["Side"] },
  { id: "quests.progress", form: "Q# progress: text", example: "Q1 progress: the ferryman was seen at the mill", keywords: ["progress"] },
  { id: "quests.done", form: "done Q#", example: "done Q1", keywords: ["done"] },
  { id: "quests.drop", form: "drop Q#", example: "drop Q1", keywords: ["drop"] },
  { id: "quests.reopen", form: "reopen Q#", example: "reopen Q1", keywords: ["reopen"] }
];
var quests_default = {
  key: "quests",
  title: "📜 QUESTS",
  match: /^QUESTS$/,
  change: "Quests",
  aliases: ["Quest"],
  carried: true,
  empty: () => [],
  render: (value2) => value2.map((q) => `- <b>${q.id} ${q.kind}</b> | ${q.status}${q.status !== "active" && q.send ? " · sent" : ""} | Objective: ${show4(q.objective)} | Progress: ${show4(q.progress)} | Reward: ${show4(q.reward)}`),
  parse(rows, prevValue) {
    const value2 = [], errors = [];
    for (const row of rows) {
      const m = row.match(ROW);
      const head = m && unesc(m[1]).match(/^(Q\d+)\s+(Main|Side)$/i);
      const seg = m && (m[2].split("|").map((p) => p.trim()).find((p) => STATUS.includes(p.split("·")[0].trim().toLowerCase())) || "");
      const status = seg && seg.split("·")[0].trim();
      const send = Boolean(seg) && /·\s*sent\b/i.test(seg);
      const f = m && fieldsOf(m[2]);
      if (head && status && f && "objective" in f) {
        value2.push({
          id: head[1].toUpperCase(),
          kind: head[2][0].toUpperCase() + head[2].slice(1).toLowerCase(),
          status: status.toLowerCase(),
          objective: read4(f.objective),
          progress: read4(f.progress),
          reward: read4(f.reward),
          send
        });
      } else {
        errors.push(row);
        const old = head && (prevValue || []).find((q) => q.id === head[1].toUpperCase());
        if (old) value2.push(old);
      }
    }
    return { value: value2, errors };
  },
  apply(state, lines2, ctx) {
    const unparsed = [];
    const closed = ctx && ctx.normalizedChanges ? closedForm : (s) => s;
    const update = ctx && ctx.normalizedChanges ? /^(Q\d+)\b\s*(.*:\s*\S.*)$/i : /^(Q\d+)\b\s*(.*:.*)$/i;
    for (const raw of lines2) {
      const line = String(raw).trim();
      let m, q;
      if (m = line.match(/^\+\s*(Main|Side)\s*:\s*(.+?)\s*(?:\(([^()]*)\))?$/i)) {
        state.quests.push({
          id: nextId(state, "Q", state.quests.map((x) => x.id)),
          kind: m[1][0].toUpperCase() + m[1].slice(1).toLowerCase(),
          status: "active",
          objective: m[2].trim(),
          progress: "",
          reward: (m[3] || "").trim(),
          send: false
        });
      } else if ((m = line.match(/^(Q\d+)\s*:?\s+(?:(?:Main|Side)\s+)?progress\s*:\s*(.+)$/i)) && (q = byId(state, m[1]))) q.progress = m[2].trim();
      else if ((m = closed(line).match(/^(done|drop|reopen)\s+(Q\d+)$/i)) && (q = byId(state, m[2]))) {
        q.status = { done: "done", drop: "dropped", reopen: "active" }[m[1].toLowerCase()];
      } else if ((m = line.match(update)) && (q = byId(state, m[1]))) {
        let rest = m[2].replace(/^[\s:·—–-]*(?:(?:Main|Side)\b)?[\s:·—–-]*/i, "");
        if (q.objective && rest.toLowerCase().startsWith(q.objective.toLowerCase())) rest = rest.slice(q.objective.length);
        q.progress = rest.replace(/^[\s:·—–-]+/, "").trim();
      } else unparsed.push(line);
    }
    return unparsed;
  },
  prompt(value2) {
    const active = value2.filter((q) => q.status === "active").map((q) => `- ${q.id} ${q.kind} — ${q.objective}${q.progress ? ` · ${q.progress}` : ""}${q.reward ? ` · reward: ${q.reward}` : ""}`);
    const finished = value2.filter((q) => q.status !== "active" && q.send).map((q) => `${q.id} ${q.objective} (${q.status})`);
    const parts = [];
    if (active.length) parts.push("Quests:", ...active);
    if (finished.length) parts.push(`Finished: ${finished.join("; ")}`);
    return parts.join("\n");
  },
  rules: () => "Quests: a Main quest is the story's spine, Side quests are optional; rewards are new titles or items. Mark progress when the story moves a quest, done or drop when it ends.",
  commands: COMMANDS5,
  template: (ctx) => commandTemplate("Quests", COMMANDS5, ctx)
};

// src/model/decimal.js
function decimal(value2) {
  const text = String(value2).trim();
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const integer = (whole || "0").replace(/^0+(?=\d)/, "");
  const tail = fraction.replace(/0+$/, "");
  return integer + (tail ? `.${tail}` : "");
}
function adjustDecimal(balance, change) {
  const signed = String(change).trim();
  if (!/^[+-]/.test(signed)) return null;
  const current = decimal(balance), delta = decimal(signed.slice(1));
  if (current === null || delta === null) return null;
  const [a, af = ""] = current.split("."), [b, bf = ""] = delta.split(".");
  const scale = Math.max(af.length, bf.length);
  const sum = BigInt(a + af.padEnd(scale, "0")) + (signed[0] === "-" ? -1n : 1n) * BigInt(b + bf.padEnd(scale, "0"));
  if (sum < 0n) return null;
  const digits = sum.toString().padStart(scale + 1, "0");
  return decimal(scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits);
}

// src/model/effects.js
var CATEGORIES = ["physical", "social", "mental"];
var NUMERIC = /^([+-])(\d+)\s+(physical|social|mental)\b\s*:?\s*(.*)$/i;
var SIGNED_WORD = /^[+-]\d+\s+([^\s:;,()]+)/;
var PROFICIENCY = /^proficiency\s*:\s*(.+)$/i;
var JUNK = /^(all prior|all previous|—)$/i;
var HAS_SIGNED_NUMBER = /(?<!\w)[+-]\d/;
var fold = (s) => String(s ?? "").replace(/[−–]/g, "-");
var unescSemi = (s) => s.replace(/&#59;/g, ";");
var escSemi = (s) => s.replace(/;/g, "&#59;");
function splitTop(text, seps) {
  const out = [];
  let depth = 0, cur = "";
  for (const ch of String(text ?? "")) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && seps.includes(ch) && !(ch === ";" && cur.endsWith("&#59"))) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
function parsePiece(piece) {
  const text = fold(piece).trim();
  const prof = text.match(PROFICIENCY);
  if (prof) return { effect: { kind: "proficiency", skill: unescSemi(prof[1].trim()) } };
  const num = text.match(NUMERIC);
  if (num) {
    const n = Number(num[2]) * (num[1] === "-" ? -1 : 1);
    if (n === 0 || Math.abs(n) > 2) return { effect: null, warning: `"${text}" is out of range (use ±1 or ±2)` };
    return { effect: { kind: "numeric", n, category: num[3].toLowerCase(), focus: unescSemi(num[4].trim()) } };
  }
  const odd = text.match(SIGNED_WORD);
  const narrative = { kind: "narrative", text: unescSemi(String(piece).trim()) };
  return odd && !CATEGORIES.includes(odd[1].toLowerCase()) ? { effect: narrative, warning: `unknown category "${odd[1]}"` } : { effect: narrative };
}
var isStructured = (r) => r.effect && r.effect.kind !== "narrative";
function parseEffects(text, { legacy = false } = {}) {
  const effects = [], warnings = [];
  let complete = true, any = false;
  for (const raw of splitTop(text, ";")) {
    if (!raw.trim()) continue;
    let pieces = [raw];
    if (legacy) {
      const commas = splitTop(raw, ",").filter((p) => p.trim());
      if (commas.length > 1 && commas.every((p) => isStructured(parsePiece(p)))) pieces = commas;
    }
    for (const p of pieces) {
      any = true;
      const r = parsePiece(p);
      if (r.warning) warnings.push(r.warning);
      if (r.effect) effects.push(r.effect);
      if (!isStructured(r)) complete = false;
    }
  }
  return { effects, warnings, complete: any && complete };
}
function formatEffects(effects) {
  return (effects || []).map((e) => {
    if (e.kind === "numeric") {
      return `${e.n < 0 ? "-" : "+"}${Math.abs(e.n)} ${e.category}${e.focus ? `: ${escSemi(e.focus)}` : ""}`;
    }
    if (e.kind === "proficiency") return `proficiency: ${escSemi(e.skill)}`;
    return escSemi(e.text);
  }).join("; ");
}
function trailingParen(piece) {
  if (!piece.endsWith(")")) return null;
  let depth = 0;
  for (let i = piece.length - 1; i >= 0; i--) {
    if (piece[i] === ")") depth++;
    else if (piece[i] === "(" && --depth === 0) {
      const name = piece.slice(0, i).trim();
      return name ? { name, inner: piece.slice(i + 1, -1).trim() } : null;
    }
  }
  return null;
}
var baseName = (name) => trailingParen(name)?.name ?? name;
function cleanPiece(raw) {
  let text = raw.trim();
  const dropped = [];
  if (/^(status|mods)\s*:/i.test(text)) return { text: "", dropped: [text] };
  const prior = text.match(/^(all prior|all previous)\s*\+\s*/i);
  if (prior) {
    dropped.push(prior[1]);
    text = text.slice(prior[0].length);
  }
  for (let prev = ""; prev !== text; ) {
    prev = text;
    text = text.replace(/^\+\s*/, "").replace(/^NEW\s*:\s*/i, "").trim();
  }
  if (!text || JUNK.test(text)) {
    if (text) dropped.push(text);
    return { text: "", dropped };
  }
  return { text, dropped };
}
function mergeEntries(list) {
  const out = [], byKey = /* @__PURE__ */ new Map();
  for (const e of list || []) {
    const key2 = baseName(e.name).toLowerCase();
    const have = byKey.get(key2);
    if (!have) {
      const copy = { name: e.name, effects: [...e.effects || []], hint: e.hint || "" };
      byKey.set(key2, copy);
      out.push(copy);
      continue;
    }
    if (have.name !== e.name) have.name = baseName(have.name);
    if (!have.effects.length && e.effects?.length) {
      have.effects = [...e.effects];
      have.hint = "";
    } else if (!have.effects.length && !have.hint && e.hint) have.hint = e.hint;
  }
  return out;
}
function readLegacyList(text) {
  const flat = String(text ?? "");
  const seps = splitTop(flat, ";").length > 1 ? ";|" : ",|";
  const entries = [], dropped = [];
  for (const raw of splitTop(flat, seps)) {
    const c = cleanPiece(raw);
    dropped.push(...c.dropped);
    if (!c.text) continue;
    const paren = trailingParen(c.text);
    if (paren) {
      const parsed = parseEffects(paren.inner, { legacy: true });
      if (parsed.complete && parsed.effects.length) {
        entries.push({ name: paren.name, effects: parsed.effects, hint: "" });
        continue;
      }
      if (HAS_SIGNED_NUMBER.test(fold(paren.inner))) {
        entries.push({ name: paren.name, effects: [], hint: paren.inner });
        continue;
      }
    }
    entries.push({ name: c.text, effects: [], hint: "" });
  }
  return { entries: mergeEntries(entries), dropped };
}

// src/model/config.js
var DEFAULT_AXES = [
  { key: "E", name: "Eros", kind: "fond", mirror: "M", period: 5, threshold: 10, meaning: "romantic fondness" },
  { key: "M", name: "Misos", kind: "friction", mirror: "E", period: 5, threshold: 10, meaning: "romantic friction" },
  { key: "L", name: "Ludus", kind: "fond", mirror: "Er", period: 3, threshold: 8, meaning: "playful fondness" },
  { key: "Er", name: "Eris", kind: "friction", mirror: "L", period: 3, threshold: 8, meaning: "playful friction" },
  { key: "Ph", name: "Philia", kind: "fond", mirror: "Ec", period: 5, threshold: 10, meaning: "friendship fondness" },
  { key: "Ec", name: "Echthros", kind: "friction", mirror: "Ph", period: 5, threshold: 10, meaning: "friendship friction" },
  { key: "Pr", name: "Pragma", kind: "fond", mirror: "St", period: 7, threshold: 12, meaning: "practical fondness" },
  { key: "St", name: "Stasis", kind: "friction", mirror: "Pr", period: 7, threshold: 12, meaning: "practical friction" },
  { key: "Sg", name: "Storge", kind: "fond", mirror: "Ad", period: 11, threshold: 12, meaning: "familial fondness" },
  { key: "Ad", name: "Adiaphora", kind: "friction", mirror: "Sg", period: 11, threshold: 12, meaning: "familial friction" },
  { key: "Ag", name: "Agape", kind: "fond", mirror: "Pt", period: 7, threshold: 10, meaning: "selfless fondness" },
  { key: "Pt", name: "Phthonos", kind: "friction", mirror: "Ag", period: 7, threshold: 10, meaning: "giving friction / resentment" }
];
var DEFAULT_RELATION_CONFIG = {
  axes: DEFAULT_AXES,
  axisMin: 1,
  // "NEVER 0"
  axisMax: 20,
  tickCap: 2,
  // +2 per accumulator per turn
  directMax: 2,
  // DIRECT_SHIFT is +1 or +2
  phi: { min: -20, max: 20, accCap: 30, period: 23, threshold: 12 },
  // MIRROR DECAY: on each period, if the gap between a pair is ≥ lead, the trailing
  // axis loses 1, never below floor = min(floorMax, max(1, ⌈leading / floorDivisor⌉)).
  decay: [
    { pair: ["L", "Er"], period: 6 },
    { pair: ["E", "M"], period: 10 },
    { pair: ["Ph", "Ec"], period: 10 },
    { pair: ["Ag", "Pt"], period: 14 },
    { pair: ["Pr", "St"], period: 14 },
    { pair: ["Sg", "Ad"], period: 22 }
  ],
  decayLead: 5,
  floorDivisor: 4,
  floorMax: 4,
  offstageSkip: [4, 8, 12, 15],
  // trailing value at which an offstage pair does not decay
  wallMin: 5,
  // WALL: tied pair, both ≥ this → conversion and decay freeze
  gravityMin: 6,
  // GRAVITY WELL: fondness converts while its mirror ≥ this → mirror acc +1
  romanceGate: { E: 6, L: 6 },
  // romantic/sexual initiation allowed when E or L reaches these
  tiers: [
    { min: 1, max: 5, fond: "Fond", friction: "Distant" },
    { min: 6, max: 10, fond: "Affectionate", friction: "Cold" },
    { min: 11, max: 15, fond: "Devoted", friction: "Hostile" },
    { min: 16, max: 20, fond: "Ultimate", friction: "Murderous" }
  ]
};
var DEFAULT_SECTION_CONFIG = {
  lastBeats: 3,
  // 🧾 LAST keeps this many newest beats
  chekhov: {
    eligibleAge: 6,
    // a bullet may fire from this age
    pruneAge: 12,
    // unfired bullets this old are pruned to Fired
    cap: 20,
    // at most this many active bullets
    maxLoadsPerTurn: 1,
    // more loads in one reply are kept but warned about
    firedKeep: 10,
    // Fired keeps this many newest; 0 = all
    firing: "fate"
    // Fate's pick; "model" keeps the reader-selected timing.
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
    residueKeep: 12
  },
  titles: {
    softCap: 3,
    // title bonuses above this are soft-capped
    hardCap: 6,
    // no title bonus may exceed this
    situationalMax: 2,
    // situational titles applied at most this often
    retrofitBatch: 10
    // titles retrofitted per batch
  },
  worldsim: {
    standard: [
      { from: 1, to: 2, name: "CALM", text: "The wider world goes on without a notable interruption" },
      { from: 3, to: 4, name: "GOOD NEWS", text: "A community gets a small relief or useful opening" },
      { from: 5, to: 6, name: "BAD NEWS", text: "A shortage, closure, or loss adds ordinary pressure somewhere nearby" },
      { from: 7, to: 8, name: "RUMOUR", text: "A rumor spreads, mixing one true detail with speculation" },
      { from: 9, to: 10, name: "OPPORTUNITY", text: "A trade, job, or request offers a practical chance" },
      { from: 11, to: 12, name: "DISRUPTION", text: "Weather, transit, or a service interrupts someone's plans" },
      { from: 13, to: 14, name: "CONFLICT", text: "A dispute between groups becomes public" },
      { from: 15, to: 16, name: "ARRIVAL", text: "A newcomer or convoy brings unfamiliar needs or news" },
      { from: 17, to: 18, name: "CRISIS", text: "A regional incident calls for an immediate response" },
      { from: 19, to: 20, name: "CALM", text: "The wider world goes on without a notable interruption" }
    ],
    duo: [
      { from: 1, to: 2, name: "CALM", text: "Nothing outside the moment demands their attention" },
      { from: 3, to: 4, name: "GOOD NEWS", text: "A small kindness or success eases their day" },
      { from: 5, to: 6, name: "MISUNDERSTANDING", text: "A comment lands badly and needs clarification" },
      { from: 7, to: 8, name: "INTERRUPTION", text: "A personal errand or small need complicates the moment" },
      { from: 9, to: 10, name: "OPENING", text: "A shared interest or offer creates a chance to connect" },
      { from: 11, to: 12, name: "TENSION", text: "A private worry or unmet need surfaces between them" },
      { from: 13, to: 14, name: "COMPLICATION", text: "Something they planned goes wrong and needs coordination" },
      { from: 15, to: 16, name: "REVELATION", text: "Someone shares a small personal detail they may keep private" },
      { from: 17, to: 18, name: "PRESSURE", text: "A difficult personal choice or boundary lands in the moment" },
      { from: 19, to: 20, name: "CALM", text: "Nothing outside the moment demands their attention" }
    ]
  }
};
function resolveConfig(overrides) {
  const base = JSON.parse(JSON.stringify(DEFAULT_RELATION_CONFIG));
  base.sectionConfig = JSON.parse(JSON.stringify(DEFAULT_SECTION_CONFIG));
  const sc = overrides && typeof overrides === "object" ? overrides.sectionConfig : null;
  if (sc && typeof sc === "object") {
    for (const [k, v] of Object.entries(sc)) {
      if (k === "chekhov" && v && typeof v === "object") base.sectionConfig.chekhov = validChekhov(v, base.sectionConfig.chekhov);
      else if (k === "fate" && v && typeof v === "object") base.sectionConfig.fate = mergeKnown(base.sectionConfig.fate, v);
      else if (k === "worldsim" && v && typeof v === "object") base.sectionConfig.worldsim = mergeKnown(base.sectionConfig.worldsim, v);
      else if (k === "titles" && v && typeof v === "object") base.sectionConfig.titles = sanitizeTitles(v, base.sectionConfig.titles);
      else if (k in base.sectionConfig && typeof v === typeof base.sectionConfig[k]) base.sectionConfig[k] = v;
    }
  }
  if (!overrides || typeof overrides !== "object") return base;
  for (const [k, v] of Object.entries(overrides)) {
    if (!(k in base)) continue;
    if (k === "sectionConfig") continue;
    if (Array.isArray(base[k])) base[k] = Array.isArray(v) ? JSON.parse(JSON.stringify(v)) : base[k];
    else if (base[k] && typeof base[k] === "object") base[k] = { ...base[k], ...v || {} };
    else if (typeof v === typeof base[k]) base[k] = v;
  }
  return base;
}
var axisByKey = (config, key2) => config.axes.find((a) => a.key === key2);
function mergeKnown(defaults, input) {
  const out = JSON.parse(JSON.stringify(defaults));
  for (const [key2, value2] of Object.entries(input || {})) {
    if (!(key2 in defaults)) continue;
    const initial = defaults[key2];
    if (Array.isArray(initial)) {
      if (Array.isArray(value2)) out[key2] = JSON.parse(JSON.stringify(value2));
    } else if (initial && typeof initial === "object") {
      if (value2 && typeof value2 === "object" && !Array.isArray(value2)) out[key2] = mergeKnown(initial, value2);
    } else if (typeof value2 === typeof initial && (typeof value2 !== "number" || Number.isFinite(value2))) out[key2] = value2;
  }
  return out;
}
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
function sanitizeChekhov(input, prev) {
  const num = (k, min) => {
    const raw = input[k];
    if (raw === void 0 || raw === null || String(raw).trim() === "" || !Number.isFinite(Number(raw))) return prev[k];
    return Math.max(min, Math.round(Number(raw)));
  };
  const out = {
    eligibleAge: num("eligibleAge", 0),
    pruneAge: num("pruneAge", 1),
    cap: num("cap", 1),
    maxLoadsPerTurn: num("maxLoadsPerTurn", 1),
    firedKeep: num("firedKeep", 0),
    firing: input.firing === "fate" ? "fate" : "model"
  };
  if (out.pruneAge <= out.eligibleAge) out.pruneAge = out.eligibleAge + 1;
  return out;
}
function sanitizeTitles(input = {}, prev = DEFAULT_SECTION_CONFIG.titles) {
  const num = (k, min, max) => {
    const raw = input[k];
    if (raw === void 0 || raw === null || String(raw).trim() === "" || !Number.isFinite(Number(raw))) return prev[k];
    return Math.min(max, Math.max(min, Math.round(Number(raw))));
  };
  const hardCap = num("hardCap", 0, 20);
  return {
    softCap: Math.min(num("softCap", 0, 20), hardCap),
    hardCap,
    situationalMax: num("situationalMax", 0, 5),
    retrofitBatch: num("retrofitBatch", 1, 30)
  };
}
function sanitizeFate(input = {}, prev = DEFAULT_SECTION_CONFIG.fate) {
  const out = JSON.parse(JSON.stringify(prev));
  for (const key2 of ["deferredExpire", "worldKeep", "reach1Drop", "pursuitLimit", "residueKeep"]) {
    const raw = input[key2];
    if (raw === void 0 || raw === null || String(raw).trim() === "" || !Number.isFinite(Number(raw))) continue;
    out[key2] = Math.max(1, Math.round(Number(raw)));
  }
  return out;
}

// src/model/sections/inventory.js
function effectLines(titles, status) {
  const by = { physical: [], social: [], mental: [] }, skills = [], notes = [], plain2 = [];
  const take = (e) => {
    for (const f of e.effects) {
      if (f.kind === "numeric") (by[f.category] ||= []).push(`${e.name} ${f.n < 0 ? "-" : "+"}${Math.abs(f.n)}${f.focus ? ` (${f.focus})` : ""}`);
      else if (f.kind === "proficiency") skills.push(`${f.skill} (${e.name})`);
      else notes.push(`${e.name} — ${f.text}`);
    }
  };
  const needs = titles.map(toEntry).filter((e) => !e.effects.length).length;
  titles.map(toEntry).forEach(take);
  for (const e of status.map(toEntry)) {
    take(e);
    if (!e.effects.length) plain2.push(e.name);
  }
  const lines2 = Object.entries(by).filter(([, v]) => v.length).map(([k, v]) => `${k}: ${v.join("; ")}`);
  if (skills.length) lines2.push(`proficiency: ${skills.join("; ")}`);
  if (notes.length) lines2.push(`narrative: ${notes.join("; ")}`);
  if (plain2.length) lines2.push(`status: ${plain2.join("; ")}`);
  if (needs) lines2.push(`needs effect: ${needs}`);
  return lines2;
}
var COMMANDS6 = [
  { id: "inv.add", form: "+ item", example: "+ brass key", keywords: [] },
  { id: "inv.remove", form: "- item", example: "- brass key", keywords: [] },
  { id: "inv.remove-id", form: "- I# (why)", example: "- I1 (left behind)", keywords: [] },
  { id: "inv.update", form: "I# update: description", example: "I1 update: brass key (on Jan)", keywords: ["update"] },
  { id: "inv.money-set", form: "money: amount currency", example: "money: 50 USD", keywords: ["money"] },
  { id: "inv.money-add", form: "money + amount currency (why)", example: "money + 5 USD (refund)", keywords: ["money"] },
  { id: "inv.money-spend", form: "money - amount currency (why)", example: "money - 18 USD (purchase)", keywords: ["money"] },
  { id: "inv.supply", form: "supply: amount unit | item", example: "supply: 12 rounds | 9mm ammunition", keywords: ["supply"] },
  { id: "inv.quantity", form: "I# quantity: amount unit", example: "I1 quantity: 12 rounds", keywords: ["quantity"] },
  { id: "inv.adjust", form: "I# adjust: delta (why)", example: "I1 adjust: -3 (fired)", keywords: ["adjust"] },
  { id: "inv.title-add", form: "title: name | effects", example: "title: Harbour Friend | +1 social: dockworkers", keywords: ["title"] },
  { id: "inv.title-remove", form: "title - name", example: "title - Harbour Friend", keywords: ["title"] },
  { id: "inv.status-add", form: "status + condition | effects", example: "status + Legs spent | -2 physical: running", keywords: ["status"] },
  { id: "inv.status-remove", form: "status - condition", example: "status - Tired", keywords: ["status"] }
];
var ROWS = [["items", "Inv"], ["titles", "Titles/Skills"], ["status", "Status"]];
var ENTRY_ROWS = { title: "titles", condition: "status" };
var readList = (text) => {
  const t = String(text || "").trim();
  if (!t || t === "—") return [];
  return t.split(/(?<!&(?:amp|lt|gt|#\d+));\s*/).map((v) => unesc(v.replace(/&#59;/g, ";"))).filter(Boolean);
};
var same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
var nameOf = (e) => typeof e === "string" ? e : e.name;
var toEntry = (e) => typeof e === "string" ? { name: e, effects: [], hint: "" } : { name: e.name, effects: structuredClone(e.effects || []), hint: e.hint || "" };
var entryNames = (list) => (list || []).map(nameOf);
function normalizeInv(inv) {
  if (!inv) return inv;
  for (const k of ["titles", "status"]) inv[k] = (inv[k] || []).map(toEntry);
  delete inv.mods;
  return inv;
}
function writeEntry(e, title) {
  const effects = e.effects.length ? esc(formatEffects(e.effects)).replace(/&amp;#59;/g, "&#59;") : "";
  if (effects) return `${esc(e.name)} | ${effects}`;
  return title || e.hint ? `${esc(e.name)} | needs effect${e.hint ? ` — old: ${esc(e.hint)}` : ""}` : esc(e.name);
}
function readEntry(raw) {
  const text = String(raw || "");
  for (let at = text.lastIndexOf(" | "); at >= 0; at = text.lastIndexOf(" | ", at - 1)) {
    const name = unesc(text.slice(0, at)), right = unesc(text.slice(at + 3));
    if (!name) break;
    const marker = right.match(/^needs effect\b(?:\s*—\s*old:\s*([\s\S]*))?/i);
    if (marker) return { name, effects: [], hint: (marker[1] || "").trim() };
    const { effects } = parseEffects(right);
    if (effects.length) return { name, effects, hint: "" };
  }
  return { name: unesc(text), effects: [], hint: "" };
}
function readLegacyRow(raw) {
  const decoded = String(raw || "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;(?!#(?:59|124);)/g, "&");
  const back = (s) => s.replace(/&#124;/g, "|").replace(/&#59;/g, ";").replace(/&amp;/g, "&");
  return readLegacyList(decoded).entries.map((e) => ({ ...e, name: back(e.name), hint: back(e.hint) }));
}
function modsRow(value2) {
  const { hardCap } = resolveConfig().sectionConfig.titles;
  const sums = { physical: 0, social: 0, mental: 0 };
  for (const e of [...value2.titles, ...value2.status]) for (const f of e.effects) if (f.kind === "numeric" && f.n > 0) sums[f.category] += f.n;
  return Object.entries(sums).map(([k, n]) => n ? `${k} +${n}${n > hardCap ? ` raw (capped +${hardCap} per roll)` : ""}` : `${k} —`).join(" · ");
}
var EXPLAINED = /\s+\((?:dropped|lost|used|left|given|consumed|discarded|spent|handed)\b[^()]*\)\s*$/i;
var itemKey = (text) => foldQuotes(text).trim().replace(/^1\s+/, "").toLowerCase();
var validId = (id) => /^I[1-9]\d*$/i.test(String(id)) && Number.isSafeInteger(Number(String(id).slice(1)));
function ensureItemIds(state, prevInv) {
  const inv = normalizeInv(state.inv);
  if (!inv || !inv.items.length && !inv.itemIds) return;
  const rawIds = inv.itemIds || [];
  const claimed = new Set(rawIds.filter(validId).map((id) => id.toUpperCase()));
  const reserved = [...rawIds, ...prevInv?.itemIds || []].filter(validId).map((id) => id.toUpperCase());
  if (reserved.length) {
    state.ids = state.ids || {};
    state.ids.I = Math.max(state.ids.I || 0, ...reserved.map((id) => Number(id.slice(1))));
  }
  const used = /* @__PURE__ */ new Set();
  inv.itemIds = inv.items.map((item, i) => {
    let id = validId(rawIds[i]) ? rawIds[i].toUpperCase() : null;
    if (!id && prevInv?.itemIds) {
      const old = prevInv.items.findIndex((value2, j) => same(value2, item) && validId(prevInv.itemIds[j]) && !used.has(prevInv.itemIds[j].toUpperCase()) && !claimed.has(prevInv.itemIds[j].toUpperCase()));
      if (old >= 0) id = prevInv.itemIds[old].toUpperCase();
    }
    if (!id || used.has(id)) id = nextId(state, "I", reserved);
    used.add(id);
    return id;
  });
}
function baseItem(text) {
  let value2 = text.trim();
  while (value2.endsWith(")")) {
    let depth = 0, start = -1;
    for (let i = value2.length - 1; i >= 0; i--) {
      if (value2[i] === ")") depth++;
      else if (value2[i] === "(" && --depth === 0) {
        start = i;
        break;
      }
    }
    if (start <= 0 || !/\s/.test(value2[start - 1])) break;
    value2 = value2.slice(0, start).trimEnd();
  }
  return itemKey(value2);
}
function removalNote(text) {
  const note = text.trim();
  if (!note) return true;
  if (note[0] !== "(") return false;
  let depth = 0;
  for (let i = 0; i < note.length; i++) {
    if (note[i] === "(") depth++;
    else if (note[i] === ")") depth--;
    else if (depth === 0 && !/\s/.test(note[i])) return false;
    if (depth < 0) return false;
  }
  return depth === 0;
}
var NUMBER = /^(\d+(?:\.\d+)?|\.\d+)([\s\S]*)$/;
var CURRENCY = /^(?:[\p{L}][\p{L}\p{N}_-]*|[$€£¥₹₽₩₿])$/u;
function measured(text, money = false) {
  const source = text.trim();
  const prefix = money && source.match(/^([$€£¥₹₽₩₿])\s*(.*)$/u);
  const number = (prefix ? prefix[2] : source).match(NUMBER);
  if (!number) return null;
  if (/^(?:[.,/+-]|[eE][+-]?\d)/.test(number[2])) return null;
  const rest = number[2].trim(), noteAt = rest.indexOf("(");
  const unit = (noteAt < 0 ? rest : rest.slice(0, noteAt)).trim();
  if (!removalNote(noteAt < 0 ? "" : rest.slice(noteAt))) return null;
  if (prefix && unit) return null;
  const label = prefix ? prefix[1] : unit;
  if (money ? label && !CURRENCY.test(label) : !label || /[|]/.test(label)) return null;
  return { amount: decimal(number[1]), unit: money ? label.toUpperCase() : label };
}
function moneyChange(inv, line, ctx) {
  const command = closedForm(line).match(/^money\s*(:|[+-])\s*(.*)$/i);
  if (!command) return false;
  const value2 = measured(command[2], true);
  if (!value2) return false;
  const keys = Object.keys(inv.money || {});
  const currency = value2.unit || (keys.length === 1 ? keys[0] : keys.length === 0 && command[1] === ":" ? "" : null);
  const refuse = (text) => {
    ctx?.warnings?.push({ section: "Inventory", line, text });
    return false;
  };
  if (currency === null) return refuse(keys.length ? "Money currency is ambiguous; copy the currency from the intended balance." : "Money has no starting balance. Initialize the known pre-transaction amount and currency with money: before applying this change.");
  if (command[1] === ":") {
    inv.money = { ...inv.money || {}, [currency]: value2.amount };
    return true;
  }
  if (!Object.hasOwn(inv.money || {}, currency)) return refuse(`Money has no starting balance for ${currency}. Initialize its known pre-transaction amount with money: before applying this change.`);
  const next = adjustDecimal(inv.money[currency], command[1] + value2.amount);
  if (next === null) return refuse(`Insufficient Money: balance ${inv.money[currency]}${currency ? ` ${currency}` : ""}, expense ${value2.amount}${currency ? ` ${currency}` : ""}. Balance unchanged; report any actual income first or correct the known balance.`);
  inv.money[currency] = next;
  return true;
}
function removeEntry(inv, at) {
  const id = inv.itemIds[at];
  inv.items.splice(at, 1);
  inv.itemIds.splice(at, 1);
  if (inv.supplies) {
    delete inv.supplies[id];
    if (!Object.keys(inv.supplies).length) delete inv.supplies;
  }
}
function itemIndex(list, text, rawText, normalized) {
  if (normalized) {
    const hits = nameMatches(list, text, rawText);
    if (hits.length) return hits[0];
    if (hasFoldedName(list, text)) return -1;
    const base = baseItem(text);
    const candidates = list.flatMap((value2, i) => base && baseItem(value2) === base ? [i] : []);
    return candidates.length === 1 ? candidates[0] : -1;
  }
  let at = list.findIndex((value2) => same(value2, text));
  if (at >= 0) return at;
  const item = text.replace(EXPLAINED, "").trim();
  at = list.findIndex((value2) => same(value2, item));
  if (at >= 0) return at;
  const single = item.match(/^1\s+(.+)$/);
  return single ? list.findIndex((value2) => same(value2, single[1])) : -1;
}
var hasFoldedName = (list, text) => list.some((value2) => same(foldQuotes(nameOf(value2)), foldQuotes(text)));
function removeStatus(list, text, rawText, del, normalized) {
  if (del(list, text, rawText)) return true;
  if (!normalized || hasFoldedName(list, text)) return false;
  const converted = /\s+converted\s+to\s+\S.*$/i;
  const name = text.replace(converted, "").trim();
  const rawName = rawText === void 0 ? void 0 : rawText.replace(converted, "").trim();
  if (name !== text) {
    if (del(list, name, rawName)) return true;
    if (hasFoldedName(list, name)) return false;
  }
  return true;
}
var inventory_default = {
  key: "inv",
  title: "🎒 INV & SKILLS",
  match: /^INV SKILLS$/,
  change: "Inventory",
  aliases: ["Inv", "Inv & Skills"],
  carried: true,
  empty: () => ({ items: [], titles: [], status: [] }),
  render: (value2) => [
    ...Object.entries(value2.money || {}).map(([currency, amount]) => `- <b>Money${currency ? ` ${esc(currency)}` : ""}:</b> ${amount}`),
    ...value2.items.length ? value2.items.map((item, i) => {
      const id = value2.itemIds[i], supply = value2.supplies?.[id];
      return supply ? `- <b>Supply ${id}:</b> amount: ${supply.amount} | unit: ${esc(supply.unit)} | item: ${esc(item)}` : `- <b>Item ${id}:</b> ${esc(item)}`;
    }) : ["- <b>Inv:</b> —"],
    ...value2.titles.map((e) => `- <b>Title:</b> ${writeEntry(e, true)}`),
    ...value2.status.map((e) => `- <b>Condition:</b> ${writeEntry(e, false)}`),
    `- <b>Mods:</b> ${modsRow(value2)}`
  ],
  parse(rows, prevValue) {
    const value2 = { items: [], titles: [], status: [] }, errors = [];
    const itemIds = [], seen = /* @__PURE__ */ new Set();
    let itemError = false, moneyError = false;
    for (const row of rows) {
      const m = row.match(ROW);
      const label = m && m[1].replace(/:\s*$/, "").trim().toLowerCase();
      const hit = m && ROWS.find(([, l]) => l.toLowerCase() === label);
      const entryKey = m && Object.hasOwn(ENTRY_ROWS, label) && ENTRY_ROWS[label];
      const item = m && m[1].match(/^Item\s+(I\d+)\s*:?\s*$/i);
      const money = m && m[1].match(/^Money(?:\s+([^:]+))?\s*:?\s*$/i);
      const supply = m && m[1].match(/^Supply\s+(I\d+)\s*:?\s*$/i);
      if (money) {
        const currency = unesc(money[1] || "").toUpperCase(), amount = decimal(unesc(m[2]));
        if (currency && !CURRENCY.test(currency) || amount === null || Object.hasOwn(value2.money || {}, currency)) {
          errors.push(row);
          moneyError = true;
        } else value2.money = { ...value2.money || {}, [currency]: amount };
      } else if (supply) {
        const fields = m[2].match(/^amount:\s*([^|]+)\|\s*unit:\s*([^|]+)\|\s*item:\s*(\S.*)$/);
        const id = supply[1].toUpperCase(), amount = fields && decimal(fields[1]);
        if (!validId(id) || !fields || amount === null || !unesc(fields[2]) || seen.has(id)) {
          errors.push(row);
          itemError = true;
        } else {
          value2.items.push(unesc(fields[3]));
          itemIds.push(id);
          seen.add(id);
          value2.supplies = value2.supplies || {};
          value2.supplies[id] = { amount, unit: unesc(fields[2]) };
        }
      } else if (item && validId(item[1]) && unesc(m[2]) && !seen.has(item[1].toUpperCase())) {
        value2.items.push(unesc(m[2]));
        itemIds.push(item[1].toUpperCase());
        seen.add(item[1].toUpperCase());
      } else if (m && /^Item\b/i.test(m[1])) {
        errors.push(row);
        itemError = true;
      } else if (hit && hit[0] === "items") {
        const items = readList(m[2]);
        value2.items.push(...items);
        itemIds.push(...items.map(() => null));
      } else if (entryKey && !unesc(m[2])) {
      } else if (entryKey) value2[entryKey].push(readEntry(m[2]));
      else if (hit) value2[hit[0]].push(...readLegacyRow(m[2]));
      else if (label === "mods") {
      } else {
        errors.push(row);
        itemError = true;
        moneyError = true;
      }
    }
    if (itemIds.length) value2.itemIds = itemIds;
    value2.titles = mergeEntries(value2.titles);
    value2.status = mergeEntries(value2.status);
    if (errors.length && prevValue) {
      for (const k of ["items", "titles", "status"]) if (!value2[k].length || k === "items" && itemError) {
        value2[k] = k === "items" ? [...prevValue[k]] : (prevValue[k] || []).map(toEntry);
        if (k === "items") {
          if (prevValue.itemIds) value2.itemIds = [...prevValue.itemIds];
          else delete value2.itemIds;
          if (prevValue.supplies) value2.supplies = structuredClone(prevValue.supplies);
          else delete value2.supplies;
        }
      }
    }
    if (moneyError && prevValue) {
      if (prevValue.money) value2.money = { ...prevValue.money };
      else delete value2.money;
    }
    return { value: value2, errors };
  },
  apply(state, lines2, ctx) {
    const inv = state.inv;
    ensureItemIds(state);
    const unparsed = [];
    const normalized = Boolean(ctx && ctx.normalizedChanges);
    const raws = normalized ? ctx.rawLinesUnder("Inventory") : [];
    const del = (list, v, raw) => {
      const names = entryNames(list);
      const at = normalized ? nameMatches(names, v, raw)[0] ?? -1 : names.findIndex((x) => same(x, v));
      if (at < 0) return false;
      list.splice(at, 1);
      return true;
    };
    const entry2 = (name) => ({ name: name.trim(), effects: [], hint: "" });
    const warn = (line, text) => ctx?.warnings?.push({ section: "Inventory", line, text });
    const find = (list, name, raw) => {
      const names = entryNames(list);
      return normalized ? nameMatches(names, name, raw)[0] ?? -1 : names.findIndex((x) => same(x, name));
    };
    const withEffects = (text, rawText) => {
      const bar = text.indexOf("|");
      if (bar < 0) return null;
      if (!text.slice(0, bar).trim()) return { bad: true };
      const rawBar = rawText === void 0 ? -1 : rawText.indexOf("|");
      return { name: text.slice(0, bar).trim(), rawName: rawBar < 0 ? void 0 : rawText.slice(0, rawBar).trim(), ...parseEffects(text.slice(bar + 1)) };
    };
    const needsEffect = (line, name) => warn(line, `"${name}" needs an effect — give it one with title: ${name} | effects.`);
    const setEntry = (list, line, parsed, title) => {
      for (const w of parsed.warnings) warn(line, `Effect ignored: ${w}.`);
      const at = find(list, parsed.name, parsed.rawName);
      if (at < 0) list.push({ name: parsed.name, effects: parsed.effects, hint: "" });
      else if (parsed.effects.length) {
        list[at].effects = parsed.effects;
        list[at].hint = "";
      }
      if (title && !(at < 0 ? parsed.effects : list[at].effects).length) needsEffect(line, parsed.name);
    };
    lines2.forEach((text, i) => {
      const line = String(text).trim();
      const rawLine = normalized && raws[i] !== void 0 ? String(raws[i]).trim() : null;
      const rawOf = (re) => {
        const r = rawLine && rawLine.match(re);
        return r ? r[1] : void 0;
      };
      let m;
      if (normalized && /^money\b/i.test(line)) {
        if (!moneyChange(inv, line, ctx)) unparsed.push(line);
      } else if (normalized && /^(?:supply\b|\+\s*supply\s*:)/i.test(line)) {
        m = line.match(/^(?:\+\s*)?supply\s*:\s*(.*?)\s*\|\s*(\S[\s\S]*)$/i);
        const quantity = m && measured(m[1]);
        if (!quantity) unparsed.push(line);
        else {
          const id = nextId(state, "I", inv.itemIds || []);
          inv.items.push(m[2].trim());
          inv.itemIds = inv.itemIds || [];
          inv.itemIds.push(id);
          inv.supplies = { ...inv.supplies || {}, [id]: quantity };
        }
      } else if (normalized && (m = line.match(/^(I\d+)\s+(quantity|adjust)\s*:\s*(.*)$/i))) {
        const id = m[1].toUpperCase(), at = (inv.itemIds || []).indexOf(id);
        if (m[2].toLowerCase() === "quantity") {
          const quantity = measured(m[3]);
          if (at < 0 || !quantity) unparsed.push(line);
          else inv.supplies = { ...inv.supplies || {}, [id]: quantity };
        } else {
          const adjustment = closedForm(m[3]).match(/^([+-])\s*(\d+(?:\.\d+)?|\.\d+)([\s\S]*)$/);
          const supply = inv.supplies?.[id];
          const next = supply && adjustment && removalNote(adjustment[3]) ? adjustDecimal(supply.amount, adjustment[1] + adjustment[2]) : null;
          if (at < 0 || next === null) unparsed.push(line);
          else supply.amount = next;
        }
      } else if (normalized && (m = line.match(/^(I\d+)\s+update\s*:\s*(.*)$/i))) {
        const at = (inv.itemIds || []).indexOf(m[1].toUpperCase());
        if (at < 0 || !m[2].trim()) unparsed.push(line);
        else inv.items[at] = m[2].trim();
      } else if (normalized && /^-\s*I\d+\b/i.test(line)) {
        m = closedForm(line).match(/^-\s*(I\d+)\b([\s\S]*)$/i);
        const at = m && (removalNote(m[2]) || /^\s*:\s*\S/.test(m[2])) ? (inv.itemIds || []).indexOf(m[1].toUpperCase()) : -1;
        if (at < 0) unparsed.push(line);
        else removeEntry(inv, at);
      } else if (m = line.match(/^title\s*:\s*(.+)$/i)) {
        const parsed = withEffects(m[1], rawOf(/^title\s*:\s*(.+)$/i));
        if (parsed?.bad) unparsed.push(line);
        else if (parsed) setEntry(inv.titles, line, parsed, true);
        else if (find(inv.titles, m[1].trim(), void 0) < 0) {
          inv.titles.push(entry2(m[1]));
          needsEffect(line, m[1].trim());
        }
      } else if (m = line.match(/^title\s*-\s*(.+)$/i)) {
        if (!del(inv.titles, m[1], rawOf(/^title\s*-\s*(.+)$/i))) unparsed.push(line);
      } else if (m = line.match(/^status\s*[:+]\s*(.+)$/i)) {
        const parsed = withEffects(m[1], rawOf(/^status\s*[:+]\s*(.+)$/i));
        if (parsed) {
          if (parsed.bad) unparsed.push(line);
          else setEntry(inv.status, line, parsed, false);
          return;
        }
        const conditions = readList(m[1]);
        if (!conditions.length) unparsed.push(line);
        for (const condition of conditions) if (!inv.status.some((t) => same(t.name, condition))) inv.status.push(entry2(condition));
      } else if (m = line.match(/^status\s*-\s*(.+)$/i)) {
        const rawValue = rawOf(/^status\s*-\s*(.+)$/i);
        if (del(inv.status, m[1], rawValue)) return;
        if (normalized && hasFoldedName(inv.status, m[1])) {
          unparsed.push(line);
          return;
        }
        const conditions = readList(m[1]);
        const rawConditions = rawValue === void 0 ? [] : readList(rawValue);
        const aligned = rawConditions.length === conditions.length;
        if (!conditions.length) unparsed.push(line);
        conditions.forEach((condition, j) => {
          if (!removeStatus(inv.status, condition, aligned ? rawConditions[j] : void 0, del, normalized)) unparsed.push(`status - ${condition}`);
        });
      } else if (/^mods\s*:/i.test(line)) warn(line, "Mods are computed from title and condition effects; use title: or status + with | effects.");
      else if (m = line.match(/^\+\s*(.+)$/)) {
        inv.items.push(m[1].trim());
        inv.itemIds = inv.itemIds || [];
        inv.itemIds.push(nextId(state, "I", inv.itemIds));
      } else if (m = line.match(/^-\s*(.+)$/)) {
        const at = itemIndex(inv.items, m[1], rawOf(/^-\s*(.+)$/), normalized);
        if (at < 0) unparsed.push(line);
        else removeEntry(inv, at);
      } else unparsed.push(line);
    });
    return unparsed;
  },
  prompt(value2, state) {
    const snapshot = { inv: { ...value2, items: [...value2.items], itemIds: value2.itemIds ? [...value2.itemIds] : void 0 }, ids: { ...state?.ids || {} } };
    ensureItemIds(snapshot);
    const parts = [];
    const money = Object.entries(value2.money || {}).map(([currency, amount]) => `${amount}${currency ? ` ${currency}` : ""}`);
    const supplies = [], items = [];
    value2.items.forEach((item, i) => {
      const id = snapshot.inv.itemIds[i], supply = value2.supplies?.[id];
      if (supply) supplies.push(`${id}: ${supply.amount} ${supply.unit} — ${item}`);
      else items.push(`${id}: ${item}`);
    });
    if (money.length) parts.push(`Money: ${money.join("; ")}`);
    if (supplies.length) parts.push(`Supplies: ${supplies.join("; ")}`);
    if (items.length) parts.push(`carries ${items.join("; ")}`);
    parts.push(...effectLines(value2.titles, value2.status));
    return parts.length ? `{{user}}: ${parts.join(" · ")}` : "";
  },
  facts(state, ctx) {
    const batch = ctx?.config?.sectionConfig?.titles?.retrofitBatch ?? resolveConfig().sectionConfig.titles.retrofitBatch;
    const need = (state.inv.titles || []).map(toEntry).filter((t) => !t.effects.length);
    if (!need.length) return [];
    const list = need.slice(0, batch).map((t) => t.hint ? `${t.name} (old: ${t.hint})` : t.name).join("; ");
    return [`Titles that need an effect (give each one this turn, from what happened in the story, with title: Name | effects): ${list}`];
  },
  rules: () => [
    "Money is a balance per currency, without item IDs. Initialize or explicitly correct it with `money: amount currency`; report actual income with `money + amount currency (why)` and spending with `money - amount currency (why)`. Before the FIRST income or expense in a currency, initialize its known PRE-TRANSACTION balance with a `money:` line in the same comment, BEFORE the delta. Cash carried over as an ordinary item does not initialize Money. Use the actual known total and currency from the story; if the total is unknown, do not invent it or emit a delta against an uninitialized balance. Report the amount actually handed over after any returned change, not just the price. Keep explanations inside parentheses after the amount and currency; explanations do not affect arithmetic. The ledger calculates balances; never restate a balance every turn. Copy the currency from Money; omit it only when there is one unambiguous balance. Do not infer a balance from a bill's denomination. Noteworthy bills remain ordinary items or counted supplies, and do not automatically alter Money. Removing a spent cash item is independent of reporting its money expense; never debit Money twice for the item removal.",
    "Supplies are counted or measured stacks (ammo, food, batteries, water), each with an I# ID. Create a new stack with `supply: amount unit | item`; convert an existing item or explicitly correct its count with `I# quantity: amount unit`. For partial use or replenishment, write a signed delta such as `I# adjust: -3 (used)` or `I# adjust: +5 (restocked)`; the ledger does the arithmetic. Reuse an existing ID rather than creating a new stack every turn. Keep ammo types, units and other distinct supplies separate. Quantity metadata is authoritative; a number in an item's description does not set its count. Zero balances and stacks retain identity for replenishment; adjustments cannot overdraw known amounts. A `- I#` line removes the whole entry.",
    "Inventory is {{user}}'s alone: add items with `+ item` when found; the ledger assigns their I# IDs. Prefer `- I# (why)` when lost or used, and `I# update: description` when an item's description or holder changes; copy an existing ID from the inventory, never invent one. Name removals also work: full name first, otherwise a unique base name ignoring trailing parenthetical notes; ambiguous items need an ID. IDs are not unit counts. Every new title needs at least one effect, written `title: Name | effects`, with effects separated by `;`: a numeric `±1 or ±2 category: focus`, such as `+2 social: Emilia` (negative for a penalty) where category is physical, social or mental and focus names what it applies to; `proficiency: skill` for a trained skill; or plain narrative text when it only changes how the story treats {{user}}. Example: `title: Mon Ancre | +2 social: Emilia; proficiency: diving`. Re-sending `title: Name | effects` for an existing title replaces its effects. Numeric effects are ±1 or ±2 only, and only in the category and focus they fit. Award a title for a real accomplishment. Track temporary conditions (Injured, Tired, Inspired) and clear them with time or action; a condition may carry the same effects: `status + Condition | effects`. Active conditions are in Status; condition text inside items or titles does not create a Status entry. For status removals, copy the existing condition name exactly, without explanations; clearing an already-absent condition is harmless. A changed condition needs two lines: `status - old condition` and `status + new condition`. Never put stats, modifiers or title names in prose."
  ].join("\n"),
  commands: COMMANDS6,
  template: (ctx) => commandTemplate("Inventory", COMMANDS6, ctx)
};

// src/model/sections/last.js
var COMMANDS7 = [
  { id: "last.beat", form: "a beat later turns must honour", example: "Mara promised to meet Jan at the mill at dawn", keywords: [], freeText: true }
];
var last_default = {
  key: "last",
  title: "🧾 LAST",
  match: /^LAST$/,
  change: "Last",
  aliases: ["Last beats"],
  carried: true,
  empty: () => [],
  render: (value2) => value2.map((b) => `- ${esc(b)}`),
  parse: (rows) => ({ value: rows.map((r) => unesc(r.replace(/^[-*•]\s*/, ""))).filter(Boolean), errors: [] }),
  apply(state, lines2) {
    for (const l of lines2) if (String(l).trim()) state.last.push(String(l).trim());
    return [];
  },
  after(state, ctx) {
    const keep = ctx.config.sectionConfig && ctx.config.sectionConfig.lastBeats || 3;
    if (state.last.length > keep) state.last = state.last.slice(-keep);
  },
  prompt: (value2) => value2.length ? `Last beats: ${value2.join(" / ")}` : "",
  rules: () => "Last: one line per concrete event or line of dialogue from this reply that later turns must honour.",
  commands: COMMANDS7,
  template: (ctx) => commandTemplate("Last", COMMANDS7, ctx)
};

// src/model/storytime.js
var dayOf = (text) => {
  const m = String(text || "").match(/\bDay\s+(\d+)\b/i);
  return m ? Number(m[1]) : null;
};
function minutesOf(text) {
  const t = String(text || "");
  if (/\bnoon\b|\bmidday\b/i.test(t) && !/\d{1,2}:\d{2}/.test(t)) return 12 * 60;
  if (/\bmidnight\b/i.test(t) && !/\d{1,2}:\d{2}/.test(t)) return 0;
  let m = t.match(/\b(\d{1,2}):(\d{2})\s*([ap])\.?\s*m\.?\b/i);
  if (m) return (Number(m[1]) % 12 + (m[3].toLowerCase() === "p" ? 12 : 0)) * 60 + Number(m[2]);
  m = t.match(/\b(\d{1,2}):(\d{2})\b/);
  if (m && Number(m[1]) < 24 && Number(m[2]) < 60) return Number(m[1]) * 60 + Number(m[2]);
  m = t.match(/\b(\d{1,2})\s*([ap])\.?\s*m\.?\b/i);
  if (m) return (Number(m[1]) % 12 + (m[2].toLowerCase() === "p" ? 12 : 0)) * 60;
  return null;
}
function parseStoryTime(text) {
  const minutes = minutesOf(text);
  return minutes === null ? null : { day: dayOf(text), minutes };
}
function lockTime(spec, now) {
  const minutes = minutesOf(spec);
  if (minutes === null) return null;
  const day = dayOf(spec);
  if (day !== null) return { day, minutes };
  const tomorrow = /\btomorrow\b/i.test(spec), today = /\btoday\b|\btonight\b/i.test(spec);
  if (!now) return { day: null, minutes };
  const later = tomorrow || !today && minutes < now.minutes;
  if (now.day === null || now.day === void 0) return later ? { day: null, minutes, wait: true } : { day: null, minutes };
  return { day: later ? now.day + 1 : now.day, minutes };
}
function isAtOrPast(now, at) {
  if (!now || !at) return false;
  const nowDay = now.day !== null && now.day !== void 0, atDay = at.day !== null && at.day !== void 0;
  if (atDay && !nowDay) return false;
  if (!atDay) return now.minutes >= at.minutes;
  return now.day > at.day || now.day === at.day && now.minutes >= at.minutes;
}

// src/model/sections/chekhov.js
var COMMANDS8 = [
  { id: "chekhov.load", form: "load: setup (w2, hot, at 18:00)", example: "load: the locked cellar door (w2, hot, at 18:00)", keywords: ["load", "hot", "at"] },
  { id: "chekhov.fire", form: "fire B#: how it paid off", example: "fire B1: the cellar held the missing ledgers", keywords: ["fire"] },
  { id: "chekhov.lock", form: "lock B#: why", example: "lock B1: Mara has the only key", keywords: ["lock"] },
  { id: "chekhov.unlock", form: "unlock B#", example: "unlock B1", keywords: ["unlock"] },
  { id: "chekhov.prune", form: "prune B#", example: "prune B1", keywords: ["prune"] }
];
var cfgOf = (ctx) => ctx && ctx.config && ctx.config.sectionConfig && ctx.config.sectionConfig.chekhov || {
  eligibleAge: 6,
  pruneAge: 12,
  cap: 20,
  maxLoadsPerTurn: 1,
  firedKeep: 10,
  firing: "model"
};
var fateFiring = (ctx) => cfgOf(ctx).firing === "fate" && (!ctx?.sections || ctx.sections.fate !== false);
var escTag = (v) => esc(v).replace(/·/g, "&#183;");
var unescTag = (v) => unesc(String(v).replace(/&#183;/g, "·"));
var pad = (n) => String(n).padStart(2, "0");
var clock = (at) => `${at.day !== null && at.day !== void 0 ? `Day ${at.day} ` : ""}${pad(Math.floor(at.minutes / 60))}:${pad(at.minutes % 60)}`;
var timeText = (at) => `${clock(at)}${at.wait ? " next-day" : ""}${at.hit ? " reached" : ""}`;
var byId2 = (list, id) => list.find((b) => b.id.toLowerCase() === String(id).toLowerCase());
var waitsOn = (b, state) => Boolean(b.after) && state.chekhov.bullets.some((x) => x !== b && x.id.toLowerCase() === b.after.toLowerCase());
var crowded = (b, state) => b.secret && (state.scene.present || []).length > 2;
var isLocked = (b, state) => Boolean(b.lock || b.at) || waitsOn(b, state);
function isDue(b, state) {
  if (!b.at || b.lock || waitsOn(b, state) || crowded(b, state)) return false;
  if (b.at.hit) return true;
  if (b.at.wait) return false;
  return isAtOrPast(parseStoryTime(state.scene.now), b.at);
}
var eligible = (b, state, cfg) => !isLocked(b, state) && b.age >= cfg.eligibleAge && !crowded(b, state);
function holdReasons(b, state, cfg) {
  const out = [];
  if (b.age < cfg.eligibleAge) out.push(`age ${b.age} of ${cfg.eligibleAge}`);
  if (b.lock) out.push(`held: ${b.lock}`);
  if (b.at && !isDue(b, state)) out.push(`time-locked until ${timeText(b.at)}`);
  if (waitsOn(b, state)) out.push(`waits for ${b.after}`);
  if (crowded(b, state)) out.push("a secret, and a crowd is present");
  return out;
}
var hotCount = (state) => (state.chekhov && state.chekhov.bullets || []).filter((b) => b.hot).length;
function toFired(state, b, how) {
  state.chekhov.bullets = state.chekhov.bullets.filter((x) => x !== b);
  state.chekhov.fired.push({ id: b.id, desc: b.desc, how });
}
function parseLoad(text, state) {
  const m = text.match(/^load\s*:\s*(.+?)\s*\(([^()]*)\)\s*$/i);
  if (!m) return null;
  const b = { desc: m[1].trim(), weight: 0, age: 0, hot: false, secret: false, lock: "", at: null, after: "" };
  for (const raw of m[2].split(",").map((t) => t.trim()).filter(Boolean)) {
    let o;
    if (o = raw.match(/^w\s*([123])$/i)) b.weight = Number(o[1]);
    else if (/^hot$/i.test(raw)) b.hot = true;
    else if (/^secret$/i.test(raw)) b.secret = true;
    else if (o = raw.match(/^at\s+(.+)$/i)) {
      b.at = lockTime(o[1], parseStoryTime(state.scene.now));
      if (!b.at) b.badAt = o[1];
    } else if (o = raw.match(/^after\s+(B\d+)$/i)) b.after = o[1].toUpperCase();
    else return null;
  }
  return b.weight ? b : null;
}
var chekhov_default = {
  key: "chekhov",
  title: "🔫 CHEKHOV'S GUN",
  match: /^CHEKHOV S GUN$/,
  change: "Chekhov",
  aliases: ["Chekhov's Gun", "Chekhovs Gun"],
  carried: true,
  empty: () => ({ bullets: [], fired: [] }),
  render(value2, ctx) {
    const cfg = cfgOf(ctx);
    const view = ctx && ctx.state ? { ...ctx.state, chekhov: value2 } : { chekhov: value2, scene: { now: "", present: [] } };
    return [
      ...value2.bullets.map((b) => {
        const tags = [`w${b.weight}`, `age ${b.age}/${cfg.pruneAge}`];
        if (b.hot) tags.push("hot");
        if (b.secret) tags.push("secret");
        if (b.lock) tags.push(`LOCKED ${escTag(b.lock)}`);
        if (b.at) tags.push(`at ${timeText(b.at)}`);
        if (b.after) tags.push(`after ${b.after}`);
        if (eligible(b, view, cfg)) tags.push("eligible");
        return `- <b>${b.id}</b> ${esc(b.desc)} | ${tags.join(" · ")}`;
      }),
      ...value2.fired.map((f) => `- <b>${f.id}</b> ${esc(f.desc)} | fired: ${esc(f.how)}`)
    ];
  },
  parse(rows, prevValue) {
    const value2 = { bullets: [], fired: [] }, errors = [];
    for (const row of rows) {
      const m = row.match(ROW);
      const id = m && m[1].trim().match(/^B\d+$/i) ? m[1].trim().toUpperCase() : null;
      const bar = m ? m[2].indexOf("|") : -1;
      if (!id || bar < 0) {
        errors.push(row);
        continue;
      }
      const desc = unesc(m[2].slice(0, bar));
      const meta = m[2].slice(bar + 1).trim();
      const fired = meta.match(/^fired\s*:\s*(.*)$/i);
      if (fired) {
        value2.fired.push({ id, desc, how: unesc(fired[1]) });
        continue;
      }
      const b = { id, desc, weight: 0, age: 0, hot: false, secret: false, lock: "", at: null, after: "" };
      let ok = true;
      for (const tag2 of meta.split("·").map((t) => t.trim()).filter(Boolean)) {
        let o;
        if (o = tag2.match(/^w([123])$/i)) b.weight = Number(o[1]);
        else if (o = tag2.match(/^age\s+(\d+)(?:\s*\/\s*\d+)?$/i)) b.age = Number(o[1]);
        else if (/^hot$/i.test(tag2)) b.hot = true;
        else if (/^secret$/i.test(tag2)) b.secret = true;
        else if (/^eligible$/i.test(tag2)) {
        } else if (o = tag2.match(/^LOCKED\s+(.+)$/)) b.lock = unescTag(o[1]);
        else if (o = tag2.match(/^at\s+(?:Day\s+(\d+)\s+)?(\d{1,2}):(\d{2})(\s+next-day)?(\s+reached)?$/i)) {
          b.at = { day: o[1] ? Number(o[1]) : null, minutes: Number(o[2]) * 60 + Number(o[3]) };
          if (o[4]) b.at.wait = true;
          if (o[5]) b.at.hit = true;
        } else if (o = tag2.match(/^after\s+(B\d+)$/i)) b.after = o[1].toUpperCase();
        else ok = false;
      }
      if (ok && b.weight) value2.bullets.push(b);
      else {
        errors.push(row);
        const old = prevValue && byId2(prevValue.bullets || [], id);
        if (old) value2.bullets.push(old);
      }
    }
    return { value: value2, errors };
  },
  apply(state, lines2, ctx) {
    const cfg = cfgOf(ctx);
    const unparsed = [];
    let loads = 0;
    const closed = ctx && ctx.normalizedChanges ? closedForm : (s) => s;
    for (const raw of lines2) {
      const line = String(raw).trim();
      let m, b;
      if (/^load\s*:/i.test(line)) {
        const nb = parseLoad(line, state);
        if (!nb) {
          unparsed.push(line);
          continue;
        }
        nb.id = nextId(state, "B", [...state.chekhov.bullets, ...state.chekhov.fired].map((x) => x.id));
        state.chekhov.bullets.push({ id: nb.id, desc: nb.desc, weight: nb.weight, age: 0, hot: nb.hot, secret: nb.secret, lock: "", at: nb.at, after: nb.after });
        if (nb.badAt) ctx.warnings.push({ section: "Chekhov", text: `${nb.id} "${nb.desc}": could not read the time "${nb.badAt}" — loaded without a time lock. Edit the block to add one (at HH:MM).` });
        ctx.touched.add(`chekhov:${nb.id}`);
        if (++loads > cfg.maxLoadsPerTurn) ctx.warnings.push({ section: "Chekhov", text: `More than ${cfg.maxLoadsPerTurn} setup loaded in one reply (${nb.id} "${nb.desc}" kept).` });
      } else if ((m = line.match(/^fire\s+(B\d+)\s*:\s*(.+)$/i)) && (b = byId2(state.chekhov.bullets, m[1]))) {
        if (fateFiring(ctx) && eligible(b, state, cfg) && ctx.turn?.fate?.fire !== b.id) {
          ctx.warnings.push({ section: "Chekhov", text: `${b.id} "${b.desc}" fired without Fate's pick.` });
        }
        if (!eligible(b, state, cfg) && !isDue(b, state)) ctx.warnings.push({ section: "Chekhov", text: `${b.id} "${b.desc}" fired before it was eligible (${holdReasons(b, state, cfg).join("; ")}).` });
        toFired(state, b, m[2].trim());
      } else if ((m = line.match(/^lock\s+(B\d+)\s*:\s*(.+)$/i)) && (b = byId2(state.chekhov.bullets, m[1]))) b.lock = m[2].trim();
      else if ((m = closed(line).match(/^unlock\s+(B\d+)$/i)) && (b = byId2(state.chekhov.bullets, m[1]))) {
        b.lock = "";
        b.at = null;
        b.after = "";
      } else if ((m = closed(line).match(/^prune\s+(B\d+)$/i)) && (b = byId2(state.chekhov.bullets, m[1]))) toFired(state, b, "pruned");
      else unparsed.push(line);
    }
    return unparsed;
  },
  after(state, ctx) {
    const cfg = cfgOf(ctx);
    const now = parseStoryTime(state.scene.now), before = parseStoryTime(ctx.prevNow || "");
    for (const b of state.chekhov.bullets) {
      if (!b.at) continue;
      const waited = Boolean(b.at.wait);
      if (b.at.wait && now && before && now.minutes < before.minutes) delete b.at.wait;
      if (!waited && !b.at.hit && ctx.prevNow && isDue(b, { ...state, scene: { ...state.scene, now: ctx.prevNow } })) b.at.hit = true;
    }
    for (const b of state.chekhov.bullets) if (!isLocked(b, state) && !ctx.touched.has(`chekhov:${b.id}`)) b.age += 1;
    const warmed = fateFiring(ctx) && ctx.turn?.fate?.warm && byId2(state.chekhov.bullets, ctx.turn.fate.warm);
    if (warmed) warmed.age += 1;
    for (const b of [...state.chekhov.bullets]) if (!isLocked(b, state) && !isDue(b, state) && b.age >= cfg.pruneAge) toFired(state, b, "pruned");
    while (state.chekhov.bullets.length > cfg.cap) {
      const victim = state.chekhov.bullets.filter((b) => !isLocked(b, state) && !isDue(b, state)).sort((a, z) => a.weight - z.weight || z.age - a.age)[0];
      if (!victim) {
        ctx.warnings.push({ section: "Chekhov", text: `${state.chekhov.bullets.length} setups are due or locked, more than the cap of ${cfg.cap} — none were pruned. Fire, unlock or prune some.` });
        break;
      }
      toFired(state, victim, "pruned");
    }
    if (cfg.firedKeep > 0 && state.chekhov.fired.length > cfg.firedKeep) state.chekhov.fired = state.chekhov.fired.slice(-cfg.firedKeep);
  },
  facts(state, ctx) {
    const cfg = cfgOf(ctx);
    const out = [];
    for (const b of state.chekhov.bullets.filter((x) => isDue(x, state))) {
      out.push(b.at.hit ? `Overdue: ${b.id} "${b.desc}" [at ${clock(b.at)}] — pay it off when it fits, or \`lock ${b.id}: why\` to hold it.` : `Due now: ${b.id} "${b.desc}" [at ${clock(b.at)}] — fire it this turn.`);
    }
    if (!fateFiring(ctx)) {
      const ready = state.chekhov.bullets.filter((b) => eligible(b, state, cfg)).sort((a, z) => z.weight - a.weight || z.age - a.age).map((b) => `${b.id} "${b.desc}" (w${b.weight}${b.hot ? ", hot" : ""})`);
      if (ready.length) out.push(`Eligible to fire when the moment is right: ${ready.join("; ")}.`);
    }
    return out;
  },
  prompt(value2, state, ctx) {
    const cfg = cfgOf(ctx);
    const rows = value2.bullets.map((b) => {
      const tags = [`w${b.weight}`, `age ${b.age}/${cfg.pruneAge}`];
      if (b.hot) tags.push("hot");
      if (b.secret) tags.push("secret");
      if (isDue(b, state)) tags.push("DUE");
      else if (eligible(b, state, cfg)) tags.push("eligible");
      else if (b.lock) tags.push(`locked: ${b.lock}`);
      else if (b.at) tags.push(`at ${timeText(b.at)}`);
      else if (b.after && isLocked(b, state)) tags.push(`after ${b.after}`);
      return `- ${b.id} ${b.desc} · ${tags.join(" · ")}`;
    });
    return rows.length ? ["Chekhov (narrative debt — never name it in prose):", ...rows].join("\n") : "";
  },
  rules(ctx) {
    const cfg = cfgOf(ctx);
    return [
      "Chekhov's Gun: load a setup only when the prose leaves narrative debt a reader would notice going unpaid — an unresolved setup, a promise, foreshadowing, a planted object, emotional tension. Ambient scenery, small talk and passing business load nothing.",
      "A load's options go in its parentheses, comma separated: a weight w1–3 (required), then any of hot, secret, at HH:MM, after B#.",
      `At most ${cfg.maxLoadsPerTurn} load per reply. Weight 1–3 by how much it matters. Mark it hot only when it exists because of something {{user}} said or did. A future time becomes an \`at\` lock written as a clock time — \`at 18:30\`, \`at noon\`, \`at midnight\` or \`at Day 4 09:00\` — worked out from the story time ("in an hour" at 17:30 is \`at 18:30\`). \`after B#\` makes it wait for another setup. A secret stays held while more than 2 people are present.`,
      fateFiring(ctx) ? "Firing: a bullet fires only when the turn says so (Fate's pick), or when it is due; pay it off naturally and never narrate the mechanics." : "Firing: you judge the moment — fire an eligible bullet when the story offers a natural opening, never forced; a due bullet fires when its hour comes. Pay it off naturally and never narrate the mechanics."
    ].join("\n");
  },
  commands: COMMANDS8,
  template: (ctx) => commandTemplate("Chekhov", COMMANDS8, ctx)
};

// src/model/fate-engine.js
var REACH = {
  ELSEWHERE: [1, 1, 2],
  REGIONAL: [1, 2, 3],
  LOCAL: [2, 3, 3]
};
var idNumber = (id) => Number(String(id || "").match(/\d+$/)?.[0] || Number.MAX_SAFE_INTEGER);
var byLowestId = (a, b) => idNumber(a.id) - idNumber(b.id);
var bulletsOf = (state) => state && state.chekhov && Array.isArray(state.chekhov.bullets) ? state.chekhov.bullets : [];
var worldsOf = (fate2) => Array.isArray(fate2 && fate2.world) ? fate2.world : [];
var deferredOf = (fate2) => Array.isArray(fate2 && fate2.deferred) ? fate2.deferred : [];
var normalizeChoice = (value2, allowed) => {
  const choice = typeof value2 === "string" ? value2.trim().toUpperCase() : "";
  return allowed.includes(choice) ? choice : null;
};
function eligibleHotBullet(state, cfg) {
  const eligibilityConfig = cfg.chekhov || (cfg.eligibleAge === void 0 ? DEFAULT_SECTION_CONFIG.chekhov : cfg);
  return bulletsOf(state).filter((b) => b.hot && eligible(b, state, eligibilityConfig)).sort((a, b) => (b.weight || 0) - (a.weight || 0) || (b.age || 0) - (a.age || 0))[0] || null;
}
function tierFor(q, adjusted, cfg) {
  const ladder = [...cfg.ladder || DEFAULT_SECTION_CONFIG.fate.ladder].sort((a, b) => a.q - b.q);
  const row = ladder.filter((item) => item.q <= q).at(-1) || ladder[0];
  if (!row) return "AMBIENT";
  if (adjusted >= row.major) return "MAJOR";
  if (adjusted >= row.minor) return "MINOR";
  return "AMBIENT";
}
function sourceFor(dice, hp, cfg) {
  if (dice.b <= cfg.trueFloor || hp === 0) return "TRUE";
  const rows = [...cfg.hpLadder || DEFAULT_SECTION_CONFIG.fate.hpLadder].sort((a, b) => a.hp - b.hp);
  const row = rows.filter((item) => item.hp <= hp).at(-1) || rows[0];
  return row && dice.b >= row.weighted ? "WEIGHTED" : "TRUE";
}
function findWorldEntry(entries, predicate, compare) {
  return entries.filter(predicate).sort(compare)[0] || null;
}
function naturalFire(state, tier, source, cfg, forcedFire, ripeEntry) {
  if (tier !== "MAJOR" || source !== "WEIGHTED") return { source, fire: null, fellBack: false };
  if (forcedFire) return { source, fire: forcedFire.id, fellBack: false };
  if (ripeEntry) return { source, fire: null, fellBack: false };
  const bullet2 = eligibleHotBullet(state, cfg);
  if (bullet2) return { source, fire: bullet2.id, fellBack: false };
  return { source: "TRUE", fire: null, fellBack: true };
}
function reachFor(prox, c) {
  const row = REACH[String(prox || "").toUpperCase()];
  if (!row) return void 0;
  return row[c <= 4 ? 0 : c === 5 ? 1 : 2];
}
function computeFate(prev, dice, fudges = null, config = DEFAULT_SECTION_CONFIG.fate) {
  const cfg = config || DEFAULT_SECTION_CONFIG.fate;
  const fate2 = prev && prev.fate || {};
  const rolls = dice || { a: 1, b: 1, c: 1 };
  const d = { a: rolls.a, b: rolls.b, c: rolls.c };
  const deferred = deferredOf(fate2);
  const modifiers = cfg.modifiers || DEFAULT_SECTION_CONFIG.fate.modifiers;
  let mod = 0;
  if ((fate2.sinceMajor ?? 99) <= 2) mod = modifiers.recentMajor;
  else if (deferred.length >= 3) mod = modifiers.deferred3;
  else if (deferred.length >= 1) mod = modifiers.deferred12;
  else if (prev && prev.scene && prev.scene.public) mod = modifiers.public;
  const adjusted = d.a + mod;
  const q = Number.isFinite(fate2.q) ? fate2.q : 0;
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
  const worlds = worldsOf(fate2);
  const ripeConfig = cfg.ripe || DEFAULT_SECTION_CONFIG.fate.ripe;
  const ripeEntry = tier === "MAJOR" ? findWorldEntry(worlds, (w) => w.prox === "LOCAL" && w.reach >= ripeConfig.reach && w.age >= ripeConfig.age, byLowestId) : null;
  const ripe = ripeEntry ? ripeEntry.id : null;
  const bullets = bulletsOf(prev || {});
  const forcedFireText = typeof (fudges && fudges.fire) === "string" ? fudges.fire.trim() : "";
  const forcedFire = /^B\d+$/i.test(forcedFireText) ? bullets.find((b) => b.id.toLowerCase() === forcedFireText.toLowerCase()) || null : null;
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
    const bullet2 = eligibleHotBullet(prev || {}, cfg);
    warm = bullet2 ? bullet2.id : null;
  }
  let world = null;
  if (ripeEntry) {
    world = { id: ripeEntry.id, action: "land" };
  } else if (tier === "MINOR") {
    const threshold = cfg.minorWorld || DEFAULT_SECTION_CONFIG.fate.minorWorld;
    const entry2 = findWorldEntry(
      worlds,
      (w) => w.reach >= threshold.reach && w.age >= threshold.age,
      (a, b) => b.reach - a.reach || b.age - a.age
    );
    if (entry2) world = { id: entry2.id, action: "first-effect" };
  } else if (tier === "MAJOR" && !fire) {
    const threshold = cfg.majorWorld || DEFAULT_SECTION_CONFIG.fate.majorWorld;
    const entry2 = findWorldEntry(
      worlds,
      (w) => w.reach >= threshold.reach && w.age >= threshold.age,
      (a, b) => b.reach - a.reach || b.age - a.age
    );
    if (entry2) world = { id: entry2.id, action: "land" };
  }
  let collision = null;
  if (fate2.state === "THREAD") {
    if (tier === "MINOR") collision = d.c <= cfg.collision.minorDefer ? "DEFER" : "COMPLICATE";
    else if (tier === "MAJOR") collision = d.c <= cfg.collision.majorComplicate ? "COMPLICATE" : "DISPLACE";
  }
  const mustLandEntry = findWorldEntry(deferred, (d2) => d2.times >= 2, byLowestId);
  const mustClose = fate2.state === "THREAD" && (fate2.ts || 0) >= cfg.pursuitLimit;
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
    fudged: applied
  };
}

// src/model/sections/fate.js
var FATE_COMMANDS = [
  { id: "fate.pursuit", form: "pursuit: question", example: "pursuit: who set the boathouse fire?", keywords: ["pursuit"] },
  { id: "fate.close", form: "close: aftermath", example: "close: the arsonist fled town; the guild blames the union", keywords: ["close"] },
  { id: "fate.park", form: "park: aftermath", example: "park: the fire is old news; nobody talks of it", keywords: ["park"] },
  { id: "fate.defer-new", form: "defer: desc", example: "defer: the guild's audit of the docks", keywords: ["defer"] },
  { id: "fate.defer", form: "defer D#", example: "defer D1", keywords: ["defer"] },
  { id: "fate.resolve", form: "resolve D#", example: "resolve D1", keywords: ["resolve"] },
  { id: "fate.ambition", form: "ambition: want", example: "ambition: Mara wants her own boat", keywords: ["ambition"] },
  { id: "fate.ambition-progress", form: "ambition +1 prefix", example: "ambition +1 Mara wants", keywords: ["ambition"] },
  { id: "fate.residue", form: "residue: owed aftermath", example: "residue: the burnt pier is fenced off", keywords: ["residue"] },
  { id: "fate.consequence-landed", form: "World CONSEQUENCE landed as aftermath", example: "World CONSEQUENCE landed as the buoy broke during the race", keywords: ["World", "CONSEQUENCE", "landed", "as"] },
  { id: "fate.world-landed", form: "World EVENT landed as aftermath", example: "World ARRIVAL landed as a cousin turns up four hours early", keywords: ["World", "landed", "as"] }
];
var WORLD_COMMANDS = [
  { id: "world.add-elsewhere", form: "+ ELSEWHERE: …", example: "+ ELSEWHERE: a war breaks out across the sea", keywords: ["ELSEWHERE"] },
  { id: "world.add-regional", form: "+ REGIONAL: …", example: "+ REGIONAL: the river road is flooded", keywords: ["REGIONAL"] },
  { id: "world.add-local", form: "+ LOCAL: …", example: "+ LOCAL: the bakery closes for a funeral", keywords: ["LOCAL"] },
  { id: "world.escalate", form: "escalate W#", example: "escalate W1", keywords: ["escalate"] },
  { id: "world.update", form: "update W#: new development", example: "update W1: repair part sourced; Thursday earliest", keywords: ["update"] },
  { id: "world.escalate-note", form: "escalate W#: new development", example: "escalate W1: fuel shortage reaches the neighbouring town", keywords: ["escalate"] },
  { id: "world.land", form: "land W#: how it lands", example: "land W1: refugees reach the harbour", keywords: ["land"] }
];
var cfgOf2 = (ctx) => ctx?.config?.sectionConfig?.fate || {};
var byId3 = (list, id) => list.find((item) => item.id.toLowerCase() === String(id).toLowerCase());
var idNumber2 = (id) => Number(String(id || "").match(/\d+$/)?.[0] || Number.MAX_SAFE_INTEGER);
var emptyFate = () => ({ state: "ROUTINE", pursuit: "", ts: 0, q: 0, sinceMajor: 99, deferred: [], world: [], ambitions: [], residue: [], lastTurn: null, owed: [] });
function outcomeSummary(outcome) {
  return {
    dice: { ...outcome.dice },
    tier: outcome.tier,
    source: outcome.source,
    news: Boolean(outcome.news),
    fire: outcome.fire || null,
    warm: outcome.warm || null,
    collision: outcome.collision || null,
    fudged: [...outcome.fudged || []]
  };
}
function appendResidue(fate2, text, ctx) {
  if (!text) return;
  fate2.residue.push(String(text).trim());
  const keep = cfgOf2(ctx).residueKeep ?? 12;
  if (keep >= 0 && fate2.residue.length > keep) fate2.residue = keep ? fate2.residue.slice(-keep) : [];
}
function appendWorldUpdate(entry2, raw) {
  const note = String(raw || "").trim();
  if (!note) return;
  const updates = Array.isArray(entry2.updates) ? entry2.updates : [];
  if (!updates.some((previous) => previous.toLowerCase() === note.toLowerCase()))
    entry2.updates = [...updates, note];
}
var worldHistory = (item) => [item.desc, ...item.updates || []].join("; ");
function oweResidue(fate2, text) {
  if (text) fate2.owed.push(String(text).trim());
}
function realizedWorldAftermath(line, eventName, normalized) {
  if (!eventName) return null;
  const labelled = normalized && line.match(/^World\s+EVENT\s+landed\s+as\s+aftermath\s*:\s*(.+)$/i);
  if (labelled) {
    const payload = labelled[1];
    if (payload.slice(0, eventName.length).toLowerCase() !== eventName.toLowerCase()) return null;
    return payload.slice(eventName.length).match(/^\s+[—–-]\s+(\S.*)$/)?.[1].trim() || null;
  }
  const m = line.match(/^World\s+(.+?)\s+landed\s+as\s+(\S.*)$/i);
  return m && m[1].trim().toLowerCase() === eventName.trim().toLowerCase() ? m[2].trim() : null;
}
function addWorld(fate2, state, prox, desc, c, ctx) {
  const id = nextId(state, "W", fate2.world.map((item) => item.id));
  fate2.world.push({ id, desc, prox, reach: reachFor(prox, c), age: 0 });
  ctx.touched.add(`fate:${id}`);
  return id;
}
function parseLastTurnRows(rows, value2, errors) {
  let dice = null, turn = null;
  const updateRows = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const m = row.match(ROW);
    if (!m) {
      errors.push(row);
      continue;
    }
    const field3 = m[1].replace(/:\s*$/, "").trim().toLowerCase();
    const rest = m[2].trim();
    if (field3 === "rolls") {
      const hit = rest.match(/^A\s+(\d+)\s+·\s+B\s+(\d+)\s+·\s+C\s+(\d+)(?:\s+\(fudged:\s*(.+)\))?$/i);
      if (!hit) {
        errors.push(row);
        continue;
      }
      dice = { a: Number(hit[1]), b: Number(hit[2]), c: Number(hit[3]) };
      if (turn) turn.fudged = hit[4] ? hit[4].split(/,\s*/) : [];
      else value2._fudged = hit[4] ? hit[4].split(/,\s*/) : [];
    } else if (field3 === "this turn") {
      const parts = rest.split(/\s+·\s+/);
      const lead = parts.shift().match(/^(AMBIENT|MINOR|MAJOR)\s+\+\s+(TRUE|WEIGHTED)$/i);
      if (!lead) {
        errors.push(row);
        continue;
      }
      turn = { tier: lead[1].toUpperCase(), source: lead[2].toUpperCase(), news: false, fire: null, warm: null, collision: null, fudged: value2._fudged || [] };
      for (const part of parts) {
        if (/^news$/i.test(part)) turn.news = true;
        else if (/^fired\s+B\d+$/i.test(part)) turn.fire = part.match(/B\d+/i)[0].toUpperCase();
        else if (/^warmed\s+B\d+$/i.test(part)) turn.warm = part.match(/B\d+/i)[0].toUpperCase();
        else if (/^(DEFER|COMPLICATE|DISPLACE)$/i.test(part)) turn.collision = part.toUpperCase();
        else errors.push(row);
      }
    } else if (field3 === "state") {
      const hit = rest.match(/^(ROUTINE|THREAD)(?:\s+"([\s\S]*?)"\s+\(ts\s+(\d+)\))?\s+·\s+<b>Quiet:<\/b>\s*(\d+)\s+·\s+<b>Since MAJOR:<\/b>\s*(\d+)$/i);
      if (!hit) {
        errors.push(row);
        continue;
      }
      value2.state = hit[1].toUpperCase();
      value2.pursuit = hit[2] ? unesc(hit[2]) : "";
      value2.ts = hit[3] ? Number(hit[3]) : 0;
      value2.q = Number(hit[4]);
      value2.sinceMajor = Number(hit[5]);
    } else if (/^D\d+$/i.test(field3)) {
      const hit = rest.match(/^([\s\S]*?)\s+\|\s+deferred\s+×(\d+)\s+·\s+age\s+(\d+)$/i);
      if (!hit) {
        errors.push(row);
        continue;
      }
      value2.deferred.push({ id: field3.toUpperCase(), desc: unesc(hit[1]), times: Number(hit[2]), age: Number(hit[3]) });
    } else if (/^W\d+ update$/i.test(field3)) {
      if (!rest) {
        errors.push(row);
        continue;
      }
      const id = field3.match(/^W\d+/i)[0].toUpperCase();
      const notes = updateRows.get(id) || [];
      notes.push({ row, text: unesc(rest) });
      updateRows.set(id, notes);
    } else if (/^W\d+$/i.test(field3)) {
      const hit = rest.match(/^([\s\S]*?)\s+\|\s+(ELSEWHERE|REGIONAL|LOCAL)\s+·\s+Reach\s+(\d+)\s+·\s+age\s+(\d+)$/i);
      if (!hit) {
        errors.push(row);
        continue;
      }
      value2.world.push({ id: field3.toUpperCase(), desc: unesc(hit[1]), prox: hit[2].toUpperCase(), reach: Number(hit[3]), age: Number(hit[4]) });
    } else if (field3 === "ambition") {
      const hit = rest.match(/^([\s\S]*?)\s+\|\s+(\d+)\/5$/);
      if (!hit) {
        errors.push(row);
        continue;
      }
      value2.ambitions.push({ desc: unesc(hit[1]), progress: Number(hit[2]) });
    } else if (field3 === "residue") value2.residue.push(unesc(rest));
    else if (field3 === "owed") value2.owed.push(unesc(rest));
    else errors.push(row);
  }
  for (const [id, notes] of updateRows) {
    const entry2 = byId3(value2.world, id);
    if (entry2) entry2.updates = notes.map((note) => note.text);
    else errors.push(...notes.map((note) => note.row));
  }
  delete value2._fudged;
  value2.lastTurn = turn ? { dice, ...turn, fudged: turn.fudged || value2._fudged || [] } : null;
  if (turn && !dice) errors.push("This turn row has no Rolls row");
}
function compareWorldDrop(a, b) {
  return a.reach - b.reach || b.age - a.age || idNumber2(a.id) - idNumber2(b.id);
}
var fate_default = {
  key: "fate",
  title: "🎲 FATE & ROUTINE",
  match: /^FATE ROUTINE$/,
  change: "Fate",
  aliases: ["Fate & Routine", "Fate and Routine"],
  carried: true,
  empty: emptyFate,
  decide(prev, ctx) {
    const dice = ctx.config.dice?.fate;
    if (!dice) return null;
    const cfg = { ...cfgOf2(ctx), chekhov: ctx.config.sectionConfig?.chekhov };
    const outcome = computeFate(prev, dice, ctx.config.fudges || null, cfg);
    outcome.fudged = [
      ...(ctx.config.fudgedDice || []).filter((name) => /^fate\.[abc]$/i.test(name)),
      ...outcome.fudged
    ];
    return outcome;
  },
  render(value2) {
    const rows = [];
    const last = value2.lastTurn;
    if (last?.dice) {
      const mark = last.fudged?.length ? ` (fudged: ${last.fudged.join(", ")})` : "";
      rows.push(`- <b>Rolls:</b> A ${last.dice.a} · B ${last.dice.b} · C ${last.dice.c}${mark}`);
      const notes = [];
      if (last.news) notes.push("news");
      if (last.fire) notes.push(`fired ${last.fire}`);
      if (last.warm) notes.push(`warmed ${last.warm}`);
      if (last.collision) notes.push(last.collision);
      rows.push(`- <b>This turn:</b> ${last.tier} + ${last.source}${notes.map((note) => ` · ${note}`).join("")}`);
    }
    const state = value2.state === "THREAD" ? `THREAD "${esc(value2.pursuit)}" (ts ${value2.ts})` : "ROUTINE";
    rows.push(`- <b>State:</b> ${state} · <b>Quiet:</b> ${value2.q} · <b>Since MAJOR:</b> ${value2.sinceMajor}`);
    rows.push(...value2.deferred.map((item) => `- <b>${item.id}</b> ${esc(item.desc)} | deferred ×${item.times} · age ${item.age}`));
    for (const item of value2.world) {
      rows.push(`- <b>${item.id}</b> ${esc(item.desc)} | ${item.prox} · Reach ${item.reach} · age ${item.age}`);
      for (const update of item.updates || []) rows.push(`- <b>${item.id} update:</b> ${esc(update)}`);
    }
    rows.push(...value2.ambitions.map((item) => `- <b>Ambition:</b> ${esc(item.desc)} | ${item.progress}/5`));
    rows.push(...value2.residue.map((item) => `- <b>Residue:</b> ${esc(item)}`));
    rows.push(...value2.owed.map((item) => `- <b>Owed:</b> ${esc(item)}`));
    return rows;
  },
  parse(rows) {
    const value2 = emptyFate(), errors = [];
    parseLastTurnRows(rows, value2, errors);
    value2.deferred.sort((a, b) => idNumber2(a.id) - idNumber2(b.id));
    value2.world.sort((a, b) => idNumber2(a.id) - idNumber2(b.id));
    return { value: value2, errors };
  },
  apply(state, lines2, ctx) {
    const fate2 = state.fate;
    const unparsed = [];
    const outcome = ctx.turn.fate;
    if (!outcome) return unparsed;
    const tables = ctx.config?.sectionConfig?.worldsim || DEFAULT_SECTION_CONFIG.worldsim;
    const eventNames = [...new Set([ctx.turn.worldsim?.name, ...["duo", "standard"].flatMap((k) => (tables[k] || DEFAULT_SECTION_CONFIG.worldsim[k]).map((e) => e.name))].filter(Boolean))];
    const byDeferred = (id) => byId3(fate2.deferred, id);
    const worldLines = [];
    const records = ctx.linesAcross?.(["World", "Fate"]) || [
      ...ctx.linesUnder("World").map((line) => ({ section: "World", line })),
      ...lines2.map((line) => ({ section: "Fate", line }))
    ];
    const closed = ctx.normalizedChanges ? closedForm : (s) => s;
    for (const record of records) {
      const line = String(record.line).trim();
      const consequence = line.match(/^World\s+CONSEQUENCE\s+landed\s+as\s+(\S.*)$/i);
      if (consequence) {
        appendResidue(fate2, `CONSEQUENCE — ${consequence[1].trim()}`, ctx);
        continue;
      }
      const reported = eventNames.map((name) => ({ name, aftermath: realizedWorldAftermath(line, name, ctx.normalizedChanges) })).find((event) => event.aftermath !== null);
      if (reported) {
        appendResidue(fate2, `${reported.name} — ${reported.aftermath}`, ctx);
        continue;
      }
      if (record.section === "World") {
        worldLines.push(line);
        continue;
      }
      let m, item;
      if (m = line.match(/^pursuit\s*:\s*(.+)$/i)) {
        fate2.state = "THREAD";
        fate2.pursuit = m[1].trim();
        fate2.ts = 0;
        ctx.touched.add("fate:pursuit");
      } else if (m = line.match(/^(close|park)\s*:\s*(.+)$/i)) {
        fate2.state = "ROUTINE";
        fate2.pursuit = "";
        fate2.ts = 0;
        ctx.touched.add("fate:pursuit");
        appendResidue(fate2, m[2].trim(), ctx);
      } else if (m = line.match(/^defer\s*:\s*(.+)$/i)) {
        const id = nextId(state, "D", fate2.deferred.map((d) => d.id));
        fate2.deferred.push({ id, desc: m[1].trim(), times: 1, age: 0 });
        ctx.touched.add(`fate:${id}`);
      } else if ((m = closed(line).match(/^defer\s+(D\d+)$/i)) && (item = byDeferred(m[1]))) {
        item.times = Math.min(2, item.times + 1);
        ctx.touched.add(`fate:${item.id}`);
      } else if ((m = closed(line).match(/^resolve\s+(D\d+)$/i)) && (item = byDeferred(m[1]))) {
        fate2.deferred = fate2.deferred.filter((d) => d !== item);
      } else if (m = line.match(/^ambition\s*:\s*(.+)$/i)) {
        fate2.ambitions.push({ desc: m[1].trim(), progress: 0 });
      } else if ((m = line.match(/^ambition\s+\+1\s+(.+)$/i)) && m[1].trim()) {
        const prefix = m[1].trim().toLowerCase();
        const ambition = fate2.ambitions.find((a) => a.desc.toLowerCase().startsWith(prefix));
        if (ambition) ambition.progress = Math.min(5, ambition.progress + 1);
        else unparsed.push(line);
      } else if (m = line.match(/^residue\s*:\s*(.+)$/i)) {
        appendResidue(fate2, m[1].trim(), ctx);
        if (fate2.owed.length) fate2.owed.shift();
      } else if (m = line.match(/^World\s*:\s*(.+)$/i)) {
        worldLines.push(m[1]);
      } else if (/^(?:update|escalate)\b/i.test(line)) {
        worldLines.push(line);
      } else if (/^(ELSEWHERE|REGIONAL|LOCAL)\s*:/i.test(line)) {
        worldLines.push(line);
      } else if ((m = line.match(/^(MINOR|MAJOR)\s+(?:consequence\s+)?landed\s*:\s*(.+)$/i)) && m[1].toUpperCase() === outcome.tier) {
        appendResidue(fate2, m[2].trim(), ctx);
      } else if ((m = line.match(/^(AMBIENT|MINOR|MAJOR)(?:\s*\+\s*(TRUE|WEIGHTED))?\s*:\s*(.+)$/i)) && m[1].toUpperCase() === outcome.tier && (!m[2] || m[2].toUpperCase() === outcome.source)) {
      } else unparsed.push(line);
    }
    for (const raw of worldLines) {
      const line = String(raw).trim();
      let m, item;
      if (m = line.match(/^\+\s*(?:(.+?)\s+)?(ELSEWHERE|REGIONAL|LOCAL)\s*:\s*(.+)$/i)) {
        const c = outcome.dice.c;
        const what = m[3].trim().replace(/\s*\(Reach\s+\d+\)\s*$/i, "");
        const desc = m[1] ? `${m[1].trim()} — ${what}` : what;
        addWorld(fate2, state, m[2].toUpperCase(), desc, c, ctx);
      } else if ((m = line.match(/^update\s+(W\d+)\s*:\s*(\S.*)$/i)) && (item = byId3(fate2.world, m[1]))) {
        appendWorldUpdate(item, m[2]);
      } else if ((m = line.match(/^escalate\s+(W\d+)(?:\s*:\s*(\S.*))?$/i) || closed(line).match(/^escalate\s+(W\d+)$/i)) && (item = byId3(fate2.world, m[1]))) {
        item.prox = { ELSEWHERE: "REGIONAL", REGIONAL: "LOCAL", LOCAL: "LOCAL" }[item.prox];
        item.reach = Math.min(3, item.reach + 1);
        if (m[2]) appendWorldUpdate(item, m[2]);
      } else if ((m = line.match(/^land\s+(W\d+)\s*:\s*(.+)$/i)) && (item = byId3(fate2.world, m[1]))) {
        fate2.world = fate2.world.filter((w) => w !== item);
        oweResidue(fate2, `${item.id} “${worldHistory(item)}” landed: ${m[2].trim()}`);
      } else if ((m = line.match(/^(ELSEWHERE|REGIONAL|LOCAL)\s*:\s*(\S.*?)\s+\((W\d+)\s+unchanged\)$/i)) && (item = byId3(fate2.world, m[3])) && item.prox === m[1].toUpperCase() && outcome.world?.id !== item.id) {
      } else unparsed.push(line);
    }
    return unparsed;
  },
  after(state, ctx) {
    const outcome = ctx.turn.fate;
    if (!outcome) return;
    const fate2 = state.fate, cfg = cfgOf2(ctx);
    fate2.q = outcome.tier === "AMBIENT" ? fate2.q + 1 : 0;
    fate2.sinceMajor = outcome.tier === "MAJOR" ? 0 : fate2.sinceMajor + 1;
    if (fate2.state === "THREAD" && !ctx.touched.has("fate:pursuit")) fate2.ts += 1;
    for (const ambition of [...fate2.ambitions]) {
      if (ambition.progress < 5) continue;
      fate2.ambitions = fate2.ambitions.filter((a) => a !== ambition);
      oweResidue(fate2, `Ambition “${ambition.desc}” reached 5/5; write its residue.`);
      addWorld(fate2, state, "LOCAL", ambition.desc, 6, ctx);
    }
    if (outcome.world) {
      const entry2 = byId3(fate2.world, outcome.world.id);
      if (entry2 && outcome.world.action === "first-effect") entry2.reach = Math.min(3, entry2.reach + 1);
      else if (entry2 && outcome.world.action === "land") {
        fate2.world = fate2.world.filter((w) => w !== entry2);
        oweResidue(fate2, `${entry2.id} “${worldHistory(entry2)}” landed; write its residue.`);
      }
    }
    for (const entry2 of fate2.world) if (!ctx.touched.has(`fate:${entry2.id}`)) entry2.age += 1;
    const reach1Drop = cfg.reach1Drop ?? 15;
    fate2.world = fate2.world.filter((entry2) => !(entry2.reach === 1 && entry2.age >= reach1Drop));
    const worldKeep = cfg.worldKeep ?? 5;
    while (fate2.world.length > worldKeep) {
      const victim = [...fate2.world].sort(compareWorldDrop)[0];
      fate2.world = fate2.world.filter((entry2) => entry2 !== victim);
    }
    for (const item of fate2.deferred) if (!ctx.touched.has(`fate:${item.id}`)) item.age += 1;
    const expired = fate2.deferred.filter((item) => item.age >= (cfg.deferredExpire ?? 6));
    for (const item of expired) {
      oweResidue(fate2, `${item.id} “${item.desc}” expired; write its residue.`);
      fate2.deferred = fate2.deferred.filter((d) => d !== item);
    }
    const keep = cfg.residueKeep ?? 12;
    if (fate2.residue.length > keep) fate2.residue = keep ? fate2.residue.slice(-keep) : [];
    fate2.lastTurn = outcomeSummary(outcome);
  },
  facts(state, ctx) {
    const outcome = ctx.turn.fate;
    if (!outcome) return [];
    const fate2 = state.fate, cfg = cfgOf2(ctx);
    const cell = {
      "AMBIENT+TRUE": "Keep the beat ordinary and close to the current scene.",
      "AMBIENT+WEIGHTED": "Keep the beat ordinary; give the selected hot setup one extra beat to warm.",
      "MINOR+TRUE": "Let one small, concrete consequence change the scene.",
      "MINOR+WEIGHTED": "Let one small consequence surface through existing narrative debt.",
      "MAJOR+TRUE": "Let a major outside force alter the story; apply the Life Gate to the event.",
      "MAJOR+WEIGHTED": "Pay off the selected hot setup as the major turn."
    }[`${outcome.tier}+${outcome.source}`];
    const facts = [`Fate: ${outcome.tier} + ${outcome.source} — ${cell}`];
    if (outcome.fellBack) facts.push("No eligible hot bullet could fire, so MAJOR + WEIGHTED fell back to TRUE.");
    if (outcome.news) facts.push("This turn's ambient content is world news; adapt it to the setting and react in proportion to its real impact.");
    if (outcome.collision) facts.push(`Collision with THREAD “${fate2.pursuit}”: ${outcome.collision}. Let this result change the pursuit's direction.`);
    if (outcome.fire) facts.push(`Fire ${outcome.fire} this turn — pay it off naturally.`);
    if (outcome.warm) facts.push(`Warm ${outcome.warm} this turn; give its setup one extra beat.`);
    if (outcome.world?.action === "first-effect") facts.push(`World ${outcome.world.id} reaches its first effect; show one concrete consequence.`);
    else if (outcome.world?.action === "land") facts.push(`World ${outcome.world.id} lands now; realize it and write “World: land ${outcome.world.id}: how”.`);
    if (outcome.mustLand) facts.push(`Deferred ${outcome.mustLand} has been deferred twice; if it comes up, it must land as a MAJOR.`);
    if (outcome.mustClose) facts.push(`THREAD “${fate2.pursuit}” has reached its pursuit limit; it must close or park this turn.`);
    for (const owed of fate2.owed) facts.push(`Owed residue: ${owed} — write a Fate: residue: line this turn.`);
    facts.push(outcome.dangerLifted ? `Danger ceiling lifts this turn (MAJOR + TRUE, C = ${cfg.dangerC ?? 20}).` : `Danger ceiling stays in place; it lifts only on MAJOR + TRUE with C = ${cfg.dangerC ?? 20}.`);
    return facts;
  },
  prompt(value2) {
    const parts = [`Fate & Routine: ${value2.state === "THREAD" ? `THREAD “${value2.pursuit}” (ts ${value2.ts})` : "ROUTINE"} · quiet ${value2.q} · since MAJOR ${value2.sinceMajor}`];
    for (const item of value2.deferred) parts.push(`- ${item.id} ${item.desc} · deferred ×${item.times} · age ${item.age}`);
    for (const item of value2.world) {
      parts.push(`- ${item.id} ${item.desc} · ${item.prox} · Reach ${item.reach} · age ${item.age}`);
      for (const update of item.updates || []) parts.push(`  ${item.id} update: ${update}`);
    }
    for (const item of value2.ambitions) parts.push(`- Ambition ${item.desc} · ${item.progress}/5`);
    if (value2.residue.length) parts.push(`Residue: ${value2.residue.join("; ")}`);
    if (value2.owed.length) parts.push(`Owed: ${value2.owed.join("; ")}`);
    return parts.join("\n");
  },
  rules(ctx) {
    const cfg = cfgOf2(ctx);
    return [
      "Fate & Routine: open a THREAD pursuit for a story-bearing question; close or park it with the consequence when answered or set aside. Defer a pursuit only when its result cannot land yet; `resolve D#` records that it was paid off.",
      "A WILL is a concrete thing someone wants. Track meaningful progress with `ambition +1`; progress never falls from Fate, and 5/5 becomes a LOCAL happening with residue owed.",
      "World W# entries are displayed inside Fate & Routine. Under either Fate: or World:, use `update W#: new development` for changed facts without a change in scope, or `escalate W#: new development` when the event truly spreads (LOCAL and Reach 3 are the caps). Bare `escalate W#` is also valid. Both annotated commands APPEND a chronological update; they never replace the original description or earlier updates. Report only what is new, one command per line; preserve important previous facts without copying them into the new note. Say explicitly when a new estimate supersedes an old one. A repair status alone is not a reason to escalate.",
      "For a generic consequence that actually occurred in the story, `World CONSEQUENCE landed as aftermath` is valid under Fate: or World:. Replace aftermath with the concrete result. CONSEQUENCE is a generic report label, independent of the rolled World Sim event; it is valid on TRUE or WEIGHTED turns and records residue without changing the rolled event, tier, source, World entries or unrelated owed aftermath. Use it to record an observed result, never to force an event to occur.",
      "For world news, keep the reported channel recognizable, allow a plausible in-world distortion, and scale reactions to the event's actual reach. Keep ordinary scenes ordinary when Fate says AMBIENT. The ledger already records the turn's tier and source; omit Fate when no pursuit, deferred item, ambition or residue changed, rather than writing an AMBIENT/MINOR/MAJOR recap. Omit unchanged World entries instead of repeating their proximity or W#. Use the selected World Sim event only when this turn's source is TRUE. For its realized aftermath, write `World EVENT landed as aftermath`, replacing EVENT with the announced name and aftermath with the actual consequence. For an independent story consequence, prefer `World CONSEQUENCE landed as aftermath`. A recognized landed event label also records observed narrative aftermath even when it differs from the selected World Sim event; this bookkeeping never changes the roll, tier, source or World entries and never clears unrelated owed residue. Never use a landed report to force an event to happen. For a separate consequence of story actions at MINOR or MAJOR, use `MINOR consequence landed: aftermath` or `MAJOR consequence landed: aftermath`, matching this turn's tier.",
      `A twice-deferred item cannot be deferred again. Pursuits at ts ${cfg.pursuitLimit ?? 8} must close or park. Record a concise residue line for each owed aftermath; do not erase old residue except by the configured tail.`
    ].join("\n");
  },
  // commands covers both headings; worldCommands are the ones written under World:
  commands: [...FATE_COMMANDS, ...WORLD_COMMANDS],
  worldCommands: WORLD_COMMANDS,
  template: (ctx) => [...commandTemplate("Fate", FATE_COMMANDS, ctx), ...commandTemplate("World", WORLD_COMMANDS, ctx)]
};

// src/model/sections/worldsim.js
var userKey = (ctx) => String(ctx?.config?.userName || "{{user}}").trim().toLowerCase();
var nameKey2 = (name) => String(name || "").trim().toLowerCase();
function namedNpcNames(state, ctx) {
  const present = new Set((state?.scene?.present || []).map(nameKey2).filter(Boolean));
  const user = userKey(ctx);
  const names = /* @__PURE__ */ new Map();
  for (const name of [
    ...Object.keys(state?.agendas || {}),
    ...Object.keys(state?.locations || {}),
    ...Object.keys(state?.cast || {}),
    ...state?.scene?.present || []
  ]) {
    const key2 = nameKey2(name);
    if (!key2 || key2 === user || key2 === "{{user}}") continue;
    if (!names.has(key2)) names.set(key2, { name: String(name).trim(), offScreen: !present.has(key2) });
  }
  return [...names.values()];
}
function tableFor(state, ctx) {
  const names = namedNpcNames(state, ctx);
  const offScreen2 = names.some((item) => item.offScreen);
  return names.length <= 2 || !offScreen2 ? "Duo" : "Standard";
}
function entryFor(entries, roll) {
  return Array.isArray(entries) ? entries.find((item) => roll >= item.from && roll <= item.to) : null;
}
var worldsim_default = {
  key: "worldsim",
  title: "🌎 WORLD SIM",
  match: /^WORLD SIM$/,
  change: "World Sim",
  aliases: ["Worldsim"],
  carried: false,
  empty: () => null,
  isEmpty: (value2) => !value2,
  decide(prev, ctx) {
    const roll = ctx?.config?.dice?.world;
    if (!Number.isInteger(roll) || roll < 1 || roll > 20) return null;
    const table = tableFor(prev, ctx);
    const tableKey = table.toLowerCase();
    const config = ctx.config.sectionConfig?.worldsim || DEFAULT_SECTION_CONFIG.worldsim;
    const entries = config[tableKey] || DEFAULT_SECTION_CONFIG.worldsim[tableKey];
    const entry2 = entryFor(entries, roll);
    if (!entry2) return null;
    return {
      roll,
      table,
      name: entry2.name,
      text: entry2.text,
      fudged: ctx.config.fudgedDice?.includes("world") || ctx.config.fudges?.dice?.world !== void 0
    };
  },
  render(value2) {
    if (!value2) return [];
    return [
      `- <b>Roll:</b> ${value2.roll}${value2.fudged ? " (fudged)" : ""}`,
      `- <b>Table:</b> ${value2.table}`,
      `- <b>Event:</b> ${esc(value2.name)} — ${esc(value2.text)}`
    ];
  },
  parse: () => ({ value: null, errors: [] }),
  apply(state, lines2, ctx) {
    state.perTurn.worldsim = ctx.turn.worldsim;
    return lines2.map((line) => String(line).trim()).filter(Boolean);
  },
  facts(state, ctx) {
    const event = ctx.turn.worldsim;
    if (!event) return [];
    const facts = [`World Sim: ${event.name} — ${event.text}. Use it only if Fate's cell is TRUE; discard it on a WEIGHTED turn; skip it in an intimate scene.`];
    if (ctx.turn.fate?.source === "TRUE") facts.push(`If this World Sim event is realized, record its aftermath under Fate as \`World ${event.name} landed as actual aftermath\`. Keep this exact event name; replace only the aftermath text. Omit the command if the event is unused.`);
    return facts;
  },
  prompt: () => "",
  rules: () => "",
  template: () => []
};

// src/model/sections/thoughts.js
var COMMANDS9 = [
  { id: "thoughts.thought", form: "Name: this reply's raw thoughts", example: "Mara: he knows. he has to know. keep smiling.", keywords: [], freeText: true }
];
function parseThoughtLine(line) {
  const m = String(line).trim().match(/^([^:]{1,60}?)\s*:\s*(.+)$/);
  return m ? { name: m[1].trim(), text: m[2].trim() } : null;
}
var thoughts_default = {
  key: "thoughts",
  title: "🧠 INTERNAL THOUGHTS",
  match: /^INTERNAL THOUGHTS$/,
  change: "Thoughts",
  aliases: ["Thought"],
  carried: false,
  empty: () => [],
  isEmpty: (v) => !v.length,
  render: (value2) => value2.map((t) => `- <b>${esc(t.name)}</b> | ${esc(t.text)}`),
  parse: () => ({ value: [], errors: [] }),
  apply(state, lines2) {
    const unparsed = [];
    for (const raw of lines2) {
      const thought = parseThoughtLine(raw);
      if (thought) state.perTurn.thoughts.push(thought);
      else unparsed.push(String(raw).trim());
    }
    return unparsed;
  },
  prompt: () => "",
  rules: () => "Thoughts: include 1–3 NPCs whenever NPCs are involved in this reply, on-screen first (an off-screen one names where they are and what they are doing); 1–3 lines each, fragmented, impulsive and raw but true to the person, their mood and instincts. These are fictional character thoughts, written anew for this reply. Let them drive what the NPC does next.",
  commands: COMMANDS9,
  template: (ctx) => commandTemplate("Thoughts", COMMANDS9, ctx)
};

// src/model/sections/checks.js
var arrow = (ctx) => ctx && ctx.checkStyle === "arrow";
var COMMANDS10 = [
  {
    id: "checks.check",
    form: (ctx) => arrow(ctx) ? "Actor, gamble · d20 n ±m · Trajectory · the price" : "Actor, action · DC n · d20 n +m · Outcome",
    example: (ctx) => arrow(ctx) ? "Mara, leaps the gap · d20 11 +1 · Grazing Shot · she drops her lantern" : "Mara, picks the lock · DC 12 · d20 14 +2 · success",
    keywords: []
  }
];
var checks_default = {
  key: "checks",
  title: (ctx) => arrow(ctx) ? "🏹 WIND'S ARROW" : "🎲 DND TASK SIM",
  match: /^(DND TASK SIM|WIND S ARROW)$/,
  change: "Check",
  aliases: ["Checks"],
  carried: false,
  empty: () => ({ rolls: [], lines: [] }),
  isEmpty: (v) => !v.rolls.length && !v.lines.length,
  render: (value2) => [
    ...value2.rolls.length ? [`- <b>Rolls:</b> ${value2.rolls.join(", ")}${value2.fudged ? " (fudged)" : ""}`] : [],
    ...value2.lines.map((l) => `- ${esc(l)}`)
  ],
  parse: () => ({ value: { rolls: [], lines: [] }, errors: [] }),
  apply(state, lines2, ctx) {
    state.perTurn.checks.rolls = Array.isArray(ctx.rolls) ? [...ctx.rolls] : [];
    state.perTurn.checks.fudged = ctx.fudgedDice.includes("checks");
    for (const l of lines2) if (String(l).trim()) state.perTurn.checks.lines.push(String(l).trim());
    return [];
  },
  facts(state, ctx) {
    const r = Array.isArray(ctx.rolls) ? ctx.rolls : [];
    if (!r.length) return [];
    return [arrow(ctx) ? `Wind Rolls: ${r.join(", ")} — one per kinetic gamble, in order, ±1–3 for context; 1–7 Wind Drift, 8–14 Grazing Shot, 15–20 Bullseye.` : `Dice for skill checks: d20s ${r.join(", ")} — use them in order, one per check; lock the DC first.`];
  },
  prompt: () => "",
  rules: (ctx) => arrow(ctx) ? "Checks (Wind's Arrow): only uncertain, high-stakes kinetic gambles roll; mundane or conversational actions auto-pass. Commit to the outcome before writing: Wind Drift fails or is intercepted with a real setback, Grazing Shot succeeds at an immediate physical or tactical cost, Bullseye is clean. Under `Check:`, one line per roll used: `Actor, gamble · d20 n ±m · Trajectory · the price`." : "Checks (DnD): only a skilled action that can actually fail rolls; trivial tasks auto-pass. Lock the DC first from proficiency, items and titles (Easy 1–5, Moderate 5–10, Hard 10–15, Impossible 15–20), then Delta = d20 + mods − DC: Nat 20 or +8 crit success · 0 to +7 success · −1 to −3 near miss · −4 to −7 failure · Nat 1 or −8 crit failure. Dice are law; never fudge. Never name DCs, dice or stats in prose. Under `Check:`, one line per roll used: `Actor, action · DC n · d20 n +m · Outcome`.",
  commands: COMMANDS10,
  template: (ctx) => commandTemplate("Check", COMMANDS10, ctx)
};

// src/model/sections/physics.js
var COMMANDS11 = [
  { id: "physics.env", form: "Env: …", example: "Env: steady rain, lamplight, slick cobbles", keywords: ["Env"] },
  { id: "physics.scene", form: "Scene: …", example: "Scene: Mara at the door, Jan three paces back, the alley out of sight", keywords: ["Scene"] }
];
var physics_default = {
  key: "physics",
  title: "🌌 PHYSICS, ENGINE & WORLD",
  match: /^PHYSICS ENGINE WORLD$/,
  change: "Physics",
  carried: false,
  empty: () => ({ env: "", scene: "" }),
  isEmpty: (v) => !v.env && !v.scene,
  render: (value2) => [
    ...value2.env ? [`- <b>Env:</b> ${esc(value2.env)}`] : [],
    ...value2.scene ? [`- <b>Scene:</b> ${esc(value2.scene)}`] : []
  ],
  parse: () => ({ value: { env: "", scene: "" }, errors: [] }),
  apply(state, lines2) {
    const unparsed = [];
    for (const raw of lines2) {
      const m = String(raw).trim().match(/^(env|scene|physics)\s*:\s*(.+)$/i);
      if (m) state.perTurn.physics[m[1].toLowerCase() === "env" ? "env" : "scene"] = m[2].trim();
      else unparsed.push(String(raw).trim());
    }
    return unparsed;
  },
  prompt: () => "",
  rules: () => "Physics: Env is this reply's hazards, weather and light; Scene is positions, distances and line of sight.",
  commands: COMMANDS11,
  template: (ctx) => commandTemplate("Physics", COMMANDS11, ctx)
};

// src/model/sections/registry.js
var SECTIONS = [cast_default, agendas_default, locations_default, factions_default, quests_default, inventory_default, chekhov_default, fate_default, worldsim_default, last_default, thoughts_default, checks_default, physics_default];
var enabledSections = (sections = {}) => SECTIONS.filter((s) => (sections || {})[s.key] !== false);
var CORE_KEYS = ["scene", "relationships", "notebook"];
var NEEDS_PRESENT = ["cast", "agendas", "locations", "chekhov"];
var needsPresent = (sections = {}) => (sections || {}).scene !== false || NEEDS_PRESENT.some((k) => (sections || {})[k] !== false);

// src/model/headings.js
var CORE = [
  { change: "Threads", aliases: ["Thread"] },
  { change: "Relationships", aliases: ["Relationship"] },
  { change: "Proposed rules", aliases: ["Proposed rule"] },
  { change: "World" }
];
var WORDS = /^[A-Za-z][A-Za-z &'’]*$/;
var UNKNOWN = /^([A-Za-z][A-Za-z ]{0,30}):$/;
function headingKey(s) {
  return String(s).toLowerCase().replace(/[^a-z]/g, "");
}
function buildHeadings(sections) {
  const map = /* @__PURE__ */ new Map();
  for (const sec of [...sections, ...CORE]) {
    for (const label of [sec.change, ...sec.aliases || []]) {
      const key2 = headingKey(label);
      if (map.has(key2) && map.get(key2) !== sec.change) throw new Error(`heading alias collision: ${key2}`);
      map.set(key2, sec.change);
    }
  }
  return map;
}
var HEADINGS = buildHeadings(SECTIONS);
function headingOf(rec) {
  const text = String(rec.text).trim();
  const bare = text.replace(/^#{1,6}\s+/, "").replace(/\s*:$/, "").trim();
  if (WORDS.test(bare) && (!rec.bulleted || /:$/.test(text))) {
    const name = HEADINGS.get(headingKey(bare));
    if (name) return { name, known: true };
  }
  const m = !rec.bulleted && UNKNOWN.exec(text);
  return m ? { name: m[1].trim(), known: false } : null;
}

// src/model/notebook.js
var BLOCK_TAGS = "(?:Story_Ledger|Notebook)";
function emptyNotebook() {
  return { enabled: true, rules: [], threads: [], inbox: [], rejected: [], nextId: 1 };
}
var norm = (s) => String(s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
var LEDGER_BLOCK_RE = new RegExp(
  `<!--\\s*Story_Ledger\\b([\\s\\S]*?)(?:-->|$)|<${BLOCK_TAGS}\\b[^>]*>([\\s\\S]*?)(?:<\\/${BLOCK_TAGS}\\s*>|$)`,
  "gi"
);
function lastLedgerBlock(mes) {
  const re = new RegExp(LEDGER_BLOCK_RE.source, "gi");
  let m, last = null;
  while (m = re.exec(String(mes || ""))) {
    last = m[1] !== void 0 ? { body: m[1], kind: "comment" } : { body: m[2], kind: "tag" };
    if (m[0] === "") re.lastIndex++;
  }
  return last;
}
function notebookBody(mes) {
  return lastLedgerBlock(mes)?.body ?? null;
}
function section(body, heading) {
  const lines2 = body.split(/\r?\n|<br\s*\/?>/i);
  const out = [];
  let inside = false;
  for (const raw of lines2) {
    const line = raw.trim();
    if (/^[A-Za-z][A-Za-z ]{1,30}:\s*$/.test(norm(line))) {
      inside = norm(line).toLowerCase().startsWith(heading.toLowerCase());
      continue;
    }
    if (inside && line) out.push(line);
  }
  return out;
}
var bullet = (line) => norm(line).replace(/^[-*•]\s*/, "");
var NOW_LINE = /^\s*(?:[-*•]\s*)?Now\s*:\s*(.*)$/im;
var isSkeleton = (s) => /^\[.*\]$/.test(s);
var NO_PROPOSALS = /^(?:none|n\/a|nothing|no proposals?|[—–-])\.?$/i;
var THREAD_COMMANDS = [
  { id: "threads.add", form: "+ [T] thread that opened", example: "+ [T] Meet Mara at the mill on Day 4 at dawn", keywords: ["T"] },
  { id: "threads.remove", form: "- [T] thread that resolved", example: "- [T] Ask about the letter", keywords: ["T"] }
];
var PROPOSAL_COMMANDS = [
  { id: "rules.add", form: "add: rule", example: "add: Mara never lies to Jan", keywords: ["add"] },
  { id: "rules.edit", form: "edit R#: new text", example: "edit R1: Mara never lies to Jan, except to protect him", keywords: ["edit"] },
  { id: "rules.remove", form: "remove R#: why", example: "remove R1: the reader dropped it", keywords: ["remove"] }
];
function proposalOf(line) {
  let m;
  if (m = line.match(/^add\s*:\s*(.+)$/i)) return { op: "add", target: null, text: m[1].trim() };
  if (m = line.match(/^edit\s+R?(\d+)\s*:\s*(.+)$/i)) return { op: "edit", target: Number(m[1]), text: m[2].trim() };
  if (m = line.match(/^remove\s+R?(\d+)\s*(?::\s*(.*))?$/i)) return { op: "remove", target: Number(m[1]), text: (m[2] || "").trim() };
  return null;
}
function legacyNotebook(body) {
  const nowMatch = body.match(NOW_LINE);
  const nowText = nowMatch ? norm(nowMatch[1]) : "";
  const now = nowText && !isSkeleton(nowText) ? nowText : null;
  const threads = section(body, "Threads").filter((l) => !NOW_LINE.test(l) && !/^\s*(?:[-*•]\s*)?Present\s*:/i.test(l)).map(bullet).map((t) => t.replace(/^\[T\]\s*/i, "")).filter((t) => t && !isSkeleton(t));
  const proposals = section(body, "Proposed rules").map(bullet).map(proposalOf).filter(Boolean);
  return { now, threads, proposals };
}
var CORE_FIELD = /^(Now|Present|Public)\s*:\s*(.*)$/i;
function notebookFromRecords(records) {
  let nowText = null, current = null;
  const threads = [], proposals = [], unparsed = [];
  for (const rec of records) {
    const f = rec.text.match(CORE_FIELD);
    if (f) {
      if (nowText === null && f[1].toLowerCase() === "now") nowText = f[2].trim();
      current = null;
      continue;
    }
    const h = headingOf(rec);
    if (h) {
      current = h.known ? h.name : null;
      continue;
    }
    if (isCommandPlaceholder(rec.text, current === "Threads" ? THREAD_COMMANDS : current === "Proposed rules" ? PROPOSAL_COMMANDS : [])) continue;
    if (current === "Threads") {
      const t = rec.text.replace(/^\[T\]\s*/i, "");
      if (t && !isSkeleton(t)) threads.push(t);
    } else if (current === "Proposed rules") {
      const p = proposalOf(rec.text);
      if (p) proposals.push(p);
      else if (rec.text && !isSkeleton(rec.text) && !NO_PROPOSALS.test(rec.text)) unparsed.push(rec.text);
    }
  }
  const now = nowText && !isSkeleton(nowText) ? nowText : null;
  return { now, threads, proposals, unparsed };
}
function parseNotebookBlock(mes) {
  const block = lastLedgerBlock(mes);
  if (block === null) return null;
  return block.kind === "comment" ? notebookFromRecords(ledgerLines(block.body)) : legacyNotebook(block.body);
}
var WORLD_STATE_TIME = /\*\*\s*📅\s*Time:\s*\*\*\s*([^|\n]+?)\s*(?:\||\n|$)/i;
var HEADER_TIME = /^\[\s*🕰️?\s*([^\]\n]+?)\s*\]\s*$/m;
function stampOf(mes) {
  const nb = parseNotebookBlock(mes);
  if (nb && nb.now) return { text: nb.now, source: "notebook" };
  const ws = String(mes || "").match(WORLD_STATE_TIME);
  if (ws && !isSkeleton(norm(ws[1]))) return { text: norm(ws[1]), source: "world_state" };
  const hd = String(mes || "").match(HEADER_TIME);
  if (hd) return { text: norm(hd[1]), source: "ff_header" };
  return null;
}
function storyTime(chat, notebook, max = 6) {
  const msgs = chat || [];
  let now = null, nowIndex = -1;
  const trail = [];
  for (let i = msgs.length - 1; i >= 0 && trail.length < max; i--) {
    const msg = msgs[i];
    if (!msg || msg.is_user || msg.is_system) continue;
    const s = stampOf(msg.mes);
    if (!s) continue;
    if (!now) {
      now = s;
      nowIndex = i;
    }
    if (trail[trail.length - 1] !== s.text) trail.push(s.text);
  }
  const override = notebook && notebook.clockOverride;
  if (override && override.text && (nowIndex < 0 || nowIndex < override.atLength)) {
    now = { text: override.text, source: "reader" };
  }
  return { now, timeline: trail.reverse() };
}
var NOTEBOOK_BLOCK_TEMPLATE = [
  "Now: [Story time after this reply, free text — e.g. Day 12 — Tuesday, March 4, 21:44 | Lake, the lawn. Day N counts from the story's first day and never resets.]",
  "Threads:",
  "- [T] [Every open thread, carried forward and updated each turn: an intention, open question, promise, debt, appointment (with day and time), unresolved arc. Retire one when it resolves. At most 12.]",
  "Proposed rules:",
  "- [ONLY when the story establishes a fact that must never drift, or the reader gives a lasting out-of-character instruction. Write `add: <rule>`, `edit R#: <new text>`, or `remove R#: <why>`. Omit this section on every other turn. Never restate an existing rule here.]"
].join("\n");
function legacyNotebookSection(mes) {
  const s = String(mes || "");
  let m = s.match(/GM'S NOTEBOOK\s*<\/summary>([\s\S]*?)<\/details>/i);
  if (m) return m[1];
  m = s.match(/<story_notes\b[^>]*>([\s\S]*?)<\/story_notes>/i);
  if (m) return m[1];
  m = s.match(/<ledger\b[^>]*>[\s\S]*?NOTEBOOK:\s*([\s\S]*?)(?:\n[A-Z][A-Z &]{2,}:|<\/ledger>)/i);
  if (m) return m[1];
  return null;
}
function importFromLegacyNotebook(chat) {
  for (let i = (chat || []).length - 1; i >= 0; i--) {
    const msg = chat[i];
    if (!msg || msg.is_user) continue;
    const body = legacyNotebookSection(msg.mes);
    if (body === null) continue;
    const rules = [], threads = [];
    for (const raw of body.split(/\r?\n|<br\s*\/?>|\s+(?:\||&#124;)\s+(?=(?:[-*•]\s*)?\[[RTD]\])/i)) {
      const line = bullet(raw);
      const m = line.match(/^\[(R|T)\]\s*(.+)$/i);
      if (!m) continue;
      (m[1].toUpperCase() === "R" ? rules : threads).push(m[2].trim());
    }
    return { rules, threads };
  }
  return { rules: [], threads: [] };
}

// src/model/import/util.js
var plain = (s) => String(s ?? "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#124;/g, "|").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
var value = (s) => {
  const t = plain(s);
  return /^(none|—|-|n\/a|nothing|empty)?$/i.test(t) ? "" : t;
};
var titleKey = (t) => plain(t).replace(/[^A-Za-z ]/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
function summarySections(text) {
  const out = [];
  const re = /<summary>([\s\S]*?)<\/summary>/gi;
  let m;
  while (m = re.exec(text)) {
    const rest = text.slice(re.lastIndex);
    const stop = rest.search(/<\/?details\b/i);
    out.push({ title: plain(m[1]), key: titleKey(m[1]), body: stop < 0 ? rest : rest.slice(0, stop) });
  }
  return out;
}
var rowsOf = (body) => String(body || "").split(/\r?\n|<br\s*\/?>/i).map((l) => l.trim().replace(/^[-*•]\s*/, "")).filter((l) => plain(l));
function rowFields(row) {
  const b = row.match(/^<b>([\s\S]*?)<\/b>\s*(.*)$/);
  const name = b ? plain(b[1]).replace(/:\s*$/, "") : "";
  const rest = b ? b[2] : row;
  const fields = {};
  for (const part of rest.split("|")) {
    const m = plain(part).match(/^([A-Za-z][A-Za-z/ ]*?)\s*:\s*([\s\S]*)$/);
    if (m) fields[m[1].trim().toLowerCase()] = m[2];
  }
  return { name, rest: plain(rest), fields };
}
var listOf = (s) => value(s) ? value(s).split(/\s*[,;]\s*/).map((x) => x.trim()).filter(Boolean) : [];
var HEADER = /^\s*\[\s*🕰️?\s*([^\]\n]+?)\s*\]\s*$/m;
function headerNow(mes) {
  const h = String(mes || "").match(HEADER);
  if (!h) return "";
  return h[1].split("|").map((p) => plain(p).replace(/^[^\w]*(Time\s+)?/i, "").trim()).filter(Boolean).join(" | ");
}
var nowResolved = (now) => Boolean(now) && parseStoryTime(now) !== null;
var nowUnread = (now) => `Now — the imported time "${now}" has no clock time; restate Now with the time of day`;
var nameWords = (s) => plain(s).toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^\p{L}\p{N}{} ]+/gu, " ").split(/\s+/).filter(Boolean);
function sameName(name, userName) {
  if (/^\s*\{\{user\}\}\s*$/i.test(plain(name))) return true;
  const a = nameWords(name), b = nameWords(userName);
  if (!a.length || !b.length) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.every((w, i) => long[i] === w);
}
function bondsOf(rows, userName) {
  const out = {};
  for (const row of rows) {
    const m = plain(row).replace(/^[-*•]\s*/, "").match(/^(.+?)\s*(↔|<->|→|->)\s*(.+?)\s*(?:[:·|—–]\s*(.*))?$/);
    if (!m || !value(m[1]) || !value(m[3])) continue;
    const a = m[1].trim(), b = m[3].trim(), note = (m[4] || "").trim();
    const two = m[2] === "↔" || m[2] === "<->";
    if (!sameName(a, userName)) out[`${a}→${b}`] = note;
    if (two && !sameName(b, userName)) out[`${b}→${a}`] = note;
  }
  return out;
}
function quoted(title, body, max = 600) {
  const text = plain(body);
  return text ? `${title}: "${text.length > max ? `${text.slice(0, max)}…` : text}"` : title;
}

// src/model/relations.js
var pairKey = (from, to) => `${from}→${to}`;
function emptyRelations() {
  return { ct: 0, pairs: {}, selves: {} };
}
var clone = (s) => JSON.parse(JSON.stringify(s));
var clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
var zeroAcc = (config) => Object.fromEntries(config.axes.map((a) => [a.key, 0]));
function isWalled(pair, axisKey2, config) {
  const a = axisByKey(config, axisKey2);
  if (!a) return false;
  const x = pair.axes[axisKey2], m = pair.axes[a.mirror];
  return x === m && x >= config.wallMin && m >= config.wallMin;
}
function applyTurn(prev, events, present, config) {
  const s = clone(prev);
  const log = [];
  const here = new Set(present || []);
  s.ct += 1;
  const ev = { news: [], directs: [], ticks: [], phiTicks: [], notes: [], ...events || {} };
  const say = (kind, where, text) => log.push({ kind, where, text: text.replace(/(\S)→(\S)/g, "$1 → $2"), ct: s.ct });
  s.awaiting = { ...prev.awaiting || {} };
  const await_ = (k) => {
    if (!(k in s.awaiting)) s.awaiting[k] = "";
  };
  const queue = (kind, event) => {
    const k = pairKey(event.from, event.to);
    await_(k);
    (s.pending ||= []).push({ ct: s.ct, kind, ...event });
    say("queued", k, `${k}: ${kind} saved until its NEW baseline is written.`);
  };
  for (const n of ev.news) {
    const k = pairKey(n.from, n.to);
    if (s.pairs[k]) {
      say("refused", k, `NEW ${k} ignored: the pair already exists.`);
      continue;
    }
    const missing = config.axes.filter((a) => !(a.key in (n.axes || {}))).map((a) => a.key);
    if (missing.length) {
      say("refused", k, `NEW ${k} refused: missing ${missing.join(", ")}.`);
      await_(k);
      continue;
    }
    const axes = {};
    for (const a of config.axes) axes[a.key] = clamp(Math.round(Number((n.axes || {})[a.key] ?? 3)), config.axisMin, config.axisMax);
    s.pairs[k] = { from: n.from, to: n.to, axes, acc: zeroAcc(config), ...n.reason ? { note: n.reason } : {} };
    for (const w of Object.keys(s.awaiting)) {
      const [a, b] = w.split("→");
      if (sameName(a, n.from) && sameName(b, n.to)) delete s.awaiting[w];
    }
    say("new", k, `NEW ${k}${n.reason ? ` (${n.reason})` : ""}.`);
    if (n.phi !== void 0 && !s.selves[n.from]) {
      s.selves[n.from] = { phi: clamp(Math.round(Number(n.phi)), config.phi.min, config.phi.max), acc: 0 };
    }
  }
  const ready = { notes: [], directs: [], ticks: [] }, waiting = [];
  const matchesName = (a, b) => {
    const macro = /^\s*\{\{user\}\}\s*$/i;
    const resolve = (name) => macro.test(name) && config.userName ? config.userName : name;
    const x = resolve(a), y = resolve(b);
    return macro.test(x) || macro.test(y) ? x.trim().toLowerCase() === y.trim().toLowerCase() : sameName(x, y);
  };
  for (const event of s.pending || []) {
    const exact = s.pairs[pairKey(event.from, event.to)];
    const candidates = exact ? [exact] : Object.values(s.pairs).filter((p2) => matchesName(p2.from, event.from) && matchesName(p2.to, event.to));
    if (candidates.length !== 1) {
      waiting.push(event);
      await_(pairKey(event.from, event.to));
      continue;
    }
    const p = candidates[0];
    const list = { note: "notes", direct: "directs", tick: "ticks" }[event.kind];
    if (!list) {
      waiting.push(event);
      continue;
    }
    ready[list].push({ ...event, from: p.from, to: p.to });
    delete s.awaiting[pairKey(event.from, event.to)];
  }
  if (waiting.length) s.pending = waiting;
  else delete s.pending;
  for (const list of Object.keys(ready)) ev[list] = [...ready[list], ...ev[list]];
  for (const n of ev.notes) {
    const k = pairKey(n.from, n.to), p = s.pairs[k];
    if (!p) {
      queue("note", n);
      continue;
    }
    p.note = n.text;
    say("note", k, `${k} now reads: ${n.text}`);
  }
  for (const d of ev.directs) {
    const k = pairKey(d.from, d.to), p = s.pairs[k];
    if (!axisByKey(config, d.axis)) {
      say("refused", k, `DIRECT ${k} ${d.axis} refused: unknown axis.`);
      continue;
    }
    if (!p) {
      queue("direct", d);
      continue;
    }
    const amt = clamp(Math.round(Number(d.amount) || 0), 1, config.directMax);
    p.axes[d.axis] = clamp(p.axes[d.axis] + amt, config.axisMin, config.axisMax);
    say("direct", k, `${d.axis} +${amt} (direct${d.reason ? `: ${d.reason}` : ""}).`);
  }
  const sums = {};
  for (const t of ev.ticks) {
    const k = pairKey(t.from, t.to);
    if (!axisByKey(config, t.acc)) {
      say("refused", k, `${k}: unknown accumulator ${t.acc}.`);
      continue;
    }
    const amt = Math.round(Number(t.amount) || 0);
    if (amt <= 0) {
      say("refused", k, `${k} ${t.acc}_acc ${amt} refused: accumulators only tick up — friction has its own axis.`);
      continue;
    }
    if (!s.pairs[k]) {
      queue("tick", t);
      continue;
    }
    const id = `${t.ct ?? s.ct}|${k}|${t.acc}`;
    sums[id] = sums[id] || { k, acc: t.acc, amount: 0, reasons: [] };
    sums[id].amount += amt;
    if (t.reason) sums[id].reasons.push(t.reason);
  }
  for (const { k, acc, amount, reasons } of Object.values(sums)) {
    const p = s.pairs[k];
    const applied = Math.min(amount, config.tickCap);
    if (applied < amount) say("capped", k, `${acc}_acc capped at +${config.tickCap} this turn (asked +${amount}).`);
    p.acc[acc] += applied;
    say("tick", k, `${acc}_acc +${applied}${reasons.length ? ` (${reasons.join("; ")})` : ""}.`);
    const a = axisByKey(config, acc);
    const self = s.selves[p.from];
    if (a.kind === "fond" && applied === config.tickCap && self && self.phi < 0) {
      p.acc[a.mirror] += 1;
      say("transmission", k, `${a.mirror}_acc +1 (Philautia transmission: ${p.from}'s Φ is ${self.phi}).`);
    }
  }
  for (const t of ev.phiTicks) {
    const self = s.selves[t.who] = s.selves[t.who] || { phi: 0, acc: 0 };
    const amt = Math.round(Number(t.amount) || 0);
    self.acc = clamp(self.acc + amt, -config.phi.accCap, config.phi.accCap);
    say("phi", t.who, `Φ_acc ${amt >= 0 ? "+" : ""}${amt}${t.reason ? ` (${t.reason})` : ""}.`);
  }
  for (const [k, p] of Object.entries(s.pairs)) {
    for (const a of config.axes) {
      if (s.ct % a.period !== 0 || p.acc[a.key] < a.threshold) continue;
      if (isWalled(p, a.key, config)) {
        say("wall", k, `${a.key} held by WALL (${a.key} = ${a.mirror} = ${p.axes[a.key]}).`);
        continue;
      }
      p.axes[a.key] = clamp(p.axes[a.key] + 1, config.axisMin, config.axisMax);
      p.acc[a.key] = 0;
      say("convert", k, `${a.key} → ${p.axes[a.key]} (accumulator converted).`);
      if (a.kind === "fond" && p.axes[a.mirror] >= config.gravityMin) {
        p.acc[a.mirror] += 1;
        say("gravity", k, `${a.mirror}_acc +1 (Gravity Well: ${a.mirror} is ${p.axes[a.mirror]}).`);
      }
    }
  }
  if (s.ct % config.phi.period === 0) {
    for (const [who, self] of Object.entries(s.selves)) {
      if (self.acc >= config.phi.threshold) {
        self.phi = clamp(self.phi + 1, config.phi.min, config.phi.max);
        self.acc = 0;
        say("convert", who, `Φ → ${self.phi}.`);
      } else if (self.acc <= -config.phi.threshold) {
        self.phi = clamp(self.phi - 1, config.phi.min, config.phi.max);
        self.acc = 0;
        say("convert", who, `Φ → ${self.phi}.`);
      }
    }
  }
  for (const rule of config.decay) {
    if (s.ct % rule.period !== 0) continue;
    const [xk, mk] = rule.pair;
    for (const [k, p] of Object.entries(s.pairs)) {
      if (isWalled(p, xk, config)) continue;
      const x = p.axes[xk], m = p.axes[mk];
      if (Math.abs(x - m) < config.decayLead) continue;
      const [leadKey, trailKey] = x > m ? [xk, mk] : [mk, xk];
      const leading = p.axes[leadKey], trailing = p.axes[trailKey];
      const floor = Math.min(config.floorMax, Math.max(1, Math.ceil(leading / config.floorDivisor)));
      const offstage = !(here.has(p.from) && here.has(p.to));
      if (offstage && config.offstageSkip.includes(trailing)) continue;
      if (trailing <= floor) continue;
      p.axes[trailKey] = trailing - 1;
      say("decay", k, `${trailKey} → ${trailing - 1} (mirror decay against ${leadKey} ${leading}).`);
    }
  }
  return { state: s, log };
}
function replayRelations(turns, corrections, config, ctOffset = 0) {
  let state = { ...emptyRelations(), ct: ctOffset };
  const log = [];
  const pending = [...corrections || []].sort((a, b) => a.at - b.at);
  const correct = (c) => {
    if (c.who) {
      const self = state.selves[c.who] = state.selves[c.who] || { phi: 0, acc: 0 };
      if (c.phi !== void 0) self.phi = clamp(c.phi, config.phi.min, config.phi.max);
      if (c.phiAcc !== void 0) self.acc = clamp(c.phiAcc, -config.phi.accCap, config.phi.accCap);
      log.push({ kind: "reader", where: c.who, text: `Reader set ${c.who}'s Φ.`, ct: state.ct });
      return;
    }
    const k = pairKey(c.from, c.to);
    const p = state.pairs[k] = state.pairs[k] || { from: c.from, to: c.to, axes: Object.fromEntries(config.axes.map((a) => [a.key, 3])), acc: zeroAcc(config) };
    for (const [ax, v] of Object.entries(c.axes || {})) if (ax in p.axes) p.axes[ax] = clamp(v, config.axisMin, config.axisMax);
    for (const [ax, v] of Object.entries(c.acc || {})) if (ax in p.acc) p.acc[ax] = Math.max(0, v);
    log.push({ kind: "reader", where: k, text: `Reader corrected ${k}.`, ct: state.ct });
  };
  turns.forEach((turn, i) => {
    while (pending.length && pending[0].at <= i) correct(pending.shift());
    const r = applyTurn(state, turn.events, turn.present, config);
    state = r.state;
    log.push(...r.log.map((l) => ({ ...l, turn: i })));
  });
  while (pending.length) correct(pending.shift());
  return { state, log };
}
var PATTERNS = [
  { id: "hookup", test: (a) => a.L >= 8 && a.E <= 3, gloss: "casual flirtation/sex, no strings" },
  { id: "fwb", test: (a) => a.L >= 6 && a.Ph >= 6 && a.E <= 4, gloss: "playful intimacy on a friendship foundation" },
  { id: "slow_burn", test: (a, phi) => a.E >= 6 && a.Ph >= 8 && a.Ag >= 5 && phi >= 6, gloss: "deep connection forming; physicality follows emotional safety" },
  { id: "comfortable_marriage", test: (a) => a.Pr >= 14 && a.Sg >= 12 && a.Ph >= 10 && a.E <= 5, gloss: "love built, not felt as heat" },
  { id: "messy_entanglement", test: (a) => a.E >= 10 && a.M >= 8, gloss: "wanting and resenting the wanting" },
  { id: "bitter_ex", test: (a) => a.Sg >= 8 && a.Ec >= 8 && a.E <= 2, gloss: "too close for strangers, too damaged for friends" },
  { id: "rival", test: (a) => a.Er >= 8 && a.Ph >= 6 && a.Ag <= 3, gloss: "the contest is the connection" },
  { id: "cold_arrangement", test: (a) => a.Pr >= 10 && a.St >= 8 && a.Ad >= 6, gloss: "the partnership works; the relationship doesn't" },
  { id: "corrosive_bond", test: (a, phi) => a.E >= 10 && phi <= -6, gloss: "love real, but the receiver can't trust it" },
  { id: "healing_pair", test: (a, phi) => phi >= 6 && a.Ag >= 8 && a.M <= 4, gloss: "doing the work; friction released, not ignored" }
];
function tierOf(value2, kind, config) {
  const t = config.tiers.find((t2) => value2 >= t2.min && value2 <= t2.max);
  return t ? t[kind] : "Neutral";
}
function describePair(state, from, to, config) {
  const p = state.pairs[pairKey(from, to)];
  if (!p) return null;
  const phi = (state.selves[from] || { phi: 0 }).phi;
  const axes = {};
  for (const a of config.axes) axes[a.key] = { value: p.axes[a.key], acc: p.acc[a.key], tier: tierOf(p.axes[a.key], a.kind, config) };
  const g = config.romanceGate;
  const romance = p.axes.E >= g.E || p.axes.L >= g.L ? "allowed" : "locked";
  const walls = config.axes.filter((a) => a.kind === "fond" && isWalled(p, a.key, config)).map((a) => `${a.key}/${a.mirror}`);
  const patterns = PATTERNS.filter((x) => x.test(p.axes, phi)).map((x) => x.id);
  return { from, to, phi, axes, romance, walls, patterns };
}
var PATTERN_GLOSS = Object.fromEntries(PATTERNS.map((p) => [p.id, p.gloss]));
var RELATION_COMMANDS = [
  { id: "rel.tick", form: "A → B: E_acc +1 (reason) | M_acc +2 (reason)", example: "Mara → Jan: E_acc +1 (he remembered her song) | M_acc +2 (he laughed at her boat)", keywords: [] },
  { id: "rel.phi", form: "A: Φ_acc +1 (reason)", example: "Mara: Φ_acc +1 (she won the race)", keywords: [] },
  { id: "rel.direct", form: "DIRECT A → B: E +1 (reason)", example: "DIRECT Mara → Jan: E +1 (he pulled her from the river)", keywords: ["DIRECT"] },
  {
    id: "rel.new",
    form: "NEW A → B: E 3, M 4, L 3, Er 3, Ph 4, Ec 5, Pr 3, St 4, Sg 3, Ad 3, Ag 3, Pt 4 | Φ 2 (why)",
    example: "NEW Mara → Jan: E 3, M 4, L 5, Er 3, Ph 6, Ec 4, Pr 3, St 4, Sg 3, Ad 3, Ag 4, Pt 3 | Φ 2 (old rivals from the boat races)",
    keywords: ["NEW"]
  },
  { id: "rel.note", form: "NOTE A → B: description", example: "NOTE Mara → Jan: rivals who have started to trust each other", keywords: ["NOTE"], freeText: true }
];
var LEGACY_ARROWS = "→|->|↔|<->|=>";
var ARROWS = "→|<->|->|↔|=>|⟶|➔|➜|⇔";
var grammar = (A) => ({
  ARROW: new RegExp(String.raw`\s*(?:${A})\s*`),
  NOTE: new RegExp(String.raw`^NOTE\s+(.+?)\s*(?:${A})\s*(.+?)\s*:\s*(.+)$`, "i"),
  NEW: new RegExp(String.raw`^NEW\s+(.+?)\s*(?:${A})\s*(.+?)\s*:\s*(.+)$`, "i"),
  DIRECT: new RegExp(String.raw`^DIRECT\s+(.+?)\s*(?:${A})\s*(.+?)\s*:\s*([A-Za-z]+)\s*\+?\s*(\d+)\s*(.*)$`, "i"),
  TICK: new RegExp(String.raw`^(.+?)\s*(?:${A})\s*(.+?)\s*:\s*(.+)$`)
});
var GRAMMAR = grammar(ARROWS);
var LEGACY_GRAMMAR = grammar(LEGACY_ARROWS);
var AXIS_ALIASES = {
  eros: "E",
  misos: "M",
  ludus: "L",
  eris: "Er",
  philia: "Ph",
  echthros: "Ec",
  pragma: "Pr",
  stasis: "St",
  storge: "Sg",
  adiaphora: "Ad",
  agape: "Ag",
  phthonos: "Pt"
};
var AXES = ["E", "M", "L", "Er", "Ph", "Ec", "Pr", "St", "Sg", "Ad", "Ag", "Pt"];
function axisKey(raw) {
  const s = String(raw || "").replace(/_acc$/i, "").trim();
  const exact = AXES.find((a) => a === s) || AXES.find((a) => a.toLowerCase() === s.toLowerCase());
  return exact || AXIS_ALIASES[s.toLowerCase()] || null;
}
var reasonOf = (s) => {
  const m = String(s).match(/\(([^)]*)\)\s*$/);
  return m ? m[1].trim() : "";
};
var withoutReason = (s) => String(s).replace(/\([^)]*\)\s*$/, "").trim();
var isPhi = (s) => /^(?:Φ|phi|philautia)(?:_acc)?$/i.test(String(s).trim());
function parseRelationLines(lines2, { legacy = false } = {}) {
  const out = { news: [], directs: [], ticks: [], phiTicks: [], notes: [], unparsed: [] };
  const { ARROW, NOTE, NEW, DIRECT, TICK } = legacy ? LEGACY_GRAMMAR : GRAMMAR;
  for (const raw of lines2 || []) {
    const line = raw !== null && typeof raw === "object" ? String(raw.text).trim() : legacy ? String(raw).replace(/<[^>]+>/g, "").replace(/^\s*[-*•]\s*/, "").trim() : normalizeLine(String(raw)).text;
    if (!line) continue;
    if (!legacy && (/^\[.*\]$/.test(line) || isCommandPlaceholder(line, RELATION_COMMANDS))) {
      out.unparsed.push(line);
      continue;
    }
    let m;
    if (m = line.match(NOTE)) {
      out.notes.push({ from: m[1].trim(), to: m[2].trim(), text: m[3].trim() });
      continue;
    }
    if (m = line.match(NEW)) {
      const reason = reasonOf(m[3]);
      const [axPart, phiPart] = withoutReason(m[3]).split("|");
      const axes = {};
      for (const kv of axPart.split(/[,;]/)) {
        const mm = kv.trim().match(/^([A-Za-zΦ]+)\s*[:=]?\s*(-?\d+)$/);
        const k = mm && axisKey(mm[1]);
        if (k) axes[k] = Number(mm[2]);
      }
      const phiM = phiPart && phiPart.match(/(?:Φ|phi|philautia)\s*[:=]?\s*(-?\d+)/i);
      out.news.push({ from: m[1].trim(), to: m[2].trim(), axes, ...phiM ? { phi: Number(phiM[1]) } : {}, reason });
      continue;
    }
    if (m = line.match(DIRECT)) {
      const k = axisKey(m[3]);
      if (k) {
        out.directs.push({ from: m[1].trim(), to: m[2].trim(), axis: k, amount: Number(m[4]), reason: reasonOf(m[5]) });
        continue;
      }
    }
    if ((m = line.match(/^([^:→↔>-][^:]*?)\s*:\s*(Φ|phi|philautia)(?:_acc)?\s*([+-]\s*\d+)\s*(.*)$/i)) && !ARROW.test(m[1])) {
      out.phiTicks.push({ who: m[1].trim(), amount: Number(m[3].replace(/\s/g, "")), reason: reasonOf(m[4]) });
      continue;
    }
    if (m = line.match(TICK)) {
      let any = false;
      for (const part of m[3].split("|")) {
        const mm = part.trim().match(/^([A-Za-z]+)(?:_acc)?\s*([+-]\s*\d+)\s*(.*)$/);
        const k = mm && axisKey(mm[1]);
        if (k && !isPhi(mm[1])) {
          out.ticks.push({ from: m[1].trim(), to: m[2].trim(), acc: k, amount: Number(mm[2].replace(/\s/g, "")), reason: reasonOf(mm[3]) });
          any = true;
        }
      }
      if (any) continue;
    }
    out.unparsed.push(line);
  }
  return out;
}

// src/model/changes.js
var clean = (s) => String(s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
var unbullet2 = (s) => s.replace(/^\s*[-*•]\s+/, "");
var isSkeleton2 = (s) => /^\[.*\]$/.test(s);
var FIELD = /^\s*(?:[-*•]\s*)?(Now|Present|Public)\s*:\s*(.*)$/i;
var CORE_FIELD2 = /^(Now|Present|Public)\s*:\s*(.*)$/i;
var HEADING = /^([A-Za-z][A-Za-z ]{0,30}):\s*$/;
var OWN = /* @__PURE__ */ new Set(["Threads", "Relationships", "Proposed rules"]);
var NO_HEADING = "(no heading)";
var LABELLED = /^[A-Za-z][\w ]{0,30}\s*:\s*\S/;
function joinWorldContinuations(records) {
  const joined = [];
  let current = null, annotation = null;
  const indent = (record) => record.raw.match(/^\s*/)[0].length;
  for (const rec of records) {
    const heading = headingOf(rec);
    const boundary = heading || CORE_FIELD2.test(rec.text) || rec.bulleted || /^[A-Za-z][\w ]*\s*:/.test(rec.text) || /^(?:(?:World\s*:\s*)?(?:update|escalate|land)\b|(?:defer|resolve)\s+D\d+\b|ambition\s+\+|World\s+|[+-]\s)/i.test(rec.text);
    if (annotation && !boundary && indent(rec) > indent(annotation)) {
      annotation.raw += "\n" + rec.raw;
      annotation.unfolded += " " + rec.unfolded;
      annotation.text += " " + rec.text;
      continue;
    }
    annotation = null;
    if (heading) current = heading.known ? heading.name : null;
    else if (CORE_FIELD2.test(rec.text)) current = null;
    joined.push(rec);
    if ((current === "Fate" || current === "World") && /^(?:World\s*:\s*)?(?:update|escalate)\s+W\d+\s*:\s*\S/i.test(rec.text)) annotation = rec;
  }
  return joined;
}
var commandsUnder = (heading) => heading === "Threads" ? THREAD_COMMANDS : heading === "Proposed rules" ? PROPOSAL_COMMANDS : SECTIONS.filter((s) => s.change === heading || heading === "World" && s.key === "fate").flatMap((s) => s.commands || []);
var emptyChanges = () => ({
  now: null,
  present: null,
  public: null,
  threads: { add: [], remove: [] },
  relations: null,
  proposals: [],
  sections: {},
  unparsed: []
});
function setField(out, name, v) {
  if (!v || isSkeleton2(v)) return;
  const k = name.toLowerCase();
  if (k === "now") out.now = v;
  else if (k === "present") out.present = v.split(/[,;]/).map((s) => s.trim()).filter((s) => s && !isSkeleton2(s));
  else out.public = /^(yes|true|public)\b/i.test(v);
}
function parseChanges(mes) {
  const block = lastLedgerBlock(mes);
  if (block === null) return null;
  return block.kind === "comment" ? parseComment(ledgerLines(block.body)) : parseLegacyLines(block.body, mes);
}
function parseComment(records) {
  records = joinWorldContinuations(records);
  const out = { ...emptyChanges(), raw: {}, rawThreads: { add: [], remove: [] }, orderedSections: [] };
  const relationships = [];
  let current = null;
  for (const rec of records) {
    const f = rec.text.match(CORE_FIELD2);
    if (f) {
      setField(out, f[1], f[2].trim());
      current = null;
      continue;
    }
    const h = headingOf(rec);
    if (h) {
      current = h.known ? h.name : { unknown: h.name };
      if (h.known && !OWN.has(h.name)) {
        out.sections[h.name] = out.sections[h.name] || [];
        out.raw[h.name] = out.raw[h.name] || [];
      }
      continue;
    }
    if (!current) {
      if (rec.bulleted || LABELLED.test(rec.text)) out.unparsed.push({ section: NO_HEADING, line: rec.text, raw: rec.raw });
      continue;
    }
    if (typeof current === "object") {
      out.unparsed.push({ section: current.unknown, line: rec.text, raw: rec.raw });
      continue;
    }
    if (isCommandPlaceholder(rec.text, commandsUnder(current))) {
      out.unparsed.push({ section: current, line: rec.text });
      continue;
    }
    if (current === "Threads") readThread(out, rec);
    else if (current === "Relationships") relationships.push(rec);
    else if (isSkeleton2(rec.text)) out.unparsed.push({ section: current, line: rec.text });
    else if (current === "Proposed rules") continue;
    else {
      out.sections[current].push(rec.text);
      out.raw[current].push(rec.unfolded);
      out.orderedSections.push({ section: current, line: rec.text });
    }
  }
  out.relations = parseRelationLines(relationships);
  const nb = notebookFromRecords(records);
  out.proposals = nb.proposals;
  for (const line of nb.unparsed) out.unparsed.push({ section: "Proposed rules", line });
  return out;
}
function readThread(out, rec) {
  const re = rec.bulleted ? /^([+-])\s*(?:\[T\]\s*)?(.+)$/i : /^([+-])\s*\[T\]\s*(.+)$/i;
  const m = rec.text.match(re);
  const text = m && m[2].trim();
  if (!m || !text || isSkeleton2(text)) {
    out.unparsed.push({ section: "Threads", line: rec.text });
    return;
  }
  const u = rec.unfolded.match(re);
  const op = m[1] === "+" ? "add" : "remove";
  out.threads[op].push(text);
  out.rawThreads[op].push(u ? u[2].trim() : text);
}
function parseLegacyLines(body, mes) {
  const out = emptyChanges();
  const raw = {};
  let current = null;
  for (const line of body.split(/\r?\n|<br\s*\/?>/i)) {
    if (!line.trim()) continue;
    const f = line.match(FIELD);
    if (f) {
      setField(out, f[1], clean(f[2]));
      current = null;
      continue;
    }
    const h = line.match(HEADING);
    if (h) {
      current = h[1].trim().replace(/\s+/g, " ");
      raw[current] = raw[current] || [];
      continue;
    }
    if (current) raw[current].push(line.trim());
  }
  for (const [name, lines2] of Object.entries(raw)) {
    const key2 = name.toLowerCase();
    if (key2 === "threads") {
      for (const l of lines2) {
        const m = l.match(/^[-*•]\s+([+-])\s*(?:\[T\]\s*)?(.+)$/i) || l.match(/^([+-])\s*\[T\]\s*(.+)$/i);
        const text = m && clean(m[2]);
        if (m && text && !isSkeleton2(text)) (m[1] === "+" ? out.threads.add : out.threads.remove).push(text);
        else out.unparsed.push({ section: name, line: clean(unbullet2(l)) });
      }
    } else if (key2 !== "relationships" && key2 !== "proposed rules") {
      const all = lines2.map((l) => clean(unbullet2(l))).filter(Boolean);
      for (const l of all.filter(isSkeleton2)) out.unparsed.push({ section: name, line: l });
      out.sections[name] = all.filter((l) => !isSkeleton2(l));
    }
  }
  out.relations = parseRelationLines(raw.Relationships || raw.relationships || [], { legacy: true });
  out.proposals = parseNotebookBlock(mes).proposals;
  return out;
}

// src/model/block.js
var BLOCK_MARK = "<!-- story-ledger-state v1 -->";
var clone2 = (o) => JSON.parse(JSON.stringify(o));
var AWAITING = "Awaiting NEW";
var NO_COMMENT = String.raw`(?!<!--\s*Story_Ledger\b)`;
var GFX_CLOSED = new RegExp(String.raw`<!--\s*GFX_START\s*-->(?:(?!<!--\s*GFX_START\s*-->)${NO_COMMENT}[\s\S])*?<!--\s*GFX_END\s*-->`, "i");
var IS_CLOSED = new RegExp(String.raw`(?:<!--\s*GFX_START\s*-->\s*)?<internal_states>(?:(?!<internal_states>)${NO_COMMENT}[\s\S])*?<\/internal_states>(?:\s*<!--\s*GFX_END\s*-->)?`, "i");
function findBlock(mes) {
  const text = String(mes || "");
  const m = text.match(GFX_CLOSED) || text.match(IS_CLOSED);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}
var titleKey2 = (t) => t.replace(/[^A-Za-z ]/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
function sectionsOf(text) {
  const out = {};
  const re = /<summary>([\s\S]*?)<\/summary>/gi;
  let m;
  while (m = re.exec(text)) {
    const rest = text.slice(re.lastIndex);
    const stop = rest.search(/<\/?details\b/i);
    const body = stop < 0 ? rest : rest.slice(0, stop);
    out[titleKey2(m[1])] = body.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[-*•]/.test(l));
  }
  return out;
}
var SECTION_KEYS = [...CORE_KEYS, ...SECTIONS.filter((s) => s.carried).map((s) => s.key)];
function parseScene(rows, base, errors) {
  for (const row of rows) {
    const m = row.match(ROW);
    const field3 = m && m[1].replace(/:\s*$/, "").trim().toLowerCase();
    const value2 = m ? unesc(m[2].replace(/^:\s*/, "")) : "";
    if (field3 === "now") base.scene.now = value2;
    else if (field3 === "present") base.scene.present = value2 ? value2.split(/\s*,\s*/).filter(Boolean) : [];
    else if (field3 === "public") base.scene.public = /^(yes|true)/i.test(value2);
    else errors.push({ section: "SCENE", row });
  }
}
function parseRelations(rows, base, prev, config, errors) {
  const pairs = {}, selves = {}, awaiting = {}, pending = [];
  let pendingError = false;
  for (const row of rows) {
    const m = row.match(ROW);
    if (!m) {
      errors.push({ section: "RELATIONSHIPS", row });
      continue;
    }
    const name = unesc(m[1]);
    const fields = m[2].replace(/^\|\s*/, "");
    const saved = name.match(/^Pending (tick|direct|note):\s*(.+)$/);
    if (!saved && /^Pending\b/i.test(name)) {
      pendingError = true;
      errors.push({ section: "RELATIONSHIPS", row });
      continue;
    }
    if (saved) {
      const arrow3 = saved[2].lastIndexOf(" → ");
      const parts = fields.split(/\s*\|\s*/);
      const turn = parts[0].match(/^turn (\d+)$/);
      const ct = turn ? Number(turn[1]) : 0;
      const from = saved[2].slice(0, arrow3).trim(), to = saved[2].slice(arrow3 + 3).trim();
      const event = { ct, kind: saved[1], from, to };
      let valid = arrow3 > 0 && Boolean(to) && ct > 0 && ct <= base.ct;
      if (event.kind === "note") {
        const note = parts[1]?.match(/^note:\s*(\S.*)$/);
        valid &&= parts.length === 2 && Boolean(note);
        if (note) event.text = unesc(note[1]);
      } else {
        const value2 = parts[1]?.match(/^([A-Za-z]{1,3}) \+(\d+)$/);
        const reason = parts[2]?.match(/^reason:\s*(.*)$/);
        valid &&= parts.length === 3 && Boolean(value2 && reason) && config.axes.some((a) => a.key === value2?.[1]) && Number(value2?.[2]) > 0;
        if (value2) {
          event[event.kind === "tick" ? "acc" : "axis"] = value2[1];
          event.amount = Number(value2[2]);
        }
        if (reason) event.reason = unesc(reason[1]);
      }
      if (valid) pending.push(event);
      else {
        pendingError = true;
        errors.push({ section: "RELATIONSHIPS", row });
      }
      continue;
    }
    if (name === AWAITING) {
      for (const k of fields.split(/\s+·\s+/).map((x) => unesc(x).trim()).filter(Boolean)) awaiting[k.replace(/\s*→\s*/, "→")] = "";
      continue;
    }
    if (name.startsWith(`${AWAITING}:`)) {
      const note = unesc(fields).trim();
      awaiting[name.slice(AWAITING.length + 1).trim().replace(/\s*→\s*/, "→")] = note === "—" ? "" : note;
      continue;
    }
    const arrow2 = name.lastIndexOf(" → ");
    if (arrow2 > 0) {
      const from = name.slice(0, arrow2).trim(), to = name.slice(arrow2 + 3).trim();
      const key2 = `${from}→${to}`;
      const axes = {}, acc = {};
      const noteAt = fields.search(/\|\s*note:/);
      const nums = noteAt >= 0 ? fields.slice(0, noteAt) : fields;
      const note = noteAt >= 0 ? unesc(fields.slice(noteAt).replace(/^\|\s*note:\s*/, "")) : "";
      for (const t of nums.matchAll(/\b([A-Za-z]{1,3})\s+(-?\d+)·(-?\d+)/g)) {
        axes[t[1]] = Number(t[2]);
        acc[t[1]] = Number(t[3]);
      }
      if (config.axes.every((a) => a.key in axes)) pairs[key2] = { from, to, axes, acc, ...note ? { note } : {} };
      else {
        errors.push({ section: "RELATIONSHIPS", row });
        if (prev?.rel?.pairs?.[key2]) pairs[key2] = clone2(prev.rel.pairs[key2]);
      }
    } else {
      const phi = fields.match(/Φ\s*(-?\d+)·(-?\d+)/);
      if (phi) selves[name] = { phi: Number(phi[1]), acc: Number(phi[2]) };
      else {
        errors.push({ section: "RELATIONSHIPS", row });
        if (prev?.rel?.selves?.[name]) selves[name] = clone2(prev.rel.selves[name]);
      }
    }
  }
  const savedPending = pendingError && prev?.rel?.pending ? clone2(prev.rel.pending) : pending;
  base.rel = { pairs, selves, awaiting, ...savedPending.length ? { pending: savedPending } : {} };
}
function parseBlock(text, { prev = null, config }) {
  const t = String(text || "");
  const at = t.indexOf(BLOCK_MARK);
  if (at < 0) return null;
  const endAt = t.search(/<!--\s*GFX_END\s*-->/i);
  const block = t.slice(at, endAt > at ? endAt : void 0);
  const base = prev ? clone2(prev) : emptyState();
  const errors = [];
  const ct = block.match(/INTERNAL STATES\s*\(Turn:\s*(\d+)\)/i);
  if (ct) base.ct = Number(ct[1]);
  const ids = block.match(/<!--\s*story-ledger-ids([^>]*?)-->/);
  if (ids) {
    base.ids = { ...base.ids || {} };
    for (const m of ids[1].matchAll(/([A-Z])(\d+)/g)) base.ids[m[1]] = Math.max(base.ids[m[1]] || 0, Number(m[2]));
  }
  const secs = sectionsOf(block);
  const found = [];
  if (secs.SCENE) {
    parseScene(secs.SCENE, base, errors);
    found.push("scene");
  }
  if (secs.RELATIONSHIPS) {
    parseRelations(secs.RELATIONSHIPS, base, prev, config, errors);
    found.push("relationships");
  }
  if (secs.NOTEBOOK) {
    base.threads = secs.NOTEBOOK.map((r) => r.match(/^[-*•]\s*\[T\]\s*(.*)$/i)).filter(Boolean).map((m) => unesc(m[1])).filter(Boolean);
    found.push("notebook");
  }
  for (const sec of SECTIONS.filter((x) => x.carried)) {
    const title = Object.keys(secs).find((k) => sec.match.test(k));
    if (!title) {
      if (base[sec.key] === void 0) base[sec.key] = sec.empty();
      continue;
    }
    const r = sec.parse(secs[title], prev ? prev[sec.key] : void 0);
    base[sec.key] = r.value;
    for (const row of r.errors) errors.push({ section: title, row });
    found.push(sec.key);
  }
  base.perTurn = {};
  const recoverInventoryIds = Boolean((base.ids?.I || base.inv?.itemIds?.some(Boolean)) && base.inv?.items.some((_, i) => !base.inv.itemIds?.[i]));
  ensureItemIds(base, prev?.inv);
  return { state: base, errors, sections: found, ...recoverInventoryIds ? { recoverInventoryIds: true } : {} };
}

// src/model/import/ff.js
var PER_TURN = /THOUGHTS|DND|WORLD SIM|PHYSICS|INTERNAL STATES/;
function agendas(rows, s) {
  let n = 0;
  for (const row of rows) {
    const { name, fields, rest } = rowFields(row);
    const step = rest.match(/\(?\s*Step\s+(\d+)\s*\/\s*(\d+)\s*\)?/i);
    if (!name || !("agenda" in fields)) continue;
    s.agendas[name] = {
      task: value(fields.agenda),
      step: step ? Number(step[1]) : 0,
      max: step ? Number(step[2]) : 0,
      aware: value(fields.aware),
      fibs: value(fields.fibs),
      circle: value(fields.circle),
      body: value(fields.body)
    };
    n++;
  }
  return n;
}
function locations(rows, s) {
  let n = 0;
  for (const row of rows) {
    const { name, fields } = rowFields(row);
    if (name && value(fields.location)) {
      s.locations[name] = value(fields.location);
      n++;
    }
  }
  return n;
}
function factions(rows, s) {
  let n = 0;
  for (const row of rows) {
    const { name, fields } = rowFields(row);
    if (!name || !["goal", "intel", "fibs", "state", "conflict", "relations"].some((k) => k in fields)) continue;
    s.factions[name] = Object.fromEntries(["goal", "intel", "fibs", "state", "conflict", "relations"].map((k) => [k, value(fields[k])]));
    n++;
  }
  return n;
}
function quests(rows, s) {
  let n = 0;
  for (const row of rows) {
    const { name, fields, rest } = rowFields(row);
    const kind = (name.match(/^(Main|Side)\b/i) || [])[1];
    if (!kind) continue;
    const statusOf = (t) => /^(completed|complete|done|finished)$/i.test(t) ? "done" : /^(dropped|failed|abandoned)$/i.test(t) ? "dropped" : /^active$/i.test(t) ? "active" : "";
    let objective = value(fields.objective);
    let status = statusOf(value(fields.status));
    if (!objective) {
      const head = plain(rest.split("|")[0]);
      const lead = head.match(/^(active|completed|complete|done|finished|dropped|failed|abandoned|none)\s*[—–-]\s*(.*)$/i);
      if (lead) {
        status = status || statusOf(lead[1]);
        objective = value(lead[2]);
      } else objective = value(head);
    }
    const tail = objective.match(/\s*\((completed|complete|done|finished|active|dropped|failed|abandoned)\)\s*$/i);
    if (tail) {
      status = status || statusOf(tail[1]);
      objective = objective.slice(0, tail.index).trim();
    }
    status = status || "active";
    if (!objective || /^none$/i.test(objective)) continue;
    s.quests.push({
      id: nextId(s, "Q", s.quests.map((q) => q.id)),
      kind: kind[0].toUpperCase() + kind.slice(1).toLowerCase(),
      status,
      objective,
      progress: value(fields.progress),
      reward: value(fields.reward),
      send: false
    });
    n++;
  }
  return n;
}
function inventory(rows, s) {
  let n = 0;
  for (const row of rows) {
    const { name, rest } = rowFields(row);
    const label = name.toLowerCase();
    if (label === "inv" || label === "inventory") {
      s.inv.items = listOf(rest);
      n++;
    } else if (/^titles/.test(label)) {
      s.inv.titles = listOf(rest);
      n++;
    } else if (label === "status") {
      s.inv.status = listOf(rest);
      n++;
    } else if (label === "mods") {
      s.inv.mods = value(rest);
      n++;
    }
  }
  return n;
}
function chekhov(body, s) {
  const text = plain(body);
  const now = parseStoryTime(s.scene.now);
  const seg = (name) => {
    const m = text.match(new RegExp(`(?:^|[\\s·-])${name}\\s*:\\s*(.*?)(?=[\\s·-]+(?:Active|Locked|Fired)\\s*:|$)`, "i"));
    return m ? m[1] : "";
  };
  const bulletsIn = (part, lockedSeg) => {
    for (const m of part.matchAll(/\[BULLET:\s*([^\]]+)\]\s*\(\s*weight:\s*(\d)\s*,\s*age:\s*(\d+)(?:\s*\/\s*\d+)?\s*\)((?:\s*\[[^\]]*\])*)/gi)) {
      const flags = m[4] || "";
      const b = {
        id: "",
        desc: m[1].trim(),
        weight: Math.min(3, Math.max(1, Number(m[2]))),
        age: Number(m[3]),
        hot: /\[hot\]/i.test(flags),
        secret: /\[secret\]/i.test(flags),
        lock: "",
        at: null,
        after: ""
      };
      const lock = flags.match(/\[LOCKED:\s*([^\]]+)\]/i);
      if (lock) {
        const t = lock[1].replace(/^T\s*:\s*/i, "");
        b.at = lockTime(t, now);
        if (!b.at) b.lock = lock[1].trim();
      } else if (lockedSeg) b.lock = "imported lock";
      const dep = flags.match(/\[depends:\s*([^\]]+)\]/i);
      if (dep) b.lock = [b.lock, `depends on ${dep[1].trim()}`].filter(Boolean).join("; ");
      b.id = nextId(s, "B", s.chekhov.bullets.map((x) => x.id));
      s.chekhov.bullets.push(b);
    }
  };
  bulletsIn(seg("Active"), false);
  bulletsIn(seg("Locked"), true);
  const firedSeg = seg("Fired");
  const firedDescs = /\[BULLET:/i.test(firedSeg) ? [...firedSeg.matchAll(/\[BULLET:\s*([^\]]+)\]/gi)].map((m) => m[1].trim()) : listOf(firedSeg);
  for (const f of firedDescs) {
    s.chekhov.fired.push({ id: nextId(s, "B", [...s.chekhov.bullets, ...s.chekhov.fired].map((x) => x.id)), desc: f, how: "fired before Story Ledger" });
  }
  return s.chekhov.bullets.length + s.chekhov.fired.length;
}
function fate(rows, s) {
  const f = s.fate;
  let n = 0;
  for (const row of rows) {
    for (const part of row.split(/\s·\s(?=<b>)/)) {
      const { name, rest } = rowFields(part);
      const key2 = name.toLowerCase();
      if (key2 === "state") {
        if (/THREAD/i.test(rest)) f.state = "THREAD";
        n++;
      } else if (key2 === "quiet") {
        const q = parseInt(rest, 10);
        if (Number.isFinite(q)) {
          f.q = q;
          n++;
        }
      } else if (key2 === "thread") {
        if (value(rest)) {
          f.pursuit = value(rest);
          n++;
        }
      } else if (key2 === "open") {
        const ts = parseInt(rest, 10);
        if (Number.isFinite(ts)) f.ts = ts;
      } else if (key2 === "deferred") {
        for (const m of value(rest).matchAll(/([^,(]+?)\s*\(\s*deferred\s*x\s*(\d+)\s*,\s*age\s*(\d+)\s*\)/gi)) {
          f.deferred.push({ id: nextId(s, "D", f.deferred.map((d) => d.id)), desc: m[1].trim(), times: Number(m[2]), age: Number(m[3]) });
          n++;
        }
      } else if (key2 === "world") {
        for (const m of value(rest).matchAll(/([^,(]+?)\s*\(\s*(ELSEWHERE|REGIONAL|LOCAL)\s*,\s*Reach\s*(\d)\s*,\s*age\s*(\d+)\s*\)/gi)) {
          f.world.push({ id: nextId(s, "W", f.world.map((w) => w.id)), desc: m[1].trim(), prox: m[2].toUpperCase(), reach: Number(m[3]), age: Number(m[4]) });
          n++;
        }
      } else if (key2 === "ambitions") {
        for (const m of value(rest).matchAll(/([^,(]+?)\s*\(\s*progress\s*(\d)\s*\/\s*5\s*\)/gi)) {
          f.ambitions.push({ desc: m[1].trim(), progress: Number(m[2]) });
          n++;
        }
      } else if (key2 === "residue") {
        for (const r of listOf(rest)) {
          f.residue.push(r);
          n++;
        }
      }
    }
  }
  if (f.state !== "THREAD") f.pursuit = "";
  return n;
}
function parseFf(mes, config = {}) {
  const s = emptyState();
  const imported = [], unread = [], rules = [];
  const turn = String(mes).match(/INTERNAL STATES\s*\(Turn:\s*(\d+)\)/i);
  if (turn) s.ct = Number(turn[1]);
  const now = headerNow(mes);
  if (now) {
    s.scene.now = now;
    if (nowResolved(now)) imported.push("scene");
    else unread.push(nowUnread(now));
  }
  const handlers = [
    [/NPC AGENDAS/, (sec) => agendas(rowsOf(sec.body), s), "agendas", true],
    [/NPC LOCATIONS/, (sec) => locations(rowsOf(sec.body), s), "locations", true],
    [/^FACTIONS$/, (sec) => factions(rowsOf(sec.body), s), "factions", true],
    [/^QUESTS$/, (sec) => quests(rowsOf(sec.body), s), "quests", true],
    [/^INV/, (sec) => inventory(rowsOf(sec.body), s), "inv", true],
    [/CHEKHOV/, (sec) => chekhov(sec.body, s), "chekhov"],
    [/FATE ROUTINE/, (sec) => fate(rowsOf(sec.body), s), "fate"],
    // bonds cannot become 12 axes by code: each awaits the model's NEW line, carrying what FF recorded
    [/BONDS|RELATIONSHIP/, (sec) => {
      s.rel.awaiting = bondsOf(rowsOf(sec.body), config.userName);
      return Object.keys(s.rel.awaiting).length;
    }, "rel"]
  ];
  for (const sec of summarySections(String(mes))) {
    if (PER_TURN.test(sec.key) || /NOTEBOOK/.test(sec.key)) continue;
    const h = handlers.find(([re]) => re.test(sec.key));
    if (!h) {
      unread.push(quoted(sec.title, sec.body));
      continue;
    }
    const n = h[1](sec);
    const rows = rowsOf(sec.body).filter((r) => value(r)).length;
    if (n > 0) {
      if (!imported.includes(h[2])) imported.push(h[2]);
      if (h[3] && rows > n) unread.push(`${sec.title} (${rows - n} row${rows - n > 1 ? "s" : ""} not read)`);
    } else if (rows) unread.push(quoted(sec.title, sec.body));
  }
  const nb = importFromLegacyNotebook([{ is_user: false, mes }]);
  if (nb.rules.length || nb.threads.length) {
    rules.push(...nb.rules);
    s.threads = nb.threads;
    imported.push("threads");
  }
  if (s.ct) imported.push("ct");
  return { state: s, imported, rules, unread };
}

// src/model/import/aa.js
var PER_TURN2 = /* @__PURE__ */ new Set(["WORLD", "CHECK", "THOUGHTS"]);
var TO_HANDOVER = /* @__PURE__ */ new Set(["SCENE", "OFFSCREEN"]);
function fieldsOf2(body) {
  const out = {};
  let key2 = null;
  for (const raw of String(body).split(/\r?\n/)) {
    const m = raw.match(/^\s*([A-Z][A-Z &]{1,20}):\s*(.*)$/);
    if (m) {
      key2 = m[1].trim();
      out[key2] = m[2].trim() ? [m[2].trim()] : [];
      continue;
    }
    if (key2 && raw.trim()) out[key2].push(raw.trim().replace(/^[-*•]\s*/, ""));
  }
  return out;
}
var dot = (line) => line.split(/\s+·\s+/).map((p) => p.trim());
function parseAa(mes, config = {}) {
  const isUser = (name) => sameName(name, config.userName || "");
  const s = emptyState();
  const imported = [], unread = [], rules = [];
  const body = (String(mes).match(/<ledger\b[^>]*>([\s\S]*?)(?:<\/ledger>|$)/i) || [])[1] || "";
  const f = fieldsOf2(body);
  const now = headerNow(mes);
  if (now) {
    s.scene.now = now;
    if (nowResolved(now)) imported.push("scene");
    else unread.push(nowUnread(now));
  }
  const clock2 = parseStoryTime(s.scene.now);
  const mark = (k) => {
    if (!imported.includes(k)) imported.push(k);
  };
  for (const [key2, lines2] of Object.entries(f)) {
    if (PER_TURN2.has(key2) || key2 === "NOTEBOOK") continue;
    if (TO_HANDOVER.has(key2)) {
      if (lines2.some((l) => value(l))) unread.push(quoted(key2, lines2.join("\n")));
      continue;
    }
    let n = 0;
    if (key2 === "BONDS") {
      s.rel.awaiting = bondsOf(lines2, config.userName);
      n = Object.keys(s.rel.awaiting).length;
      if (n) mark("rel");
    } else if (key2 === "TURN") {
      const t = parseInt(lines2[0], 10);
      if (Number.isFinite(t)) {
        s.ct = t;
        mark("ct");
        n++;
      }
    } else if (key2 === "LAST") {
      s.last = lines2.flatMap((l) => l.split(/\s+\/\s+/)).map(value).filter(Boolean);
      if (s.last.length) {
        mark("last");
        n++;
      }
    } else if (key2 === "AGENDAS") {
      for (const l of lines2) {
        const [name, task, step, place, where] = dot(l);
        const st = (step || "").match(/step\s+(\d+)\s*\/\s*(\d+)/i);
        if (!name || !task || !st) continue;
        s.agendas[plain(name)] = { task: value(task), step: Number(st[1]), max: Number(st[2]), aware: "", fibs: "", circle: "", body: "" };
        if (value(place)) s.locations[plain(name)] = value(place);
        n++;
      }
      if (n) {
        mark("agendas");
        if (Object.keys(s.locations).length) mark("locations");
      }
    } else if (key2 === "GUN") {
      for (const l of lines2) {
        const parts = dot(l);
        const desc = value(parts[0]);
        const w = l.match(/weight\s*:?\s*(\d)/i), age = l.match(/age\s*:?\s*(\d+)/i);
        if (!desc || !w) continue;
        const b = {
          id: "",
          desc,
          weight: Math.min(3, Math.max(1, Number(w[1]))),
          age: age ? Number(age[1]) : 0,
          hot: /\[hot\]/i.test(l),
          secret: /\[secret\]/i.test(l),
          lock: "",
          at: null,
          after: ""
        };
        const lock = l.match(/\[LOCKED:\s*([^\]]+)\]/i) || l.match(/\[(TIME|CHAR|PLACE|DEP)[^\]]*\]/i);
        if (lock) {
          b.at = lock[1] && /\d{1,2}:\d{2}|\d\s*[ap]m/i.test(lock[1]) ? lockTime(lock[1], clock2) : null;
          if (!b.at) b.lock = plain(lock[0]).replace(/^\[|\]$/g, "");
        }
        b.id = nextId(s, "B", s.chekhov.bullets.map((x) => x.id));
        s.chekhov.bullets.push(b);
        n++;
      }
      if (n) mark("chekhov");
    } else if (key2 === "FIRED") {
      for (const d of lines2.map(value).filter(Boolean)) {
        s.chekhov.fired.push({ id: nextId(s, "B", [...s.chekhov.bullets, ...s.chekhov.fired].map((x) => x.id)), desc: d, how: "fired before Story Ledger" });
        n++;
      }
      if (n) mark("chekhov");
    } else if (key2 === "GEAR") {
      for (const part of lines2.flatMap((l) => plain(l).split(/\s+\|\s+/))) {
        const who = part.match(/^(.+?)\s+[—–]\s+(.*)$/);
        if (!who) {
          s.inv.items.push(...listOf(part));
          continue;
        }
        const [items, titles, status] = dot(who[2]);
        if (isUser(who[1])) {
          s.inv.items.push(...listOf(items));
          s.inv.titles.push(...listOf(titles));
          s.inv.status.push(...listOf(status));
        } else if (value(items)) {
          s.cast[who[1].trim()] = { position: "", wearing: "", holding: value(items), condition: value(dot(who[2])[1]) };
          mark("cast");
        }
      }
      if (s.inv.items.length || s.inv.titles.length || s.inv.status.length) {
        mark("inv");
        n++;
      }
    } else if (key2 === "QUESTS") {
      const statusOf = (t) => /^(done|completed|complete|finished)$/i.test(t) ? "done" : /^(dropped|failed|abandoned)$/i.test(t) ? "dropped" : "";
      for (const part of lines2.flatMap((l) => plain(l).split(/\s+\|\s+/))) {
        const m = part.match(/^(?:(Main|Side)\s*[—–:-]\s*)?(.+)$/i);
        if (!m || !value(m[2])) continue;
        const bits = dot(m[2]);
        let status = "", progress = "";
        const rest = bits.slice(1).filter((b) => {
          const p = b.match(/^progress\s*:?\s*(\d+\s*\/\s*\d+)$/i);
          if (p) {
            progress = p[1].replace(/\s+/g, "");
            return false;
          }
          if (statusOf(b) || /^active$/i.test(b)) {
            status = statusOf(b) || "active";
            return false;
          }
          return true;
        });
        let objective = [bits[0], ...rest].map(value).filter(Boolean).join(" · ");
        const tail = objective.match(/\s*\((done|completed|dropped|failed)\)\s*$/i);
        if (tail) {
          status = status || statusOf(tail[1]);
          objective = objective.slice(0, tail.index).trim();
        }
        if (!objective) continue;
        const kind = m[1] ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : "Side";
        s.quests.push({ id: nextId(s, "Q", s.quests.map((q) => q.id)), kind, status: status || "active", objective, progress, reward: "", send: false });
        n++;
      }
      if (n) mark("quests");
    } else if (key2 === "FACTIONS") {
      for (const l of lines2) {
        const text = plain(l);
        const parts = dot(text);
        if (parts.length >= 2) {
          const [name, goal, intel, fibs, state, relations] = parts;
          s.factions[name] = { goal: value(goal), intel: value(intel), fibs: value(fibs), state: value(state), conflict: "", relations: value(relations) };
          n++;
          continue;
        }
        const m = text.match(/^(.+?)\s*[—–:]\s*(.+)$/);
        if (!m) continue;
        s.factions[m[1].trim()] = { goal: m[2].trim(), intel: "", fibs: "", state: "", conflict: "", relations: "" };
        n++;
      }
      if (n) mark("factions");
    }
    if (!n && lines2.some((l) => value(l))) unread.push(quoted(key2, lines2.join("\n")));
  }
  const nb = importFromLegacyNotebook([{ is_user: false, mes }]);
  if (nb.rules.length || nb.threads.length) {
    rules.push(...nb.rules);
    s.threads = nb.threads;
    mark("threads");
  }
  return { state: s, imported, rules, unread };
}

// src/model/import/sola.js
var tag = (mes, name) => (String(mes).match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i")) || [])[1] || "";
var field = (body, key2) => {
  const m = String(body).match(new RegExp(`^\\s*${key2}\\s*:\\s*(.*)$`, "im"));
  return m ? value(m[1]) : "";
};
function people(body) {
  const out = {};
  let who = null;
  for (const raw of String(body).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const head = line.match(/^([^:]{1,40}):\s*$/);
    if (head) {
      who = head[1].trim();
      out[who] = {};
      continue;
    }
    const kv = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (who && kv) out[who][kv[1].toLowerCase()] = kv[2];
  }
  return out;
}
var blankCast = () => ({ position: "", wearing: "", holding: "", condition: "" });
function parseSola(mes, config = {}) {
  const s = emptyState();
  const imported = [], unread = [], rules = [];
  const mark = (k) => {
    if (!imported.includes(k)) imported.push(k);
  };
  const isUser = (name) => sameName(name, config.userName || "");
  const notes = tag(mes, "story_notes");
  const nb = importFromLegacyNotebook([{ is_user: false, mes }]);
  if (nb.rules.length || nb.threads.length) {
    rules.push(...nb.rules);
    s.threads = nb.threads;
    mark("threads");
  }
  for (const seed of listOf(field(notes, "Seeds"))) {
    s.chekhov.bullets.push({ id: nextId(s, "B", s.chekhov.bullets.map((b) => b.id)), desc: seed, weight: 1, age: 0, hot: false, secret: false, lock: "", at: null, after: "" });
    mark("chekhov");
  }
  for (const k of ["Motives", "Horizon"]) if (field(notes, k)) unread.push(`${k} (story notes)`);
  const date = tag(mes, "date"), cast = tag(mes, "scene_cast");
  const day = field(date, "Day"), time = field(date, "Time"), place = field(cast, "Location");
  const when = [day && (/^day\b/i.test(day) ? day : `Day ${day}`), time].filter(Boolean).join(" — ");
  if (when || place) {
    s.scene.now = [when, place].filter(Boolean).join(" | ");
    if (nowResolved(s.scene.now)) mark("scene");
    else unread.push(nowUnread(s.scene.now));
  }
  const present = [...listOf(field(cast, "Active Speakers")), ...listOf(field(cast, "Ambient NPCs"))].filter((n) => !isUser(n));
  if (present.length) {
    s.scene.present = [...new Set(present)];
    mark("scene");
  }
  for (const [who, f] of Object.entries(people(tag(mes, "wardrobe")))) {
    if (isUser(who)) continue;
    s.cast[who] = { ...s.cast[who] || blankCast(), wearing: value(f.layers), condition: value(f.condition) };
    mark("cast");
  }
  const inventory2 = Object.entries(people(tag(mes, "inventory")));
  if (inventory2.length && !inventory2.some(([who]) => isUser(who))) unread.push("Inventory — {{user}}'s entry was not recognised; restate {{user}}'s carried items");
  for (const [who, f] of inventory2) {
    if (isUser(who)) {
      s.inv.items = [...listOf(f.carried), ...listOf(f.concealed)];
      if (s.inv.items.length) mark("inv");
    } else {
      s.cast[who] = { ...s.cast[who] || blankCast(), holding: value(f["in-hand"]) };
      mark("cast");
    }
  }
  return { state: s, imported, rules, unread };
}

// src/model/import/index.js
var FF = /<internal_states>|<!--\s*GFX_START\s*-->/i;
var SOURCES = [
  ["ff", (mes) => FF.test(mes), parseFf],
  ["aa", (mes) => /<ledger\b/i.test(mes), parseAa],
  ["sola", (mes) => /<sola_hud\b|<story_notes>|<scene_cast>|<wardrobe>|<inventory>/i.test(mes), parseSola]
];
function importForeign(chat, config) {
  const msgs = chat || [];
  const ours = (m) => m && (String(m.mes || "").includes(BLOCK_MARK) || !m.is_user && notebookBody(m.mes) !== null);
  if (msgs.some(ours)) return { source: null, index: -1, state: null, imported: [], rules: [], unread: [] };
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (!m || m.is_user || m.is_system) continue;
    const mes = String(m.mes || "");
    const hit = SOURCES.find(([, test]) => test(mes));
    if (hit) return { source: hit[0], index: i, ...hit[2](mes, config) };
  }
  return { source: null, index: -1, state: null, imported: [], rules: [], unread: [] };
}

// src/model/turn.js
var clone3 = (o) => JSON.parse(JSON.stringify(o));
var under = (lists, heading) => {
  const k = Object.keys(lists || {}).find((h) => h.toLowerCase() === heading.toLowerCase());
  return k ? lists[k] : [];
};
var linesUnder = (changes, heading) => under(changes && changes.sections, heading);
var rawLinesUnder = (changes, heading) => changes && changes.raw ? under(changes.raw, heading) : linesUnder(changes, heading);
function sectionContext(state, prevPresent, config, prevNow = "", changes = null) {
  return {
    config,
    userName: config.userName,
    present: state.scene.present,
    prevPresent: prevPresent || [],
    prevNow,
    touched: /* @__PURE__ */ new Set(),
    warnings: [],
    turn: {},
    linesUnder: (heading) => linesUnder(changes, heading),
    // Comments preserve source order across headings; legacy/tagged inputs keep their grouped reading.
    linesAcross: (headings) => changes?.orderedSections ? changes.orderedSections.filter((record) => headings.includes(record.section)) : headings.flatMap((section2) => linesUnder(changes, section2).map((line) => ({ section: section2, line }))),
    rawLinesUnder: (heading) => rawLinesUnder(changes, heading),
    normalizedChanges: Boolean(changes && changes.raw),
    sections: config.sections || {},
    checkStyle: config.checkStyle || "dnd",
    rolls: Array.isArray(config.dice?.checks) ? config.dice.checks : config.rolls,
    fudgedDice: config.fudgedDice || []
  };
}
function preTurnFacts(state, config) {
  const on = enabledSections(config.sections);
  const ctx = sectionContext(state, state.scene.present, config);
  for (const sec of on) if (sec.decide) ctx.turn[sec.key] = sec.decide(state, ctx);
  return on.flatMap((sec) => sec.facts ? sec.facts(state, ctx) : []);
}
function latestState(chat, beforeIndex, config) {
  for (let i = Math.min(beforeIndex, (chat || []).length) - 1; i >= 0; i--) {
    const mes = chat[i] && chat[i].mes;
    if (!mes || !mes.includes(BLOCK_MARK)) continue;
    const first = parseBlock(mes, { config });
    if (!first) continue;
    const want = [
      ...CORE_KEYS.filter((k) => (config.sections || {})[k] !== false),
      ...enabledSections(config.sections).filter((sec) => sec.carried).map((sec) => sec.key)
    ];
    if (!first.errors.length && !first.recoverInventoryIds && want.every((k) => first.sections.includes(k))) return { state: first.state, index: i, errors: [] };
    const older = latestState(chat, i, config);
    if (!older) return { state: first.state, index: i, errors: first.errors };
    const again = parseBlock(mes, { prev: older.state, config });
    return { state: again.state, index: i, errors: first.errors };
  }
  return null;
}
function importFfTurn(chat) {
  for (let i = (chat || []).length - 1; i >= 0; i--) {
    const m = chat[i];
    if (!m || m.is_user) continue;
    const hit = String(m.mes || "").match(/INTERNAL STATES\s*\(Turn:\s*(\d+)\)/i);
    if (hit) return Number(hit[1]);
  }
  return null;
}
function replayLegacy(chat, config, { ctOffset = null, corrections = [] }) {
  const msgs = chat || [];
  const first = msgs.findIndex((m) => m && !m.is_user && !m.is_system && notebookBody(m.mes) !== null);
  if (first < 0) return null;
  const turns = [], indexes = [];
  let newest = null, threads = null;
  for (let i = first; i < msgs.length; i++) {
    const m = msgs[i];
    if (!m || m.is_user || m.is_system) continue;
    const ch = parseChanges(m.mes);
    if (ch) newest = ch;
    const nb = ch && parseNotebookBlock(m.mes);
    if (nb && nb.threads.length) threads = nb.threads;
    const present = new Set(ch && ch.present ? ch.present : []);
    if (config.userName) present.add(config.userName);
    turns.push({ events: ch ? ch.relations : null, present: [...present] });
    indexes.push(i);
  }
  const at = (c) => indexes.filter((i) => i < c.atLength).length;
  const offset = ctOffset ?? importFfTurn(msgs.slice(0, first)) ?? 0;
  const { state } = replayRelations(turns, (corrections || []).map(({ atLength, ...rest }) => ({ at: at({ atLength }), ...rest })), config, offset);
  return { state, newest, threads };
}
function initialState(chat, config, legacy = {}) {
  const s = emptyState();
  s.ct = importFfTurn(chat) ?? 0;
  s.threads = importFromLegacyNotebook(chat).threads;
  const imp = importForeign(chat, config);
  if (imp.source) {
    for (const k of imp.imported) {
      if (k === "ct") s.ct = imp.state.ct;
      else if (k === "scene") s.scene = { ...s.scene, ...imp.state.scene };
      else if (k === "rel") s.rel = { ...s.rel, awaiting: { ...imp.state.rel.awaiting } };
      else s[k] = imp.state[k];
    }
    s.ids = { ...s.ids || {}, ...imp.state.ids || {} };
  }
  const old = replayLegacy(chat, config, legacy);
  if (old) {
    s.ct = old.state.ct;
    s.rel = { pairs: old.state.pairs, selves: old.state.selves, awaiting: old.state.awaiting || {}, ...old.state.pending?.length ? { pending: old.state.pending } : {} };
    if (old.newest && old.newest.now !== null) s.scene.now = old.newest.now;
    if (old.newest && old.newest.present !== null) s.scene.present = old.newest.present;
    if (old.threads) s.threads = old.threads;
  }
  return s;
}
function stripBlocks(mes) {
  let text = String(mes || "");
  let at;
  while (at = findBlock(text)) text = text.slice(0, at.start) + text.slice(at.end);
  return text;
}
function withClockOverride(state, override, blockIndex) {
  if (!override || !override.text || !(override.atLength > blockIndex)) return state;
  const s = clone3(state);
  s.scene.now = override.text;
  return s;
}

// src/model/prompt.js
var COMMENT_RE = new RegExp(LEDGER_BLOCK_RE.source, "gi");
var relForm = (id) => RELATION_COMMANDS.find((c) => c.id === id).form;
var RELATIONSHIP_RULES = `<relationship_rules>
Every relationship line is how one character feels toward another — directional; {{user}}'s own feelings are the reader's and are never tracked. Twelve axes, 1–20, in opposed pairs: Eros/Misos (romantic), Ludus/Eris (playful), Philia/Echthros (friendship), Pragma/Stasis (practical), Storge/Adiaphora (familial), Agape/Phthonos (selfless / resentful giving). Φ is a character's own self-regard (−20…20): low Φ makes fondness hard to receive.
Fondness and friction coexist and tick independently; one interaction can tick both. You only report raw material — the ledger converts accumulators into axis changes on its own schedule. Write in the Relationships section:
- Ticks: \`${relForm("rel.tick")}\` — +1 or +2 per accumulator, only for what happened in this reply. Friction map: romance hurt → M, cruelty → Er, broken trust → Ec, practical frustration → St, neglect → Ad, resentment → Pt.
- Self-regard: \`${relForm("rel.phi")}\` or a negative value.
- \`${relForm("rel.direct")}\` — only for a genuinely significant moment; it is what breaks a stalemate.
- \`${relForm("rel.new")}\` — the first time a relationship matters: every axis at least 3, values varied, friction outweighing fondness unless the card says otherwise. Its (why) is the relationship's description on the reader's card, so make it a short, specific line about the two of them.
- \`${relForm("rel.note")}\` — rewrite that description, only when the relationship has genuinely changed.
Never state the numbers in prose; show them through behavior. Romantic or sexual initiation happens only where the ledger says romance is allowed; forcing it elsewhere meets discomfort or anger. "Reads as" patterns are interpretation, not rules.
</relationship_rules>`;
var NOTEBOOK_RULES = [
  "Threads: open one for an intention, open question, promise, debt, appointment (with day and time) or unresolved arc; resolve it written as it appears in the list. Every Threads line starts with `+` (opened) or `-` (resolved) before its [T] tag — never a bare [T] line, even to restate a thread that is still open; omit Threads when none opened or resolved.",
  'Proposed rules: ONLY when the story establishes a fact that must never drift, or the reader gives a lasting out-of-character instruction. Omit the section on every other turn — never write "none" under it; never restate an existing rule.'
].join("\n");
var CORE_COMMANDS = [
  {
    id: "core.now",
    form: "Now: [story time after this reply, free text — e.g. Day 12 — Tuesday, March 4, 21:44 | the lawn. Day N counts from the story's first day and never resets.]",
    example: "Now: Day 12 — Tuesday, March 4, 21:44 | the lawn",
    keywords: ["Now"],
    freeText: true
  },
  { id: "core.present", form: "Present: [every named character in the scene, comma separated]", example: "Present: Mara, Jan", keywords: ["Present"] },
  { id: "core.public", form: "Public: [yes when the scene is in a public or exposed place, else no]", example: "Public: no", keywords: ["Public"] }
];
var coreLine = (id) => CORE_COMMANDS.find((c) => c.id === id).form;
var TEMPLATE_HEAD = `At the very end of your reply, after the prose, write exactly one ledger comment as below. Report only what changed in this reply — the ledger keeps everything else and writes the full state block itself; never write a state block, <internal_states> or GFX markers yourself. Replace placeholders with actual names, IDs and values. Use one command per line and keep its command syntax; write completed commands without enclosing square brackets, keeping literal [T] tags. Omit any section where nothing changed. The reader never sees the comment; never write "-->" inside it.`;
function buildTemplate(config = {}) {
  const on = (k) => (config.sections || {})[k] !== false;
  const ctx = { config, checkStyle: config.checkStyle || "dnd", sections: config.sections || {} };
  const lines2 = ["<!-- Story_Ledger"];
  if (on("scene")) lines2.push(coreLine("core.now"), coreLine("core.present"), coreLine("core.public"));
  else if (needsPresent(config.sections)) lines2.push(coreLine("core.present"));
  if (on("notebook")) lines2.push(...commandTemplate("Threads", THREAD_COMMANDS, ctx));
  if (on("relationships")) lines2.push(...commandTemplate("Relationships", RELATION_COMMANDS, ctx));
  for (const sec of enabledSections(config.sections)) lines2.push(...sec.template(ctx));
  if (on("notebook")) lines2.push(...commandTemplate("Proposed rules", PROPOSAL_COMMANDS, ctx));
  lines2.push("-->");
  return `${TEMPLATE_HEAD}
${lines2.join("\n")}`;
}
var LEDGER_TEMPLATE = buildTemplate({ sections: {} });
function renderTurnFacts(state, config = {}) {
  const facts = preTurnFacts(state, config);
  const awaiting = (config.sections || {}).relationships !== false ? Object.entries(state.rel.awaiting || {}) : [];
  if (awaiting.length) {
    const list = awaiting.map(([k, note]) => `${k.replace("→", " → ")}${note ? ` (the previous preset recorded: ${note})` : ""}`);
    facts.push(`These relationships have no NEW line yet: ${list.join("; ")}. Write a complete NEW line for each in this reply, calibrated from that record and the story before the queued interactions — a high BOND or affection means fondness on the axes that fit, Grudge or hostility means friction. Their changes are saved and will apply automatically once NEW exists; do not report those saved changes again.`);
    for (const p of state.rel.pending || []) {
      const change = p.kind === "tick" ? `${p.acc}_acc +${p.amount}` : p.kind === "direct" ? `DIRECT ${p.axis} +${p.amount}` : `NOTE ${p.text}`;
      facts.push(`Saved turn ${p.ct}: ${p.from} → ${p.to}: ${change}${p.reason ? ` (${p.reason})` : ""}.`);
    }
  }
  if (!facts.length) return "";
  const head = [`Turn ${state.ct + 1}`, state.scene.now, state.scene.present.length ? `present: ${state.scene.present.join(", ")}` : ""].filter(Boolean).join(" · ");
  return `<story_ledger_turn>
${head}
${facts.join("\n")}
</story_ledger_turn>`;
}
var HANDOVER_ASKS = [
  ["threads", "Threads: one `+ [T]` line for every open thread or [T] entry it holds."],
  ["agendas", "Agendas: a `new` line for every agenda it held, with its current step."],
  ["locations", "Locations: a `Name @ place` line for everyone it placed."],
  ["factions", "Factions: field lines for every faction it held."],
  ["quests", "Quests: a `+ Main:` or `+ Side:` line for every quest it held."],
  ["inv", "Inventory: a `+ item` line for every item {{user}} carried, plus `title: Name | effects` and `status + Condition` lines."],
  ["cast", "Cast: field lines for everyone present — position, wearing, holding, condition."],
  ["chekhov", "Chekhov: a `load:` line for every planted setup it held (weight, hot, time lock)."],
  ["fate", "Fate/World: an open pursuit, deferred items and world happenings it held."]
];
function buildHandover(imported = [], { hasNow = false, sections = {}, unread = [] } = {}) {
  const have = new Set(imported);
  const on = (k) => (sections || {})[k] !== false;
  const lines2 = [
    "<ledger_handover>",
    "This chat ran under another preset until now. The story continues exactly where it stands; only the bookkeeping changes. The ledger has already read what it could from the newest state block in the history (a Freaky/Realistic Frankenstein <internal_states>, Megumin's <Blocks>, Sola's trackers, or Ancient Access's <ledger>). In this reply's Story_Ledger comment, add only what is still missing:"
  ];
  if (!hasNow && on("scene")) lines2.push("- Now: from that state's time, date and place. Keep its Day number and continue counting from it.");
  if (on("relationships")) lines2.push("- Relationships: the NEW lines <story_ledger_turn> lists, with what the previous preset recorded for each, plus one NEW line for any other relationship that state tracked, calibrated from the story so far. High BOND means fondness on the axes that fit this relationship; Grudge and hostility mean friction.");
  for (const [key2, ask] of HANDOVER_ASKS) if (on(key2 === "threads" ? "notebook" : key2) && !have.has(key2)) lines2.push(`- ${ask}`);
  if (on("notebook")) lines2.push("- Proposed rules: if the reader's notebook below does not already hold that state's [R] rules, propose each as add:.");
  if ((unread || []).length) lines2.push(`- These parts of that block could not be read — carry them over with the change lines that fit: ${unread.join("; ")}.`);
  lines2.push("Stop writing the old preset's state block from this reply on.", "</ledger_handover>");
  return lines2.join("\n");
}
var HANDOVER = buildHandover([], { hasNow: false });

// src/model/dice.js
function defaultRng() {
  const a = new Uint32Array(1);
  globalThis.crypto.getRandomValues(a);
  return a[0] / 2 ** 32;
}
var rollD20s = (n, rng = defaultRng) => Array.from({ length: n }, () => 1 + Math.floor(rng() * 20));
function rollTurnDice(rng = defaultRng) {
  const rolls = rollD20s(7, rng);
  return { fate: { a: rolls[0], b: rolls[1], c: rolls[2] }, world: rolls[3], checks: rolls.slice(4) };
}
var isD20 = (value2) => Number.isInteger(Number(value2)) && Number(value2) >= 1 && Number(value2) <= 20;
function withFudges(dice, fudges) {
  const result = { ...dice || {} };
  if (dice?.fate) result.fate = { ...dice.fate };
  if (Array.isArray(dice?.checks)) result.checks = [...dice.checks];
  const locks = fudges?.dice || {};
  const applied = [];
  for (const key2 of ["fate.a", "fate.b", "fate.c"]) {
    if (isD20(locks[key2])) {
      result.fate = { ...result.fate || {} };
      result.fate[key2.at(-1)] = Number(locks[key2]);
      applied.push(key2);
    }
  }
  if (isD20(locks.world)) {
    result.world = Number(locks.world);
    applied.push("world");
  }
  if (Array.isArray(locks.checks) && locks.checks.length === 3 && locks.checks.every(isD20)) {
    result.checks = locks.checks.map(Number);
    applied.push("checks");
  }
  return { dice: result, fudged: applied };
}

// src/model/fixup.js
function validThoughts(lines2) {
  return (lines2 || []).filter((l) => parseThoughtLine(l)).map((l) => String(l).trim());
}
function needsFixup(mes, sections = {}) {
  const text = stripBlocks(mes);
  const changes = parseChanges(text);
  if (changes === null) return "missing";
  if (lastLedgerBlock(text).kind === "tag") return null;
  return sections.thoughts !== false && !validThoughts(changes.sections.Thoughts).length ? "thoughts" : null;
}

// src/host/core.js
var DEFAULT_SECTIONS = { scene: true, relationships: true, notebook: true, ...Object.fromEntries(SECTIONS.map((sec) => [sec.key, true])) };
var DEFAULT_SETTINGS = { enabled: true, stickyNotices: true, fixupMode: "full", fixupHistory: 4, depth: 1, role: 0, placement: "auto", theme: "frankenstein", checkStyle: "dnd", config: {} };
function normalizeSettings(raw) {
  const s = { ...DEFAULT_SETTINGS, config: {}, ...raw || {} };
  if (!s.sections) {
    s.sections = {
      scene: s.clock !== false,
      relationships: s.relations !== false,
      notebook: s.notebook !== false
    };
    delete s.clock;
    delete s.relations;
    delete s.notebook;
  }
  s.sections = { ...DEFAULT_SECTIONS, ...s.sections };
  return s;
}
function normalizeChatData(meta) {
  if (!meta.storyLedger) {
    const legacy = meta.meguminNotebook;
    meta.storyLedger = { notebook: legacy ? { ...emptyNotebook(), ...legacy } : emptyNotebook() };
  }
  const d = meta.storyLedger;
  d.notebook = { ...emptyNotebook(), ...d.notebook || {} };
  if (d.fudges === void 0) d.fudges = null;
  return d;
}
var engineConfig = (settings, userName, extra = {}) => ({
  ...resolveConfig(settings.config),
  userName,
  sections: settings.sections,
  checkStyle: settings.checkStyle,
  ...extra
});
function startOf(chat, index, config, chatData) {
  const d = chatData;
  const found = latestState(chat, index, config);
  if (found) return { state: withClockOverride(found.state, d.notebook.clockOverride, found.index), errors: found.errors };
  const s = initialState(chat.slice(0, index), config, { ctOffset: d.ctOffset ?? null, corrections: d.corrections || [] });
  if (!s.threads.length && d.notebook.threads.length) s.threads = [...d.notebook.threads];
  return { state: withClockOverride(s, d.notebook.clockOverride, -1), errors: [] };
}
var stateBefore = (chat, index, config, chatData) => startOf(chat, index, config, chatData).state;
function fixupCaseFor({ chat, index, settings, busy }) {
  const msg = chat[index];
  if (busy || !settings.enabled || !msg || index !== chat.length - 1 || msg.is_user || msg.is_system) return null;
  return needsFixup(msg.mes, settings.sections);
}
var esc2 = (s) => String(s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
var hasOwn = (value2, key2) => Object.prototype.hasOwnProperty.call(value2 || {}, key2);
function fudgeSummary(fudge) {
  const parts = [];
  if (fudge.dice) parts.push(...Object.keys(fudge.dice));
  if (fudge.calm) parts.push("calm");
  if (fudge.tier) parts.push(fudge.tier);
  if (fudge.source) parts.push(fudge.source);
  if (fudge.fire) parts.push(`fire ${fudge.fire}`);
  return parts.length ? parts.join(", ") : "none";
}
var hasFudgeSettings = (fudge) => Object.keys(fudge || {}).some((key2) => key2 !== "appliedTo");
function pairCard(state, from, to, config) {
  const rel = { ct: state.ct, pairs: state.rel.pairs, selves: state.rel.selves };
  const d = describePair(rel, from, to, config);
  const rows = config.axes.filter((a) => a.kind === "fond").map((f) => {
    const m = config.axes.find((a) => a.key === f.mirror);
    const fv = d.axes[f.key], mv = d.axes[m.key];
    const val = (v) => `<b>${v.value}</b>${v.acc ? `<small> +${v.acc}</small>` : ""}`;
    return `<div class="sl-row">
            <span class="sl-lab sl-fond" title="${esc2(f.meaning)}">${esc2(f.name)} ${val(fv)}</span>
            <span class="sl-bar sl-bar-fond"><i style="width:${fv.value / config.axisMax * 100}%"></i></span>
            <span class="sl-bar sl-bar-friction"><i style="width:${mv.value / config.axisMax * 100}%"></i></span>
            <span class="sl-lab sl-friction" title="${esc2(m.meaning)}">${val(mv)} ${esc2(m.name)}</span>
        </div>`;
  }).join("");
  const chips = [
    `<span class="sl-chip">Φ(${esc2(from)}) ${d.phi}</span>`,
    `<span class="sl-chip ${d.romance === "allowed" ? "sl-ok" : "sl-locked"}">romance ${d.romance}</span>`,
    ...d.walls.map((w) => `<span class="sl-chip sl-wall">WALL ${esc2(w)}</span>`),
    ...d.patterns.map((p) => `<span class="sl-chip sl-pattern" title="${esc2(PATTERN_GLOSS[p])}">${esc2(p)}</span>`)
  ].join("");
  return `<div class="sl-pair"><div class="sl-pair-head"><b>${esc2(from)} → ${esc2(to)}</b></div>
        <div class="sl-chips">${chips}</div>
        <div class="sl-mirror-head"><span>fondness</span><span>friction</span></div>${rows}</div>`;
}
function popupHtml(tab, view, previewBaseDice = null) {
  const { chat: c, settings: s, chatData, userName } = view;
  const config = engineConfig(s, userName);
  const nb = chatData.notebook;
  const state = stateBefore(c, c.length, config, chatData);
  const lines2 = (text) => String(text || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const T = (id, label) => `<button class="sl-tab${tab === id ? " sl-on" : ""}" data-sl-popup-tab="${id}">${label}</button>`;
  let body = "";
  if (tab === "rules") {
    const inbox = nb.inbox.map((i) => `<div class="sl-item${i.stale ? " sl-stale" : ""}">
            <div>${i.op === "add" ? `<b>Add</b> ${esc2(i.text)}` : i.op === "edit" ? `<b>Edit</b> “${esc2(i.targetText)}”<br>→ ${esc2(i.text)}` : `<b>Remove</b> “${esc2(i.targetText)}”${i.text ? `<br><i>${esc2(i.text)}</i>` : ""}`}${i.stale ? "<br><small>The rule this pointed at no longer exists.</small>" : ""}</div>
            <div class="sl-btns">${i.stale ? "" : `<button class="menu_button sl-approve" data-id="${i.id}">Approve</button>`}<button class="menu_button sl-reject" data-id="${i.id}">${i.stale ? "Dismiss" : "Reject"}</button></div>
        </div>`).join("") || "<p><i>No proposals waiting.</i></p>";
    body = `<label class="checkbox_label"><input type="checkbox" id="sl-nb-enabled" ${nb.enabled === false ? "" : "checked"}> Use the notebook in this chat</label>
            <h4>Rules [R] <small>— one per line, sent verbatim every turn. Only you change these.</small></h4>
            <textarea id="sl-rules" class="text_pole" rows="12">${esc2(nb.rules.join("\n"))}</textarea>
            <div class="sl-btns"><button class="menu_button" id="sl-save-rules">Save rules</button>
                <button class="menu_button" id="sl-import" title="Fill the boxes from the newest Freaky/Realistic Frankenstein, Sola, Ancient Access or Megumin-fork notebook in this chat. Rules are not saved until you press Save.">Import from previous preset</button></div>
            <h4>Proposals from the model</h4>${inbox}`;
  } else if (tab === "threads") {
    body = `<h4>Open threads [T] <small>— kept in the newest reply's block; edit them there</small></h4>
            <ul class="sl-list">${state.threads.map((t) => `<li>${esc2(t)}</li>`).join("") || "<li><i>None yet.</i></li>"}</ul>
            <h4>Starting list <small>— used only until the first reply carries a block</small></h4>
            <textarea id="sl-threads" class="text_pole" rows="6">${esc2(nb.threads.join("\n"))}</textarea>
            <div class="sl-btns"><button class="menu_button" id="sl-save-threads">Save as starting list</button></div>`;
  } else if (tab === "clock") {
    const time = storyTime(c, nb);
    const now = time.now && time.now.source === "reader" ? time.now : state.scene.now ? { text: state.scene.now, source: "notebook" } : time.now;
    const label = { notebook: "from the newest block", world_state: "from World State", ff_header: "from an old header", reader: "your correction — used until the next reply states a time" };
    body = `<h4>🕰️ Story clock</h4>
            <div>${now ? `<b>${esc2(now.text)}</b> <small>(${label[now.source] || now.source})</small>` : "<i>No time stated yet.</i>"}</div>
            ${time.timeline.length > 1 ? `<div class="sl-timeline">${time.timeline.map(esc2).join(" → ")}</div>` : ""}
            <div class="sl-btns"><input type="text" id="sl-clock" class="text_pole" placeholder="Correct the time, e.g. Day 12 — Tuesday, 21:44 | the lawn" value="${esc2(nb.clockOverride ? nb.clockOverride.text : "")}">
                <button class="menu_button" id="sl-clock-set">Set correction</button>${nb.clockOverride ? `<button class="menu_button" id="sl-clock-clear">Clear</button>` : ""}</div>`;
  } else if (tab === "dice") {
    const dice = previewBaseDice || rollTurnDice();
    const fudge = chatData.fudges || {};
    const locks = fudge.dice || {};
    const die = (key2, label, value2, locked) => `<label class="sl-die"><span>${label}</span>
            <input type="number" class="text_pole sl-num" data-fudge-value="${key2}" min="1" max="20" step="1" value="${esc2(value2)}">
            <input type="checkbox" data-fudge-lock="${key2}" ${locked ? "checked" : ""}> lock</label>`;
    const checksLocked = Array.isArray(locks.checks) && locks.checks.length === 3;
    const checksValues = checksLocked ? locks.checks : dice.checks;
    const bulletOptions = (state.chekhov?.bullets || []).map((b) => `<option value="${esc2(b.id)}" ${fudge.fire === b.id ? "selected" : ""}>${esc2(b.id)} — ${esc2(b.desc)}</option>`).join("");
    const oldFire = fudge.fire && fudge.fire !== "none" && !(state.chekhov?.bullets || []).some((b) => b.id === fudge.fire) ? `<option value="${esc2(fudge.fire)}" selected>${esc2(fudge.fire)} (not active)</option>` : "";
    const initialApplied = withFudges(dice, fudge);
    const initialFacts = renderTurnFacts(state, engineConfig(s, userName, { dice: initialApplied.dice, fudges: fudge, fudgedDice: initialApplied.fudged, rolls: initialApplied.dice.checks }));
    body = `<p class="sl-meta">Lock dice or outcomes for the next reply. Swipes and continues of that reply keep these controls.</p>
            <h4>Turn dice <small>— unlocked dice roll again when generation starts</small></h4>
            <div class="sl-dice-grid">
                ${die("fate.a", "Fate A", hasOwn(locks, "fate.a") ? locks["fate.a"] : dice.fate.a, hasOwn(locks, "fate.a"))}
                ${die("fate.b", "Fate B", hasOwn(locks, "fate.b") ? locks["fate.b"] : dice.fate.b, hasOwn(locks, "fate.b"))}
                ${die("fate.c", "Fate C", hasOwn(locks, "fate.c") ? locks["fate.c"] : dice.fate.c, hasOwn(locks, "fate.c"))}
                ${die("world", "World", hasOwn(locks, "world") ? locks.world : dice.world, hasOwn(locks, "world"))}
                <label class="sl-die sl-check-dice"><span>Checks</span>${checksValues.map((value2, i) => `<input type="number" class="text_pole sl-num" data-fudge-check="${i}" min="1" max="20" step="1" value="${esc2(value2)}">`).join("")}
                    <input type="checkbox" data-fudge-lock="checks" ${checksLocked ? "checked" : ""}> lock all 3</label>
            </div>
            <h4>Outcome controls</h4>
            <div class="sl-dice-grid">
                <label>Tier <select class="text_pole" id="sl-fudge-tier"><option value="">Auto</option>${["AMBIENT", "MINOR", "MAJOR"].map((x) => `<option value="${x}" ${fudge.tier === x ? "selected" : ""}>${x}</option>`).join("")}</select></label>
                <label>Source <select class="text_pole" id="sl-fudge-source"><option value="">Auto</option>${["TRUE", "WEIGHTED"].map((x) => `<option value="${x}" ${fudge.source === x ? "selected" : ""}>${x}</option>`).join("")}</select></label>
                <label class="checkbox_label"><input type="checkbox" id="sl-fudge-calm" ${fudge.calm ? "checked" : ""}> Calm (AMBIENT + TRUE)</label>
                <label>Fire <select class="text_pole" id="sl-fudge-fire"><option value="">Auto</option><option value="none" ${fudge.fire === "none" ? "selected" : ""}>None</option>${oldFire}${bulletOptions}</select></label>
            </div>
            <div class="sl-btns"><button class="menu_button" id="sl-reroll-unlocked">Re-roll unlocked</button>
                <button class="menu_button" id="sl-save-fudges">Save for next turn</button><button class="menu_button" id="sl-clear-fudges">Clear fudges</button></div>
            <h4>Preview</h4><pre id="sl-turn-preview" class="sl-turn-preview">${esc2(initialFacts || "No turn facts for the enabled sections.")}</pre>`;
  } else if (tab === "quests") {
    const found = latestState(c, c.length, config);
    const questsOff = s.sections.quests === false;
    if (!found) body = "<p><i>No reply carries a Story Ledger block yet — quests appear here once one does.</i></p>";
    else {
      const qs = found.state.quests || [];
      const done = qs.filter((q) => q.status !== "active");
      const row = (q) => `<div class="sl-item"><div><b>${esc2(q.id)} ${esc2(q.kind)}</b> · ${esc2(q.status)} — ${esc2(q.objective)}${q.progress ? ` <small>(${esc2(q.progress)})</small>` : ""}</div>${q.status === "active" ? "<small>active — always sent</small>" : `<label class="checkbox_label"><input type="checkbox" class="sl-send" data-id="${esc2(q.id)}" ${q.send ? "checked" : ""} ${questsOff ? "disabled" : ""}> Send to the model</label>`}</div>`;
      body = `${questsOff ? `<p class="sl-meta"><b>The 📜 Quests section is switched off in Settings</b> — quests are not tracked or sent; switch it back on to change these.</p>` : ""}<p class="sl-meta">Every quest stays in the block for you. Active quests always reach the model; a finished one only when you tick it.</p>
                ${done.length ? `<label class="checkbox_label"><input type="checkbox" id="sl-send-all" ${done.every((q) => q.send) ? "checked" : ""} ${questsOff ? "disabled" : ""} data-mixed="${done.some((q) => q.send) && !done.every((q) => q.send) ? 1 : 0}"> <b>Send all finished quests</b></label>` : ""}
                ${qs.map(row).join("") || "<p><i>No quests yet.</i></p>"}`;
    }
  } else if (tab === "rel") {
    const here = /* @__PURE__ */ new Set([...state.scene.present, config.userName]);
    const pairs = Object.values(state.rel.pairs).sort((a, b) => (here.has(b.from) || here.has(b.to)) - (here.has(a.from) || here.has(a.to)));
    body = `<div class="sl-meta">Turn ${state.ct} · present: ${state.scene.present.map(esc2).join(", ") || "—"}</div>
            <p class="sl-meta">Edit the numbers in the newest reply's block to correct them; the next turn starts from your edit.</p>
            ${pairs.map((p) => pairCard(state, p.from, p.to, config)).join("") || "<p><i>No relationships yet. The model creates them with NEW lines; on a chat that ran another preset, the first reply calibrates them from its old state.</i></p>"}`;
  } else {
    const cf = config;
    const axisRows = cf.axes.map((a) => `<tr><td title="${esc2(a.meaning)}">${esc2(a.name)} (${a.key})</td><td><input type="number" class="text_pole sl-num" data-cfg-axis="${a.key}" data-field="period" value="${a.period}"></td><td><input type="number" class="text_pole sl-num" data-cfg-axis="${a.key}" data-field="threshold" value="${a.threshold}"></td></tr>`).join("");
    const decayRows = cf.decay.map((d, i) => `<tr><td>${d.pair.join(" ↔ ")}</td><td><input type="number" class="text_pole sl-num" data-cfg-decay="${i}" value="${d.period}"></td></tr>`).join("");
    const num = (k, label) => `<label>${label} <input type="number" class="text_pole sl-num" data-cfg="${k}" value="${cf[k]}"></label>`;
    const sec = {
      scene: "🕰️ Scene & story clock",
      relationships: "💞 Relationships",
      notebook: "📓 Rules notebook & threads",
      ...Object.fromEntries(SECTIONS.map((x) => [x.key, typeof x.title === "function" ? x.title({ checkStyle: s.checkStyle }) : x.title]))
    };
    body = `<label class="checkbox_label"><input type="checkbox" data-set="enabled" ${s.enabled ? "checked" : ""}> Story Ledger on</label>
            <label class="checkbox_label" title="Warnings about a reply stay on screen until closed, so they are not missed while you are in another tab"><input type="checkbox" data-set="stickyNotices" ${s.stickyNotices !== false ? "checked" : ""}> Keep reply warnings until dismissed</label>
            <div class="sl-grid"><label>Ledger fix-up context <select class="text_pole" data-set="fixupMode">
                    <option value="full" title="Sends the whole normal prompt. If your provider caches prompts, much of it may be a cache hit." ${s.fixupMode !== "lean" ? "selected" : ""}>Full</option>
                    <option value="lean" title="Sends a short prompt (system, cards, summaries, recent messages). Fewer input tokens on long chats, but it does not reuse the chat's cached prefix." ${s.fixupMode === "lean" ? "selected" : ""}>Lean</option></select></label>
                <label id="sl-fixup-history" ${s.fixupMode === "lean" ? "" : 'style="display:none"'}>Recent messages <input type="number" class="text_pole sl-num" data-set="fixupHistory" value="${s.fixupHistory}" min="0" max="20"></label></div>
            <h4>Sections</h4>
            ${Object.entries(sec).map(([k, label]) => `<label class="checkbox_label"><input type="checkbox" data-section="${k}" ${s.sections[k] ? "checked" : ""}> ${label}</label>`).join("")}
            <h4>Look</h4>
            <div class="sl-grid"><label>Theme <select class="text_pole" data-set="theme">${[["frankenstein", "Frankenstein"], ["sola", "Sola"], ["megumin", "Megumin"]].map(([v, l]) => `<option value="${v}" ${(s.theme || "frankenstein") === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
                <label>Check style <select class="text_pole" data-set="checkStyle"><option value="dnd" ${s.checkStyle !== "arrow" ? "selected" : ""}>DnD (locked DC)</option><option value="arrow" ${s.checkStyle === "arrow" ? "selected" : ""}>Wind's Arrow (Sola)</option></select></label></div>
            <h4>Prompt placement</h4>
            <div class="sl-grid">
                <label>Placement <select class="text_pole" data-set="placement"><option value="auto" ${s.placement === "auto" ? "selected" : ""}>automatic, in chat at depth</option><option value="macro" ${s.placement === "macro" ? "selected" : ""}>only where a preset uses {{story_ledger}}</option></select></label>
                <label>Depth <input type="number" class="text_pole sl-num" data-set="depth" value="${s.depth}" min="0"></label>
                <label>Role <select class="text_pole" data-set="role"><option value="0" ${+s.role === 0 ? "selected" : ""}>system</option><option value="1" ${+s.role === 1 ? "selected" : ""}>user</option><option value="2" ${+s.role === 2 ? "selected" : ""}>assistant</option></select></label>
            </div>
            <h4>Relationship engine numbers <small>— FrankenSIM 3.0's defaults; they apply from the next reply on</small></h4>
            <div class="sl-grid">${num("tickCap", "Tick cap / acc / turn")}${num("directMax", "DIRECT max")}${num("axisMin", "Axis min")}${num("axisMax", "Axis max")}${num("decayLead", "Decay gap")}${num("floorDivisor", "Floor divisor")}${num("floorMax", "Floor max")}${num("wallMin", "WALL min")}${num("gravityMin", "Gravity Well min")}</div>
            <div class="sl-grid"><label>Romance gate E ≥ <input type="number" class="text_pole sl-num" data-cfg-gate="E" value="${cf.romanceGate.E}"></label><label>or L ≥ <input type="number" class="text_pole sl-num" data-cfg-gate="L" value="${cf.romanceGate.L}"></label>
                <label>Offstage skip values <input type="text" class="text_pole" data-cfg-skip value="${cf.offstageSkip.join(", ")}"></label></div>
            <div class="sl-grid"><label>Φ period <input type="number" class="text_pole sl-num" data-cfg-phi="period" value="${cf.phi.period}"></label><label>Φ threshold <input type="number" class="text_pole sl-num" data-cfg-phi="threshold" value="${cf.phi.threshold}"></label><label>Φ acc cap <input type="number" class="text_pole sl-num" data-cfg-phi="accCap" value="${cf.phi.accCap}"></label></div>
            <table class="sl-table"><tr><th>Axis</th><th>Convert every N turns</th><th>at accumulator ≥</th></tr>${axisRows}</table>
            <table class="sl-table"><tr><th>Mirror decay</th><th>every N turns</th></tr>${decayRows}</table>
            <h4>🔫 Chekhov's Gun</h4>
            <div class="sl-grid">
                <label>Who fires bullets <select class="text_pole" data-chk-firing>
                    <option value="model" ${cf.sectionConfig.chekhov.firing === "model" ? "selected" : ""}>The model, when the moment is right</option>
                    <option value="fate" ${cf.sectionConfig.chekhov.firing === "fate" ? "selected" : ""}>Fate's pick</option></select></label>
                ${[["eligibleAge", "Eligible from age"], ["pruneAge", "Prune at age"], ["cap", "Active cap"], ["maxLoadsPerTurn", "Loads per reply"], ["firedKeep", "Fired kept (0 = all)"]].map(([k, label]) => `<label>${label} <input type="number" min="${k === "eligibleAge" || k === "firedKeep" ? 0 : 1}" class="text_pole sl-num" data-chk="${k}" value="${cf.sectionConfig.chekhov[k]}"></label>`).join("")}
            </div>
            <h4>🎲 Fate & World Sim</h4>
            <div class="sl-grid">${[["deferredExpire", "Deferred expiry"], ["worldKeep", "World entries kept"], ["reach1Drop", "Drop Reach 1 at age"], ["pursuitLimit", "Pursuit limit"], ["residueKeep", "Residue lines kept"]].map(([k, label]) => `<label>${label} <input type="number" min="1" class="text_pole sl-num" data-fate="${k}" value="${cf.sectionConfig.fate[k]}"></label>`).join("")}</div>
            <div class="sl-btns"><button class="menu_button" id="sl-save-config">Save engine numbers</button><button class="menu_button" id="sl-reset-config">Reset to defaults</button></div>`;
  }
  return `<div class="sl-popup">
        <h3>📒 Story Ledger</h3>
        <div class="sl-tabs sl-popup-tabs">${T("rules", "📜 Rules")}${T("threads", "🧵 Threads")}${T("clock", "🕰️ Clock")}${T("quests", "🗺️ Quests")}${T("rel", "💞 Relationships")}${T("dice", "🎲 Next turn")}${T("settings", "⚙️ Settings")}</div>
        <div class="sl-popup-body">${body}</div>
    </div>`;
}

// src/ui/themes/frankenstein.js
var frankenstein_exports = {};
__export(frankenstein_exports, {
  decorate: () => decorate,
  decorateWith: () => decorateWith,
  outerDetails: () => outerDetails,
  syncFixupButton: () => syncFixupButton,
  undecorate: () => undecorate
});

// src/ui/themes/common.js
var THEME_CLASSES = [
  "sl-fk-section",
  "sl-grp-people",
  "sl-grp-memory",
  "sl-grp-sim",
  "sl-fk-has-bars",
  "sl-theme-frankenstein",
  "sl-theme-sola",
  "sl-theme-megumin",
  "sl-sola-card",
  "sl-sola-bond",
  "sl-sola-cabinet",
  "sl-sola-note",
  "sl-mg-hidden"
];
function undecorate(root) {
  root.querySelectorAll(".sl-ui").forEach((n) => n.remove());
  root.querySelectorAll(".sl-sola-hud").forEach((n) => n.remove());
  root.querySelectorAll("[data-sl-orig]").forEach((n) => {
    n.innerHTML = n.dataset.slOrig;
    delete n.dataset.slOrig;
  });
  root.querySelectorAll("[data-sl-wrap]").forEach((n) => n.replaceWith(document.createTextNode(n.dataset.slWrap)));
  root.querySelectorAll(THEME_CLASSES.map((c) => `.${c}`).join(", ")).forEach((n) => {
    n.classList.remove(...THEME_CLASSES);
    delete n.dataset.slTheme;
    delete n.dataset.slTab;
  });
}

// src/ui/themes/layout.js
var key = (t) => String(t).replace(/[^A-Za-z ]/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
function hudChips({ now = "", present = "", tier = "", source = "" } = {}) {
  const out = [];
  if (now) out.push({ label: "Now", value: now, kind: "now" });
  if (present) out.push({ label: "Present", value: present, kind: "present" });
  if (tier) out.push({ label: "Fate", value: source ? `${tier} + ${source}` : tier, kind: tier.toLowerCase() });
  return out;
}
var TABS = [
  ["Scene", (k) => /^SCENE( CAST)?$/.test(k)],
  ["People", (k) => /AGENDAS|LOCATIONS|FACTIONS/.test(k)],
  ["Relationships", (k) => /RELATIONSHIPS/.test(k)],
  ["Story", (k) => /QUESTS|CHEKHOV|^LAST$|THOUGHTS/.test(k)],
  ["Fate", (k) => /FATE|WORLD|DND|ARROW|PHYSICS/.test(k)]
];
function sectionGroups(titles) {
  const groups = [...TABS.map(([tab]) => ({ tab, titles: [] })), { tab: "Notes", titles: [] }];
  for (const t of titles) {
    const k = key(t);
    const ix = TABS.findIndex(([, test]) => test(k));
    groups[ix < 0 ? groups.length - 1 : ix].titles.push(t);
  }
  return groups.filter((g) => g.titles.length);
}
var PAIR_ROW = /^\s*[-*•]?\s*([^|]+?)\s→\s([^|]+?)\s*\|\s*((?:[A-Za-z]{1,3}\s+-?\d+·-?\d+\s*)+)(?:\|\s*(?:note:\s*(.*)|.*))?$/;
function pairRows(lines2) {
  const rows = [];
  for (const line of lines2) {
    const m = String(line).match(PAIR_ROW);
    if (!m || /^Awaiting NEW/i.test(m[1])) continue;
    const vals = {};
    for (const t of m[3].matchAll(/([A-Za-z]{1,3})\s+(-?\d+)·(-?\d+)/g)) vals[t[1]] = { v: Number(t[2]), acc: Number(t[3]) };
    rows.push({ from: m[1].trim(), to: m[2].trim(), vals, note: (m[4] || "").trim() });
  }
  return rows;
}

// src/ui/themes/frankenstein.js
var GROUPS = [
  [/SCENE|AGENDAS|LOCATIONS|RELATIONSHIPS|FACTIONS|CAST/i, "sl-grp-people"],
  [/NOTEBOOK|QUESTS|CHEKHOV|THOUGHTS|INV|LAST/i, "sl-grp-memory"],
  [/FATE|WORLD|DND|PHYSICS|ARROW/i, "sl-grp-sim"]
];
var escHtml = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
function outerDetails(root) {
  return [...root.querySelectorAll("details")].find((d) => {
    const s = d.querySelector(":scope > summary");
    return s && /INTERNAL STATES/i.test(s.textContent);
  }) || null;
}
function relationBars(section2, config) {
  const lines2 = section2.innerHTML.split(/<br\s*\/?>|\n|<\/li>|<\/p>/i).map((html) => {
    const el = document.createElement("div");
    el.innerHTML = html;
    return el.textContent;
  });
  const rows = pairRows(lines2);
  if (!rows.length) return null;
  const max = config.axisMax || 20;
  const wrap = document.createElement("div");
  wrap.className = "sl-ui sl-fk-pairs";
  wrap.innerHTML = rows.map((r) => `<div class="sl-fk-pair"><div class="sl-fk-pair-name">${escHtml(r.from)} → ${escHtml(r.to)}</div>${r.note ? `<div class="sl-fk-pair-note">${escHtml(r.note)}</div>` : ""}${config.axes.filter((a) => a.kind === "fond").map((f) => {
    const fv = r.vals[f.key] || { v: 0, acc: 0 }, mv = r.vals[f.mirror] || { v: 0, acc: 0 };
    const mirror = config.axes.find((a) => a.key === f.mirror);
    return `<div class="sl-fk-row"><span class="sl-fk-lab sl-fond">${escHtml(f.name)} <b>${fv.v}</b>${fv.acc ? `<small>+${fv.acc}</small>` : ""}</span><span class="sl-fk-bar sl-fond"><i style="width:${Math.max(0, Math.min(100, fv.v / max * 100))}%"></i></span><span class="sl-fk-bar sl-friction"><i style="width:${Math.max(0, Math.min(100, mv.v / max * 100))}%"></i></span><span class="sl-fk-lab sl-friction"><b>${mv.v}</b>${mv.acc ? `<small>+${mv.acc}</small>` : ""} ${escHtml(mirror ? mirror.name : f.mirror)}</span></div>`;
  }).join("")}</div>`).join("");
  return wrap;
}
function syncNextTurnButton(outer, isNewest) {
  const head = outer.querySelector(":scope > summary");
  const existing = head && head.querySelector(".sl-next-turn");
  if (!head) return;
  if (isNewest && !existing) head.insertAdjacentHTML("beforeend", `<span class="sl-ui sl-next-turn" title="Set next turn dice and preview">🎲</span>`);
  else if (!isNewest && existing) existing.remove();
}
var FIXUP_TITLES = { missing: "Write the missing ledger comment", thoughts: "Add the missing Thoughts" };
function syncFixupButton(outer, fixup) {
  const head = outer.querySelector(":scope > summary");
  if (!head) return;
  const existing = head.querySelector(".sl-fixup");
  if (!fixup) {
    if (existing) existing.remove();
    return;
  }
  if (!existing) head.insertAdjacentHTML("beforeend", `<span class="sl-ui sl-fixup" title="${FIXUP_TITLES[fixup]}">✎</span>`);
  else if (existing.title !== FIXUP_TITLES[fixup]) existing.title = FIXUP_TITLES[fixup];
}
function fateChips(section2) {
  const rows = [...section2.querySelectorAll("li, p, div")].filter((el) => !el.querySelector("li, p, div"));
  for (const row of rows) {
    let html = row.innerHTML;
    if (/This turn:/i.test(row.textContent)) {
      html = html.replace(/\b(AMBIENT|MINOR|MAJOR)\b/gi, (tier) => `<span class="sl-ui-inline sl-fk-tier sl-fk-tier-${tier.toLowerCase()}">${tier}</span>`);
    }
    if (/\(fudged(?::[^)]*)?\)/i.test(row.textContent)) {
      html = html.replace(/\(fudged(?::[^)]*)?\)/gi, (marker) => `<span class="sl-ui-inline sl-fk-fudged">${marker}</span>`);
    }
    if (html !== row.innerHTML) {
      row.dataset.slOrig = row.innerHTML;
      row.innerHTML = html;
    }
  }
}
var decorate = (root, ctx) => decorateWith(root, ctx, "frankenstein");
function decorateWith(root, { config, isNewest = false, fixup = null }, theme) {
  const outer = outerDetails(root);
  if (!outer) return false;
  if (outer.dataset.slTheme === theme) {
    syncNextTurnButton(outer, isNewest);
    syncFixupButton(outer, fixup);
    return false;
  }
  undecorate(root);
  outer.dataset.slTheme = theme;
  outer.classList.add(`sl-theme-${theme}`);
  const head = outer.querySelector(":scope > summary");
  head.insertAdjacentHTML("beforeend", `<span class="sl-ui sl-rebuild" title="Rebuild this block from the one before it and this reply's ledger comment">↻</span>`);
  syncNextTurnButton(outer, isNewest);
  syncFixupButton(outer, fixup);
  for (const d of outer.querySelectorAll("details")) {
    const s = d.querySelector(":scope > summary");
    if (!s) continue;
    const title = s.textContent;
    const grp = GROUPS.find(([re]) => re.test(title));
    if (grp) d.classList.add("sl-fk-section", grp[1]);
    if (/RELATIONSHIPS/i.test(title)) {
      const bars = relationBars(d, config);
      if (bars) {
        d.classList.add("sl-fk-has-bars");
        s.insertAdjacentElement("afterend", bars);
      }
    }
    if (/NOTEBOOK/i.test(title)) {
      for (const node of [...d.querySelectorAll("li, p, span, div")].filter((n) => !n.children.length || n.tagName === "LI")) {
        if (/\[(R|T)\]/.test(node.innerHTML) && !node.closest(".sl-ui")) {
          node.dataset.slOrig = node.innerHTML;
          node.innerHTML = node.innerHTML.replace(/\[(R|T)\]/g, (_, k) => `<span class="sl-ui-inline sl-fk-tag sl-fk-${k}">${k}</span>`);
        }
      }
    }
    if (/CHEKHOV/i.test(title)) chekhovChips(d);
    if (/FATE ROUTINE/i.test(title)) fateChips(d);
  }
  return true;
}
var CHIP_RES = [
  [/·\s*(hot)\b/g, () => "hot"],
  [/·\s*(eligible)\b/g, () => "eligible"],
  [/·\s*(secret)\b/g, () => "secret"],
  [/·\s*(LOCKED .+?)(?=\s·\s(?:at |after B|eligible)|$|<)/g, () => "locked"],
  [/·\s*(at (?:Day \d+ )?\d{1,2}:\d{2}(?: next-day)?(?: reached)?)/g, (t) => /reached$/.test(t) ? "due" : "scheduled"],
  [/\|\s*(fired:)/g, () => "fired"]
];
var TAGS_START = /\|\s*(?:w[123]\s·\sage|fired:)/;
var chipLine = (line) => {
  const at = line.search(TAGS_START);
  if (at < 0) return line;
  let tags = line.slice(at);
  for (const [re, kind] of CHIP_RES) tags = tags.replace(re, (m, t) => `${m.startsWith("|") ? "| " : " "}<span class="sl-ui-inline sl-fk-chip sl-fk-${kind(t)}">${t}</span>`);
  return line.slice(0, at) + tags;
};
function chekhovChips(section2) {
  for (const child of [...section2.childNodes]) {
    if (child.nodeType === 1 && (child.tagName === "SUMMARY" || child.classList.contains("sl-ui"))) continue;
    let el = child;
    if (child.nodeType === 3) {
      if (!child.textContent.trim()) continue;
      el = document.createElement("span");
      el.dataset.slWrap = child.textContent;
      child.replaceWith(el);
      el.textContent = child.textContent;
    }
    if (el.nodeType !== 1) continue;
    const html = el.innerHTML.split(/(<br\s*\/?>|\n)/i).map((part) => /^(<br\s*\/?>|\n)$/i.test(part) ? part : chipLine(part)).join("");
    if (html !== el.innerHTML) {
      if (!el.dataset.slWrap) el.dataset.slOrig = el.innerHTML;
      el.innerHTML = html;
    }
  }
}

// src/ui/themes/sola.js
var sola_exports = {};
__export(sola_exports, {
  decorate: () => decorate2,
  undecorate: () => undecorate
});
var escHtml2 = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
var sectionText = (outer, re) => {
  const d = [...outer.querySelectorAll("details")].find((x) => re.test((x.querySelector(":scope > summary") || {}).textContent || ""));
  return d ? d.textContent : "";
};
var field2 = (text, label, next) => {
  const m = text.match(new RegExp(`${label}:\\s*([\\s\\S]*?)(?=${next}|$)`));
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
};
function decorate2(root, ctx) {
  const fresh = decorateWith(root, ctx, "sola");
  if (!fresh) return;
  const outer = outerDetails(root);
  const scene = sectionText(outer, /SCENE$/);
  const fate2 = sectionText(outer, /FATE/);
  const turn = fate2.match(/This turn:\s*(AMBIENT|MINOR|MAJOR)\s*\+\s*(TRUE|WEIGHTED)/);
  const chips = hudChips({
    now: field2(scene, "Now", "Present:|Public:"),
    present: field2(scene, "Present", "Public:"),
    tier: turn ? turn[1] : "",
    source: turn ? turn[2] : ""
  });
  if (chips.length) {
    outer.insertAdjacentHTML("beforebegin", `<div class="sl-ui sl-sola-hud">${chips.map((c) => `<span class="sl-sola-chip sl-sola-${c.kind}"><b>${escHtml2(c.label)}</b> ${escHtml2(c.value)}</span>`).join("")}</div>`);
  }
  for (const d of outer.querySelectorAll("details")) {
    const title = (d.querySelector(":scope > summary") || {}).textContent || "";
    if (/INTERNAL STATES/i.test(title)) continue;
    d.classList.add(/RELATIONSHIPS/i.test(title) ? "sl-sola-bond" : /THOUGHTS/i.test(title) ? "sl-sola-cabinet" : /FATE/i.test(title) ? "sl-sola-note" : "sl-sola-card");
  }
}

// src/ui/themes/megumin.js
var megumin_exports = {};
__export(megumin_exports, {
  decorate: () => decorate3,
  undecorate: () => undecorate
});
var ICON = { Scene: "🕰️", People: "👤", Relationships: "💞", Story: "📜", Fate: "🎲", Notes: "📓" };
function decorate3(root, ctx) {
  const fresh = decorateWith(root, ctx, "megumin");
  if (!fresh) return;
  const outer = outerDetails(root);
  const head = outer.querySelector(":scope > summary");
  const sections = [...outer.querySelectorAll(":scope > details")];
  const titleOf = (d) => ((d.querySelector(":scope > summary") || {}).textContent || "").trim();
  const groups = sectionGroups(sections.map(titleOf));
  if (!groups.length) return;
  const strip = document.createElement("div");
  strip.className = "sl-ui sl-mg-tabs";
  strip.innerHTML = groups.map((g) => `<button type="button" class="sl-mg-tab" data-tab="${g.tab}"><span>${ICON[g.tab] || "•"}</span> ${g.tab}</button>`).join("");
  head.insertAdjacentElement("afterend", strip);
  const show5 = (tab) => {
    const group = groups.find((g) => g.tab === tab) || groups[0];
    outer.dataset.slTab = group.tab;
    for (const d of sections) {
      const visible = group.titles.includes(titleOf(d));
      d.classList.toggle("sl-mg-hidden", !visible);
      if (visible) d.open = true;
    }
    for (const b of strip.querySelectorAll(".sl-mg-tab")) b.classList.toggle("sl-mg-active", b.dataset.tab === group.tab);
  };
  strip.addEventListener("click", (e) => {
    const b = e.target.closest(".sl-mg-tab");
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    show5(b.dataset.tab);
  });
  show5(groups[0].tab);
}

// localchar/st-chat.mjs
function toStChat(history, { userName = "", charName = "" } = {}) {
  return (history || []).map((m) => {
    const isUser = m.role === "user";
    const isSystem = Boolean(m.is_system) || m.role === "system";
    return {
      mes: typeof m.content === "string" ? m.content : "",
      is_user: isUser,
      is_system: isSystem,
      name: m.name || (isUser ? userName : isSystem ? "" : charName),
      swipe_id: 0
    };
  });
}

// localchar/panel-logic.mjs
var validDie = (value2) => Number.isInteger(Number(value2)) && String(value2).trim() !== "" && Number(value2) >= 1 && Number(value2) <= 20;
function fudgeFromControls({ dice = {}, checks = { locked: false, values: [] }, tier = "", source = "", calm = false, fire = "" } = {}) {
  const fudge = { appliedTo: null };
  const locks = {};
  for (const key2 of ["fate.a", "fate.b", "fate.c", "world"]) {
    const control = dice[key2];
    if (control && control.locked && validDie(control.value)) locks[key2] = Number(control.value);
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
function configFormFromControls({ cfg = [], gate = [], phi = [], axes = [], decay = [], skip = void 0, chekhov: chekhov2 = [], firing = "model", fate: fate2 = [] } = {}) {
  const pairs = (list) => Object.fromEntries(list);
  const nested = {};
  for (const [key2, field3, value2] of axes) (nested[key2] ||= {})[field3] = value2;
  const form = {
    cfg: pairs(cfg),
    gate: pairs(gate),
    phi: pairs(phi),
    axes: nested,
    decay: pairs(decay),
    chekhov: { ...pairs(chekhov2), firing },
    fate: pairs(fate2)
  };
  if (skip !== void 0) form.skip = skip;
  return form;
}
function settingFromControl({ type, checked, value: value2 }) {
  return type === "checkbox" ? Boolean(checked) : type === "number" ? Number(value2) : value2;
}
function configFromForm(current, form = {}) {
  const c = resolveConfig(current);
  for (const [key2, value2] of Object.entries(form.cfg || {})) c[key2] = Number(value2);
  for (const [key2, value2] of Object.entries(form.gate || {})) c.romanceGate[key2] = Number(value2);
  for (const [key2, value2] of Object.entries(form.phi || {})) c.phi[key2] = Number(value2);
  for (const [key2, fields] of Object.entries(form.axes || {})) {
    const axis = c.axes.find((a) => a.key === key2);
    if (axis) for (const [field3, value2] of Object.entries(fields)) axis[field3] = Number(value2);
  }
  for (const [i, period] of Object.entries(form.decay || {})) if (c.decay[Number(i)]) c.decay[Number(i)].period = Number(period);
  if (form.skip !== void 0) c.offstageSkip = String(form.skip || "").split(/[,\s]+/).map(Number).filter(Number.isFinite);
  c.sectionConfig.chekhov = sanitizeChekhov(form.chekhov || {}, c.sectionConfig.chekhov);
  c.sectionConfig.fate = sanitizeFate(form.fate || {}, c.sectionConfig.fate);
  return c;
}

// localchar/panel.mjs
var TITLE = "📒 Story Ledger";
var lines = (text) => String(text || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
var dieValue = (dice, key2) => key2.startsWith("fate.") ? dice.fate[key2.at(-1)] : key2 === "world" ? dice.world : dice.checks;
function readFudgeControls(root) {
  const q = (selector) => root.querySelector(selector);
  const dice = {};
  for (const key2 of ["fate.a", "fate.b", "fate.c", "world"]) {
    dice[key2] = { locked: Boolean(q(`[data-fudge-lock="${key2}"]`)?.checked), value: q(`[data-fudge-value="${key2}"]`)?.value };
  }
  return fudgeFromControls({
    dice,
    checks: { locked: Boolean(q('[data-fudge-lock="checks"]')?.checked), values: [0, 1, 2].map((i) => q(`[data-fudge-check="${i}"]`)?.value) },
    tier: q("#sl-fudge-tier")?.value || "",
    source: q("#sl-fudge-source")?.value || "",
    calm: Boolean(q("#sl-fudge-calm")?.checked),
    fire: q("#sl-fudge-fire")?.value || ""
  });
}
function readConfigControls(root) {
  const all = (selector) => [...root.querySelectorAll(selector)];
  return configFormFromControls({
    cfg: all("[data-cfg]").map((el) => [el.dataset.cfg, el.value]),
    gate: all("[data-cfg-gate]").map((el) => [el.dataset.cfgGate, el.value]),
    phi: all("[data-cfg-phi]").map((el) => [el.dataset.cfgPhi, el.value]),
    axes: all("[data-cfg-axis]").map((el) => [el.dataset.cfgAxis, el.dataset.field, el.value]),
    decay: all("[data-cfg-decay]").map((el) => [el.dataset.cfgDecay, el.value]),
    skip: root.querySelector("[data-cfg-skip]")?.value,
    chekhov: all("[data-chk]").map((el) => [el.dataset.chk, el.value]),
    firing: String(root.querySelector("[data-chk-firing]")?.value || "model"),
    fate: all("[data-fate]").map((el) => [el.dataset.fate, el.value])
  });
}
function mountLedger({ host, body, startTab = "rules", fixedTab = null, getSettings, setSettings }) {
  let tab = fixedTab || startTab;
  let previewBaseDice = rollTurnDice();
  let view = null;
  let closed = false;
  let previewSeq = 0;
  const notify = (kind, text) => host.notify(kind, text, TITLE);
  async function load() {
    if (fixedTab) {
      view = { chat: [], settings: getSettings(), chatData: normalizeChatData({}), userName: "" };
      return;
    }
    const snapshot = await host.callAction("popup_view", {});
    view = {
      chat: toStChat(snapshot.history, { userName: snapshot.user_name }),
      settings: getSettings(),
      chatData: normalizeChatData({ storyLedger: snapshot.chat_data }),
      userName: snapshot.user_name
    };
  }
  function render() {
    if (closed || !view) return;
    view.settings = getSettings();
    body.innerHTML = popupHtml(tab, view, previewBaseDice);
    if (fixedTab) {
      body.querySelector(".sl-popup-tabs")?.remove();
      body.querySelector(".sl-popup > h3")?.remove();
    }
    setMixed();
  }
  function setMixed() {
    const all = body.querySelector("#sl-send-all");
    if (all) all.indeterminate = all.dataset.mixed === "1";
  }
  async function run(name, args, message) {
    try {
      const out = await host.callAction(name, args);
      await load();
      render();
      if (message) notify("success", message);
      return out;
    } catch (error) {
      if (error?.code !== "extension_stale_bundle") notify("error", error?.message || "That did not work.");
      return null;
    }
  }
  async function updatePreview() {
    if (tab !== "dice") return;
    const seq = ++previewSeq;
    try {
      const out = await host.callAction("preview_turn", { fudge: readFudgeControls(body), base_dice: previewBaseDice });
      const target = body.querySelector("#sl-turn-preview");
      if (target && seq === previewSeq) target.textContent = out?.text || "No turn facts for the enabled sections.";
    } catch {
    }
  }
  const fudgeSummaryOf = (fudge) => fudgeSummary(fudge);
  async function onClick(event) {
    const t = event.target;
    const on = (selector) => t.closest?.(selector);
    let hit;
    if (hit = on("[data-sl-popup-tab]")) {
      tab = hit.dataset.slPopupTab;
      render();
      return;
    }
    if (on("#sl-save-rules")) {
      await run("save_rules", { rules: lines(body.querySelector("#sl-rules").value) }, "Rules saved. The next reply's block shows them.");
      return;
    }
    if (on("#sl-save-threads")) {
      await run("save_threads", { threads: lines(body.querySelector("#sl-threads").value) }, "Starting threads saved.");
      return;
    }
    if (on("#sl-import")) {
      const got = await host.callAction("import_legacy_notebook", {});
      if (got && (got.rules.length || got.threads.length)) {
        const box = body.querySelector("#sl-rules");
        const current = lines(box.value);
        box.value = [...current, ...got.rules.filter((rule) => !current.includes(rule))].join("\n");
      }
      return;
    }
    if (hit = on(".sl-approve, .sl-reject")) {
      await run("decide_proposal", { id: hit.dataset.id, decision: hit.classList.contains("sl-approve") ? "approve" : "reject" });
      return;
    }
    if (on("#sl-clock-set")) {
      const text = String(body.querySelector("#sl-clock").value || "").trim();
      if (text) await run("set_clock", { text }, "Story time corrected.");
      return;
    }
    if (on("#sl-clock-clear")) {
      await run("clear_clock", {});
      return;
    }
    if (on("#sl-reroll-unlocked")) {
      previewBaseDice = rollTurnDice();
      for (const key2 of ["fate.a", "fate.b", "fate.c", "world"]) {
        if (!body.querySelector(`[data-fudge-lock="${key2}"]`).checked) body.querySelector(`[data-fudge-value="${key2}"]`).value = dieValue(previewBaseDice, key2);
      }
      if (!body.querySelector('[data-fudge-lock="checks"]').checked) [0, 1, 2].forEach((i) => {
        body.querySelector(`[data-fudge-check="${i}"]`).value = previewBaseDice.checks[i];
      });
      updatePreview();
      return;
    }
    if (on("#sl-save-fudges")) {
      const fudge = readFudgeControls(body);
      const armed = hasFudgeSettings(fudge);
      await run("save_fudges", { fudge }, armed ? `Armed for the next reply: ${fudgeSummaryOf(fudge)}.` : "No fudges are set.");
      return;
    }
    if (on("#sl-clear-fudges")) {
      await run("clear_fudges", {}, "Fudges cleared.");
      return;
    }
    if (on("#sl-save-config")) {
      try {
        await setSettings({ ...getSettings(), config: configFromForm(getSettings().config, readConfigControls(body)) });
        render();
        notify("success", "Engine numbers saved. They apply from the next reply on.");
      } catch (error) {
        notify("error", `The engine numbers were not saved: ${error?.message || error}`);
      }
      return;
    }
    if (on("#sl-reset-config")) {
      await setSettings({ ...getSettings(), config: {} });
      render();
      notify("success", "Reset to defaults.");
    }
  }
  async function onChange(event) {
    const el = event.target;
    if (el.matches?.("#sl-nb-enabled")) {
      await run("set_notebook_enabled", { enabled: el.checked });
      return;
    }
    if (el.matches?.("[data-fudge-lock]")) {
      const key2 = el.dataset.fudgeLock;
      if (!el.checked) {
        if (key2 === "checks") [0, 1, 2].forEach((i) => {
          body.querySelector(`[data-fudge-check="${i}"]`).value = previewBaseDice.checks[i];
        });
        else body.querySelector(`[data-fudge-value="${key2}"]`).value = dieValue(previewBaseDice, key2);
      }
      updatePreview();
      return;
    }
    if (el.matches?.("#sl-fudge-tier, #sl-fudge-source, #sl-fudge-calm, #sl-fudge-fire")) {
      updatePreview();
      return;
    }
    if (el.matches?.("[data-set]")) {
      const next = { ...getSettings(), [el.dataset.set]: settingFromControl(el) };
      await setSettings(next);
      if (el.dataset.set === "fixupMode") {
        const history = body.querySelector("#sl-fixup-history");
        if (history) history.style.display = el.value === "lean" ? "" : "none";
      }
      return;
    }
    if (el.matches?.("[data-section]")) {
      const current = getSettings();
      await setSettings({ ...current, sections: { ...current.sections, [el.dataset.section]: el.checked } });
      return;
    }
    if (el.matches?.(".sl-send")) {
      await sendQuests([String(el.dataset.id)], el.checked);
      return;
    }
    if (el.matches?.("#sl-send-all")) {
      await sendQuests("all", el.checked);
    }
  }
  function onInput(event) {
    const el = event.target;
    if (el.matches?.("[data-fudge-value]")) {
      const lock = body.querySelector(`[data-fudge-lock="${el.dataset.fudgeValue}"]`);
      if (lock) lock.checked = true;
      updatePreview();
    } else if (el.matches?.("[data-fudge-check]")) {
      const lock = body.querySelector('[data-fudge-lock="checks"]');
      if (lock) lock.checked = true;
      updatePreview();
    }
  }
  async function sendQuests(ids, on) {
    if (await run("quests_send", { ids, on })) await host.chat.reload?.();
  }
  body.addEventListener("click", onClick);
  body.addEventListener("change", onChange);
  body.addEventListener("input", onInput);
  body.textContent = "Loading…";
  load().then(render).catch((error) => {
    if (!closed) body.textContent = `The ledger could not be loaded: ${error?.message || error}`;
  });
  return () => {
    closed = true;
    body.removeEventListener("click", onClick);
    body.removeEventListener("change", onChange);
    body.removeEventListener("input", onInput);
  };
}

// localchar/browser.mjs
var THEMES = { frankenstein: frankenstein_exports, sola: sola_exports, megumin: megumin_exports };
var TITLE2 = "📒 Story Ledger";
var noop = () => {
};
var OPENER = "<!-- story_ledger";
function hideStreamingComment(text) {
  const source = String(text ?? "").replace(/\s*<!--\s*Story_Ledger[\s\S]*?-->/gi, "");
  const full = source.search(/<!--\s*Story_Ledger/i);
  if (full >= 0) return source.slice(0, full).replace(/\s+$/, "");
  const lt = source.lastIndexOf("<");
  if (lt >= 0 && OPENER.startsWith(source.slice(lt).toLowerCase().replace(/\s+/g, " "))) return source.slice(0, lt).replace(/\s+$/, "");
  return source;
}
function handleBlockClick(event, { rebuild, fixup, nextTurn }) {
  for (const [selector, fn] of [[".sl-rebuild", rebuild], [".sl-fixup", fixup], [".sl-next-turn", nextTurn]]) {
    if (event.target && event.target.closest && event.target.closest(selector)) {
      event.preventDefault();
      event.stopPropagation();
      fn();
      return true;
    }
  }
  return false;
}
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function rebuildFlow({ host, message, confirm }) {
  const ok = await confirm("Rebuild this block?", "It is recomputed from the block before it and this reply's ledger comment. Hand edits to this block are replaced.");
  if (!ok) return;
  try {
    await host.callAction("rebuild", { message_id: message.id });
    await host.chat.reload();
  } catch (error) {
    if (error?.code !== "extension_stale_bundle") host.notify("error", error?.message || "The rebuild failed.", TITLE2);
  }
}
async function startFixupFlow({ host, settings, message, kase, confirm, refresh = noop, pollMs = 1500 }) {
  const mode = settings.fixupMode === "lean" ? "lean" : "full";
  const ok = await confirm(
    "Write the missing ledger part?",
    `${kase === "missing" ? "This reply has no ledger comment; one will be written." : "This reply's ledger comment has no Thoughts; they will be added."} The prose is never changed, and nothing is kept unless the answer is usable. ${mode === "lean" ? "Lean: short prompt" : "Full: normal prompt"}`
  );
  if (!ok) return;
  refresh(true);
  try {
    const fixup = { kase, mode };
    const jobId = mode === "lean" ? await host.startJob("raw_then_action", { message_id: message.id, prompt_action: "lean_prompt", accept_action: "accept_fixup", fixup }) : await host.startJob("continue_then_action", { message_id: message.id, accept_action: "accept_fixup", fixup });
    let job = await host.getJob(jobId);
    while (job.status === "running") {
      await sleep(pollMs);
      job = await host.getJob(jobId);
    }
    for (const note of job.notices || []) host.notify(note.kind, note.text, note.title || TITLE2, { sticky: note.sticky });
    if (job.status === "failed") {
      host.notify("error", `The ledger fix-up failed: ${job.result?.error || "unknown error"}`, TITLE2);
    } else if (job.result?.outcome === "kept_nothing") {
      host.notify("warning", "The reply changed during the ledger fix-up; it was left as it is.", TITLE2, { sticky: true });
    } else if (job.result?.outcome === "applied") {
      await host.chat.reload();
    }
  } catch (error) {
    if (error?.code !== "extension_stale_bundle") host.notify("error", `The ledger fix-up could not start: ${error?.message || error}`, TITLE2);
  } finally {
    refresh(false);
  }
}
function register(host) {
  let settings = normalizeSettings({});
  let busy = false;
  let disposed = false;
  let offHook = noop;
  let userName = "";
  let learningUser = false;
  const confirm = (title, body) => Promise.resolve(typeof globalThis.confirm === "function" ? globalThis.confirm(`${title}

${body}`) : true);
  const stChat = () => host.chat.messages().map((m) => ({
    mes: typeof m.content === "string" ? m.content : "",
    is_user: m.role === "user",
    is_system: false,
    name: "",
    swipe_id: 0
  }));
  function refreshDecorations() {
    if (disposed) return;
    offHook();
    offHook = host.onMessageRendered(decorate4);
  }
  function learnUserName() {
    if (userName || learningUser || !host.chat.branchId()) return;
    learningUser = true;
    host.callAction("popup_view", {}).then((view) => {
      if (view && view.user_name) {
        userName = view.user_name;
        refreshDecorations();
      }
    }).catch(noop).finally(() => {
      learningUser = false;
    });
  }
  function decorate4(el, message) {
    if (!settings.enabled || !String(message.content ?? "").includes(BLOCK_MARK)) {
      undecorate(el);
      return noop;
    }
    learnUserName();
    const theme = THEMES[settings.theme] || THEMES.frankenstein;
    const config = engineConfig(settings, userName);
    const messages = host.chat.messages();
    const chat = stChat();
    const index = messages.findIndex((m) => m.id === message.id);
    const newest = latestState(chat, chat.length, config)?.index ?? -1;
    const isNewest = index >= 0 && index === newest;
    const fixup = isNewest ? fixupCaseFor({ chat, index, settings, busy }) : null;
    theme.decorate(el, { config, mesIndex: index, isNewest, fixup });
    const onClick = (event) => handleBlockClick(event, {
      rebuild: () => rebuildFlow({ host, message, confirm }),
      fixup: () => {
        const kase = fixupCaseFor({ chat: stChat(), index: host.chat.messages().findIndex((m) => m.id === message.id), settings, busy });
        if (kase) startFixupFlow({ host, settings, message, kase, confirm, refresh: (state) => {
          busy = state;
          refreshDecorations();
        } });
      },
      nextTurn: () => openPanel("dice")
    });
    el.addEventListener("click", onClick);
    return () => {
      el.removeEventListener("click", onClick);
      undecorate(el);
    };
  }
  async function setSettings(next) {
    settings = normalizeSettings(next);
    await host.settings.set(settings);
    refreshDecorations();
  }
  const panelArgs = (body) => ({ host, body, getSettings: () => settings, setSettings });
  function openPanel(startTab = "rules") {
    host.openPanel({ title: TITLE2, render: (body) => mountLedger({ ...panelArgs(body), startTab }) });
  }
  offHook = host.onMessageRendered(decorate4);
  const offFilter = host.streamingFilter((text) => settings.enabled ? hideStreamingComment(text) : text);
  const offMenu = host.addChatMenuItem("Story Ledger", () => openPanel("rules"));
  const offPage = host.settingsPanel((body) => mountLedger({ ...panelArgs(body), fixedTab: "settings" }));
  host.settings.get().then((raw) => {
    settings = normalizeSettings(raw);
    refreshDecorations();
  }).catch(noop);
  return () => {
    disposed = true;
    offHook();
    offFilter();
    offMenu();
    offPage();
  };
}
export {
  register as default,
  handleBlockClick,
  hideStreamingComment,
  rebuildFlow,
  startFixupFlow
};
