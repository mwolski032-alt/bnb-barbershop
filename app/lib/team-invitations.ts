export type TeamInviteMember = {
  name: string;
  email: string;
  access: Record<"schedule" | "clients" | "analytics" | "work" | "services" | "profile", boolean>;
};

type TeamInvitationResult = {
  ok: boolean;
  error?: string;
  memberId?: string;
};

const callTeamInvitationFunction = async (
  idToken: string,
  payload: Record<string, unknown>,
): Promise<TeamInvitationResult> => {
  const response = await fetch("/.netlify/functions/team-invitations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const result = (await response.json().catch(() => null)) as TeamInvitationResult | null;

  if (!response.ok || !result?.ok) {
    return { ok: false, error: result?.error ?? "Nie udało się obsłużyć zaproszenia." };
  }

  return result;
};

export const createTeamInvitation = (idToken: string, member: TeamInviteMember) =>
  callTeamInvitationFunction(idToken, { action: "create", member });

export const resendTeamInvitation = (idToken: string, barberId: string) =>
  callTeamInvitationFunction(idToken, { action: "resend", barberId });

export const claimTeamInvitation = (
  idToken: string,
  barberId: string,
  inviteToken: string,
) => callTeamInvitationFunction(idToken, { action: "claim", barberId, inviteToken });
