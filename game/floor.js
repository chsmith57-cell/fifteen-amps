// The floor: where everything stands in the room picture, chosen so that everything stays in sight, and what's under the pointer.
// No DOM here, so tools/floor_check.mjs can test the same layout the game draws.
import { SPRITES } from "./sprites.js";

// Where each floor's diamond sits in its picture, as percentages: top, right, bottom and left corners.
export const WORLD = {
  closet: { art: "world-closet", t: [50, 39.5], r: [93.7, 61.5], b: [50.6, 94], l: [7.3, 61.5], max: 32 },
  spare: { art: "world-spare", t: [50, 33], r: [96, 58], b: [50.4, 91], l: [4, 58], max: 28 },
  garage: { art: "world-garage", t: [50, 36.5], r: [90.6, 60.4], b: [51, 91.7], l: [9.4, 60.4], max: 25 },
  cage: { art: "world-cage", t: [50, 29], r: [92, 56], b: [50, 88], l: [7, 56], max: 22 },
  warehouse: { art: "world-warehouse", t: [50, 27.5], r: [97, 60], b: [51, 94], l: [3, 60], max: 13 },
  datacenter: { art: "world-datacenter", t: [50, 24], r: [97, 53], b: [50.4, 90.6], l: [3, 53], max: 11 },
  campus: { art: "world-campus", t: [50, 25], r: [97, 52], b: [51, 84], l: [4, 51], max: 9 },
};
const COOL_SPRITE = { fan: "iso-fan", window: "iso-window", split: "iso-split", crac: "iso-crac", immersion: "iso-immersion", cdu: "iso-cdu", chiller: "iso-chiller" };
// Everything should show at least this much of itself. A row of racks counts once: one good look at any of its cabinets is enough.
export const MIN_VISIBLE = 0.5;
export const ROOMY_VISIBLE = 0.85;
const CELL = 0.5; // Percent of the room per test cell.
const GRID = Math.round(100 / CELL);

export function spriteOf(it) {
  if (it.kind === "machine") return it.frame ? "iso-frame" : "iso-tower";
  if (it.kind === "rack") return "iso-rack";
  if (it.kind === "row") return it.liquid ? "iso-cabinet-water" : "iso-cabinet-air";
  if (it.kind === "cool") return COOL_SPRITE[it.cool] || "iso-crac";
  if (it.kind === "net") return "iso-switch";
  return null;
}
const SERVER_BOTTOM = (i, units) => 14 + i * (72 / Math.max(3, units / 4));
export const serverBottom = SERVER_BOTTOM;
const LEFT = 0.22;
const SPAN = 0.56;

/** The picture's box on the floor, in percent of the room. The foot sits 82% of the way down the picture. */
export function boxOf(it) {
  const s = SPRITES[spriteOf(it)];
  const h = it.width * s.a;
  return { x0: it.x - it.width / 2, y0: it.y - 0.82 * h, w: it.width, h };
}
function solidAt(it, fx, fy) {
  const s = SPRITES[spriteOf(it)];
  const row = s.m[Math.min(s.m.length - 1, Math.floor(fy * s.m.length))];
  if (row && row[Math.min(row.length - 1, Math.floor(fx * row.length))] === "1") return true;
  if (it.kind !== "rack") return false;
  // The machines inside a rack count as the rack.
  const server = SPRITES["iso-server"];
  const tall = (SPAN * server.a) / s.a;
  for (let i = 0; i < it.servers; i++) {
    const bottom = 1 - SERVER_BOTTOM(i, it.units) / 100;
    if (fx >= LEFT && fx <= LEFT + SPAN && fy <= bottom && fy >= bottom - tall) return true;
  }
  return false;
}
const drawOrder = (items) => items.map((it, i) => [it, i]).filter(([it]) => it.kind !== "empty" && !it.off).sort((a, b) => a[0].z - b[0].z || a[1] - b[1]);

/** How much of each thing you can really see, by id, painting them in draw order. */
export function visibility(items) {
  const top = new Int32Array(GRID * GRID).fill(-1);
  const order = drawOrder(items);
  const total = new Array(order.length).fill(0);
  order.forEach(([it], k) => {
    const b = boxOf(it);
    for (let gy = Math.max(0, Math.floor(b.y0 / CELL)); gy < GRID && gy * CELL < b.y0 + b.h; gy++) {
      const fy = (gy * CELL + CELL / 2 - b.y0) / b.h;
      if (fy < 0 || fy >= 1) continue;
      for (let gx = Math.max(0, Math.floor(b.x0 / CELL)); gx < GRID && gx * CELL < b.x0 + b.w; gx++) {
        const fx = (gx * CELL + CELL / 2 - b.x0) / b.w;
        if (fx < 0 || fx >= 1 || !solidAt(it, fx, fy)) continue;
        top[gy * GRID + gx] = k;
        total[k]++;
      }
    }
  });
  const seen = new Array(order.length).fill(0);
  for (const k of top) if (k >= 0) seen[k]++;
  const out = {};
  order.forEach(([it], k) => { out[it.id] = total[k] ? seen[k] / total[k] : 0; });
  return out;
}
function worstVisible(items) {
  const seen = visibility(items);
  const rows = {};
  let worst = 1;
  for (const it of items) {
    if (it.kind === "empty") continue;
    if (it.kind === "row") rows[it.rowId] = Math.max(rows[it.rowId] || 0, seen[it.id]);
    else worst = Math.min(worst, seen[it.id]);
  }
  for (const v of Object.values(rows)) worst = Math.min(worst, v);
  return worst;
}

/** What's under the pointer: the frontmost thing actually drawn there, or failing that the closest box. */
export function pickItem(items, px, py, selected = null) {
  const inBox = (it) => {
    if (it.kind === "empty") return Math.hypot(px - it.x, py - it.y) <= Math.max(2, it.width * 0.3);
    const b = boxOf(it);
    return px >= b.x0 && px < b.x0 + b.w && py >= b.y0 && py < b.y0 + b.h;
  };
  const order = items.filter((it) => !it.off).map((it, i) => [it, i]).sort((a, b) => (b[0].id === selected) - (a[0].id === selected) || b[0].z - a[0].z || b[1] - a[1]);
  for (const [it] of order) {
    if (it.kind === "empty" || !inBox(it)) continue;
    const b = boxOf(it);
    if (solidAt(it, (px - b.x0) / b.w, (py - b.y0) / b.h)) return it;
  }
  for (const [it] of order) if (it.kind === "empty" && inBox(it)) return it;
  // Between a frame's posts, say: nothing is drawn there, but you meant the thing around it.
  for (const [it] of order) if (it.kind !== "empty" && inBox(it)) return it;
  return null;
}

function arrange(things, kit, world, wanted) {
  const at = (u, v) => [0, 1].map((i) => world.t[i] * (1 - u) * (1 - v) + world.r[i] * u * (1 - v) + world.l[i] * (1 - u) * v + world.b[i] * u * v);
  const count = things.length;
  // Tall things go to the back, so they can't hide what's behind them.
  const tallFirst = things.map((t, i) => [t, i]).sort((a, b) => SPRITES[spriteOf(b[0])].a - SPRITES[spriteOf(a[0])].a || a[1] - b[1]).map(([t]) => t);
  const first = Math.max(1, Math.ceil(Math.sqrt(count)));
  const sizes = count > 30 ? [first, first + 1] : [first, first + 1, first + 2, first + 3];
  const fronts = count > 30 ? [0.22] : [0.22, 0.3, 0.38];
  let best = null;
  for (const n of sizes) {
    for (const lo of fronts) {
      const span = 0.97 - lo;
      const cells = [];
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) cells.push({ i, j, u: n === 1 ? 0.58 : lo + ((i + 0.5) / n) * span, v: n === 1 ? 0.58 : lo + ((j + 0.5) / n) * span });
      // Fill the band across the middle of the room first: things side by side can't cover each other.
      cells.sort((a, b) => Math.abs(a.i + a.j - (n - 1)) - Math.abs(b.i + b.j - (n - 1)) || a.i - b.i);
      const used = cells.slice(0, count).sort((a, b) => a.i + a.j - (b.i + b.j) || a.i - b.i);
      const across = (world.r[0] - world.l[0]) / n;
      for (const factor of [1, 0.85, 0.7, 0.58, 0.48, 0.4, 0.32, 0.25]) {
        const width = Math.min(world.max, across * factor);
        const placed = tallFirst.map((t, k) => {
          const [x, y] = at(used[k].u, used[k].v);
          return { ...t, x, y, width, z: Math.round((used[k].u + used[k].v) * 100) + 10 };
        });
        const worst = worstVisible([...placed, ...kit]);
        // A room with space to spare has no excuse for things overlapping much.
        const good = worst >= (count <= 12 ? ROOMY_VISIBLE : MIN_VISIBLE);
        const better = !best || (good && !best.good) || (good && best.good && (width > best.width + 1e-6 || (Math.abs(width - best.width) < 1e-6 && worst > best.worst))) || (!good && !best.good && worst > best.worst);
        if (better) best = { good, worst, width, placed, across };
        if (good) break;
      }
    }
  }
  return best;
}

/** Free spots get a + where it can be seen and clicked: clear of whatever is standing there. */
function spareSpots(placed, kit, world, want, size) {
  if (want <= 0) return [];
  const at = (u, v) => [0, 1].map((i) => world.t[i] * (1 - u) * (1 - v) + world.r[i] * u * (1 - v) + world.l[i] * (1 - u) * v + world.b[i] * u * v);
  const solid = [...placed, ...kit];
  const out = [];
  const coarse = Math.max(3, Math.ceil(Math.sqrt(want + placed.length)) + 1);
  // A tight room may only have gaps a finer search can find.
  for (const [n, room] of [[coarse, 0.45], [coarse * 2, 0.3], [coarse * 3, 0.15]]) {
    const cells = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) cells.push({ i, j, u: 0.1 + ((i + 0.5) / n) * 0.87, v: 0.1 + ((j + 0.5) / n) * 0.87 });
    cells.sort((a, b) => Math.abs(a.i + a.j - (n - 1)) - Math.abs(b.i + b.j - (n - 1)) || a.i - b.i);
    for (const c of cells) {
      if (out.length >= want) return out;
      const [x, y] = at(c.u, c.v);
      const covered = solid.some((it) => {
        const b = boxOf(it);
        return x >= b.x0 && x < b.x0 + b.w && y >= b.y0 && y < b.y0 + b.h && solidAt(it, (x - b.x0) / b.w, (y - b.y0) / b.h);
      });
      const crowded = [...placed, ...out.map(([ox, oy]) => ({ x: ox, y: oy }))].some((it) => Math.hypot(it.x - x, it.y - y) < size * room);
      if (!covered && !crowded) out.push([x, y, (c.u + c.v) * 100]);
    }
    if (out.length) return out;
  }
  return out;
}
/** A remembered selection survives the pictures being redrawn: a row's picture stands for the whole row. */
export function findItem(items, id) {
  if (id === null || id === undefined) return null;
  const exact = items.find((x) => x.id === id);
  if (exact) return exact;
  const rowId = typeof id === "string" && id.includes("-") ? Number(id.split("-")[0]) : null;
  return rowId !== null ? items.find((x) => x.kind === "row" && x.rowId === rowId) || null : null;
}
/** Things stand along the two back walls and across the floor. Layout is remembered until what you own changes. */
const remembered = new Map();
export function floorItems(state, G) {
  const world = WORLD[state.site] || WORLD.garage;
  const at = (u, v) => [0, 1].map((i) => world.t[i] * (1 - u) * (1 - v) + world.r[i] * u * (1 - v) + world.l[i] * (1 - u) * v + world.b[i] * u * v);
  const things = [];
  const off = [];
  for (const m of state.machines) {
    // An unfinished machine has nothing to stand on the floor yet, but it's still yours to reach.
    if (!m.chassis) {
      off.push({ kind: "machine", id: m.id, m, name: `${m.name}, not built yet`, off: true });
      continue;
    }
    const type = G.part("chassis", m.chassis).type;
    if (type !== "rackmount") things.push({ kind: "machine", id: m.id, m, name: m.name, frame: type === "open-frame" });
  }
  G.rackPlan(state).forEach((r) => things.push({ kind: "rack", id: `rack${r.index}`, plan: r, name: `${r.units}U rack, ${r.machines.length} ${r.machines.length === 1 ? "machine" : "machines"}`, servers: r.machines.length, units: r.units }));
  const totalRacks = state.rows.reduce((n, r) => n + r.racks, 0);
  // A big hall can't draw every cabinet, so past 64 racks each picture stands for several.
  const scale = Math.max(1, Math.ceil(totalRacks / 64));
  for (const r of state.rows) {
    const copies = Math.max(1, Math.round(r.racks / scale));
    for (let i = 0; i < copies; i++) things.push({ kind: "row", id: `${r.id}-${i}`, rowId: r.id, row: r, name: r.name, liquid: !!G.skuOf(r).liquid, scale });
  }
  const shown = things.slice(0, 100);
  const limit = Math.ceil(G.floorLimit(state) / scale);
  const wanted = Math.max(shown.length, Math.min(limit, shown.length + 12));
  const coolKinds = [...new Set(state.cooling)];
  const netKinds = [...new Set(state.network || [])];
  const coolW = Math.min(13, world.max * 0.6, 44 / (coolKinds.length + 1));
  const netW = Math.min(11, world.max * 0.5, 44 / (netKinds.length + 1));
  const kit = [];
  coolKinds.forEach((id, i) => {
    const [x, y] = at(0.04, 0.12 + (i + 0.5) * (0.8 / Math.max(coolKinds.length, 3)));
    kit.push({ kind: "cool", id: `cool-${id}`, cool: id, count: state.cooling.filter((c) => c === id).length, name: G.COOLING.find((c) => c.id === id).name, x, y, z: 5 + i, width: coolW });
  });
  netKinds.forEach((id, i) => {
    const [x, y] = at(0.12 + (i + 0.5) * (0.8 / Math.max(netKinds.length, 3)), 0.04);
    kit.push({ kind: "net", id: `net-${id}`, net: id, count: (state.network || []).filter((c) => c === id).length, name: G.part("network", id).name, x, y, z: 5 + i, width: netW });
  });
  const key = JSON.stringify([state.site, wanted, shown.map((t) => [t.id, spriteOf(t), t.servers, t.units]), kit.map((t) => t.id)]);
  let plan = remembered.get(key);
  if (!plan) {
    plan = shown.length ? arrange(shown, kit, world, wanted) : { placed: [], width: world.max, across: world.r[0] - world.l[0] };
    plan.spare = spareSpots(plan.placed, kit, world, wanted - shown.length, plan.width);
    if (remembered.size > 40) remembered.clear();
    remembered.set(key, plan);
  }
  const fresh = new Map(shown.map((t) => [t.id, t]));
  const items = plan.placed.map((p) => ({ ...fresh.get(p.id), x: p.x, y: p.y, z: p.z, width: p.width }));
  plan.spare.forEach(([x, y, depth], i) => items.push({ kind: "empty", id: `empty${i}`, name: "Empty floor spot", x, y, z: Math.round(depth) + 10, width: Math.min(world.max, plan.across * 0.6) }));
  // Past what a picture can show, rows and machines stay in the list, so everything you own can always be reached.
  const pictured = new Set(shown.filter((t) => t.kind === "row").map((t) => t.rowId));
  for (const t of things.slice(shown.length)) {
    if (t.kind === "row" && pictured.has(t.rowId)) continue;
    if (t.kind === "row") pictured.add(t.rowId);
    off.push({ ...t, off: true });
  }
  return [...items, ...kit, ...off];
}
