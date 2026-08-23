const getPolishCountLabel = (value, singular, few, many) => {
  if (value === 1) return singular;
  const lastDigit = value % 10;
  const lastTwoDigits = value % 100;
  if (lastDigit >= 2 && lastDigit <= 4 && (lastTwoDigits < 12 || lastTwoDigits > 14)) {
    return few;
  }
  return many;
};

const formatRelativeDuration = (totalMinutes) => {
  const minutes = Math.max(1, Math.round(totalMinutes));
  if (minutes < 60) {
    return `${minutes} ${getPolishCountLabel(minutes, "minutę", "minuty", "minut")}`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes > 0) return `${hours} godz. ${remainingMinutes} min`;
  return `${hours} ${getPolishCountLabel(hours, "godzinę", "godziny", "godzin")}`;
};

export const selectNearestAppointments = (appointments, limit = 4) =>
  [...appointments]
    .sort((first, second) =>
      `${first.dateKey}T${first.startTime}`.localeCompare(`${second.dateKey}T${second.startTime}`),
    )
    .slice(0, Math.max(0, limit));

export const formatNearestAppointmentLabel = ({
  distanceLabel,
  startTime,
  startTimestamp,
  nowTimestamp,
}) => {
  const differenceMinutes = (startTimestamp - nowTimestamp) / 60000;

  if (differenceMinutes <= 0) {
    return `Najbliższa wizyta · rozpoczęła się ${formatRelativeDuration(
      Math.floor(Math.abs(differenceMinutes)),
    )} temu`;
  }

  if (distanceLabel === "Dzisiaj") {
    return `Najbliższa wizyta · dzisiaj za ${formatRelativeDuration(
      Math.ceil(differenceMinutes),
    )}`;
  }

  return `Najbliższa wizyta · ${distanceLabel.toLocaleLowerCase("pl-PL")} o ${startTime}`;
};
