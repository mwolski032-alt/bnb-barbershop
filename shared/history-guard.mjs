// vinext reacts to every `popstate` by fetching React Server Component data for the current address.
// This site is a static export with a single address and no such data, so that fetch fails and vinext
// falls back to a hard reload of the page. Going back in history (including the phone's Back button and
// the booking wizard's own steps) would therefore restart the whole app. History traversals inside this
// single page never need a framework navigation, so they are answered with a no-op.

export const FRAMEWORK_NAVIGATE = "__VINEXT_RSC_NAVIGATE__";

// The framework calls navigate(href, redirectDepth, navigationKind, ...): kind "traverse" is a history move.
const isTraversal = (rest) => rest[1] === "traverse";

const guard = (original) => {
  if (typeof original !== "function" || original.bnbGuarded) return original;
  const guarded = (href, ...rest) => (isTraversal(rest) ? Promise.resolve() : original(href, ...rest));
  guarded.bnbGuarded = true;
  return guarded;
};

/** Wraps the framework's navigate function now, or the moment the framework assigns it. */
export function guardHistoryTraversal(target) {
  if (typeof target[FRAMEWORK_NAVIGATE] === "function") {
    target[FRAMEWORK_NAVIGATE] = guard(target[FRAMEWORK_NAVIGATE]);
    return;
  }
  let current = target[FRAMEWORK_NAVIGATE];
  Object.defineProperty(target, FRAMEWORK_NAVIGATE, {
    configurable: true,
    get: () => current,
    set: (value) => { current = guard(value); },
  });
}