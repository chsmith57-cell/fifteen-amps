// Works out the advice off the page's thread, so the game never waits on it: the moves worth a look, what bringing machines
// up to your best would do, the best machine for each size of model, what one more hire would add, and what a deal is worth.
// It gets a copy of the game and sends back plain numbers and words, the moves first since they're what the page shows
// first; every click is still checked and done on the page, by id.
import * as G from "./engine.js";

let latest = 0;
// JSON can't carry Infinity, and "pays back never" is Infinity, so mark it and let the page restore it.
const send = (msg) => self.postMessage(JSON.parse(JSON.stringify(msg, (k, v) => (v === Infinity ? "∞" : v === -Infinity ? "-∞" : v))));

self.onmessage = (event) => {
  const { seq, state, machineId } = event.data;
  latest = seq;
  try {
    G.recompute(state);
    send({ seq, phase: "moves", moves: G.nextMoves(state, machineId) });
  } catch (err) {
    self.postMessage({ seq, error: String(err?.stack || err) });
    return;
  }
  // Let a newer request jump the queue: if one is waiting, this game is already out of date.
  setTimeout(() => {
    if (seq !== latest) return;
    try {
      const match = state.machines.length > 1 ? G.matchPlan(state) : null;
      const tier = {};
      for (const t of ["small", "medium", "large", "frontier"]) tier[t] = G.tierBuild(state, t);
      const team = {};
      for (const t of G.TEAM) team[t.id] = G.teamQuote(state, t.id);
      const deals = { offer: state.offer ? G.dealAdvice(state, state.offer, true) : null, contract: state.contract ? G.dealAdvice(state, state.contract, false) : null };
      if (seq === latest) send({ seq, phase: "rest", match, tier, team, deals });
    } catch (err) {
      self.postMessage({ seq, error: String(err?.stack || err) });
    }
  }, 0);
};
