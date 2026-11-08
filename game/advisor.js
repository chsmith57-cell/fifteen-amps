// Works out the advice off the page's thread, so the game never waits on it: the moves worth a look, what bringing machines
// up to your best would do, the best machine for each size of model, what one more hire would add, and what a deal is worth. It gets a copy of the
// game, and sends back plain numbers and words; every click is still checked and done on the page, by id.
import * as G from "./engine.js";

self.onmessage = (event) => {
  const { seq, state, machineId } = event.data;
  try {
    G.recompute(state);
    const moves = G.nextMoves(state, machineId);
    const match = state.machines.length > 1 ? G.matchPlan(state) : null;
    const tier = {};
    for (const t of ["small", "medium", "large", "frontier"]) tier[t] = G.tierBuild(state, t);
    const team = {};
    for (const t of G.TEAM) team[t.id] = G.teamQuote(state, t.id);
    const deals = { offer: state.offer ? G.dealAdvice(state, state.offer, true) : null, contract: state.contract ? G.dealAdvice(state, state.contract, false) : null };
    // Functions can't cross to the page; a JSON round trip leaves only the data.
    self.postMessage(JSON.parse(JSON.stringify({ seq, moves, match, tier, team, deals })));
  } catch (err) {
    self.postMessage({ seq, error: String(err?.stack || err) });
  }
};
