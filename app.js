// Mini-app of the planner: the day by the clock, the week's load, the backlog by project, what is remembered.
// Static page; every call goes to the API with Telegram initData, which the server verifies.
const API = "https://vuaywrqnbtubsekefxcv.supabase.co/functions/v1/planner-app";
const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

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
    headers: { "content-type": "application/json", "x-telegram-init-data": tg?.initData ?? "" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
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
    if (r.reply && !quiet) toast(r.reply, body.op !== "undo" && body.op !== "say" ? true : /Записал|Готово|Разбил|Убрал|✓|Запомнил|Перен|Поставил|Окно|Завёл|Завтра,|Сегодня,/.test(r.reply));
    render();
  } catch (e) {
    tg?.HapticFeedback?.notificationOccurred("error");
    toast(e.message);
  } finally {
    document.body.classList.remove("busy");
  }
}

// ---------- pieces ----------

function meta(t, { showDate = false } = {}) {
  const bits = [];
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
      <div class="title">${esc(t.title)}</div>${meta(t, { showDate: where === "later" })}
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
  return S.days.map((d, i) => {
    const cap = d.loadMin + d.freeMin;
    const pct = cap ? Math.min(100, Math.round((d.loadMin / cap) * 100)) : 0;
    const loose = d.tasks.filter((t) => !t.slot && !t.time && !t.optional).reduce((s, t) => s + (t.est || 30), 0);
    const over = S.hasWindows && loose > d.freeMin;
    const fixed = d.events.filter((e) => e.start).map((e) => `${e.start} ${esc(e.title)}`).slice(0, 3).join(" · ");
    return `<button class="wk" data-act="day" data-ix="${i}" data-go="1">
      <div class="head"><b>${esc(d.label)}${i < 2 ? `, ${esc(d.sub)}` : ""}</b><span>${d.tasks.length ? `${d.tasks.length} · ~${dur(d.loadMin || d.tasks.length * 30)}` : "пусто"}</span></div>
      <div class="bar ${over ? "over" : ""}"><i style="width:${pct}%"></i></div>
      <p>${over ? "Не влезает в окна. " : ""}${S.hasWindows ? `Свободно ${dur(d.freeMin)}` : ""}${fixed ? `${S.hasWindows ? " · " : ""}${fixed}` : ""}</p>
    </button>`;
  }).join("") + (S.later.length ? `<h2>Дальше недели</h2>${cardOf(S.later.map((t) => taskRow(t, "later")))}` : "");
}

function viewBacklog() {
  if (!S.backlog.length && !S.someday.length) return '<p class="hint">Запас пуст: всё либо стоит на днях, либо сделано.</p>';
  const groups = new Map();
  for (const t of S.backlog) groups.set(t.project ?? "", [...(groups.get(t.project ?? "") ?? []), t]);
  const urgent = S.backlog.filter((t) => t.deadline);
  const total = S.backlog.reduce((s, t) => s + (t.est || 30), 0);
  const order = [...groups.keys()].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : groups.get(b).length - groups.get(a).length));
  return `${S.backlog.length ? `<p class="sum">Без дня: ${S.backlog.length}, примерно ${dur(total)} работы. Это ${Math.max(1, Math.round(total / 240))} дн. твоих окон, не бесконечность.</p>` : ""}
    ${urgent.length ? `<h2>Со сроком</h2>${cardOf(urgent.map((t) => taskRow(t, "backlog")))}` : ""}
    ${order.map((p) => `<h2>${p ? esc(p) : "Без проекта"} <span>· ${groups.get(p).filter((t) => !t.deadline).length}</span></h2>${cardOf(groups.get(p).filter((t) => !t.deadline).map((t) => taskRow(t, "backlog")))}`).join("")}
    ${S.someday.length ? `<h2>Когда-нибудь <span>· ${S.someday.length}</span></h2>${cardOf(S.someday.map((t) => taskRow(t, "someday")))}` : ""}`;
}

function viewMemory() {
  const fixed = S.routines.filter((r) => r.kind === "fixed"), win = S.routines.filter((r) => r.kind === "window");
  const rt = (r) => `<div class="mem"><b>${esc(r.title)}</b> <small>${r.start}–${r.end} · ${esc(r.days)}</small>${r.hint ? `<p>${esc(r.hint)}</p>` : ""}</div>`;
  const pr = S.projects.filter((p) => p.open || p.notes.length || p.about);
  return `${fixed.length ? `<h2>Постоянное</h2><div class="card">${fixed.map(rt).join("")}</div>` : ""}
    ${win.length ? `<h2>Окна для дел</h2><div class="card">${win.map(rt).join("")}</div>` : ""}
    ${!S.routines.length ? '<p class="sum">Расписания пока нет. Напиши внизу: «зал по вт и чт с 12 до 14», «днём с 12 до 17 дела».</p>' : ""}
    ${S.about.length ? `<h2>Про тебя</h2><div class="card"><div class="mem"><ul>${S.about.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div></div>` : ""}
    <h2>Проекты <span>· ${pr.length}</span></h2>
    <div class="card">${pr.map((p) => `<div class="mem"><b>${esc(p.name)}</b> <small>${p.open ? `задач: ${p.open}` : ""}</small>${p.about ? `<p>${esc(p.about)}</p>` : ""}${p.notes.length ? `<ul>${p.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}</div>`).join("")}</div>
    <p class="sum">Добавить: «сообщаю контекст по …». Убрать: «забудь …».</p>`;
}

function render() {
  if (!S) return;
  document.querySelectorAll("#seg button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  $("view").innerHTML = { day: viewDay, week: viewWeek, backlog: viewBacklog, memory: viewMemory }[tab]();
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

run({ op: "state" }, { quiet: true });
