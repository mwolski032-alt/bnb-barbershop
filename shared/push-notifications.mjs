/**
 * @param {{
 *   supported: boolean,
 *   permission: "default" | "denied" | "granted",
 *   optedOut?: boolean,
 *   tokenActive?: boolean,
 * }} context
 */
export const resolvePushDeviceStatus = ({
  supported,
  permission,
  optedOut = false,
  tokenActive = false,
}) => {
  if (!supported) return "unsupported";
  if (permission === "denied") return "blocked";
  if (permission !== "granted" || optedOut) return "disabled";
  return tokenActive ? "enabled" : "disabled";
};
