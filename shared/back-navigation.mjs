// Makes the phone's system Back button (Android) and the browser Back button walk back through
// the app's screens instead of leaving the site.
//
// Model: the UI reports a list of "levels" (innermost first), each with `active` and `close`.
// Several parts of the UI may report their own list (a "group"); groups with a higher priority are
// treated as more inner. 
// `depth` is the number of active levels. History holds one entry per level, labelled with
// its position (`state.bnbNav`). Pressing Back lands on an entry whose label is smaller than the
// depth, so the controller closes the extra levels. When the UI closes a level by itself (an X
// button), the now surplus entries are removed with history.go(). The booking wizard keeps
// its own entry (`state.bnbWizard`) and the controller stays out of its way while it is open.

const PENDING_POP_MS = 700;

const labelOf = (state) => (typeof state?.bnbNav === "number" ? state.bnbNav : 0);

/**
 * env: { history, setTimeout, now }. `history` follows the browser History API.
 * Returns { update, onPopState, expectPop }. `update(next, group, priority)` replaces one group.
 */
export function createBackController(env) {
  const { history } = env;
  const groups = new Map(); // name -> { levels, suspended, priority }
  let levels = [];
  let depth = 0;
  let suspended = false;
  // Expiry times of popstate events that our own history.go() calls will cause.
  const expected = [];

  // While one of our own history.go() calls is still travelling, nothing may issue another one:
  // two overlapping go(-1) calls would walk past the app's first entry and leave the site.
  let travellingUntil = 0;
  const isTravelling = () => env.now() < travellingUntil;
  const expectPop = () => { expected.push(env.now() + PENDING_POP_MS); };
  const travel = (delta) => {
    expectPop();
    travellingUntil = env.now() + PENDING_POP_MS;
    history.go(delta);
  };
  const consumeExpectedPop = () => {
    const now = env.now();
    while (expected.length && expected[0] < now) expected.shift();
    return expected.shift() !== undefined;
  };

  const reconcile = () => {
    if (suspended || isTravelling()) return;
    const state = history.state;
    if (state?.bnbWizard) return; // the wizard's entry is on top; its owner removes it
    const current = labelOf(state);
    if (depth > current) {
      for (let label = current + 1; label <= depth; label += 1) history.pushState({ bnbNav: label }, "");
    } else if (depth < current) {
      travel(depth - current);
    }
  };

  const recompute = () => {
    const ordered = [...groups.values()].sort((a, b) => b.priority - a.priority);
    levels = ordered.flatMap((entry) => entry.levels);
    suspended = ordered.some((entry) => entry.suspended);
    depth = suspended ? 0 : levels.reduce((count, level) => count + (level.active ? 1 : 0), 0);
    reconcile();
  };

  const update = (next, group = "default", priority = 0) => {
    groups.set(group, { levels: next.levels, suspended: Boolean(next.suspended), priority });
    recompute();
  };

  // A part of the UI that unmounts must stop contributing levels.
  const remove = (group) => {
    if (groups.delete(group)) recompute();
  };

  const onPopState = (event) => {
    if (consumeExpectedPop()) {
      travellingUntil = 0;
      env.setTimeout(reconcile, 0);
      return;
    }
    if (suspended || event.state?.bnbWizard) return;
    const target = labelOf(event.state);
    if (target < depth) {
      let remaining = depth - target;
      for (const level of levels) {
        if (remaining <= 0) break;
        if (level.active) { level.close(); remaining -= 1; }
      }
      // A refused close (for example while saving) leaves the screen open: restore its entry.
      env.setTimeout(reconcile, 120);
    } else if (target > depth) {
      // Forward navigation or a leftover entry: step back to where the screen actually is.
      if (!isTravelling()) travel(depth - target);
    }
  };

  return { update, remove, onPopState, expectPop };
}
