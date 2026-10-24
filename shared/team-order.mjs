/** The shop's first barber account, from before barbers were added by e-mail: always listed first. */
const founderId = "mateusz";

/**
 * Team entries ([id, member] pairs) in the order people joined: the founder first, then oldest to newest.
 * Firebase hands objects back sorted by key, which would put the barbers in alphabetical order.
 */
export const orderTeamEntries = (entries) =>
  [...entries].sort(([firstId, first], [secondId, second]) => {
    if (firstId === founderId || secondId === founderId) return firstId === founderId ? -1 : 1;
    const joined = (member) => Number(member?.createdAt) || Number(member?.invitedAt) || 0;
    return joined(first) - joined(second) || firstId.localeCompare(secondId);
  });
