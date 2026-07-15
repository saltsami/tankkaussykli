import type { PricePoint } from "@/lib/types";

type PriceChartProps = {
  points: PricePoint[];
};

export function PriceChart({ points }: PriceChartProps) {
  if (points.length < 2) {
    return (
      <div className="chart-empty">
        Hintatrendi muodostuu, kun asemalta kertyy lisää havaintoja.
      </div>
    );
  }

  const width = 680;
  const height = 220;
  const padding = { top: 24, right: 24, bottom: 34, left: 48 };
  const prices = points.map((point) => point.price);
  const minimum = Math.min(...prices) - 0.015;
  const maximum = Math.max(...prices) + 0.015;
  const range = Math.max(maximum - minimum, 0.05);
  const x = (index: number) =>
    padding.left +
    (index / Math.max(points.length - 1, 1)) *
      (width - padding.left - padding.right);
  const y = (price: number) =>
    padding.top +
    ((maximum - price) / range) *
      (height - padding.top - padding.bottom);

  const observedPoints = points.filter((point) => !point.forecast);
  const forecastStart = Math.max(observedPoints.length - 1, 0);
  const observedPath = points
    .slice(0, observedPoints.length)
    .map((point, index) => `${index === 0 ? "M" : "L"} ${x(index)} ${y(point.price)}`)
    .join(" ");
  const forecastPath = points
    .slice(forecastStart)
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"} ${x(index + forecastStart)} ${y(point.price)}`,
    )
    .join(" ");
  const lastObservedIndex = Math.max(observedPoints.length - 1, 0);

  return (
    <div className="price-chart-wrap">
      <svg
        className="price-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby="price-chart-title price-chart-description"
      >
        <title id="price-chart-title">Aseman hintatrendi</title>
        <desc id="price-chart-description">
          Toteutuneet hinnat yhtenäisellä viivalla ja arvio katkoviivalla, euroina
          litralta.
        </desc>
        {[0, 0.5, 1].map((fraction) => {
          const price = maximum - range * fraction;
          const yPosition = y(price);
          return (
            <g key={fraction}>
              <line
                x1={padding.left}
                y1={yPosition}
                x2={width - padding.right}
                y2={yPosition}
                className="chart-grid-line"
              />
              <text x={padding.left - 10} y={yPosition + 4} className="chart-axis-label">
                {price.toFixed(2)}
              </text>
            </g>
          );
        })}
        <path d={observedPath} className="chart-line" />
        {forecastPath && <path d={forecastPath} className="chart-line chart-forecast" />}
        {points.map((point, index) => (
          <g key={`${point.label}-${index}`}>
            <circle
              cx={x(index)}
              cy={y(point.price)}
              r={index === lastObservedIndex ? 5 : 3}
              className={point.forecast ? "chart-dot chart-dot-forecast" : "chart-dot"}
            >
              <title>{`${point.label}: ${point.price.toFixed(3)} €/l${point.forecast ? " (arvio)" : ""}`}</title>
            </circle>
            {(index % 2 === 0 || index === points.length - 1) && (
              <text x={x(index)} y={height - 10} className="chart-x-label">
                {point.label}
              </text>
            )}
          </g>
        ))}
      </svg>
      <div className="chart-legend" aria-hidden="true">
        <span><i className="legend-line" /> Toteutunut</span>
        <span><i className="legend-line legend-line-forecast" /> Arvio</span>
      </div>
    </div>
  );
}
