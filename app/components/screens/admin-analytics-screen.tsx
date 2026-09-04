"use client";

import type { CSSProperties } from "react";

export type AnalyticsPeriod = "week" | "month" | "quarter" | "year";

type AnalyticsSummary = {
  periodLabel: string;
  revenue: number;
  revenueChange: number;
  visits: number;
  visitsChange: number;
  clients: number;
  occupancy: number;
  averageTicket: number;
  returningClients: number;
  newClients: number;
  potentialNoShows: number;
  potentialNoShowValue: number;
  plannedRevenue: number;
  servicesSummary: Array<{ name: string; visits: number; revenue: number }>;
  maxServiceRevenue: number;
  trend: Array<{ label: string; revenue: number }>;
  maxTrendRevenue: number;
};

type AdminAnalyticsScreenProps = {
  analytics: AnalyticsSummary;
  period: AnalyticsPeriod;
  onPeriodChange: (period: AnalyticsPeriod) => void;
};

const periodLabels: Record<AnalyticsPeriod, string> = {
  week: "Tydzień",
  month: "Miesiąc",
  quarter: "3 mies.",
  year: "Rok",
};

const currencyFormatter = new Intl.NumberFormat("pl-PL", {
  style: "currency",
  currency: "PLN",
  maximumFractionDigits: 0,
});

const formatCurrency = (value: number) => currencyFormatter.format(Math.round(value));

export default function AdminAnalyticsScreen({
  analytics,
  period,
  onPeriodChange,
}: AdminAnalyticsScreenProps) {
  return (
    <div className="admin-tab-panel active">
      <div className="admin-section-header analytics-section-header">
        <div>
          <p className="eyebrow">Wyniki biznesu</p>
          <h2>{analytics.periodLabel}</h2>
        </div>
        <div className="analytics-period-control" aria-label="Zakres analizy">
          {(Object.keys(periodLabels) as AnalyticsPeriod[]).map((option) => (
            <button
              className={period === option ? "active" : ""}
              key={option}
              type="button"
              onClick={() => onPeriodChange(option)}
              aria-pressed={period === option}
            >
              {periodLabels[option]}
            </button>
          ))}
        </div>
      </div>

      <div className="analytics-view" aria-label="Analiza działalności">
        <div className="analytics-kpi-grid">
          <article className="analytics-kpi revenue">
            <span>Przychód</span>
            <strong>{formatCurrency(analytics.revenue)}</strong>
            <small className={analytics.revenueChange < 0 ? "negative" : "positive"}>
              {analytics.revenueChange > 0 ? "+" : ""}
              {analytics.revenueChange}% do poprzedniego okresu
            </small>
          </article>
          <article className="analytics-kpi visits">
            <span>Rozliczone wizyty</span>
            <strong>{analytics.visits}</strong>
            <small className={analytics.visitsChange < 0 ? "negative" : "positive"}>
              {analytics.visitsChange > 0 ? "+" : ""}
              {analytics.visitsChange} do poprzedniego okresu
            </small>
          </article>
          <article className="analytics-kpi clients">
            <span>Klienci</span>
            <strong>{analytics.clients}</strong>
            <small>
              {analytics.newClients} nowych · {analytics.returningClients} powracających
            </small>
          </article>
          <article className="analytics-kpi occupancy">
            <span>Obłożenie</span>
            <strong>{analytics.occupancy}%</strong>
            <small>zajęty czas w dostępnych godzinach</small>
          </article>
        </div>

        <div className="analytics-main-grid">
          <section className="analytics-panel analytics-trend-panel">
            <div className="analytics-panel-heading">
              <div>
                <p className="section-label">Przychód w czasie</p>
                <strong>{formatCurrency(analytics.revenue)}</strong>
              </div>
              <span>{periodLabels[period]}</span>
            </div>

            <div className="analytics-chart" aria-label="Wykres przychodu">
              {analytics.trend.map((bucket) => (
                <div className="analytics-bar-column" key={`${bucket.label}-${period}`}>
                  <strong>{bucket.revenue > 0 ? formatCurrency(bucket.revenue) : "—"}</strong>
                  <div className="analytics-bar-track" aria-hidden="true">
                    <span
                      style={
                        {
                          "--bar-height": `${Math.max(
                            bucket.revenue > 0 ? 8 : 0,
                            Math.round((bucket.revenue / analytics.maxTrendRevenue) * 100),
                          )}%`,
                        } as CSSProperties
                      }
                    />
                  </div>
                  <small>{bucket.label}</small>
                </div>
              ))}
            </div>
          </section>

          <section className="analytics-panel analytics-services-panel">
            <div className="analytics-panel-heading">
              <div>
                <p className="section-label">Usługi</p>
                <strong>Największy udział</strong>
              </div>
              <span>{analytics.servicesSummary.length}</span>
            </div>

            {analytics.servicesSummary.length > 0 ? (
              <div className="analytics-service-list">
                {analytics.servicesSummary.slice(0, 5).map((service) => (
                  <div className="analytics-service-row" key={service.name}>
                    <div>
                      <strong>{service.name}</strong>
                      <span>
                        {service.visits} {service.visits === 1 ? "wizyta" : "wizyt"}
                      </span>
                    </div>
                    <b>{formatCurrency(service.revenue)}</b>
                    <div className="analytics-service-meter" aria-hidden="true">
                      <span
                        style={{
                          width: `${Math.max(
                            4,
                            Math.round((service.revenue / analytics.maxServiceRevenue) * 100),
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="analytics-empty-state">
                <strong>Brak rozliczonych usług</strong>
                <span>Pierwsze wyniki pojawią się po rozliczeniu wizyty.</span>
              </div>
            )}
          </section>
        </div>

        <div className="analytics-insight-grid">
          <article>
            <span>Średnia wizyta</span>
            <strong>{formatCurrency(analytics.averageTicket)}</strong>
            <small>średni przychód z rozliczenia</small>
          </article>
          <article>
            <span>Przyszłe rezerwacje</span>
            <strong>{formatCurrency(analytics.plannedRevenue)}</strong>
            <small>w wybranym okresie</small>
          </article>
          <article className={analytics.potentialNoShows > 0 ? "attention" : ""}>
            <span>Potencjalne nieobecności</span>
            <strong>{analytics.potentialNoShows}</strong>
            <small>{formatCurrency(analytics.potentialNoShowValue)} bez rozliczenia</small>
          </article>
        </div>
      </div>
    </div>
  );
}
