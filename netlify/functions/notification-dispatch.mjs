import {
  getAccessToken,
  readDatabase,
  verifyRequestUser,
} from "./_firebase-admin.mjs";
import {
  processNotificationJob,
  resolveNotificationSiteUrl,
} from "./_notification-service.mjs";
import { cleanText, isFirebaseKeySafe } from "../../shared/data-model.mjs";

const handler = async (request) => {
  if (request.method !== "POST") return;

  const user = await verifyRequestUser(request);
  if (!user) return;

  const body = await request.json().catch(() => ({}));
  const requestedIds = Array.isArray(body.operationIds) ? body.operationIds : [];
  const operationIds = requestedIds
    .map((value) => cleanText(value, 120))
    .filter((value, index, values) => isFirebaseKeySafe(value) && values.indexOf(value) === index)
    .slice(0, 10);
  if (operationIds.length === 0) return;

  const accessToken = await getAccessToken();
  const authorizedIds = (
    await Promise.all(
      operationIds.map(async (operationId) => {
        const operation = await readDatabase(
          `appointmentOperations/${encodeURIComponent(operationId)}`,
          accessToken,
        );
        return operation?.actorUid === user.uid ? operationId : "";
      }),
    )
  ).filter(Boolean);

  await Promise.all(
    authorizedIds.map((operationId) =>
      processNotificationJob(operationId, {
        accessToken,
        siteUrl: resolveNotificationSiteUrl(request),
      }),
    ),
  );
};

export const config = {
  background: true,
};

export default handler;
