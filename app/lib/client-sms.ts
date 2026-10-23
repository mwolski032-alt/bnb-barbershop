import { dateFromKey } from "./booking-selectors";
import { type SmsTemplate, type AdminAppointment } from "./booking-types";
import { adminClientDateFormatter } from "./booking-format";

export const smsTemplates: SmsTemplate[] = ["confirmation", "reschedule", "reminder", "custom"];

export const buildClientSmsMessage = (template: SmsTemplate, appointment: AdminAppointment) => {
  const firstName = appointment.clientName.trim().split(/\s+/)[0] || "";
  const greeting = firstName ? `Siema, ${firstName}!` : "Siema!";
  const date = adminClientDateFormatter.format(dateFromKey(appointment.dateKey));
  const visit = `${date} o ${appointment.startTime}`;

  if (template === "confirmation") {
    return `${greeting} Potwierdzam Twoją wizytę w B'n'B: ${visit}. ${appointment.serviceName}. Do zobaczenia!`;
  }

  if (template === "reschedule") {
    return `${greeting} Zmieniłem termin Twojej wizyty. Nowy termin: ${visit}. ${appointment.serviceName}. Daj znać, jeśli termin Ci nie pasuje.`;
  }

  if (template === "reminder") {
    return `${greeting} Przypominam o wizycie w B'n'B: ${visit}. ${appointment.serviceName}. Do zobaczenia!`;
  }

  return "";
};

export const buildSmsHref = (phoneDigits: string, message: string) => {
  const cleanMessage = message.trim();
  const bodySeparator =
    typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent) ? "&" : "?";

  return cleanMessage ? `sms:${phoneDigits}${bodySeparator}body=${encodeURIComponent(cleanMessage)}` : `sms:${phoneDigits}`;
};
