const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const timeToMinutes = (time) => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};

export const getZonedDateTime = (
  now = new Date(),
  timeZone = "Europe/Warsaw",
) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("sv-SE", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
};

export const isBookableStartTime = (
  dateKey,
  startTime,
  now = new Date(),
  timeZone = "Europe/Warsaw",
) => {
  if (!datePattern.test(dateKey) || !timePattern.test(startTime)) return false;

  const current = getZonedDateTime(now, timeZone);
  if (dateKey !== current.dateKey) return dateKey > current.dateKey;

  return timeToMinutes(startTime) > current.minutes;
};
