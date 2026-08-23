import assert from "node:assert/strict";
import test from "node:test";

import { buildClientDatabaseCleanup } from "../shared/client-cleanup.mjs";

const appointment = (id, clientId, name, status) => ({
  id,
  barberId: "mateusz",
  clientId,
  userId: clientId,
  serviceId: "cut",
  clientName: name,
  dateKey: "2026-08-20",
  startTime: "10:00",
  durationMinutes: 60,
  serviceName: "Strzyżenie",
  price: "50 zł",
  status,
  version: 1,
});

test("client cleanup keeps only selected clients and confirmed or completed visits", () => {
  const source = {
    appointmentSync: { revision: 4 },
    clients: {
      daniel: { id: "daniel", firstName: "Daniel", lastName: "Wolski", userId: "daniel" },
      test: { id: "test", firstName: "Konto", lastName: "Testowe", userId: "test" },
    },
    appointments: {
      completed: appointment("completed", "daniel", "Daniel Wolski", "completed"),
      cancelled: appointment("cancelled", "daniel", "Daniel Wolski", "cancelled"),
      test: appointment("test", "test", "Konto Testowe", "confirmed"),
      olaf: { ...appointment("olaf", "", "Olaf Jaroszewicz", "completed"), userId: "olaf" },
    },
  };

  const result = buildClientDatabaseCleanup(source, {
    keepNames: ["Daniel Wolski", "Olaf Jaroszewicz"],
  });

  assert.deepEqual(Object.keys(result.data.clients).sort(), ["daniel", "olaf"]);
  assert.deepEqual(Object.keys(result.data.appointments).sort(), ["completed", "olaf"]);
  assert.equal(result.data.appointments.olaf.clientId, "olaf");
  assert.equal(result.data.clients.olaf.firstName, "Olaf");
  assert.equal(result.report.removedClients, 1);
  assert.equal(result.report.removedAppointments, 2);
});
