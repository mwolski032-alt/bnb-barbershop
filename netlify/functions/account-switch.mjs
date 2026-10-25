import {
  createCustomToken,
  getAccessToken,
  jsonResponse,
  readDatabase,
  readDatabaseQuery,
  verifyRequestUser,
  writeDatabase,
} from "./_firebase-admin.mjs";

export const config = {
  path: "/api/account-switch",
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] },
};

const MAX_LINKED_ACCOUNTS = 5;
const safeKey = (uid) => /^[A-Za-z0-9_-]{1,128}$/.test(uid);

// The owner can pair their own other accounts (for example the barber account they work under) so one
// device can switch between them without signing out. A pair is only created after the owner has signed
// in to the second account too, and every switch is checked against the stored pairs on the server.
const resolveGroup = async (user, accessToken) => {
  const [owner, allLinks] = await Promise.all([readDatabase("team/owner", accessToken), readDatabase("accountLinks", accessToken)]);
  const ownerUid = owner?.active === true ? String(owner.userId ?? "") : "";
  const links = (ownerUid && allLinks?.[ownerUid]) || {};
  if (ownerUid && user.uid === ownerUid) return { ownerUid, isOwner: true, links };
  if (ownerUid && user.uid !== "_owner" && links[user.uid]) return { ownerUid, isOwner: false, links };
  return { ownerUid: "", isOwner: false, links: {} };
};

const describe = async (uid, record, ownerUid, accessToken) => {
  const assigned = uid === ownerUid ? null : await readDatabaseQuery("team/barbers", { orderBy: "userId", equalTo: uid }, accessToken).catch(() => null);
  const match = Object.entries(assigned ?? {}).find(([, member]) => member?.userId === uid);
  // A barber is shown with the name and picture of their barber profile, not those of their Google account.
  const profile = match ? await readDatabase(`barbers/${encodeURIComponent(match[0])}/profile`, accessToken).catch(() => null) : null;
  return {
    uid,
    name: uid === ownerUid ? record.name : profile?.displayName || match?.[1]?.name || record.name,
    email: record.email,
    photoUrl: uid === ownerUid ? record.photoUrl : profile?.photoUrl || record.photoUrl,
    role: uid === ownerUid ? "owner" : match ? "barber" : "client",
  };
};

export const createHandler = () =>
  async function handler(request) {
    try {
      if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
      const user = await verifyRequestUser(request);
      if (!user) return jsonResponse({ error: "Sign in required" }, 401);
      const body = await request.json().catch(() => ({}));
      const accessToken = await getAccessToken();
      const group = await resolveGroup(user, accessToken);
      const ownerRecord = { name: group.isOwner ? user.displayName : "", email: group.isOwner ? user.email : "", photoUrl: group.isOwner ? user.photoUrl : "" };

      if (body.action === "list") {
        if (!group.ownerUid) return jsonResponse({ canLink: false, accounts: [] });
        const owner = group.isOwner ? ownerRecord : (await readDatabase(`accountLinks/${group.ownerUid}/_owner`, accessToken)) ?? { name: "Właściciel", email: "", photoUrl: "" };
        const uids = [group.ownerUid, ...Object.keys(group.links).filter((key) => key !== "_owner")];
        const accounts = await Promise.all(uids.map(async (uid) => ({
          ...(await describe(uid, uid === group.ownerUid ? owner : group.links[uid], group.ownerUid, accessToken)),
          current: uid === user.uid,
        })));
        return jsonResponse({ canLink: group.isOwner, accounts });
      }

      if (body.action === "link") {
        if (!group.isOwner) return jsonResponse({ error: "Only the owner can link accounts" }, 403);
        const other = await verifyRequestUser(new Request("https://bnb.invalid/", { headers: { authorization: `Bearer ${String(body.linkToken ?? "")}` } }));
        if (!other || !safeKey(other.uid)) return jsonResponse({ error: "Second account not verified" }, 400);
        if (other.uid === user.uid) return jsonResponse({ error: "That is the account you are using" }, 400);
        const existing = Object.keys(group.links).filter((key) => key !== "_owner");
        if (!existing.includes(other.uid) && existing.length >= MAX_LINKED_ACCOUNTS) return jsonResponse({ error: "Too many linked accounts" }, 400);
        await writeDatabase(`accountLinks/${group.ownerUid}/_owner`, { name: user.displayName, email: user.email, photoUrl: user.photoUrl }, accessToken);
        await writeDatabase(`accountLinks/${group.ownerUid}/${other.uid}`, { name: other.displayName, email: other.email, photoUrl: other.photoUrl, linkedAt: Date.now() }, accessToken);
        return jsonResponse({ linked: true });
      }

      if (body.action === "unlink") {
        if (!group.isOwner) return jsonResponse({ error: "Only the owner can unlink accounts" }, 403);
        const target = String(body.uid ?? "");
        if (!safeKey(target) || target === "_owner" || target === user.uid) return jsonResponse({ error: "Invalid account" }, 400);
        await writeDatabase(`accountLinks/${group.ownerUid}/${target}`, null, accessToken);
        return jsonResponse({ unlinked: true });
      }

      if (body.action === "switch") {
        const target = String(body.uid ?? "");
        const allowed = safeKey(target) && target !== "_owner" && (target === group.ownerUid || Boolean(group.links[target]));
        if (!group.ownerUid || !allowed) return jsonResponse({ error: "Account not available" }, 403);
        return jsonResponse({ token: createCustomToken(target) });
      }

      return jsonResponse({ error: "Unknown action" }, 400);
    } catch {
      return jsonResponse({ error: "Nie udało się przełączyć konta." }, 503);
    }
  };

export default createHandler();
