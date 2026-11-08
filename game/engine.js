// Fifteen Amps simulation. No DOM here, so tools/balance.mjs can play it headless.
// One tick unit is one game day. Hardware specs are real; the economy is tuned for fun.
import { CATALOG } from "./catalog.js";

export const SITES = [
  { id: "closet", name: "Hall closet", volts: 120, amps: 15, passiveW: 450, floor: 1, rent: 0, cost: 0, noise: 48, shared: true, note: "One outlet, shared with the vacuum." },
  { id: "spare", name: "Spare room", volts: 120, amps: 20, passiveW: 900, floor: 2, rent: 0, cost: 1800, noise: 55, note: "An electrician runs you a dedicated 20-amp circuit. Nobody else can plug into it." },
  { id: "garage", name: "Garage", volts: 240, amps: 50, passiveW: 2500, floor: 3, rent: 0, cost: 9000, noise: 72, note: "New 240-volt subpanel. The car lives outside now." },
  { id: "cage", name: "Colo cage", volts: 208, amps: 200, passiveW: 8000, floor: 6, rent: 90, cost: 90000, noise: 200, note: "A locked cage in someone else's data center." },
  { id: "warehouse", name: "Warehouse", volts: 480, amps: 800, passiveW: 30000, floor: 40, rent: 700, cost: 900000, noise: 200, heatRise: 1500, fabricTb: 13, note: "Your own building, and the first place a whole rack of servers fits." },
  // Past here the power is a contract with the utility. Volts are line-to-line times the square root of 3, so volts x amps is real three-phase watts.
  { id: "datacenter", name: "Data center", kv: 138, volts: 239023, passiveW: 200000, floor: 40, hall: { floor: 40, cost: 4000000 }, rent: 8000, cost: 15000000, noise: 200, heatRise: 20000, fabricTb: 60, energy: 0.55, feeds: [{ amps: 15, cost: 0, days: 0 }, { amps: 30, cost: 18000000, days: 40 }, { amps: 60, cost: 45000000, days: 70 }, { amps: 125, cost: 110000000, days: 110 }], note: "A real data hall on a transmission line. The utility gives you fifteen amps. At 138,000 volts, that's 3.6 megawatts." },
  { id: "campus", name: "Campus", kv: 138, volts: 239023, passiveW: 800000, floor: 200, hall: { floor: 200, cost: 20000000 }, rent: 60000, cost: 350000000, noise: 200, heatRise: 100000, fabricTb: 240, energy: 0.4, feeds: [{ amps: 200, cost: 0, days: 0 }, { amps: 400, cost: 300000000, days: 120 }, { amps: 800, cost: 700000000, days: 180 }], note: "Your own substation on your own land. Long power contracts at the cheapest rate you'll ever see." },
];
const CAPACITY_PER_MW_DAY = 400;
const SUPPORT_PER_YEAR = 0.08;

export const COOLING = [
  { id: "fan", name: "Box fan in the door", cost: 40, coolW: 350, drawW: 70 },
  { id: "window", name: "Window AC, 12,000 BTU", cost: 480, coolW: 3500, drawW: 1100 },
  { id: "split", name: "Mini-split, 24,000 BTU", cost: 4800, coolW: 7000, drawW: 1900 },
  { id: "crac", name: "Computer room AC", cost: 38000, coolW: 60000, drawW: 16000 },
  { id: "immersion", name: "Immersion tanks", cost: 240000, coolW: 300000, drawW: 30000 },
  ...CATALOG.plant,
];

export const TECH = [
  { id: "powerlimit", name: "Power limiting", cost: 150, day: 0, text: "Cap each card's power. Lose about 6% speed, save about 20% power." },
  { id: "batch", name: "Request batching", cost: 1400, day: 0, text: "Serve several customers at once. Every machine earns 2.5x." },
  { id: "tensor", name: "Tensor split", cost: 9000, day: 0, text: "Models split across cards get faster, not just bigger." },
  { id: "cache", name: "Prompt caching", cost: 60000, day: 0, text: "Stop computing the same thing twice. Every machine earns 1.3x." },
  { id: "router", name: "Smart routing", cost: 400000, day: 0, text: "Send each request to the cheapest model that can answer. Every machine earns 1.3x." },
  { id: "disagg", name: "Disaggregated inference", cost: 900000, day: 0, site: "warehouse", fleet: 1.4, text: "Split reading and writing across different cards. Racks make 1.4x the tokens." },
  { id: "lease", name: "GPU rental desk", cost: 2000000, day: 0, site: "warehouse", text: "Rent idle cards to other labs by the hour. Whatever buyers don't want still earns slow, steady money, and draws full power to do it." },
  { id: "sales", name: "Enterprise sales team", cost: 1500000, day: 0, site: "warehouse", demand: 4, wholesale: 0.7, text: "People who answer the phone. Buyers want 4x the tokens in every model size, and haggle 30% off. Buy it when buyers are full." },
  { id: "resale", name: "Capacity deals with clouds", cost: 12000000, day: 0, site: "datacenter", demand: 4, wholesale: 0.7, text: "Other companies resell your tokens. Buyers want 4x more, at another 30% off." },
  { id: "sovereign", name: "Sovereign AI deals", cost: 90000000, day: 0, site: "datacenter", demand: 6, wholesale: 0.8, text: "Whole countries want their own models. Buyers want 6x more, at another 20% off." },
  { id: "offtake", name: "Hyperscaler offtake", cost: 600000000, day: 0, site: "campus", demand: 5, wholesale: 0.7, text: "The big clouds buy what they can't build fast enough. Buyers want 5x more, at another 30% off." },
];

// San Francisco really pays about 41 cents. The game charges less so power is a cost to manage, not a tax on everything.
const POWER_CENTS = 16;
const APPLIANCE_MAX_W = 1150;
/** Run below this and no single appliance can trip you. Only the shared closet circuit has a gap. */
export function safeAmps(state) {
  const here = site(state);
  return here.shared ? here.amps - APPLIANCE_MAX_W / here.volts : limitAmps(state);
}

export const TIERS = {
  tiny: { name: "Tiny", price: 0.4, demand: 14 },
  small: { name: "Small", price: 0.9, demand: 30 },
  medium: { name: "Medium", price: 2.6, demand: 70 },
  large: { name: "Large", price: 9.5, demand: 170 },
  frontier: { name: "Frontier", price: 130, demand: 600 },
};
const QUANT_PRICE = { Q2: 0.62, Q4: 1, Q8: 1.3 };
export const QUANT_NAMES = { Q2: "Rough", Q4: "Standard", Q8: "High quality" };
export const TRAINING = {
  finetune: { name: "Fine-tune a model", work: 900000, minVram: 96, tier: "medium", premium: 1.6, sizeGB: 18 },
  train: { name: "Train your own model", work: 9000000, minVram: 384, tier: "frontier", premium: 2.2, sizeGB: 140 },
  frontier: { name: "Train a frontier-scale model", work: 4000000000, minVram: 10000, tier: "frontier", premium: 4.5, sizeGB: 200 },
};

const by = (list, id) => list.find((p) => p.id === id);
export const part = (kind, id) => by(CATALOG[kind], id) || (kind === "fleetRacks" ? genSku(id) : undefined);
export const skuOf = (row) => part("fleetRacks", row.sku);
const KIND_LABEL = { gpus: "GPU", cpus: "CPU", boards: "motherboard", memory: "memory", psus: "power supply", coolers: "CPU cooler", storage: "drive", chassis: "case", racks: "rack" };
export const kindLabel = (k) => KIND_LABEL[k];

function rng(state) {
  // Mulberry32, stored on state so saved games replay the same luck.
  state.seed = (state.seed + 0x6d2b79f5) | 0;
  let t = state.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function newGame(seed = Date.now() % 2147483647) {
  const state = {
    version: 1,
    seed,
    day: 0,
    cash: 500,
    served: 0,
    earned: 0,
    site: "closet",
    cooling: [],
    tech: [],
    racks: [],
    rep: 0.35,
    ambient: 21,
    heatWave: 0,
    spike: null,
    roomC: 21,
    amps: 0,
    wallW: 0,
    lastTrip: null,
    tripped: false,
    trips: 0,
    centsPerKwh: POWER_CENTS,
    version: 2,
    index: { gpus: 1, memory: 1 },
    deflation: { tiny: 1, small: 1, medium: 1, large: 1, frontier: 1 },
    surge: {},
    machines: [],
    rows: [],
    network: [],
    feed: 0,
    feedOrder: null,
    halls: 0,
    curtail: null,
    bench: [],
    contract: null,
    offer: null,
    ownModels: [],
    project: null,
    news: [],
    milestones: [],
    nextId: 1,
    stats: { revenuePerDay: 0, powerPerDay: 0, rentPerDay: 0, mtokPerDay: 0, soldByTier: {} },
    pendingName: null,
    // A new company plays the living world. Saves from before it keep the old rules until they're switched on.
    rules: { gens: true, market: true, supply: true },
  };
  const m = addMachine(state, "Old gaming PC");
  Object.assign(m, {
    chassis: "fractal-meshify-2-xl",
    board: "asus-proart-x870e-creator-wifi",
    cpu: "amd-ryzen-9-9950x",
    cooler: "noctua-nh-d15-g2",
    psus: ["corsair-rm1000x"],
    storage: "samsung-990-pro-2tb",
    memory: ["gskill-flarex5-2x16-6000-cl36"],
    gpus: [{ id: CATALOG.gpus.find((g) => g.vram === 12).id, health: 1 }],
  });
  autoLoad(state, m);
  say(state, "You have an old gaming PC, one outlet and $500. Sell some tokens.", "info");
  recompute(state);
  return state;
}

export function say(state, text, kind = "info") {
  state.news.unshift({ day: Math.floor(state.day), text, kind, id: state.nextId++ });
  state.news.length = Math.min(state.news.length, 40);
}

export function addMachine(state, name) {
  let number = state.machines.length + 1;
  while (state.machines.some((x) => x.name === `Machine ${number}`)) number++;
  const m = { id: state.nextId++, name: name || `Machine ${number}`, chassis: null, board: null, cpu: null, cooler: null, psus: [], storage: null, memory: [], gpus: [], modelId: null, quant: "Q4", on: true, tuned: false, task: "serve", output: { tokS: 0, mtok: 0, wall: 0, fit: null } };
  state.machines.push(m);
  return m;
}

export const site = (state) => by(SITES, state.site);
export const nextSite = (state) => SITES[SITES.indexOf(site(state)) + 1] || null;
export const hasTech = (state, id) => state.tech.includes(id);
export const siteAtLeast = (state, id) => SITES.indexOf(site(state)) >= SITES.findIndex((x) => x.id === id);
export const currentFeed = (state) => site(state).feeds?.[state.feed || 0] || null;
export const nextFeed = (state) => site(state).feeds?.[(state.feed || 0) + 1] || null;
/** Amps the site can draw right now: the breaker, or the power contract less any curtailment. */
export function limitAmps(state) {
  const feed = currentFeed(state);
  return (feed ? feed.amps : site(state).amps) * (state.curtail ? 1 - state.curtail.frac : 1);
}
export const siteLimitW = (state) => site(state).volts * limitAmps(state);
export const usesMW = (state) => !!site(state).feeds;
/** The power figure the way this site talks about it: amps at home, megawatts on a transmission line. */
export function powerText(state, amps) {
  return usesMW(state) ? `${((amps * site(state).volts) / 1e6).toFixed(2)} MW` : `${amps.toFixed(1)} A`;
}
export const allUnits = (state) => [...state.machines, ...state.rows];
export const unitById = (state, id) => state.machines.find((x) => x.id === id) || state.rows.find((x) => x.id === id);
export const totalCards = (state) => state.rows.reduce((n, r) => n + skuOf(r).cards * r.racks, 0) + state.machines.reduce((n, m) => n + m.gpus.length, 0);
export const totalRacks = (state) => state.rows.reduce((n, r) => n + r.racks, 0);
export const fleetUnlocked = (state) => siteAtLeast(state, "warehouse") || state.rows.length > 0;

export function priceOf(state, kind, p) {
  const ix = state.index[kind === "memory" ? "memory" : kind === "gpus" ? "gpus" : ""] || 1;
  return Math.round(p.price * ix);
}
export const resale = (state, kind, p) => Math.round(priceOf(state, kind, p) * (p.used ? 0.55 : 0.65));

export function memoryGB(m) {
  return m.memory.reduce((n, id) => n + part("memory", id).gb, 0);
}
export function memoryModules(m) {
  return m.memory.reduce((n, id) => n + part("memory", id).modules, 0);
}
export function ramBandwidth(m) {
  if (!m.memory.length || !m.cpu) return 0;
  const channels = Math.min(part("cpus", m.cpu).channels, memoryModules(m));
  return channels * part("memory", m.memory[0]).channelBandwidth;
}
export const totalVram = (m) => (m.sku ? skuOf(m).gb * skuOf(m).domain : m.gpus.reduce((n, g) => n + part("gpus", g.id).vram, 0));
export const slotsUsed = (m) => m.gpus.reduce((n, g) => n + Math.ceil(part("gpus", g.id).slots), 0);
export function slotLimit(m) {
  const board = m.board ? part("boards", m.board) : null;
  const chassis = m.chassis ? part("chassis", m.chassis) : null;
  const frame = chassis && (chassis.type === "open-frame" || chassis.risers);
  const physical = frame ? chassis.slots : Math.min(board ? board.span : 99, chassis ? chassis.slots : 99);
  return { physical, sockets: board ? board.x16 : 99 };
}
export function psuWatts(m) {
  return m.psus.reduce((n, id) => n + part("psus", id).watts, 0);
}
export function dcLoad(m, full = true) {
  if (!m.gpus.length && !m.cpu) return 0;
  const gpu = m.gpus.reduce((n, g) => {
    const c = part("gpus", g.id);
    return n + (m.tuned ? c.tunedWatts : c.watts);
  }, 0);
  // Serving a model barely uses the CPU, so a big workstation chip costs little more to run than a desktop one.
  const cpu = m.cpu ? part("cpus", m.cpu).watts * (full ? 0.2 : 0.1) : 0;
  return gpu + cpu + 40 + memoryModules(m) * 4;
}
export function isComplete(m) {
  if (m.sku) return true;
  return !!(m.chassis && m.board && m.cpu && m.cooler && m.psus.length && m.storage && m.memory.length && m.gpus.length);
}
/** Plugged in, finished, switched on and with enough power supply. Everything that runs uses this test. */
export function isRunning(m) {
  if (m.sku) return m.on;
  return m.on && isComplete(m) && dcLoad(m) <= psuWatts(m);
}
export function missingParts(m) {
  const out = [];
  if (!m.chassis) out.push("case");
  if (!m.board) out.push("motherboard");
  if (!m.cpu) out.push("CPU");
  if (!m.cooler) out.push("CPU cooler");
  if (!m.memory.length) out.push("memory");
  if (!m.psus.length) out.push("power supply");
  if (!m.storage) out.push("drive");
  if (!m.gpus.length) out.push("GPU");
  return out;
}

export function floorUsed(state, except) {
  const onFloor = state.machines.filter((m) => m !== except && m.chassis && part("chassis", m.chassis).type !== "rackmount").length;
  return onFloor + state.racks.length + totalRacks(state);
}
export function floorLimit(state) {
  const here = site(state);
  return here.floor + (here.hall ? (state.halls || 0) * here.hall.floor : 0);
}
/** Where everything physically is: racks in order, each holding the rackmount machines that fit, first come first served. */
export function rackPlan(state, except) {
  const racks = state.racks.map((id, index) => ({ index, id, rack: part("racks", id), units: part("racks", id).units, free: part("racks", id).units, machines: [] }));
  // A machine stays in the rack it went into. Anything not placed yet takes the first rack with room, and that's remembered too.
  const mounted = state.machines.filter((m) => m !== except && m.chassis && part("chassis", m.chassis).type === "rackmount");
  const put = (m, home) => {
    const units = part("chassis", m.chassis).units;
    home.machines.push({ m, units });
    home.free -= units;
    // A preview that leaves a machine out must not rearrange anything.
    if (!except) m.rackSlot = home.index;
  };
  const loose = [];
  for (const m of mounted) {
    const home = racks[m.rackSlot];
    if (home && home.free >= part("chassis", m.chassis).units) put(m, home);
    else loose.push(m);
  }
  for (const m of loose) {
    const units = part("chassis", m.chassis).units;
    const home = racks.find((r) => r.free >= units) || racks.at(-1);
    if (home) put(m, home);
  }
  return racks;
}
export function rackHasRoomFor(state, units, except) {
  return rackPlan(state, except).some((r) => r.free >= units);
}
/** An empty rack can go back, freeing its floor spot. */
export function sellEmptyRack(state, index) {
  const r = rackPlan(state)[index];
  if (!r || r.machines.length) return { ok: false, reason: "Take the machines out of it first." };
  state.cash += Math.round(r.rack.price * 0.5);
  state.racks.splice(index, 1);
  for (const m of state.machines) if (m.rackSlot > index) m.rackSlot -= 1;
  recompute(state);
  return { ok: true };
}
/** What each machine's parts are doing right now, in numbers: the chain from GPU memory to dollars. */
export function machineSheet(state, m) {
  const o = m.output || {};
  const fit = o.fit;
  const cards = m.gpus.map((g) => part("gpus", g.id));
  const perCard = cards.length ? Math.max(...cards.map((c) => c.vram)) : 0;
  const lim = slotLimit(m);
  const model = o.model || null;
  const dayCost = dollarsPerDay(state, o.wall || 0);
  const sales = o.revenue || 0;
  const heat = thermalThrottle(state.roomC);
  const spill = fit?.mode === "spill" ? fit.size - (totalVram(m) * 1.0737 - m.gpus.length * 1.5) : 0;
  let word = "working";
  let detail = "Selling everything it makes.";
  if (!isComplete(m)) { word = "unfinished"; detail = `Needs: ${missingParts(m).join(", ")}.`; }
  else if (powerProblem(state, m)) { word = "no power"; detail = powerProblem(state, m); }
  else if (!m.on) { word = "off"; detail = "Switched off."; }
  else if (m.task !== "serve") { word = "training"; detail = "Earning nothing until the job is done."; }
  else if (!model) { word = "idle"; detail = "No model loaded."; }
  else if (spill > 0) { word = "spilling"; detail = `${Math.round(spill)} GB of this model doesn't fit in GPU memory, so it sits in slow RAM and drags everything down. A model that fits usually earns more.`; }
  else if ((o.util ?? 1) < 0.98) { word = "backed up"; detail = `Buyers only take ${Math.round((o.util ?? 0) * 100)}% of what it makes. The rest of its time is idle.`; }
  else if (heat < 1) { word = "slowed"; detail = `The room is hot, so its cards run ${Math.round((1 - heat) * 100)}% slower.`; }
  else if (sales < dayCost) { word = "losing money"; detail = "Its power costs more than its sales."; }
  return {
    word, detail, model, fit, sales, dayCost, net: sales - dayCost, wall: o.wall || 0, tokS: o.tokS || 0, mtok: o.mtok || 0, util: o.util ?? 0, rate: o.rate || 0, heat,
    sold: (o.mtok || 0) * (o.util ?? 0), perCard, vram: totalVram(m), modelGB: fit?.size || 0, spill,
    ramGB: memoryGB(m), slotsUsed: slotsUsed(m), slotsMax: lim.physical, socketsUsed: m.gpus.length, socketsMax: lim.sockets === 99 ? 0 : lim.sockets, psuNeed: dcLoad(m), psuMax: psuWatts(m),
  };
}
/** What a machine cost, split by what can actually earn. */
export function machineSpend(state, m) {
  const price = (k, id) => priceOf(state, k, part(k, id));
  const gpus = m.gpus.reduce((n, g) => n + price("gpus", g.id), 0);
  const ram = m.memory.reduce((n, id) => n + price("memory", id), 0);
  let rest = 0;
  for (const [k, id] of [["chassis", m.chassis], ["boards", m.board], ["cpus", m.cpu], ["coolers", m.cooler], ["storage", m.storage]]) if (id) rest += price(k, id);
  m.psus.forEach((id) => (rest += price("psus", id)));
  return { gpus, ram, rest, total: gpus + ram + rest };
}
/** The breakdown behind a gauge: who is contributing what. Rows of [label, value]. */
export function gaugeDetail(state, id) {
  const here = site(state);
  const w = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)} MW` : n >= 10000 ? `${Math.round(n / 1000).toLocaleString("en-US")} kW` : `${Math.round(n).toLocaleString("en-US")} W`);
  const units = allUnits(state).filter((u) => u.output?.wall > 0).sort((a, b) => b.output.wall - a.output.wall);
  const top = (list, cell) => {
    const rows = list.slice(0, 6).map(cell);
    if (list.length > 6) rows.push([`and ${list.length - 6} more`, ""]);
    return rows;
  };
  const coolCounts = {};
  state.cooling.forEach((c) => (coolCounts[c] = (coolCounts[c] || 0) + 1));
  const coolers = Object.entries(coolCounts).map(([c, n]) => ({ c: by(COOLING, c), n }));
  if (id === "heat") {
    const sheds = here.passiveW + coolers.reduce((t, { c, n }) => t + (c.coolW + (c.liquidW || 0)) * n, 0);
    const heat = state.heatW || 0;
    return [
      ["Making heat", w(heat)], ...top(units, (u) => [`  ${u.name}`, w(u.output.wall)]),
      ["Shedding heat", w(sheds)], ["  The room itself", w(here.passiveW)], ...coolers.map(({ c, n }) => [`  ${n > 1 ? `${n} x ` : ""}${c.name}`, w((c.coolW + (c.liquidW || 0)) * n)]),
      [heat > sheds ? "Over by" : "Room to spare", w(Math.abs(sheds - heat))],
    ];
  }
  if (id === "power") {
    const a = (n) => (here.feeds ? w(n) : `${(n / here.volts).toFixed(1)} A`);
    return [
      ...top(units, (u) => [u.name, a(u.output.wall)]), ...coolers.map(({ c, n }) => [`${n > 1 ? `${n} x ` : ""}${c.name}`, a(c.drawW * n)]),
      ...(here.feeds ? [] : [["The rest of the house", a(150)]]), ...(state.spike ? [[state.spike.name || "An appliance", a(state.spike.watts)]] : []),
    ];
  }
  if (id === "bill") {
    return [...top(units, (u) => [u.name, moneyText(dollarsPerDay(state, u.output.wall))]), ...coolers.map(({ c, n }) => [`${n > 1 ? `${n} x ` : ""}${c.name}`, moneyText(dollarsPerDay(state, c.drawW * n))])];
  }
  if (id === "noise") return top(state.machines.filter(isRunning), (m) => [m.name, `${Math.round(noiseOf(m))} dB`]);
  if (id === "buyers" || id === "speed") return markets(state).filter((x) => x.made > 0 || id === "speed").map((x) => [x.name, `${Math.round(x.made).toLocaleString("en-US")} of ${Math.round(x.demand).toLocaleString("en-US")} MTok`]);
  if (id === "space") return [...top(state.machines.filter((m) => m.chassis && part("chassis", m.chassis).type !== "rackmount"), (m) => [m.name, "1 spot"]), ...state.racks.map((r) => [part("racks", r).name.split(" ")[0] + " rack", "1 spot"])];
  return [];
}
/** Trade one card for another. The old card sells at its used price. */
export function swapGpu(state, machineId, index, toId) {
  const m = state.machines.find((x) => x.id === machineId);
  const to = part("gpus", toId);
  const rest = { ...m, gpus: m.gpus.filter((_, i) => i !== index) };
  const problem = fitProblem(state, rest, "gpus", to);
  if (problem) return { ok: false, reason: problem };
  const from = part("gpus", m.gpus[index].id);
  const cost = priceOf(state, "gpus", to) - resale(state, "gpus", from);
  if (state.cash < cost) return { ok: false, reason: `You need $${Math.ceil(cost - state.cash).toLocaleString("en-US")} more.` };
  sellInstalled(state, machineId, "gpus", index);
  return addGpu(state, machineId, toId);
}
/** Swap every card of one kind, across every machine, for another. Cards that can't fit stay as they are. */
export function upgradeEverywhere(state, fromId, toId) {
  let swapped = 0;
  for (const m of state.machines) {
    for (let i = m.gpus.length - 1; i >= 0; i--) {
      if (m.gpus[i].id !== fromId) continue;
      if (swapGpu(state, m.id, i, toId).ok) swapped++;
    }
  }
  optimizeModels(state);
  return { ok: swapped > 0, swapped, reason: swapped ? null : "None of those cards could be swapped." };
}
/** Try a swap on a copy: real cost and real change in profit, with models re-chosen. */
export function quoteUpgrade(state, action, fromToday = false) {
  const copy = JSON.parse(JSON.stringify(state));
  copy.cash = 1e12;
  copy.spike = null;
  copy.tripped = false;
  if (fromToday) recompute(copy);
  else optimizeModels(copy);
  const before = copy.stats.profitPerDay;
  const cashBefore = copy.cash;
  action(copy);
  optimizeModels(copy);
  return { cost: cashBefore - copy.cash, gain: copy.stats.profitPerDay - before, amps: copy.amps, limit: limitAmps(copy) };
}
/** How many of your units are running one of your own models, and put it everywhere it earns more. */
export function ownModelUse(state, id) {
  const units = allUnits(state).filter(isRunning);
  return { on: units.filter((u) => u.modelId === id).length, of: units.length };
}
export function loadEverywhere(state, modelId) {
  const model = allModels(state).find((x) => x.id === modelId);
  let n = 0;
  for (const u of allUnits(state)) {
    if (!isRunning(u) || u.task !== "serve") continue;
    const q = Object.keys(model.sizes).find((k) => (u.sku ? true : modelFit(state, u, model, k).fits));
    if (q && loadModel(state, u.id, modelId, q).ok) n++;
  }
  recompute(state);
  return { ok: n > 0, count: n, reason: n ? null : "Nothing you own can hold that model." };
}
/** Each own model of a kind sells for a little more, and takes longer, than the last. */
export function trainingSpec(state, kind, forGen = null) {
  const spec = TRAINING[kind];
  const made = state.ownModels.filter((x) => x.kind === kind || (!x.kind && x.tier === spec.tier && x.premium === spec.premium)).length;
  // A frontier model has to keep up with the generation it lands in: bigger, and more work to train.
  const moving = ruleOn(state, "gens") && spec.tier === "frontier";
  // Once the next generation is announced, a new frontier run aims at it: harder, and it stays current a generation longer.
  const g = moving ? forGen ?? (state.project?.kind === kind && state.project.gen != null ? state.project.gen : targetGen(state)) : 0;
  const grow = Math.pow(MODEL_GROWTH, g);
  let work = spec.work * Math.pow(1.5, made);
  // While the frontier moves, a frontier model costs weeks of a real fleet: so many days of this generation's best rack.
  if (moving) work = Math.max(work, (kind === "frontier" ? 40000 : 4000) * flagshipPower(g));
  return { ...spec, made, gen: g, sizeGB: Math.round(spec.sizeGB * grow), minVram: Math.round(spec.minVram * grow), premium: Math.round((spec.premium + made * 0.2) * 10) / 10, work: Math.round(work) };
}
export function dollarsPerDay(state, watts) {
  return (watts * 24 * state.centsPerKwh * (site(state).energy || 1) * (1 - researchBonus(state, "power"))) / 100000;
}
/** The whole company's day: what comes in, and each thing it goes to. */
export function ledger(state) {
  const sales = state.stats.revenuePerDay || 0;
  const machines = state.machines.reduce((n, m) => n + dollarsPerDay(state, m.output?.wall || 0), 0);
  const racks = state.rows.reduce((n, r) => n + dollarsPerDay(state, r.output?.wall || 0), 0);
  const total = state.stats.powerPerDay || 0;
  const cooling = state.tripped ? 0 : Math.min(Math.max(0, total - machines - racks), state.cooling.reduce((n, id) => n + dollarsPerDay(state, by(COOLING, id).drawW), 0));
  const rent = (state.stats.rentPerDay || 0) + (state.stats.capacityPerDay || 0) + (state.stats.supportPerDay || 0);
  return { sales, machines: machines + racks, cooling, other: Math.max(0, total - machines - racks - cooling), rent, staff: state.stats.staffPerDay || 0, profit: state.stats.profitPerDay || 0 };
}
/** Each size of model as a market: what buyers want, what you make, what you sell. */
export function markets(state) {
  return Object.keys(TIERS).map((tier) => {
    const v = state.stats.soldByTier?.[tier];
    const demand = tierDemand(state, tier);
    return { tier, name: TIERS[tier].name, price: tierPrice(state, tier), change: state.deflation[tier] - 1, demand: demand + appDemand(state, tier), apps: appDemand(state, tier), made: v?.supply || 0, sold: v?.sold || 0, world: ruleOn(state, "market") ? state.marketView?.[tier] || null : null };
  });
}
export function rackUnits(state) {
  return state.racks.reduce((n, id) => n + part("racks", id).units, 0);
}
export function rackUsed(state, except) {
  return state.machines.filter((m) => m !== except && m.chassis && part("chassis", m.chassis).type === "rackmount").reduce((n, m) => n + part("chassis", m.chassis).units, 0);
}

/** Plain-English reason a part cannot go in this machine, or null when it fits. */
export function fitProblem(state, m, kind, p) {
  const board = m.board && part("boards", m.board);
  const cpu = m.cpu && part("cpus", m.cpu);
  const cooler = m.cooler && part("coolers", m.cooler);
  const chassis = m.chassis && part("chassis", m.chassis);
  switch (kind) {
    case "gpus": {
      const { physical, sockets } = slotLimit(m);
      if (m.gpus.length + 1 > sockets) return `The board only has ${sockets} long GPU sockets.`;
      if (slotsUsed(m) + Math.ceil(p.slots) > physical) return `No room: it's ${Math.ceil(p.slots)} slots wide and only ${physical - slotsUsed(m)} are free.`;
      return null;
    }
    case "cpus":
      if (board && board.socket !== p.socket) return `Wrong socket. The board is ${board.socket}, this CPU is ${p.socket}.`;
      if (m.memory.length && part("memory", m.memory[0]).type !== p.memType) return `This CPU needs ${p.memType} memory.`;
      if (cooler && !cooler.sockets.includes(p.socket)) return `Your cooler doesn't mount on ${p.socket}. Change the cooler first.`;
      return null;
    case "boards":
      if (cpu && cpu.socket !== p.socket) return `Wrong socket. The CPU is ${cpu.socket}, this board is ${p.socket}.`;
      if (m.memory.length && part("memory", m.memory[0]).type !== p.memType) return `This board needs ${p.memType} memory.`;
      if (m.gpus.length > p.x16) return `It only has ${p.x16} GPU sockets and you have ${m.gpus.length} cards.`;
      if (memoryModules(m) > p.memSlots) return `It only has ${p.memSlots} memory slots and you have ${memoryModules(m)} sticks.`;
      if (slotsUsed(m) > (chassis && (chassis.type === "open-frame" || chassis.risers) ? chassis.slots : p.span)) return "Your cards are too wide to fit on this board.";
      if (cooler && !cooler.sockets.includes(p.socket)) return `Your cooler doesn't mount on ${p.socket}. Change the cooler first.`;
      return null;
    case "memory": {
      const type = board ? board.memType : cpu ? cpu.memType : null;
      if (type && p.type !== type) return `Wrong memory. This machine takes ${type}.`;
      if (m.memory.length && part("memory", m.memory[0]).type !== p.type) return "Don't mix memory types.";
      if (board && memoryModules(m) + p.modules > board.memSlots) return `Only ${board.memSlots - memoryModules(m)} memory slots are free.`;
      return null;
    }
    case "psus":
      if (p.needs240 && site(state).volts < 200) return "This power supply needs 240 volts. Your outlet is 120.";
      if (m.psus.length >= 2 && !m.psus.some((id) => part("psus", id).watts < p.watts)) return "Two power supplies is the most a machine can hold.";
      return null;
    case "coolers":
      if (cpu && !p.sockets.includes(cpu.socket)) return `It doesn't mount on ${cpu.socket}.`;
      if (board && !p.sockets.includes(board.socket)) return `It doesn't mount on ${board.socket}.`;
      return null;
    case "storage":
      return null;
    case "chassis": {
      if (slotsUsed(m) > (p.type === "open-frame" || p.risers ? p.slots : Math.min(board ? board.span : 99, p.slots))) return "Your cards won't fit in that case.";
      if (p.type === "rackmount") {
        if (!rackUnits(state)) return "A rackmount case needs a rack. Buy one first.";
        if (!rackHasRoomFor(state, p.units, m)) return `No rack has ${p.units} units free. Sell a rackmount machine or add another rack.`;
      } else if (floorUsed(state, m) + 1 > floorLimit(state)) {
        return `No floor space left in the ${site(state).name.toLowerCase()}.`;
      }
      return null;
    }
    default:
      return null;
  }
}

export function buy(state, kind, id, machineId) {
  const p = part(kind, id);
  const cost = priceOf(state, kind, p);
  if (state.cash < cost) return { ok: false, reason: `You need $${(cost - Math.floor(state.cash)).toLocaleString()} more.` };
  if (kind === "racks") {
    if (floorUsed(state) + 1 > floorLimit(state)) return { ok: false, reason: "No floor space for a rack here." };
    state.cash -= cost;
    state.racks.push(id);
    recompute(state);
    return { ok: true };
  }
  const m = state.machines.find((x) => x.id === machineId);
  if (!m) return { ok: false, reason: "Pick a machine first." };
  const problem = fitProblem(state, m, kind, p);
  if (problem) return { ok: false, reason: problem };
  state.cash -= cost;
  const swapped = replacedBy(m, kind, p);
  if (swapped) {
    state.cash += resale(state, kind, part(kind, swapped));
    if (kind === "psus") m.psus.splice(m.psus.indexOf(swapped), 1);
    else if (kind !== "gpus" && kind !== "memory") m[SLOT_KEY[kind]] = null;
  }
  if (kind === "chassis") rehome(state, m, id);
  install(m, kind, id);
  autoLoad(state, m);
  recompute(state);
  return { ok: true };
}

const SLOT_KEY = { cpus: "cpu", boards: "board", coolers: "cooler", storage: "storage", chassis: "chassis" };

/** The installed part a purchase would replace, if any. Replaced parts sell automatically. */
export function replacedBy(m, kind, p) {
  if (kind === "gpus" || kind === "memory") return null;
  if (kind === "psus") {
    if (!m.psus.length) return null;
    const smallest = [...m.psus].sort((a, b) => part("psus", a).watts - part("psus", b).watts)[0];
    // A bigger supply replaces the smallest one; an equal or smaller one is added as a second.
    return part("psus", smallest).watts < p.watts ? smallest : null;
  }
  return m[SLOT_KEY[kind]] || null;
}

/** New machines start earning on their own, without a trip to the model list. */
function autoLoad(state, m) {
  if (!isComplete(m) || m.task !== "serve") return;
  const current = m.modelId && allModels(state).find((x) => x.id === m.modelId);
  if (current && modelFit(state, m, current, m.quant).fits) return;
  const best = bestModelFor(state, m);
  if (best) {
    m.modelId = best.model.id;
    m.quant = best.quant;
  } else {
    m.modelId = null;
  }
}

export function estimateEarn(state, m, model, quant = "Q4") {
  const fit = modelFit(state, m, model, quant);
  if (!fit.fits) return { fit, mtok: 0, perDay: 0 };
  const mtok = (fit.tokS * (m.tuned ? 0.94 : 1) * thermalThrottle(state.roomC) * (m.sku ? state.netRatio ?? 1 : 1) * 2 * 86400 * earnMultiplier(state)) / 1e6;
  const rate = modelRate(state, model, quant);
  // In the living world buyers take the best-priced tokens first, so only what sells for at least as much is ahead of this.
  const ranked = rankedSales(state);
  const others = allUnits(state).reduce((n, x) => (x !== m && x.output?.model?.tier === model.tier && (!ranked || (x.output.rate ?? 0) >= rate) ? n + x.output.mtok : n), 0);
  // Same order as real sales: a deal first, then your products, then the open market.
  const deal = state.contract?.tier === model.tier ? state.contract : null;
  const dealNeed = deal ? dealPerDay(deal, state.day) : 0;
  const appWant = appDemand(state, model.tier);
  const appMult = APPS.find((a) => a.tier === model.tier)?.mult || 1;
  const toDeal = Math.min(mtok, Math.max(0, dealNeed - others));
  const afterDeal = Math.max(0, others - dealNeed);
  const toApp = Math.min(mtok - toDeal, Math.max(0, appWant - afterDeal));
  const toMarket = Math.min(mtok - toDeal - toApp, Math.max(0, tierDemand(state, model.tier) - Math.max(0, afterDeal - appWant)));
  const sold = toDeal + toApp + toMarket;
  return { fit, mtok, sold, rate, limitedBy: mtok > sold + 1e-9 ? "buyers" : "speed", perDay: (toDeal * (deal ? deal.rate : 1) + toApp * appMult + toMarket) * rate };
}

export function bestModelFor(state, m) {
  let best = null;
  for (const model of allModels(state)) {
    for (const quant of Object.keys(model.sizes)) {
      const e = estimateEarn(state, m, model, quant);
      if (e.fit.fits && (!best || e.perDay > best.perDay)) best = { model, quant, perDay: e.perDay, fit: e.fit };
    }
  }
  return best;
}

/** Why a complete machine will not start, in plain English, or null. */
export function powerProblem(state, m) {
  if (m.sku || !isComplete(m)) return null;
  const need = Math.round(dcLoad(m));
  const have = psuWatts(m);
  if (need > have) return `Won't power on. It needs ${need.toLocaleString()} W and the power supply gives ${have.toLocaleString()} W.`;
  return null;
}

/** What buying this part would do, computed on a copy so the UI can show it before the click. */
export function previewBuy(state, m, kind, p) {
  const cost = priceOf(state, kind, p);
  const problem = m ? fitProblem(state, m, kind, p) : null;
  const out = { cost, problem, canAfford: state.cash >= cost, unlocks: [], lines: [], ampsAfter: state.amps, refund: 0 };
  if (!m || problem) return out;
  const copy = JSON.parse(JSON.stringify({ ...m, output: null }));
  const swapped = replacedBy(copy, kind, p);
  if (swapped) {
    out.refund = resale(state, kind, part(kind, swapped));
    out.replaces = part(kind, swapped).name;
    if (kind === "psus") copy.psus.splice(copy.psus.indexOf(swapped), 1);
    else copy[SLOT_KEY[kind]] = null;
  }
  install(copy, kind, p.id);
  const fits = (machine) => new Set(allModels(state).filter((x) => { const f = modelFit(state, machine, x, "Q4"); return f.fits && f.mode !== "spill"; }).map((x) => x.id));
  const before = fits(m);
  const after = fits(copy);
  out.unlocks = allModels(state).filter((x) => after.has(x.id) && !before.has(x.id));
  out.earnBefore = isComplete(m) ? bestModelFor(state, m)?.perDay || 0 : 0;
  const bestAfter = isComplete(copy) ? bestModelFor(state, copy) : null;
  out.earnAfter = bestAfter?.perDay || 0;
  out.bestAfter = bestAfter;
  const loaded = m.modelId && allModels(state).find((x) => x.id === m.modelId);
  if (kind === "gpus" && loaded) {
    const a = modelFit(state, m, loaded, m.quant);
    const b = modelFit(state, copy, loaded, m.quant);
    out.sameModel = a.fits && b.fits ? { from: a, to: b, name: loaded.name } : null;
  }
  const dW = (dcLoad(copy) - (isComplete(m) ? dcLoad(m) : 0)) / 0.92;
  out.deltaW = isComplete(copy) ? dW : 0;
  out.ampsAfter = state.amps + (isComplete(copy) ? dW : 0) / site(state).volts;
  out.limit = limitAmps(state);
  if (isComplete(copy) && dcLoad(copy) > psuWatts(copy)) out.needsPsu = Math.round(dcLoad(copy));
  return out;
}

export function clonePrice(state, m) {
  let total = 0;
  const add = (k, id) => { if (id) total += priceOf(state, k, part(k, id)); };
  add("chassis", m.chassis); add("boards", m.board); add("cpus", m.cpu); add("coolers", m.cooler); add("storage", m.storage);
  m.psus.forEach((id) => add("psus", id));
  m.memory.forEach((id) => add("memory", id));
  m.gpus.forEach((g) => add("gpus", g.id));
  return total;
}
/** Where a copy of this machine would go and what it costs. A tower can't bolt into a rack, so a copy headed for one gets a rackmount case and the same parts. */
export function copyPlan(state, m, into = null) {
  const cost = clonePrice(state, m);
  const c = part("chassis", m.chassis);
  const floorFree = floorUsed(state) + 1 <= floorLimit(state);
  const racks = rackPlan(state);
  const chosen = typeof into === "number" ? racks[into] : null;
  const homeFor = (units) => (typeof into === "number" ? (chosen && chosen.free >= units ? chosen : null) : racks.find((r) => r.free >= units) || null);
  if (c.type === "rackmount") {
    const home = homeFor(c.units);
    if (home) return { ok: true, where: "rack", chassis: m.chassis, cost, rack: home.index };
    if (chosen) return { ok: false, reason: `This rack has ${chosen.free} units free and ${m.name} needs ${c.units}.` };
    return { ok: false, reason: floorFree ? "Your racks are full. Add another rack on the floor screen." : "Your racks are full, and there's no floor spot for another. Sell a machine or move somewhere bigger." };
  }
  if (into === null && floorFree) return { ok: true, where: "floor", chassis: m.chassis, cost };
  const draft = { ...m, chassis: null };
  const cases = CATALOG.chassis.filter((x) => x.type === "rackmount" && homeFor(x.units) && slotsUsed(draft) <= (x.risers ? x.slots : Math.min(draft.board ? part("boards", draft.board).span : 99, x.slots))).sort((a, b) => priceOf(state, "chassis", a) - priceOf(state, "chassis", b));
  if (cases[0]) return { ok: true, where: "rack", swapped: true, chassis: cases[0].id, rack: homeFor(cases[0].units).index, cost: cost - priceOf(state, "chassis", c) + priceOf(state, "chassis", cases[0]) };
  if (chosen) return { ok: false, reason: chosen.free >= 4 ? "Its cards don't fit any rackmount case." : `This rack only has ${chosen.free} units free.` };
  if (racks.some((r) => r.free >= 4)) return { ok: false, reason: "Its cards don't fit any rackmount case." };
  return { ok: false, reason: state.racks.length ? "No floor spot left and your racks are full. Sell a machine or move somewhere bigger." : "No floor spot left. Sell a machine, buy a rack, or move somewhere bigger." };
}
export function cloneMachine(state, machineId, { into = null, target = null } = {}) {
  const m = state.machines.find((x) => x.id === machineId);
  const plan = copyPlan(state, m, into);
  if (!plan.ok) return plan;
  if (state.cash < plan.cost) return { ok: false, reason: `You need $${Math.ceil(plan.cost - state.cash).toLocaleString()} more.` };
  state.cash -= plan.cost;
  // An untouched draft becomes the copy, so nobody is left with an empty machine they started. One with any part in it is left alone.
  const blank = (x) => x !== m && !x.chassis && !x.board && !x.cpu && !x.cooler && !x.storage && !x.gpus.length && !x.memory.length && !x.psus.length;
  const copy = state.machines.find((x) => x.id === target && blank(x)) || state.machines.find(blank) || addMachine(state);
  Object.assign(copy, { forRack: false, forDeal: false, dealBack: null, chassis: plan.chassis, rackSlot: plan.rack, board: m.board, cpu: m.cpu, cooler: m.cooler, storage: m.storage, psus: [...m.psus], memory: [...m.memory], gpus: m.gpus.map((g) => ({ id: g.id, health: 1 })), modelId: m.modelId, quant: m.quant, tuned: m.tuned });
  recompute(state);
  return { ok: true, id: copy.id, where: plan.where, swapped: !!plan.swapped, name: copy.name };
}
/** What another rack just like this one costs, machines and all. If the floor is full, the lowest earner on the floor makes room. */
export function rackCopyPlan(state, index) {
  const r = rackPlan(state)[index];
  if (!r) return { ok: false, reason: "That rack is gone." };
  const machines = r.machines.map((x) => x.m);
  const cost = priceOf(state, "racks", r.rack) + machines.reduce((n, m) => n + clonePrice(state, m), 0);
  const addsW = machines.reduce((n, m) => n + (m.output?.wall || 0), 0);
  const earns = machines.reduce((n, m) => n + (m.output?.revenue || 0), 0);
  if (floorUsed(state) + 1 <= floorLimit(state)) return { ok: true, cost, machines, addsW, earns, sell: null };
  const old = state.machines.filter((m) => m.chassis && !m.forDeal && part("chassis", m.chassis).type !== "rackmount").sort((a, b) => (a.output?.revenue || 0) - (b.output?.revenue || 0))[0];
  if (!old) return { ok: false, reason: "No floor spot for another rack. Move somewhere bigger." };
  return { ok: true, cost: cost - machineResale(state, old), machines, addsW: addsW - (old.output?.wall || 0), earns: earns - (old.output?.revenue || 0), sell: old };
}
export function cloneRack(state, index) {
  const plan = rackCopyPlan(state, index);
  if (!plan.ok) return plan;
  if (state.cash < plan.cost) return { ok: false, reason: `You need $${Math.ceil(plan.cost - state.cash).toLocaleString()} more.` };
  const run = (st) => {
    const sell = plan.sell && st.machines.find((m) => m.id === plan.sell.id);
    if (sell) sellMachine(st, sell.id);
    const id = st.racks[index];
    st.cash -= priceOf(st, "racks", part("racks", id));
    st.racks.push(id);
    const home = st.racks.length - 1;
    for (const source of plan.machines) {
      const m = st.machines.find((x) => x.id === source.id);
      const made = cloneMachine(st, m.id, { into: home });
      if (!made.ok) return made;
      // A switched-off machine copies switched off, so the power it was quoted at is what it draws.
      st.machines.find((x) => x.id === made.id).on = m.on;
    }
    recompute(st);
    return { ok: true };
  };
  const trial = rehearsalCopy(state);
  const tried = run(trial);
  if (!tried.ok) return tried;
  run(state);
  return { ok: true, made: plan.machines.length, sold: plan.sell?.name || null };
}
export function sellInstalled(state, machineId, kind, index = 0) {
  const m = state.machines.find((x) => x.id === machineId);
  let id;
  if (kind === "gpus") id = m.gpus.splice(index, 1)[0].id;
  else if (kind === "memory") id = m.memory.splice(index, 1)[0];
  else if (kind === "psus") id = m.psus.splice(index, 1)[0];
  else { id = m[SLOT_KEY[kind]]; m[SLOT_KEY[kind]] = null; }
  if (kind === "chassis") m.rackSlot = undefined;
  state.cash += resale(state, kind, part(kind, id));
  autoLoad(state, m);
  recompute(state);
}
export function machineResale(state, m) {
  let total = 0;
  for (const [k, id] of [["chassis", m.chassis], ["boards", m.board], ["cpus", m.cpu], ["coolers", m.cooler], ["storage", m.storage]]) if (id) total += resale(state, k, part(k, id));
  m.psus.forEach((id) => (total += resale(state, "psus", part("psus", id))));
  m.memory.forEach((id) => (total += resale(state, "memory", part("memory", id))));
  m.gpus.forEach((g) => (total += resale(state, "gpus", part("gpus", g.id))));
  return total;
}
export function sellMachine(state, machineId) {
  const m = state.machines.find((x) => x.id === machineId);
  state.cash += machineResale(state, m);
  state.machines = state.machines.filter((x) => x !== m);
  if (!state.machines.length) addMachine(state);
  recompute(state);
}

/** Something is actually wrong and needs you. Returns null when nothing is: reading the numbers is the player's job. */
export function advice(state) {
  if (state.tripped) return null;
  const unfinished = state.machines.find((x) => !isComplete(x) && (x.gpus.length || x.board || x.cpu || x.chassis || x.memory.length));
  if (unfinished) return `${unfinished.name} isn't running yet. It still needs: ${missingParts(unfinished).join(", ")}.`;
  const dark = state.machines.find((x) => powerProblem(state, x));
  if (dark) return `${dark.name} won't start. ${powerProblem(state, dark)}`;
  const bare = state.machines.find((x) => x.board && x.chassis && !x.gpus.length);
  if (bare) return `${bare.name} has no GPU, so it earns nothing.`;
  const idle = state.machines.find((x) => isRunning(x) && x.task === "serve" && !x.modelId);
  if (idle) return `${idle.name} has no model loaded.`;
  const blank = state.rows.find((r) => r.on && r.task === "serve" && !r.modelId);
  if (blank) return `${blank.name} has no model loaded.`;
  if (state.curtail) return `Grid emergency: the utility has cut your contract 20% for ${Math.ceil(state.curtail.until - state.day)} more days.`;
  return null;
}

/** The cheapest change to a machine that lets this model load without spilling, tried on a copy to get a real price. */
export function fitPath(state, m, model) {
  if (m.sku) return null;
  const size = Math.min(...Object.values(model.sizes));
  const smallModel = { ...model, sizes: { Q4: size } };
  const works = (gpus) => {
    const f = modelFit(state, { ...m, gpus }, smallModel, "Q4");
    return f.fits && f.mode !== "spill";
  };
  const options = [];
  const smallest = m.gpus.map((g, i) => ({ i, card: part("gpus", g.id) })).sort((a, b) => a.card.vram - b.card.vram)[0];
  for (const g of CATALOG.gpus) {
    if (!fitProblem(state, m, "gpus", g) && works([...m.gpus, { id: g.id }])) {
      options.push({ label: `add a ${shortName(g)}`, run: (st) => addGpu(st, m.id, g.id) });
    }
    if (smallest && g.id !== smallest.card.id) {
      const rest = m.gpus.filter((_, i) => i !== smallest.i);
      const without = { ...m, gpus: rest };
      if (!fitProblem(state, without, "gpus", g) && works([...rest, { id: g.id }])) {
        options.push({ label: `swap your ${shortName(smallest.card)} for a ${shortName(g)}`, run: (st) => { sellInstalled(st, m.id, "gpus", smallest.i); addGpu(st, m.id, g.id); } });
      }
    }
  }
  const best = part("gpus", "rtx-pro-6000-blackwell-max-q-96gb");
  const cards = Math.ceil((size + 1.5 * 4) / (best.vram * 1.0737));
  if (cards <= 4 && floorUsed(state) + 1 <= floorLimit(state)) {
    options.push({ label: `build a new machine with ${cards} ${shortName(best)}`, run: (st) => { const r = buildWorkstation(st, best.id); for (let i = 1; i < cards; i++) buy(st, "gpus", best.id, r.id); return r.id; } });
  }
  let cheapest = null;
  for (const o of options) {
    const copy = JSON.parse(JSON.stringify(state));
    copy.cash = 1e12;
    o.run(copy);
    const cost = 1e12 - copy.cash;
    if (!cheapest || cost < cheapest.cost) cheapest = { ...o, cost };
  }
  return cheapest;
}

/** Load the best-paying model on every serving unit, given what the others already sell. */
/** Load the best models. Whatever a quick pass suggests, the real books decide, so this never leaves you worse off. */
export function optimizeModels(state) {
  recompute(state);
  const take = () => allUnits(state).map((u) => [u, u.modelId, u.quant]);
  const put = (snap) => snap.forEach(([u, modelId, quant]) => { u.modelId = modelId; u.quant = quant; });
  const start = take();
  const blank = allUnits(state).some((u) => isRunning(u) && u.task === "serve" && !u.output?.model);
  const onTrack = () => !state.contract || dealView(state, state.contract).enough;
  const wasOnTrack = onTrack();
  let best = start;
  let bestProfit = blank ? -Infinity : state.stats.profitPerDay;
  for (const withDeal of state.contract ? [false, true] : [false]) {
    put(start);
    recompute(state);
    pickModels(state, withDeal);
    // Chasing a little more profit isn't worth quietly missing a deal.
    if (wasOnTrack && !onTrack() && !blank) continue;
    if (state.stats.profitPerDay > bestProfit + 0.001) {
      bestProfit = state.stats.profitPerDay;
      best = take();
    }
  }
  put(best);
  recompute(state);
}
let sharedOptions = null;
let holdRecompute = false;
function pickModels(state, withDeal) {
  // Units with the same parts have the same options, so work those out once.
  const memo = new Map();
  const models = allModels(state);
  // Everything a price depends on: a trial that moves the market can't borrow another trial's prices.
  const pricing = `${state.tech.join()}|${state.techOff || ""}|${state.site}|${state.ownModels.length}|${JSON.stringify(state.research?.levels || {})}|${JSON.stringify(state.rules || {})}|${state.world?.gen || 0}|${Object.values(state.marketF || {}).map((f) => f.toFixed(3))}`;
  const options = (u) => {
    const sig = u.sku ? `sku:${u.sku}` : `${u.gpus.map((g) => g.id)}|${u.memory}|${u.cpu}`;
    const shared = sharedOptions && `${sig}|${pricing}`;
    let list = memo.get(sig) || (shared && sharedOptions.get(shared));
    if (!list) {
      list = [];
      const probe = u.sku ? { ...u, racks: 1 } : u;
      for (const model of models) {
        for (const quant of Object.keys(model.sizes)) {
          const fit = modelFit(state, probe, model, quant);
          if (fit.fits) list.push({ model, quant, fit, rate: modelRate(state, model, quant), demand: tierDemand(state, model.tier) });
        }
      }
      memo.set(sig, list);
      if (shared) sharedOptions.set(shared, list);
    }
    return list;
  };
  // What each unit sells now. In the living world, only output priced at least as high is ahead of a choice.
  const ranked = rankedSales(state);
  const held = new Map();
  for (const u of allUnits(state)) if (u.output.model) held.set(u, { tier: u.output.model.tier, rate: u.output.rate ?? modelRate(state, u.output.model, u.quant), mtok: u.output.mtok });
  const fillFor = (tier, rate) => {
    let n = 0;
    for (const h of held.values()) if (h.tier === tier && (!ranked || h.rate >= rate)) n += h.mtok;
    return n;
  };
  const heat = thermalThrottle(state.roomC);
  const mult = (2 * 86400 * earnMultiplier(state)) / 1e6;
  for (const u of allUnits(state)) {
    if (!isRunning(u) || u.task !== "serve" || u.forDeal) continue;
    const was = held.get(u);
    held.delete(u);
    const speed = heat * (u.tuned ? 0.94 : 1) * mult * (u.sku ? (state.netRatio ?? 1) * u.racks : 1);
    let best = null;
    let bestMtok = 0;
    let bestPay = -1;
    for (const o of options(u)) {
      const mtok = o.fit.tokS * speed;
      const fill = fillFor(o.model.tier, o.rate);
      const deal = withDeal && state.contract && state.contract.tier === o.model.tier ? state.contract : null;
      const dealNeed = deal ? dealPerDay(deal, state.day) : 0;
      const toDeal = Math.min(mtok, Math.max(0, dealNeed - fill));
      const appWant = appDemand(state, o.model.tier);
      const afterDeal = Math.max(0, fill - dealNeed);
      const toApp = Math.min(mtok - toDeal, Math.max(0, appWant - afterDeal));
      const toMarket = Math.min(mtok - toDeal - toApp, Math.max(0, o.demand - Math.max(0, afterDeal - appWant)));
      const appMult = APPS.find((a) => a.tier === o.model.tier)?.mult || 1;
      const pay = (toDeal * (deal ? deal.rate : 1) + toApp * appMult + toMarket) * o.rate;
      if (pay > bestPay) {
        best = o;
        bestPay = pay;
        bestMtok = mtok;
      }
    }
    if (best) {
      u.modelId = best.model.id;
      u.quant = best.quant;
      u.output.model = best.model;
      u.output.mtok = bestMtok;
      held.set(u, { tier: best.model.tier, rate: best.rate, mtok: bestMtok });
    } else if (was) {
      held.set(u, was);
    }
  }
  recompute(state);
}

/** The full picture: every constraint, its limit, its effect, and which one is costing the most. */
export function situation(state) {
  const here = site(state);
  const s = state.stats;
  const rows = [];
  const fleetOn = state.rows.length > 0;
  const units = allUnits(state);
  const serving = units.filter((m) => m.output?.model);
  let unsold = 0;
  let unsoldTier = null;
  let unmet = 0;
  let supplyTotal = 0;
  let soldTotal = 0;
  for (const [tier, v] of Object.entries(s.soldByTier || {})) {
    const list = serving.filter((m) => m.output.model.tier === tier);
    const rate = v.supply ? list.reduce((n, m) => n + m.output.rate * m.output.mtok, 0) / v.supply : 0;
    const lost = (v.supply - v.sold) * rate;
    if (lost > unsold) {
      unsold = lost;
      unsoldTier = tier;
    }
    unmet += Math.max(0, v.demand - v.sold) * rate;
    supplyTotal += v.supply;
    soldTotal += v.sold;
  }
  // Price each limit by lifting it on a copy and seeing what sales would be.
  const salesWithout = (prep, ignore) => {
    const copy = rehearsalCopy(state);
    prep(copy);
    recompute(copy, ignore);
    return Math.max(0, copy.stats.revenuePerDay - s.revenuePerDay);
  };
  const throttle = thermalThrottle(state.roomC);
  const heatLost = throttle < 1 ? salesWithout((c) => { c.roomC = c.ambient; c.tripped = state.tripped; c.spike = state.spike; c.curtail = state.curtail; }) : 0;
  const netLost = (state.netRatio ?? 1) < 1 ? salesWithout((c) => { c.tripped = state.tripped; c.spike = state.spike; c.curtail = state.curtail; }, { network: true }) : 0;
  const powerLost = (state.capFactor ?? 1) < 1 ? salesWithout((c) => { c.tripped = state.tripped; c.spike = state.spike; c.curtail = state.curtail; }, { power: true }) : 0;

  const down = state.machines.filter((m) => isComplete(m) && !isRunning(m) && m.on);
  const cardless = state.machines.filter((m) => m.board && m.chassis && !m.gpus.length);
  const safe = safeAmps(state);
  const limit = limitAmps(state);
  const biggestCard = Math.max(...state.machines.flatMap((m) => m.gpus.map((g) => part("gpus", g.id).watts)), 170);
  const spareW = (limit - state.amps) * here.volts;
  const cardsLeft = Math.max(0, Math.floor(spareW / (biggestCard / 0.92)));
  const pue = state.plant?.pue || 1;
  const biggestRack = fleetOn ? [...state.rows].sort((a, b) => skuOf(b).kW - skuOf(a).kW)[0] : null;
  const racksLeft = biggestRack && (state.capFactor ?? 1) >= 1 ? Math.max(0, Math.floor(spareW / (skuOf(biggestRack).kW * 1000 * pue))) : 0;
  const order = state.feedOrder;

  const feed = currentFeed(state);
  const powerName = feed ? "Contract" : "Power";
  rows.push({
    note: fleetOn ? `${powerLost > 0.5 ? `racks held to ${Math.round((state.capFactor ?? 1) * 100)}%` : `room for ${racksLeft} ${skuOf(biggestRack).short} ${racksLeft === 1 ? "rack" : "racks"}`}${order ? `, more in ${Math.ceil(order.ready - state.day)} days` : ""}` : here.shared ? `safe under ${safe.toFixed(1)} A` : `about ${cardsLeft} more big ${cardsLeft === 1 ? "card fits" : "cards fit"}`, id: "power", name: powerName, value: powerText(state, state.amps), limit: powerText(state, limit), ratio: state.amps / limit,
    status: state.tripped || powerLost > 0.5 || (fleetOn ? racksLeft === 0 : cardsLeft === 0) ? "limit" : state.amps > safe ? "near" : "ok",
    effect: fleetOn
      ? `${feed ? `${feed.amps} A at ${here.kv} kV.` : `Over ${limit} A trips, but racks slow down first.`}${state.curtail ? " Cut 20% for now." : ""} ${powerLost > 0.5 ? `Racks held to ${Math.round((state.capFactor ?? 1) * 100)}%, costing ${moneyText(powerLost)} a day.` : `Room for ${racksLeft} more ${skuOf(biggestRack).short} ${racksLeft === 1 ? "rack" : "racks"}.`}${order ? ` More power in ${Math.ceil(order.ready - state.day)} days.` : ""}`
      : here.shared
        ? `Over ${here.amps} A trips. Shared outlet: an appliance can add ${(APPLIANCE_MAX_W / here.volts).toFixed(1)} A, so you're safe under ${safe.toFixed(1)} A.`
        : `Over ${limit} A trips. Nothing else is on this circuit. Room for about ${cardsLeft} more of your biggest card.`,
  });
  if (fleetOn) {
    const p = state.plant;
    const cap = p.airCap + p.wetCap;
    rows.push({
      note: state.roomC > 32 ? `cards ${Math.round((1 - throttle) * 100)}% slower` : p.wetCap ? `water ${(p.wet / 1e6).toFixed(1)} of ${(p.wetCap / 1e6).toFixed(1)} MW` : "cards slow above 32 C", id: "heat", name: "Cooling", value: wattText(p.air + Math.min(p.wet, p.wetCap)), limit: wattText(cap), ratio: Math.min(1.2, (p.air + Math.min(p.wet, p.wetCap)) / Math.max(1, cap)),
      status: state.roomC > 32 ? "limit" : state.targetC > 32 || p.air > p.airCap * 0.97 ? "near" : "ok",
      effect: `${state.roomC > 32 ? `Hall is ${Math.round(state.roomC)} C, cards ${Math.round((1 - throttle) * 100)}% slower${heatLost > 0.5 ? `, costing ${moneyText(heatLost)} a day` : ""}. ` : ""}Air ${wattText(p.air)} of ${wattText(p.airCap)}, water ${wattText(p.wet)} of ${wattText(p.wetCap)}. Cooling adds ${Math.round((pue - 1) * 100)}% to your power.`,
    });
    const needTb = fabricNeed(state);
    const capTb = fabricCapacity(state);
    rows.push({
      note: netLost > 0.5 ? `racks waiting, at ${Math.round((state.netRatio ?? 1) * 100)}%` : "racks wait when it's full", id: "network", name: "Network", value: `${Math.round(needTb).toLocaleString("en-US")}`, limit: `${Math.round(capTb).toLocaleString("en-US")} Tb/s`, ratio: Math.min(1, needTb / Math.max(1, capTb)),
      status: netLost > 0.5 ? "limit" : needTb > capTb * 0.9 ? "near" : "ok",
      effect: netLost > 0.5 ? `Racks wait on the network and run at ${Math.round((state.netRatio ?? 1) * 100)}%. That costs ${moneyText(netLost)} a day. Buy a switch in the floor screen.` : "What racks need to reach each other and buyers. Short, and they all wait.",
    });
  } else {
    rows.push({
      note: state.roomC > 32 ? `cards ${Math.round((1 - throttle) * 100)}% slower` : "cards slow above 32 C", id: "heat", name: "Room heat", value: `${Math.round(state.roomC)} C`, limit: "32 C", ratio: Math.min(1.2, state.roomC / 32),
      status: state.roomC > 32 ? "limit" : state.targetC > 32 ? "near" : "ok",
      effect: state.roomC > 32 ? `Cards are ${Math.round((1 - throttle) * 100)}% slower. ${heatLost > 0.5 ? `That costs ${moneyText(heatLost)} a day. Buy cooling in the floor screen.` : "Buyers are already full, so it isn't costing you sales yet."}` : `Cards slow 5% per degree over 32 C. Heading for ${Math.round(state.targetC)} C, so no effect ${state.targetC > 32 ? "yet" : "now"}.`,
    });
    const dB = noiseLevel(state);
    const quiet = here.noise > 150;
    rows.push({
      note: quiet ? "no limit here" : dB > here.noise ? "neighbors are fining you" : `fines start at ${here.noise} dB`, id: "noise", name: "Noise", value: `${Math.round(dB)} dB`, limit: quiet ? "no limit" : `${here.noise} dB`, ratio: quiet ? 0.2 : dB / here.noise,
      status: dB > here.noise ? "limit" : dB > here.noise - 4 ? "near" : "ok",
      effect: quiet ? "Nobody's around to complain here. It does nothing." : dB > here.noise ? `Neighbors are fining you about ${moneyText(1.2 * (dB - here.noise))} a day.` : "Does nothing until the limit. Past it, the neighbors fine you.",
    });
  }
  const moreBuyers = TECH.find((t) => t.demand && !hasTech(state, t.id) && techAvailable(state, t));
  const endedDeal = TECH.find((t) => t.demand && hasTech(state, t.id) && !techActive(state, t.id) && techAvailable(state, t));
  const buyersFix = endedDeal ? `Restart ${endedDeal.name.toLowerCase()} in the lab, or serve another size.` : moreBuyers ? `Buy ${moreBuyers.name.toLowerCase()}, or serve another size.` : "Serve a different size of model.";
  rows.push({
    note: unsold > 0.5 ? `${moneyText(unsold)} a day goes unsold` : "everything you make sells", id: "buyers", name: "Buyers", value: `${Math.round(supplyTotal ? (soldTotal / supplyTotal) * 100 : 0)}% sold`, limit: null, ratio: supplyTotal ? soldTotal / supplyTotal : 0,
    status: unsold > s.revenuePerDay * 0.15 ? "limit" : unsold > 0.5 ? "near" : "ok",
    effect: unsold > 0.5 ? (fleetOn ? `${moneyText(unsold)} a day of tokens goes unsold. ${buyersFix}` : `${TIERS[unsoldTier].name}-model buyers are full. ${moneyText(unsold)} a day of tokens goes unsold. Move a machine to a different size of model.`) : "Everything you make sells. Each model size has its own buyers.",
  });
  rows.push({
    note: unmet > 0.5 ? `buyers want ${moneyText(unmet)} more a day` : "you make all buyers want", id: "speed", name: "GPU speed", value: (s.mtokPerDay || 0) >= 1e5 ? `${(s.mtokPerDay / 1000).toLocaleString("en-US", { maximumFractionDigits: 0 })}K MTok/day` : `${Math.round(s.mtokPerDay || 0).toLocaleString("en-US")} MTok a day`, limit: null, ratio: unmet > 0 ? Math.min(1, s.revenuePerDay / (s.revenuePerDay + unmet)) : 1,
    status: unmet > s.revenuePerDay * 0.5 ? "limit" : "ok",
    effect: unmet > 0.5 ? `Buyers would pay ${moneyText(unmet)} more a day if you could make the tokens.` : "You make as many tokens as your buyers want.",
  });
  // Units with the same hardware fit the same models, so test each kind once.
  const seenKinds = new Set();
  const kinds = units.filter((m) => {
    if (!isComplete(m)) return false;
    const sig = m.sku ? m.sku : `${m.gpus.map((g) => g.id)}|${m.memory}|${m.cpu}`;
    if (seenKinds.has(sig)) return false;
    seenKinds.add(sig);
    return true;
  });
  const fitting = allModels(state).filter((x) => kinds.some((m) => { const f = modelFit(state, m, x); return f.fits && f.mode !== "spill"; }));
  const biggestFit = [...fitting].sort((a, b) => b.sizes.Q4 - a.sizes.Q4)[0];
  const nextUp = [...allModels(state)].sort((a, b) => a.sizes.Q4 - b.sizes.Q4).find((x) => !fitting.includes(x));
  const vram = Math.max(...units.map(totalVram), 0);
  // Once every model fits, memory has stopped being a limit, and the page needs the room.
  if (!fleetOn || nextUp) rows.push({
    note: nextUp ? `next: ${nextUp.name}` : "every model fits", id: "memory", name: "GPU memory", value: `${vram.toLocaleString("en-US")} GB`, limit: null, ratio: nextUp ? Math.min(1, vram / (nextUp.sizes.Q4 + 1.5)) : 1,
    status: "ok",
    effect: `${biggestFit ? `Biggest you can load: ${biggestFit.name}.` : "Sets which models you can load."} ${nextUp ? `Next: ${nextUp.name} at ${Math.ceil(nextUp.sizes.Q4 + 1.5)} GB.` : "Every model fits."}`,
  });
  const used = floorUsed(state);
  const floorMax = floorLimit(state);
  rows.push({
    note: used >= floorMax ? "full" : `${floorMax - used} ${floorMax - used === 1 ? "spot" : "spots"} free`, id: "space", name: fleetOn ? "Rack spots" : "Floor space", value: `${used}`, limit: `${floorMax}`, ratio: used / floorMax,
    status: used >= floorMax ? "limit" : "ok",
    effect: used >= floorMax
      ? (here.hall ? `The ${here.name.toLowerCase()} is full. Fit out another hall for ${moneyText(here.hall.cost)}, or move up.` : `The ${here.name.toLowerCase()} is full, so you can't add a machine. Move up, or buy a rack and rackmount cases.`)
      : `Room for ${floorMax - used} more ${floorMax - used === 1 ? (fleetOn ? "rack" : "machine") : fleetOn ? "racks" : "machines"}${fleetOn ? "" : " or racks"}.`,
  });
  const repMult = 0.45 + state.rep * 1.6;
  rows.push({
    note: `buyer demand ${repMult.toFixed(2)}x`, id: "rep", name: "Reputation", value: `${Math.round(state.rep * 100)}`, limit: "100", ratio: state.rep,
    status: "ok",
    effect: demandMultiplier(state) > 1 ? `Demand is ${repMult.toFixed(2)}x normal, ${demandMultiplier(state)}x more from deals. Drops on a trip or a missed deal.` : `Demand is ${repMult.toFixed(2)}x normal. Rises while you stay up, drops on a trip or a missed deal.`,
  });
  const bill = s.powerPerDay + (s.capacityPerDay || 0);
  const billShare = s.revenuePerDay ? bill / s.revenuePerDay : 0;
  rows.push({
    note: `${Math.round(billShare * 100)}% of sales`, id: "bill", name: "Electric bill", value: moneyText(bill), limit: fleetOn ? moneyText(s.revenuePerDay) : `${moneyText(s.revenuePerDay)} sales`, ratio: Math.min(1, billShare),
    status: billShare > 0.7 ? "limit" : billShare > 0.4 ? "near" : "ok",
    effect: s.capacityPerDay ? `${moneyText(s.powerPerDay)} energy at ${(state.centsPerKwh * (here.energy || 1)).toFixed(1)} cents, ${moneyText(s.capacityPerDay)} capacity, used or not. Megawatts are scarce, not dollars.` : `Power eats ${Math.round(billShare * 100)}% of sales. Idle cards still draw about a third.`,
  });

  let top;
  const fullTiers = Object.values(s.soldByTier || {}).filter((v) => v.supply - v.sold > v.supply * 0.02).length;
  const worstSoft = Math.max(heatLost, netLost, powerLost);
  if (state.tripped) top = { id: "power", title: "Your limit: the breaker.", detail: "Nothing earns until you flip it back on." };
  else if (down.length) top = { id: "power", title: `Your limit: ${down[0].name} won't start.`, detail: "It needs a bigger power supply." };
  else if (cardless.length && !fleetOn) top = { id: "speed", title: `Your limit: ${cardless[0].name} has no GPU.`, detail: "It's earning nothing. Put a card in it." };
  else if (!serving.length && !units.some((m) => m.task !== "serve")) top = { id: "speed", title: "Your limit: nothing is running.", detail: "Finish a machine and load a model." };
  else if (worstSoft > unsold && worstSoft > 0.5) {
    if (worstSoft === powerLost && state.curtail) top = { id: "power", title: "Your limit: a grid emergency.", detail: `The utility cut your contract 20% for ${Math.ceil(state.curtail.until - state.day)} more days. Racks are held to ${Math.round((state.capFactor ?? 1) * 100)}%, costing ${moneyText(powerLost)} a day. It passes.` };
    else if (worstSoft === powerLost) top = { id: "power", title: `Your limit: ${feed ? "the power contract" : "the building's power"}.`, detail: `Racks are held to ${Math.round((state.capFactor ?? 1) * 100)}%, costing ${moneyText(powerLost)} a day. ${order ? `A bigger feed arrives in ${Math.ceil(order.ready - state.day)} days.` : nextFeed(state) ? "Order a bigger feed." : nextSite(state) ? `This feed is maxed out. Move to the ${nextSite(state).name.toLowerCase()}.` : "This feed is maxed out. Get more tokens per megawatt."}` };
    else if (worstSoft === netLost) top = { id: "network", title: "Your limit: the network.", detail: `Racks wait on switches, costing ${moneyText(netLost)} a day. Buy a switch.` };
    else top = { id: "heat", title: `Your limit: ${fleetOn ? "the cooling plant" : "room heat"}.`, detail: `Hot cards are costing you ${moneyText(heatLost)} a day. Buy cooling.` };
  }
  else if (unsold > 0.5 && unsold >= unmet * 0.25) top = { id: "buyers", title: fullTiers > 1 ? "Your limit: buyers. Every size you serve is full." : `Your limit: ${TIERS[unsoldTier].name.toLowerCase()}-model buyers.`, detail: `${moneyText(unsold)} a day of tokens goes unsold. ${fleetOn ? buyersFix : "Serve a different size of model."}` };
  else if (state.amps > safe && here.shared) top = { id: "power", title: "Your limit: this shared outlet.", detail: `You're over the ${safe.toFixed(1)} A safe line, so an appliance can trip you. A dedicated circuit fixes it.` };
  else if (fleetOn && used >= floorMax && !here.hall) top = { id: "space", title: `Your limit: floor space in the ${here.name.toLowerCase()}.`, detail: "No more rack spots. Move up, or sell old machines to make room." };
  else if (fleetOn && racksLeft === 0 && !nextFeed(state) && !nextSite(state)) top = { id: "power", title: "Your limit: the largest feed there is.", detail: `The contract is full and there's nothing bigger to sign. Get more tokens per megawatt. Buyers would pay ${moneyText(unmet)} more a day.` };
  else if (fleetOn && racksLeft === 0 && (order || nextFeed(state))) top = { id: "power", title: `Your limit: ${feed ? "the power contract" : "the building's power"}.`, detail: order ? `It's full, and a bigger feed arrives in ${Math.ceil(order.ready - state.day)} days. Buyers would pay ${moneyText(unmet)} more a day.` : `It's full. Order a bigger feed. Buyers would pay ${moneyText(unmet)} more a day.` };
  else if (fleetOn && racksLeft === 0) top = { id: "power", title: `Your limit: ${feed ? "the power contract" : "the building's power"}.`, detail: `There's no room for another rack, and this site can't take more power. Move to the ${nextSite(state).name.toLowerCase()}.` };
  else top = { id: "speed", title: "Your limit: GPU speed.", detail: `Buyers would pay ${moneyText(unmet)} more a day than you can make.${fleetOn ? " Add racks." : ""}` };
  return { rows, top, unsold, unmet, heatLost, netLost, powerLost };
}
function moneyText(n) {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return n < 10 ? `$${n.toFixed(2)}` : `$${Math.round(n).toLocaleString("en-US")}`;
}
function wattText(w) {
  return w >= 1e6 ? `${(w / 1e6).toFixed(2)} MW` : `${Math.round(w / 1000)} kW`;
}

function addGpu(state, machineId, id) {
  const m = state.machines.find((x) => x.id === machineId);
  const card = part("gpus", id);
  if (dcLoad(m) + card.watts > psuWatts(m)) {
    const need = dcLoad(m) + card.watts;
    const psu = [...CATALOG.psus].sort((a, b) => a.price - b.price).find((p) => {
      if (fitProblem(state, m, "psus", p)) return false;
      const swapped = replacedBy(m, "psus", p);
      return psuWatts(m) - (swapped ? part("psus", swapped).watts : 0) + p.watts >= need;
    });
    if (psu) {
      // No power supply, no card: a card it can't power would just switch the machine off.
      const got = buy(state, "psus", psu.id, machineId);
      if (!got.ok) return got;
    }
  }
  return buy(state, "gpus", id, machineId);
}

export const shortName = (g) => g.name.replace(/^(GeForce|NVIDIA|Intel|Radeon RX) /, "").replace(/ Blackwell( Workstation)?( Edition)?/, "").replace(/ - .*$/, "").replace(/ \(.*$/, "");

const WORKSTATION = (state, rack) => [["chassis", rack ? "silverstone-rm44" : "phanteks-enthoo-pro-2-server"], ["boards", "asrock-wrx90-ws-evo"], ["cpus", "amd-threadripper-pro-9965wx"], ["coolers", "noctua-nh-u14s-tr5-sp6"], ["psus", site(state).volts >= 200 ? "silverstone-hela-2050r" : "corsair-hx1500i"], ["storage", "samsung-990-pro-2tb"], ["memory", "samsung-m321r8ga0bb0-cqk-64gb-4800"]];
/** Buy every part this draft is still missing for a four-card workstation. */
export function fillWorkstation(state, m, cardId, rack = false) {
  const need = { chassis: !m.chassis, boards: !m.board, cpus: !m.cpu, coolers: !m.cooler, psus: !m.psus.length, storage: !m.storage, memory: !m.memory.length };
  for (const [kind, id] of WORKSTATION(state, rack)) if (need[kind]) buy(state, kind, id, m.id);
  if (!m.gpus.length && cardId) buy(state, "gpus", cardId, m.id);
}
/** What fillWorkstation would cost right now, and why it can't happen if it can't. */
export function workstationQuote(state, m, cardId, rack = false) {
  const copy = JSON.parse(JSON.stringify(state));
  copy.cash = 1e12;
  const mine = copy.machines.find((x) => x.id === m.id);
  fillWorkstation(copy, mine, cardId, rack);
  return { cost: 1e12 - copy.cash, complete: isComplete(mine) };
}
/** The standard workstation: room for four cards, on a board with fast memory. */
export function buildWorkstation(state, cardId, rack = false) {
  const m = addMachine(state);
  fillWorkstation(state, m, cardId, rack);
  return { ok: true, id: m.id };
}

/** The smallest memory one card needs to hold any model of this size whole, at rough quality and at standard. */
export function cardNeed(state, tier) {
  const inTier = allModels(state).filter((x) => x.tier === tier);
  const toGB = (size) => Math.ceil((size + 1.5) / 1.0737);
  return { rough: toGB(Math.min(...inTier.map((x) => Math.min(...Object.values(x.sizes))))), standard: toGB(Math.min(...inTier.map((x) => x.sizes.Q4 ?? Infinity))) };
}
/** The best new machine for one size of model: a standard workstation with 1, 2 or 4 of one card, whichever pays back fastest
 *  on that size, after power, without tripping anything. Tried on copies, so nothing is bought. */
export function tierBuild(state, tier) {
  const rack = floorUsed(state) + 1 > floorLimit(state);
  if (rack && rackUnits(state) - rackUsed(state) < 4) return { problem: "No free floor spot or rack space. Buy a rack on the floor's racks tab, or sell a machine." };
  let best = null;
  for (const g of CATALOG.gpus) {
    for (const n of [1, 2, 4]) {
      const copy = rehearsalCopy(state);
      copy.cash = 1e12;
      recompute(copy);
      const r = buildWorkstation(copy, g.id, rack);
      const m = copy.machines.find((x) => x.id === r.id);
      for (let i = 1; i < n; i++) buy(copy, "gpus", g.id, m.id);
      if (m.gpus.length !== n || !isComplete(m)) continue;
      const cost = 1e12 - copy.cash;
      let pick = null;
      for (const model of allModels(copy).filter((x) => x.tier === tier)) {
        for (const quant of Object.keys(model.sizes)) {
          const e = estimateEarn(copy, m, model, quant);
          if (!e.fit.fits || e.fit.mode === "spill") continue;
          if (!pick || e.perDay > pick.perDay) pick = { model, quant, perDay: e.perDay };
        }
      }
      if (!pick) continue;
      loadModel(copy, m.id, pick.model.id, pick.quant);
      recompute(copy);
      if (copy.amps >= safeAmps(copy) * 0.97) continue;
      const net = pick.perDay - dollarsPerDay(copy, m.output.wall || dcLoad(m) / 0.92);
      if (net <= 0) continue;
      const payback = cost / net;
      if (!best || payback < best.payback) best = { card: g, n, cost, perDay: net, payback, model: pick.model, quant: pick.quant, rack, whole: m.output.fit?.mode === "single" || m.output.fit?.mode === "copies" };
    }
  }
  return best || { problem: "Nothing you can build here makes money on this size yet." };
}
/** Build what tierBuild found, for real, and load its model. */
export function buildForTier(state, tier) {
  const plan = tierBuild(state, tier);
  if (plan.problem) return { ok: false, reason: plan.problem };
  if (state.cash < plan.cost) return { ok: false, reason: `You need $${Math.ceil(plan.cost - state.cash).toLocaleString("en-US")} more.` };
  const r = buildWorkstation(state, plan.card.id, plan.rack);
  const m = state.machines.find((x) => x.id === r.id);
  for (let i = 1; i < plan.n; i++) buy(state, "gpus", plan.card.id, m.id);
  loadModel(state, m.id, plan.model.id, plan.quant);
  recompute(state);
  return { ok: true, id: m.id, plan };
}

/** Every useful thing you could do next, tried on a copy of the game and ranked by how fast it pays back. */
export function nextMoves(state, machineId) {
  sharedOptions = new Map();
  try {
    return rankMoves(state, machineId);
  } finally {
    sharedOptions = null;
  }
}
function rankMoves(state, machineId) {
  const baseline = rehearse(state, () => {});
  const current = settledProfit(state);
  const moves = [{ id: "optimize", free: true, label: `Load the best model on every ${state.rows.length ? "rack and machine" : "machine"}`, run: () => {} }];
  for (const t of TECH) if (!hasTech(state, t.id) && techAvailable(state, t)) moves.push({ id: `tech-${t.id}`, label: t.name, run: (s) => buyTech(s, t.id) });
  for (const t of TECH) if (t.demand && hasTech(state, t.id) && !techActive(state, t.id) && techAvailable(state, t)) moves.push({ id: `restart-${t.id}`, free: true, label: `Restart ${t.name.toLowerCase()}`, run: (s) => toggleTech(s, t.id) });
  for (const app of APPS) {
    if (!appAvailable(state, app) || appLevel(state, app.id) >= APP_LEVELS) continue;
    const level = appLevel(state, app.id);
    moves.push({ id: `app-${app.id}`, label: level ? `${app.name}, version ${level + 1}` : `Launch ${app.name}`, unlocks: `Your own buyers for ${TIERS[app.tier].name.toLowerCase()} models. They take months to arrive, so the number shows it full.`, run: (s) => launchApp(s, app.id), forecast: (s) => launchApp(s, app.id, !!state.stats.soldByTier?.[app.tier]?.supply) });
  }
  // Once racks carry the company, single-machine upgrades are rounding errors. Don't crowd the list with them.
  const rackSales = state.rows.reduce((n, r) => n + (r.output?.revenue || 0), 0);
  const fleetDominant = totalRacks(state) >= 4 || (rackSales > 0 && rackSales > state.stats.revenuePerDay * 0.5);
  // Machines with identical parts have identical options, so try each kind once, the one on screen first.
  const seen = new Set();
  const sigOf = (x) => `${x.board}|${x.chassis}|${x.psus}|${x.memory}|${x.tuned}|${x.gpus.map((g) => g.id).join()}`;
  // Beside racks, one machine's upgrade is a rounding error, but thirty at once may not be. Those stay on the list.
  const twins = (x) => state.machines.filter((y) => isRunning(y) && y.task === "serve" && !y.forDeal && sigOf(y) === sigOf(x)).map((y) => y.id);
  // The biggest groups first, since that's where an upgrade moves the most.
  const kinds = [...state.machines].sort((a, b) => isRunning(b) - isRunning(a) || (fleetDominant ? 0 : (b.id === machineId) - (a.id === machineId)) || twins(b).length - twins(a).length).filter((x) => {
    const sig = sigOf(x);
    if (seen.has(sig) || !x.board || !x.chassis) return false;
    if (fleetDominant && twins(x).length < 2) return false;
    seen.add(sig);
    return true;
  }).slice(0, fleetDominant ? 4 : 6);
  for (const m of kinds) {
    const group = twins(m);
    for (const g of CATALOG.gpus) {
      if (fitProblem(state, m, "gpus", g)) continue;
      const each = (s, id) => addGpu(s, id, g.id);
      moves.push({ id: `gpu-${g.id}-${m.id}`, kind: `${sigOf(m)}|add`, group, each, label: `Add ${shortName(g)}${g.used ? " used" : ""}${state.machines.length > 1 ? ` to ${m.name}` : ""}`, run: (s) => addGpu(s, m.id, g.id) });
    }
    // Swap the smallest card for a better one: sell the old card, buy the new one.
    if (m.gpus.length) {
      const smallest = m.gpus.map((g, i) => ({ i, card: part("gpus", g.id) })).sort((a, b) => a.card.vram - b.card.vram || a.card.bandwidth - b.card.bandwidth)[0];
      for (const g of CATALOG.gpus) {
        if (g.vram <= smallest.card.vram && g.bandwidth <= smallest.card.bandwidth) continue;
        const each = (st, id) => {
          const live = st.machines.find((x) => x.id === id);
          sellInstalled(st, id, "gpus", smallest.i);
          if (fitProblem(st, live, "gpus", g)) return;
          addGpu(st, id, g.id);
        };
        moves.push({
          id: `swap-${g.id}-${m.id}`,
          kind: `${sigOf(m)}|swap`,
          group,
          each,
          label: `Swap ${shortName(smallest.card)} for ${shortName(g)}${state.machines.length > 1 ? ` in ${m.name}` : ""}`,
          run: (st) => each(st, m.id),
          valid: (st) => st.machines.find((x) => x.id === m.id).gpus.some((c) => c.id === g.id),
        });
      }
    }
    if (!isComplete(m) || fleetDominant) continue;
    const c = part("chassis", m.chassis);
    const space = c.type === "rackmount" ? rackHasRoomFor(state, c.units) : floorUsed(state) + 1 <= floorLimit(state);
    if (space) moves.push({ id: `copy-${m.id}`, label: `Copy ${m.name}`, run: (s) => cloneMachine(s, m.id) });
  }
  // A size buyers want that you barely serve: the best machine built for it, picked on copies.
  if (!fleetDominant) {
    for (const tier of ["small", "medium", "large", "frontier"]) {
      const v = state.stats.soldByTier?.[tier];
      if ((v?.supply || 0) > tierDemand(state, tier) * 0.5) continue;
      const plan = tierBuild(state, tier);
      if (plan.problem) continue;
      moves.push({ id: `tierbuild-${tier}`, label: `Build a machine for ${TIERS[tier].name.toLowerCase()} models: ${plan.n} x ${shortName(plan.card)}`, unlocks: `Buyers want more ${TIERS[tier].name.toLowerCase()} than you make. It runs ${plan.model.name}${plan.whole ? ", whole on each card, so every card works" : ""}.`, run: (s) => buildForTier(s, tier) });
    }
  }
  // A fresh workstation, for when every case is full of small cards.
  if (!fleetDominant && floorUsed(state) + 1 <= floorLimit(state)) {
    for (const cardId of ["rtx-3090-used", "rtx-pro-6000-blackwell-max-q-96gb"]) {
      const g = part("gpus", cardId);
      moves.push({ id: `build-${cardId}`, label: `New 4-card workstation with ${shortName(g)}`, run: (st) => buildWorkstation(st, cardId) });
    }
  }
  // Racks, bought turnkey with whatever cooling, switches and halls they need.
  if (fleetUnlocked(state)) {
    for (const sku of instantRacks(state)) {
      const each = rackPrice(state, sku);
      const n = Math.max(1, Math.min(RACKS_PER_ROW, Math.floor(state.cash / (each * 1.15))));
      moves.push({ id: `rack-${sku.id}`, sku: sku.id, racks: n, label: n === RACKS_PER_ROW ? `Add a row of 8 ${sku.short} racks` : n > 1 ? `Add ${n} ${sku.short} racks` : `Add a ${sku.short} rack`, run: (s) => buyRacks(s, sku.id, n) });
    }
  }
  // The newest racks come by order. Priced as if they were running today, which is as far as the status page can see.
  for (const o of orderable(state)) {
    const each = Math.round(o.sku.price * state.index.gpus);
    const n = Math.max(1, Math.min(RACKS_PER_ROW, allocationLeft(state), Math.floor(state.cash / (each * 1.15))));
    if (!allocationLeft(state)) continue;
    moves.push({ id: `order-${o.sku.id}`, label: `Order ${n} ${o.sku.short} ${n === 1 ? "rack" : "racks"}`, unlocks: o.pre ? `They ship on launch day, in ${Math.ceil(o.ready - state.day)} days. The number shows them running.` : `They arrive in ${LEAD_DAYS} days. The number shows them running.`, run: (s) => orderRacks(s, o.sku.id, n), forecast: (s) => installRacks(s, o.sku, n, null, each * n) });
  }
  if ((state.netRatio ?? 1) < 1) {
    const short = fabricNeed(state) - fabricCapacity(state);
    const options = CATALOG.network.filter((x) => siteAtLeast(state, x.site));
    const sw = options.find((x) => x.tb >= short) || options.at(-1);
    if (sw) {
      const n = Math.ceil(short / sw.tb);
      moves.push({ id: `net-${sw.id}`, label: n > 1 ? `${n} more ${sw.name.replace(" switch", "")} switches` : sw.name, run: (s) => { for (let i = 0; i < n; i++) buyNetwork(s, sw.id); } });
    }
  }
  if (state.rows.length && hasTech(state, "powerlimit")) {
    const anyOff = state.rows.some((r) => !r.tuned);
    moves.push({ id: anyOff ? "tune-all" : "untune-all", free: true, label: anyOff ? "Power-limit every rack" : "Take the power limit off every rack", run: (s) => setAllRows(s, "tuned", anyOff) });
  }
  // When power is what's short, tokens per megawatt is the game: rip out the thirstiest row for something better.
  if (state.rows.length && (state.capFactor ?? 1) < 0.999 && !state.curtail) {
    const perKw = (r) => (r.output?.revenue || 0) / (skuOf(r).kW * r.racks);
    const worst = [...state.rows].sort((a, b) => perKw(a) - perKw(b))[0];
    for (const sku of instantRacks(state)) {
      if (sku.price <= skuOf(worst).price) continue;
      moves.push({ id: `swaprow-${sku.id}`, label: `Swap ${worst.name} for ${worst.racks} ${sku.short} racks`, run: (s) => {
        const n = worst.racks;
        const trial = rehearsalCopy(s);
        const sold = sellRack(trial, worst.id, n);
        const bought = sold.ok ? buyRacks(trial, sku.id, n) : sold;
        if (!bought.ok) return bought;
        sellRack(s, worst.id, n);
        return buyRacks(s, sku.id, n);
      } });
    }
  }
  const next = nextSite(state);
  const feedNext = nextFeed(state);
  const hot = state.targetC > 30 || state.roomC > 30;
  if (next && !next.feeds) moves.push({ id: "site", label: `Move to the ${next.name.toLowerCase()}`, unlocks: `${next.amps} A at ${next.volts} V, ${next.floor} floor spots${next.shared ? "" : ", nobody else on the circuit"}${next.id === "warehouse" ? ", and whole racks" : ""}`, run: (s) => moveSite(s) });
  const coolOptions = COOLING.filter((c) => coolingAvailable(state, c));
  if (hot) {
    const p = state.plant || {};
    const deficit = Math.max(0, (p.air ?? state.heatW ?? 0) - (p.airCap ?? coolingCapacity(state)));
    const airOptions = coolOptions.filter((c) => c.coolW > 0);
    const fix = airOptions.find((x) => x.coolW > deficit) || airOptions.at(-1);
    const n = Math.max(1, Math.ceil(deficit / fix.coolW));
    moves.push({ id: `cool-${fix.id}`, label: n > 1 ? `${n} x ${fix.name}` : fix.name, run: (s) => { for (let i = 0; i < n; i++) buyCooling(s, fix.id); } });
  }
  if (state.plant && state.plant.wet > state.plant.wetCap) {
    const wet = coolOptions.find((c) => c.liquidW);
    if (wet) {
      const n = Math.ceil((state.plant.wet - state.plant.wetCap) / wet.liquidW);
      moves.push({ id: `cool-${wet.id}`, label: n > 1 ? `${n} x ${wet.name}` : wet.name, run: (s) => { for (let i = 0; i < n; i++) buyCooling(s, wet.id); } });
    }
  }
  const out = [];
  const floorGain = fleetDominant ? Math.abs(state.stats.profitPerDay) * 0.002 : 0;
  for (const move of moves) {
    const r = rehearse(state, move.forecast || move.run, move.valid);
    if (!r) continue;
    const free = !!move.free;
    const gain = move.id === "optimize" ? r.profit - current : r.profit - baseline.profit;
    if (free ? gain < Math.max(0.01, Math.abs(state.stats.profitPerDay) * 0.001) : r.cost === 0) continue;
    if (!free && !move.unlocks && !move.group?.length && gain < floorGain) continue;
    out.push({ ...move, cost: r.cost, gain, trips: r.amps >= r.limit, amps: r.amps, payback: gain > 0.01 ? Math.max(0, r.cost) / gain : Infinity, canAfford: state.cash >= r.cost });
  }
  // More power and bigger sites pay off only once something is plugged in, so price them with the best racks that would fill them.
  // A move does exactly what it priced: whatever racks it counted on get bought by the same click.
  const bundled = (id, label, unlockRun, fills, what, extras = [], fixedCount = null, realRun = unlockRun) => {
    const costOnly = rehearse(state, unlockRun);
    if (!costOnly) return;
    // Counted in what you could buy today after the unlock, so the bundle doesn't run away from you as you save.
    const countFor = (sku) => fixedCount ?? Math.max(1, Math.min(RACKS_PER_ROW, Math.floor((state.cash - costOnly.cost) / (rackPrice(state, sku) * 1.15))));
    // It may pay on its own, if racks are already held back. Otherwise it pays once it's filled.
    const alone = costOnly.profit - baseline.profit;
    let best = alone > 0.01 ? { sku: null, gain: alone, payback: costOnly.cost / alone, total: costOnly.cost, extra: null } : null;
    for (const sku of fills) {
      for (const extra of [null, ...extras]) {
        let count = countFor(sku);
        const tryWith = (n) => rehearse(state, (s) => { unlockRun(s); if (extra) buyTech(s, extra.id); buyRacks(s, sku.id, n); });
        let r = tryWith(count);
        // Cooling and switches may have pushed it past what you have. Shrink it once so it stays within reach.
        if (r && !fixedCount && count > 1 && r.cost > state.cash) {
          count = Math.max(1, Math.floor((count * Math.max(0, state.cash - costOnly.cost)) / Math.max(1, r.cost - costOnly.cost)));
          r = tryWith(count);
        }
        if (!r) continue;
        const gain = r.profit - baseline.profit;
        if (gain <= 0.01) continue;
        const payback = r.cost / gain;
        if (!best || payback < best.payback) best = { sku, count, gain, payback, total: r.cost, extra };
      }
    }
    const extraText = best?.extra ? ` and ${best.extra.name.toLowerCase()}` : "";
    out.push({
      id, label: best?.sku ? `${label}, with ${best.count} ${best.sku.short} ${best.count === 1 ? "rack" : "racks"}${extraText}` : label,
      run: (s) => {
        if (realRun !== unlockRun && best?.sku) {
          // One plan, sized for the bigger contract and priced as quoted. Cooling today's power needs goes in today; the rest is paid now and installed when the feed energizes.
          const future = rehearsalCopy(s);
          unlockRun(future);
          const plan = provisionPlan(future, best.sku, best.count);
          const priced = rehearsalCopy(s);
          unlockRun(priced);
          const trial = buyRacks(priced, best.sku.id, best.count);
          if (!trial.ok) return trial;
          if (s.cash < s.cash - priced.cash) return { ok: false, reason: `You need $${Math.ceil(-priced.cash).toLocaleString("en-US")} more.` };
          const today = [...provisionPlan(s, best.sku, best.count).cooling];
          const later = plan.cooling.filter((id) => {
            const i = today.indexOf(id);
            if (i < 0) return true;
            today.splice(i, 1);
            return false;
          });
          const laterCost = later.reduce((n, id) => n + by(COOLING, id).cost, 0);
          const kept = [...later];
          const now = plan.cooling.filter((id) => {
            const i = kept.indexOf(id);
            if (i < 0) return true;
            kept.splice(i, 1);
            return false;
          });
          const done = realRun(s);
          if (done && done.ok === false) return done;
          const bought = buyRacks(s, best.sku.id, best.count, { ...plan, cooling: now, cost: plan.cost - laterCost });
          if (bought.ok === false) return bought;
          s.cash -= laterCost;
          if (later.length) s.feedOrder.install = { cooling: later, network: [] };
          return { ok: true };
        }
        const done = realRun(s);
        if (done && done.ok === false) return done;
        if (best?.extra) buyTech(s, best.extra.id);
        if (best?.sku) return buyRacks(s, best.sku.id, best.count);
        return done;
      },
      cost: best ? best.total : costOnly.cost, gain: best ? best.gain : 0, trips: false, amps: state.amps, canAfford: state.cash >= (best ? best.total : costOnly.cost),
      payback: best ? best.payback : Infinity,
      unlocks: what,
    });
  };
  // Sales deals cut the price today and pay only once there are racks to sell into the new demand.
  const buyersFull = Object.values(state.stats.soldByTier || {}).some((v) => v.supply - v.sold > v.supply * 0.02);
  if (buyersFull) {
    // Fill new buyers with the two racks that already pay back fastest, whatever generation they're from.
    const paying = out.filter((x) => x.id.startsWith("rack-") && x.payback < Infinity).sort((x, y) => x.payback - y.payback).map((x) => part("fleetRacks", x.sku));
    const fills = paying.length ? paying.slice(0, 2) : instantRacks(state);
    for (const t of TECH) {
      if (!t.demand || hasTech(state, t.id) || !techAvailable(state, t)) continue;
      const i = out.findIndex((x) => x.id === `tech-${t.id}`);
      if (i >= 0 && out[i].gain > out[i].cost / 400) continue;
      if (i >= 0) out.splice(i, 1);
      bundled(`tech-${t.id}`, t.name, (s) => buyTech(s, t.id), fills, `Prices fall ${Math.round((1 - t.wholesale) * 100)}% today, so it dips first`, [], Math.max(RACKS_PER_ROW, Math.min(96, totalRacks(state))));
    }
  }
  const instantFeed = (s) => { const go = orderFeed(s); if (go.ok) { s.feed = s.feedOrder.index; s.feedOrder = null; } };
  if (feedNext && !state.feedOrder) {
    const mw = (feedNext.amps * site(state).volts) / 1e6;
    bundled("feed", `Sign for ${feedNext.amps} A, ${mw.toFixed(1)} MW`, instantFeed, instantRacks(state), `The power takes ${feedNext.days} days to arrive, so this pays after that`, [], null, (s) => orderFeed(s));
  }
  if (next && next.feeds) {
    const mw = (next.feeds[0].amps * next.volts) / 1e6;
    const preview = { ...state, site: next.id };
    bundled("site", `Move to the ${next.name.toLowerCase()}`, (s) => moveSite(s), instantRacks(state, preview), `${mw.toFixed(1)} MW, cheaper power, ${next.floor} rack spots`, TECH.filter((t) => t.site === next.id && !hasTech(state, t.id)), null);
  }
  // The best upgrades for a kind of machine also get priced across all of them, since a market can fill partway through.
  const tried = {};
  for (const o of [...out].sort((a, b) => a.payback - b.payback)) {
    if (!o.group || o.group.length < 2) continue;
    tried[o.kind] = (tried[o.kind] || 0) + 1;
    if (tried[o.kind] > 2) continue;
    const r = rehearse(state, (c) => {
      holdRecompute = true;
      try {
        o.group.forEach((id) => o.each(c, id));
      } finally {
        holdRecompute = false;
      }
    });
    if (!r) continue;
    const gain = r.profit - baseline.profit;
    o.all = { count: o.group.length, cost: r.cost, gain, payback: gain > 0.01 ? Math.max(0, r.cost) / gain : Infinity, trips: r.amps >= r.limit };
  }
  const kept = fleetDominant ? out.filter((o) => !o.group?.length || (o.all && o.all.gain >= floorGain)) : out;
  const rank = (o) => (fleetDominant && o.all ? o.all.payback : o.payback);
  return kept.sort((a, b) => rank(a) - rank(b) || a.cost - b.cost);
}
function installOrdered(state) {
  const kit = state.feedOrder?.install;
  if (!kit) return;
  state.cooling.push(...kit.cooling);
  state.network.push(...kit.network);
  state.feedOrder.install = null;
}
/** A fast copy for trying things out. Derived output and the news aren't copied; recompute rebuilds what matters. */
function rehearsalCopy(state) {
  return {
    ...state,
    news: [],
    machines: state.machines.map((m) => ({ ...m, psus: [...m.psus], memory: [...m.memory], gpus: m.gpus.map((g) => ({ ...g })), output: null })),
    rows: state.rows.map((r) => ({ ...r, output: null })),
    cooling: [...state.cooling],
    network: [...state.network],
    tech: [...state.tech],
    racks: [...state.racks],
    bench: [...state.bench],
    milestones: [...state.milestones],
    ownModels: [...state.ownModels],
    index: { ...state.index },
    deflation: { ...state.deflation },
    surge: { ...state.surge },
    stats: { ...state.stats },
    load: { ...state.load },
    spike: null,
    curtail: null,
    tripped: false,
    feedOrder: state.feedOrder ? { ...state.feedOrder } : null,
    contract: state.contract ? { ...state.contract } : null,
    offer: null,
    project: state.project ? { ...state.project } : null,
    world: copyWorld(state.world),
  };
}
/** Try something on a copy of the game with models re-chosen and the room settled, and report the result. */
function rehearse(state, action, valid) {
  const copy = rehearsalCopy(state);
  copy.cash = 1e12;
  const before = copy.cash;
  recompute(copy);
  action(copy);
  if (valid && !valid(copy)) return null;
  const cost = before - copy.cash;
  for (let i = 0; i < 2; i++) {
    optimizeModels(copy);
    copy.roomC = copy.targetC;
  }
  optimizeModels(copy);
  return { profit: copy.stats.profitPerDay, cost, amps: copy.amps, limit: limitAmps(copy), cap: copy.capFactor ?? 1 };
}
/** Today's profit once the room settles, with the models as they are loaded now. */
function settledProfit(state) {
  const copy = rehearsalCopy(state);
  for (let i = 0; i < 4; i++) {
    recompute(copy);
    copy.roomC = copy.targetC;
  }
  recompute(copy);
  return copy.stats.profitPerDay;
}
/** Do a ranked move for real. */
export function doMove(state, move, machineId) {
  const fresh = nextMoves(state, machineId ?? state.machines[0]?.id).find((x) => x.id === move.id);
  if (!fresh) return { ok: false, reason: "That move isn't available any more." };
  if (fresh.trips) return { ok: false, reason: `That would trip the breaker at ${fresh.amps.toFixed(1)} A.` };
  if (state.cash < fresh.cost) return { ok: false, reason: `You need $${Math.ceil(fresh.cost - state.cash).toLocaleString("en-US")} more.` };
  const before = state.cash;
  const done = fresh.run(state);
  if (done && done.ok === false) return done;
  if (!fresh.free && state.cash === before) return { ok: false, reason: "That didn't work. Check the machine and try again." };
  optimizeModels(state);
  return { ok: true };
}

/** A new case stays in its rack only if it fits beside everything else there. Otherwise it takes the first rack with room, and nothing else moves. */
function rehome(state, m, chassisId) {
  const c = part("chassis", chassisId);
  if (c.type !== "rackmount") {
    m.rackSlot = undefined;
    return;
  }
  const racks = rackPlan(state, m);
  if (!racks[m.rackSlot] || racks[m.rackSlot].free < c.units) m.rackSlot = racks.find((r) => r.free >= c.units)?.index;
}
/** Do a move on every machine like this one, or as many as the cash covers. */
export function doMoveAll(state, move, machineId) {
  const fresh = nextMoves(state, machineId ?? state.machines[0]?.id).find((x) => x.id === move.id);
  if (!fresh?.all) return { ok: false, reason: "That move isn't available any more." };
  let done = 0;
  const cards = (st, id) => st.machines.find((x) => x.id === id)?.gpus.map((g) => g.id).join();
  for (const id of fresh.group) {
    // Try each one first, so a machine is never left half changed when the money runs out.
    const trial = rehearsalCopy(state);
    const had = cards(state, id);
    fresh.each(trial, id);
    if (trial.cash < 0 || cards(trial, id) === had) continue;
    const beforeCount = state.machines.find((x) => x.id === id).gpus.length;
    const after = trial.machines.find((x) => x.id === id);
    if (after.gpus.length < beforeCount || !isRunning(after)) continue;
    fresh.each(state, id);
    done++;
  }
  optimizeModels(state);
  return { ok: done > 0, done, reason: done ? null : "You can't afford that on any of them yet." };
}
function install(m, kind, id, health = 1) {
  if (kind === "gpus") m.gpus.push({ id, health });
  else if (kind === "memory") m.memory.push(id);
  else if (kind === "psus") m.psus.push(id);
  else m[SLOT_KEY[kind]] = id;
}

export function removePart(state, machineId, kind, index = 0) {
  const m = state.machines.find((x) => x.id === machineId);
  let id;
  let health = 1;
  if (kind === "gpus") ({ id, health } = m.gpus.splice(index, 1)[0]);
  else if (kind === "memory") id = m.memory.splice(index, 1)[0];
  else if (kind === "psus") id = m.psus.splice(index, 1)[0];
  else {
    const key = { cpus: "cpu", boards: "board", coolers: "cooler", storage: "storage", chassis: "chassis" }[kind];
    id = m[key];
    m[key] = null;
    if (kind === "chassis") m.rackSlot = undefined;
  }
  state.bench.push({ kind, id, health, key: state.nextId++ });
  recompute(state);
}

export function installFromBench(state, key, machineId) {
  const item = state.bench.find((b) => b.key === key);
  const m = state.machines.find((x) => x.id === machineId);
  const problem = fitProblem(state, m, item.kind, part(item.kind, item.id));
  if (problem) return { ok: false, reason: problem };
  if (item.kind === "chassis") rehome(state, m, item.id);
  install(m, item.kind, item.id, item.health);
  state.bench = state.bench.filter((b) => b !== item);
  recompute(state);
  return { ok: true };
}

export function sellFromBench(state, key) {
  const item = state.bench.find((b) => b.key === key);
  state.cash += resale(state, item.kind, part(item.kind, item.id));
  state.bench = state.bench.filter((b) => b !== item);
}

const modelMemo = new WeakMap();
/** Every model you could load. While the frontier moves, an older frontier model sells for half the price per generation behind. */
export function allModels(state) {
  const gen = state.world?.gen || 0;
  const on = ruleOn(state, "gens");
  const memo = modelMemo.get(state.ownModels);
  if (memo && memo.gen === gen && memo.on === on && memo.len === state.ownModels.length) return memo.list;
  const list = [...CATALOG.models, ...releasedModels(gen), ...state.ownModels].map((m) => {
    const aged = on && m.tier === "frontier" ? gen - (m.gen || 0) : 0;
    return aged > 0 ? { ...m, aged, premium: (m.premium || 1) * Math.pow(AGE_PRICE, aged) } : m;
  });
  modelMemo.set(state.ownModels, { gen, on, len: state.ownModels.length, list });
  return list;
}

/** Everything the UI needs to know about loading one model on one machine. */
export function modelFit(state, m, model, quant = "Q4") {
  if (m.sku) return rowFit(state, m, model, quant);
  const size = model.sizes[quant] ?? model.sizes.Q4;
  const cards = m.gpus.map((g) => part("gpus", g.id));
  if (!cards.length) return { fits: false, size, label: "no GPU" };
  const overhead = 1.5;
  const toDecimal = 1.0737; // A "24GB" card is GiB; model files are decimal GB.
  const fitting = cards.filter((c) => c.vram * toDecimal - overhead >= size);
  const pool = cards.reduce((n, c) => n + c.vram * toDecimal - overhead, 0);
  const ratio = sparseRatio(model);
  const tok = (card, gpuGB, ramGB = 0, ramBW = 1) => {
    const vendor = card.vendor === "amd" ? 0.8 : card.vendor === "intel" ? 0.56 : 1;
    const gpuTime = (gpuGB * ratio) / (0.8 * card.bandwidth);
    const ramTime = ramGB ? (ramGB * ratio) / (0.6 * ramBW) : 0;
    return (vendor * 1) / (gpuTime + ramTime + 0.004);
  };
  if (fitting.length) {
    const speed = fitting.reduce((n, c) => n + tok(c, size), 0);
    return { fits: true, mode: fitting.length > 1 ? "copies" : "single", copies: fitting.length, size, tokS: speed, label: fitting.length > 1 ? `${fitting.length} copies, one per card` : "fits on one card" };
  }
  const slowest = cards.reduce((a, c) => (c.bandwidth < a.bandwidth ? c : a), cards[0]);
  if (pool >= size) {
    const scale = hasTech(state, "tensor") && !model.moe ? Math.pow(cards.length, 0.6) : 1;
    return { fits: true, mode: "split", copies: 1, size, tokS: tok(slowest, size) * scale, label: `split across ${cards.length} cards` };
  }
  const spill = size - pool;
  if (spill <= memoryGB(m) - 8) {
    return { fits: true, mode: "spill", copies: 1, size, tokS: tok(slowest, pool, spill, ramBandwidth(m) || 40), label: `${Math.round(spill)} GB spills into slow memory` };
  }
  return { fits: false, size, short: Math.ceil(spill - Math.max(0, memoryGB(m) - 8)), label: `${Math.ceil(spill)} GB too big` };
}

/** Real fleets spend most of their time on bursts, retries and long contexts. Tuned so a rack pays back like a machine does. */
const FLEET_DUTY = 0.12;
/** A rack runs as many copies of the model as its cards allow, each copy within one linked group of cards. */
function rowFit(state, row, model, quant) {
  const sku = skuOf(row);
  const size = model.sizes[quant] ?? model.sizes.Q4;
  const usable = sku.gb * 1.0737 - 1.5;
  const perCopy = Math.ceil(size / usable);
  if (perCopy > sku.domain) return { fits: false, size, short: Math.ceil(size - usable * sku.domain), label: `needs ${perCopy} linked cards, and this rack links ${sku.domain}` };
  const vendor = sku.vendor === "amd" ? 0.8 : 1;
  const one = vendor / ((size * sparseRatio(model)) / (0.8 * sku.bandwidth) + 0.001);
  const scale = perCopy > 1 && hasTech(state, "tensor") && !model.moe ? Math.pow(perCopy, 0.6) : 1;
  // Cards only split a model inside their own linked group, so what's left over in a group can't help.
  const copies = Math.floor(sku.cards / sku.domain) * Math.floor(sku.domain / perCopy) + Math.floor((sku.cards % sku.domain) / perCopy);
  const fleet = TECH.reduce((n, t) => (t.fleet && hasTech(state, t.id) ? n * t.fleet : n), 1);
  return { fits: true, mode: perCopy > 1 ? "split" : "copies", copies: copies * row.racks, size, used: (copies * perCopy) / sku.cards, tokS: one * scale * copies * row.racks * FLEET_DUTY * fleet, label: perCopy > 1 ? `${copies} copies a rack, ${perCopy} cards each` : `${copies} copies a rack, one per card` };
}

export function loadModel(state, machineId, modelId, quant = "Q4") {
  const m = unitById(state, machineId);
  const model = allModels(state).find((x) => x.id === modelId);
  const fit = modelFit(state, m, model, quant);
  if (!fit.fits) return { ok: false, reason: `${model.name} doesn't fit: ${fit.label}.` };
  m.modelId = modelId;
  m.quant = quant;
  m.task = "serve";
  m.forDeal = false;
  m.dealBack = null;
  recompute(state);
  return { ok: true };
}

// Each level up costs about ten times as much and does more than ten times the work. Big hires are the point of getting big.
// Your own products: buyers only you can serve, paying more than the open market, who arrive slowly and leave if you can't serve them.
export const APPS = [
  { id: "voice", name: "Voice notes", tier: "tiny", mult: 6, cost: 3000, site: "spare", text: "An app that writes down what you say. Cheap to run, sold by subscription." },
  { id: "support", name: "Support chatbot", tier: "small", mult: 5, cost: 12000, site: "garage", text: "Answers customers for shops that can't staff a phone line." },
  { id: "docs", name: "Docs copilot", tier: "medium", mult: 4, cost: 80000, site: "cage", text: "Reads a company's files and answers questions about them." },
  { id: "coder", name: "Coding agent", tier: "large", mult: 3, cost: 600000, site: "warehouse", text: "Writes and fixes code all day, and burns tokens doing it." },
  { id: "research", name: "Research agent", tier: "frontier", mult: 2, cost: 20000000, site: "datacenter", text: "Works for hours on hard problems. The most any buyer will pay for a token." },
];
export const APP_LEVELS = 6;
const appBase = (app, level) => TIERS[app.tier].demand * 0.6 * Math.pow(2, level - 1);
const appGrowth = (state) => 1 + state.day / 500;
export const appLevel = (state, id) => state.apps?.[id]?.level || 0;
export const appNextCost = (state, id) => by(APPS, id).cost * Math.pow(3, appLevel(state, id));
export const appAvailable = (state, app) => siteAtLeast(state, app.site);
/** What this product's users want now, and at its next version, in MTok a day. */
export function appDemand(state, tier) {
  const app = APPS.find((a) => a.tier === tier);
  const held = app && state.apps?.[app.id];
  return held ? held.users * appGrowth(state) : 0;
}
export const appCapacity = (state, id, level = appLevel(state, id)) => (level ? appBase(by(APPS, id), level) * appGrowth(state) : 0);
export function launchApp(state, id, full = false) {
  const app = by(APPS, id);
  if (!appAvailable(state, app)) return { ok: false, reason: `${app.name} needs a bigger site first.` };
  const level = appLevel(state, id);
  if (level >= APP_LEVELS) return { ok: false, reason: `${app.name} is as big as it gets.` };
  const cost = appNextCost(state, id);
  if (state.cash < cost) return { ok: false, reason: `You need $${Math.ceil(cost - state.cash).toLocaleString("en-US")} more.` };
  state.cash -= cost;
  const users = full ? appBase(app, level + 1) : state.apps?.[id]?.users ?? appBase(app, 1) * 0.05;
  // Copied rather than edited, because trial runs share this with the real game until they change it.
  state.apps = { ...(state.apps || {}), [id]: { level: level + 1, users } };
  recompute(state);
  return { ok: true };
}
const appsPerDay = (state) => APPS.reduce((n, a) => {
  const level = appLevel(state, a.id);
  return n + (level ? (a.cost * (Math.pow(3, level) - 1)) / 2 / 1000 : 0);
}, 0);
function growApps(state, dt) {
  for (const app of APPS) {
    const held = state.apps?.[app.id];
    if (!held) continue;
    const sold = state.stats.soldByTier?.[app.tier];
    const want = appDemand(state, app.tier);
    const served = want ? (sold?.toApps || 0) / want : 0;
    const cap = appBase(app, held.level);
    // Users spread by word of mouth up to what this version can hold. Leave them short and they drift away.
    if (served >= 0.98) held.users = Math.min(cap, held.users + (0.025 * held.users * (1 - held.users / cap) * state.rep + 0.002 * cap) * dt);
    else held.users = Math.max(Math.min(held.users, cap * 0.05), held.users - held.users * (1 - served) * 0.01 * dt);
  }
}
export const STAFF = [
  { id: "engineer", name: "ML engineer", hire: 8000, salary: 300, points: 1, text: "Tunes what you already run." },
  { id: "scientist", name: "Research scientist", hire: 80000, salary: 3000, points: 12, text: "Publishes, and then ships it." },
  { id: "lead", name: "Research lead", hire: 800000, salary: 25000, points: 150, text: "Runs a whole team's agenda." },
  { id: "chief", name: "Chief scientist", hire: 8000000, salary: 150000, points: 2000, text: "Everyone else wants to work for them." },
];
export const RESEARCH = [
  { id: "speed", name: "Inference engine", each: 0.1, max: 8, text: "Every machine and rack makes 10% more tokens, per level." },
  { id: "price", name: "Model quality", each: 0.06, max: 8, text: "Buyers pay 6% more per token, per level." },
  { id: "demand", name: "Market reach", each: 0.1, max: 8, text: "10% more buyers in every market, with no price cut, per level." },
  { id: "reachSmall", name: "Developer platform", each: 0.15, max: 8, text: "15% more buyers for tiny, small and medium models, per level. Good docs bring builders." },
  { id: "reachBig", name: "Enterprise trust", each: 0.12, max: 8, text: "12% more buyers for large and frontier models, per level. Security reviews, then big contracts." },
  { id: "power", name: "Power efficiency", each: 0.06, max: 6, text: "6% off every power bill, per level." },
  { id: "cooling", name: "Thermal design", each: 0.12, max: 5, text: "Your room and cooling shed 12% more heat, per level." },
  { id: "training", name: "Training stack", each: 0.25, max: 5, text: "Training your own models goes 25% faster, per level." },
];
const researchOf = (state) => (state.research ||= { staff: {}, points: 0, levels: {} });
export const researchLevel = (state, id) => researchOf(state).levels[id] || 0;
export const researchBonus = (state, id) => researchLevel(state, id) * by(RESEARCH, id).each;
export const researchCost = (state, id) => Math.round(250 * Math.pow(2.6, researchLevel(state, id)));
export const staffCount = (state, id) => researchOf(state).staff[id] || 0;
export const pointsPerDay = (state) => STAFF.reduce((n, x) => n + staffCount(state, x.id) * x.points, 0);
export const salaryPerDay = (state) => STAFF.reduce((n, x) => n + staffCount(state, x.id) * x.salary, 0);
/** Hiring costs more as the team grows: a one-time fee plus a salary every day. */
export function hireCost(state, id) {
  const x = by(STAFF, id);
  return Math.round(x.hire * Math.pow(1.15, staffCount(state, id)));
}
export function hire(state, id) {
  const cost = hireCost(state, id);
  if (state.cash < cost) return { ok: false, reason: `You need $${Math.ceil(cost - state.cash).toLocaleString("en-US")} more.` };
  state.cash -= cost;
  const r = researchOf(state);
  r.staff[id] = (r.staff[id] || 0) + 1;
  recompute(state);
  return { ok: true };
}
export function letGo(state, id) {
  const r = researchOf(state);
  if (!r.staff[id]) return { ok: false, reason: "Nobody in that job." };
  r.staff[id] -= 1;
  recompute(state);
  return { ok: true };
}
export function research(state, id) {
  const x = by(RESEARCH, id);
  const r = researchOf(state);
  if (researchLevel(state, id) >= x.max) return { ok: false, reason: "That's as far as it goes." };
  const cost = researchCost(state, id);
  if (r.points < cost) return { ok: false, reason: `That needs ${Math.ceil(cost - r.points).toLocaleString("en-US")} more research points.` };
  r.points -= cost;
  r.levels[id] = researchLevel(state, id) + 1;
  say(state, `${x.name.toUpperCase()} REACHES LEVEL ${r.levels[id]}.`, "good");
  recompute(state);
  return { ok: true };
}
export function earnMultiplier(state) {
  return (hasTech(state, "batch") ? 2.5 : 1) * (hasTech(state, "cache") ? 1.3 : 1) * (hasTech(state, "router") ? 1.3 : 1) * (1 + researchBonus(state, "speed"));
}

/** Sales deals trade price for buyers, so they can lose money. You can always end one. */
export const techActive = (state, id) => hasTech(state, id) && !(state.techOff || []).includes(id);
export function toggleTech(state, id) {
  state.techOff ||= [];
  state.techOff = state.techOff.includes(id) ? state.techOff.filter((x) => x !== id) : [...state.techOff, id];
  recompute(state);
  return { ok: true };
}
export function demandMultiplier(state) {
  return TECH.reduce((n, t) => (t.demand && techActive(state, t.id) ? n * t.demand : n), 1);
}
export function wholesaleCut(state) {
  return TECH.reduce((n, t) => (t.wholesale && techActive(state, t.id) ? n * t.wholesale : n), 1);
}
export const tierPrice = (state, tier) => TIERS[tier].price * state.deflation[tier] * wholesaleCut(state) * (1 + researchBonus(state, "price")) * marketFactor(state, tier);
/** How much of the model works on each token. Measured sparse (MoE) models run about 4x faster, not the full ratio. */
export function sparseRatio(model) {
  return model.moe && model.active ? Math.max(0.22, model.active / model.params) : 1;
}
/** Price per MTok. Sparse models are fast but sell for less, so speed and price trade off. */
export function modelRate(state, model, quant = "Q4") {
  return tierPrice(state, model.tier) * Math.pow(sparseRatio(model), 0.85) * QUANT_PRICE[quant] * (model.premium || 1);
}
export function tierDemand(state, tier) {
  const grow = 1 + state.day / 500;
  return TIERS[tier].demand * (0.45 + state.rep * 1.6) * grow * (state.surge[tier]?.mult || 1) * demandMultiplier(state) * (1 + researchBonus(state, "demand")) * (1 + researchBonus(state, tier === "large" || tier === "frontier" ? "reachBig" : "reachSmall"));
}

function coolingCapacity(state) {
  return (1 + researchBonus(state, "cooling")) * (site(state).passiveW + state.cooling.reduce((n, id) => n + by(COOLING, id).coolW, 0));
}
function coolingDraw(state) {
  return state.cooling.reduce((n, id) => n + by(COOLING, id).drawW, 0);
}
export function thermalThrottle(roomC) {
  if (roomC <= 32) return 1;
  return Math.max(0.4, 1 - (roomC - 32) * 0.05);
}
export function noiseOf(m) {
  return m.gpus.reduce((n, g) => n + (part("gpus", g.id).cooler === "blower" ? 7 : 4), 34);
}
export function noiseLevel(state) {
  const sum = state.machines.filter(isRunning).reduce((n, m) => n + Math.pow(10, noiseOf(m) / 10), 0) + Math.pow(10, 3);
  const ac = state.cooling.length ? 4 : 0;
  return 10 * Math.log10(sum) + ac;
}

export const fabricCapacity = (state) => (site(state).fabricTb || 0) + state.network.reduce((n, id) => n + part("network", id).tb, 0);
export const fabricNeed = (state) => state.rows.reduce((n, r) => (r.on ? n + skuOf(r).fabricTb * r.racks : n), 0);
function liquidCapacity(state) {
  return (1 + researchBonus(state, "cooling")) * state.cooling.reduce((n, id) => n + (by(COOLING, id).liquidW || 0), 0);
}
function fillDefaults(state) {
  if ((state.version || 1) < 2) {
    state.version = 2;
    state.centsPerKwh = POWER_CENTS;
    for (const t of Object.keys(state.deflation)) state.deflation[t] = Math.max(0.8, state.deflation[t]);
  }
  state.rows ||= [];
  state.network ||= [];
  state.feed ||= 0;
  state.halls ||= 0;
  state.rules ||= { gens: false, market: false, supply: false };
  state.world ||= { gen: 0, next: null, W: null, boost: {}, orders: [], dock: {} };
  if (ruleOn(state, "market") && !state.world.W) initMarket(state);
  // Orders saved before the monthly record existed still count this month.
  state.world.placed ||= state.world.orders.filter((o) => o.placed > state.day - 30).map((o) => ({ day: o.placed, n: o.n }));
  // Old saves never stored which rack a machine sits in. Lock in today's layout before a preview can disturb it.
  if (state.racks?.length && state.machines.some((m) => m.rackSlot === undefined && m.chassis && part("chassis", m.chassis).type === "rackmount")) rackPlan(state);
}

/** Refresh the derived numbers without advancing time, so the UI reacts the moment you click.
 *  `ignore` lifts a limit so situation() can price it: { power, network }. */
export function recompute(state, ignore = {}) {
  if (holdRecompute) return;
  fillDefaults(state);
  const running = state.tripped ? [] : state.machines.filter(isRunning);
  const liveRows = state.tripped ? [] : state.rows.filter((r) => r.on);
  const throttle = thermalThrottle(state.roomC);
  const need = fabricNeed(state);
  const netRatio = ignore.network || !need ? 1 : Math.min(1, fabricCapacity(state) / need);
  state.netRatio = netRatio;
  const supply = {};
  for (const m of state.machines) m.output = { tokS: 0, mtok: 0, wall: 0, fit: null };
  for (const r of state.rows) r.output = { tokS: 0, mtok: 0, wall: 0, fit: null };
  const earn = (2 * 86400 * earnMultiplier(state)) / 1e6;
  for (const m of [...running, ...liveRows]) {
    const training = m.task !== "serve";
    let tokS = 0;
    let fit = null;
    if (!training && m.modelId) {
      const model = allModels(state).find((x) => x.id === m.modelId);
      fit = model && modelFit(state, m, model, m.quant);
      if (fit && fit.fits) {
        tokS = fit.tokS * (m.tuned ? 0.94 : 1) * throttle * (m.sku ? netRatio : 1);
        // A batching server serves several streams at once even before the upgrades.
        const mtok = tokS * earn;
        m.output = { tokS, mtok, wall: 0, fit, model };
        (supply[model.tier] ||= []).push(m);
      }
    }
    m.output.fit = fit;
  }

  // Sell into each tier's market, contract first. Unsold capacity sits idle and draws less power.
  // c is how far the power contract lets racks run, so whatever it holds back never gets sold in the first place.
  const leased = hasTech(state, "lease");
  // In the living world a full market buys the best-priced tokens first, so each unit sells, and draws, for its own place in line.
  const ranked = rankedSales(state);
  for (const list of Object.values(supply)) {
    for (const m of list) m.output.rate = modelRate(state, m.output.model, m.quant);
    if (ranked) list.sort((a, b) => b.output.rate - a.output.rate);
  }
  const sellAt = (c) => {
    const out = {};
    for (const [tier, list] of Object.entries(supply)) {
      const total = list.reduce((n, m) => n + m.output.mtok * (m.sku ? c : 1), 0);
      const contract = state.contract && state.contract.tier === tier ? state.contract : null;
      const contractNeed = contract ? dealPerDay(contract, state.day) : 0;
      const demand = tierDemand(state, tier);
      const toContract = Math.min(total, contractNeed);
      const toApps = Math.min(total - toContract, appDemand(state, tier));
      const market = Math.min(total - toContract - toApps, demand);
      const util = total ? (toContract + toApps + market) / total : 0;
      let utilOf = null;
      if (ranked) {
        utilOf = new Map();
        let left = toContract + toApps + market;
        for (const m of list) {
          const made = m.output.mtok * (m.sku ? c : 1);
          const take = Math.min(made, left);
          left -= take;
          utilOf.set(m, made ? take / made : 0);
        }
      }
      out[tier] = { total, demand, contract, toContract, toApps, market, util, utilOf };
    }
    return out;
  };

  // Power: idle cards still draw, and the cooling counts against the same circuit.
  const spikeW = state.spike ? state.spike.watts : 0;
  const netW = state.tripped ? 0 : state.network.reduce((n, id) => n + part("network", id).watts, 0);
  const machineDraw = (m, util) => (dcLoad(m, false) * 0.35 + (dcLoad(m) - dcLoad(m, false) * 0.35) * util) / 0.92;
  // Racks split into what they burn sitting idle and what they burn working, in air and in water.
  const rackDraw = (r, util) => {
    const full = skuOf(r).kW * 1000 * r.racks * (r.tuned ? 0.8 : 1);
    const idle = full * 0.35;
    return { idle, work: (full - idle) * util };
  };
  const drawAt = (c) => {
    const sales = sellAt(c);
    const busy = (u) => (u.task !== "serve" || leased ? 1 : u.output.mtok ? sales[u.output.model.tier].utilOf?.get(u) ?? sales[u.output.model.tier].util : 0);
    let machineW = 0;
    let rackAir = 0;
    let rackWet = 0;
    if (!state.tripped) for (const m of state.machines) if (isRunning(m)) machineW += machineDraw(m, busy(m));
    for (const r of liveRows) {
      const { idle, work } = rackDraw(r, busy(r));
      const liquid = skuOf(r).liquid;
      rackAir += (idle + work) * c * (1 - liquid);
      rackWet += (idle + work) * c * liquid;
    }
    return { machineW, rackAir, rackWet };
  };
  const airCap = coolingCapacity(state);
  const wetCap = liquidCapacity(state);
  const airDraw = state.tripped ? 0 : state.cooling.reduce((n, id) => (by(COOLING, id).liquidW ? n : n + by(COOLING, id).drawW), 0);
  const wetDraw = state.tripped ? 0 : state.cooling.reduce((n, id) => (by(COOLING, id).liquidW ? n + by(COOLING, id).drawW : n), 0);
  const heatAt = (c) => {
    const d = drawAt(c);
    const air = d.machineW + netW + d.rackAir + Math.max(0, d.rackWet - wetCap);
    return { wet: Math.min(d.rackWet, wetCap), wetAll: d.rackWet, air };
  };
  // Cooling you own always draws its full power, busy or not.
  const coolDraw = airDraw + wetDraw;
  const wallAt = (c) => {
    const d = drawAt(c);
    return 150 + spikeW + d.machineW + netW + d.rackAir + d.rackWet + coolDraw;
  };
  // Racks have managed power strips: over the contract they slow down rather than trip. Machines don't, so they can still trip it.
  let capFactor = 1;
  const limitW = siteLimitW(state);
  const ceilingW = limitW * 0.995;
  if (liveRows.length && !ignore.power && wallAt(1) > ceilingW) {
    // Slowing racks can hand market share to machines, which then draw more, so draw isn't a straight line. Walk down to the fastest setting that fits, then refine.
    const steps = [...Array.from({ length: 31 }, (_, i) => (31 - i) / 32), 1 / 64, 1 / 128, 1 / 256];
    let lo = 0;
    let hi = 1;
    for (const c of steps) {
      if (wallAt(c) <= ceilingW) {
        lo = c;
        break;
      }
      hi = c;
    }
    if (lo > 0) {
      for (let i = 0; i < 7; i++) {
        const mid = (lo + hi) / 2;
        if (wallAt(mid) > ceilingW) hi = mid;
        else lo = mid;
      }
    }
    capFactor = lo;
  }
  state.capFactor = capFactor;
  const heat = heatAt(capFactor);
  const heatW = heat.air + heat.wet;
  const wall = wallAt(capFactor);
  for (const r of liveRows) {
    if (!r.output.model) continue;
    r.output.mtok *= capFactor;
    r.output.tokS *= capFactor;
  }

  // The production that's left is what gets sold, delivered and paid for.
  let revenue = 0;
  let mtok = 0;
  const sold = {};
  const sales = sellAt(1);
  if (ruleOn(state, "market") && state.world?.W) setMarket(state, sales);
  for (const [tier, list] of Object.entries(supply)) {
    const { total, demand, contract, toContract, toApps, market, util } = sales[tier];
    const appMult = APPS.find((a) => a.tier === tier)?.mult || 1;
    sold[tier] = { supply: total, demand, sold: toContract + toApps + market, toContract, toApps };
    const paid = market + toApps * appMult + toContract * (contract ? contract.rate : 1);
    for (const m of list) m.output.rate = modelRate(state, m.output.model, m.quant);
    if (ranked) {
      // The best-priced tokens sell first, so an old model can't crowd out a new one.
      const all = toContract + toApps + market;
      for (const m of list) {
        m.output.util = sales[tier].utilOf.get(m) ?? 0;
        m.output.revenue = all ? (paid / all) * m.output.mtok * m.output.util * m.output.rate : 0;
        revenue += m.output.revenue;
      }
    } else {
      for (const m of list) {
        const share = total ? m.output.mtok / total : 0;
        m.output.util = util;
        m.output.revenue = paid * share * m.output.rate;
        revenue += m.output.revenue;
      }
    }
    mtok += toContract + toApps + market;
  }
  // The rental desk: whatever cards buyers left idle earn about a third of their price a year.
  if (leased) {
    for (const u of [...running, ...liveRows]) {
      if (u.task !== "serve") continue;
      const cards = u.sku ? rackPrice(state, skuOf(u)) * u.racks * capFactor : u.gpus.reduce((n, g) => n + priceOf(state, "gpus", part("gpus", g.id)), 0);
      const rent = (cards / 1000) * (1 - (u.output.mtok ? (u.output.util ?? 0) * (u.output.fit?.used ?? 1) : 0));
      u.output.revenue = (u.output.revenue || 0) + rent;
      revenue += rent;
    }
  }
  const busyNow = (u) => (u.task !== "serve" || leased ? 1 : u.output.mtok ? u.output.util ?? 0 : 0);
  if (!state.tripped) for (const m of state.machines) if (isRunning(m)) m.output.wall = machineDraw(m, busyNow(m));
  for (const r of liveRows) {
    const { idle, work } = rackDraw(r, busyNow(r));
    r.output.idleW = idle;
    r.output.workW = work;
    r.output.wall = (idle + work) * capFactor;
  }

  const volts = site(state).volts;
  state.load = { machines: (wall - coolDraw - 150 - spikeW) / volts, cooling: coolDraw / volts, house: 150 / volts, spike: spikeW / volts };
  state.wallW = wall;
  state.heatW = heatW;
  state.amps = wall / volts;
  state.plant = { air: heat.air, airCap, wet: heat.wetAll, wetCap, coolDraw, pue: heatW > 0 ? (wall - 150 - spikeW) / heatW : 1 };
  const excess = Math.max(0, heat.air - airCap);
  state.targetC = state.ambient + (state.heatWave > 0 ? 9 : 0) + Math.min(39, excess / (site(state).heatRise || 70));

  // The 150 W house baseline shares the circuit but is not this company's bill.
  const powerPerDay = (Math.max(0, wall - 150 - spikeW) * 24 * state.centsPerKwh * (site(state).energy || 1) * (1 - researchBonus(state, "power"))) / 100000;
  const feed = currentFeed(state);
  const capacityPerDay = feed ? ((feed.amps * volts) / 1e6) * CAPACITY_PER_MW_DAY : 0;
  const supportPerDay = state.rows.reduce((n, r) => n + (skuOf(r).price * r.racks * SUPPORT_PER_YEAR) / 365, 0);
  const staffPerDay = salaryPerDay(state) + appsPerDay(state);
  state.stats = { revenuePerDay: revenue, powerPerDay, capacityPerDay, supportPerDay, staffPerDay, rentPerDay: site(state).rent, mtokPerDay: mtok, soldByTier: sold, profitPerDay: revenue - powerPerDay - capacityPerDay - supportPerDay - staffPerDay - site(state).rent };
}

// ---- The living world: three rules, each switchable on its own (DESIGN.md, "A living world") ----
export const RULES = [
  { id: "gens", name: "The frontier moves", text: "Once you run a data center, a new generation lands about every 600 days. Each brings a bigger frontier model and a faster rack. Older frontier models, yours included, sell for half their price per generation behind, and older racks cost less to buy and fetch less when sold." },
  { id: "market", name: "A living market", text: "Token prices come from supply and demand. Everyone else builds when prices run high and leaves slowly when they're low, and what you sell moves the price too." },
  { id: "supply", name: "Chips are allocated", text: "The newest rack comes in allocations: order before it ships to get it on day one, or after, and wait a month. Each month you can order about a tenth of the racks you run." },
];
export const ruleOn = (state, id) => !!state.rules?.[id];
/** Under any living-world rule, a full market buys the best-priced tokens first; classic splits buyers evenly. */
const rankedSales = (state) => ruleOn(state, "gens") || ruleOn(state, "market");
const GEN_DAYS = 600;
const ANNOUNCE_DAYS = 150;
const FIRST_GEN_DAYS = 200;
const MODEL_GROWTH = 1.4;
export const AGE_PRICE = 0.5;
const LEAD_DAYS = 30;
// Buyers everywhere, in MTok a day, against each size's base demand. Late in a run you can be a big slice of it.
const WORLD_SCALE = 170;
const ELASTICITY = 1.5;
const BUILD_RATE = 0.012;
const LEAVE_RATE = 0.002;
const WORLD_FLOOR = 0.15;
// Rubin Ultra and Feynman are real names on real roadmaps. Their numbers here, and everything after them, are made up.
const RACK_NAMES = [["Rubin Ultra NVL144", "Rubin Ultra"], ["Feynman NVL144", "Feynman"], ["Noether NVL144", "Noether"], ["Dirac NVL144", "Dirac"], ["Meitner NVL144", "Meitner"], ["Shannon NVL144", "Shannon"], ["Bohr NVL144", "Bohr"], ["Euler NVL144", "Euler"]];
const LABS = ["Halcyon", "Meridian", "Corvid", "Tessera", "Northstar", "Lattice"];
const genRacks = new Map();
const genModels = new Map();
/** The flagship rack generation g brings, as a catalog entry. Its id is all a save stores. */
export function genSku(id) {
  const g = typeof id === "number" ? id : Number(/^gen(\d+)-rack$/.exec(id || "")?.[1]);
  if (!(g >= 1)) return undefined;
  if (!genRacks.has(g)) {
    const [name, short] = RACK_NAMES[g - 1] || [`Gen ${g} NVL144`, `Gen ${g}`];
    genRacks.set(g, {
      id: `gen${g}-rack`, gen: g, name, short, vendor: "nvidia", art: "rack-rubin", cards: 144, domain: 144, liquid: 1, site: "datacenter",
      gb: Math.round(288 * Math.pow(1.5, g)), bandwidth: Math.round(22000 * Math.pow(1.5, g)), kW: Math.round(400 * Math.pow(1.1, g - 1)),
      fabricTb: Math.round(230.4 * Math.pow(1.4, g - 1) * 10) / 10, price: Math.round((21e6 * Math.pow(1.15, g - 1)) / 1e5) * 1e5,
      blurb: `Generation ${g}: 144 cards linked as one, each faster and roomier than the last generation's.`,
    });
  }
  return genRacks.get(g);
}
/** The frontier model generation g brings: an efficient sparse model like MiniMax M3, bigger every time, so it runs best on that generation's racks. */
export function genModel(g) {
  if (!genModels.has(g)) {
    const params = Math.round(428 * Math.pow(MODEL_GROWTH, g));
    const size = (k) => Math.round(params * k * 100) / 100;
    genModels.set(g, { id: `gen${g}-model`, name: `${LABS[(g - 1) % LABS.length]} ${g + 1}`, maker: LABS[(g - 1) % LABS.length], tier: "frontier", gen: g, params, active: Math.round(23 * Math.pow(MODEL_GROWTH, g)), moe: true, sizes: { Q2: size(0.336), Q4: size(0.619), Q8: size(1.06) }, goodAt: `generation ${g}'s frontier` });
  }
  return genModels.get(g);
}
/** One day of the generation's best rack, in training work. Generation 0's best is Vera Rubin. */
function flagshipPower(g) {
  const sku = g >= 1 ? genSku(g) : CATALOG.fleetRacks.find((x) => x.id === "vera-rubin-nvl72");
  return sku.cards * sku.bandwidth;
}
/** The generation a frontier training run started now would land in. */
export const targetGen = (state) => (state.world?.next?.told ? state.world.next.gen : state.world?.gen || 0);
const releasedModels = (gen) => Array.from({ length: gen }, (_, i) => genModel(i + 1));
function copyWorld(w) {
  if (!w) return w;
  return { ...w, next: w.next ? { ...w.next } : null, W: w.W ? { ...w.W } : null, boost: { ...w.boost }, orders: w.orders.map((o) => ({ ...o })), dock: { ...w.dock }, placed: [...(w.placed || [])] };
}

/** How many tokens of a size buyers everywhere want a day, at the normal price. */
export function worldDemand(state, tier) {
  return TIERS[tier].demand * WORLD_SCALE * (1 + state.day / 500) * (state.world?.boost?.[tier] || 1);
}
export const marketFactor = (state, tier) => (ruleOn(state, "market") ? state.marketF?.[tier] ?? 1 : 1);
/** Price follows buyers over everyone's supply, yours included. Contracts and your products aren't on the open market. */
function setMarket(state, sales) {
  const f = {};
  const view = {};
  for (const tier of Object.keys(TIERS)) {
    const M = worldDemand(state, tier);
    const W = state.world.W[tier] ?? M;
    const Y = sales[tier]?.market || 0;
    f[tier] = Math.min(3, Math.max(0.3, Math.pow(M / Math.max(1, W + Y), 1 / ELASTICITY)));
    view[tier] = { want: M, world: W, you: Y, factor: f[tier] };
  }
  state.marketF = f;
  state.marketView = view;
}
/** Start everyone else where today's prices already balance, so switching the market on changes nothing until something moves. */
function initMarket(state) {
  const W = {};
  for (const tier of Object.keys(TIERS)) {
    const v = state.stats?.soldByTier?.[tier];
    const yours = v ? Math.max(0, v.sold - (v.toContract || 0) - (v.toApps || 0)) : 0;
    let M = worldDemand(state, tier);
    // A company already bigger than the market it sells into gets a market its size, so nothing jumps.
    if (yours > (1 - WORLD_FLOOR) * M) {
      const grow = yours / (1 - WORLD_FLOOR) / M;
      state.world.boost = { ...state.world.boost, [tier]: (state.world.boost?.[tier] || 1) * grow };
      M *= grow;
    }
    W[tier] = Math.max(WORLD_FLOOR * M, M - yours);
  }
  state.world.W = W;
}

/** About a tenth of the racks you run, every month, and never fewer than four. */
export const allocation = (state) => state.world?.allot || Math.max(4, Math.round(totalRacks(state) * 0.1));
/** Only the newest rack is allocated, and the one announced after it. Everything older is in stock. */
export const isAllocated = (state, sku) => ruleOn(state, "supply") && !!sku?.gen && sku.gen >= (state.world?.gen || 0);
/** Racks of the allocated kind ordered in the last 30 days count against this month's share. */
export function allocationLeft(state) {
  const recent = (state.world?.placed || []).filter((o) => o.day > state.day - 30).reduce((n, o) => n + o.n, 0);
  return Math.max(0, allocation(state) - recent);
}
/** What can be ordered right now: the newest released rack, and the next one once it's announced. */
export function orderable(state) {
  const w = state.world;
  if (!ruleOn(state, "supply") || !w) return [];
  const list = [];
  if (w.gen >= 1 && siteAtLeast(state, "datacenter")) list.push({ sku: genSku(w.gen), ready: state.day + LEAD_DAYS, pre: false });
  if (w.next?.told && siteAtLeast(state, "datacenter")) list.push({ sku: genSku(w.next.gen), ready: w.next.lands, pre: true });
  return list;
}
export function orderRacks(state, skuId, n = 1) {
  const can = orderable(state).find((x) => x.sku.id === skuId);
  if (!can) return { ok: false, reason: "You can't order that rack right now." };
  if (n > allocationLeft(state)) return { ok: false, reason: `Your allocation this month has ${allocationLeft(state)} left.` };
  const cost = Math.round(can.sku.price * state.index.gpus) * n;
  if (state.cash < cost) return { ok: false, reason: `You need $${Math.ceil(cost - state.cash).toLocaleString("en-US")} more.` };
  state.cash -= cost;
  state.world.orders.push({ id: state.nextId++, sku: skuId, n, placed: state.day, ready: can.ready, paid: cost });
  // What you ordered this month counts against the allocation even after it arrives.
  state.world.placed = [...(state.world.placed || []).filter((o) => o.day > state.day - 30), { day: state.day, n }];
  say(state, `ORDERED ${n} ${can.sku.short.toUpperCase()} ${n === 1 ? "RACK" : "RACKS"}. ${can.pre ? "THEY SHIP ON LAUNCH DAY" : `THEY ARRIVE IN ${LEAD_DAYS} DAYS`}.`, "info");
  recompute(state);
  return { ok: true, ordered: true, ready: can.ready };
}
/** Racks that have arrived go straight in when there's room and money to cable them, or wait at the dock. */
function deliver(state, order) {
  const w = state.world;
  w.orders = w.orders.filter((o) => o !== order);
  const sku = genSku(order.sku);
  // A delivery never sells anything to make room, and never goes in where that rack can't run.
  const plan = siteAtLeast(state, sku.site) ? provisionPlan(state, sku, order.n) : null;
  const r = !plan ? { ok: false, reason: `It needs a ${by(SITES, sku.site).name.toLowerCase()}.` } : plan.retire.length ? { ok: false, reason: "There's no free floor without selling a machine." } : installRacks(state, sku, order.n, plan, 0);
  if (r.ok) say(state, `${order.n} ${sku.short.toUpperCase()} ${order.n === 1 ? "RACK" : "RACKS"} ARRIVED AND WENT IN.`, "good");
  else {
    w.dock[order.sku] = (w.dock[order.sku] || 0) + order.n;
    say(state, `${order.n} ${sku.short.toUpperCase()} ${order.n === 1 ? "RACK IS" : "RACKS ARE"} WAITING AT THE DOCK. ${r.reason.toUpperCase()}`, "bad");
  }
}
/** Install racks waiting at the dock. They're paid for; the room, cooling and switches aren't. */
export function installDock(state, skuId) {
  const n = state.world?.dock?.[skuId] || 0;
  if (!n) return { ok: false, reason: "Nothing is waiting at the dock." };
  const sku = genSku(skuId);
  if (!siteAtLeast(state, sku.site)) return { ok: false, reason: `${sku.short} racks need a ${by(SITES, sku.site).name.toLowerCase()}.` };
  const r = installRacks(state, sku, n, null, 0);
  if (r.ok) delete state.world.dock[skuId];
  return r;
}

/** Queue the next generation. Switched on in a running company, the first is announced at once; reached naturally, a new data center gets a full generation to grow first. */
function scheduleGen(state, first) {
  const w = state.world;
  w.next = { gen: w.gen + 1, lands: state.day + (first ? FIRST_GEN_DAYS : GEN_DAYS), told: false };
  if (first) announceGen(state);
}
function announceGen(state) {
  const w = state.world;
  w.next.told = true;
  // The allocation is set when a generation is announced, from the racks you run then, so buying more doesn't snowball it.
  w.allot = Math.max(4, Math.round(state.rows.reduce((n, r) => n + (r.on ? r.racks : 0), 0) * 0.1));
  const sku = genSku(w.next.gen);
  const model = genModel(w.next.gen);
  say(state, `${sku.name.toUpperCase()} ANNOUNCED. IT SHIPS IN ${Math.round(w.next.lands - state.day)} DAYS WITH ${model.name.toUpperCase()}, A BIGGER FRONTIER MODEL.${ruleOn(state, "supply") ? " ORDERS ARE OPEN." : ""}`, "info");
}
function landGen(state) {
  const w = state.world;
  w.gen = w.next.gen;
  w.next = null;
  const sku = genSku(w.gen);
  const model = genModel(w.gen);
  // Preorders ship on launch day, whenever that turns out to be.
  for (const o of w.orders) if (genSku(o.sku).gen === w.gen) o.ready = Math.min(o.ready, state.day);
  if (ruleOn(state, "market") && w.W) {
    // New things to build bring buyers, and half the world's racks can't keep up with the new model yet.
    w.boost = { ...w.boost, frontier: (w.boost.frontier || 1) * 1.1 };
    w.W.frontier *= 0.5;
  }
  say(state, `GENERATION ${w.gen}: ${model.name.toUpperCase()} IS THE NEW FRONTIER AND ${sku.short.toUpperCase()} SHIPS. OLDER FRONTIER MODELS NOW SELL FOR ${Math.round(AGE_PRICE * 100)}% OF WHAT THEY DID.`, "bad");
  scheduleGen(state, false);
}
function worldTick(state, dt) {
  const w = state.world;
  if (!w) return;
  if (ruleOn(state, "gens")) {
    if (!w.next && siteAtLeast(state, "datacenter")) scheduleGen(state, false);
    if (w.next && !w.next.told && state.day >= w.next.lands - ANNOUNCE_DAYS) announceGen(state);
    if (w.next && state.day >= w.next.lands) landGen(state);
  }
  if (ruleOn(state, "market") && w.W) {
    const grow = 1 / (500 + state.day);
    for (const tier of Object.keys(TIERS)) {
      const f = state.marketF?.[tier] ?? 1;
      const rate = grow + BUILD_RATE * Math.max(0, f - 1) - LEAVE_RATE * Math.max(0, 1 - f);
      w.W[tier] = Math.max(WORLD_FLOOR * worldDemand(state, tier), w.W[tier] * Math.exp(rate * dt));
    }
  }
  for (const o of w.orders.filter((x) => x.ready <= state.day)) deliver(state, o);
}
/** The weaker half of what's serving, by earnings per kilowatt: what a new model costs least to train on. */
export function weakerHalf(state) {
  const kw = (u) => (u.sku ? skuOf(u).kW * u.racks : dcLoad(u) / 1000) || 1;
  const units = allUnits(state).filter((u) => u.task === "serve" && (u.sku ? u.on : isRunning(u)) && u.output?.mtok);
  units.sort((a, b) => (a.output.revenue || 0) / kw(a) - (b.output.revenue || 0) / kw(b));
  return units.slice(0, Math.ceil(units.length / 2));
}
/** Days a training run would take on these units at today's speed. */
export function trainingDays(state, kind, units) {
  const spec = trainingSpec(state, kind);
  const power = units.reduce((n, u) => n + (u.sku ? skuOf(u).cards * skuOf(u).bandwidth * u.racks * (state.capFactor ?? 1) : u.gpus.reduce((k, g) => k + part("gpus", g.id).bandwidth, 0)), 0);
  const speed = power * thermalThrottle(state.roomC) * (1 + researchBonus(state, "training"));
  return speed ? spec.work / speed : Infinity;
}
/** Your newest frontier model, and how far behind the frontier it is. */
export function ownFrontier(state) {
  const mine = allModels(state).filter((m) => m.own && m.tier === "frontier");
  return mine.sort((a, b) => (b.gen || 0) - (a.gen || 0) || b.premium - a.premium)[0] || null;
}
/** Switch one rule. Turning one off puts its part of the game back the way it was. */
export function setRule(state, id, on) {
  const w = state.world;
  state.rules = { ...state.rules, [id]: !!on };
  if (id === "gens") {
    if (on && !w.next && siteAtLeast(state, "datacenter")) scheduleGen(state, true);
    if (!on) {
      // The clock stops. Racks ordered for a generation that now won't come are refunded.
      const unreleased = w.orders.filter((o) => genSku(o.sku).gen > w.gen);
      for (const o of unreleased) state.cash += o.paid;
      w.orders = w.orders.filter((o) => !unreleased.includes(o));
      w.next = null;
    }
  }
  if (id === "market" && on) initMarket(state);
  if (id === "supply" && !on) for (const o of w.orders.filter((x) => genSku(x.sku).gen <= w.gen)) deliver(state, o);
  recompute(state);
  say(state, `${by(RULES, id).name.toUpperCase()}: ${on ? "ON" : "OFF"}.`, "info");
  return { ok: true };
}

// ---- The fleet: racks bought and run by the row ----
export const RACKS_PER_ROW = 8;
/** Each generation behind the newest knocks 28% off what a rack costs and what it sells for. It stays knocked off if the rule is switched off, so switching can't mint money. */
const genDiscount = (state, sku) => Math.pow(0.72, Math.max(0, (state.world?.gen || 0) - (sku.gen || 0)));
export const rackPrice = (state, sku) => Math.round(sku.price * state.index.gpus * genDiscount(state, sku));
export const skuAvailable = (state, sku) => siteAtLeast(state, sku.site) && (sku.gen || 0) <= (state.world?.gen || 0);
/** Every rack on sale: the catalog, then one more for each generation that has landed. */
export const fleetRacks = (state) => [...CATALOG.fleetRacks, ...Array.from({ length: state.world?.gen || 0 }, (_, i) => genSku(i + 1))];
/** What the status page may suggest buying outright: on sale here, and not waiting on an allocation. */
const instantRacks = (state, s = state) => fleetRacks(state).filter((x) => skuAvailable(s, x) && !isAllocated(state, x));

/** What it takes to run n more racks: extra halls, cooling and switches, chosen the cheap way. Power is never included; it takes time. */
export function provisionPlan(state, sku, n) {
  const here = site(state);
  const plan = { halls: 0, retire: [], refund: 0, cooling: [], network: [], cost: 0, problem: null };
  const spots = floorUsed(state) + n - floorLimit(state);
  if (spots > 0) {
    if (!here.hall) {
      // No more building to fit out, so the oldest, smallest earners make room.
      const old = state.machines.filter((m) => m.chassis && !m.forDeal && part("chassis", m.chassis).type !== "rackmount").sort((a, b) => (a.output?.revenue || 0) - (b.output?.revenue || 0));
      if (old.length < spots) plan.problem = `Only ${Math.max(0, floorLimit(state) - floorUsed(state))} floor spots are free in the ${here.name.toLowerCase()}.`;
      else {
        plan.retire = old.slice(0, spots).map((m) => m.id);
        plan.refund = old.slice(0, spots).reduce((t, m) => t + machineResale(state, m), 0);
      }
    } else {
      plan.halls = Math.ceil(spots / here.hall.floor);
      plan.cost += plan.halls * here.hall.cost;
    }
  }
  let tb = fabricNeed(state) + sku.fabricTb * n - fabricCapacity(state);
  let netW = state.network.reduce((t, id) => t + part("network", id).watts, 0);
  const switches = CATALOG.network.filter((x) => siteAtLeast(state, x.site)).sort((a, b) => a.tb - b.tb);
  while (tb > 0 && switches.length) {
    const sw = switches.find((x) => x.tb >= tb) || switches.at(-1);
    plan.network.push(sw.id);
    plan.cost += sw.price;
    netW += sw.watts;
    tb -= sw.tb;
  }
  const fullW = sku.kW * 1000 * n;
  // Fill whichever loop this rack needs, assuming everything runs flat out, but only as much as the contract can actually run.
  const wetAll = fullW * sku.liquid + state.rows.reduce((t, r) => t + skuOf(r).kW * 1000 * r.racks * skuOf(r).liquid, 0);
  const airAll = fullW * (1 - sku.liquid) + state.rows.reduce((t, r) => t + skuOf(r).kW * 1000 * r.racks * (1 - skuOf(r).liquid), 0);
  const machineW = state.machines.reduce((t, m) => t + (m.output?.wall || 0), 0);
  let drawBudget = siteLimitW(state) * 0.995 - 150 - machineW - netW - state.cooling.reduce((t, id) => t + by(COOLING, id).drawW, 0);
  const runnable = Math.min(1, Math.max(0, drawBudget) / Math.max(1, wetAll + airAll));
  let wet = wetAll * runnable - liquidCapacity(state);
  let air = airAll * runnable + machineW + netW - coolingCapacity(state);
  const wetKit = COOLING.filter((c) => c.liquidW && coolingAvailable(state, c)).sort((a, b) => a.cost / a.liquidW - b.cost / b.liquidW)[0];
  // Cooling always draws its full power, so never let it eat the whole contract.
  const spendDraw = (kit) => {
    if (kit.drawW > drawBudget * 0.5) return false;
    drawBudget -= kit.drawW;
    plan.cooling.push(kit.id);
    plan.cost += kit.cost;
    return true;
  };
  const kitBonus = 1 + researchBonus(state, "cooling");
  while (wet > 0 && wetKit && spendDraw(wetKit)) wet -= wetKit.liquidW * kitBonus;
  const airKits = COOLING.filter((c) => c.coolW >= 60000 && coolingAvailable(state, c)).sort((a, b) => a.coolW - b.coolW);
  while (air > 0 && airKits.length) {
    const kit = airKits.find((c) => c.coolW * kitBonus >= air) || airKits.at(-1);
    if (!spendDraw(kit)) break;
    air -= kit.coolW * kitBonus;
  }
  return plan;
}

/** Buy n racks with whatever floor, cooling and network they need. Partial rows of the same rack fill up first. */
export function buyRacks(state, skuId, n = 1, chosenPlan = null) {
  const sku = part("fleetRacks", skuId);
  if (!sku) return { ok: false, reason: "That rack isn't for sale." };
  if (isAllocated(state, sku)) return orderRacks(state, skuId, n);
  if (!skuAvailable(state, sku)) return { ok: false, reason: `${sku.name} needs a ${by(SITES, sku.site).name.toLowerCase()}. It's too much for this site.` };
  return installRacks(state, sku, n, chosenPlan, rackPrice(state, sku) * n);
}
/** Put n racks on the floor, paying `rackCost` for them plus whatever floor, cooling and switches they need. */
function installRacks(state, sku, n, chosenPlan, rackCost) {
  const skuId = sku.id;
  const plan = chosenPlan || provisionPlan(state, sku, n);
  if (plan.problem) return { ok: false, reason: plan.problem };
  const cost = rackCost + plan.cost - plan.refund;
  if (state.cash < cost) return { ok: false, reason: `You need $${Math.ceil(cost - state.cash).toLocaleString("en-US")} more.` };
  state.cash -= cost + plan.refund;
  for (const id of plan.retire) sellMachine(state, id);
  state.halls += plan.halls;
  state.cooling.push(...plan.cooling);
  state.network.push(...plan.network);
  let left = n;
  for (const r of state.rows) {
    if (r.sku !== skuId || r.racks >= RACKS_PER_ROW || left <= 0) continue;
    const add = Math.min(left, RACKS_PER_ROW - r.racks);
    r.racks += add;
    left -= add;
  }
  while (left > 0) {
    const add = Math.min(left, RACKS_PER_ROW);
    const tuned = state.rows.some((r) => r.tuned);
    state.rows.push({ id: state.nextId++, name: `Row ${state.rows.length + 1}`, sku: skuId, racks: add, modelId: null, quant: "Q4", on: true, tuned, task: "serve", output: { tokS: 0, mtok: 0, wall: 0, fit: null } });
    left -= add;
  }
  renameRows(state);
  optimizeModels(state);
  return { ok: true };
}
function renameRows(state) {
  state.rows.forEach((r, i) => { r.name = `Row ${i + 1}`; });
}
export function sellRack(state, rowId, n = 1) {
  const r = state.rows.find((x) => x.id === rowId);
  if (!r) return { ok: false, reason: "That row is gone." };
  const count = Math.min(n, r.racks);
  const sku = skuOf(r);
  state.cash += Math.round(rackPrice(state, sku) * (sku.used ? 0.55 : 0.65)) * count;
  r.racks -= count;
  if (r.racks <= 0) state.rows = state.rows.filter((x) => x !== r);
  renameRows(state);
  recompute(state);
  return { ok: true };
}
export function setAllRows(state, field, value) {
  for (const r of state.rows) r[field] = value;
  recompute(state);
}
export function buyNetwork(state, id) {
  const sw = part("network", id);
  if (!siteAtLeast(state, sw.site)) return { ok: false, reason: `${sw.name} needs a bigger site first.` };
  if (state.cash < sw.price) return { ok: false, reason: `You need $${Math.ceil(sw.price - state.cash).toLocaleString("en-US")} more.` };
  const fixedW = state.network.reduce((n, x) => n + part("network", x).watts, 0) + coolingDraw(state) + 150;
  if (fixedW + sw.watts > siteLimitW(state) * 0.995) return { ok: false, reason: `Your switches and cooling would use your whole power contract. Sell some or order more power first.` };
  state.cash -= sw.price;
  state.network.push(id);
  recompute(state);
  return { ok: true };
}
export function sellNetwork(state, id) {
  const i = state.network.indexOf(id);
  if (i < 0) return { ok: false, reason: "You don't own one of those." };
  state.network.splice(i, 1);
  state.cash += Math.round(part("network", id).price * 0.5);
  recompute(state);
  return { ok: true };
}
export function buyHall(state) {
  const hall = site(state).hall;
  if (!hall) return { ok: false, reason: "This site can't grow." };
  if (state.cash < hall.cost) return { ok: false, reason: `You need $${Math.ceil(hall.cost - state.cash).toLocaleString("en-US")} more.` };
  state.cash -= hall.cost;
  state.halls += 1;
  recompute(state);
  return { ok: true };
}
/** More power takes time. Pay now, and the feed energizes when the utility gets to it. */
export function orderFeed(state) {
  const next = nextFeed(state);
  if (!next) return { ok: false, reason: "This site's contract can't go any higher." };
  if (state.feedOrder) return { ok: false, reason: "One order at a time. The utility is already on it." };
  if (state.cash < next.cost) return { ok: false, reason: `You need $${Math.ceil(next.cost - state.cash).toLocaleString("en-US")} more.` };
  state.cash -= next.cost;
  state.feedOrder = { index: (state.feed || 0) + 1, ready: state.day + next.days };
  say(state, `NEW FEED ORDERED. THE UTILITY SAYS ${next.days} DAYS. THE UTILITY ALWAYS SAYS THAT.`, "info");
  return { ok: true };
}

export function buyTech(state, id) {
  const t = by(TECH, id);
  if (hasTech(state, id)) return { ok: false, reason: "You already have this." };
  if (!techAvailable(state, t)) return { ok: false, reason: "That needs a bigger site first." };
  if (state.cash < t.cost) return { ok: false, reason: `You need $${(t.cost - Math.floor(state.cash)).toLocaleString()} more.` };
  state.cash -= t.cost;
  state.tech.push(id);
  recompute(state);
  return { ok: true };
}
export const techAvailable = (state, t) => !t.site || siteAtLeast(state, t.site);
export const coolingAvailable = (state, c) => !c.site || siteAtLeast(state, c.site);
export function buyCooling(state, id) {
  const c = by(COOLING, id);
  if (!coolingAvailable(state, c)) return { ok: false, reason: `${c.name} needs a bigger site first.` };
  if (state.cash < c.cost) return { ok: false, reason: `You need $${(c.cost - Math.floor(state.cash)).toLocaleString()} more.` };
  state.cash -= c.cost;
  state.cooling.push(id);
  recompute(state);
  return { ok: true };
}
export function sellCooling(state, id) {
  const i = state.cooling.indexOf(id);
  if (i < 0) return { ok: false, reason: "You don't own that." };
  state.cooling.splice(i, 1);
  state.cash += Math.round(by(COOLING, id).cost * 0.5);
  recompute(state);
  return { ok: true };
}
/** What moving up really costs: the site, plus any halls needed to stand up everything you already own. */
export function moveCost(state) {
  const next = nextSite(state);
  if (!next) return 0;
  const over = Math.max(0, floorUsed(state) - next.floor);
  return next.cost + (over && next.hall ? Math.ceil(over / next.hall.floor) * next.hall.cost : 0);
}
export function moveSite(state) {
  const next = nextSite(state);
  if (!next) return { ok: false, reason: "There's nowhere bigger to go." };
  // Everything you own moves too, so fit out enough halls at the new place to stand it all up.
  const over = Math.max(0, floorUsed(state) - next.floor);
  if (over && !next.hall) return { ok: false, reason: `The ${next.name.toLowerCase()} only has ${next.floor} floor spots.` };
  const halls = over ? Math.ceil(over / next.hall.floor) : 0;
  const cost = next.cost + (over ? halls * next.hall.cost : 0);
  if (state.cash < cost) return { ok: false, reason: `You need $${(cost - Math.floor(state.cash)).toLocaleString()} more.` };
  state.cash -= cost;
  installOrdered(state);
  state.site = next.id;
  state.spike = null;
  state.feed = 0;
  state.feedOrder = null;
  state.halls = halls;
  state.curtail = null;
  say(state, `Moved to the ${next.name.toLowerCase()}. ${next.note}`, "good");
  recompute(state);
  return { ok: true };
}

export const previousSite = (state) => SITES[SITES.indexOf(site(state)) - 1] || null;
/** Moving down is free, so an expensive move can always be undone if the machines still fit. */
export function moveBack(state) {
  const prev = previousSite(state);
  if (!prev) return { ok: false, reason: "This is the smallest place there is." };
  if (floorUsed(state) > prev.floor) return { ok: false, reason: `The ${prev.name.toLowerCase()} only has ${prev.floor} floor spots.` };
  installOrdered(state);
  state.site = prev.id;
  state.feed = 0;
  state.feedOrder = null;
  state.halls = 0;
  state.curtail = null;
  say(state, `Moved back to the ${prev.name.toLowerCase()}.`, "info");
  recompute(state);
  return { ok: true };
}

export function resetBreaker(state) {
  if (!state.tripped) return;
  state.tripped = false;
  say(state, "You flip the breaker back on. The fans spin up.", "info");
  recompute(state);
  if (state.amps >= limitAmps(state)) trip(state);
}
function trip(state, fault = null) {
  state.lastTrip = { day: state.day, total: state.amps, limit: limitAmps(state), ...state.load, spikeName: state.spike ? state.spike.name || "an appliance" : null, fault };
  state.tripped = true;
  state.trips += 1;
  state.rep = Math.max(0.05, state.rep - 0.05);
  say(state, fault ? `${fault.toUpperCase()} EVERYTHING IS OFF. CUSTOMERS NOTICED.` : `BREAKER TRIPPED AT ${powerText(state, state.amps).toUpperCase()}. EVERYTHING IS OFF. CUSTOMERS NOTICED.`, "bad");
  recompute(state);
}

/** Deals pace themselves to finish a day early, so a company that keeps up always delivers. */
export function dealPerDay(deal, day) {
  const left = deal.endsDay === undefined ? deal.days : deal.endsDay - day;
  return Math.max(0, deal.mtok - (deal.done || 0)) / Math.max(0.25, left - 1);
}
/** Everything a player needs to judge a deal: what it needs, what you make, and what winning or missing does. */
export function dealView(state, deal, madeAfter = null) {
  const left = deal.endsDay === undefined ? deal.days : Math.max(0, deal.endsDay - state.day);
  const done = deal.done || 0;
  const made = madeAfter ?? (state.stats.soldByTier?.[deal.tier]?.supply || 0);
  const units = allUnits(state).filter((u) => isRunning(u) && u.output?.model?.tier === deal.tier);
  const buyers = (rep) => 0.45 + rep * 1.6;
  return {
    left, done, made,
    need: Math.max(0, deal.mtok - done) / Math.max(0.001, left),
    units: units.map((u) => u.name),
    enough: done + made * left >= deal.mtok,
    finish: Math.min(1, (done + made * left) / Math.max(1, deal.mtok)),
    winRep: 4,
    loseRep: 8,
    buyersLost: 1 - buyers(Math.max(0.05, state.rep - 0.08)) / buyers(state.rep),
  };
}
/** What taking this offer does to profit a day, with what you run today. */
export function dealGain(state) {
  if (!state.offer) return { gain: 0, made: 0 };
  const copy = JSON.parse(JSON.stringify(state));
  copy.spike = null;
  copy.tripped = false;
  settle(copy);
  const before = copy.stats.profitPerDay;
  copy.contract = null;
  acceptContract(copy);
  settle(copy);
  return { gain: copy.stats.profitPerDay - before, made: copy.stats.soldByTier?.[copy.contract.tier]?.supply || 0, trips: copy.amps >= limitAmps(copy) };
}
/** What's being made right now, model by model, and on what. Your own models show even when nothing runs them. */
export function production(state) {
  const rows = new Map();
  const add = (model) => {
    if (!rows.has(model.id)) rows.set(model.id, { model, own: state.ownModels.some((x) => x.id === model.id), mtok: 0, sold: 0, revenue: 0, units: [] });
    return rows.get(model.id);
  };
  for (const u of allUnits(state)) {
    const o = u.output;
    if (!isRunning(u) || u.task !== "serve" || !o?.model) continue;
    const r = add(o.model);
    r.mtok += o.mtok;
    r.sold += o.mtok * (o.util ?? 0);
    r.revenue += o.revenue || 0;
    r.units.push(u);
  }
  for (const m of state.ownModels) add(m);
  const list = [...rows.values()].sort((a, b) => b.revenue - a.revenue || b.mtok - a.mtok);
  return { list, mtok: list.reduce((n, r) => n + r.mtok, 0), sold: list.reduce((n, r) => n + r.sold, 0), revenue: list.reduce((n, r) => n + r.revenue, 0), busy: allUnits(state).filter((u) => isRunning(u) && u.task !== "serve") };
}
/** Machines and racks that could switch to this deal's size: what each would add, and what it earns today. Cheapest move first. */
export function dealCandidates(state, deal) {
  const out = [];
  const models = allModels(state).filter((x) => x.tier === deal.tier);
  for (const u of allUnits(state)) {
    if (!isRunning(u) || u.task !== "serve" || u.forDeal) continue;
    const already = u.output?.model?.tier === deal.tier ? u.output.mtok : 0;
    let best = null;
    for (const model of models) {
      for (const quant of Object.keys(model.sizes)) {
        const e = estimateEarn(state, u, model, quant);
        if (e.fit.fits && e.fit.mode !== "spill" && (!best || e.mtok > best.mtok)) best = { modelId: model.id, modelName: model.name, quant, mtok: e.mtok, perDay: e.perDay };
      }
    }
    // A machine already on this size only helps if a faster setting makes meaningfully more.
    if (!best || best.mtok <= already * 1.05) continue;
    const earns = u.output?.revenue || 0;
    out.push({ id: u.id, name: u.name, lost: already ? Math.max(0, earns - best.perDay) : earns, add: best.mtok - already, ...best });
  }
  return out.sort((a, b) => a.lost / Math.max(1e-9, a.add) - b.lost / Math.max(1e-9, b.add));
}
function giveToDeal(state, move) {
  const u = unitById(state, move.id);
  if (!u.forDeal) u.dealBack = { modelId: u.modelId, quant: u.quant };
  u.modelId = move.modelId;
  u.quant = move.quant;
  u.forDeal = true;
}
/** The fewest machines that make a deal work, tried on a copy so the power contract and buyers are counted. */
export function dealPlan(state, deal) {
  const candidates = dealCandidates(state, deal);
  const copy = JSON.parse(JSON.stringify(state));
  copy.spike = null;
  copy.tripped = false;
  settle(copy);
  const baseline = copy.stats.profitPerDay;
  if (!copy.contract) {
    copy.offer = deal;
    acceptContract(copy);
  }
  settle(copy);
  const moves = [];
  let view = dealView(copy, copy.contract);
  let trips = false;
  for (const move of candidates.slice(0, 40)) {
    if (view.enough) break;
    giveToDeal(copy, move);
    settle(copy);
    if (copy.amps >= limitAmps(copy)) {
      trips = true;
      moves.push(move);
      break;
    }
    moves.push(move);
    view = dealView(copy, copy.contract);
  }
  return { moves, enough: view.enough && !trips, trips, finish: view.finish, made: view.made, gain: copy.stats.profitPerDay - baseline, candidates };
}
/** Let the room warm up to where it's heading, since a hot room slows everything down. */
function settle(state) {
  recompute(state);
  for (let i = 0; i < 4; i++) {
    state.roomC = state.targetC;
    recompute(state);
  }
}
/** What this deal's size will really make once the room settles, and whether the breaker holds. */
export function dealForecast(state) {
  const copy = JSON.parse(JSON.stringify(state));
  copy.spike = null;
  copy.tripped = false;
  settle(copy);
  return { made: copy.contract ? copy.stats.soldByTier?.[copy.contract.tier]?.supply || 0 : 0, trips: copy.amps >= limitAmps(copy) };
}
/** Point these machines at the deal. They stay on it until it ends, then go back to what they ran. */
export function assignToDeal(state, moves) {
  // The picture may have changed since these were offered: only running machines free to serve can be given.
  const usable = moves.filter((move) => {
    const u = unitById(state, move.id);
    return u && isRunning(u) && u.task === "serve";
  });
  if (!usable.length) return { ok: false, reason: "Those machines aren't free any more." };
  for (const move of usable) giveToDeal(state, move);
  recompute(state);
  return { ok: true, given: usable.length };
}
export function takeBackFromDeal(state, id) {
  restoreFromDeal(state, unitById(state, id));
  recompute(state);
  return { ok: true };
}
function restoreFromDeal(state, u) {
  const back = u.dealBack;
  const model = back && allModels(state).find((x) => x.id === back.modelId);
  // Parts may have changed during the deal, so go back only if the old model still fits.
  if (model && modelFit(state, u, model, back.quant).fits) {
    u.modelId = back.modelId;
    u.quant = back.quant;
  }
  u.forDeal = false;
  u.dealBack = null;
}
function releaseDealUnits(state) {
  for (const u of allUnits(state)) if (u.forDeal) restoreFromDeal(state, u);
}
export function acceptContract(state) {
  if (!state.offer || state.contract) return;
  const o = state.offer;
  state.contract = { ...o, done: 0, endsDay: state.day + o.days };
  state.offer = null;
}
export function declineContract(state) {
  state.offer = null;
}

export function startProject(state, kind, machineIds) {
  const spec = trainingSpec(state, kind);
  const machines = allUnits(state).filter((m) => machineIds.includes(m.id) && isRunning(m));
  if (!machines.some((m) => totalVram(m) >= spec.minVram)) return { ok: false, reason: `One running machine needs ${spec.minVram} GB of GPU memory to start.` };
  state.project = { kind, work: 0, need: spec.work, gen: spec.gen, sizeGB: spec.sizeGB };
  for (const m of machines) m.task = kind;
  say(state, `${spec.name}: started. Those machines stop earning until it's done.`, "good");
  recompute(state);
  return { ok: true };
}
export function cancelProject(state) {
  for (const m of allUnits(state)) m.task = "serve";
  state.project = null;
  recompute(state);
}
export function finishModel(state, name) {
  const p = state.pendingName;
  if (!p) return;
  const spec = trainingSpec(state, p.kind, p.gen);
  const clean = String(name).trim().slice(0, 28) || "Untitled";
  // The model is what the run was started for: its size and generation, whatever has changed since.
  const size = p.sizeGB ?? spec.sizeGB;
  state.ownModels.push({ id: `own-${state.nextId++}`, name: clean, maker: "You", tier: spec.tier, params: size * 2, active: null, moe: false, sizes: { Q4: size }, goodAt: "whatever you trained it to do", premium: spec.premium, kind: p.kind, own: true, gen: p.gen ?? (state.world?.gen || 0) });
  say(state, `${clean.toUpperCase()} IS LIVE. YOU MADE YOUR OWN AI.`, "good");
  state.pendingName = null;
  recompute(state);
}

const MILESTONES = [
  { id: "first-upgrade", text: "A second GPU", test: (s) => s.machines.some((m) => m.gpus.length > 1) },
  { id: "mtok-1k", text: "1,000 MTok served", test: (s) => s.served >= 1000 },
  { id: "tier-medium", text: "Serving a medium model", test: (s) => s.machines.some((m) => m.output.model?.tier === "medium") },
  { id: "tier-large", text: "Serving a large model", test: (s) => s.machines.some((m) => m.output.model?.tier === "large") },
  { id: "mtok-1m", text: "One trillion tokens served", test: (s) => s.served >= 1e6 },
  { id: "tier-frontier", text: "Serving a frontier model", test: (s) => s.machines.some((m) => m.output.model?.tier === "frontier") },
  { id: "own-tune", text: "Fine-tuned your own model", test: (s) => s.ownModels.some((m) => m.tier === "medium") },
  { id: "own-train", text: "Trained your own AI", test: (s) => s.ownModels.some((m) => m.tier === "frontier") },
  { id: "first-rack", text: "A whole rack at once", test: (s) => s.rows.length > 0 },
  { id: "cards-1k", text: "A thousand GPUs", test: (s) => totalCards(s) >= 1000 },
  { id: "own-dc", text: "Back to fifteen amps, at 138,000 volts", test: (s) => siteAtLeast(s, "datacenter") },
  { id: "mw-10", text: "Ten megawatts on the meter", test: (s) => s.wallW >= 1e7 },
  { id: "mw-100", text: "A hundred megawatts on the meter", test: (s) => s.wallW >= 1e8 },
  { id: "own-frontier", text: "Trained a frontier-scale model", test: (s) => s.ownModels.some((m) => m.premium >= TRAINING.frontier.premium) },
];

function events(state, dt) {
  const r = () => rng(state);
  const chance = (perYear) => r() < (perYear / 365) * dt;
  const tiers = Object.keys(TIERS);
  if (chance(9)) {
    const candidates = CATALOG.models;
    const model = candidates[Math.floor(r() * candidates.length)];
    state.deflation[model.tier] = Math.max(0.55, state.deflation[model.tier] * 0.98);
    say(state, `${model.name.toUpperCase()} GETS A NEW RELEASE. ${TIERS[model.tier].name.toUpperCase()} TOKEN PRICES DOWN 2%.`, "bad");
  }
  if (chance(2.2)) {
    const k = r() < 0.5 ? "memory" : "gpus";
    const up = r() < 0.55;
    state.index[k] = Math.min(1.6, Math.max(0.6, state.index[k] * (up ? 1.18 : 0.84)));
    say(state, `${k === "gpus" ? "GPU" : "MEMORY"} PRICES ${up ? "UP" : "DOWN"} ${up ? "18" : "16"}%. ${up ? "SHORTAGE TALK AGAIN." : "A LITTLE RELIEF."}`, up ? "bad" : "good");
  }
  if (chance(1.4) && state.heatWave <= 0) {
    state.heatWave = 10;
    say(state, "HEAT WAVE. THE ROOM IS NINE DEGREES WARMER FOR TEN DAYS.", "bad");
  }
  if (chance(0.5)) {
    state.centsPerKwh *= 1.03;
    say(state, `YOUR UTILITY RAISES RATES AGAIN. NOW ${state.centsPerKwh.toFixed(1)} CENTS A KILOWATT-HOUR.`, "bad");
  }
  if (!state.spike && state.day > 45 && site(state).shared && chance(6)) {
    const list = [["the vacuum", "SOMEONE PLUGGED IN THE VACUUM", 1100], ["the toaster", "SOMEONE IS MAKING TOAST", 950], ["the microwave", "THE MICROWAVE IS ON", 1050], ["the space heater", "THE SPACE HEATER IS ON", APPLIANCE_MAX_W]];
    const [name, text, watts] = list[Math.floor(r() * list.length)];
    state.spike = { name, watts, until: state.day + 3 };
    say(state, `${text}. THAT'S ANOTHER ${(watts / site(state).volts).toFixed(1)} AMPS ON YOUR CIRCUIT.`, "bad");
  }
  if (chance(2.5)) {
    const tier = tiers[Math.floor(r() * tiers.length)];
    state.surge[tier] = { mult: 1.6, until: state.day + 14 };
    say(state, `${TIERS[tier].name.toUpperCase()} MODELS GO VIRAL. DEMAND UP 60% FOR TWO WEEKS.`, "good");
  }
  if (site(state).feeds && !state.tripped) {
    if (!state.curtail && chance(1.5)) {
      state.curtail = { frac: 0.2, until: state.day + 5 };
      say(state, "GRID EMERGENCY. THE UTILITY CUTS YOUR CONTRACT 20% FOR FIVE DAYS.", "bad");
    }
    if (chance(0.4)) {
      trip(state, "A squirrel got into the substation.");
    }
  }
  // Used cards die more often, and heat makes it worse. Racks have a support contract, so this is only machines.
  for (const m of state.machines) {
    if (!isRunning(m) || state.tripped) continue;
    for (let i = m.gpus.length - 1; i >= 0; i--) {
      const c = part("gpus", m.gpus[i].id);
      const hot = state.roomC > 32 ? 1 + (state.roomC - 32) * 0.35 : 1;
      if (chance((c.used ? 0.06 : 0.01) * hot)) {
        m.gpus.splice(i, 1);
        say(state, `THE ${c.name.toUpperCase()} IN ${m.name.toUpperCase()} DIED. ${c.used ? "USED CARDS DO THAT." : "BAD LUCK."}`, "bad");
        if (!m.gpus.length) m.modelId = null;
        else autoLoad(state, m);
      }
    }
  }
  if (!state.offer && !state.contract && chance(8)) {
    const canServe = [...new Set(allUnits(state).map((m) => m.output.model?.tier).filter(Boolean))];
    if (canServe.length) {
      const tier = canServe[Math.floor(r() * canServe.length)];
      const rate = 1.5 + r();
      const days = 30 + Math.floor(r() * 40);
      const clients = ["A law firm", "A hospital group", "A shipping company", "A game studio", "A city government", "A bank", "A logistics startup"];
      // Sized to what you make of that size today: most fit as you are, and some ask you to move more machines over.
      const supply = state.stats.soldByTier?.[tier]?.supply || state.stats.mtokPerDay || 1;
      state.offer = { client: clients[Math.floor(r() * clients.length)], tier, rate: Math.round(rate * 10) / 10, days, mtok: Math.ceil(supply * days * (0.4 + r() * 0.75)), bonus: 0, expires: state.day + 90 };
      say(state, `${state.offer.client.toUpperCase()} WANTS A PRIVATE DEAL.`, "good");
    }
  }
}

export function tick(state, dt = 1) {
  // Near a deal's deadline, step finely and land on the deadline, so fast speed can't deliver late or pay for more than was asked.
  const left = state.contract ? state.contract.endsDay - state.day : Infinity;
  if (left <= dt + 1 && (dt > 0.25 || dt > left) && left > 0) {
    let rest = dt;
    while (rest > 1e-9) {
      const untilDeal = state.contract ? state.contract.endsDay - state.day : Infinity;
      const step = Math.min(rest, 0.25, untilDeal > 1e-9 ? untilDeal : 0.25);
      tickStep(state, step);
      rest -= step;
    }
    return;
  }
  tickStep(state, dt);
}
function tickStep(state, dt) {
  if (state.pendingName) return;
  growApps(state, dt);
  researchOf(state).points += pointsPerDay(state) * dt;
  state.day += dt;
  worldTick(state, dt);
  const yearly = 0.97;
  for (const t of Object.keys(state.deflation)) state.deflation[t] = Math.max(0.55, state.deflation[t] * Math.pow(yearly, dt / 365));
  for (const k of Object.keys(state.index)) state.index[k] += (1 - state.index[k]) * 0.002 * dt;
  for (const [t, s] of Object.entries(state.surge)) if (s.until <= state.day) delete state.surge[t];
  if (state.heatWave > 0) state.heatWave -= dt;
  if (state.spike && state.spike.until <= state.day) state.spike = null;
  if (state.curtail && state.curtail.until <= state.day) state.curtail = null;
  if (state.feedOrder && state.feedOrder.ready <= state.day) {
    installOrdered(state);
    state.feed = state.feedOrder.index;
    state.feedOrder = null;
    say(state, `NEW FEED ENERGIZED. ${powerText(state, currentFeed(state).amps).toUpperCase()} UNDER CONTRACT.`, "good");
  }

  recompute(state);
  state.roomC += (state.targetC - state.roomC) * Math.min(1, 0.35 * dt);

  const s = state.stats;
  state.cash += s.profitPerDay * dt;
  state.served += s.mtokPerDay * dt;
  state.earned += s.revenuePerDay * dt;

  const ratio = state.amps / limitAmps(state);
  if (!state.tripped) {
    if (ratio >= 1) trip(state);
    const noiseOver = noiseLevel(state) - site(state).noise;
    if (noiseOver > 0 && rng(state) < 0.02 * dt) {
      const fine = Math.round(60 * noiseOver);
      state.cash -= fine;
      say(state, `THE NEIGHBORS COMPLAINED ABOUT THE NOISE. THAT'S $${fine}.`, "bad");
    }
    state.rep = Math.min(1, state.rep + 0.0009 * dt);
  } else {
    state.rep = Math.max(0.05, state.rep - 0.0015 * dt);
  }

  if (state.contract) {
    const sold = s.soldByTier[state.contract.tier];
    const made = (sold?.toContract || 0) * dt;
    const credit = Math.min(made, Math.max(0, state.contract.mtok - state.contract.done));
    state.contract.done += credit;
    // The last delivery can run past what was asked. The extra sells at market price, not the deal's.
    if (made > credit) {
      // Priced at the average rate of what that size sold, so the order of machines can't change it.
      const units = allUnits(state).filter((u) => u.output?.model?.tier === state.contract.tier && u.output.mtok);
      const volume = units.reduce((n, u) => n + u.output.mtok * (u.output.util ?? 1), 0);
      const avg = volume ? units.reduce((n, u) => n + u.output.mtok * (u.output.util ?? 1) * (u.output.rate || 0), 0) / volume : 0;
      state.cash -= (made - credit) * avg * (state.contract.rate - 1);
    }
    if (state.contract.done >= state.contract.mtok) {
      say(state, `${state.contract.client.toUpperCase()} DEAL DELIVERED. REPUTATION UP.`, "good");
      state.rep = Math.min(1, state.rep + 0.04);
      state.contract = null;
      releaseDealUnits(state);
    } else if (state.day >= state.contract.endsDay) {
      say(state, `YOU MISSED THE ${state.contract.client.toUpperCase()} DEADLINE. REPUTATION DOWN.`, "bad");
      state.rep = Math.max(0.05, state.rep - 0.08);
      state.contract = null;
      releaseDealUnits(state);
    }
  }
  if (state.offer && state.day >= state.offer.expires) state.offer = null;

  if (state.project && !state.tripped) {
    const power = state.machines.filter((m) => m.task !== "serve" && isRunning(m)).reduce((n, m) => n + m.gpus.reduce((k, g) => k + part("gpus", g.id).bandwidth, 0), 0)
      + state.rows.filter((r) => r.task !== "serve" && r.on).reduce((n, r) => n + skuOf(r).cards * skuOf(r).bandwidth * r.racks, 0) * (state.capFactor ?? 1);
    state.project.work += power * thermalThrottle(state.roomC) * (1 + researchBonus(state, "training")) * dt;
    if (state.project.work >= state.project.need) {
      state.pendingName = { kind: state.project.kind, gen: state.project.gen, sizeGB: state.project.sizeGB };
      for (const m of allUnits(state)) m.task = "serve";
      state.project = null;
    }
  }

  events(state, dt);
  for (const m of MILESTONES) {
    if (!state.milestones.includes(m.id) && m.test(state)) {
      state.milestones.push(m.id);
      say(state, `MILESTONE: ${m.text.toUpperCase()}.`, "good");
    }
  }
  recompute(state);
}

export { MILESTONES };
