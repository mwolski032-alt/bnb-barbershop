import { getAnalyticsRange, getAppointmentDateTime, dateFromKey, getAppointmentEndDateTime, normalizeAppointmentStatus, isPotentialNoShow, isClosedAppointmentStatus, getAppointmentRevenue, getAppointmentPriceValue, getAdminClientId, timeToMinutes, analyticsWeekdayFormatter, analyticsMonthFormatter, analyticsDateFormatter } from "./booking-selectors";
import type { AdminAppointment, WorkSettings, AnalyticsPeriod } from "./booking-types";

export function buildAnalytics(adminAppointments: AdminAppointment[], analyticsPeriod: AnalyticsPeriod, currentDate: Date, workSettings: WorkSettings) {
    const range = getAnalyticsRange(analyticsPeriod, currentDate);
    const isWithin = (appointment: AdminAppointment, start: Date, end: Date) => {
      const appointmentTime = getAppointmentDateTime(appointment).getTime();
      return appointmentTime >= start.getTime() && appointmentTime <= end.getTime();
    };
    const completedAppointments = adminAppointments.filter(
      (appointment) =>
        normalizeAppointmentStatus(appointment.status) === "completed" &&
        isWithin(appointment, range.start, range.end),
    );
    const previousCompletedAppointments = adminAppointments.filter(
      (appointment) =>
        normalizeAppointmentStatus(appointment.status) === "completed" &&
        isWithin(appointment, range.previousStart, range.previousEnd),
    );
    const potentialNoShows = adminAppointments.filter(
      (appointment) =>
        isPotentialNoShow(appointment, currentDate) &&
        isWithin(appointment, range.start, range.end),
    );
    const upcomingAppointments = adminAppointments.filter(
      (appointment) =>
        !isClosedAppointmentStatus(appointment.status) &&
        getAppointmentDateTime(appointment).getTime() > currentDate.getTime() &&
        isWithin(appointment, range.start, range.end),
    );
    const revenue = completedAppointments.reduce(
      (sum, appointment) => sum + getAppointmentRevenue(appointment),
      0,
    );
    const previousRevenue = previousCompletedAppointments.reduce(
      (sum, appointment) => sum + getAppointmentRevenue(appointment),
      0,
    );
    const clientIds = new Set(completedAppointments.map(getAdminClientId));
    const previousClientIds = new Set(
      adminAppointments
        .filter(
          (appointment) =>
            normalizeAppointmentStatus(appointment.status) === "completed" &&
            getAppointmentDateTime(appointment).getTime() < range.start.getTime(),
        )
        .map(getAdminClientId),
    );
    const returningClients = Array.from(clientIds).filter((id) => previousClientIds.has(id)).length;
    const newClients = Math.max(0, clientIds.size - returningClients);
    const availableMinutes = Object.values(workSettings.availability).reduce((sum, windowItem) => {
      const date = dateFromKey(windowItem.dateKey).getTime();
      if (date < range.start.getTime() || date > range.end.getTime()) return sum;
      return sum + Math.max(0, timeToMinutes(windowItem.endTime) - timeToMinutes(windowItem.startTime));
    }, 0);
    const occupiedAppointments = adminAppointments.filter(
      (appointment) =>
        isWithin(appointment, range.start, range.end) &&
        (normalizeAppointmentStatus(appointment.status) === "completed" ||
          getAppointmentEndDateTime(appointment).getTime() > currentDate.getTime()),
    );
    const occupiedMinutes = occupiedAppointments.reduce(
      (sum, appointment) => sum + appointment.durationMinutes,
      0,
    );
    const serviceMap = new Map<string, { name: string; visits: number; revenue: number }>();

    completedAppointments.forEach((appointment) => {
      const current = serviceMap.get(appointment.serviceName) ?? {
        name: appointment.serviceName,
        visits: 0,
        revenue: 0,
      };
      current.visits += 1;
      current.revenue += getAppointmentRevenue(appointment);
      serviceMap.set(appointment.serviceName, current);
    });

    const servicesSummary = Array.from(serviceMap.values()).sort(
      (first, second) => second.revenue - first.revenue || second.visits - first.visits,
    );
    const bucketDefinitions: Array<{ label: string; start: Date; end: Date }> = [];

    if (analyticsPeriod === "week") {
      for (let offset = 0; offset < 7; offset += 1) {
        const start = new Date(range.start.getFullYear(), range.start.getMonth(), range.start.getDate() + offset);
        const end = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 23, 59, 59, 999);
        bucketDefinitions.push({
          label: analyticsWeekdayFormatter.format(start).replace(".", ""),
          start,
          end,
        });
      }
    } else if (analyticsPeriod === "month") {
      const lastDay = range.end.getDate();
      for (let day = 1; day <= lastDay; day += 7) {
        const bucketEndDay = Math.min(day + 6, lastDay);
        bucketDefinitions.push({
          label: `${day}-${bucketEndDay}`,
          start: new Date(range.start.getFullYear(), range.start.getMonth(), day),
          end: new Date(range.start.getFullYear(), range.start.getMonth(), bucketEndDay, 23, 59, 59, 999),
        });
      }
    } else {
      const cursor = new Date(range.start.getFullYear(), range.start.getMonth(), 1);
      while (cursor.getTime() <= range.end.getTime()) {
        const start = new Date(cursor);
        const end = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59, 999);
        bucketDefinitions.push({
          label: analyticsMonthFormatter.format(start).replace(".", ""),
          start,
          end,
        });
        cursor.setMonth(cursor.getMonth() + 1);
      }
    }

    const trend = bucketDefinitions.map((bucket) => ({
      label: bucket.label,
      revenue: completedAppointments
        .filter((appointment) => isWithin(appointment, bucket.start, bucket.end))
        .reduce((sum, appointment) => sum + getAppointmentRevenue(appointment), 0),
    }));

    return {
      periodLabel: `${analyticsDateFormatter.format(range.start)} - ${analyticsDateFormatter.format(range.end)}`,
      revenue,
      revenueChange:
        previousRevenue > 0
          ? Math.round(((revenue - previousRevenue) / previousRevenue) * 100)
          : revenue > 0
            ? 100
            : 0,
      visits: completedAppointments.length,
      visitsChange: completedAppointments.length - previousCompletedAppointments.length,
      clients: clientIds.size,
      occupancy: availableMinutes > 0 ? Math.min(100, Math.round((occupiedMinutes / availableMinutes) * 100)) : 0,
      averageTicket: completedAppointments.length > 0 ? revenue / completedAppointments.length : 0,
      returningClients,
      newClients,
      potentialNoShows: potentialNoShows.length,
      potentialNoShowValue: potentialNoShows.reduce(
        (sum, appointment) => sum + getAppointmentPriceValue(appointment),
        0,
      ),
      plannedRevenue: upcomingAppointments.reduce(
        (sum, appointment) => sum + getAppointmentPriceValue(appointment),
        0,
      ),
      servicesSummary,
      maxServiceRevenue: Math.max(1, ...servicesSummary.map((service) => service.revenue)),
      trend,
      maxTrendRevenue: Math.max(1, ...trend.map((bucket) => bucket.revenue)),
    };

}
