// Mini-app of the planner: the day by the clock, the week's load, the backlog by project, what is remembered.
// Static page; every call goes to the API with Telegram initData or, in an ordinary browser, the personal key
// from the bot's /web command. The server checks either.
const API = "https://vuaywrqnbtubsekefxcv.supabase.co/functions/v1/planner-app";
const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

// Outside Telegram (Safari, a Dock app) initData is empty: the key from the /web link signs the requests instead.
// It comes after «#», so the page host never sees it; it is kept on this device and taken out of the address bar.
const inTelegram = !!tg?.initData;
const KEY_STORE = "almost-done-web-key";
let webKey = null;
let keyKept = false; // false when the browser would not store it (a private window): then a reload must not drop it
if (!inTelegram) {
  document.documentElement.classList.add("web");
  const fromLink = /(?:^#|&)k=([A-Za-z0-9_-]{40,64})/.exec(location.hash)?.[1];
  try {
    if (fromLink) localStorage.setItem(KEY_STORE, fromLink);
    webKey = localStorage.getItem(KEY_STORE);
    keyKept = !!webKey;
  } catch (_) { /* private window: the key from the link still works for this visit */ }
  webKey ??= fromLink ?? null;
  if (fromLink) history.replaceState(null, "", location.pathname + location.search);
}
// A Dock app (and a Home Screen one) starts with its own empty storage and never sees the link's «#k=»:
// so the key can also be pasted here, the whole link or the key alone.
function needKey(why) {
  try { localStorage.removeItem(KEY_STORE); } catch (_) {}
  webKey = null;
  $("view").innerHTML = `<p class="hint">${esc(why)}<br><br>Напиши боту <b>/web</b>, скопируй ссылку из ответа и вставь сюда.</p>
    <form class="keyform" id="keyForm"><input id="keyInput" type="text" autocomplete="off" placeholder="Ссылка из /web" aria-label="Ссылка из /web"><button type="submit">Войти</button></form>`;
  $("keyForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const key = /(?:k=)?([A-Za-z0-9_-]{40,64})\s*$/.exec($("keyInput").value.trim())?.[1];
    if (!key) return toast("Не вижу ключа. Вставь ссылку из ответа на /web целиком.");
    webKey = key;
    try { localStorage.setItem(KEY_STORE, key); keyKept = true; } catch (_) {}
    $("view").innerHTML = '<p class="hint">Загружаю…</p>';
    run({ op: "state" }, { quiet: true });
  });
}

let S = null; // server state
let tab = "day";
let dayIx = 0;
const open = new Set(); // expanded task numbers

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const dur = (m) => {
  const h = Math.floor(m / 60), r = m % 60;
  return [h ? `${h} ч` : "", r || !h ? `${r} мин` : ""].filter(Boolean).join(" ");
};
const TICK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';

async function call(body) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json", ...(inTelegram ? { "x-telegram-init-data": tg.initData } : webKey ? { "x-web-key": webKey } : {}) },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && !inTelegram) {
    needKey("Ссылка больше не действует.");
    throw new Error("Нужна новая ссылка: /web в чате с ботом.");
  }
  if (!res.ok) throw new Error(json.error === "unauthorized" ? "Открой мини-апп из чата с ботом." : json.error || "Не получилось, попробуй ещё раз.");
  return json;
}

let toastTimer;
function toast(text, undo) {
  const el = $("toast");
  el.innerHTML = esc(text) + (undo ? '<br><button data-act="undo">Отменить</button>' : "") + '<button data-act="hide">Скрыть</button>';
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), undo ? 9000 : 6000);
}

/** Runs an operation, shows what the planner answered and redraws from the returned state. */
async function run(body, { quiet = false } = {}) {
  document.body.classList.add("busy");
  try {
    const r = await call(body);
    if (r.state) S = r.state;
    else S = r;
    if (!quiet) tg?.HapticFeedback?.notificationOccurred("success");
    if (r.reply && !quiet) toast(r.reply, !!r.undoable);
    render();
  } catch (e) {
    tg?.HapticFeedback?.notificationOccurred("error");
    toast(e.message);
    render(); // a row ticked in advance goes back to how the server has it
  } finally {
    document.body.classList.remove("busy");
  }
}

// ---------- pieces ----------

function meta(t, { showDate = false } = {}) {
  const bits = [];
  // Only the most pressing tasks carry the word; the rest are simply higher or lower in the list.
  if (t.urgent) bits.push('<span class="hot">срочно</span>');
  if (t.waiting) bits.push(`<span class="wait">жду: ${esc(t.waiting)}</span>`);
  if (t.after) bits.push(`<span class="wait">🔒 после: ${esc(t.after)}</span>`);
  if (t.slot) bits.push(`<span class="slot">${t.slot[0]}–${t.slot[1]}</span>`);
  else if (t.time) bits.push(`<span class="slot">${t.time}</span>`);
  if (t.est) bits.push(`~${dur(t.est)}`);
  if (t.project) bits.push(esc(t.project));
  else if (t.parent) bits.push(esc(t.parent));
  if (t.deadlineLabel) bits.push(`<span class="dl">${esc(t.deadlineLabel)}</span>`);
  if (t.overdue) bits.push('<span class="late">не закрыто раньше</span>');
  if (showDate && t.date) bits.push(esc(t.date.slice(8) + "." + t.date.slice(5, 7)));
  if (t.recur) bits.push("повтор");
  if (t.steps.length) bits.push(`${t.steps.filter((s) => s.done).length}/${t.steps.length}`);
  return bits.length ? `<div class="meta">${bits.map((b) => `<span>${b}</span>`).join("")}</div>` : "";
}

function taskRow(t, where) {
  const isOpen = open.has(t.num);
  const acts = [];
  if (where !== "today") acts.push(`<button data-act="move" data-num="${t.num}" data-date="${S.today}">Сегодня</button>`);
  if (where !== "tomorrow") acts.push(`<button data-act="move" data-num="${t.num}" data-date="${S.days[1].date}">Завтра</button>`);
  if (where !== "backlog" && where !== "someday") acts.push(`<button data-act="op" data-op="undate" data-num="${t.num}">В запас</button>`);
  if (where !== "someday") acts.push(`<button data-act="op" data-op="someday" data-num="${t.num}">Когда-нибудь</button>`);
  acts.push(`<button data-act="optional" data-num="${t.num}" data-value="${t.optional ? "0" : "1"}">${t.optional ? "Обязательно" : "Необязательно"}</button>`);
  acts.push(`<button data-act="split" data-num="${t.num}">Разбить</button>`);
  acts.push(`<button class="danger" data-act="op" data-op="drop" data-num="${t.num}">Удалить</button>`);
  const steps = t.steps.length
    ? `<ul class="steps">${t.steps.map((s) => `<li class="${s.done ? "done" : ""}"><button class="check" data-act="${s.done ? "" : "done"}" data-num="${s.num}" aria-label="Готово">${TICK}</button><span>${esc(s.title)}</span></li>`).join("")}</ul>`
    : "";
  return `<div class="row task" data-num="${t.num}">
    <button class="check ${t.optional ? "opt" : ""}" data-act="done" data-num="${t.num}" aria-label="Готово">${TICK}</button>
    <div class="body" data-act="toggle" data-num="${t.num}">
      <div class="title">${esc(t.title)}</div>${meta(t, { showDate: where === "later" || where === "project" })}
      ${isOpen ? `<div class="more">${steps}${t.notes ? `<p class="note">${esc(t.notes)}</p>` : ""}<div class="acts">${acts.join("")}</div></div>` : ""}
    </div></div>`;
}

const cardOf = (rows) => (rows.length ? `<div class="card">${rows.join("")}</div>` : "");

// ---------- tabs ----------

function viewDay() {
  const d = S.days[dayIx];
  const strip = S.days.map((x, i) => {
    const [w, n] = x.sub.split(" ");
    return `<button class="chip ${i === dayIx ? "on" : ""} ${x.tasks.length ? "has" : ""}" data-act="day" data-ix="${i}">${esc(w)}<b>${esc(n)}</b><i></i></button>`;
  }).join("");
  const where = dayIx === 0 ? "today" : dayIx === 1 ? "tomorrow" : "day";
  const events = d.events.map((e) => `<div class="row event ${e.routine ? "" : "own"}"><div class="when">${e.start ? `${e.start}–${e.end}` : "весь день"}</div><div class="body"><div class="title">${esc(e.title)}</div></div></div>`);
  const timed = d.tasks.filter((t) => t.slot || t.time), loose = d.tasks.filter((t) => !t.slot && !t.time);
  const must = loose.filter((t) => !t.optional), opt = loose.filter((t) => t.optional);
  const sum = [d.loadMin ? `задач на ~${dur(d.loadMin)}` : "", S.hasWindows ? `свободно в окнах ${dur(d.freeMin)}` : ""].filter(Boolean).join(" · ");
  const over = S.hasWindows && loose.reduce((s, t) => s + (t.optional ? 0 : t.est || 30), 0) > d.freeMin;
  return `<div class="strip">${strip}</div>
    ${events.length ? `<h2>В календаре</h2>${cardOf(events)}` : ""}
    ${timed.length ? `<h2>По часам</h2>${cardOf(timed.map((t) => taskRow(t, where)))}` : ""}
    ${must.length ? `<h2>${timed.length ? "Без времени" : "Задачи"}</h2>${cardOf(must.map((t) => taskRow(t, where)))}` : ""}
    ${opt.length ? `<h2>Если останется время</h2>${cardOf(opt.map((t) => taskRow(t, where)))}` : ""}
    ${!d.tasks.length ? `<p class="hint">${d.events.length ? "Задач на этот день нет." : "На этот день ничего не стоит."}</p>` : ""}
    ${sum ? `<p class="sum">${sum}${over ? ". Не всё влезает: что-то стоит перенести." : ""}</p>` : ""}
    ${S.hasWindows ? `<button class="big ${loose.length || !d.tasks.length ? "" : "ghost"}" data-act="plan" data-date="${d.date}">${loose.length ? "Разложить по часам" : d.tasks.length ? "Разложить заново" : "Разложить из запаса"}</button>` : `<p class="sum">Чтобы раскладывать дела по часам, расскажи планеру, когда ты ими занимаешься: «днём с 12 до 17 дела, ночью с 0:30 до 2:30 приложения».</p>`}`;
}

function viewWeek() {
  const days = S.days.map((d, i) => {
    // The bar: how much of the day's room for tasks is already taken. Room = time of the tasks set for the day + what is still free in the windows.
    const cap = d.loadMin + d.freeMin;
    const pct = cap ? Math.min(100, Math.round((d.loadMin / cap) * 100)) : 0;
    const loose = d.tasks.filter((t) => !t.slot && !t.time && !t.optional).reduce((s, t) => s + (t.est || 30), 0);
    const over = S.hasWindows && loose > d.freeMin;
    const fixed = d.events.filter((e) => e.start).map((e) => `${e.start} ${esc(e.title)}`).slice(0, 3).join(" · ");
    const room = S.hasWindows ? (d.loadMin ? `занято ${dur(d.loadMin)} из ${dur(cap)}` : `свободно ${dur(d.freeMin)}`) : "";
    return `<button class="wk" data-act="day" data-ix="${i}" data-go="1">
      <div class="head"><b>${esc(d.label)}${i < 2 ? `, ${esc(d.sub)}` : ""}</b><span>${d.tasks.length ? `задач: ${d.tasks.length}` : "пусто"}</span></div>
      <div class="bar ${over ? "over" : ""}"><i style="width:${pct}%"></i></div>
      <p>${over ? "Не всё влезает в окна. " : ""}${room}${fixed ? `${room ? " · " : ""}${fixed}` : ""}</p>
    </button>`;
  }).join("");
  // Closed tasks, grouped by day: proof that the pile does move.
  const byDay = new Map();
  for (const t of S.done) byDay.set(t.label, [...(byDay.get(t.label) ?? []), t]);
  const done = [...byDay].map(([label, ts]) => `<h2>${esc(label)} <span>· ${ts.length}</span></h2><div class="card">${ts.map((t) =>
    `<div class="row done"><span class="check">${TICK}</span><div class="body"><div class="title">${esc(t.title)}</div>${t.project ? `<div class="meta"><span>${esc(t.project)}</span></div>` : ""}</div><button class="back" data-act="op" data-op="reopen" data-num="${t.num}">Вернуть</button></div>`).join("")}</div>`).join("");
  return `<p class="sum">Полоска показывает, сколько времени под дела в этом дне уже занято задачами. Оранжевая: не влезает.</p>${days}
    ${waiting(S.later)}
    ${S.done.length ? `<h2 class="sep">Сделано за две недели <span>· ${S.done.length}</span></h2>${done}` : ""}`;
}

/** Tasks that cannot be started before their date: out of the way, one line that opens. */
let showLater = false, showBlocked = false;
function waiting(tasks) {
  if (!tasks.length) return "";
  const sorted = [...tasks].sort((a, b) => a.date.localeCompare(b.date));
  return `<h2>Ждут своей даты <span>· ${tasks.length}</span></h2>${showLater ? cardOf(sorted.map((t) => taskRow(t, "later"))) : ""}
    <button class="big ghost" data-act="later">${showLater ? "Свернуть" : `Показать (ближайшая ${sorted[0].date.slice(8)}.${sorted[0].date.slice(5, 7)})`}</button>`;
}

/** Hidden until another task is closed: collapsed, like what waits for its date. */
function blockedList(tasks) {
  if (!tasks.length) return "";
  return `<h2>Ждут другую задачу <span>· ${tasks.length}</span></h2>${showBlocked ? cardOf(tasks.map((t) => taskRow(t, "later"))) : ""}
    <button class="big ghost" data-act="blocked">${showBlocked ? "Свернуть" : "Показать"}</button>`;
}

function viewBacklog() {
  if (!S.backlog.length && !S.someday.length && !S.later.length && !(S.blocked ?? []).length) return '<p class="hint">Запас пуст: всё либо стоит на днях, либо сделано.</p>';
  const groups = new Map();
  for (const t of S.backlog) groups.set(t.project ?? "", [...(groups.get(t.project ?? "") ?? []), t]);
  const urgent = S.backlog.filter((t) => t.deadline);
  const total = S.backlog.reduce((s, t) => s + (t.est || 30), 0);
  const order = [...groups.keys()].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : groups.get(b).length - groups.get(a).length));
  return `${S.backlog.length ? `<p class="sum">Без дня: ${S.backlog.length}, примерно ${dur(total)} работы. Это ${Math.max(1, Math.round(total / 240))} дн. твоих окон, не бесконечность.</p>` : ""}
    ${urgent.length ? `<h2>Со сроком</h2>${cardOf(urgent.map((t) => taskRow(t, "backlog")))}` : ""}
    ${order.map((p) => `<h2>${p ? esc(p) : "Без проекта"} <span>· ${groups.get(p).filter((t) => !t.deadline).length}</span></h2>${cardOf(groups.get(p).filter((t) => !t.deadline).map((t) => taskRow(t, "backlog")))}`).join("")}
    ${waiting(S.later)}
    ${blockedList(S.blocked ?? [])}
    ${S.someday.length ? `<h2>Когда-нибудь <span>· ${S.someday.length}</span></h2>${cardOf(S.someday.map((t) => taskRow(t, "someday")))}` : ""}`;
}

/** Remembered facts as an editable list: ✕ forgets one, the field below adds one. `project` = its number, "" = about the person. */
function noteList(notes, project) {
  return `<div class="card">${notes.map((n) => `<div class="mem note"><span>${esc(n.text)}</span><button data-act="note-del" data-num="${n.num}" aria-label="Забыть">✕</button></div>`).join("")}
    <div class="mem note add"><input type="text" placeholder="Добавить факт…" data-note-for="${project}" enterkeyhint="done"><button data-act="note-add" aria-label="Добавить">＋</button></div></div>`;
}

const STAGE_RU = { idle: "на паузе", launch: "запуск", rhythm: "идёт" };
const trackRow = (t) => `<button class="mem track tap" style="padding-left:${12 + t.depth * 16}px" data-act="track" data-num="${t.num}">
  <div><b>${esc(t.title)}</b>${t.project ? ` <small>${esc(t.project)}</small>` : ""}<p>${esc(t.status)}${t.tasks ? ` · задач: ${t.tasks}` : ""}</p></div><span class="chev">›</span></button>`;

function viewMemory() {
  const fixed = S.routines.filter((r) => r.kind === "fixed"), win = S.routines.filter((r) => r.kind === "window");
  const rt = (r) => `<button class="mem tap" data-act="routine" data-num="${r.num}"><div><b>${esc(r.title)}</b> <small>${r.start}–${r.end} · ${esc(r.days)}${r.skips.length ? ` · кроме ${r.skips.map((d) => `${d.slice(8)}.${d.slice(5, 7)}`).join(", ")}` : ""}</small>${r.hint ? `<p>${esc(r.hint)}</p>` : ""}</div><span class="chev">›</span></button>`;
  const pr = S.projects.filter((p) => p.open || p.notes.length || p.about);
  // Directions talk through the chat; here they are one line that opens on demand.
  const tracks = S.tracks.length
    ? `<h2>Направления <span>· ${S.tracks.length}</span></h2>${showTracks ? `<div class="card">${S.tracks.map(trackRow).join("")}</div>` : ""}
       <button class="big ghost" data-act="tracks">${showTracks ? "Свернуть" : "Показать и настроить"}</button>`
    : "";
  return `<h2>Расписание</h2>
    ${fixed.length ? `<div class="card">${fixed.map(rt).join("")}</div>` : ""}
    ${win.length ? `<h2>Окна для дел</h2><div class="card">${win.map(rt).join("")}</div>` : ""}
    <button class="big ghost" data-act="routine" data-num="">＋ Добавить в расписание</button>
    ${tracks}
    <h2>Про тебя</h2>${noteList(S.about, "")}
    <h2>Проекты <span>· ${pr.length}</span></h2>
    <div class="card">${pr.map((p) => `<button class="mem tap" data-act="proj" data-name="${esc(p.name)}" data-gear="1"><div><b>${esc(p.name)}</b> <small>${[p.open ? `задач: ${p.open}` : "", p.notes.length ? `фактов: ${p.notes.length}` : ""].filter(Boolean).join(" · ")}</small>${p.about ? `<p>${esc(p.about)}</p>` : ""}</div><span class="chev">›</span></button>`).join("")}</div>
    <p class="sum">Тап по проекту открывает его настройки: направления и то, что я о нём помню.</p>`;
}

// ---------- projects: pick one, work inside it ----------

let showTracks = false; // the full list of directions in «Память» is folded by default
let gear = false; // settings of the open project (its directions and what is remembered)
let proj = null; // name of the open project ("" = tasks without a project), null = the picker
let pview = "a";
try { pview = localStorage.getItem("pview") || "a"; } catch (_) { /* private mode: the default stays */ }
const hue = (name) => [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

function allTasks() {
  const seen = new Set();
  return [...S.days.flatMap((d) => d.tasks), ...S.backlog, ...S.later, ...(S.blocked ?? [])].filter((t) => !seen.has(t.num) && seen.add(t.num));
}

/** Directions of a project: its top-level ones with everything nested under them. */
function tracksOf(name) {
  const out = [];
  let inside = false;
  for (const t of S.tracks) {
    if (t.depth === 0) inside = (t.project ?? "") === name;
    if (inside) out.push(t);
  }
  return out;
}

function projectList() {
  const by = new Map();
  for (const t of allTasks()) by.set(t.project ?? "", [...(by.get(t.project ?? "") ?? []), t]);
  const horizon = S.days[S.days.length - 1].date;
  const names = new Set([...by.keys(), ...S.tracks.filter((t) => t.depth === 0 && t.project).map((t) => t.project)]);
  return [...names].map((name) => {
    const tasks = by.get(name) ?? [];
    // Dated beyond the week in view: waiting for its date, not something to pick up now.
    const wait = tasks.filter((t) => t.after || (t.date && t.date > horizon)), ready = tasks.filter((t) => !wait.includes(t));
    const dls = tasks.filter((t) => t.deadline).sort((a, b) => a.deadline.localeCompare(b.deadline));
    return {
      name, tasks, ready, wait: wait.length, min: ready.reduce((s, t) => s + (t.est || 30), 0), today: tasks.filter((t) => t.date && t.date <= S.today).length,
      deadline: dls[0]?.deadlineLabel ?? null, tracks: tracksOf(name).length,
    };
  }).sort((a, b) => (a.name === "" ? 1 : b.name === "" ? -1 : b.ready.length - a.ready.length || b.wait - a.wait));
}

function viewProjects() {
  if (proj !== null) return viewProject(proj);
  const list = projectList();
  if (!list.length) return '<p class="hint">Проектов с задачами пока нет.</p>';
  const title = (p) => esc(p.name || "Без проекта");
  const load = (p) => [p.ready.length ? `~${dur(p.min)}` : p.wait ? "" : "нет задач", p.wait ? `ждут: ${p.wait}` : ""].filter(Boolean);
  const count = (p) => `${load(p).join(" · ")}${p.tracks ? ` · направлений ${p.tracks}` : ""}`;
  const max = Math.max(...list.map((p) => p.min), 1);
  const body = {
    // A: a grid of cards, the number of tasks large.
    a: () => `<div class="pgrid">${list.map((p) => `<button class="pcard" style="--h:${hue(p.name)}" data-act="proj" data-name="${esc(p.name)}">
        <b>${title(p)}</b><div class="n"><strong>${p.ready.length}</strong>${load(p).join("<br>")}${p.deadline ? `<br><span class="dl">${esc(p.deadline)}</span>` : ""}</div></button>`).join("")}</div>`,
    // B: rows with a bar of how heavy the project is next to the others, and what comes first in it.
    b: () => list.map((p) => `<button class="prow" style="--h:${hue(p.name)}" data-act="proj" data-name="${esc(p.name)}">
        <div class="head"><b>${title(p)}</b><span>${p.ready.length} · ${count(p)}</span></div>
        <div class="bar"><i style="width:${Math.round((p.min / max) * 100)}%"></i></div>
        <p>${p.deadline ? `${esc(p.deadline)} · ` : ""}${p.ready[0] ? esc(p.ready[0].title) : "задач на сейчас нет"}</p></button>`).join(""),
    // C: big tiles with the first three tasks visible.
    c: () => list.map((p) => `<button class="ptile" style="--h:${hue(p.name)}" data-act="proj" data-name="${esc(p.name)}">
        <div class="head"><b>${title(p)}</b><span>${p.ready.length} · ${count(p)}</span></div>
        <ul>${p.ready.slice(0, 3).map((t) => `<li>${esc(t.title)}</li>`).join("")}</ul>
        ${p.deadline ? `<span class="dl">${esc(p.deadline)}</span>` : ""}</button>`).join(""),
  }[pview]();
  return `<p class="sum">Выбери проект, которым займёшься сейчас.</p>${body}
    <div class="vsw">Вид: ${["a", "b", "c"].map((v) => `<button class="${v === pview ? "on" : ""}" data-act="pview" data-v="${v}">${v.toUpperCase()}</button>`).join("")}</div>`;
}

function viewProject(name) {
  const p = projectList().find((x) => x.name === name);
  const info = S.projects.find((x) => x.name === name);
  const tasks = p?.tasks ?? [];
  const tracks = tracksOf(name);
  // What is being launched comes first, as "what is left before it is live".
  const launches = tracks.filter((t) => t.stage === "launch").map((t) => ({ t, left: (p?.tasks ?? []).filter((x) => x.parent === t.title) }));
  const inLaunch = new Set(launches.flatMap((l) => l.left.map((x) => x.num)));
  const horizon = S.days[S.days.length - 1].date; // the week in view; beyond it a dated task is waiting, not planned
  const held = tasks.filter((t) => t.after && !inLaunch.has(t.num));
  const far = tasks.filter((t) => !t.after && t.date && t.date > horizon);
  const near = tasks.filter((t) => !far.includes(t) && !held.includes(t) && !inLaunch.has(t.num));
  const dl = near.filter((t) => t.deadline), dated = near.filter((t) => !t.deadline && t.date), rest = near.filter((t) => !t.deadline && !t.date);
  const settings = `<h2>Направления</h2>${tracks.length ? `<div class="card">${tracks.map(trackRow).join("")}</div>` : ""}
    <p class="sum">Новое: напиши внизу «в ${esc(name || "…")} направление …». Тап по направлению: пауза, запуск, как часто.</p>
    ${info ? `<h2>Помню о проекте</h2>${noteList(info.notes, info.num)}` : ""}`;
  return `<div class="phead"><button data-act="proj-back">‹ Проекты</button><h1>${esc(name || "Без проекта")}</h1>
      <button class="gear ${gear ? "on" : ""}" data-act="gear" aria-label="Настройки проекта">⚙</button></div>
    ${info?.about ? `<p class="pabout">${esc(info.about)}</p>` : ""}
    ${gear ? settings : `
    ${tasks.length && S.hasWindows ? `<button class="big" data-act="take" data-name="${esc(name)}">Взять в работу сегодня</button>` : ""}
    ${launches.map((l) => `<h2>Запуск: ${esc(l.t.title)} <span>· ${l.left.length ? `осталось ${l.left.length}` : "шагов нет"}</span></h2>${l.left.length ? cardOf(l.left.map((t) => taskRow(t, "project"))) : '<p class="sum">Всё закрыто или шаги ещё не записаны. Запущено? Тап по шестерёнке → направление → «Идёт».</p>'}`).join("")}
    ${dl.length ? `<h2>Со сроком</h2>${cardOf(dl.map((t) => taskRow(t, "project")))}` : ""}
    ${dated.length ? `<h2>Стоят на днях</h2>${cardOf(dated.map((t) => taskRow(t, "project")))}` : ""}
    ${rest.length ? `<h2>Запас <span>· ${rest.length}</span></h2>${cardOf(rest.map((t) => taskRow(t, "project")))}` : ""}
    ${waiting(far)}
    ${blockedList(held)}
    ${!tasks.length ? '<p class="hint">Открытых задач нет. Добавь внизу: «' + esc(name) + ': …».</p>' : ""}`}`;
}

// ---------- overview (browser only): four weeks of work at a glance ----------

const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const shortDay = (d) => { const x = new Date(`${d}T12:00:00Z`); return `${WD[x.getUTCDay()]} ${x.getUTCDate()}.${String(x.getUTCMonth() + 1).padStart(2, "0")}`; };
const addD = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const hours = (m) => (m >= 60 ? `${Math.round(m / 6) / 10} ч`.replace(".", ",") : `${m} мин`);

function viewStats() {
  if (!S.stats) return '<p class="hint">Обнови страницу: нужна свежая версия планера.</p>';
  const { days, projects } = S.stats;
  const last7 = days.slice(-7), last14 = days.slice(-14);
  const sum = (xs, k) => xs.reduce((s, d) => s + d[k], 0);
  // Days in a row with something closed, counting back from today (today may still be empty: then from yesterday).
  let streak = 0;
  for (let i = days.length - 1 - (days.at(-1).closed ? 0 : 1); i >= 0 && days[i].closed; i--) streak++;
  const net = sum(last14, "created") - sum(last14, "closed");
  const tiles = `<div class="tiles">
      <div class="tile"><b>${sum(last7, "closed")}</b><span>закрыто за 7 дней</span><small>около ${hours(sum(last7, "minutes"))} работы</small></div>
      <div class="tile"><b>${streak}${streak >= days.length ? "+" : ""}</b><span>${streak === 1 ? "день" : streak > 1 && streak < 5 ? "дня" : "дней"} подряд</span><small>с хотя бы одним закрытым делом${streak >= days.length ? ", считаю за 4 недели" : ""}</small></div>
      <div class="tile"><b>${net > 0 ? "+" : ""}${net}</b><span>запас за 14 дней</span><small>пришло ${sum(last14, "created")}, закрыто ${sum(last14, "closed")}</small></div>
    </div>`;

  // Heatmap: weeks as rows from Monday, the minutes of the day as one blue from light to dark.
  const step = (m) => (m <= 0 ? 0 : m <= 60 ? 1 : m <= 120 ? 2 : m <= 240 ? 3 : m <= 360 ? 4 : 5);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const lead = (new Date(`${days[0].date}T12:00:00Z`).getUTCDay() + 6) % 7;
  const cells = [];
  for (let i = -lead; i < days.length || (i + lead) % 7; i++) {
    const date = addD(days[0].date, i), d = byDate.get(date);
    if (!d || date > S.today) { cells.push('<span class="hm none"></span>'); continue; }
    const tip = `${shortDay(date)} · закрыто ${d.closed}${d.minutes ? ` · ~${hours(d.minutes)}` : ""}`;
    cells.push(`<span class="hm s${step(d.minutes)}${date === S.today ? " today" : ""}" data-tip="${esc(tip)}"></span>`);
  }
  const heat = `<section class="viz"><h2>Четыре недели <span>· время на закрытые дела по дням</span></h2>
      <div class="hmgrid">${["пн", "вт", "ср", "чт", "пт", "сб", "вс"].map((w) => `<i>${w}</i>`).join("")}${cells.join("")}</div>
      <div class="hmkey">меньше ${[0, 1, 2, 3, 4, 5].map((s) => `<span class="hm s${s}"></span>`).join("")} больше <span class="muted">· шаги: до 1 ч, 2 ч, 4 ч, 6 ч, больше</span></div>
    </section>`;

  // Where the time went: this week as bars, last week as a tick on the same scale.
  const top = projects.slice(0, 8), rest = projects.slice(8);
  if (rest.length) top.push({ name: "Остальное", week: sum(rest, "week"), prev: sum(rest, "prev") });
  const pmax = Math.max(1, ...top.map((p) => Math.max(p.week, p.prev)));
  const bars = top.length ? top.map((p) => `<div class="pbar" data-tip="${esc(`${p.name || "Без проекта"}: эта неделя ~${hours(p.week)}, прошлая ~${hours(p.prev)}`)}">
      <span class="pname">${esc(p.name || "Без проекта")}</span>
      <span class="ptrack"><i style="width:${(p.week / pmax) * 100}%"></i>${p.prev ? `<em style="left:${(p.prev / pmax) * 100}%"></em>` : ""}</span>
      <span class="pval">${p.week ? `~${hours(p.week)}` : "—"}</span></div>`).join("")
    : '<p class="hint">Пока нечего показать.</p>';
  const time = `<section class="viz"><h2>Куда ушло время <span>· последние 7 дней по проектам</span></h2>${bars}
      <div class="vkey"><span><i class="sw week"></i>эти 7 дней</span><span><i class="sw prev"></i>7 дней до них</span></div></section>`;

  // Inflow and outflow: new tasks above the line, closed below. More above than below means the pile grows.
  const fmax = Math.max(1, ...last14.map((d) => Math.max(d.created, d.closed)));
  const cols = last14.map((d) => `<div class="fcol${d.date === S.today ? " today" : ""}" data-tip="${esc(`${shortDay(d.date)}: пришло ${d.created}, закрыто ${d.closed}`)}">
      <div class="up"><i style="height:${(d.created / fmax) * 100}%"></i></div>
      <div class="down"><i style="height:${(d.closed / fmax) * 100}%"></i></div>
      <small>${new Date(`${d.date}T12:00:00Z`).getUTCDate()}</small></div>`).join("");
  const flow = `<section class="viz"><h2>Приток и отток <span>· две недели, задачи в штуках</span></h2>
      <div class="flow">${cols}</div>
      <div class="vkey"><span><i class="sw created"></i>пришло новых (вверх)</span><span><i class="sw closed"></i>закрыто (вниз)</span></div>
      <p class="sum">${net > 0 ? `За две недели пришло на ${net} больше, чем закрыто: запас растёт.` : net < 0 ? `За две недели закрыто на ${-net} больше, чем пришло: запас тает.` : "За две недели пришло столько же, сколько закрыто."}</p></section>`;

  return `<div class="stats">${tiles}${heat}<div class="vrow">${time}${flow}</div></div>`;
}

// One tooltip for every chart mark that carries data-tip.
const vtip = Object.assign(document.createElement("div"), { className: "vtip", hidden: true });
document.body.append(vtip);
document.addEventListener("mouseover", (e) => {
  const el = e.target.closest?.("[data-tip]");
  if (!el) return void (vtip.hidden = true);
  vtip.textContent = el.dataset.tip;
  vtip.hidden = false;
});
document.addEventListener("mousemove", (e) => {
  if (vtip.hidden) return;
  const x = Math.min(e.clientX + 14, innerWidth - vtip.offsetWidth - 8);
  vtip.style.transform = `translate(${x}px, ${e.clientY + 16}px)`;
});

function render() {
  if (!S) return;
  document.querySelectorAll("#seg button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  $("view").innerHTML = { day: viewDay, week: viewWeek, projects: viewProjects, backlog: viewBacklog, memory: viewMemory, stats: viewStats }[tab]();
}

// ---------- events ----------

document.addEventListener("click", (e) => {
  const tabBtn = e.target.closest("#seg button");
  if (tabBtn) {
    tab = tabBtn.dataset.tab;
    tg?.HapticFeedback?.selectionChanged();
    return render();
  }
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const { act, num, op, date, ix } = el.dataset;
  if (act === "hide") return void ($("toast").hidden = true);
  if (act === "undo") return void run({ op: "undo" });
  if (act === "redo") return void run({ op: "say", text: "отмени отмену" });
  if (act === "note-del") return void run({ op: "note_del", num: Number(num) });
  if (act === "note-add") {
    const input = el.previousElementSibling;
    const text = input?.value.trim();
    if (!text) return void input?.focus();
    return void run({ op: "note_add", text, project: input.dataset.noteFor ? Number(input.dataset.noteFor) : null });
  }
  if (act === "routine") return openRoutineSheet(num ? Number(num) : null);
  if (act === "track") return openTrackSheet(Number(num));
  if (act === "proj") {
    proj = el.dataset.name;
    gear = !!el.dataset.gear;
    if (gear) tab = "projects";
    window.scrollTo(0, 0);
    return render();
  }
  if (act === "later") {
    showLater = !showLater;
    return render();
  }
  if (act === "blocked") {
    showBlocked = !showBlocked;
    return render();
  }
  if (act === "tracks") {
    showTracks = !showTracks;
    return render();
  }
  if (act === "gear") {
    gear = !gear;
    return render();
  }
  if (act === "close-track") return void run({ op: "say", text: `закрой направление ${num} «${el.dataset.title}»` });
  if (act === "proj-back") {
    proj = null;
    gear = false;
    return render();
  }
  if (act === "pview") {
    pview = el.dataset.v;
    try { localStorage.setItem("pview", pview); } catch (_) { /* not kept between visits, that is all */ }
    return render();
  }
  // "Take it today": the planner picks from this project only and puts the tasks on the clock.
  if (act === "take") return void run({ op: "say", text: el.dataset.name ? `распланируй сегодня, бери только задачи проекта ${el.dataset.name}` : "распланируй сегодня, бери только задачи без проекта" });
  if (act === "day") {
    dayIx = Number(ix);
    if (el.dataset.go) tab = "day";
    return render();
  }
  if (act === "toggle") {
    // A tap on a button inside the expanded part is handled by that button.
    if (e.target.closest(".more")) return;
    open.has(Number(num)) ? open.delete(Number(num)) : open.add(Number(num));
    return render();
  }
  if (act === "done") {
    el.closest(".row, li")?.classList.add("done");
    return void run({ op: "done", num: Number(num) });
  }
  if (act === "op") return void run({ op, num: Number(num) });
  if (act === "move") return void run({ op: "move", num: Number(num), date });
  if (act === "optional") return void run({ op: "optional", num: Number(num), value: el.dataset.value === "1" });
  if (act === "split") return void run({ op: "say", text: `разбей ${num} на шаги` });
  if (act === "plan") return void run({ op: "say", text: `распланируй день ${date}` });
});

// ---------- long press on a task: put it on a day ----------

const HOLD_MS = 450;
let hold = null; // { timer, x, y, row }
let swallowClick = false; // the click that ends a long press must not also expand the row

function findTask(num) {
  const all = [...S.days.flatMap((d) => d.tasks), ...S.backlog, ...S.later, ...S.someday, ...(S.blocked ?? [])];
  return all.find((t) => t.num === num) ?? all.flatMap((t) => t.steps.map((s) => ({ ...s, steps: [] }))).find((s) => s.num === num);
}

function closeSheet() {
  $("sheet").hidden = true;
  $("veil").hidden = true;
}

function openSheet(num) {
  const t = findTask(num);
  if (!t) return;
  const day = (i) => S.days[i];
  // The next few days by name, then any date from the system picker.
  const quick = [0, 1, 2, 3].map((i) => `<button data-sheet="move" data-date="${day(i).date}">${esc(day(i).label)}${day(i).label === day(i).sub ? "" : `<small>${esc(day(i).sub)}</small>`}</button>`).join("");
  $("sheet").innerHTML = `<h3>${esc(t.title)}</h3>
    <div class="grid">${quick}
      ${MOUSE ? '<button class="wide" data-sheet="calendar">На дату…<small>до этого дня скрыта</small></button>'
        : `<label class="wide">На дату…<small>до этого дня скрыта</small><input type="date" id="sheetDate" min="${S.today}" value="${t.date && t.date >= S.today ? t.date : S.today}"></label>`}
      ${t.date ? '<button class="wide" data-sheet="undate">Убрать с дня<small>вернуть в запас</small></button>' : ""}
      <button class="wide" data-sheet="urgencies">Срочность…<small>${t.pin === 1 ? "срочно (поставил сам)" : t.pin === -1 ? "может подождать (поставил сам)" : t.urgent ? "срочно (посчитано)" : "считается автоматически"}</small></button>
      <button class="wide" data-sheet="estimates">Время на задачу…<small>${t.est ? `сейчас ~${dur(t.est)}` : "оценки нет"}</small></button>
      <button class="wide" data-sheet="projects">В другой проект…<small>${t.project ? `сейчас: ${esc(t.project)}` : "сейчас без проекта"}</small></button>
      <button class="wide cancel" data-sheet="close">Отмена</button>
    </div>`;
  $("sheet").dataset.num = num;
  $("sheet").hidden = false;
  $("veil").hidden = false;
  $("sheetDate")?.addEventListener("change", (e) => {
    if (!e.target.value) return;
    closeSheet();
    run({ op: "move", num, date: e.target.value });
  });
}

const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

/**
 * Second page of the sheet with a mouse: a month of big day buttons. The system date field is a tiny popup on a
 * desktop; on a phone it is a good wheel, so phones keep it. `month` is YYYY-MM, by default the task's or today's.
 */
function openCalendarSheet(num, month) {
  const t = findTask(num);
  if (!t) return;
  const picked = t.date && t.date >= S.today ? t.date : null;
  month ??= (picked ?? S.today).slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const shift = (k) => new Date(Date.UTC(y, m - 1 + k, 1)).toISOString().slice(0, 7);
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // weeks start on Monday
  const length = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const busy = new Map(S.days.map((d) => [d.date, d.tasks.length]));
  const cells = Array.from({ length }, (_, i) => {
    const d = `${month}-${String(i + 1).padStart(2, "0")}`;
    if (d < S.today) return `<span class="past">${i + 1}</span>`;
    const n = busy.get(d);
    return `<button data-sheet="move" data-date="${d}" class="${d === S.today ? "today" : ""} ${d === picked ? "on" : ""}" title="${n ? `задач: ${n}` : ""}">${i + 1}${n ? "<em></em>" : ""}</button>`;
  });
  $("sheet").innerHTML = `<h3>${esc(t.title)}</h3>
    <div class="calhead">
      ${shift(-1) >= S.today.slice(0, 7) ? `<button data-sheet="calmonth" data-m="${shift(-1)}" aria-label="Предыдущий месяц">‹</button>` : '<span class="calpad"></span>'}
      <b>${MONTHS[m - 1]} ${y}</b>
      <button data-sheet="calmonth" data-m="${shift(1)}" aria-label="Следующий месяц">›</button>
    </div>
    <div class="calgrid">${["пн", "вт", "ср", "чт", "пт", "сб", "вс"].map((w) => `<i>${w}</i>`).join("")}${"<span></span>".repeat(lead)}${cells.join("")}</div>
    <div class="grid"><button class="wide cancel" data-sheet="calback">Назад</button></div>`;
  $("sheet").dataset.num = num;
}

/** Second page of the sheet: which project the task belongs to. Projects in use come first. */
function openProjectSheet(num) {
  const t = findTask(num);
  if (!t) return;
  const list = [...S.projects].sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));
  $("sheet").innerHTML = `<h3>${esc(t.title)}</h3>
    <div class="plist">${list.map((p) => `<button data-sheet="project" data-project="${p.num}" class="${p.name === t.project ? "on" : ""}">${esc(p.name)}${p.open ? `<small>задач: ${p.open}</small>` : ""}</button>`).join("")}
      ${t.project ? '<button data-sheet="project" data-project="">Без проекта</button>' : ""}</div>
    <div class="grid"><button class="wide cancel" data-sheet="close">Отмена</button></div>`;
  $("sheet").dataset.num = num;
  $("sheet").hidden = false;
  $("veil").hidden = false;
}

// ---------- editing the schedule and the directions ----------

const DAYS = [["mon", "пн"], ["tue", "вт"], ["wed", "ср"], ["thu", "чт"], ["fri", "пт"], ["sat", "сб"], ["sun", "вс"]];
let rdraft = null; // the routine being edited: { num, title, kind, days: Set, start, end, hint }

const ruleToDays = (rule) => new Set(rule === "daily" ? DAYS.map((d) => d[0]) : rule === "weekdays" ? DAYS.slice(0, 5).map((d) => d[0]) : rule.slice(7).split(","));
const daysToRule = (set) => {
  const list = DAYS.map((d) => d[0]).filter((d) => set.has(d));
  return list.length === 7 ? "daily" : list.join() === "mon,tue,wed,thu,fri" ? "weekdays" : list.length ? `weekly:${list.join(",")}` : null;
};

/** What is typed in the sheet goes into the draft before the sheet is redrawn or saved. */
function readRoutineInputs() {
  if (!rdraft || !$("rTitle")) return;
  Object.assign(rdraft, { title: $("rTitle").value.trim(), start: $("rStart").value, end: $("rEnd").value, hint: $("rHint")?.value.trim() ?? rdraft.hint });
}

function openRoutineSheet(num, keep = false) {
  if (!keep) {
    const r = num ? S.routines.find((x) => x.num === num) : null;
    rdraft = r ? { num, title: r.title, kind: r.kind, days: ruleToDays(r.rule), start: r.start, end: r.end, hint: r.hint ?? "" }
      : { num: null, title: "", kind: "fixed", days: new Set(DAYS.map((d) => d[0])), start: "12:00", end: "13:00", hint: "" };
  }
  const d = rdraft;
  $("sheet").innerHTML = `<h3>${d.num ? "Пункт расписания" : "Новый пункт расписания"}</h3>
    <input class="field" id="rTitle" type="text" placeholder="Название: зал, съёмка, французский" value="${esc(d.title)}">
    <div class="grid">
      <button data-sheet="rkind" data-v="fixed" class="${d.kind === "fixed" ? "on" : ""}">Постоянное<small>стоит в календаре</small></button>
      <button data-sheet="rkind" data-v="window" class="${d.kind === "window" ? "on" : ""}">Окно для дел<small>сюда встают задачи</small></button>
    </div>
    <div class="days">${DAYS.map(([k, l]) => `<button data-sheet="rday" data-v="${k}" class="${d.days.has(k) ? "on" : ""}">${l}</button>`).join("")}</div>
    <div class="times"><label>с<input id="rStart" type="time" value="${d.start}"></label><label>до<input id="rEnd" type="time" value="${d.end}"></label></div>
    ${d.kind === "window" ? `<input class="field" id="rHint" type="text" placeholder="Что сюда ставить: люди и созвоны, работа головой" value="${esc(d.hint)}">` : ""}
    <div class="grid">
      <button class="wide go" data-sheet="rsave">Сохранить</button>
      ${d.num ? '<button class="wide danger" data-sheet="rdel">Убрать из расписания</button>' : ""}
      <button class="wide cancel" data-sheet="close">Отмена</button></div>`;
  $("sheet").dataset.num = d.num ?? "";
  $("sheet").hidden = false;
  $("veil").hidden = false;
}

function openTrackSheet(num) {
  const t = S.tracks.find((x) => x.num === num);
  if (!t) return;
  const often = t.aim ? (t.aim >= 7 ? "каждый день" : t.aim === 1 ? "раз в неделю" : `${t.aim} ${t.aim < 5 ? "раза" : "раз"} в неделю`) : "не задано";
  $("sheet").innerHTML = `<h3>${esc(t.title)}</h3><p class="note">${esc(t.status)}</p>
    <div class="grid three">${["rhythm", "launch", "idle"].map((st) => `<button data-sheet="tstage" data-v="${st}" class="${t.stage === st ? "on" : ""}">${st === "rhythm" ? "Идёт" : st === "launch" ? "Запуск" : "Пауза"}</button>`).join("")}</div>
    <div class="dial"><button data-sheet="trh" data-v="${Math.max(1, (t.aim ?? 1) - 1)}" ${t.aim && t.aim > 1 ? "" : "disabled"}>−</button><b>${often}</b><button data-sheet="trh" data-v="${Math.min(7, (t.aim ?? 0) + 1)}">+</button></div>
    <p class="note">На паузе планер о направлении молчит. В запуске ведёт по шагам и напоминает чаще. «Идёт»: предлагает шаг, когда давно не было движения.</p>
    <div class="grid">
      <button class="wide danger" data-sheet="tclose" data-title="${esc(t.title)}">Закрыть направление</button>
      <button class="wide cancel" data-sheet="close">Отмена</button></div>`;
  $("sheet").dataset.num = num;
  $("sheet").hidden = false;
  $("veil").hidden = false;
}

/** Second page of the sheet: the person's own word on how pressing the task is. */
function openUrgencySheet(num) {
  const t = findTask(num);
  if (!t) return;
  const opt = (value, label, hint, on) => `<button class="wide ${on ? "on" : ""}" data-sheet="urgency" data-value="${value}">${label}<small>${hint}</small></button>`;
  $("sheet").innerHTML = `<h3>${esc(t.title)}</h3>
    <div class="grid">
      ${opt("urgent", "Срочно", "наверх списка, с меткой", t.pin === 1)}
      ${opt("later", "Может подождать", "вниз списка", t.pin === -1)}
      ${opt("auto", "Авто", "по сроку, переносам и словам в задаче", !t.pin)}
      <button class="wide cancel" data-sheet="close">Отмена</button></div>`;
  $("sheet").dataset.num = num;
  $("sheet").hidden = false;
  $("veil").hidden = false;
}

/** Second page of the sheet: how long the task should take. Ready values, or any figure dialled in by hand. */
let estDraft = 30;
function openEstimateSheet(num, keep = false) {
  const t = findTask(num);
  if (!t) return;
  if (!keep) estDraft = t.est || 30;
  const steps = (t.steps ?? []).some((x) => !x.done);
  $("sheet").innerHTML = `<h3>${esc(t.title)}</h3>
    <div class="grid three">${[10, 15, 30, 45, 60, 90, 120, 180, 240].map((m) => `<button data-sheet="estimate" data-min="${m}" class="${t.est === m ? "on" : ""}">${dur(m)}</button>`).join("")}</div>
    <div class="dial">
      <button data-sheet="dial" data-d="-15">−15</button><button data-sheet="dial" data-d="-5">−5</button>
      <b>${dur(estDraft)}</b>
      <button data-sheet="dial" data-d="5">+5</button><button data-sheet="dial" data-d="15">+15</button>
    </div>
    <div class="grid">
      <button class="wide go" data-sheet="estimate" data-min="${estDraft}">Поставить ${dur(estDraft)}</button>
      ${steps ? '<p class="wide note">У задачи есть шаги: если время стоит у каждого шага, показывается их сумма.</p>' : ""}
      <button class="wide cancel" data-sheet="close">Отмена</button></div>`;
  $("sheet").dataset.num = num;
  $("sheet").hidden = false;
  $("veil").hidden = false;
}

function dropHold() {
  if (!hold) return;
  clearTimeout(hold.timer);
  hold.row.classList.remove("held");
  hold = null;
}

document.addEventListener("pointerdown", (e) => {
  const row = e.target.closest(".row.task");
  // Not on the checkbox, and not inside the expanded part with its own buttons.
  if (!row || e.target.closest(".check, .more") || !S) return;
  dropHold();
  hold = { x: e.clientX, y: e.clientY, row, timer: setTimeout(() => {
    const num = Number(row.dataset.num);
    dropHold();
    swallowClick = true;
    tg?.HapticFeedback?.impactOccurred("medium");
    openSheet(num);
  }, HOLD_MS) };
  row.classList.add("held");
});
// A finger that moves is scrolling, not holding.
document.addEventListener("pointermove", (e) => {
  if (hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 10) dropHold();
});
for (const ev of ["pointerup", "pointercancel", "scroll"]) document.addEventListener(ev, dropHold, true);
// With a mouse a right click opens the same menu as holding a finger on the task.
const MOUSE = matchMedia("(pointer: fine)").matches;
document.addEventListener("contextmenu", (e) => {
  const row = e.target.closest(".row.task");
  if (!row) return;
  e.preventDefault();
  if (MOUSE && S && $("sheet").hidden && !e.target.closest(".check, .more")) {
    dropHold();
    openSheet(Number(row.dataset.num));
  }
});
document.addEventListener("click", (e) => {
  if (swallowClick) {
    swallowClick = false;
    if (!e.target.closest("#sheet, #veil")) {
      e.stopPropagation();
      e.preventDefault();
      return;
    }
  }
  if (e.target.id === "veil") return closeSheet();
  const b = e.target.closest("[data-sheet]");
  if (!b) return;
  const num = Number($("sheet").dataset.num);
  // The schedule sheet keeps open while it is being filled in.
  if (b.dataset.sheet === "rkind" || b.dataset.sheet === "rday") {
    readRoutineInputs();
    if (b.dataset.sheet === "rkind") rdraft.kind = b.dataset.v;
    else rdraft.days.has(b.dataset.v) ? rdraft.days.delete(b.dataset.v) : rdraft.days.add(b.dataset.v);
    return openRoutineSheet(rdraft.num, true);
  }
  if (b.dataset.sheet === "rsave") {
    readRoutineInputs();
    const days = daysToRule(rdraft.days);
    if (!rdraft.title || !days || !rdraft.start || !rdraft.end) return toast("Нужны название, хотя бы один день и время.");
    closeSheet();
    return void run({ op: "routine_set", num: rdraft.num, title: rdraft.title, kind: rdraft.kind, days, start: rdraft.start, end: rdraft.end, hint: rdraft.kind === "window" ? rdraft.hint : "" });
  }
  if (b.dataset.sheet === "rdel") { closeSheet(); return void run({ op: "routine_del", num }); }
  if (b.dataset.sheet === "tstage") { closeSheet(); return void run({ op: "track_set", num, stage: b.dataset.v, rhythm: null }); }
  if (b.dataset.sheet === "trh") { closeSheet(); return void run({ op: "track_set", num, stage: "keep", rhythm: Number(b.dataset.v) }); }
  if (b.dataset.sheet === "tclose") { closeSheet(); return void run({ op: "say", text: `закрой направление ${num} «${b.dataset.title}»` }); }
  if (b.dataset.sheet === "projects") return openProjectSheet(num);
  if (b.dataset.sheet === "calendar") return openCalendarSheet(num);
  if (b.dataset.sheet === "calmonth") return openCalendarSheet(num, b.dataset.m);
  if (b.dataset.sheet === "calback") return openSheet(num);
  if (b.dataset.sheet === "estimates") return openEstimateSheet(num);
  if (b.dataset.sheet === "urgencies") return openUrgencySheet(num);
  if (b.dataset.sheet === "dial") {
    estDraft = Math.min(1440, Math.max(5, estDraft + Number(b.dataset.d)));
    tg?.HapticFeedback?.selectionChanged();
    return openEstimateSheet(num, true);
  }
  closeSheet();
  if (b.dataset.sheet === "urgency") run({ op: "urgency", num, value: b.dataset.value });
  if (b.dataset.sheet === "estimate") run({ op: "estimate", num, minutes: Number(b.dataset.min) });
  if (b.dataset.sheet === "project") run({ op: "project", num, project: b.dataset.project ? Number(b.dataset.project) : null });
  if (b.dataset.sheet === "move") run({ op: "move", num, date: b.dataset.date });
  if (b.dataset.sheet === "undate") run({ op: "undate", num });
}, true);

$("sayInput").addEventListener("input", (e) => ($("sayBtn").disabled = !e.target.value.trim()));
$("say").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("sayInput").value.trim();
  if (!text) return;
  $("sayInput").value = "";
  $("sayBtn").disabled = true;
  $("sayInput").blur();
  run({ op: "say", text });
});

// Fresh when the app comes back to the front: the chat may have changed things meanwhile.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && S) run({ op: "state" }, { quiet: true });
});

// Telegram's webview and GitHub Pages both hold on to the page for minutes. On start, ask for the page past every
// cache and, when a newer build is out, load it at once instead of showing yesterday's menu.
const BUILD = (document.currentScript?.src.match(/v=(\d+)/) ?? [])[1];
(async () => {
  try {
    const html = await (await fetch(`${location.pathname}?t=${Date.now()}`, { cache: "no-store" })).text();
    const latest = (html.match(/app\.js\?v=(\d+)/) ?? [])[1];
    // A key this browser would not store lives only in memory: reloading would lose it.
    if (!inTelegram && webKey && !keyKept) return;
    if (BUILD && latest && latest !== BUILD && !location.search.includes(`b=${latest}`)) location.replace(`${location.pathname}?b=${latest}${location.hash}`);
  } catch (_) { /* offline or blocked: the build at hand still works */ }
})();

if (!inTelegram && !webKey) needKey("Здесь планер открывается по личной ссылке.");
else run({ op: "state" }, { quiet: true });
