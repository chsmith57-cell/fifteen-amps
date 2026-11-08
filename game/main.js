// Fifteen Amps interface. All game logic lives in engine.js; this file draws it and takes clicks.
import { html, render, useEffect, useRef, useState } from "./vendor/htm-preact.js";
import { CATALOG } from "./catalog.js";
import * as G from "./engine.js";
import { WORLD, findItem, floorItems, pickItem, serverBottom, spriteOf } from "./floor.js";

const SAVE_KEY = "fifteen-amps-1";
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---- Art ----
const art = (name) => `art/${name}.webp`;
const GPU_ART = {
  "rtx-3060-12gb-used": "gpu-3060",
  "rtx-3090-used": "gpu-3090",
  "rtx-4090-used": "gpu-4090",
  "rtx-5090-new": "gpu-5090",
  "rtx-pro-5000-blackwell-48gb": "gpu-pro5000",
  "rtx-pro-6000-blackwell-workstation-96gb": "gpu-pro6000",
  "rtx-pro-6000-blackwell-max-q-96gb": "gpu-maxq",
  "radeon-rx-7900-xtx-used": "gpu-7900",
  "radeon-rx-9070-xt-16gb": "gpu-9070",
  "intel-arc-pro-b60-24gb": "gpu-arc",
};
const NAME = {
  "rtx-3060-12gb-used": "RTX 3060 12GB",
  "rtx-3090-used": "RTX 3090 24GB",
  "rtx-4090-used": "RTX 4090 24GB",
  "rtx-5090-new": "RTX 5090 32GB",
  "rtx-pro-5000-blackwell-48gb": "RTX PRO 5000 48GB",
  "rtx-pro-6000-blackwell-workstation-96gb": "RTX PRO 6000 96GB",
  "rtx-pro-6000-blackwell-max-q-96gb": "RTX PRO 6000 Max-Q 96GB",
  "radeon-rx-7900-xtx-used": "Radeon 7900 XTX 24GB",
  "radeon-rx-9070-xt-16gb": "Radeon 9070 XT 16GB",
  "intel-arc-pro-b60-24gb": "Arc Pro B60 24GB",
};
const label = (p) => NAME[p.id] || p.name;
function partArt(kind, p) {
  switch (kind) {
    case "gpus": return GPU_ART[p.id];
    case "cpus": return p.socket === "AM5" ? "cpu-ryzen" : p.socket.startsWith("sTR5") ? "cpu-tr" : "cpu-epyc";
    case "boards": return boardArt(p);
    case "memory": return p.type.includes("UDIMM") ? "ram-ddr5" : "ram-rdimm";
    case "psus": return p.watts >= 2000 ? "psu-big" : "psu-atx";
    case "coolers": return p.type === "server-air" ? "cooler-server" : "cooler-tower";
    case "storage": return "drive-m2";
    case "chassis": return chassisArt(p);
    case "racks": return "rack";
    default: return null;
  }
}
const boardArt = (b) => (b.socket === "AM5" ? "board-am5" : b.socket.startsWith("sTR5") ? "board-wrx" : "board-epyc");
const chassisArt = (c) => (c.type === "rackmount" ? "chassis-rack" : c.type === "open-frame" ? "chassis-frame" : "chassis-tower");

// Where parts sit in the composite, as percentages of the rig box. Read off the rendered boards.
const BOARD_SPOT = {
  "board-am5": { left: 7, top: 6, width: 56.8, socket: [36.5, 33], ram: { x: 49.6, y: 10.4, h: 39.6, step: 1.9, max: 4 } },
  "board-wrx": { left: 5, top: 6, width: 66, socket: [39, 32], ramA: { x: 12, y: 10, h: 32, step: 1.5, max: 4 }, ram: { x: 47.5, y: 10, h: 32, step: 1.5, max: 4 } },
  "board-epyc": { left: 6, top: 6, width: 59, socket: [36.5, 31], ramA: { x: 13, y: 10, h: 34, step: 1.5, max: 4 }, ram: { x: 44.5, y: 10, h: 34, step: 1.5, max: 4 } },
};
const GPU_TOP = 50;
const GPU_LEFT = 4.5;
const PSU_SPOT = { left: 71, top: 64, width: 26 };
const COOLER_W = 25;

// ---- Formatting ----
const money = (n) => {
  const a = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
  return `${sign}$${Math.floor(a).toLocaleString("en-US")}`;
};
const moneyAny = (n) => {
  if (Math.abs(n) < 10) return `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;
  return money(n);
};
const mtok = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)} trillion tokens` : `${n >= 100 ? Math.round(n).toLocaleString("en-US") : n.toFixed(1)} MTok`);
/** Compact figures for columns that have to hold both $9 and $1.7M. */
const moneyShort = (n) => {
  const a = Math.abs(n);
  if (a < 100000) return moneyAny(n);
  return a >= 1e6 ? money(n) : `${n < 0 ? "-" : ""}$${Math.round(a / 1000)}K`;
};
const tokShort = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e5 ? `${Math.round(n / 1000)}K` : tok(n));
const tok = (n) => (n >= 100 ? Math.round(n).toLocaleString("en-US") : n.toFixed(1));
const gb = (n) => `${Math.round(n).toLocaleString("en-US")} GB`;
const dayName = (d) => {
  const y = Math.floor(d / 365);
  return y ? `Year ${y + 1}, day ${Math.floor(d % 365) + 1}` : `Day ${Math.floor(d) + 1}`;
};

// ---- Sound. Made in the browser, started only after a click. ----
let audio = null;
function beep(freq, ms, gain = 0.03, type = "square") {
  if (!ui.sound) return;
  try {
    audio ||= new AudioContext();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + ms / 1000);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + ms / 1000);
  } catch {
    /* No audio is fine. */
  }
}
const sfxBuy = () => { beep(660, 60); setTimeout(() => beep(990, 90), 60); };
const sfxTrip = () => { beep(70, 380, 0.16, "sawtooth"); beep(1400, 30, 0.1); };
const sfxDeny = () => beep(120, 120, 0.04);

// ---- Play log: clicks and regular snapshots go to the artifact's private database so Claude can read how a session went ----
const playlog = { db: null, on: true, buf: [], session: Date.now().toString(36), n: 0, lastNews: 0 };
function logEvent(type, what) {
  if (!playlog.db || !playlog.on) return;
  playlog.buf.push({ at: Date.now(), type, what: String(what).slice(0, 140), day: state ? Math.floor(state.day) : null, screen: ui.layer, cash: state ? Math.round(state.cash) : null, profit: state ? Math.round(state.stats?.profitPerDay || 0) : null });
  if (playlog.buf.length > 600) playlog.buf.shift();
}
function companySnapshot() {
  if (!state) return null;
  const unit = (u) => {
    const o = u.output || {};
    return { name: u.name, gpus: u.gpus ? u.gpus.map((g) => g.id) : undefined, sku: u.sku, racks: u.racks, model: o.model?.name || null, quant: u.quant, tokS: Math.round(o.tokS || 0), mtok: Math.round(o.mtok || 0), sold: Math.round((o.util ?? 0) * 100), sales: Math.round(o.revenue || 0), watts: Math.round(o.wall || 0), on: u.on, tuned: u.tuned };
  };
  const dealOf = (d) => (d ? { client: d.client, tier: d.tier, mtok: Math.round(d.mtok), done: Math.round(d.done || 0), rate: d.rate, left: d.endsDay ? Math.round(d.endsDay - state.day) : d.days } : null);
  return { deal: dealOf(state.contract), offer: dealOf(state.offer), day: Math.floor(state.day), cash: Math.round(state.cash), served: Math.round(state.served), site: state.site, amps: +state.amps.toFixed(1), roomC: +state.roomC.toFixed(1), rep: +state.rep.toFixed(2), trips: state.trips, tech: state.tech, cooling: state.cooling, ledger: G.ledger(state), markets: G.markets(state).map((x) => ({ tier: x.tier, price: +x.price.toFixed(2), made: Math.round(x.made), want: Math.round(x.demand) })), units: G.allUnits(state).slice(0, 60).map(unit), own: state.ownModels.map((x) => x.name) };
}
async function flushLog() {
  if (!playlog.db || !playlog.on || playlog.n >= 1500) return;
  const events = playlog.buf.splice(0);
  if (!events.length && !state) return;
  try {
    await playlog.db.doc(`playlog/${playlog.session}-${String(playlog.n++).padStart(4, "0")}`).set({ session: playlog.session, sentAt: Date.now(), events, company: companySnapshot() });
  } catch {
    /* A log that can't send never gets in the way of playing. */
  }
}
function startPlaylog() {
  window.claude?.use?.("user").then(async (user) => {
    if (!(await user?.isOwner?.())) return;
    playlog.db = await window.claude.use("db");
    if (!playlog.db) return;
    logEvent("open", "page opened");
    flushLog();
    setInterval(flushLog, 30000);
    addEventListener("click", (e) => {
      const b = e.target.closest?.("button");
      if (b) logEvent("click", (b.getAttribute("aria-label") || b.textContent).trim().replace(/\s+/g, " "));
    }, true);
    setInterval(() => {
      const top = state?.news?.[0];
      if (top && top.id !== playlog.lastNews) {
        playlog.lastNews = top.id;
        logEvent("news", top.text);
      }
    }, 2000);
  }).catch(() => {});
}

// ---- Game state ----
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function writeSave() {
  try {
    if (state) localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch {
    /* Saving is a convenience. The game still plays without it. */
  }
}
function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* Nothing saved, nothing to clear. */
  }
}

let state = null;
const ui = { screen: "title", layer: "machine", machineId: null, slot: "gpus", speed: 1, paused: false, hover: null, flash: null, sound: true, about: false, finale: false, shake: 0, tipTurns: 0, nameDraft: "", confirmRestart: false, rowId: null, modelsRow: null, confirmRow: null };

function machine() {
  return state.machines.find((m) => m.id === ui.machineId) || state.machines[0];
}
function flash(text) {
  ui.flash = { text, until: performance.now() + 4200 };
  sfxDeny();
  draw();
}
function doIt(result, good) {
  if (result && result.ok === false) flash(result.reason);
  else {
    ui.flash = null;
    if (good !== false) sfxBuy();
  }
  draw();
}

// ---- Dust. Three fields; drift follows the load, and freezes when the power is out. ----
function startDust() {
  const canvas = document.getElementById("dust");
  const ctx = canvas.getContext("2d");
  const seedRand = (s) => () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)), (s ^= s >>> 16), (s >>> 0) / 4294967296);
  let specks = [];
  let w = 0;
  let h = 0;
  const build = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    w = innerWidth;
    h = innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const r = seedRand(90210);
    specks = [];
    const area = (w * h) / (1920 * 1080);
    const fields = [
      { n: 2600, size: 1, tone: "#3e3e38", rate: 2.2, band: 0.93 },
      { n: 1500, size: 1, tone: "#6f6e65", rate: 4.4, band: 0.95 },
      { n: 110, size: 2, tone: "#6c6b62", rate: 8.8, band: 0 },
    ];
    fields.forEach((f, depth) => {
      for (let i = 0; i < f.n * Math.max(area, 0.4); i++) {
        const x = r() * w;
        let y = r() * h;
        if (r() < f.band) {
          // Most specks gather along two slow waves, like the bands on an old demo screen.
          const wave = r() < 0.5 ? 0.3 : 0.72;
          // Ribbon thickness breathes along its length, so it reads as a band of dust.
          const thick = 18 + 62 * Math.abs(Math.sin((x / w) * 4.3 + wave * 9));
          y = h * (wave + 0.12 * Math.sin((x / w) * 6.1 + depth * 0.6)) + (r() - 0.5) * r() * thick;
        }
        specks.push({ x, y, f });
      }
    });
  };
  build();
  addEventListener("resize", build);
  let last = performance.now();
  let drift = 0;
  const frame = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const load = state ? Math.min(1, state.amps / G.limitAmps(state)) : 0.2;
    const running = !(state && state.tripped) && !ui.paused;
    if (running && !reduced()) drift += dt * (0.35 + load * 1.9);
    ctx.clearRect(0, 0, w, h);
    for (const s of specks) {
      const x = (((s.x - drift * s.f.rate) % w) + w) % w;
      ctx.fillStyle = s.f.tone;
      ctx.fillRect(Math.round(x), Math.round(s.y), s.f.size, s.f.size);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// ---- Simulation loop ----
let lastTrips = 0;
function step() {
  if (!state || ui.screen !== "game" || ui.paused || ui.finale) return;
  if (state.pendingName) return;
  const speed = state.tripped ? 1 : ui.speed;
  G.tick(state, 0.25 * speed);
  if (state.trips > lastTrips) {
    lastTrips = state.trips;
    ui.shake++;
    sfxTrip();
  }
  draw();
}

// ---- The machine, assembled from renders ----
function cardWidth(c) {
  return c.slots >= 3 ? 66 : c.slots >= 2.5 ? 60 : 56;
}
function Rig({ m, hover }) {
  const board = m.board ? G.part("boards", m.board) : null;
  const chassis = m.chassis ? G.part("chassis", m.chassis) : null;
  const key = board ? boardArt(board) : "board-am5";
  const spot = BOARD_SPOT[key];
  const [sx, sy] = spot.socket;
  const hoverPart = hover && G.part(hover.kind, hover.id);
  const hoverKind = hover?.kind;

  const gpus = m.gpus.map((g) => G.part("gpus", g.id));
  const ghostGpu = hoverKind === "gpus" ? hoverPart : null;
  const stack = ghostGpu ? [...gpus, ghostGpu] : gpus;
  const cardH = (c) => (cardWidth(c) * 1.28) / (c.slots >= 3 ? 2.4 : 2.6);
  const tallest = stack.length ? Math.max(...stack.map(cardH)) : 0;
  const top = stack.length > 2 ? 44 : GPU_TOP;
  const step = stack.length > 1 ? Math.min(15, Math.max(0, (99 - top - tallest) / (stack.length - 1))) : 0;
  const cardStyle = (i, c) => `left:${GPU_LEFT + i * 0.9}%;top:${top + i * step}%;width:${cardWidth(c)}%;z-index:${10 + i};filter:drop-shadow(0 -6px 7px #000)`;

  const modules = G.memoryModules(m);
  const ramArt = m.memory.length ? (G.part("memory", m.memory[0]).type.includes("UDIMM") ? "ram-ddr5" : "ram-rdimm") : null;
  const ramSticks = [];
  if (ramArt) {
    const banks = spot.ramA ? [spot.ramA, spot.ram] : [spot.ram];
    for (let i = 0; i < modules; i++) {
      const bank = banks[Math.min(banks.length - 1, Math.floor(i / banks[0].max))];
      const col = i % bank.max;
      if (i >= banks.length * banks[0].max) break;
      ramSticks.push(`left:${bank.x + col * bank.step}%;top:${bank.y}%;height:${bank.h}%;width:${bank.step + 0.5}%;object-fit:fill;z-index:4`);
    }
  }
  const coolerStyle = `left:${sx - COOLER_W / 2}%;top:${sy - (COOLER_W * 1.28) / 2}%;width:${COOLER_W}%;z-index:5`;
  const psuList = m.psus.map((id) => G.part("psus", id));

  const counts = {};
  gpus.forEach((c) => (counts[label(c)] = (counts[label(c)] || 0) + 1));
  const caption = gpus.length > 1 ? Object.entries(counts).map(([n, k]) => `${k} x ${n}`).join(" + ") : "";
  return html`<div class="rig" role="img" aria-label=${describeRig(m)}>
    ${caption ? html`<span class="count">${caption}</span>` : null}
    ${chassis ? html`<img key=${"c" + chassis.id} class="drop" src=${art(chassisArt(chassis))} alt="" style="left:0;top:0;width:100%;height:100%;object-fit:fill" />` : null}
    ${board ? html`<img key=${"b" + board.id} class="drop" src=${art(key)} alt="" style=${`left:${spot.left}%;top:${spot.top}%;width:${spot.width}%;z-index:2`} />` : null}
    ${m.storage ? html`<img key="drive" class="drop" src=${art("drive-m2")} alt="" style="left:17%;top:45%;width:13%;z-index:3" />` : null}
    ${m.cooler ? html`<img key=${"k" + m.cooler} class="drop" src=${art("cooler-server")} alt="" style=${coolerStyle} />` : m.cpu ? html`<img key=${"cpu" + m.cpu} class="drop" src=${art(partArt("cpus", G.part("cpus", m.cpu)))} alt="" style=${`left:${sx - 7}%;top:${sy - 9}%;width:14%;z-index:5`} />` : null}
    ${hoverKind === "coolers" ? html`<img class="ghost" src=${art("cooler-server")} alt="" style=${coolerStyle + ";z-index:6"} />` : null}
    ${ramSticks.map((style, i) => html`<img key=${"r" + i} class="drop" src=${art(ramArt)} alt="" style=${style} />`)}
    ${psuList.map((p, i) => html`<img key=${"p" + i + p.id} class="drop" src=${art(partArt("psus", p))} alt="" style=${`left:${PSU_SPOT.left}%;top:${p.watts >= 2000 ? 76 - i * 15 : PSU_SPOT.top - i * 34}%;width:${PSU_SPOT.width}%;z-index:4`} />`)}
    ${hoverKind === "psus" ? html`<img class="ghost" src=${art(partArt("psus", hoverPart))} alt="" style=${`left:${PSU_SPOT.left}%;top:${PSU_SPOT.top}%;width:${PSU_SPOT.width}%;z-index:6`} />` : null}
    ${chassis && board && m.psus.length ? html`<img key="cables" class="drop" src=${art("cables-main")} alt="" style="left:62%;top:8%;height:58%;width:auto;z-index:3;filter:brightness(2.1) contrast(1.05)" />` : null}
    ${gpus.length && m.psus.length ? html`<img key="leads" class="drop" src=${art("cables-gpu")} alt="" style=${`left:52%;top:${top + 6}%;width:24%;z-index:9;filter:brightness(2.1)`} />` : null}
    ${gpus.map((c, i) => html`<img key=${"g" + i + c.id} class="drop" src=${art(GPU_ART[c.id])} alt="" style=${cardStyle(i, c)} />`)}
    ${ghostGpu ? html`<img class="ghost" src=${art(GPU_ART[ghostGpu.id])} alt="" style=${cardStyle(gpus.length, ghostGpu)} />` : null}
  </div>`;
}
function describeRig(m) {
  const parts = m.gpus.map((g) => label(G.part("gpus", g.id)));
  return parts.length ? `${m.name}, with ${parts.join(", ")}` : `${m.name}, no GPU yet`;
}

// ---- Machine layer ----
const BUILD_ORDER = ["chassis", "boards", "cpus", "coolers", "memory", "psus", "storage", "gpus"];
const FILLED = { chassis: (m) => m.chassis, boards: (m) => m.board, cpus: (m) => m.cpu, coolers: (m) => m.cooler, memory: (m) => m.memory.length, psus: (m) => m.psus.length, storage: (m) => m.storage, gpus: (m) => m.gpus.length };
function nextEmptySlot(m) {
  return BUILD_ORDER.find((k) => !FILLED[k](m)) || null;
}
function buyPart(m, kind, p) {
  const r = G.buy(state, kind, p.id, m.id);
  ui.hover = null;
  if (!r.ok) {
    flash(r.reason);
    return;
  }
  const empty = nextEmptySlot(m);
  let text = `Installed ${label(p)} in ${m.name}.`;
  if (kind === "memory") text += ` System memory is now ${gb(G.memoryGB(m))}.`;
  if (empty) {
    text += ` Next it needs: ${G.kindLabel(empty)}.`;
    ui.slot = empty;
    ui.slotIndex = "new";
  } else if (m.output?.model) {
    text += ` It's running ${m.output.model.name}.`;
  }
  flashNote(text);
}
function Slots({ m }) {
  const k = G.machineSheet(state, m);
  const line = (slot, labelText, value, opts = {}) => html`<button class=${`slot ${opts.big ? "gpu" : ""} ${ui.slot === slot && (opts.index === undefined || ui.slotIndex === opts.index) ? "on" : ""}`} onClick=${() => { ui.slot = slot; ui.slotIndex = opts.index; draw(); }}>
    <span class="car">></span><span class="lab">${labelText}</span><span class=${`val ${value ? "" : "none"}`}>${value || "empty"}</span>${opts.use ? html`<span class=${`use ${opts.full ? "full" : ""}`}>${opts.use}</span>` : null}${opts.ratio !== undefined ? html`<span class="mini" aria-hidden="true"><i style=${`width:${Math.min(100, opts.ratio * 100)}%`} class=${opts.full ? "full" : ""}></i></span>` : null}
  </button>`;
  const lim = G.slotLimit(m);
  const canAddCard = m.gpus.length < lim.sockets && G.slotsUsed(m) < lim.physical;
  const one = (kind, id) => (id ? label(G.part(kind, id)) : null);
  const memTotal = G.memoryGB(m);
  const slotUse = k.slotsMax < 99 && m.gpus.length ? k.slotsUsed / k.slotsMax : undefined;
  const socketUse = k.socketsMax && m.gpus.length ? k.socketsUsed / k.socketsMax : undefined;
  return html`<div class="slots">
    <h2 class="hd">GPUs, ${k.vram} GB of GPU memory${k.model ? `, model uses ${gb(k.modelGB)}` : ""}</h2>
    ${m.gpus.map((g, i) => {
      const c = G.part("gpus", g.id);
      return line("gpus", `GPU ${i + 1}`, label(c), { big: true, index: i });
    })}
    ${canAddCard ? line("gpus", `GPU ${m.gpus.length + 1}`, "empty slot", { big: true, index: "new" }) : html`<span class="small d2">No room for another card. Sell one, or build a new machine.</span>`}
    <h2 class="hd spaced">Everything else, and how much of it you're using</h2>
    <div class="rest">
    ${line("chassis", "Case", one("chassis", m.chassis), { use: slotUse !== undefined ? `${k.slotsUsed} of ${k.slotsMax} card slots` : "", ratio: slotUse, full: slotUse >= 1 })}
    ${line("boards", "Board", one("boards", m.board), { use: socketUse !== undefined ? `${k.socketsUsed} of ${k.socketsMax} GPU sockets` : "", ratio: socketUse, full: socketUse >= 1 })}
    ${line("psus", "Power", m.psus.length ? `${G.psuWatts(m).toLocaleString("en-US")} W supply` : null, { use: m.psus.length ? `machine needs ${Math.round(k.psuNeed).toLocaleString("en-US")} W` : "", ratio: m.psus.length ? k.psuNeed / k.psuMax : undefined, full: k.psuNeed > k.psuMax })}
    ${line("memory", "RAM", memTotal ? gb(memTotal) : null, { use: memTotal ? (k.spill > 0 ? `${gb(k.spill)} of model spilling here` : "not in use: model fits in GPU") : "", ratio: memTotal ? k.spill / memTotal : undefined })}
    ${line("cpus", "CPU", one("cpus", m.cpu))}
    ${line("coolers", "Cooler", one("coolers", m.cooler))}
    ${line("storage", "Drive", one("storage", m.storage))}
    </div>
  </div>`;
}

function MachineList({ m }) {
  if (state.machines.length < 2) return null;
  const pick = (x) => html`<button key=${x.id} class=${`act ${x.id === m.id ? "on" : ""}`} onClick=${() => { ui.machineId = x.id; ui.modelsRow = null; ui.confirmSell = null; draw(); }}>${x.name}</button>`;
  if (state.machines.length <= 6) return html`<div class="switch">${state.machines.map(pick)}</div>`;
  return html`<${More} id="benchlist" title=${`On the bench: ${m.name}. Pick another of ${state.machines.length}`}>
    ${designGroups().map((g) => (g.list.length === 1 ? pick(g.list[0]) : html`<${More} key=${g.key} id=${`bench${g.key}`} title=${`${g.list.length} x ${g.gear}`}><div class="switch">${g.list.map(pick)}</div></${More}>`))}
  </${More}>`;
}
function MachineVerbs({ m }) {
  const newOne = () => {
    const made = G.addMachine(state);
    ui.machineId = made.id;
    ui.slot = "chassis";
    ui.slotIndex = "new";
    flashNote(`${made.name} started. Start with a case, or use the quick build.`);
  };
  const sell = () => {
    if (ui.confirmSell !== m.id) {
      ui.confirmSell = m.id;
      draw();
      return;
    }
    ui.confirmSell = null;
    G.sellMachine(state, m.id);
    ui.machineId = state.machines[0].id;
    doIt({ ok: true });
  };
  return html`<div class="switch verbs">
    <button class="act" onClick=${newOne}>build a new machine</button>
    ${G.isComplete(m) ? html`<${CopyButton} m=${m} label="copy this machine" then=${(r) => { ui.machineId = r.id; draw(); }} />` : null}
    ${G.hasTech(state, "powerlimit") && m.gpus.length ? html`<button class=${`act ${m.tuned ? "on" : ""}`} onClick=${() => { m.tuned = !m.tuned; G.recompute(state); draw(); }}>power limit ${m.tuned ? "on" : "off"}</button>` : null}
    ${G.isComplete(m) ? html`<button class=${`act ${m.on ? "" : "on"}`} onClick=${() => { m.on = !m.on; G.recompute(state); draw(); }}>${m.on ? "shut this machine off" : "turn this machine on"}</button>` : null}
    ${state.machines.length > 1 ? html`<button class=${`act ${ui.confirmSell === m.id ? "lead" : ""}`} onClick=${sell}>${ui.confirmSell === m.id ? "yes, sell every part in it" : "sell this whole machine"}</button>` : null}
  </div>`;
}

/** The three GPUs worth looking at next, each for a different reason. */
function nextMoves(m) {
  const rows = CATALOG.gpus.map((p) => {
    const pv = G.previewBuy(state, m, "gpus", p);
    return { p, pv, gain: (pv.earnAfter || 0) - (pv.earnBefore || 0) };
  });
  const fit = rows.filter((r) => !r.pv.problem);
  const picks = [];
  const add = (row, tag) => { if (row && !picks.some((x) => x.p.id === row.p.id)) picks.push({ ...row, tag }); };
  const byValue = (a, b) => b.gain / b.pv.cost - a.gain / a.pv.cost;
  add([...fit].filter((r) => r.pv.canAfford && r.gain > 0).sort(byValue)[0], "best buy right now");
  add([...fit].filter((r) => !r.pv.canAfford && r.gain > 0).sort(byValue)[0], "next one to save for");
  add([...fit].sort((a, b) => (b.pv.earnAfter || 0) - (a.pv.earnAfter || 0))[0], "the big jump");
  for (const r of [...fit].sort((a, b) => a.pv.cost - b.pv.cost)) if (picks.length < 3) add(r, "cheapest way to add memory");
  return { picks, refusal: rows.find((r) => r.pv.problem)?.pv.problem };
}

function partHelp(kind, m) {
  switch (kind) {
    case "gpus": return "Runs the model. GPU memory decides which models fit. If a model fits on one card, every card runs its own copy, so more cards means more tokens.";
    case "memory": {
      const f = m.output?.fit;
      const now = f?.mode === "spill" ? `Right now ${f.label}.` : "Right now your model fits in GPU memory, so extra RAM won't change anything.";
      return `System RAM. It's separate from GPU memory. A model only uses it if it spills out of the GPU, and spilling is slow. ${now}`;
    }
    case "cpus": return "Feeds the GPUs. It has to match the motherboard's socket. It barely changes earnings or power: upgrade it only to reach a board with more GPU sockets, or to speed up a model spilling into RAM.";
    case "boards": return "Connects everything. It sets how many GPUs fit and which CPU and RAM will work. To run more cards, this is usually what has to change.";
    case "psus": return `Has to cover the machine's watts or it won't start. This machine needs ${Math.round(G.dcLoad(m)).toLocaleString("en-US")} W. It doesn't change earnings, and it isn't what limits your circuit.`;
    case "coolers": return "Keeps the CPU alive. Every machine needs one that fits its socket. It doesn't affect room heat or earnings.";
    case "storage": return "Every machine needs one. It doesn't change earnings in this game.";
    case "chassis": return "Holds the machine. A tower takes one floor spot. A rackmount case goes in a rack, and a rack fits several on one floor spot.";
    default: return "";
  }
}
function QuickBuild({ m }) {
  if (m.chassis && m.board && m.cpu) return null;
  const rackFree = G.rackUnits(state) - G.rackUsed(state, m) >= 4;
  const card = m.gpus.length ? "keeping your GPU" : "with one RTX 3090";
  const opts = [{ rack: false, text: `tower workstation ${card}` }];
  if (rackFree) opts.unshift({ rack: true, text: `rackmount workstation ${card}` });
  const blank = !m.chassis && !m.board && !m.cpu && !m.gpus.length;
  const into = m.forRack ? (m.rackSlot ?? "rack") : null;
  const choices = blank ? copyChoices(into) : [];
  return html`<div class="quick">
    ${choices.length ? html`<h2 class="hd">Copy what already works</h2>
      ${choices.map((x) => html`<${CopyButton} key=${x.id} m=${x} label=${`same as ${x.name}`} into=${into} target=${m.id} then=${(r) => { ui.machineId = r.id; ui.slot = "gpus"; ui.slotIndex = "new"; draw(); }} />`)}` : null}
    <h2 class="hd">Skip the shopping</h2>
    ${opts.map((o) => {
      const q = remembered(`quote|${m.id}|${o.rack}`, () => G.workstationQuote(state, m, "rtx-3090-used", o.rack));
      return html`<button key=${o.text} class="act lead" disabled=${!q.complete || state.cash < q.cost} onClick=${() => { G.fillWorkstation(state, m, "rtx-3090-used", o.rack); ui.slot = nextEmptySlot(m) || "gpus"; ui.slotIndex = "new"; flashNote(`${m.name} is built and running.`); }}>${o.text}, ${q.complete ? money(q.cost) : "no room for it here"}</button>`;
    })}
    <p class="small d2" style="margin:0">Room for four cards. Or pick each part below, starting with the case.</p>
  </div>`;
}
/** Picking an installed card makes the shop a swap list: this card for that one, here or across the company. */
function SwapShop({ m, index }) {
  const from = G.part("gpus", m.gpus[index].id);
  const everywhere = state.machines.reduce((n, x) => n + x.gpus.filter((g) => g.id === from.id).length, 0);
  const list = [...CATALOG.gpus].filter((g) => g.id !== from.id).sort((a, b) => a.price - b.price);
  const done = (r, text) => { freshMoves(); if (r.ok === false) flash(r.reason); else { ui.slotIndex = "new"; flashNote(text); } };
  return html`<div class="shop">
    <div>
      <h2 class="big plain">Swap your ${label(from)}</h2>
      <p class="help">Your old card sells for ${money(G.resale(state, "gpus", from))}. These numbers try the swap on a copy of your company, with the best models loaded.</p>
    </div>
    <button class="act" onClick=${() => { G.sellInstalled(state, m.id, "gpus", index); done({ ok: true }, `Sold the ${label(from)}.`); }}>just sell it for ${money(G.resale(state, "gpus", from))}</button>
    ${list.map((g) => {
      const here = remembered(`swap|${m.id}|${index}|${g.id}`, () => G.quoteUpgrade(state, (c) => G.swapGpu(c, m.id, index, g.id)));
      const all = everywhere > 1 ? remembered(`swapall|${from.id}|${g.id}`, () => G.quoteUpgrade(state, (c) => G.upgradeEverywhere(c, from.id, g.id))) : null;
      const problem = G.fitProblem(state, { ...m, gpus: m.gpus.filter((_, i) => i !== index) }, "gpus", g);
      return html`<div class="rackitem" key=${g.id}>
        <button class=${`item tilt ${problem || state.cash < here.cost ? "off" : ""}`} onClick=${() => done(G.swapGpu(state, m.id, index, g.id), `Swapped in the ${label(g)}.`)}>
          <span class="pic"><img src=${art(GPU_ART[g.id])} alt="" loading="lazy" /></span>
          <span>
            <span class="name">${label(g)}${g.used ? " used" : ""}</span><br />
            <span class="price">${problem ? money(g.price) : here.cost < 0 ? `${money(-here.cost)} back` : money(here.cost)}</span>
            ${problem ? html`<div class="why">${problem}</div>` : html`<div class="why">${here.gain >= 1 ? `about +${money(here.gain)} a day, back in ${Math.ceil(Math.max(1, here.cost) / here.gain).toLocaleString("en-US")} days` : "no extra income right now"}</div>`}
            <div class="why">${g.vram} GB, ${g.watts} W, ${moneyAny(G.dollarsPerDay(state, g.watts / 0.92))} a day in power</div>
          </span>
        </button>
        ${all && all.cost > 0 ? html`<button class="act rowbuy" disabled=${state.cash < all.cost} onClick=${() => { const r = G.upgradeEverywhere(state, from.id, g.id); done(r, `Swapped ${r.swapped} cards for ${label(g)}.`); }}>swap all ${everywhere} of them, ${money(all.cost)}${all.gain >= 1 ? `, about +${money(all.gain)} a day` : ""}${all.amps >= all.limit ? ", over your power limit" : ""}</button>` : null}
      </div>`;
    })}
  </div>`;
}
function Shop({ m }) {
  const kind = ui.slot;
  if (kind === "gpus" && typeof ui.slotIndex === "number" && m.gpus[ui.slotIndex]) return html`<${SwapShop} m=${m} index=${ui.slotIndex} />`;
  const heads = { gpus: "GPUs", cpus: "CPUs", boards: "Motherboards", memory: "System RAM", psus: "Power supplies", coolers: "CPU coolers", storage: "Drives", chassis: "Cases" };
  const showAll = ui.allParts || kind !== "gpus";
  let list = [...CATALOG[kind]].sort((a, b) => a.price - b.price);
  list = [...list.filter((p) => !G.fitProblem(state, m, kind, p)), ...list.filter((p) => G.fitProblem(state, m, kind, p))];
  if (kind === "chassis" && G.rackUnits(state) > G.rackUsed(state, m)) list = [...list.filter((c) => c.type === "rackmount"), ...list.filter((c) => c.type !== "rackmount")];
  const moves = kind === "gpus" && !showAll ? nextMoves(m) : null;
  const fresh = ui.flash && ui.flash.quiet && ui.flash.until > performance.now();
  return html`<div class="shop" onMouseLeave=${() => { ui.hover = null; draw(); }}>
    ${fresh ? html`<p class="done">${ui.flash.text}</p>` : null}
    <${QuickBuild} m=${m} />
    <div>
      <h2 class="big plain">${heads[kind]}</h2>
      <p class="help">${partHelp(kind, m)}</p>
    </div>
    ${moves && !moves.picks.length ? html`<p class="d1" style="margin:0">Nothing else fits in this machine. ${moves.refusal} Build a new machine, or sell a card to make room.</p>` : null}
    ${moves ? moves.picks.map((r) => html`<${ShopItem} key=${r.p.id} m=${m} kind=${kind} p=${r.p} tag=${r.tag} />`) : (() => {
      const seen = new Set();
      return list.map((p) => {
        const problem = G.fitProblem(state, m, kind, p);
        const repeat = problem && seen.has(problem);
        if (problem) seen.add(problem);
        return html`<${ShopItem} key=${p.id} m=${m} kind=${kind} p=${p} quiet=${repeat} />`;
      });
    })()}
    ${kind === "gpus" ? html`<button class="act" onClick=${() => { ui.allParts = !ui.allParts; draw(); }}>${ui.allParts ? "show my next moves" : `see all ${CATALOG.gpus.length} GPUs`}</button>` : null}
  </div>`;
}
function flashNote(text) {
  ui.flash = { text, until: performance.now() + 3200, quiet: true };
  sfxBuy();
  draw();
}

function ShopItem({ m, kind, p, tag, quiet }) {
  const pv = G.previewBuy(state, m, kind, p);
  const off = pv.problem || !pv.canAfford;
  const why = [];
  if (pv.problem) {
    if (!quiet) why.push(pv.problem);
  } else {
    const gain = (pv.earnAfter || 0) - (pv.earnBefore || 0);
    if (kind === "gpus") {
      why.push(...gpuWhy(p, pv));
    } else {
      if (kind === "memory") why.push(`${p.gb} GB, ${p.modules} ${p.modules === 1 ? "stick" : "sticks"}, ${p.type}${p.used ? ", used" : ""}`);
      if (kind === "psus") why.push(`${p.watts.toLocaleString("en-US")} W${p.needs240 ? ", needs a 240 volt circuit" : ""}`);
      if (kind === "cpus") why.push(`${p.cores} cores, ${p.channels} memory channels, ${p.socket}${p.used ? ", used" : ""}`);
      if (kind === "boards") why.push(`${p.x16} GPU slots, ${p.memSlots} RAM slots, ${p.socket}, ${p.memType}`);
      if (kind === "chassis") why.push(p.type === "rackmount" ? `Rackmount, ${p.units} rack units of your ${G.rackUnits(state)}` : p.type === "open-frame" ? `Open frame, ${p.slots} card slots, takes a floor spot` : `Tower, ${p.slots} card slots, takes a floor spot`);
      if (kind === "coolers") why.push(`Fits ${p.sockets.filter((x) => !x.includes("(")).slice(0, 3).join(", ")}`);
      if (kind === "storage") why.push(`${p.tb} TB`);
      if (pv.replaces) why.push(`replaces your ${pv.replaces}${pv.refund ? `, ${money(pv.refund)} back` : ""}`);
      if (G.isComplete(m)) why.push(gain >= 1 ? `about +${money(gain)} a day` : "no change to earnings right now");
    }
    if (pv.needsPsu) why.push(`then it needs a ${pv.needsPsu.toLocaleString("en-US")} W power supply`);
    if (pv.ampsAfter >= G.limitAmps(state)) why.push(`would trip the breaker at ${pv.ampsAfter.toFixed(1)} A`);
  }
  const hover = () => { if (!ui.hover || ui.hover.id !== p.id) { ui.hover = { kind, id: p.id, ampsAfter: pv.ampsAfter }; draw(); } };
  const tilt = kind === "gpus";
  return html`<button class=${`item ${off ? "off" : ""} ${tilt ? "tilt" : ""}`} aria-disabled=${off ? "true" : "false"}
    onMouseEnter=${hover} onFocus=${hover}
    onClick=${() => buyPart(m, kind, p)}>
    <span class="pic"><img src=${art(partArt(kind, p))} alt="" loading="lazy" /></span>
    <span>
      ${tag ? html`<span class="tag">${tag}</span><br />` : null}
      <span class="name">${label(p)}${p.used && kind === "gpus" ? " used" : ""}</span><br />
      <span class="price">${money(pv.cost)}</span>${!pv.problem && !pv.canAfford ? html` <span class="d2">${money(pv.cost - state.cash)} short</span>` : null}
      ${why.map((w) => html`<div class="why">${w}</div>`)}
    </span>
  </button>`;
}
function gpuWhy(p, pv) {
  const lines = [];
  if (pv.unlocks.length) {
    const biggest = [...pv.unlocks].sort((a, b) => b.sizes.Q4 - a.sizes.Q4)[0];
    lines.push(`lets you run ${biggest.name}`);
  } else if (pv.sameModel && pv.sameModel.to.tokS > pv.sameModel.from.tokS * 1.2) {
    lines.push(`${pv.sameModel.name}: ${tok(pv.sameModel.from.tokS)} to ${tok(pv.sameModel.to.tokS)} tok/s`);
  } else if (pv.sameModel && pv.sameModel.to.mode === "split") {
    lines.push("adds room, not speed");
  }
  const gain = (pv.earnAfter || 0) - (pv.earnBefore || 0);
  lines.push(gain >= 1 ? `about +${money(gain)} a day, back in ${Math.ceil(pv.cost / gain).toLocaleString("en-US")} days` : `${p.vram} GB GPU memory, no extra income yet`);
  const here = G.site(state);
  lines.push(`adds ${(p.watts / 0.92 / here.volts).toFixed(1)} A, up to ${moneyAny(G.dollarsPerDay(state, p.watts / 0.92))} a day in power`);
  return lines;
}

const WORD_CLASS = { working: "d0", "backed up": "sig", slowed: "sig", spilling: "sig", "losing money": "sig", "no power": "sig", idle: "sig", unfinished: "sig", off: "d2", training: "d1" };
function Link({ title, value, note, raise, hot, children }) {
  return html`<div class=${`link ${hot ? "hot" : ""}`}>
    <span class="ltitle">${title}</span>
    <span class="lvalue">${value}</span>
    <span class="lnote">${note}</span>
    ${raise ? html`<span class="lraise">changed by: ${raise}</span>` : null}
    ${children}
  </div>`;
}
/** What this machine cost and which parts of that can earn. Expensive isn't the same as productive. */
function Spend({ m, net, ramUsed }) {
  const sp = G.machineSpend(state, m);
  const wasted = !ramUsed && sp.ram > sp.total * 0.25;
  return html`<div class=${`link spend ${wasted ? "hot" : ""}`}>
    <span class="ltitle">Cost new</span>
    <span class="lvalue">${money(sp.total)}</span>
    <span class="lnote">${net > 0 ? `back in ${Math.ceil(sp.total / net).toLocaleString("en-US")} days` : "never pays back"}</span>
    <span class="lnote">GPUs ${money(sp.gpus)}, RAM ${money(sp.ram)}, rest ${money(sp.rest)}</span>
    ${wasted ? html`<span class="lnote">The RAM isn't in use, so it earns nothing.</span>` : null}
  </div>`;
}
/** How this machine's parts turn into money, left to right. */
function Status({ m }) {
  const k = G.machineSheet(state, m);
  const best = k.model && G.isComplete(m) ? G.bestModelFor(state, m) : null;
  const better = best && best.model.id !== m.modelId && best.perDay > k.sales * 1.2;
  const go = () => { ui.layer = "models"; draw(); };
  return html`<div class="flow">
    <div class="flowhead"><span class=${`fword ${WORD_CLASS[k.word]}`}>${k.word}</span><span class="d1">${k.detail}</span></div>
    ${k.model ? html`<div class="chain">
      <${Link} title="Fits" value=${`${gb(k.modelGB)} model`} note=${k.fit?.mode === "split" ? `split across ${gb(k.vram)}` : k.fit?.mode === "spill" ? `only ${gb(k.vram)} of GPU memory` : `in ${gb(k.perCard)} per card`} raise="GPU memory" hot=${k.word === "spilling"}>
        <button class="act" onClick=${go}>${k.model.name}</button>
      <//>
      <span class="arrow">></span>
      <${Link} title="Makes" value=${`${tok(k.mtok)} MTok`} note=${`a day, ${tok(k.tokS)} tok/s${k.fit?.copies > 1 ? `, ${k.fit.copies} copies` : ""}`} raise="more or faster cards, batching" hot=${k.word === "slowed"} />
      <span class="arrow">></span>
      <${Link} title="Sells" value=${`${Math.round(k.util * 100)}%`} note=${`${tok(k.sold)} MTok a day`} raise="a different size of model" hot=${k.word === "backed up"} />
      <span class="arrow">></span>
      <${Link} title="Earns" value=${moneyAny(k.sales)} note=${`at ${moneyAny(k.rate)} per MTok`} raise="bigger or higher quality model" />
      <span class="arrow">-</span>
      <${Link} title="Power" value=${moneyAny(k.dayCost)} note=${`${Math.round(k.wall).toLocaleString("en-US")} W at ${state.centsPerKwh.toFixed(0)} cents`} raise=${G.hasTech(state, "powerlimit") ? "power limit" : "power limit, in the lab"} hot=${k.word === "losing money"}>
        ${G.hasTech(state, "powerlimit") ? html`<button class=${`act ${m.tuned ? "on" : ""}`} onClick=${() => { m.tuned = !m.tuned; G.recompute(state); draw(); }}>power limit ${m.tuned ? "on" : "off"}</button>` : null}
      <//>
      <span class="arrow">=</span>
      <${Link} title="Net" value=${html`<span class=${k.net < 0 ? "rev" : ""}>${moneyAny(k.net)}</span>`} note="a day" />
      <${Spend} m=${m} net=${k.net} ramUsed=${k.spill > 0} />
    </div>` : k.word === "idle" ? html`<button class="act lead" onClick=${go}>pick a model</button>` : null}
    ${better ? html`<button class="act lead" onClick=${() => doIt(G.loadModel(state, m.id, best.model.id, best.quant))}>load ${best.model.name} for about ${money(best.perDay)} in sales a day</button>` : null}
  </div>`;
}

// ---- Racks: bought from the floor, run by the row ----
const VISIBLE_ROWS = 7;
const HALL_ASPECT = 2.3;
const RACK_ASPECT = 0.34; // The rack renders, width over height.
const NEAR_HEIGHT = 56; // A front-row rack, as a percentage of the hall's height.
const FLEET_ART = (sku) => art(sku.art);
/** The hall, built from rack renders: the newest row up front, older rows receding into the void. */
function Hall({ hover, pick }) {
  const selected = ui.rowId;
  let rows = state.rows.slice(-VISIBLE_ROWS).map((r) => ({ id: r.id, name: r.name, sku: G.skuOf(r), racks: r.racks, on: r.on, ghost: 0 }));
  const ghostSku = hover ? G.part("fleetRacks", hover.id) : null;
  if (ghostSku) {
    const last = rows[rows.length - 1];
    if (last && last.sku.id === ghostSku.id && last.racks < G.RACKS_PER_ROW) last.ghost = 1;
    else rows = [...rows.slice(-(VISIBLE_ROWS - 1)), { id: "ghost", name: "", sku: ghostSku, racks: 0, on: true, ghost: 1 }];
  }
  // Lay the rows out back to front, then zoom in until they fill the hall, so a few racks still read as the hero.
  let base = 0;
  let top = 0;
  const strips = [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const depth = rows.length - 1 - i;
    const h = NEAR_HEIGHT * Math.pow(0.85, depth);
    strips.push({ row: rows[i], depth, h, bottom: base });
    top = Math.max(top, base + h);
    base += h * 0.66;
  }
  const near = NEAR_HEIGHT * Math.min(1.5, 100 / Math.max(top, 1)) / NEAR_HEIGHT;
  for (const x of strips) {
    x.h *= near;
    x.bottom *= near;
    x.w = (x.h * RACK_ASPECT) / HALL_ASPECT;
  }
  strips.reverse();
  return html`<div class="hall" role="group" aria-label=${`${G.totalRacks(state)} racks in ${state.rows.length} rows`}>
    ${strips.map(({ row, depth, w, h, bottom }) => {
      const span = w * G.RACKS_PER_ROW;
      const left = 50 - span / 2;
      const imgs = [];
      for (let i = 0; i < row.racks; i++) imgs.push(html`<img key=${i} class="drop" src=${FLEET_ART(row.sku)} alt="" style=${`left:${(i / G.RACKS_PER_ROW) * 100}%;width:${100 / G.RACKS_PER_ROW}%`} />`);
      if (row.ghost) imgs.push(html`<img key="g" class="ghost" src=${FLEET_ART(row.sku)} alt="" style=${`left:${(row.racks / G.RACKS_PER_ROW) * 100}%;width:${100 / G.RACKS_PER_ROW}%`} />`);
      const dim = Math.max(0.28, 1 - depth * 0.13) * (row.on ? 1 : 0.4);
      const body = html`<span class="rackline" style=${`filter:brightness(${dim.toFixed(2)})`}>${imgs}</span>${depth < 5 && row.name ? html`<span class="rowtag">${selected === row.id ? ">" : ""}${row.name}</span>` : null}`;
      const style = `left:${left}%;width:${span}%;height:${h}%;bottom:${bottom}%;z-index:${20 - depth}`;
      return pick && row.id !== "ghost"
        ? html`<button key=${row.id} class=${`hallrow ${selected === row.id ? "on" : ""}`} style=${style} aria-label=${`${row.name}, ${row.racks} ${row.sku.short} racks`} onClick=${() => pick(row.id)}>${body}</button>`
        : html`<div key=${row.id} class="hallrow" style=${style} aria-hidden="true">${body}</div>`;
    })}
  </div>`;
}
function buyAndSay(sku, n) {
  const r = G.buyRacks(state, sku.id, n);
  ui.hover = null;
  freshMoves();
  if (!r.ok) {
    flash(r.reason);
    return;
  }
  if (r.ordered) {
    flashNote(`Ordered ${n} ${sku.short} ${n === 1 ? "rack" : "racks"}. ${Math.ceil(r.ready - state.day)} days to arrive.`);
    return;
  }
  const row = [...state.rows].reverse().find((x) => x.sku === sku.id);
  ui.rowId = row.id;
  ui.modelsRow = row.id;
  flashNote(`${n === 1 ? `${sku.short} rack` : `${n} ${sku.short} racks`} in ${row.name}, cabled and running ${row.output?.model?.name || "nothing yet"}.`);
}
function planWords(plan) {
  const bits = [];
  if (plan.retire.length) bits.push(`retires ${plan.retire.length} old ${plan.retire.length === 1 ? "machine" : "machines"}`);
  if (plan.halls) bits.push(`${plan.halls} new ${plan.halls === 1 ? "hall" : "halls"}`);
  const cool = {};
  plan.cooling.forEach((id) => { cool[id] = (cool[id] || 0) + 1; });
  const coolName = { cdu: "water loop", chiller: "chiller", crac: "computer room AC", immersion: "immersion tank" };
  for (const [id, n] of Object.entries(cool)) bits.push(`${n} ${coolName[id] || id}${n > 1 ? "s" : ""}`);
  if (plan.network.length) bits.push(`${plan.network.length} ${plan.network.length === 1 ? "switch" : "switches"}`);
  return bits.length ? `Includes ${bits.join(", ")}.` : "Fits in what you have.";
}
function RackItem({ sku, moves }) {
  const open = G.skuAvailable(state, sku);
  const one = G.rackPrice(state, sku);
  const plan = open ? G.provisionPlan(state, sku, 1) : null;
  const rowPlan = open ? G.provisionPlan(state, sku, G.RACKS_PER_ROW) : null;
  const cost = open ? one + plan.cost - plan.refund : one;
  const rowCost = open ? one * G.RACKS_PER_ROW + rowPlan.cost - rowPlan.refund : 0;
  const off = !open || plan.problem || state.cash < cost;
  const move = moves.find((x) => x.id === `rack-${sku.id}`);
  const here = G.site(state);
  const share = (sku.kW * 1000) / G.siteLimitW(state);
  const draws = here.feeds ? `${sku.kW} kW, ${share >= 0.1 ? `${Math.round(share * 100)}%` : share >= 0.001 ? `${(share * 100).toFixed(1)}%` : "under 0.1%"} of your contract` : `${sku.kW} kW, ${Math.round((sku.kW * 1000) / here.volts)} A of your ${here.amps} A`;
  const why = [`${sku.cards} cards, ${sku.gb} GB each${sku.used ? ", used" : ""}`, `draws ${open ? draws : `${sku.kW} kW`}, cooled by ${sku.liquid ? "water" : "air"}`];
  if (!open) why.push(`Needs a ${G.SITES.find((x) => x.id === sku.site).name.toLowerCase()}. It's too hot and too thirsty for this building.`);
  else if (plan.problem) why.push(plan.problem);
  else {
    if (move && move.gain >= 1) why.push(`${move.racks > 1 ? `${move.racks} of them: ` : ""}about +${money(move.gain)} a day, pays back in ${Math.ceil(move.payback).toLocaleString("en-US")} days`);
    else why.push("no extra income right now");
    why.push(planWords(plan));
  }
  const hover = () => { if (!ui.hover || ui.hover.id !== sku.id) { ui.hover = { kind: "fleetRacks", id: sku.id, ampsAfter: move?.amps }; draw(); } };
  return html`<div class="rackitem">
    <button class=${`item ${off ? "off" : ""}`} aria-disabled=${off ? "true" : "false"} onMouseEnter=${open ? hover : null} onFocus=${open ? hover : null}
      onClick=${() => buyAndSay(sku, 1)}>
      <span class="pic"><img src=${FLEET_ART(sku)} alt="" loading="lazy" /></span>
      <span>
        <span class="name">${sku.name}</span><br />
        <span class="price">${money(cost)}</span>${open && !plan.problem && state.cash < cost ? html` <span class="d2">${money(cost - state.cash)} short</span>` : null}
        ${why.map((w) => html`<div class="why">${w}</div>`)}
      </span>
    </button>
    ${open && !plan.problem && !rowPlan.problem ? html`<button class="act rowbuy" disabled=${state.cash < rowCost} onMouseEnter=${hover} onClick=${() => buyAndSay(sku, G.RACKS_PER_ROW)}>add a row of ${G.RACKS_PER_ROW}, ${money(rowCost)}</button>` : null}
  </div>`;
}
// ---- Products layer ----
function Products() {
  const sold = state.stats.soldByTier || {};
  const live = G.APPS.filter((a) => G.appLevel(state, a.id));
  const earning = live.reduce((n, a) => n + (sold[a.tier]?.toApps || 0), 0);
  return html`<div class="wide spaced">
    <p class="help" style="margin:0 0 14px;max-width:80ch">The open markets fill up. A product makes its own buyers, who pay more than the market and get served first. They arrive slowly and leave if you can't serve them, so each one needs machines running that size of model.${live.length ? ` Your products take ${tok(earning)} MTok a day.` : ""}</p>
    ${G.APPS.map((a) => {
      const level = G.appLevel(state, a.id);
      const open = G.appAvailable(state, a);
      const size = G.TIERS[a.tier].name.toLowerCase();
      const want = G.appDemand(state, a.tier);
      const served = sold[a.tier]?.toApps || 0;
      const cap = G.appCapacity(state, a.id);
      const short = level && want > 0 && served < want * 0.98;
      const cost = G.appNextCost(state, a.id);
      const maxed = level >= G.APP_LEVELS;
      const q = open && !maxed ? remembered(`app|${a.id}|${level}|${Math.round(G.appDemand(state, a.tier))}|${state.contract?.client || ""}|${JSON.stringify(state.research?.levels || {})}|${G.allUnits(state).map((u) => `${u.modelId}${u.quant}${u.on}${u.task}`).join()}`, () => G.quoteUpgrade(state, (c) => G.launchApp(c, a.id, true), true)) : null;
      const made = sold[a.tier]?.supply || 0;
      const pays = made && q && q.gain > 0.01 ? Math.ceil(cost / q.gain) : null;
      return html`<section class="appcard" key=${a.id}>
        <div class="apphead">
          <span class=${`name ${open ? "" : "d2"}`}>${a.name}${level ? `, version ${level}` : ""}</span>
          <span class="small d1">${G.TIERS[a.tier].name} models, ${a.mult}x market price</span>
        </div>
        <p class=${`small ${open ? "d1" : "d2"}`} style="margin:2px 0 4px">${a.text}</p>
        ${level ? html`<div class="line"><span class="d1">Users want</span><span>${tok(want)} of ${tok(cap)} MTok a day this version can hold</span></div>
          <${Bar} value=${cap ? want / cap : 0} />
          <div class="line"><span class=${short ? "sig" : "d1"}>You serve</span><span class=${short ? "sig" : ""}>${tok(served)} MTok a day${short ? `. Users are leaving: put more on a ${size} model.` : ""}</span></div>
          ${short ? html`<button class="act" onClick=${() => { ui.layer = "models"; draw(); }}>open models</button>` : null}` : null}
        ${maxed ? html`<p class="small d1" style="margin:4px 0 0">As big as it gets.</p>` : !open ? html`<p class="small d2" style="margin:4px 0 0">Needs a ${G.SITES.find((x) => x.id === a.site).name.toLowerCase()}.</p>` : html`<button class="act lead" disabled=${state.cash < cost} onClick=${() => { const r = G.launchApp(state, a.id); freshMoves(); doIt(r); }}>${level ? `build version ${level + 1}` : "launch it"}, ${money(cost)}</button>
          <span class="small d1"> ${pays ? `Once it fills: about +${moneyShort(q.gain)} a day, paid back in ${pays.toLocaleString("en-US")} days after that.` : `Nothing makes ${size}-model tokens yet. Put a machine on one, or this earns nothing.`}</span>`}
      </section>`;
    })}
  </div>`;
}
// ---- Models layer ----
/** The production line at a glance: every model being made, how much, and on what. */
function Production() {
  const p = G.production(state);
  const on = (u) => (u.sku ? `${u.name}, ${u.racks} ${G.skuOf(u).short}` : u.name);
  ui.more ||= {};
  return html`<section class="prod">
    <h2 class="hd">What you're making: ${tok(p.mtok)} MTok a day, ${tok(p.sold)} of it sold, ${moneyAny(p.revenue)} a day</h2>
    <div class="prodrow prodhead"><span>Model</span><span>Size</span><span class="num">MTok a day</span><span class="num">Share</span><span class="num">Sold</span><span class="num">Sales a day</span><span>Running on</span></div>
    ${p.list.map((r) => {
      const id = `prod${r.model.id}`;
      const open = ui.more[id];
      const n = r.units.length;
      return html`<div key=${r.model.id}>
        <button class="prodrow" disabled=${!n} onClick=${() => { ui.more[id] = !open; draw(); }}>
          <span class=${r.own ? "sig" : "d0"}>${r.model.name}${r.own ? ", yours" : ""}</span>
          <span class="d1">${G.TIERS[r.model.tier].name}</span>
          <span class="num">${tok(r.mtok)}</span>
          <span class="num d1">${p.mtok ? `${Math.round((r.mtok / p.mtok) * 100)}%` : "0%"}</span>
          <span class=${`num ${r.mtok && r.sold < r.mtok * 0.98 ? "sig" : "d1"}`}>${r.mtok ? `${Math.round((r.sold / r.mtok) * 100)}%` : "-"}</span>
          <span class="num">${moneyAny(r.revenue)}</span>
          <span class="d1">${n ? `${open ? "v" : ">"} ${n === 1 ? on(r.units[0]) : `${n} machines and racks`}` : "nothing yet"}</span>
        </button>
        ${open && n ? html`<div class="prodin">${r.units.map((u) => html`<button key=${u.id} class="act" onClick=${() => { if (u.sku) { ui.rowId = u.id; ui.modelsRow = u.id; } else { ui.machineId = u.id; ui.modelsRow = null; } draw(); }}>${on(u)}, ${tok(u.output.mtok)} MTok, ${moneyAny(u.output.revenue || 0)}</button>`)}</div>` : null}
        ${!n && r.own ? html`<div class="prodin"><button class="act lead" onClick=${() => { doIt(G.loadEverywhere(state, r.model.id)); }}>run it everywhere it fits</button></div>` : null}
      </div>`;
    })}
    ${p.busy.length ? html`<p class="small d1" style="margin:4px 0 0">Also training, and earning nothing until it's done: ${names(p.busy.map((u) => u.name))}.</p>` : null}
  </section>`;
}
function Models({ m }) {
  const unitPick = (x) => () => { if (x.sku) { ui.rowId = x.id; ui.modelsRow = x.id; } else { ui.machineId = x.id; ui.modelsRow = null; } draw(); };
  const models = G.allModels(state);
  // Biggest thing this machine can run comes first; what's out of reach follows, nearest first.
  const tiers = ["tiny", "small", "medium", "large", "frontier"];
  const reachable = tiers.filter((t) => models.some((x) => x.tier === t && Object.keys(x.sizes).some((q) => G.modelFit(state, m, x, q).fits)));
  const order = [...reachable.reverse(), ...tiers.filter((t) => !reachable.includes(t))];
  const cards = m.sku ? [] : m.gpus.map((g) => G.part("gpus", g.id));
  const perCard = m.sku ? G.skuOf(m).gb : cards.length ? Math.max(...cards.map((c) => c.vram)) : 0;
  const bestPick = G.isComplete(m) ? G.bestModelFor(state, m) : null;
  return html`<div class="wide spaced">
    <${Production} />
    <h2 class="hd spaced">Change what a machine or rack runs</h2>
    <div class="modelhead">
      <h2 class="big plain">${m.sku ? `${m.name}: ${m.racks} ${G.skuOf(m).short} ${m.racks === 1 ? "rack" : "racks"}, ${perCard} GB a card, up to ${G.totalVram(m).toLocaleString("en-US")} GB linked` : `${m.name}: ${G.totalVram(m)} GB of GPU memory, ${perCard} GB on its biggest card`}</h2>
      ${G.allUnits(state).length > 1 ? (G.allUnits(state).length <= 8 ? html`<div class="pickers">${G.allUnits(state).map((x) => html`<button key=${x.id} class=${`act ${x.id === m.id ? "on" : ""}`} onClick=${unitPick(x)}>${x.name}</button>`)}</div>` : html`<${More} id="modelunits" title=${`Look at a different machine or rack: ${G.allUnits(state).length}`}><div class="pickers">${G.allUnits(state).map((x) => html`<button key=${x.id} class=${`act ${x.id === m.id ? "on" : ""}`} onClick=${unitPick(x)}>${x.name}</button>`)}</div></${More}>`) : null}
      <${More} id="modelhelp" title="How models fit on cards"><p class="help" style="margin:0">If a model fits on one card, every card runs a copy. If it needs more than one card, it gets split: that adds room, not speed. Fast sparse models sell for less. Big dense ones sell for more.</p></${More}>
    </div>
    ${order.map((tier) => {
      const inTier = models.filter((x) => x.tier === tier);
      if (!inTier.length) return null;
      const sold = state.stats.soldByTier[tier];
      return html`<section key=${tier} class="tiergroup"><h2 class="tier">${G.TIERS[tier].name} models. Buyers want ${tok(G.tierDemand(state, tier))} MTok a day${sold ? `, you sell ${tok(sold.sold)}` : ""}.${state.contract?.tier === tier ? ` ${state.contract.client} has a deal for this size.` : state.offer?.tier === tier ? ` ${state.offer.client} is offering a deal for this size.` : ""}</h2>
      <${TierBuild} m=${m} tier=${tier} models=${inTier} perCard=${perCard} />
      ${inTier.map((model) => html`<${ModelRow} key=${model.id} m=${m} model=${model} best=${bestPick?.model.id === model.id} bestQuant=${bestPick?.quant} noPath=${!m.sku && tier !== "tiny" && !holdsWhole(m, inTier)} />`)}</section>`;
    })}
  </div>`;
}
/** Why your machines earn different amounts, and one button to bring the weaker ones up to your best. */
function MatchBest() {
  if (state.machines.length < 2) return null;
  const plan = remembered("matchbest", () => G.matchPlan(state));
  if (!plan || !plan.waiting) return null;
  const go = () => { const r = G.matchBest(state); freshMoves(); if (r.ok) flashNote(`Brought ${r.done} of ${r.of} ${r.of === 1 ? "machine" : "machines"} up to ${plan.best.name}'s spec.`); doIt(r); };
  const short = plan.count && state.cash < plan.cost;
  const n = plan.count;
  return html`<div class="matchbest">
    <p class="small d1">${plan.why} ${plan.waiting} ${plan.waiting === 1 ? "other machine nets" : "others net"} ${plan.waiting === 1 ? moneyShort(plan.low) : `${moneyShort(plan.low)} to ${moneyShort(plan.high)}`} a day.</p>
    ${n && plan.gain > 0.5 ? html`<button class="act lead" onClick=${go}>bring ${short ? "what you can afford of " : ""}${n === 1 ? "one" : `${n}`} up to ${plan.best.name}: ${money(plan.cost)}, +${moneyShort(plan.gain)} a day, back in ${Math.ceil(plan.payback).toLocaleString("en-US")} days</button>` : n ? html`<p class="small d2">Matching it wouldn't earn more today: buyers for that size are full.</p>` : null}
    ${plan.stopped ? html`<p class="small d2">${n ? `Stops after ${n}: ` : "Can't match them now: "}${plan.stopped}</p>` : null}
  </div>`;
}
/** When this machine can only run a size split across cards, say why, and offer the best new machine for that size. */
/** Whether this machine can hold some model of the size whole on one card, where every card works. */
const holdsWhole = (m, models) => models.some((x) => Object.keys(x.sizes).some((q) => { const f = G.modelFit(state, m, x, q); return f.fits && (f.mode === "single" || f.mode === "copies"); }));
function TierBuild({ m, tier, models, perCard }) {
  if (m.sku || tier === "tiny" || holdsWhole(m, models)) return null;
  const need = G.cardNeed(state, tier);
  const plan = remembered(`tierbuild|${tier}`, () => G.tierBuild(state, tier));
  const name = G.TIERS[tier].name.toLowerCase();
  const build = () => { const r = G.buildForTier(state, tier, plan.cost); freshMoves(); if (r.stale) slowKey = ""; if (r.ok) { ui.machineId = r.id; flashNote(`Built ${r.plan.n} x ${G.shortName(r.plan.card)} running ${r.plan.model.name}.`); } doIt(r); };
  return html`<div class="tierbuild">
    <p class="small d1">${G.TIERS[tier].name} models need about ${need.rough} GB on one card at rough quality, ${need.standard} GB at standard. ${perCard ? `This machine's biggest card has ${perCard} GB, so here they'd be split across cards, where only one works at a time and the slowest sets the pace.` : ""}</p>
    ${plan.problem ? html`<p class="small d2">${plan.problem}</p>` : html`<button class="act lead" disabled=${state.cash < plan.cost} onClick=${build}>build the machine that pays back fastest on ${name} models: ${plan.n} x ${G.shortName(plan.card)}, ${money(plan.cost)}, about +${money(plan.perDay)} a day, back in ${Math.ceil(plan.payback)} days</button>${state.cash < plan.cost ? html`<span class="small d2"> ${money(plan.cost - state.cash)} short</span>` : null}`}
  </div>`;
}
// fitPath and quotes try things on copies of the game, so keep the answer until the setup changes.
const slowCache = new Map();
let slowKey = "";
function remembered(key, compute) {
  // Prices drift a little every tick, so round them; a loaded model, a hire or a deal changes the answers too.
  const setup = JSON.stringify([Math.floor(state.day / 5), state.site, state.tech, G.totalRacks(state), Math.round(state.index.gpus * 50), Math.round(state.index.memory * 50), state.racks, state.team, state.research?.levels, state.contract?.tier, state.rules, state.world?.gen, state.curtail?.until, state.salesRef && Math.round(Math.log(state.salesRef) * 20), state.rows.map((r) => [r.id, r.racks, r.on, r.tuned, r.modelId]), state.machines.map((x) => [x.id, x.chassis, x.board, x.gpus.map((g) => g.id), x.psus, x.memory, x.modelId, x.quant, x.on, x.task])]);
  if (setup !== slowKey) {
    slowKey = setup;
    slowCache.clear();
  }
  if (!slowCache.has(key)) slowCache.set(key, compute());
  return slowCache.get(key);
}
const HOW = { single: () => "fits on one card", copies: (f) => `${f.copies} copies, one per card`, split: (f) => `split across ${f.copies === 1 ? "cards" : "cards"}, no extra speed`, spill: () => "spills into RAM, slow" };
function ModelRow({ m, model, best, bestQuant, noPath = false }) {
  const cur = m.modelId === model.id;
  const sparse = G.sparseRatio(model) < 1;
  const options = Object.keys(model.sizes).map((q) => ({ q, e: G.estimateEarn(state, m, model, q) }));
  const anyFits = options.some((o) => o.e.fit.fits && o.e.fit.mode !== "spill");
  // Where a size only fits split, the cheapest way to make it fit is a trap; the build line above the size offers the real answer.
  const path = !anyFits && !m.sku && m.gpus.length && !noPath ? remembered(`path|${m.id}|${model.id}`, () => G.fitPath(state, m, model)) : null;
  const follow = () => {
    if (state.cash < path.cost) {
      flash(`You need ${money(path.cost - state.cash)} more.`);
      return;
    }
    const target = state.machines.find((x) => x.id === path.run(state)) || m;
    const q = Object.keys(model.sizes).find((x) => G.modelFit(state, target, model, x).fits);
    if (q) G.loadModel(state, target.id, model.id, q);
    ui.machineId = target.id;
    flashNote(`Done: ${path.label}. ${target.name} is running ${model.name}.`);
  };
  return html`<div class=${`model ${cur ? "cur" : ""}`}>
    <div class="mtitle">
      <div class="nm">${cur ? html`<span class="sig">> </span>` : null}${model.name}${best ? html` <span class="tag">pays most on this machine</span>` : null}</div>
      <div class="small d2">${sparse ? `Sparse: only ${model.active}B of ${Math.round(model.params)}B parameters work per word. Fast, sells cheap.` : model.own ? "Yours." : model.goodAt}${ageNote(model) ? ` ${ageNote(model)}` : ""}</div>
      ${path ? html`<button class="act" onClick=${follow}>to run it: ${path.label}, ${money(path.cost)}</button>` : !anyFits && !options.some((o) => o.e.fit.fits) && !noPath ? html`<div class="small d2">Too big for anything you can add here. Sell a machine to free a floor spot, or move up.</div>` : null}
    </div>
    <div class="qs">
      ${options.map(({ q, e }) => {
        const on = cur && m.quant === q;
        return html`<button key=${q} class=${`qopt ${on ? "on" : ""} ${e.fit.fits ? "" : "no"}`} disabled=${!e.fit.fits || !G.isComplete(m)} onClick=${() => doIt(G.loadModel(state, m.id, model.id, q), false)}>
          <span class="ql">${G.QUANT_NAMES[q]}, ${gb(e.fit.size)}</span>
          ${e.fit.fits ? html`<span class="qm">${moneyAny(e.perDay)}<span class="small"> a day</span></span>
          <span class="qn">${tok(e.fit.tokS)} tok/s at ${moneyAny(e.rate)}</span>
          <span class="qn">${e.limitedBy === "buyers" ? "buyers are full" : m.sku ? e.fit.label : HOW[e.fit.mode](e.fit)}</span>` : html`<span class="qn">needs ${e.fit.short} GB more</span>`}
        </button>`;
      })}
    </div>
  </div>`;
}

// ---- Market layer ----
const openRow = (r) => { ui.layer = "room"; ui.floorTab = "here"; ui.worldSel = `${r.id}-0`; ui.rowId = r.id; ui.modelsRow = r.id; draw(); };
/** Thirty machines built the same are one thing to think about. Groups by parts and model, biggest earners first. */
function designGroups() {
  const groups = new Map();
  for (const x of state.machines) {
    const k = G.machineSheet(state, x);
    // Same parts, same settings, same state. A machine that differs where it matters gets its own line.
    const sig = G.isComplete(x) ? `${x.gpus.map((g) => g.id).sort().join()}|${x.board}|${x.psus}|${x.memory}|${x.tuned}|${x.modelId}|${x.quant}|${x.on}|${x.task}|${x.forDeal ? 1 : 0}|${k.word}` : `draft${x.id}`;
    if (!groups.has(sig)) groups.set(sig, { key: sig, list: [], net: 0, sales: 0, power: 0, paid: 0 });
    const g = groups.get(sig);
    g.list.push(x);
    g.net += k.net;
    g.sales += k.sales;
    g.power += k.dayCost;
    g.paid += G.machineSpend(state, x).total;
    g.model = k.model?.name || k.word;
    g.word = k.word;
  }
  for (const g of groups.values()) {
    const counts = {};
    g.list[0].gpus.forEach((c) => { const n = label(G.part("gpus", c.id)); counts[n] = (counts[n] || 0) + 1; });
    g.gear = Object.entries(counts).map(([n, c]) => (c > 1 ? `${c} x ${n}` : n)).join(", ") || "no GPU";
  }
  return [...groups.values()].sort((a, b) => b.net - a.net);
}
/** Detail stays one click away and out of the way until you want it. */
function More({ id, title, open = false, children }) {
  ui.more ||= {};
  const on = ui.more[id] ?? open;
  return html`<div class="more"><button class="morebtn" aria-expanded=${on} onClick=${() => { ui.more[id] = !on; draw(); }}><span class="sig">${on ? "v" : ">"}</span> ${title}</button>${on ? html`<div class="morein">${children}</div>` : null}</div>`;
}
/** A deal's numbers, kept until the setup changes. */
function dealQuote(deal, offer) {
  const key = `deal|${deal.client}|${deal.mtok}|${Math.floor(deal.done || 0)}|${state.site}|${state.cooling.length}|${state.feed}|${G.allUnits(state).map((u) => `${u.id}${u.modelId}${u.quant}${u.on}${u.task}${u.racks || ""}${u.gpus?.length || ""}${u.forDeal ? 1 : 0}`).join()}`;
  return remembered(key, () => {
    const q = offer ? G.dealGain(state) : G.dealForecast(state);
    const v = G.dealView(state, deal, q.made);
    const enough = v.enough && !q.trips;
    return { gain: q.gain || 0, view: { ...v, enough }, trips: q.trips, plan: enough ? null : G.dealPlan(state, deal) };
  });
}
const sign = (n) => `${n < 0 ? "-" : "+"}${moneyAny(Math.abs(n))}`;
const names = (list, most = 3) => `${list.slice(0, most).join(", ")}${list.length > most ? `, and ${list.length - most} more` : ""}`;
// Plans are worked out fresh on the click, since the offer may have sat on screen a while.
const takeWith = (machines) => () => {
  const plan = machines ? G.dealPlan(state, state.offer) : null;
  G.acceptContract(state);
  if (plan) G.assignToDeal(state, plan.moves);
  freshMoves();
  doIt({ ok: true });
};
const giveNow = () => {
  const plan = G.dealPlan(state, state.contract);
  const r = plan.moves.length ? G.assignToDeal(state, plan.moves) : { ok: false, reason: "Nothing else can run that size." };
  freshMoves();
  doIt(r);
};
/** A private deal in plain terms: what it needs, what you make, what happens either way. */
function DealCard({ deal, offer = false }) {
  const q = dealQuote(deal, offer);
  const v = q.view;
  const plan = q.plan;
  const size = G.TIERS[deal.tier].name.toLowerCase();
  const given = G.allUnits(state).filter((u) => u.forDeal);
  const canFill = plan && plan.moves.length > 0;
  return html`<div class="dealcard">
    <p class="d0" style="margin:0">${deal.client} ${offer ? "wants" : "needs"} ${tok(deal.mtok)} MTok of ${size}-model tokens${offer ? ` within ${deal.days} days` : `, ${Math.ceil(v.left)} days left`}, paying ${deal.rate}x the market price.</p>
    ${offer ? null : html`<${Bar} value=${v.done / deal.mtok} />`}
    <div class="line"><span class="d1">It needs</span><span>${tok(v.need)} MTok a day</span></div>
    <div class="line"><span class=${v.enough ? "d1" : "sig"}>You make</span><span class=${v.enough ? "" : "sig"}>${tok(v.made)} MTok a day, on ${v.units.length ? names(v.units) : `no ${size} model yet`}</span></div>
    ${q.trips ? html`<p class="sig" style="margin:4px 0 0">Running flat out for this would trip your breaker.</p>` : v.enough ? html`<p class="d0" style="margin:4px 0 0">That's enough. You'll deliver on time as things stand.</p>` : plan?.trips ? html`<p class="sig" style="margin:4px 0 0">Moving enough machines over would trip your breaker. Add power first, or cut something else.</p>` : canFill && plan.enough ? html`<p class="sig" style="margin:4px 0 0">Not enough yet. ${names(plan.moves.map((x) => x.name))} can cover it, moving to ${names([...new Set(plan.moves.map((x) => x.modelName))], 2)}. Their other sales stop until the deal ends, then they go back.</p>` : canFill ? html`<p class="sig" style="margin:4px 0 0">Even with every machine that can run a ${size} model, you'd reach ${Math.round(plan.finish * 100)}%.</p>` : html`<p class="sig" style="margin:4px 0 0">At this rate you'd reach ${Math.round(v.finish * 100)}%, and none of your other machines can run a ${size} model. That takes more GPU memory.</p>`}
    <div class="dealverbs">
      ${offer ? (v.enough ? html`<button class="act lead" onClick=${takeWith(false)}>take the deal</button>` : canFill && !plan.trips ? html`<button class=${`act ${plan.enough ? "lead" : ""}`} onClick=${takeWith(true)}>take it and give it ${plan.moves.length} ${plan.moves.length === 1 ? "machine" : "machines"}${plan.enough ? "" : `, reaching ${Math.round(plan.finish * 100)}%`}</button><button class="act" onClick=${takeWith(false)}>take it as is</button>` : html`<button class="act" onClick=${takeWith(false)}>take it as is</button>`) : canFill && !plan.trips ? html`<button class=${`act ${plan.enough ? "lead" : ""}`} onClick=${giveNow}>give it ${plan.moves.length} ${plan.moves.length === 1 ? "machine" : "machines"}${plan.enough ? "" : `, reaching ${Math.round(plan.finish * 100)}%`}</button>` : null}
      ${offer ? html`<button class="act" onClick=${() => { G.declineContract(state); draw(); }}>pass</button>` : null}
    </div>
    ${offer ? html`<p class="small d1" style="margin:2px 0 0">${canFill && !plan.trips ? `Profit a day while it runs: about ${sign(plan.gain)} with those machines, ${sign(q.gain)} as is.` : `Changes profit by about ${sign(q.gain)} a day while it runs.`} Offer ends in ${Math.ceil(deal.expires - state.day)} days.</p>` : null}
    ${!offer && given.length ? html`<div class="small d1 dealgiven">Given to this deal: ${given.map((u) => html`<button key=${u.id} class="act small" onClick=${() => { G.takeBackFromDeal(state, u.id); freshMoves(); draw(); }}>${u.name}, take back</button>`)}</div>` : null}
    ${!offer && !v.enough && plan?.candidates.length ? html`<${More} id="dealpick" title="Pick machines yourself"><div class="iverbs">${plan.candidates.slice(0, 10).map((c) => html`<button key=${c.id} class="act" onClick=${() => { const r = G.assignToDeal(state, [c]); freshMoves(); doIt(r); }}>${c.name}: +${tok(c.add)} MTok a day, gives up ${moneyAny(c.lost)} a day</button>`)}</div></${More}>` : null}
    <${More} id="dealhow" title="How deals work"><p class="small d1" style="margin:0">You don't need to assign anything if you already make enough: whatever runs a ${size} model fills this deal first, and the rest sells to the market. Deliver it all in time for +${v.winRep} reputation. You're paid as tokens ship. Miss the deadline and you keep what you were paid, but lose ${v.loseRep} reputation, about ${Math.max(1, Math.round(v.buyersLost * 100))}% of your buyers.</p></${More}>
  </div>`;
}
/** On every screen, so a deal is never out of reach or out of sight. */
function DealStrip() {
  const deal = state.contract;
  const offer = state.offer;
  if (!deal && !offer) return null;
  const go = () => { ui.layer = "market"; draw(); };
  const see = html`<button class="act small" onClick=${go}>details</button>`;
  if (deal) {
    const q = dealQuote(deal, false);
    return html`<div class="dealstrip"><span class="d0">${deal.client}: ${tok(q.view.done)} of ${tok(deal.mtok)} MTok, ${Math.ceil(q.view.left)} days left.</span> <span class=${q.view.enough ? "d1" : "sig"}>${q.view.enough ? "On track." : `Behind: needs ${tok(q.view.need)} a day, you make ${tok(q.view.made)}.`}</span>${!q.view.enough && q.plan?.enough ? html`<button class="act lead" onClick=${giveNow}>give it ${q.plan.moves.length} ${q.plan.moves.length === 1 ? "machine" : "machines"}</button>` : null}${see}</div>`;
  }
  const q = dealQuote(offer, true);
  const fill = q.plan?.enough && q.plan.moves.length ? q.plan : null;
  return html`<div class="dealstrip"><span class="sig">${offer.client} offers a deal:</span> <span class="d0">${tok(offer.mtok)} ${G.TIERS[offer.tier].name.toLowerCase()}-model MTok in ${offer.days} days at ${offer.rate}x.</span> <span class=${q.view.enough ? "d1" : "sig"}>${q.view.enough ? "You make enough." : fill ? `Needs ${fill.moves.length} more ${fill.moves.length === 1 ? "machine" : "machines"}.` : "You can't make enough."}</span><span class="d2 small"> ${Math.ceil(offer.expires - state.day)} days to answer.</span>
    ${q.view.enough ? html`<button class="act lead" onClick=${takeWith(false)}>take it</button>` : fill ? html`<button class="act lead" onClick=${takeWith(true)}>take it and give it ${fill.moves.length} ${fill.moves.length === 1 ? "machine" : "machines"}</button>` : null}${see}<button class="act small" onClick=${() => { G.declineContract(state); draw(); }}>pass</button></div>`;
}
// ---- The living world ----
const pct = (f) => `${Math.round(f * 100)}%`;
const anyRule = () => Object.values(state.rules || {}).some(Boolean);
function ageNote(model) {
  if (model.aged) return `${model.aged === 1 ? "A generation" : `${model.aged} generations`} behind: sells for ${pct(Math.pow(G.AGE_PRICE, model.aged))} of its price.`;
  if (model.gen && G.ruleOn(state, "gens")) return `Generation ${model.gen}'s frontier model.`;
  return null;
}
/** The generation clock, your model's age, what's on order and where prices stand, in a few lines. */
function WorldStrip({ full = false }) {
  const w = state.world;
  // Paid racks on order or at the dock always show, whatever the rules say.
  if (!w || (!anyRule() && !w.orders?.length && !Object.keys(w.dock || {}).length)) return null;
  const lines = [];
  if (G.ruleOn(state, "gens")) {
    if (w.next) {
      const days = Math.max(0, Math.ceil(w.next.lands - state.day));
      lines.push(html`<span class="d0">Generation ${w.gen}.</span> <span class="d1">${w.next.told ? `${G.genSku(w.next.gen).name} and ${G.genModel(w.next.gen).name} land in ${days} days.` : `The next one is announced in ${Math.max(0, days - 150)} days.`}</span>`);
    } else lines.push(html`<span class="d1">The frontier starts moving once you run a data center.</span>`);
    const own = G.ownFrontier(state);
    const units = G.weakerHalf(state);
    const train = () => { const r = G.startProject(state, "train", units.map((u) => u.id)); freshMoves(); doIt(r); };
    if (state.project) lines.push(html`<span class="d1">Training: ${pct(state.project.work / state.project.need)} done${state.project.gen > w.gen ? `, aimed at generation ${state.project.gen}` : ""}.</span>`);
    else if (own && own.aged) {
      const days = Math.ceil(G.trainingDays(state, "train", units));
      lines.push(html`<span class="sig">${own.name} is ${own.aged === 1 ? "a generation" : `${own.aged} generations`} old and sells for ${pct(Math.pow(G.AGE_PRICE, own.aged))} of its price.</span> ${units.length ? html`<button class="act lead" onClick=${train}>train a new one on your weaker half, about ${days.toLocaleString("en-US")} days</button>` : null}`);
    } else if (own && w.next?.told && (own.gen || 0) <= w.gen && units.length) {
      const days = Math.ceil(G.trainingDays(state, "train", units));
      lines.push(html`<span class="d1">Train now and your next model lands as generation ${w.next.gen}'s frontier.</span> <button class="act" onClick=${train}>train on your weaker half, about ${days.toLocaleString("en-US")} days</button>`);
    }
  }
  const orders = w.orders || [];
  if (orders.length) {
    const n = orders.reduce((k, o) => k + o.n, 0);
    const soon = Math.min(...orders.map((o) => o.ready));
    lines.push(html`<span class="d1">On order: ${n} ${n === 1 ? "rack" : "racks"}, the first in ${Math.max(0, Math.ceil(soon - state.day))} days.</span>`);
  }
  for (const [id, n] of Object.entries(w.dock || {})) {
    lines.push(html`<span class="sig">${n} ${G.genSku(id).short} ${n === 1 ? "rack is" : "racks are"} waiting at the dock.</span> <button class="act lead" onClick=${() => { freshMoves(); doIt(G.installDock(state, id)); }}>install ${n === 1 ? "it" : "them"}</button>`);
  }
  if (G.ruleOn(state, "market") && state.marketView) {
    const tiers = Object.entries(state.marketView).filter(([t]) => full || state.stats.soldByTier?.[t]);
    const off = tiers.filter(([, v]) => Math.abs(v.factor - 1) >= 0.05);
    if (off.length) lines.push(html`<span class="d1">Prices: ${off.map(([t, v]) => `${G.TIERS[t].name.toLowerCase()} ${pct(v.factor)} of normal`).join(", ")}.</span>`);
  }
  if (!lines.length) return null;
  return html`<div class="worldstrip">${lines.map((l, i) => html`<div key=${i}>${l}</div>`)}</div>`;
}
/** A rack that comes in allocations: order it, then it ships on launch day or a month later. */
function OrderItem({ sku, pre, ready }) {
  const left = G.allocationLeft(state);
  const each = Math.round(sku.price * state.index.gpus);
  const n = Math.min(G.RACKS_PER_ROW, left);
  const order = (k) => { const r = G.orderRacks(state, sku.id, k); freshMoves(); if (r.ok) flashNote(`Ordered ${k} ${sku.short} ${k === 1 ? "rack" : "racks"}. ${pre ? "They ship on launch day." : "They arrive in 30 days."}`); else flash(r.reason); };
  const days = Math.max(0, Math.ceil(ready - state.day));
  return html`<div class="rackitem">
    <button class=${`item ${left < 1 || state.cash < each ? "off" : ""}`} onClick=${() => order(1)}>
      <span class="pic"><img src=${art(sku.art)} alt="" loading="lazy" /></span>
      <span>
        <span class="name">${sku.name}${pre ? html` <span class="tag">preorder</span>` : null}</span><br />
        <span class="price">${money(each)}</span>
        <div class="why">${sku.cards} cards, ${sku.gb} GB each, ${sku.kW} kW, cooled by water</div>
        <div class="why">${pre ? `Ships on launch day, in ${days} days.` : "Arrives 30 days after you order."} Your allocation has ${left} of ${G.allocation(state)} left this month.</div>
        <div class="why">Arrives paid for. Floor, cooling and switches are bought when it goes in.</div>
      </span>
    </button>
    ${n > 1 ? html`<button class="act rowbuy" disabled=${state.cash < each * n} onClick=${() => order(n)}>order ${n}, ${money(each * n)}</button>` : null}
  </div>`;
}
/** Switch each living-world rule on or off, for this company. */
function RulesPanel() {
  return html`<div class="rules">
    <h3 class="hd">World rules for this company</h3>
    ${G.RULES.map((r) => html`<div key=${r.id} class="rule">
      <button class=${`act ${G.ruleOn(state, r.id) ? "on" : ""}`} onClick=${() => { G.setRule(state, r.id, !G.ruleOn(state, r.id)); freshMoves(); draw(); }}>${r.name}: ${G.ruleOn(state, r.id) ? "on" : "off"}</button>
      <p class="small d1">${r.text}</p>
    </div>`)}
    <p class="small d2">Turning a rule off puts that part back the way it was. Your racks, models and money stay.</p>
  </div>`;
}

function UnitBooks() {
  const rows = state.rows.map((r) => { const n = rowNumbers(r); return { key: `r${r.id}`, name: `${r.name}, ${r.racks} ${G.skuOf(r).short}`, what: n.model?.name || "nothing", sales: n.sales, power: n.power, net: n.net, paid: n.spent, open: () => openRow(r) }; });
  const designs = designGroups().map((g) => ({ key: g.key, name: g.list.length > 1 ? `${g.list.length} x ${g.gear}` : g.list[0].name, what: g.model, sales: g.sales, power: g.power, net: g.net, paid: g.paid, group: g, open: () => { ui.machineId = g.list[0].id; ui.layer = "machine"; draw(); } }));
  const units = [...rows, ...designs].sort((a, b) => b.net - a.net);
  const line = (u, click) => html`<button class="bookrow" key=${u.key} onClick=${click}>
    <span class="d0">${u.name}</span><span class="d1">${u.what}</span><span class="num">${moneyShort(u.sales)}</span><span class="num d1">${moneyShort(u.power)}</span><span class=${`num ${u.net < 0 ? "sig" : "d0"}`}>${moneyShort(u.net)}</span><span class="num d1">${moneyShort(u.paid)}</span><span class="num d1">${u.net > 0 ? `${Math.ceil(u.paid / u.net).toLocaleString("en-US")} d` : "never"}</span>
  </button>`;
  ui.more ||= {};
  return html`<section class="books">
    <div class="bookrow bookhead"><span>Unit</span><span>Running</span><span class="num">Sales</span><span class="num">Power</span><span class="num">Net a day</span><span class="num">Cost new</span><span class="num">Back in</span></div>
    ${units.map((u) => {
      if (!u.group || u.group.list.length < 2) return line(u, u.open);
      const id = `books${u.key}`;
      const on = ui.more[id];
      return html`<div key=${u.key}>${line({ ...u, name: `${on ? "v" : ">"} ${u.name}` }, () => { ui.more[id] = !on; draw(); })}
        ${on ? u.group.list.map((x) => { const k = G.machineSheet(state, x); const paid = G.machineSpend(state, x).total; return html`<div class="bookin" key=${x.id}>${line({ key: x.id, name: x.name, what: k.model?.name || k.word, sales: k.sales, power: k.dayCost, net: k.net, paid }, () => { ui.machineId = x.id; ui.layer = "machine"; draw(); })}</div>`; }) : null}</div>`;
    })}
  </section>`;
}
function Market() {
  const s = state.stats;
  const offer = state.offer;
  const deal = state.contract;
  const order = ["tiny", "small", "medium", "large", "frontier"];
  const units = state.machines.filter(G.isComplete).length + state.rows.length;
  const nets = [...state.machines.filter(G.isComplete).map((x) => G.machineSheet(state, x).net), ...state.rows.map((r) => rowNumbers(r).net)];
  const done = G.MILESTONES.filter((x) => state.milestones.includes(x.id)).length;
  return html`<div class="wide"><${Ledger} /><${WorldStrip} full=${true} /><div class="cols moneytop">
    <section>
      <h2 class="hd">Private deals</h2>
      ${deal ? html`<${DealCard} deal=${deal} />` : null}
      ${offer ? html`<${DealCard} deal=${offer} offer=${true} />` : null}
      ${!deal && !offer ? html`<p class="d2" style="margin:0">Nobody's asking right now. When someone does, it shows at the bottom of every screen.</p>` : null}
    </section>
    <section>
      <h2 class="hd">Token market</h2>
      ${(() => {
        const list = order.map((t) => ({ t, v: s.soldByTier[t] })).filter((x) => x.v);
        const made = list.reduce((n, x) => n + x.v.supply, 0);
        const moved = list.reduce((n, x) => n + x.v.sold, 0);
        const revenue = (t) => G.allUnits(state).reduce((n, u) => n + (u.output?.model?.tier === t ? u.output.revenue || 0 : 0), 0);
        const top = list.map((x) => ({ ...x, r: revenue(x.t) })).sort((a, b) => b.r - a.r)[0];
        if (!top || !made) return null;
        const share = s.revenuePerDay ? Math.round((top.r / s.revenuePerDay) * 100) : 0;
        const full = top.v.sold >= top.v.demand * 0.98 + (top.v.toApps || 0);
        return html`<p class="small d1" style="margin:0 0 6px">You sell ${Math.round((moved / made) * 100)}% of what you make. ${G.TIERS[top.t].name} models bring ${share}% of your sales${full ? ", and that market is full" : ""}.</p>`;
      })()}
      ${order.map((t) => {
        const sold = s.soldByTier[t];
        const mv = G.ruleOn(state, "market") ? state.marketView?.[t] : null;
        return html`<div class="line" key=${t}><span class=${sold ? "d0" : "d2"}>${G.TIERS[t].name}, ${moneyAny(G.tierPrice(state, t))} per MTok${mv ? `, ${pct(mv.factor)} of normal` : ""}${state.surge[t] ? ", demand surging" : ""}${mv ? html`<br /><span class="small d2">Everyone else makes ${tok(mv.world)} of the ${tok(mv.want)} MTok buyers everywhere want a day${mv.you ? `, and you add ${tok(mv.you)}` : ""}.</span>` : null}</span><span class="${sold ? "d1" : "d2"}">${sold ? `you sell ${tok(sold.sold)} of ${tok(sold.demand + (sold.toApps ? G.appDemand(state, t) : 0))} MTok a day${sold.toApps ? `, ${tok(sold.toApps)} to your products` : ""}` : `buyers want ${tok(G.tierDemand(state, t))} MTok a day`}</span></div>`;
      })}
    </section>
  </div>
  <${More} id="moneyunits" open=${units <= 6} title=${`Every machine and row, most profitable first: ${units}${nets.length ? `, from ${moneyShort(Math.max(...nets))} down to ${moneyShort(Math.min(...nets))} a day` : ""}`}><${UnitBooks} /></${More}>
  <${More} id="moneybooks" title=${`Today's books: ${moneyAny(s.profitPerDay)} a day profit, reputation ${Math.round(state.rep * 100)}`}>
    <div class="line"><span class="d1">Token sales</span><span>${moneyAny(s.revenuePerDay)} a day</span></div>
    <div class="line"><span class="d1">Electricity at ${(state.centsPerKwh * (G.site(state).energy || 1)).toFixed(1)} cents a kWh</span><span>${moneyAny(s.powerPerDay)} a day</span></div>
    ${s.capacityPerDay ? html`<div class="line"><span class="d1">Capacity charge, used or not</span><span>${moneyAny(s.capacityPerDay)} a day</span></div>` : null}
    ${s.supportPerDay ? html`<div class="line"><span class="d1">Rack support, dead cards replaced</span><span>${moneyAny(s.supportPerDay)} a day</span></div>` : null}
    ${s.staffPerDay ? html`<div class="line"><span class="d1">Salaries</span><span>${moneyAny(s.staffPerDay)} a day</span></div>` : null}
    <div class="line"><span class="d1">Rent</span><span>${s.rentPerDay ? `${moneyAny(s.rentPerDay)} a day` : "none"}</span></div>
    <div class="line"><span class="d0">Profit</span><span class="d0">${moneyAny(s.profitPerDay)} a day</span></div>
    <div class="line"><span class="d1">Earned so far</span><span>${money(state.earned)}</span></div>
    <div class="line"><span class="d1">Reputation</span><span>${Math.round(state.rep * 100)} of 100. More buyers trust you when you stay up.</span></div>
    <div class="line"><span class="d1">GPU prices</span><span>${Math.round(state.index.gpus * 100)}% of normal</span></div>
    <div class="line"><span class="d1">Memory prices</span><span>${Math.round(state.index.memory * 100)}% of normal</span></div>
  </${More}>
  <${More} id="moneymiles" title=${`Milestones: ${done} of ${G.MILESTONES.length}`}>${G.MILESTONES.map((x) => html`<div key=${x.id} class=${state.milestones.includes(x.id) ? "d0" : "d3"}>${x.text}</div>`)}</${More}>
  <${More} id="moneynews" title="News">${state.news.slice(0, 12).map((n) => html`<div key=${n.id} class="small ${n.kind === "good" ? "sig" : "d1"}">${dayName(n.day)}: ${n.text}</div>`)}</${More}>
  </div>`;
}
function Bar({ value }) {
  const cells = 40;
  const lit = Math.round(Math.min(1, value) * cells);
  return html`<div class="blocks" aria-hidden="true">${Array.from({ length: cells }, (_, i) => html`<i class=${i < lit ? "lit" : ""}></i>`)}</div>`;
}

// ---- Room layer ----
/** Copy a machine and say plainly where it went. */
function copyMachine(x, opts = {}) {
  const r = G.cloneMachine(state, x.id, opts);
  freshMoves();
  if (r.ok) flashNote(r.swapped ? `${r.name} is in your rack: the same parts as ${x.name}, in a rackmount case, because towers don't fit in racks.` : `${r.name} is a copy of ${x.name}${r.where === "rack" ? ", in your rack" : ""}.`);
  else flash(r.reason);
  draw();
  return r;
}
function CopyButton({ m, label, into = null, target = null, then = null }) {
  const plan = G.copyPlan(state, m, into);
  if (!plan.ok) return html`<span class="small d2 copyno">Can't copy ${m.name}: ${plan.reason}</span>`;
  return html`<button class="act" disabled=${state.cash < plan.cost} onClick=${() => { const r = copyMachine(m, { into, target }); if (r.ok && then) then(r); }}>${label}${plan.swapped ? " in a rackmount case" : ""}, ${money(plan.cost)}</button>`;
}
/** Buying ten of something shouldn't take ten clicks. */
function BuyMore({ price, buy, sell, sellFor }) {
  const go = (n) => () => {
    let bought = 0;
    for (let i = 0; i < n; i++) {
      const r = buy();
      if (r.ok === false) { if (!bought) flash(r.reason); break; }
      bought++;
    }
    freshMoves();
    if (bought) flashNote(`Bought ${bought}.`);
  };
  return html`<div class="bulk small">${[5, 10].map((n) => html`<button key=${n} class="act" disabled=${state.cash < price * n} onClick=${go(n)}>buy ${n}, ${moneyShort(price * n)}</button>`)}${sell ? html`<button class="act" onClick=${() => { const r = sell(); freshMoves(); doIt(r, false); }}>sell one, ${moneyShort(sellFor)}</button>` : null}</div>`;
}
/** Your best-earning designs, one of each. */
function copyChoices(into = null) {
  const seen = new Set();
  const designs = state.machines.filter(G.isComplete).filter((x) => {
    const sig = `${x.chassis}|${x.board}|${x.cpu}|${x.gpus.map((g) => g.id).join()}|${x.memory.join()}`;
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
  // What you can place and afford comes first, then whatever earns the most.
  const score = (x) => {
    const plan = G.copyPlan(state, x, into);
    return plan.ok ? (state.cash >= plan.cost ? 2 : 1) : 0;
  };
  return designs.map((x) => ({ x, score: score(x), net: G.machineSheet(state, x).net })).sort((a, b) => b.score - a.score || b.net - a.net).slice(0, 3).map((d) => d.x);
}
function startMachine(rack, index = null) {
  const made = G.addMachine(state);
  made.forRack = !!rack;
  if (index !== null) made.rackSlot = index;
  ui.machineId = made.id;
  ui.slot = "chassis";
  ui.slotIndex = "new";
  ui.layer = "machine";
  flashNote(`${made.name} started. ${rack ? "Pick a rackmount case" : "Pick a case"}, or use the quick build.`);
}
function rowNumbers(r) {
  const o = r.output || {};
  const power = G.dollarsPerDay(state, o.wall || 0);
  const each = G.rackPrice(state, G.skuOf(r));
  return { model: o.model, sales: o.revenue || 0, power, net: (o.revenue || 0) - power, watts: o.wall || 0, sold: o.util ?? 0, tokS: o.tokS || 0, spent: each * r.racks };
}
function itemNet(it) {
  if (it.kind === "machine") return G.machineSheet(state, it.m).net;
  if (it.kind === "row") return rowNumbers(it.row).net;
  if (it.kind === "rack") return it.plan.machines.reduce((n, x) => n + G.machineSheet(state, x.m).net, 0);
  return null;
}
/** One word for a row, naming the first thing holding it back. */
function rowWord(r) {
  if (!r.on) return "off";
  if (r.task !== "serve") return "training";
  if (!r.output?.model) return "idle";
  if ((state.capFactor ?? 1) < 0.99) return "slowed by power";
  if ((state.netRatio ?? 1) < 0.99) return "short on network";
  if (G.thermalThrottle(state.roomC) < 0.99) return "too hot";
  return (r.output.util ?? 0) < 0.98 ? "backed up" : "working";
}
function Need({ name, value, ratio, warn }) {
  const cells = 10;
  const lit = Math.min(cells, Math.round(Math.max(0, ratio) * cells));
  return html`<span class=${`need ${warn ? "warn" : ""}`}><span class="nname">${name}</span><span class="nbar" aria-hidden="true">${Array.from({ length: cells }, (_, i) => html`<i class=${i < lit ? "lit" : ""}></i>`)}</span><span class="nval">${value}</span></span>`;
}
/** The Zoo Tycoon card: everything this thing needs, at a glance. */
function ItemCard({ it }) {
  if (it.kind === "machine") {
    const k = G.machineSheet(state, it.m);
    const sp = G.machineSpend(state, it.m);
    const counts = {};
    it.m.gpus.forEach((g) => { const n = label(G.part("gpus", g.id)); counts[n] = (counts[n] || 0) + 1; });
    return html`<span class="cardin">
      <span class="ctitle">${it.m.name} <span class=${WORD_CLASS[k.word]}>${k.word}</span></span>
      <span class="cline">${Object.entries(counts).map(([n, c]) => (c > 1 ? `${c} x ${n}` : n)).join(", ") || "no GPU"}</span>
      ${k.model ? html`<span class="cline d1">running ${k.model.name}</span>` : null}
      ${k.model && state.contract?.tier === k.model.tier ? html`<span class="cline d1">${it.m.forDeal ? "given to" : "filling"} the ${state.contract.client.replace(/^An? /, "").toLowerCase()} deal${it.m.forDeal ? "" : " first"}</span>` : null}
      <span class="cnet">${moneyAny(k.net)}<span class="small"> a day</span></span>
      ${k.model ? html`<${Need} name="GPU memory" value=${`${gb(k.modelGB)} of ${gb(k.fit?.mode === "split" || k.fit?.mode === "spill" ? k.vram : k.perCard)}`} ratio=${k.modelGB / Math.max(1, k.fit?.mode === "split" || k.fit?.mode === "spill" ? k.vram : k.perCard)} warn=${k.spill > 0} />
      <${Need} name="Buyers" value=${`${Math.round(k.util * 100)}% sold`} ratio=${k.util} warn=${k.util < 0.98} />` : null}
      <${Need} name="Power supply" value=${`${Math.round(k.psuNeed).toLocaleString("en-US")} of ${k.psuMax.toLocaleString("en-US")} W`} ratio=${k.psuMax ? k.psuNeed / k.psuMax : 0} warn=${k.psuNeed > k.psuMax} />
      <span class="cline d1">Costs ${money(sp.total)} new${k.net > 0 ? `, back in ${Math.ceil(sp.total / k.net).toLocaleString("en-US")} days` : ""}</span>
    </span>`;
  }
  if (it.kind === "row") {
    const n = rowNumbers(it.row);
    const sku = G.skuOf(it.row);
    return html`<span class="cardin">
      <span class="ctitle">${it.row.name}, ${it.row.racks} ${sku.short} ${it.row.racks === 1 ? "rack" : "racks"}</span>
      <span class=${`cline ${rowWord(it.row) === "working" ? "d1" : "sig"}`}>${rowWord(it.row)}</span>
      ${n.model ? html`<span class="cline d1">running ${n.model.name}</span>` : html`<span class="cline sig">nothing loaded</span>`}
      ${n.model && state.contract?.tier === n.model.tier ? html`<span class="cline d1">filling the ${state.contract.client.replace(/^An? /, "").toLowerCase()} deal first</span>` : null}
      <span class="cnet">${moneyShort(n.net)}<span class="small"> a day</span></span>
      <${Need} name="Buyers" value=${`${Math.round(n.sold * 100)}% sold`} ratio=${n.sold} warn=${n.sold < 0.98} />
      ${(state.capFactor ?? 1) < 0.99 ? html`<${Need} name="Power" value=${`running at ${Math.round(state.capFactor * 100)}%`} ratio=${state.capFactor} warn=${true} />` : null}
      ${(state.netRatio ?? 1) < 0.99 ? html`<${Need} name="Network" value=${`running at ${Math.round(state.netRatio * 100)}%`} ratio=${state.netRatio} warn=${true} />` : null}
      ${it.scale > 1 ? html`<span class="cline d2">Each cabinet here stands for ${it.scale} racks.</span>` : null}
      <span class="cline d1">${(it.row.racks * sku.cards).toLocaleString("en-US")} cards, ${tokShort(it.row.output?.mtok || 0)} MTok a day, ${moneyShort(n.power)} power</span>
    </span>`;
  }
  if (it.kind === "rack") {
    return html`<span class="cardin">
      <span class="ctitle">${it.plan.units}U rack</span>
      <${Need} name="Rack units" value=${`${it.plan.units - it.plan.free} of ${it.plan.units}`} ratio=${(it.plan.units - it.plan.free) / it.plan.units} />
      ${it.plan.machines.map(({ m: x }) => { const k = G.machineSheet(state, x); return html`<span class="cline" key=${x.id}>${x.name}: ${moneyAny(k.net)} a day, ${k.word}</span>`; })}
      ${it.plan.free >= 4 ? html`<span class="cline sig">Room for another machine.</span>` : null}
    </span>`;
  }
  if (it.kind === "cool") {
    const c = G.COOLING.find((k) => k.id === it.cool);
    return html`<span class="cardin">
      <span class="ctitle">${it.count > 1 ? `${it.count} x ` : ""}${c.name}</span>
      <span class="cline">Sheds ${Math.round((c.coolW + (c.liquidW || 0)) * it.count * (1 + G.researchBonus(state, "cooling"))).toLocaleString("en-US")} W of heat</span>
      <span class="cline d1">Costs ${moneyAny(G.dollarsPerDay(state, c.drawW * it.count))} a day to run</span>
      <span class="cline d1">No limit on how many you own.</span>
    </span>`;
  }
  if (it.kind === "net") {
    const x = G.part("network", it.net);
    return html`<span class="cardin">
      <span class="ctitle">${it.count > 1 ? `${it.count} x ` : ""}${x.name}</span>
      <span class="cline">${Math.round(x.tb * it.count).toLocaleString("en-US")} Tb/s</span>
      <span class="cline d1">Costs ${moneyAny(G.dollarsPerDay(state, x.watts * it.count))} a day to run</span>
    </span>`;
  }
  return html`<span class="cardin"><span class="ctitle">Empty floor spot</span><span class="cline d1">Click to build a machine or add a rack here.</span></span>`;
}
function Sprite({ it }) {
  const name = spriteOf(it);
  if (!name) return null;
  return html`<img src=${art(name)} alt="" />${it.kind === "rack" ? it.plan.machines.map(({ m: x }, i) => html`<img key=${x.id} class="wserver" src=${art("iso-server")} alt="" style=${`bottom:${serverBottom(i, it.plan.units)}%`} />`) : null}`;
}
function World({ tabs, panels }) {
  const w = WORLD[state.site] || WORLD.garage;
  const tab = ui.floorTab && tabs.some((t) => t[0] === ui.floorTab) ? ui.floorTab : "here";
  const all = floorItems(state, G);
  const items = all.filter((x) => !x.off);
  const hover = findItem(items, ui.worldHover);
  // The pointer follows what's actually drawn, so an empty corner of one picture never blocks what's behind it.
  const under = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    return pickItem(items, ((e.clientX - box.left) / box.width) * 100, ((e.clientY - box.top) / box.height) * 100, sel);
  };
  const sel = findItem(all, ui.worldSel)?.id ?? null;
  const stateOf = (it) => {
    if (it.kind === "machine") return G.machineSheet(state, it.m).word;
    if (it.kind === "row") return rowWord(it.row);
    return "working";
  };
  const showNet = items.filter((x) => x.kind === "machine" || x.kind === "rack").length <= 30 && !state.rows.length;
  return html`<div class="worldbox">
    <div class="world" onPointerMove=${(e) => { const id = under(e)?.id ?? null; if (ui.worldHover !== id) { ui.worldHover = id; draw(); } }} onPointerLeave=${() => { ui.worldHover = null; draw(); }} onClick=${(e) => { const it = under(e); if (it) { ui.worldSel = it.id; ui.floorTab = "here"; logEvent("click", `floor: ${it.name}`); draw(); } }}>
      <img class="wfloor" src=${art(w.art)} alt=${G.site(state).name} />
      ${items.map((it) => {
        const word = stateOf(it);
        const trouble = ["backed up", "slowed", "slowed by power", "short on network", "too hot", "spilling", "losing money", "no power", "idle", "unfinished"].includes(word);
        const net = itemNet(it);
        const kin = hover?.kind === "row" && it.kind === "row" && hover.row.id === it.row.id && hover.id !== it.id;
        return html`<button key=${it.id} class=${`wit ${it.kind} ${word === "off" ? "isoff" : ""} ${trouble ? "trouble" : ""} ${sel === it.id ? "sel" : ""} ${ui.worldHover === it.id ? "hov" : ""} ${kin ? "kin" : ""}`}
          style=${`left:${it.x}%;top:${it.y}%;width:${it.width}%;z-index:${sel === it.id ? 200 : it.z}`}
          aria-label=${it.name}
          onFocus=${() => { ui.worldHover = it.id; draw(); }}
          onBlur=${() => { ui.worldHover = null; draw(); }}
          onClick=${(e) => { e.stopPropagation(); ui.worldSel = it.id; ui.floorTab = "here"; draw(); }}>
          ${it.kind === "empty" ? html`<span class="wplus">+</span>` : html`<${Sprite} it=${it} />`}
          ${showNet && net !== null && !(it.kind === "rack" && !it.plan.machines.length) ? html`<span class=${`wnet ${net < 0 ? "sig" : ""}`}>${moneyShort(net)}</span>` : null}
          ${it.count > 1 ? html`<span class="wnet">x${it.count}</span>` : null}
        </button>`;
      })}
      ${hover ? html`<div class=${`wtip ${hover.y < 56 ? "below" : ""}`} style=${`left:clamp(min(135px, 50%), ${hover.x}%, calc(100% - min(135px, 50%)));top:${hover.y}%`} role="tooltip"><${ItemCard} it=${hover} /></div>` : null}
    </div>
    <div class="floorside">
      <div class="ftabs" role="tablist">${tabs.map(([id, text, warn]) => html`<button key=${id} role="tab" aria-selected=${tab === id} class=${`act ${tab === id ? "on" : ""}`} onClick=${() => { ui.floorTab = id; draw(); }}>${text}${warn ? html`<span class="sig"> *</span>` : null}</button>`)}</div>
      <div class="fpane">${tab === "here" ? html`<${Inspector} items=${all} />` : panels[tab]()}</div>
    </div>
  </div>`;
}
/** The whole room as a list, so nothing can ever be out of reach. Hovering one lights it up on the floor. */
function FloorList({ items }) {
  const seen = new Set();
  const others = items.filter((it) => {
    if (it.kind === "empty" || it.kind === "machine") return false;
    const key = it.kind === "row" ? `row${it.rowId}` : it.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const rank = { rack: 1, row: 2, cool: 3, net: 4 };
  const rowAt = (it) => state.rows.indexOf(it.row);
  others.sort((a, b) => rank[a.kind] - rank[b.kind] || (a.kind === "row" ? rowAt(a) - rowAt(b) : 0));
  const pick = (it) => html`<button key=${it.id} class="act" onPointerEnter=${() => { ui.worldHover = it.id; draw(); }} onPointerLeave=${() => { ui.worldHover = null; draw(); }} onClick=${() => { ui.worldSel = it.id; draw(); }}>${it.count > 1 ? `${it.count} x ` : ""}${it.name}${it.kind === "row" ? `, ${it.row.racks} ${G.skuOf(it.row).short}` : ""}</button>`;
  const machines = items.filter((it) => it.kind === "machine");
  const inRacks = new Set(G.rackPlan(state).flatMap((r) => r.machines.map((x) => x.m.id)));
  return html`<div class="floorlist">
    ${designGroups().map((g) => {
      const here = g.list.map((x) => machines.find((it) => it.m.id === x.id)).filter(Boolean);
      const mounted = g.list.filter((x) => inRacks.has(x.id));
      if (g.list.length === 1) return here[0] ? pick(here[0]) : html`<button key=${g.key} class="act" onClick=${() => { ui.machineId = g.list[0].id; ui.layer = "machine"; draw(); }}>${g.list[0].name}, in a rack</button>`;
      return html`<${More} key=${g.key} id=${`list${g.key}`} title=${`${g.list.length} machines, ${g.gear}${mounted.length ? `, ${mounted.length} in racks` : ""}`}>
        ${here.map(pick)}
        ${mounted.map((x) => html`<button key=${x.id} class="act" onClick=${() => { ui.machineId = x.id; ui.layer = "machine"; draw(); }}>${x.name}, in a rack</button>`)}
      </${More}>`;
    })}
    ${others.map(pick)}
  </div>`;
}
/** Whatever you clicked: what it is and what you can do with it. */
function Inspector({ items }) {
  const it = findItem(items, ui.worldSel);
  const here = G.site(state);
  const cheapRack = CATALOG.racks[0];
  if (!it) {
    const heatLimit = here.passiveW + state.cooling.reduce((n, id) => { const c = G.COOLING.find((k) => k.id === id); return n + c.coolW + (c.liquidW || 0); }, 0);
    return html`<aside class="inspect">
      <h2 class="big plain">${here.name}</h2>
      <p class="help">${here.note}</p>
      <p class="d1" style="margin:10px 0 0">${G.floorUsed(state).toLocaleString("en-US")} of ${G.floorLimit(state).toLocaleString("en-US")} floor spots used.</p>
      <p class="d1" style="margin:2px 0 0">Machines make ${Math.round(state.heatW || 0).toLocaleString("en-US")} W of heat. This room can shed ${Math.round(heatLimit).toLocaleString("en-US")} W.</p>
      <p class="small d2" style="margin:12px 0 0">Hover anything to see how it's doing. Click it to manage it. Amber means something is holding it back.</p>
      <h2 class="hd" style="margin-top:16px">Everything here</h2>
      <${FloorList} items=${items} />
      <h2 class="hd" style="margin-top:16px">Add cooling. No slots, no limit.</h2>
      <div class="iverbs">${G.COOLING.filter((c) => G.coolingAvailable(state, c)).map((c) => html`<button key=${c.id} class="act" disabled=${state.cash < c.cost} onClick=${() => doIt(G.buyCooling(state, c.id))}>${c.name}, ${money(c.cost)}<span class="small d2"> sheds ${Math.round((c.coolW + (c.liquidW || 0)) * (1 + G.researchBonus(state, "cooling"))).toLocaleString("en-US")} W, costs ${moneyAny(G.dollarsPerDay(state, c.drawW))} a day</span></button>`)}</div>
    </aside>`;
  }
  const close = html`<button class="act" onClick=${() => { ui.worldSel = null; draw(); }}>back to the room</button>`;
  if (it.kind === "machine") {
    const x = it.m;
    return html`<aside class="inspect">
      <${ItemCard} it=${it} />
      <div class="iverbs">
        <button class="act lead" onClick=${() => { ui.machineId = x.id; ui.layer = "machine"; ui.slot = "gpus"; ui.slotIndex = "new"; draw(); }}>open it on the bench</button>
        ${G.isComplete(x) ? html`<button class="act" onClick=${() => { ui.machineId = x.id; ui.modelsRow = null; ui.layer = "models"; draw(); }}>change its model</button>` : null}
        ${G.isComplete(x) ? html`<${CopyButton} m=${x} label="copy it" />` : null}
        ${G.hasTech(state, "powerlimit") ? html`<button class=${`act ${x.tuned ? "on" : ""}`} onClick=${() => { x.tuned = !x.tuned; G.recompute(state); draw(); }}>power limit ${x.tuned ? "on" : "off"}</button>` : null}
        ${G.isComplete(x) ? html`<button class="act" onClick=${() => { x.on = !x.on; G.recompute(state); draw(); }}>${x.on ? "shut it off" : "turn it on"}</button>` : null}
        ${state.machines.length > 1 ? html`<button class=${`act ${ui.confirmSell === x.id ? "lead" : ""}`} onClick=${() => { if (ui.confirmSell !== x.id) { ui.confirmSell = x.id; draw(); return; } ui.confirmSell = null; G.sellMachine(state, x.id); ui.worldSel = null; ui.machineId = state.machines[0].id; freshMoves(); doIt({ ok: true }, false); }}>${ui.confirmSell === x.id ? `yes, sell every part for ${money(G.machineResale(state, x))}` : "sell it and free this spot"}</button>` : null}
        ${close}
      </div>
    </aside>`;
  }
  if (it.kind === "rack") {
    const r = it.plan;
    return html`<aside class="inspect">
      <${ItemCard} it=${it} />
      <${MatchBest} />
      <div class="iverbs">
        ${r.machines.length ? (() => {
          const plan = G.rackCopyPlan(state, r.index);
          if (!plan.ok) return html`<span class="small d2 copyno">Can't duplicate it: ${plan.reason}</span>`;
          const over = state.wallW + plan.addsW > G.siteLimitW(state);
          return html`<button class="act lead" disabled=${state.cash < plan.cost} onClick=${() => { const res = G.cloneRack(state, r.index); freshMoves(); if (res.ok) flashNote(`A second rack is up with ${res.made} ${res.made === 1 ? "machine" : "machines"}${res.sold ? `. ${res.sold} was sold to make room` : ""}.`); else flash(res.reason); draw(); }}>${plan.sell ? `sell ${plan.sell.name} and duplicate this rack` : "duplicate this whole rack"}, ${money(plan.cost)}</button>
            <span class=${`small ${over ? "sig" : "d2"}`}>${plan.machines.length} ${plan.machines.length === 1 ? "machine" : "machines"}, set up the same. Adds about ${Math.round(plan.addsW).toLocaleString("en-US")} W and ${moneyAny(plan.earns)} a day in sales if buyers want it.${over ? " That's more than your power limit, so the breaker would trip." : ""}</span>`;
        })() : null}
        ${r.machines.map(({ m: x }) => html`<button key=${x.id} class="act" onClick=${() => { ui.machineId = x.id; ui.layer = "machine"; ui.slot = "gpus"; ui.slotIndex = "new"; draw(); }}>open ${x.name} on the bench</button>`)}
        ${r.free >= 4 ? copyChoices(r.index).map((x) => html`<${CopyButton} key=${x.id} m=${x} label=${`copy ${x.name} here`} into=${r.index} />`) : null}
        ${r.free >= 4 ? html`<button class="act" onClick=${() => startMachine(true, r.index)}>build a new machine in it</button>` : null}
        <span class="small d2">Racks take rackmount cases. A tower's copy keeps its parts and gets a new case.</span>
        ${r.machines.length ? null : html`<button class="act" onClick=${() => { const res = G.sellEmptyRack(state, r.index); ui.worldSel = null; doIt(res, false); }}>sell this empty rack for ${money(r.rack.price * 0.5)}</button>`}
        ${close}
      </div>
    </aside>`;
  }
  if (it.kind === "row") {
    const sku = G.skuOf(it.row);
    return html`<aside class="inspect">
      <${ItemCard} it=${it} />
      <div class="iverbs">
        <button class="act lead" disabled=${state.cash < G.rackPrice(state, sku)} onClick=${() => buyAndSay(sku, 1)}>buy another just like it, ${money(G.rackPrice(state, sku))}</button>
        <button class="act" onClick=${() => { ui.modelsRow = it.row.id; ui.rowId = it.row.id; ui.layer = "models"; draw(); }}>change its model</button>
        ${G.hasTech(state, "powerlimit") ? html`<button class=${`act ${it.row.tuned ? "on" : ""}`} onClick=${() => { it.row.tuned = !it.row.tuned; G.recompute(state); freshMoves(); draw(); }}>power limit ${it.row.tuned ? "on" : "off"}</button>` : null}
        <button class="act" onClick=${() => { it.row.on = !it.row.on; G.recompute(state); freshMoves(); draw(); }}>${it.row.on ? "shut the row off" : "turn the row on"}</button>
        ${ui.confirmRow === it.row.id ? html`<button class="act lead" onClick=${() => { ui.confirmRow = null; const r = G.sellRack(state, it.row.id, 1); if (!state.rows.find((x) => x.id === it.row.id)) ui.worldSel = null; freshMoves(); doIt(r, false); }}>yes, sell one for ${money(Math.round(G.rackPrice(state, sku) * (sku.used ? 0.55 : 0.65)))}</button>` : html`<button class="act" onClick=${() => { ui.confirmRow = it.row.id; draw(); }}>sell a rack</button>`}
        ${close}
      </div>
    </aside>`;
  }
  if (it.kind === "cool") {
    const c = G.COOLING.find((k) => k.id === it.cool);
    return html`<aside class="inspect">
      <${ItemCard} it=${it} />
      <div class="iverbs">
        <button class="act lead" disabled=${state.cash < c.cost} onClick=${() => doIt(G.buyCooling(state, c.id))}>buy another, ${money(c.cost)}</button>
        <button class="act" onClick=${() => { const r = G.sellCooling(state, c.id); if (!state.cooling.includes(c.id)) ui.worldSel = null; doIt(r, false); }}>sell one for ${money(c.cost * 0.5)}</button>
        ${close}
      </div>
    </aside>`;
  }
  if (it.kind === "net") {
    const x = G.part("network", it.net);
    return html`<aside class="inspect">
      <${ItemCard} it=${it} />
      <div class="iverbs">
        <button class="act lead" disabled=${state.cash < x.price} onClick=${() => doIt(G.buyNetwork(state, x.id))}>buy another, ${money(x.price)}</button>
        <button class="act" onClick=${() => { const r = G.sellNetwork(state, x.id); if (!state.network.includes(x.id)) ui.worldSel = null; freshMoves(); doIt(r, false); }}>sell one for ${money(x.price * 0.5)}</button>
        ${close}
      </div>
    </aside>`;
  }
  return html`<aside class="inspect">
    <${ItemCard} it=${it} />
    <div class="iverbs">
      <button class="act lead" onClick=${() => startMachine(false)}>build a machine here</button>
      ${G.site(state).feeds ? null : html`<button class="act" disabled=${state.cash < cheapRack.price} onClick=${() => { const res = G.buy(state, "racks", cheapRack.id); if (res.ok) flashNote("Rack added. It's empty: click it to build a machine in it."); else flash(res.reason); }}>put a ${cheapRack.units}U rack here, ${money(cheapRack.price)}</button>`}
      ${G.fleetUnlocked(state) ? html`<button class="act" onClick=${() => { ui.floorTab = "racks"; draw(); }}>buy a whole rack of GPUs</button>` : null}
      ${close}
    </div>
  </aside>`;
}
function Room() {
  const here = G.site(state);
  const next = G.nextSite(state);
  const buyCool = (id) => () => doIt(G.buyCooling(state, id));
  const owned = state.cooling.reduce((a, id) => ((a[id] = (a[id] || 0) + 1), a), {});
  const big = G.fleetUnlocked(state);
  const feedNext = G.nextFeed(state);
  const order = state.feedOrder;
  const switchesOwned = state.network.reduce((a, id) => ((a[id] = (a[id] || 0) + 1), a), {});
  const coolList = G.COOLING.filter((c) => G.coolingAvailable(state, c) && (owned[c.id] || !big || c.cost >= 38000));
  const nextLine = next && (next.feeds ? `${((next.feeds[0].amps * next.volts) / 1e6).toFixed(1)} MW at ${next.kv} kV, ${next.floor} rack spots, ${money(next.rent)} a day rent. ${next.note}` : `${next.amps} A at ${next.volts} V, ${next.floor} floor spots${next.rent ? `, ${money(next.rent)} a day rent` : ""}. ${next.note}`);
  const limitA = G.limitAmps(state);
  // Megawatts on a transmission line, amps everywhere else, and watts beside it so the units stay plain.
  const amps = (w) => (here.feeds ? `${((w / G.siteLimitW(state)) * 100).toFixed(1)}%` : `${(w / here.volts).toFixed(1)} A`);
  const watts = (w) => (w >= 1e6 ? `${(w / 1e6).toFixed(2)} MW` : w >= 10000 ? `${Math.round(w / 1000).toLocaleString("en-US")} kW` : `${Math.round(w).toLocaleString("en-US")} W`);
  const rowGroups = {};
  for (const r of state.rows) {
    const g = (rowGroups[r.sku] ||= { sku: G.skuOf(r), racks: 0, wall: 0, rows: [] });
    g.racks += r.racks;
    g.wall += r.output?.wall || 0;
    g.rows.push(r);
  }
  const running = state.machines.filter((x) => G.isComplete(x));
  const fillRack = () => {
    const made = G.addMachine(state);
    made.forRack = true;
    ui.machineId = made.id;
    ui.slot = "chassis";
    ui.slotIndex = "new";
    ui.layer = "machine";
    flashNote(`${made.name} started. Pick a rackmount case, or use the quick build.`);
  };
  const rackFree = G.rackUnits(state) - G.rackUsed(state);
  const tabs = [
    ["here", "here", false],
    ["racks", "racks", false],
    ["cooling", "cooling", state.roomC > 32 || state.targetC > 32 || (state.plant && state.plant.wet > state.plant.wetCap)],
    ...(big ? [["network", "network", (state.netRatio ?? 1) < 1]] : []),
    ["power", "power", (state.capFactor ?? 1) < 1 || state.amps >= G.limitAmps(state) * 0.95],
    ["grow", "grow", false],
  ];
  const tuned = state.rows.length && state.rows.every((r) => r.tuned);
  const panels = {
    racks: () => html`
      ${state.rows.length ? html`<div class="switch"><button class="act lead" onClick=${() => { G.optimizeModels(state); freshMoves(); doIt({ ok: true }); }}>load the best model on everything</button>${G.hasTech(state, "powerlimit") ? html`<button class=${`act ${tuned ? "on" : ""}`} onClick=${() => { G.setAllRows(state, "tuned", !tuned); freshMoves(); draw(); }}>power limit on every rack, ${tuned ? "on" : "off"}</button>` : null}</div>` : null}
      ${big ? html`<h2 class="hd">Whole racks of GPUs, with whatever they need to run</h2><${WorldStrip} /><div class="shop">${G.orderable(state).map((o) => html`<${OrderItem} key=${`o-${o.sku.id}`} sku=${o.sku} pre=${o.pre} ready=${o.ready} />`)}${G.fleetRacks(state).filter((sku) => !G.isAllocated(state, sku)).sort((a, b) => G.skuAvailable(state, b) - G.skuAvailable(state, a) || a.price - b.price).map((sku) => html`<${RackItem} key=${sku.id} sku=${sku} moves=${rankedMoves(machine())} />`)}</div>` : null}
      ${here.feeds ? null : html`      <h2 class="hd spaced">Empty racks for machines you build</h2>
      ${state.racks.length ? html`<div style="margin-bottom:10px"><div class="d0">Your racks: ${G.rackUsed(state)} of ${G.rackUnits(state)} units used</div>
        ${rackFree >= 4 ? html`<button class="act lead" onClick=${fillRack}>build a machine for this rack</button>` : html`<div class="small d2">Full. Each rackmount machine takes 4 or 5 units.</div>`}</div>` : null}
      <p class="help">A rack stacks rackmount machines on one floor spot. Towers don't fit, so a machine in a rack needs a rackmount case. Click the rack on the floor to copy a machine into it, and the case is swapped for you.</p>
      ${CATALOG.racks.map((r) => html`<button key=${r.id} class="gear" onClick=${() => { const res = G.buy(state, "racks", r.id); if (res.ok) flashNote(`${r.name} is in. It's empty, so build a machine for it below.`); else flash(res.reason); }} disabled=${state.cash < r.price}>
        <img src=${art("rack")} alt="" />
        <span><span class="name">${r.name.replace(/^\S+ /, "")}, ${money(r.price)}</span><br /><span class="d1">${r.units} units, holds ${Math.floor(r.units / 4)} rackmount machines, takes one floor spot</span></span>
      </button>`)}`}
    `,
    cooling: () => html`
      <div class="line"><span class="d1">Heat from machines</span><span>${watts(state.heatW || 0)}</span></div>
      <div class="line"><span class="d1">Room sheds on its own</span><span>${watts(here.passiveW)}</span></div>
      <div class="line"><span class="d1">Your cooling adds</span><span>${watts(state.cooling.reduce((n, id) => { const c = G.COOLING.find((k) => k.id === id); return n + c.coolW; }, 0))}</span></div>
      ${big ? html`<div class="line"><span class="d1">Water loop</span><span>${state.plant ? `${(state.plant.wet / 1e6).toFixed(2)} of ${(state.plant.wetCap / 1e6).toFixed(2)} MW` : ""}</span></div>` : null}
      <p class="small d2" style="margin:6px 0 0">The room only warms up if heat passes what it can shed. Below that, more cooling is money you don't need to spend.</p>
      ${Object.entries(owned).map(([id, n]) => { const c = G.COOLING.find((k) => k.id === id); return html`<div class="draw" key=${id}><span class="d0">${n > 1 ? `${n} x ` : ""}${c.name}</span><span class="num d2">${watts(c.drawW * n)}</span><span class="num">${moneyAny(G.dollarsPerDay(state, c.drawW * n))}</span><span class="ctrl"><button class="act" onClick=${() => doIt(G.sellCooling(state, id), false)}>sell one for ${money(c.cost * 0.5)}</button></span></div>`; })}
      <h2 class="hd spaced">Cooling. No slots or limit: buy as many as you want. Each one draws its power all day.</h2>
      ${coolList.map((c) => html`<button key=${c.id} class="gear" onClick=${buyCool(c.id)} disabled=${state.cash < c.cost}>
        <img src=${art("cool-" + c.id)} alt="" />
        <span><span class="name">${c.name}, ${money(c.cost)}</span><br /><span class="d1">${c.liquidW ? `carries ${watts(c.liquidW)} away in water` : `sheds ${watts(c.coolW)} of heat`}, adds ${amps(c.drawW)}, costs ${moneyAny(G.dollarsPerDay(state, c.drawW))} a day</span></span>
      </button>
      <${BuyMore} price=${c.cost} buy=${() => G.buyCooling(state, c.id)} />`)}
    `,
    network: () => html`
      <div class="line"><span class="d1">Racks need</span><span>${Math.round(G.fabricNeed(state)).toLocaleString("en-US")} Tb/s</span></div>
      <div class="line"><span class=${(state.netRatio ?? 1) < 1 ? "sig" : "d1"}>You have</span><span class=${(state.netRatio ?? 1) < 1 ? "sig" : ""}>${Math.round(G.fabricCapacity(state)).toLocaleString("en-US")} Tb/s</span></div>
      ${big ? html`<h2 class="hd spaced">Network. Racks wait if it runs short.</h2>
        ${CATALOG.network.filter((x) => G.siteAtLeast(state, x.site)).map((x) => html`<button key=${x.id} class="gear" onClick=${() => doIt(G.buyNetwork(state, x.id))} disabled=${state.cash < x.price}>
          <img src=${art(x.art)} alt="" />
          <span><span class="name">${x.name}, ${money(x.price)}${switchesOwned[x.id] ? `, you own ${switchesOwned[x.id]}` : ""}</span><br /><span class="d1">${x.tb.toLocaleString("en-US")} Tb/s, adds ${watts(x.watts)}, costs ${moneyAny(G.dollarsPerDay(state, x.watts))} a day. ${x.blurb}</span></span>
        </button>
        <${BuyMore} price=${x.price} buy=${() => G.buyNetwork(state, x.id)} sell=${switchesOwned[x.id] ? () => G.sellNetwork(state, x.id) : null} sellFor=${x.price * 0.5} />`)}` : null}
    `,
    power: () => html`
      <h2 class="big plain">Where your power goes</h2>
      ${here.feeds
        ? html`<p class="help">Your contract is ${G.currentFeed(state).amps} amps at ${here.kv} kV. Three-phase power at that voltage makes 1 A about ${(here.volts / 1e6).toFixed(2)} MW, so ${G.currentFeed(state).amps} A is ${G.powerText(state, G.currentFeed(state).amps)}. Over it, racks slow down.</p>`
        : html`<p class="help">Your breaker is ${here.amps} amps at ${here.volts} volts. Amps times volts is watts, so ${here.amps} A here is ${(here.amps * here.volts).toLocaleString("en-US")} W, and 1 A is ${here.volts} W.${state.rows.length ? " Over it, racks slow down. Machines trip it." : ""}</p>`}
      ${Object.values(rowGroups).map((g) => { const on = g.rows.some((r) => r.on); const tuned = g.rows.every((r) => r.tuned); return html`<div class="draw" key=${g.sku.id}>
        <span class=${on ? "d0" : "d2"}>${g.racks} ${g.sku.short} ${g.racks === 1 ? "rack" : "racks"}</span>
        <span class="num">${amps(g.wall)}</span><span class="num d2">${watts(g.wall)}</span>
        <span class="ctrl">
          <button class="act" onClick=${() => { g.rows.forEach((r) => { r.on = !on; }); G.recompute(state); draw(); }}>${on ? "shut off" : "turn on"}</button>
          ${G.hasTech(state, "powerlimit") ? html`<button class=${`act ${tuned ? "on" : ""}`} onClick=${() => { g.rows.forEach((r) => { r.tuned = !tuned; }); G.recompute(state); draw(); }}>power limit</button>` : null}
        </span>
      </div>`; })}
      ${state.network.length ? html`<div class="draw"><span class="d0">${state.network.length} network ${state.network.length === 1 ? "switch" : "switches"}</span><span class="num">${amps(state.network.reduce((n, id) => n + G.part("network", id).watts, 0))}</span><span class="num d2">${watts(state.network.reduce((n, id) => n + G.part("network", id).watts, 0))}</span><span></span></div>` : null}
      ${state.rows.length && running.length > 2 ? (() => {
        const on = running.some((x) => x.on);
        const w = running.reduce((n, x) => n + (x.output?.wall || 0), 0);
        return html`<div class="draw" key="old">
          <span class=${on ? "d0" : "d2"}>${running.length} old machines</span>
          <span class="num">${amps(w)}</span><span class="num d2">${watts(w)}</span>
          <span class="ctrl"><button class="act" onClick=${() => { running.forEach((x) => { x.on = !on; }); G.recompute(state); draw(); }}>${on ? "shut off" : "turn on"}</button></span>
        </div>`;
      })() : running.map((x) => html`<div class="draw" key=${x.id}>
        <span class=${x.on ? "d0" : "d2"}>${x.name}</span>
        <span class="num">${amps(x.output?.wall || 0)}</span><span class="num d2">${watts(x.output?.wall || 0)}</span><span class="num">${moneyAny(G.dollarsPerDay(state, x.output?.wall || 0))}</span>
        <span class="ctrl">
          <button class="act" onClick=${() => { x.on = !x.on; G.recompute(state); draw(); }}>${x.on ? "shut off" : "turn on"}</button>
          ${G.hasTech(state, "powerlimit") ? html`<button class=${`act ${x.tuned ? "on" : ""}`} onClick=${() => { x.tuned = !x.tuned; G.recompute(state); draw(); }}>power limit</button>` : null}
        </span>
      </div>`)}
      ${Object.entries(owned).map(([id, n]) => {
        const c = G.COOLING.find((k) => k.id === id);
        return html`<div class="draw" key=${id}>
          <span class="d0">${n > 1 ? `${n} x ` : ""}${c.name}</span>
          <span class="num">${amps(c.drawW * n)}</span><span class="num d2">${watts(c.drawW * n)}</span><span class="num">${moneyAny(G.dollarsPerDay(state, c.drawW * n))}</span>
          <span class="ctrl"><button class="act" onClick=${() => doIt(G.sellCooling(state, id), false)}>sell one for ${money(c.cost * 0.5)}</button></span>
        </div>`;
      })}
      ${here.feeds ? null : html`<div class="draw"><span class="d1">The rest of the house</span><span class="num">${amps(150)}</span><span class="num d2">150 W</span><span class="num d2">not yours</span><span></span></div>`}
      ${state.spike ? html`<div class="draw"><span class="sig">${state.spike.name || "An appliance"}, for a moment</span><span class="num sig">${amps(state.spike.watts)}</span><span class="num d2">${state.spike.watts.toLocaleString("en-US")} W</span><span class="num d2">not yours</span><span></span></div>` : null}
      <div class="draw total"><span>${here.feeds ? `Total, contract ${G.powerText(state, limitA)}` : `Total, ${state.rows.length ? "limit" : "trips at"} ${limitA} A`}</span><span class="num">${amps(state.wallW)}</span><span class="num d2">${watts(state.wallW)}</span><span class="num">${moneyAny(state.stats.powerPerDay)}</span><span></span></div>
      ${here.shared ? html`<p class="small d2" style="margin:8px 0 0">This outlet is shared. Someone else's appliance can add up to ${(here.amps - G.safeAmps(state)).toFixed(1)} A at any moment, so you're only safe under ${G.safeAmps(state).toFixed(1)} A.</p>` : null}
      ${G.hasTech(state, "powerlimit") ? null : html`<p class="small d2" style="margin:4px 0 0">Power limiting, in the lab, cuts each card's draw by about 20%.</p>`}
    `,
    grow: () => html`
      <div class="line"><span class="d1">Floor space</span><span>${G.floorUsed(state)} of ${G.floorLimit(state)} spots used</span></div>
      ${here.feeds ? html`<div class="line"><span class="d1">Power contract</span><span>${G.currentFeed(state).amps} amps at ${here.kv} kV, ${G.powerText(state, G.currentFeed(state).amps)}</span></div>` : null}
      <div class="line"><span class="d1">Rent</span><span>${here.rent ? `${money(here.rent)} a day` : "none"}</span></div>
      ${next ? html`<h2 class="hd">Move up</h2>
        <button class="gear" onClick=${() => doIt(G.moveSite(state))} disabled=${state.cash < G.moveCost(state)}>
          <img src=${art("site-" + next.id)} alt="" style="object-fit:cover" />
          <span><span class="name">${next.name}, ${money(G.moveCost(state))}${G.moveCost(state) > next.cost ? ", with the halls to fit what you own" : ""}</span><br /><span class="d1">${nextLine}</span></span>
        </button>` : html`<p class="d1">You own the land. There's nowhere bigger to go.</p>`}
      ${G.previousSite(state) ? html`<button class="act" onClick=${() => doIt(G.moveBack(state), false)}>move back to the ${G.previousSite(state).name.toLowerCase()}, free</button>` : null}
      ${here.feeds ? html`<h2 class="hd spaced">Power contract. More takes time.</h2>
        ${order ? html`<p class="d0" style="margin:0">New feed energizes in ${Math.ceil(order.ready - state.day)} days: ${here.feeds[order.index].amps} amps, ${G.powerText(state, here.feeds[order.index].amps)}.</p>` : feedNext ? html`<button class="gear" onClick=${() => doIt(G.orderFeed(state))} disabled=${state.cash < feedNext.cost}>
          <img src=${art("gear-feed")} alt="" />
          <span><span class="name">${feedNext.amps} amps, ${G.powerText(state, feedNext.amps)}, ${money(feedNext.cost)}</span><br /><span class="d1">The utility needs ${feedNext.days} days. You pay for capacity whether you use it or not.</span></span>
        </button>` : html`<p class="d1" style="margin:0">This is the biggest contract this site can sign.</p>`}
        <h2 class="hd spaced">Floor. Adding racks fits out a hall for you.</h2>
        <button class="gear" onClick=${() => doIt(G.buyHall(state))} disabled=${state.cash < here.hall.cost}>
          <img src=${art("gear-hall")} alt="" />
          <span><span class="name">Fit out a hall, ${money(here.hall.cost)}${state.halls ? `, you have ${state.halls}` : ""}</span><br /><span class="d1">${here.hall.floor} more rack spots</span></span>
        </button>` : null}
    `,
  };
  return html`<div class="wide spaced floorpage"><${World} tabs=${tabs} panels=${panels} /></div>`;
}

// ---- Lab layer ----
function Lab({ m }) {
  const p = state.project;
  const spec = p && G.TRAINING[p.kind];
  const startOne = (kind) => () => doIt(G.startProject(state, kind, [m.id]));
  const startAll = (kind) => () => doIt(G.startProject(state, kind, G.allUnits(state).filter(G.isRunning).map((x) => x.id)));
  const canStart = (kind) => G.allUnits(state).some((x) => G.isRunning(x) && G.totalVram(x) >= G.trainingSpec(state, kind).minVram);
  const trained = state.ownModels.some((x) => x.tier === "frontier");
  const tuned = state.ownModels.some((x) => x.tier === "medium");
  const tune = G.trainingSpec(state, "finetune");
  const r = state.research || { points: 0 };
  const people = G.STAFF.flatMap((x) => Array.from({ length: Math.min(G.staffCount(state, x.id), 12) }, (_, i) => `${x.id}${i}`)).slice(0, 25);
  const labAt = (u, v) => [0, 1].map((i) => [50, 38.5][i] * (1 - u) * (1 - v) + [94.8, 60.4][i] * u * (1 - v) + [5, 60][i] * (1 - u) * v + [50, 89.6][i] * u * v);
  const grid = Math.max(2, Math.ceil(Math.sqrt(people.length)));
  return html`<div class="wide"><div class="labtop">
    <section>
      <div class="labworld">
        <img class="wfloor" src=${art("world-lab")} alt="Your lab" />
        ${people.map((id, i) => {
          const [x, y] = labAt(0.2 + ((i % grid) + 0.5) / grid * 0.7, 0.2 + (Math.floor(i / grid) + 0.5) / grid * 0.7);
          return html`<img key=${id} class="labperson" src=${art("iso-researcher")} alt="" style=${`left:${x}%;top:${y}%;width:${Math.min(24, 80 / (grid + 1))}%;z-index:${i}`} />`;
        })}
        ${people.length ? null : html`<span class="labempty small d1">Nobody works here yet.</span>`}
      </div>
    </section>
    <section>
      <h2 class="hd">Your team. People who earn their keep today: ${money(G.teamPerDay(state))} a day in pay.</h2>
      <p class="small d2" style="margin:0 0 4px">Pay follows the size of your company when someone joins, and they keep it. Each hire in the same job adds a little less than the last.</p>
      ${(() => {
        const sold = Object.values(state.stats.soldByTier || {});
        const unsold = sold.some((v) => v.supply - v.sold > v.supply * 0.02);
        const short = sold.some((v) => v.demand + (v.toApps || 0) > v.sold * 1.02);
        const reason = { inference: short ? "Buyers want more, but not yet enough to cover the pay." : "You already make more than buyers take.", sales: unsold ? "Some of what you make goes unsold, but not yet enough to cover the pay." : "Buyers already take everything you make." };
        return G.TEAM.map((x) => {
          const n = G.teamCount(state, x.id);
          const cost = G.teamHireCost(state, x.id);
          const q = remembered(`team|${x.id}`, () => G.teamQuote(state, x.id));
          return html`<div class="staff" key=${x.id}>
            <span><span class="name">${x.name}${n ? `, ${n}` : ""}</span>${n ? html`<span class="d1">, +${Math.round(G.teamBonus(state, x.id) * 100)}% ${x.id === "inference" ? "tokens" : "buyers"} so far</span>` : null}<br /><span class="small d1">${x.text} The next one adds about ${(G.teamNextShare(state, x.id) * 100).toFixed(1)}% for ${money(G.teamNextSalary(state, x.id))} a day.</span><br /><span class=${`small ${q.gain > 0.5 ? "sig" : "d2"}`}>${q.gain > 0.5 ? `Today: +${moneyShort(q.gain)} a day after pay, back in ${Math.ceil(cost / q.gain).toLocaleString("en-US")} days.` : `Today: ${q.gain < -0.5 ? `${moneyShort(-q.gain)} a day worse` : "no better off"} after pay. ${reason[x.id]}`}</span></span>
            <span class="staffbtn"><button class="act lead" disabled=${state.cash < cost} onClick=${() => { freshMoves(); doIt(G.hireTeam(state, x.id)); }}>hire, ${moneyShort(cost)}</button>${n ? html`<button class="act small" onClick=${() => { freshMoves(); doIt(G.letGoTeam(state, x.id), false); }}>let one go</button>` : null}</span>
          </div>`;
        });
      })()}
    </section>
    <section>
      <h2 class="hd">Your people. ${Math.round(G.pointsPerDay(state)).toLocaleString("en-US")} research points a day, ${money(G.salaryPerDay(state))} a day in salaries.</h2>
      <p class="small d2" style="margin:0 0 4px">Bigger hires cost less per point. Each hire of the same kind costs 15% more than the last.</p>
      ${G.STAFF.map((x) => {
        const n = G.staffCount(state, x.id);
        const cost = G.hireCost(state, x.id);
        return html`<div class="staff" key=${x.id}>
          <span><span class="name">${x.name}${n ? `, ${n}` : ""}</span><br /><span class="small d1">${x.points.toLocaleString("en-US")} ${x.points === 1 ? "point" : "points"} a day for ${money(x.salary)} a day, ${money(x.salary / x.points)} a point. ${x.text}</span></span>
          <span class="staffbtn"><button class="act lead" disabled=${state.cash < cost} onClick=${() => doIt(G.hire(state, x.id))}>hire, ${moneyShort(cost)}</button>${n ? html`<button class="act small" onClick=${() => doIt(G.letGo(state, x.id), false)}>let one go</button>` : null}</span>
        </div>`;
      })}
    </section>
    <section>
      <h2 class="hd">Research. You have ${Math.floor(r.points || 0).toLocaleString("en-US")} points. Gains are permanent.</h2>
      ${G.RESEARCH.map((x) => {
        const lv = G.researchLevel(state, x.id);
        const done = lv >= x.max;
        const cost = G.researchCost(state, x.id);
        const can = !done && (r.points || 0) >= cost;
        return html`<button class="branch" key=${x.id} disabled=${!can} onClick=${() => doIt(G.research(state, x.id))}>
          <span class=${`name ${can ? "sig" : ""}`}>${x.name}, level ${lv} of ${x.max}</span>
          <span class="nbar" aria-hidden="true">${Array.from({ length: x.max }, (_, i) => html`<i class=${i < lv ? "lit" : ""}></i>`)}</span>
          <span class="small d1">${x.text} ${done ? "All done." : `Next: ${cost.toLocaleString("en-US")} points${G.pointsPerDay(state) && !can ? `, ${Math.ceil((cost - (r.points || 0)) / G.pointsPerDay(state)).toLocaleString("en-US")} days away` : ""}.`}</span>
        </button>`;
      })}
    </section>
  </div><div class="cols">
    <section>
      <h2 class="hd">Software and deals</h2>
      ${G.TECH.filter((t) => G.techAvailable(state, t)).map((t) => {
        const has = G.hasTech(state, t.id);
        const isDeal = !!t.demand;
        const quote = isDeal ? remembered(`tech|${t.id}|${has}|${state.techOff || ""}`, () => G.quoteUpgrade(state, (c) => (has ? G.toggleTech(c, t.id) : G.buyTech(c, t.id)), true)) : null;
        const active = G.techActive(state, t.id);
        return html`<div key=${t.id}><button class=${`gear`} style="grid-template-columns:1fr" disabled=${has || state.cash < t.cost} onClick=${() => { freshMoves(); doIt(G.buyTech(state, t.id)); }}>
          <span><span class="name" style=${has && active ? "color:var(--signal)" : ""}>${t.name}${has ? (isDeal ? (active ? ", running" : ", ended") : ", installed") : `, ${money(t.cost)}`}</span><br /><span class="d1">${t.text}</span>${isDeal && !has ? html`<br /><span class=${quote.gain < 0 ? "sig small" : "d1 small"}>Right now it would change profit by about ${quote.gain < 0 ? "-" : "+"}${moneyShort(Math.abs(quote.gain))} a day.</span>` : null}</span>
        </button>
        ${isDeal && has ? html`<button class="act" onClick=${() => { G.toggleTech(state, t.id); G.optimizeModels(state); freshMoves(); draw(); }}>${active ? `end this deal and reload the best models, profit changes by about ${quote.gain < 0 ? "-" : "+"}${moneyShort(Math.abs(quote.gain))} a day` : `restart this deal and reload the best models, profit changes by about ${quote.gain < 0 ? "-" : "+"}${moneyShort(Math.abs(quote.gain))} a day`}</button>` : null}</div>`;
      })}
    </section>
    <section>
      <h2 class="hd">Make your own AI</h2>
      <p class="d1" style="margin:0 0 12px;max-width:60ch">Everything so far has been someone else's model. These jobs take machines off paid work and aim them at a model that belongs to you.</p>
      ${p ? html`<p class="d0" style="margin:0 0 6px">${spec.name}: ${Math.floor((p.work / p.need) * 100)}% done.</p><${Bar} value=${p.work / p.need} /><button class="act" style="margin-top:8px" onClick=${() => { G.cancelProject(state); draw(); }}>stop and go back to earning</button>` : html`
        <div style="margin-bottom:14px">
          <div class="d0">Fine-tune a model${tune.made ? `, number ${tune.made + 1}` : ""}</div>
          <div class="d1">Makes one new model that you own and any machine or rack can load. It's not an upgrade to a machine, so you don't repeat it per machine. This one sells at ${tune.premium}x the price${tune.made ? " and takes longer than your last" : ""}. One machine with ${tune.minVram} GB of GPU memory does the work.</div>
          ${(() => {
            const fits = (x) => G.isRunning(x) && G.totalVram(x) >= tune.minVram;
            const target = m && fits(m) ? m : G.allUnits(state).filter(fits).sort((a, b) => (a.output?.revenue || 0) - (b.output?.revenue || 0))[0];
            return target ? html`<button class="act lead" onClick=${() => doIt(G.startProject(state, "finetune", [target.id]))}>start on ${target.name}${target.sku ? `, ${target.racks} ${G.skuOf(target).short} racks` : ""}</button>` : html`<button class="act lead" disabled>start</button><div class="small d2">Needs a machine or rack with ${tune.minVram} GB that's turned on.</div>`;
          })()}
        </div>
        <div>
          <div class="d0">Train your own model</div>
          <div class="d1">From scratch. It's the whole point of this. Sells at ${G.TRAINING.train.premium}x the frontier price. Needs one machine with ${G.TRAINING.train.minVram} GB, and it goes faster the more you throw at it.</div>
          ${G.ruleOn(state, "gens") ? html`<div class="small d1">While the frontier moves: aims at generation ${G.targetGen(state)}, about ${Math.ceil(G.trainingDays(state, "train", G.allUnits(state).filter((x) => x.task === "serve" && (x.sku ? x.on : G.isRunning(x))))).toLocaleString("en-US")} days on everything you run, and needs ${G.trainingSpec(state, "train").minVram.toLocaleString("en-US")} GB in one place.</div>` : null}
          <button class="act lead" disabled=${!canStart("train") || !tuned} onClick=${startAll("train")}>start on every machine</button>
          ${!tuned ? html`<div class="small d2">Fine-tune something first.</div>` : null}
        </div>
        ${trained ? html`<div style="margin-top:14px">
          <div class="d0">Train a frontier-scale model</div>
          <div class="d1">This is what a campus is for. It sells at ${G.TRAINING.frontier.premium}x the frontier price, which is the one way to earn more once buyers are full. Needs one rack with ${G.TRAINING.frontier.minVram.toLocaleString("en-US")} GB of linked memory, and every rack you have, for a while.</div>
          <button class="act lead" disabled=${!canStart("frontier")} onClick=${startAll("frontier")}>start on every rack and machine</button>
        </div>` : null}`}
      ${state.ownModels.length ? html`<h2 class="hd" style="margin-top:22px">Yours</h2>${state.ownModels.map((raw) => {
        const x = G.allModels(state).find((m) => m.id === raw.id) || raw;
        const use = G.ownModelUse(state, x.id);
        return html`<div key=${x.id} style="margin-bottom:8px"><div class="sig">${x.name}, ${G.TIERS[x.tier].name.toLowerCase()}, ${x.premium >= 0.1 ? Math.round(x.premium * 100) / 100 : Number(x.premium.toPrecision(2))}x price${x.aged ? `, ${x.aged === 1 ? "a generation" : `${x.aged} generations`} old` : ""}</div><div class="small d1">Running on ${use.on} of your ${use.of} ${use.of === 1 ? "unit" : "machines and racks"}.</div><button class="act" onClick=${() => { const r = G.loadEverywhere(state, x.id); freshMoves(); doIt(r, false); }}>load it on everything that can hold it</button></div>`;
      })}` : null}
    </section>
  </div></div>`;
}

// ---- Status: one page of situational awareness ----
// Trying every move on a copy costs milliseconds at this scale, so it never runs inside the 250 ms render:
// the screen draws the last answer and a fresh one lands just after, at most a few percent of the time.
let moveCache = { key: "", moves: [], at: 0, cost: 0, pending: false, machineId: null };
function movesKey(m) {
  return JSON.stringify([m.id, state.site, state.feed, state.feedOrder, state.halls, state.tech, state.techOff, state.research?.levels, state.cooling, state.network, state.racks, state.machines.map((x) => [x.chassis, x.board, x.cpu, x.cooler, x.storage, x.psus, x.memory, x.gpus.map((g) => g.id), x.modelId, x.quant, x.on, x.tuned, x.task]), state.rows.map((r) => [r.sku, r.racks, r.modelId, r.quant, r.on, r.tuned, r.task])]);
}
function computeMoves(m, key) {
  const t0 = performance.now();
  moveCache.moves = G.nextMoves(state, m.id);
  moveCache.key = key;
  moveCache.machineId = m.id;
  moveCache.at = performance.now();
  moveCache.cost = moveCache.at - t0;
  moveCache.pending = false;
  moveCache.day = state.day;
}
function rankedMoves(m) {
  const key = movesKey(m);
  const sameCompany = key === moveCache.key;
  if (!moveCache.at || (!sameCompany && moveCache.machineId !== m.id)) {
    computeMoves(m, key);
  } else if ((!sameCompany || state.day - moveCache.day >= 3) && !moveCache.pending && performance.now() - moveCache.at > Math.max(600, moveCache.cost * 30)) {
    moveCache.pending = true;
    setTimeout(() => {
      if (!state) { moveCache.pending = false; return; }
      computeMoves(machine(), movesKey(machine()));
      draw();
    }, 0);
  }
  return moveCache.moves;
}
function freshMoves() {
  moveCache.at = 0;
  moveCache.key = "";
}
const GAUGE_TARGET = { network: "room", power: "room", heat: "room", noise: "room", space: "room", bill: "room", buyers: "market", rep: "market", speed: "models", memory: "models" };
function Gauge({ r }) {
  const detail = G.gaugeDetail(state, r.id);
  const cells = 16;
  const lit = Math.min(cells, Math.round(r.ratio * cells));
  return html`<button class=${`gauge ${r.status}`} onClick=${() => { ui.layer = GAUGE_TARGET[r.id]; draw(); }}>
    <span class="glabel">${r.name}</span>
    <span class="gvalue">${r.value}${r.limit ? html`<span class="gof"> of ${r.limit}</span>` : null}</span>
    <span class="gbar" aria-hidden="true">${Array.from({ length: cells }, (_, i) => html`<i class=${i < lit ? "lit" : ""}></i>`)}</span>
    <span class="gnote">${r.note}</span>
    ${detail.length ? html`<span class="gpop" role="tooltip">${detail.map(([a, b], i) => html`<span key=${i} class="gline"><span>${a}</span><span>${b}</span></span>`)}</span>` : null}
  </button>`;
}
function MachineCard({ x }) {
  const k = G.machineSheet(state, x);
  const sp = G.machineSpend(state, x);
  const counts = {};
  x.gpus.forEach((g) => { const n = label(G.part("gpus", g.id)); counts[n] = (counts[n] || 0) + 1; });
  const gear = Object.entries(counts).map(([n, c]) => (c > 1 ? `${c} x ${n}` : n)).join(", ") || "no GPU";
  const pic = x.gpus[0] ? GPU_ART[x.gpus[0].id] : null;
  const canCopy = G.isComplete(x);
  return html`<div class="urow">
    <button class="uopen" onClick=${() => { ui.machineId = x.id; ui.layer = "machine"; draw(); }}>
      <span class="upic">${pic ? html`<img src=${art(pic)} alt="" />` : null}</span>
      <span class="ubody">
        <span class="mh">${x.name} <span class=${`small ${WORD_CLASS[k.word]}`}>${k.word}</span></span>
        <span class="small d1">${gear}${k.model ? `, ${k.model.name}` : ""}</span>
      </span>
      <span class="unum"><b class=${k.net < 0 ? "sig" : ""}>${moneyAny(k.net)}</b><span class="small d1">${k.net > 0 ? `back in ${Math.ceil(sp.total / k.net).toLocaleString("en-US")} d` : "a day"}</span></span>
    </button>
    ${canCopy ? (() => { const plan = G.copyPlan(state, x); return html`<button class="act ucopy" disabled=${!plan.ok} title=${plan.ok ? "" : plan.reason} onClick=${() => copyMachine(x)}>${plan.ok ? `${plan.where === "rack" ? "copy to rack" : "copy"}, ${moneyShort(plan.cost)}` : "no room"}</button>`; })() : html`<span></span>`}
  </div>`;
}
/** One card per kind of rack and model, because nobody reads sixty rows. */
/** A whole group of identical machines as one line, with the names one click away. */
function MachineGroup({ g }) {
  if (g.list.length === 1) return html`<${MachineCard} x=${g.list[0]} />`;
  const x = g.list[0];
  const pic = x.gpus[0] ? GPU_ART[x.gpus[0].id] : null;
  const plan = G.copyPlan(state, x);
  return html`<div class="urow">
    <button class="uopen" onClick=${() => { ui.machineId = x.id; ui.layer = "machine"; draw(); }}>
      <span class="upic">${pic ? html`<img src=${art(pic)} alt="" />` : null}</span>
      <span class="ubody">
        <span class="mh">${g.list.length} machines <span class=${`small ${WORD_CLASS[g.word]}`}>${g.word}</span></span>
        <span class="small d1">${g.gear}, ${g.model}</span>
      </span>
      <span class="unum"><b class=${g.net < 0 ? "sig" : ""}>${moneyAny(g.net)}</b><span class="small d1">${g.net > 0 ? `back in ${Math.ceil(g.paid / g.net).toLocaleString("en-US")} d` : "a day"}</span></span>
    </button>
    <button class="act ucopy" disabled=${!plan.ok} title=${plan.ok ? "" : plan.reason} onClick=${() => copyMachine(x)}>${plan.ok ? `${plan.where === "rack" ? "+1 to rack" : "+1"}, ${moneyShort(plan.cost)}` : "no room"}</button>
  </div>`;
}
function RowCard({ g }) {
  const dayCost = G.dollarsPerDay(state, g.wall);
  const net = g.revenue - dayCost;
  const each = G.rackPrice(state, g.sku);
  return html`<div class="urow">
    <button class="uopen" onClick=${() => openRow(g.first)}>
      <span class="upic"><img class="rackpic" src=${art(g.sku.art)} alt="" /></span>
      <span class="ubody">
        <span class="mh">${g.racks} ${g.sku.short} ${g.racks === 1 ? "rack" : "racks"}</span>
        <span class="small d1">${g.model ? g.model : html`<span class="rev">${g.note}</span>`}, ${(g.racks * g.sku.cards).toLocaleString("en-US")} cards</span>
      </span>
      <span class="unum"><b class=${net < 0 ? "sig" : ""}>${moneyShort(net)}</b><span class="small d1">${net > 0 ? `back in ${Math.ceil((each * g.racks) / net).toLocaleString("en-US")} d` : "a day"}</span></span>
    </button>
    <button class="act ucopy" disabled=${state.cash < each} onClick=${() => buyAndSay(g.sku, 1)}>+1, ${moneyShort(each)}</button>
  </div>`;
}
function rowGroups() {
  const groups = new Map();
  for (const r of state.rows) {
    const o = r.output || {};
    const note = !r.on ? "switched off" : r.task !== "serve" ? "training" : "no model loaded";
    const key = `${r.sku}|${o.model?.id || note}`;
    const g = groups.get(key) || { key, racks: 0, sku: G.skuOf(r), model: o.model?.name, note, mtok: 0, sold: 0, revenue: 0, wall: 0, first: r };
    g.racks += r.racks;
    g.mtok += o.mtok || 0;
    g.sold += (o.mtok || 0) * (o.util ?? 0);
    g.revenue += o.revenue || 0;
    g.wall += o.wall || 0;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.revenue - a.revenue);
}
function Ledger() {
  const l = G.ledger(state);
  const part = (name, n, cls = "") => html`<span class=${`lpart ${cls}`}><span class="lname">${name}</span><span class="lnum">${moneyShort(n)}</span></span>`;
  return html`<div class="ledger" role="group" aria-label="Today's money">
    ${part("Sales", l.sales)}<span class="lop">-</span>${part(l.machines && state.rows.length ? "Power: racks and machines" : "Power: machines", l.machines)}<span class="lop">-</span>${part("Power: cooling", l.cooling, l.cooling > l.machines ? "sig" : "")}${l.other > 0.01 ? html`<span class="lop">-</span>${part("Power: network", l.other)}` : null}${l.rent ? html`<span class="lop">-</span>${part(state.rows.length ? "Rent and contracts" : "Rent", l.rent)}` : null}${l.staff ? html`<span class="lop">-</span>${part("Salaries and upkeep", l.staff)}` : null}<span class="lop">=</span>${part("Profit a day", l.profit, l.profit < 0 ? "sig" : "")}
  </div>`;
}
function Markets() {
  const rows = G.markets(state);
  const top = Math.max(...rows.map((r) => Math.max(r.demand, r.made)), 1);
  return html`<section>
    <h2 class="hd">Token markets, per day</h2>
    ${rows.map((r) => html`<button class="mkt" key=${r.tier} onClick=${() => { ui.layer = "models"; draw(); }}>
      <span class="mktname">${r.name} <span class="d2">${moneyAny(r.price)}${r.world && Math.abs(r.world.factor - 1) >= 0.05 ? `, ${pct(r.world.factor)} of normal` : !r.world && r.change < -0.01 ? `, ${Math.round(r.change * 100)}%` : ""}</span></span>
      <span class="mktbar" aria-hidden="true"><i class="want" style=${`width:${Math.max(1, Math.sqrt(r.demand / top) * 100)}%`}></i><i class=${`made ${r.made > r.demand * 1.02 ? "over" : ""}`} style=${`width:${Math.min(100, Math.sqrt(r.made / top) * 100)}%`}></i></span>
      <span class=${`mktnum ${r.made > r.demand * 1.02 ? "sig" : r.made ? "" : "d2"}`}>${r.made ? `you make ${tokShort(r.made)} of ${tokShort(r.demand)} wanted` : `${tokShort(r.demand)} wanted, you make none`}</span>
    </button>`)}
  </section>`;
}
function Status2({ m }) {
  const sit = G.situation(state);
  const shown = !state.hideMoves;
  const moves = shown ? rankedMoves(m) : [];
  const designs = designGroups();
  const usable = moves.filter((x) => x.payback < Infinity && !x.trips);
  // One entry per kind of change: the options for one machine replace each other, so they'd crowd out everything else.
  const seenKinds = new Set();
  const paid = usable.filter((x) => {
    if (!x.kind) return true;
    if (seenKinds.has(x.kind)) return false;
    seenKinds.add(x.kind);
    return true;
  }).slice(0, 4);
  const extra = usable.filter((x) => !paid.includes(x)).slice(0, 12);
  const act = (move) => () => { const r = G.doMove(state, move, m.id); freshMoves(); doIt(r); };
  const actAll = (move) => () => { const r = G.doMoveAll(state, move, m.id); freshMoves(); if (r.ok) flashNote(`Done on ${r.done} machines.`); doIt(r); };
  const moveItem = (x) => {
    const a = x.all;
    const can = a ? Math.min(a.count, Math.floor(state.cash / Math.max(1, a.cost / a.count))) : 0;
    return html`<div key=${x.id} class="moveitem"><button class=${`move ${state.cash >= x.cost ? "" : "off"}`} onClick=${act(x)}>
      <span class="car">></span>
      <span class="mname">${x.label}</span>
      <span class="mstat">${x.cost ? money(x.cost) : "free"}, +${moneyShort(x.gain)} a day, back in ${x.payback === 0 ? "no time" : `${Math.ceil(x.payback).toLocaleString("en-US")} days`}</span>
      ${x.unlocks ? html`<span class="mnote">${x.unlocks}</span>` : null}
    </button>
    ${a && a.gain > 0.01 && !a.trips ? html`<button class="act moveall" disabled=${can < 1} onClick=${actAll(x)}>${can >= a.count ? `do all ${a.count} like it: ${money(a.cost)}, +${moneyShort(a.gain)} a day` : `do the ${can} you can afford of ${a.count}: about ${money((a.cost / a.count) * can)}, +${moneyShort((a.gain / a.count) * can)} a day`}, back in ${Math.ceil(a.payback).toLocaleString("en-US")} days</button>` : null}
    </div>`;
  };
  const groups = rowGroups();
  return html`<div class="wide spaced">
    <${Ledger} />
    <div class="gauges">${sit.rows.map((r) => html`<${Gauge} key=${r.id} r=${r} />`)}</div>
    <${WorldStrip} />
    <div class="statusrow">
      <section>
        <h2 class="hd">${groups.length ? "Your racks and machines" : "Your machines"}, best first</h2>
        <${MatchBest} />
        <div class="unitlist">
          ${groups.map((g) => html`<${RowCard} key=${g.key} g=${g} />`)}
          ${designs.map((g) => html`<${MachineGroup} key=${g.key} g=${g} />`)}
        </div>
      </section>
      <${Markets} />
      <section>
        <div class="rowhead">
          <h2 class="hd">Moves worth a look</h2>
          <button class="act" onClick=${() => { state.hideMoves = !state.hideMoves; draw(); }}>${shown ? "hide, I'll do the math" : "show moves"}</button>
        </div>
        ${shown ? html`
          ${paid.map(moveItem)}
          ${extra.length ? html`<${More} id="moremoves" title=${`Other options: ${extra.length}`}>${extra.map(moveItem)}</${More}>` : null}
          ${paid.length ? null : html`<p class="d2" style="margin:0">Nothing you can add right now would earn more than its power costs. Compare what you make with what buyers want, or look at swapping machines for a bigger model.</p>`}
        ` : html`<p class="d2" style="margin:0">Hidden. The numbers above are all you need.</p>`}
      </section>
    </div>
  </div>`;
}

// ---- Power row and tape ----
function Foot() {
  const here = G.site(state);
  const cells = innerWidth <= 1080 ? 24 : 40;
  const limit = G.limitAmps(state);
  const toCell = (amps) => Math.min(cells, Math.round((amps / limit) * cells));
  const pw = (amps) => G.powerText(state, amps);
  const load = state.load || { machines: 0, cooling: 0, house: 0, spike: 0 };
  const a1 = toCell(load.house);
  const a2 = toCell(load.house + load.machines);
  const a3 = toCell(load.house + load.machines + load.cooling);
  const a4 = toCell(state.amps);
  const after = ui.hover && ui.hover.ampsAfter ? toCell(ui.hover.ampsAfter) : a4;
  const safe = G.safeAmps(state);
  const safeCell = here.shared ? toCell(safe) : -1;
  const blocks = Array.from({ length: cells }, (_, i) => {
    let cls = "";
    if (i < a1) cls = "house";
    else if (i < a2) cls = "lit";
    else if (i < a3) cls = "cool";
    else if (i < a4) cls = "hot";
    else if (i < after) cls = "ghost";
    if (i === safeCell) cls += " safe";
    return html`<i class=${cls}></i>`;
  });
  const dB = G.noiseLevel(state);
  const quiet = here.noise > 150;
  const news = state.news.slice(0, 8);
  const overSafe = state.amps > safe;
  const alert = ui.flash && !ui.flash.quiet && ui.flash.until > performance.now() ? ui.flash.text : null;
  const notice = ui.flash && ui.flash.quiet && ui.flash.until > performance.now() ? ui.flash.text : null;
  const warn = G.advice(state);
  return html`<div class="foot">
    <${DealStrip} />
    <div class="read">
      <span class=${overSafe || (state.capFactor ?? 1) < 1 ? "sig" : "d0"}>Power ${pw(state.amps)} of ${pw(limit)}<span class="d2 wideonly small"> ${here.feeds ? `${state.amps.toFixed(1)} of ${limit.toFixed(limit % 1 ? 1 : 0)} A at ${here.kv} kV` : `${Math.round(state.wallW).toLocaleString("en-US")} of ${(limit * here.volts).toLocaleString("en-US")} W`}</span></span>
      ${state.spike ? html`<span class="sig">${state.spike.name || "an appliance"} +${load.spike.toFixed(1)} A</span>` : here.shared ? html`<span class=${`${overSafe ? "sig" : "d2"} wideonly`}>safe under ${safe.toFixed(1)} A</span>` : null}
      <span class=${state.roomC > 32 ? "sig" : "d0"}>${state.rows.length ? "Hall" : "Room"} ${Math.round(state.roomC)} of 32 C</span>
      <span class=${dB > here.noise ? "sig" : "d1"}>${quiet ? `${Math.round(dB)} dB` : `${Math.round(dB)} of ${here.noise} dB`}</span>
      <span class="d1 wideonly">Bill ${moneyAny(state.stats.powerPerDay + (state.stats.capacityPerDay || 0))} a day</span>
    </div>
    <div class="blocks" role="img" aria-label=${`Load: ${pw(state.amps)} of ${pw(limit)}.`}>${blocks}</div>
    ${alert ? html`<div aria-live="polite"><span class="rev">${alert}</span></div>` : notice && ui.layer !== "machine" ? html`<div class="sig" aria-live="polite">${notice}</div>` : warn ? html`<div class="d0" aria-live="polite"><span class="sig">!</span> ${warn}</div>` : null}
    <${Tape} news=${news} />
    <div class="sr" aria-live="polite">${news[0]?.text}</div>
  </div>`;
}
function Tape({ news }) {
  // Repeat the news until one half is wider than any screen, so the loop never shows a gap.
  const items = [];
  let chars = 0;
  while (news.length && chars < 340) {
    for (const n of news) {
      items.push(n);
      chars += n.text.length + 8;
    }
  }
  const half = items.map((n, i) => html`<span key=${i} class=${n.kind}>${n.text}</span>`);
  return html`<div class="tape" aria-hidden="true"><div style=${`--tape:${Math.max(40, chars * 0.2)}s`}><p>${half}</p><p>${half}</p></div></div>`;
}

const layerList = () => ["status", "room", "machine", "models", "apps", "market", "lab"];
const LAYER_NAME = { status: "status", room: "floor", machine: "bench", apps: "products", models: "models", market: "money", lab: "lab" };
const LAYER_JOB = {
  status: "How the business is running right now.",
  room: "Everything you own and where it is: machines, racks, cooling, network, power. Hover anything. Click to manage it.",
  machine: "Design one machine, then copy it.",
  models: "What you're making, how much of it, and on what.",
  apps: "Your own products: buyers only you can serve, paying more than the open market.",
  market: "Where the money comes from and where it goes.",
  lab: "What you're investing in for later.",
};
function Head() {
  const speedBtn = (s, text) => html`<button class=${`act ${!ui.paused && ui.speed === s ? "on" : ""}`} onClick=${() => { ui.speed = s; ui.paused = false; draw(); }}>${text}</button>`;
  const nav = layerList().map((id) => [id, LAYER_NAME[id]]);
  const trainable = state.rows.length && !state.project && !state.ownModels.some((x) => x.premium >= G.TRAINING.frontier.premium) && state.ownModels.some((x) => x.tier === "frontier") && G.allUnits(state).some((x) => G.isRunning(x) && G.totalVram(x) >= G.TRAINING.frontier.minVram);
  const pings = { market: !!state.offer, lab: !!state.pendingName || !!trainable, room: G.fleetUnlocked(state) && !state.rows.length };
  const profit = state.stats.profitPerDay;
  return html`<header class="head">
    <div>
      <h1 class="mark">FIFTEEN AMPS<span class="blk" aria-hidden="true"></span></h1>
      <div class="facts"><span>${dayName(state.day)}</span><span>Served ${mtok(state.served)}</span></div>
      <nav class="nav" aria-label="Screens">
        ${nav.map(([id, text]) => html`<button key=${id} class=${`act ${ui.layer === id ? "on" : ""}`} aria-current=${ui.layer === id ? "page" : null} onClick=${() => { ui.layer = id; draw(); }}>${text}${pings[id] ? html` <span class="sig">*</span>` : null}</button>`)}
      </nav>
      <div class="purpose small d1">${LAYER_JOB[ui.layer]}</div>
      <div class="speed">
        <button class=${`act ${ui.paused ? "on" : ""}`} onClick=${() => { ui.paused = !ui.paused; draw(); }}>pause</button>
        ${speedBtn(1, "1x")}${speedBtn(3, "3x")}${speedBtn(8, "8x")}
        <button class="act" onClick=${() => { ui.sound = !ui.sound; draw(); }}>sound ${ui.sound ? "on" : "off"}</button>
        <button class="act" onClick=${() => { ui.about = true; draw(); }}>about</button>
      </div>
    </div>
    <div class="cash">
      <span class="small d1">Cash</span>
      <span class="n">${money(state.cash)}</span>
      <span class="rate d1">${profit < 0 ? html`<span class="rev">${moneyAny(profit)} a day</span>` : `+${moneyAny(profit)} a day`}</span>
    </div>
  </header>`;
}

function Game() {
  // A snapshot taken before racks moved to the floor lands on that tab.
  if (ui.layer === "fleet") {
    ui.layer = "room";
    ui.floorTab = "racks";
  }
  const m = machine();
  ui.machineId = m.id;
  const shake = useRef(0);
  const shell = useRef(null);
  useEffect(() => {
    if (ui.shake !== shake.current) {
      shake.current = ui.shake;
      if (shell.current && !reduced()) {
        shell.current.classList.remove("shake");
        void shell.current.offsetWidth;
        shell.current.classList.add("shake");
      }
    }
  });
  let body;
  if (ui.layer === "status") body = html`<${Status2} m=${m} />`;
  else if (ui.layer === "models") body = html`<${Models} m=${(ui.modelsRow && state.rows.find((r) => r.id === ui.modelsRow)) || m} />`;
  else if (ui.layer === "market") body = html`<${Market} />`;
  else if (ui.layer === "room") body = html`<${Room} />`;
  else if (ui.layer === "apps") body = html`<${Products} />`;
  else if (ui.layer === "lab") body = html`<${Lab} m=${m} />`;
  else {
    const hover = ui.hover && (ui.hover.kind === ui.slot) ? ui.hover : null;
    body = html`
      <${Status} m=${m} />
      <aside class="col">
        <${MachineList} m=${m} />
        <${Slots} m=${m} />
        <${MachineVerbs} m=${m} />
      </aside>
      <div class="center">
        <div class="rigbox"><${Rig} key=${m.id} m=${m} hover=${hover} /></div>
      </div>
      <aside class="col"><${Shop} m=${m} /></aside>`;
  }
  const covered = !!(state.tripped || state.pendingName || ui.about || ui.finale);
  return html`<main class="shell" ref=${shell} inert=${covered} style=${ui.finale ? "visibility:hidden" : ""}>
    <${Head} />
    <div class=${`stage ${ui.layer === "machine" ? "withflow" : ""}`}>${body}</div>
    <${Foot} />
  </main>
  ${state.tripped ? html`<${Trip} />` : null}
  ${state.pendingName ? html`<${NameModel} />` : null}
  ${ui.about ? html`<${About} />` : null}
  ${ui.finale ? html`<${Finale} />` : null}`;
}

function Trip() {
  const t = state.lastTrip;
  const ref = useRef(null);
  useEffect(() => ref.current?.focus(), []);
  const here = G.site(state);
  return html`<div class="takeover" role="alertdialog" aria-label="Breaker tripped">
    <h2><span class="rev">BREAKER</span><br />TRIPPED</h2>
    ${t ? html`<div class="math">
      <div class="line"><span class="d1">${state.rows.length ? "Your racks and machines" : "Your machines"}</span><span>${G.powerText(state, t.machines)}</span></div>
      ${t.cooling >= 0.05 ? html`<div class="line"><span class="d1">Your cooling</span><span>${G.powerText(state, t.cooling)}</span></div>` : null}
      ${here.feeds ? null : html`<div class="line"><span class="d1">The house</span><span>${t.house.toFixed(1)} A</span></div>`}
      ${t.spike ? html`<div class="line"><span class="sig">${t.spikeName}</span><span class="sig">+${t.spike.toFixed(1)} A</span></div>` : null}
      <div class="line"><span class="d0">${here.feeds ? `Total, on a ${G.powerText(state, t.limit)} contract` : `Total, on a ${Math.round(t.limit)}-amp breaker`}</span><span class="d0">${G.powerText(state, t.total)}</span></div>
    </div>` : null}
    <p>${t?.fault ? `${t.fault} Your load was fine. The big breaker opened anyway, because that's its job.` : !t ? "The circuit went over its limit. Flip it back on and watch the power row." : t.spike && t.machines + t.cooling + t.house < t.limit ? `You were fine until someone used ${t.spikeName}. This outlet is shared. A dedicated circuit in the spare room ends this for good.` : "Your own load is over the limit. It'll trip again unless you shut something off or move somewhere bigger."} Nothing earns while the power's out, and your reputation is sliding.</p>
    <button ref=${ref} class="act lead big" onClick=${() => { beep(1400, 40, 0.07); G.resetBreaker(state); draw(); }}>flip it back on</button>
    ${state.machines.filter(G.isRunning).slice(0, state.rows.length ? 3 : 99).map((x) => html`<button key=${x.id} class="act" onClick=${() => { x.on = false; G.resetBreaker(state); draw(); }}>shut off ${x.name}, then flip it</button>`)}
    ${state.rows.some((r) => r.on) ? html`<button class="act" onClick=${() => { const on = state.rows.filter((r) => r.on); on[on.length - 1].on = false; G.resetBreaker(state); draw(); }}>shut off the newest row, then flip it</button>` : null}
    ${[...new Set(state.cooling)].slice(0, state.rows.length ? 2 : 99).map((id) => html`<button key=${id} class="act" onClick=${() => { G.sellCooling(state, id); G.resetBreaker(state); draw(); }}>sell one ${G.COOLING.find((c) => c.id === id).name}, then flip it</button>`)}
    ${[...new Set(state.network)].slice(0, 3).map((id) => html`<button key=${id} class="act" onClick=${() => { G.sellNetwork(state, id); G.resetBreaker(state); draw(); }}>sell one ${G.part("network", id).name}, then flip it</button>`)}
    ${G.hasTech(state, "powerlimit") && G.allUnits(state).some((x) => G.isRunning(x) && !x.tuned) ? html`<button class="act" onClick=${() => { G.allUnits(state).forEach((x) => (x.tuned = true)); G.resetBreaker(state); draw(); }}>power-limit every card, then flip it</button>` : null}
  </div>`;
}

function NameModel() {
  const [name, setName] = useState("");
  const ref = useRef(null);
  useEffect(() => ref.current?.focus(), []);
  const kind = state.pendingName.kind;
  const release = (e) => {
    e.preventDefault();
    const clean = name.trim() || (kind === "train" ? "Fifteen One" : "Fifteen Mini");
    G.finishModel(state, clean);
    if (kind === "train" || kind === "frontier") {
      ui.finale = clean;
      ui.finaleKind = kind;
    } else {
      flashNote(`${clean} is live. Find it in the models screen.`);
    }
    draw();
  };
  return html`<form class="takeover" onSubmit=${release}>
    <h2>${kind === "train" || kind === "frontier" ? "It's done" : "It works"}<span class="blk" aria-hidden="true"></span></h2>
    <p>${kind === "frontier" ? "A frontier-scale model, on racks you run, on a contract you signed, from a company that started on one outlet. It needs a name." : kind === "train" ? "You trained a model from scratch, on hardware you bought one part at a time, starting from one outlet. It needs a name." : "Your fine-tuned model is ready to sell. It needs a name."}</p>
    <label class="field"><span>></span><span class="sr">Model name</span><input id="model-name" ref=${ref} value=${name} maxlength="28" placeholder="name it" autocomplete="off" onInput=${(e) => setName(e.target.value)} /></label>
    <button class="act lead big" type="submit">release it</button>
  </form>`;
}

function About() {
  const close = () => { ui.about = false; ui.confirmRestart = false; draw(); };
  const first = useRef(null);
  useEffect(() => {
    const opener = document.activeElement;
    first.current?.focus();
    return () => opener?.focus?.();
  }, []);
  return html`<div class="takeover" role="dialog" aria-label="About">
    <h2 style="font-size:clamp(32px,5vw,70px)">About</h2>
    <p>You start with one outlet and an old PC, sell tokens to pay for parts, and work your way up to training your own AI.</p>
    <p>The parts and models are real, and their specs and rough prices were researched in November 2026. Token prices, demand, events and speed estimates are tuned for fun, and everything in the data center stage, from rack prices to power feeds, is fantasy-tuned around real product names. Past Feynman, the racks, labs and models of later generations are made up. This is a game, so please don't buy anything because of it.</p>
    ${state ? html`<${RulesPanel} />` : null}
    <p class="small d2">Speed calibration uses the Will It Run dataset from specpicks.com (CC BY 4.0). Pixel font is Departure Mono by Helena Zhang (SIL OFL).</p>
    <p class="small d2">Keys: 1 to ${layerList().length} switch screens, space pauses.</p>
    <p class="small d2">Play log: ${playlog.db ? "your clicks and a snapshot of your company go to this game's private database, so Claude can see how a session went." : "not connected in this view."}</p>
    ${playlog.db ? html`<button class="act" onClick=${() => { playlog.on = !playlog.on; draw(); }}>${playlog.on ? "stop sending the play log" : "start sending the play log"}</button>` : null}
    <button ref=${first} class="act lead" onClick=${close}>back to the game</button>
    ${ui.confirmRestart ? html`<button class="act" onClick=${() => { clearSave(); state = null; ui.confirmRestart = false; ui.about = false; ui.screen = "title"; draw(); }}>yes, erase this run</button>` : html`<button class="act" onClick=${() => { ui.confirmRestart = true; draw(); }}>start over</button>`}
  </div>`;
}

function Title() {
  const saved = loadSave();
  const start = (s) => {
    freshMoves();
    state = s || G.newGame();
    G.recompute(state);
    lastTrips = state.trips;
    ui.screen = "game";
    ui.machineId = state.machines[0].id;
    ui.slot = "gpus";
    ui.slotIndex = "new";
    ui.layer = "machine";
    beep(330, 90);
    setTimeout(() => beep(495, 130), 90);
    draw();
  };
  return html`<main class="title">
    <h1>FIFTEEN<br />AMPS</h1>
    <div class="tag">START WITH ONE OUTLET<span class="blk caret" aria-hidden="true"></span></div>
    <div class="menu">
      ${saved ? html`<button class="act lead" onClick=${() => start(saved)}>keep going, ${dayName(saved.day).toLowerCase()}, ${money(saved.cash)}</button>` : null}
      <button class=${`act ${saved ? "" : "lead"}`} onClick=${() => start(null)}>${saved ? "start a new company" : "plug it in"}</button>
    </div>
    ${saved ? null : html`<p class="fine">A new company plays the living world: the frontier moves, prices follow supply, and new chips come in allocations. Switch any of them off in About.</p>`}
    <p class="fine">Run an AI company from your hall closet. Real parts and real models, sold by the million tokens. Watch the breaker. The prices and the economy are made up for fun, so it's a game and not buying advice.</p>
  </main>`;
}

// The ending. A real sine scroller, because this whole world is a cracktro.
function Finale() {
  const ref = useRef(null);
  const keep = useRef(null);
  const name = ui.finale;
  useEffect(() => {
    keep.current?.focus();
    const c = ref.current;
    const ctx = c.getContext("2d");
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const fit = () => { c.width = innerWidth * dpr; c.height = innerHeight * dpr; };
    fit();
    addEventListener("resize", fit);
    const text = `FIFTEEN AMPS PRESENTS ... ${name.toUpperCase()} ... TRAINED FROM SCRATCH IN ${Math.floor(state.day / 365)} YEARS AND ${Math.floor(state.day % 365)} DAYS ... ${mtok(state.served).toUpperCase()} SERVED ... ${money(state.earned)} EARNED ... ${state.trips} TRIPPED BREAKERS ... GREETINGS TO THE HALL CLOSET ... THE VACUUM ... THE NEIGHBORS ... EVERY USED RTX 3090 THAT GAVE ITS LIFE ... ${state.rows.length ? "THE UTILITY ... THE SQUIRREL ... " : ""}AND THE ELECTRICIAN WHO ASKED NO QUESTIONS ...      `;
    let raf;
    const t0 = performance.now();
    const draw2 = (now) => {
      const w = c.width;
      const h = c.height;
      ctx.clearRect(0, 0, w, h);
      const size = Math.round(Math.min(w / 12, h / 6.5));
      ctx.font = `${size}px Departure, monospace`;
      ctx.textBaseline = "middle";
      const adv = size * 0.62;
      const t = reduced() ? 0 : (now - t0) / 1000;
      const offset = reduced() ? 0 : (t * size * 2.1) % (text.length * adv);
      for (let i = 0; i < text.length; i++) {
        const x = w + i * adv - offset - (reduced() ? w : 0);
        const wrapped = x < -adv ? x + text.length * adv : x;
        if (wrapped > w + adv || wrapped < -adv) continue;
        const y = h * 0.34 + Math.sin(wrapped / (size * 2.4) + t * 2.2) * h * 0.07;
        ctx.fillStyle = (i + Math.floor(t * 3)) % 7 === 0 ? "#ffb000" : "#e6e2d6";
        ctx.fillText(text[i], wrapped, y);
      }
      ctx.fillStyle = "#ffb000";
      ctx.font = `${Math.round(size * 0.4)}px Departure, monospace`;
      ctx.textAlign = "center";
      ctx.fillText(ui.finaleKind === "frontier" ? "YOU BUILT A FRONTIER LAB" : "YOU MADE YOUR OWN AI", w / 2, h * 0.09);
      ctx.textAlign = "start";
      raf = requestAnimationFrame(draw2);
    };
    raf = requestAnimationFrame(draw2);
    return () => { cancelAnimationFrame(raf); removeEventListener("resize", fit); };
  }, []);
  return html`<canvas class="scroller" ref=${ref} role="img" aria-label=${`${name}: you made your own AI`}></canvas>
  <div class="finale"><div class="finrig">${state.rows.length ? html`<${Hall} />` : html`<${Rig} m=${machine()} />`}</div><p class="d1" style="margin:0">${name} is live. You can keep running the company.</p><button ref=${keep} class="act lead big" onClick=${() => { ui.finale = false; draw(); }}>keep running</button></div>`;
}

function App() {
  if (ui.screen === "title") return html`<${Title} />`;
  return html`<${Game} />`;
}

let scheduled = false;
function draw() {
  if (scheduled) return;
  scheduled = true;
  // Not requestAnimationFrame: it never fires in a background tab, which would leave the page blank.
  queueMicrotask(() => {
    scheduled = false;
    document.documentElement.classList.toggle("tripped", !!(state && state.tripped && ui.screen === "game"));
    render(html`<${App} />`, document.getElementById("root"));
  });
}

addEventListener("keydown", (e) => {
  if (ui.screen !== "game" || e.target.tagName === "INPUT") return;
  if (e.key === "Escape" && ui.about) {
    ui.about = false;
    draw();
    return;
  }
  if (state.tripped || state.pendingName || ui.about || ui.finale) return;
  const layers = layerList();
  if (e.key >= "1" && Number(e.key) <= layers.length) {
    ui.layer = layers[Number(e.key) - 1];
    draw();
  } else if (e.key === " " && e.target.tagName !== "BUTTON") {
    e.preventDefault();
    ui.paused = !ui.paused;
    draw();
  }
});
addEventListener("visibilitychange", () => { if (document.hidden) writeSave(); });

function boot(snapshot) {
  if (snapshot?.state) {
    state = snapshot.state;
    Object.assign(ui, snapshot.ui || {});
    lastTrips = state.trips;
    G.recompute(state);
  }
  startDust();
  startPlaylog();
  draw();
  setInterval(step, 250);
  setInterval(writeSave, 5000);
}
window.claude?.hot?.snapshot?.(() => ({ state, ui: { screen: ui.screen, layer: ui.layer, machineId: ui.machineId, slot: ui.slot, speed: ui.speed, paused: ui.paused } }));
(document.fonts?.load?.('20px "Departure"') || Promise.resolve()).catch(() => {}).finally(() => {
  if (window.claude?.hot?.ready) window.claude.hot.ready(boot);
  else boot(window.claude?.hot?.data ?? {});
});
// For the headless tests. Harmless in play.
window.__game = { get state() { return state; }, ui, draw, G };
