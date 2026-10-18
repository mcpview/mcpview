/** @jsxImportSource preact */
/**
 * Data marks for recorded numeric evidence.
 *
 * Every plot draws exactly the samples, bounds, and wording the caller passes.
 * None of them resamples, interpolates a missing point, formats a number, picks
 * a unit, derives an extremum, or owns pointer state: a cursor is declared by
 * the provider that already resolved the reading behind it.
 */

import type { JSX } from "preact";
import type { PresentationTone } from "./components.tsx";

const SPARKLINE_VIEWBOX_HEIGHT = 24;
const SERIES_CHART_VIEWBOX_HEIGHT = 40;
const VIEWBOX_WIDTH = 100;

/** Plot colors, including the two categorical theme colors. */
export type SeriesChartTone = PresentationTone | "accent" | "brand";

export interface SparklineProps {
  /** Accessible name of the sampled quantity. */
  readonly label: string;
  /** At least two finite samples, already ordered by the caller. */
  readonly values: readonly number[];
  /** Caller-formatted summary, including units. */
  readonly summaryLabel: string;
  /** Inline mark by default; block also displays the supplied label and summary. */
  readonly variant?: "inline" | "block";
  readonly tone?: SeriesChartTone;
  readonly className?: string;
}

/** Compact shape of one recorded series, readable at chip and row density. */
export function Sparkline({
  label,
  values,
  summaryLabel,
  variant = "inline",
  tone = "info",
  className,
}: SparklineProps): JSX.Element {
  validateSamples(values, "Sparkline values");
  const min = Math.min(...values);
  const max = Math.max(...values);
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * VIEWBOX_WIDTH;
      const y = SPARKLINE_VIEWBOX_HEIGHT -
        normalize(value, min, max) * SPARKLINE_VIEWBOX_HEIGHT;
      return `${round(x)},${round(y)}`;
    })
    .join(" ");

  const plot = (
    <svg
      aria-label={variant === "inline" ? `${label}: ${summaryLabel}` : undefined}
      aria-hidden={variant === "block" ? true : undefined}
      class={classes(
        "mcp-view-sparkline",
        variant === "inline" ? className : undefined,
      )}
      data-tone={tone}
      preserveAspectRatio="none"
      role={variant === "inline" ? "img" : undefined}
      viewBox={`0 0 ${VIEWBOX_WIDTH} ${SPARKLINE_VIEWBOX_HEIGHT}`}
    >
      <polyline
        class="mcp-view-sparkline-line"
        points={points}
        vector-effect="non-scaling-stroke"
      />
    </svg>
  );

  if (variant === "inline") return plot;

  return (
    <div
      aria-label={`${label}: ${summaryLabel}`}
      class={classes("mcp-view-sparkline-block", className)}
      role="img"
    >
      <div aria-hidden="true" class="mcp-view-sparkline-heading">
        <span>{label}</span>
        <span class="mcp-view-sparkline-summary">{summaryLabel}</span>
      </div>
      {plot}
    </div>
  );
}

export interface SeriesPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * How one series may be drawn.
 *
 * `line` connects consecutive samples, which asserts the quantity existed
 * between them — only true when the series is sampled densely enough for that
 * claim to hold. `bar` draws each recorded sample on its own and claims nothing
 * in between. The provider knows its sampling, so it declares the mark; the
 * chart never infers one from point spacing.
 */
export type SeriesMark = "line" | "bar";

export interface SeriesChartSeries {
  readonly id: string;
  readonly label: string;
  /** Declared, never inferred. A sparse series drawn as a line invents values. */
  readonly mark: SeriesMark;
  /** At least two finite points, already ordered by the caller. */
  readonly points: readonly SeriesPoint[];
  readonly tone?: SeriesChartTone;
}

export interface SeriesChartReadout {
  /** Must name one declared series. */
  readonly seriesId: string;
  /** Caller-formatted value at the cursor, including units. */
  readonly valueLabel: string;
}

export interface SeriesChartCursor {
  /** Position on the shared x scale. The chart resolves nothing itself. */
  readonly x: number;
  /** Caller-formatted position, such as an instant. */
  readonly label: string;
  /**
   * Values the provider actually recorded at that position. A series with no
   * sample there is simply absent: the chart never interpolates between two
   * samples, never snaps to a neighbour, and never fills a gap to look complete.
   */
  readonly readouts: readonly SeriesChartReadout[];
}

export interface SeriesChartSummaryItem {
  readonly id: string;
  /** Caller wording for the extremum, such as min, max, or final. */
  readonly label: string;
  /** Caller-formatted value, including units and where it occurred. */
  readonly valueLabel: string;
}

export interface SeriesChartProps {
  /** Accessible name of the chart. */
  readonly label: string;
  readonly series: readonly SeriesChartSeries[];
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
  /** Show caller-labelled series keys when at least two series are present. */
  readonly legend?: boolean;
  /** Caller-formatted y ticks on the declared shared scale. */
  readonly yTicks?: readonly { readonly value: number; readonly label: string }[];
  /** Caller-formatted ticks, left to right. */
  readonly axisLabels?: readonly string[];
  /** Caller-computed extrema. The chart never scans the samples for them. */
  readonly summary?: readonly SeriesChartSummaryItem[];
  /** Declared cursor. Omit it and the chart shows no readout. */
  readonly cursor?: SeriesChartCursor;
  /**
   * Pointer position on the shared x scale, or `undefined` once the pointer
   * leaves. The chart reports screen geometry only; which recorded sample that
   * position corresponds to — or that none does — stays the provider's call.
   */
  readonly onScrub?: (x: number | undefined) => void;
  readonly className?: string;
}

/** Multi-series plot on one shared finite scale, with a declared cursor readout. */
export function SeriesChart({
  label,
  series,
  xMin,
  xMax,
  yMin,
  yMax,
  axisLabels,
  legend = true,
  yTicks,
  summary,
  cursor,
  onScrub,
  className,
}: SeriesChartProps): JSX.Element {
  validateSeriesChart(series, xMin, xMax, yMin, yMax, cursor);
  for (const tick of yTicks ?? []) {
    if (!Number.isFinite(tick.value) || tick.value < yMin || tick.value > yMax) {
      throw new RangeError("SeriesChart yTicks value must be within yMin and yMax");
    }
  }
  const baselineY = yMin <= 0 && 0 <= yMax
    ? SERIES_CHART_VIEWBOX_HEIGHT - normalize(0, yMin, yMax) * SERIES_CHART_VIEWBOX_HEIGHT
    : undefined;
  const cursorX = cursor === undefined
    ? undefined
    : normalize(cursor.x, xMin, xMax) * VIEWBOX_WIDTH;
  const seriesLabels = series.map((one) => one.label).join(", ");

  return (
    <figure class={classes("mcp-view-series-chart", className)}>
      {legend && series.length >= 2 && (
        // The SVG's aria-label already names every series: the visual legend
        // stays out of the accessibility tree so nothing is read twice.
        <ul aria-hidden="true" class="mcp-view-series-chart-legend">
          {series.map((one) => (
            <li data-tone={one.tone ?? "info"} key={one.id}>
              <span
                aria-hidden="true"
                class="mcp-view-series-chart-legend-mark"
                data-mark={one.mark}
              />
              <span>{one.label}</span>
            </li>
          ))}
        </ul>
      )}
      <div
        class={classes(
          "mcp-view-series-chart-frame",
          yTicks?.length ? "mcp-view-series-chart-frame-ticks" : undefined,
        )}
      >
        {yTicks && yTicks.length > 0 && (
          <div aria-hidden="true" class="mcp-view-series-chart-y-axis">
            {yTicks.map((tick, index) => (
              <span
                key={index}
                style={{ top: `${round((1 - normalize(tick.value, yMin, yMax)) * 100)}%` }}
              >
                {tick.label}
              </span>
            ))}
          </div>
        )}
        <svg
          aria-label={`${label}: ${seriesLabels}`}
          class="mcp-view-series-chart-plot"
          preserveAspectRatio="none"
          role="img"
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${SERIES_CHART_VIEWBOX_HEIGHT}`}
          onPointerLeave={onScrub === undefined ? undefined : () => onScrub(undefined)}
          onPointerMove={onScrub === undefined ? undefined : (event) => {
            const box = event.currentTarget.getBoundingClientRect();
            if (box.width === 0) return;
            const ratio = (event.clientX - box.left) / box.width;
            if (ratio < 0 || ratio > 1) return;
            onScrub(xMin + ratio * (xMax - xMin));
          }}
        >
          {yTicks?.map((tick, index) => {
            const y = round((1 - normalize(tick.value, yMin, yMax)) * SERIES_CHART_VIEWBOX_HEIGHT);
            return (
              <line
                class="mcp-view-series-chart-grid"
                key={index}
                vector-effect="non-scaling-stroke"
                x1={0}
                x2={VIEWBOX_WIDTH}
                y1={y}
                y2={y}
              />
            );
          })}
          {baselineY !== undefined && (
            <line
              class="mcp-view-series-chart-baseline"
              vector-effect="non-scaling-stroke"
              x1={0}
              x2={VIEWBOX_WIDTH}
              y1={round(baselineY)}
              y2={round(baselineY)}
            />
          )}
          {cursorX !== undefined && (
            <line
              class="mcp-view-series-chart-cursor"
              vector-effect="non-scaling-stroke"
              x1={round(cursorX)}
              x2={round(cursorX)}
              y1={0}
              y2={SERIES_CHART_VIEWBOX_HEIGHT}
            />
          )}
          {series.map((one) => {
            const placed = one.points.map((point) => ({
              x: normalize(point.x, xMin, xMax) * VIEWBOX_WIDTH,
              y: SERIES_CHART_VIEWBOX_HEIGHT -
                normalize(point.y, yMin, yMax) * SERIES_CHART_VIEWBOX_HEIGHT,
            }));
            if (one.mark === "line") {
              return (
                <polyline
                  class="mcp-view-series-chart-line"
                  data-tone={one.tone ?? "info"}
                  key={one.id}
                  points={placed.map((at) => `${round(at.x)},${round(at.y)}`).join(" ")}
                  vector-effect="non-scaling-stroke"
                />
              );
            }
            // Each recorded sample stands alone, anchored on the drawn baseline
            // when the scale carries zero, otherwise on the floor of the scale.
            const foot = baselineY ?? SERIES_CHART_VIEWBOX_HEIGHT;
            return (
              <g class="mcp-view-series-chart-bars" data-tone={one.tone ?? "info"} key={one.id}>
                {placed.map((at, index) => (
                  <line
                    key={one.points[index].x}
                    vector-effect="non-scaling-stroke"
                    x1={round(at.x)}
                    x2={round(at.x)}
                    y1={round(foot)}
                    y2={round(at.y)}
                  />
                ))}
              </g>
            );
          })}
        </svg>
        {axisLabels && axisLabels.length > 0 && (
          <div aria-hidden="true" class="mcp-view-series-chart-axis">
            {axisLabels.map((tick) => <span key={tick}>{tick}</span>)}
          </div>
        )}
      </div>
      {cursor && (
        <div class="mcp-view-series-chart-readout">
          <span class="mcp-view-series-chart-readout-position">{cursor.label}</span>
          <dl class="mcp-view-series-chart-readout-values">
            {cursor.readouts.map((readout) => {
              const owner = series.find((one) => one.id === readout.seriesId);
              return (
                <div class="mcp-view-series-chart-readout-value" key={readout.seriesId}>
                  <dt data-tone={owner?.tone ?? "info"}>{owner?.label}</dt>
                  <dd>{readout.valueLabel}</dd>
                </div>
              );
            })}
          </dl>
        </div>
      )}
      {summary && summary.length > 0 && (
        <figcaption class="mcp-view-series-chart-summary">
          {summary.map((item) => (
            <span class="mcp-view-series-chart-summary-item" key={item.id}>
              <span class="mcp-view-series-chart-summary-label">{item.label}</span>
              <span class="mcp-view-series-chart-summary-value">{item.valueLabel}</span>
            </span>
          ))}
        </figcaption>
      )}
    </figure>
  );
}

export interface IntervalPlotInterval {
  readonly id: string;
  /** Caller wording for the interval, such as a tolerance class. */
  readonly label: string;
  readonly lower: number;
  readonly upper: number;
  /** Caller-formatted deviations, including units. */
  readonly lowerLabel: string;
  readonly upperLabel: string;
  readonly tone?: PresentationTone;
}

export interface IntervalPlotProps {
  /** Accessible name of the plot. */
  readonly label: string;
  readonly min: number;
  readonly max: number;
  /** Caller wording for the zero reference, such as the nominal size. */
  readonly zeroLabel: string;
  readonly intervals: readonly IntervalPlotInterval[];
  readonly className?: string;
}

/** Caller-declared deviation intervals laid out against a shared zero line. */
export function IntervalPlot({
  label,
  min,
  max,
  zeroLabel,
  intervals,
  className,
}: IntervalPlotProps): JSX.Element {
  validateIntervalPlot(min, max, intervals);
  const zeroOffset = `${round(normalize(0, min, max) * 100)}%`;

  return (
    <div
      aria-label={label}
      class={classes("mcp-view-interval-plot", className)}
      role="group"
    >
      <div class="mcp-view-interval-plot-scale">
        <span aria-hidden="true" class="mcp-view-interval-plot-zero" style={{ left: zeroOffset }} />
        <span class="mcp-view-interval-plot-zero-label" style={{ left: zeroOffset }}>
          {zeroLabel}
        </span>
      </div>
      {intervals.map((interval) => (
        <div
          class="mcp-view-interval-plot-row"
          data-tone={interval.tone ?? "neutral"}
          key={interval.id}
        >
          <span class="mcp-view-interval-plot-label">{interval.label}</span>
          <span class="mcp-view-interval-plot-track">
            <span
              aria-hidden="true"
              class="mcp-view-interval-plot-zero"
              style={{ left: zeroOffset }}
            />
            <span
              class="mcp-view-interval-plot-box"
              style={{
                left: `${round(normalize(interval.lower, min, max) * 100)}%`,
                width: `${round(((interval.upper - interval.lower) / (max - min)) * 100)}%`,
              }}
            />
          </span>
          <span class="mcp-view-interval-plot-bounds">
            <span class="mcp-view-interval-plot-lower">{interval.lowerLabel}</span>
            <span class="mcp-view-interval-plot-upper">{interval.upperLabel}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function validateSamples(values: readonly number[], subject: string): void {
  if (values.length < 2) throw new RangeError(`${subject} need at least two samples`);
  for (const value of values) {
    if (!Number.isFinite(value)) throw new TypeError(`${subject} must all be finite`);
  }
}

function validateSeriesChart(
  series: readonly SeriesChartSeries[],
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  cursor: SeriesChartCursor | undefined,
): void {
  for (
    const [name, candidate] of [["xMin", xMin], ["xMax", xMax], ["yMin", yMin], [
      "yMax",
      yMax,
    ]] as const
  ) {
    if (!Number.isFinite(candidate)) throw new TypeError(`SeriesChart ${name} must be finite`);
  }
  if (xMax <= xMin) throw new RangeError("SeriesChart xMax must be greater than xMin");
  if (yMax <= yMin) throw new RangeError("SeriesChart yMax must be greater than yMin");
  if (series.length === 0) throw new TypeError("SeriesChart series must not be empty");

  const ids = new Set<string>();
  for (const one of series) {
    if (ids.has(one.id)) throw new TypeError(`SeriesChart series id ${one.id} is duplicated`);
    ids.add(one.id);
    if (one.points.length < 2) {
      throw new RangeError(`SeriesChart series ${one.id} needs at least two points`);
    }
    for (const point of one.points) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        throw new TypeError(`SeriesChart series ${one.id} points must be finite`);
      }
    }
  }
  if (cursor === undefined) return;
  if (!Number.isFinite(cursor.x)) throw new TypeError("SeriesChart cursor x must be finite");
  if (cursor.x < xMin || cursor.x > xMax) {
    throw new RangeError("SeriesChart cursor x must be within xMin and xMax");
  }
  for (const readout of cursor.readouts) {
    if (!ids.has(readout.seriesId)) {
      throw new TypeError(
        `SeriesChart cursor readout ${readout.seriesId} names no declared series`,
      );
    }
  }
}

function validateIntervalPlot(
  min: number,
  max: number,
  intervals: readonly IntervalPlotInterval[],
): void {
  for (const [name, candidate] of [["min", min], ["max", max]] as const) {
    if (!Number.isFinite(candidate)) throw new TypeError(`IntervalPlot ${name} must be finite`);
  }
  if (max <= min) throw new RangeError("IntervalPlot max must be greater than min");
  if (min > 0 || max < 0) throw new RangeError("IntervalPlot scale must contain zero");
  if (intervals.length === 0) throw new TypeError("IntervalPlot intervals must not be empty");

  const ids = new Set<string>();
  for (const interval of intervals) {
    if (ids.has(interval.id)) throw new TypeError(`IntervalPlot id ${interval.id} is duplicated`);
    ids.add(interval.id);
    if (!Number.isFinite(interval.lower) || !Number.isFinite(interval.upper)) {
      throw new TypeError(`IntervalPlot interval ${interval.id} bounds must be finite`);
    }
    if (interval.upper < interval.lower) {
      throw new RangeError(`IntervalPlot interval ${interval.id} upper must not be below lower`);
    }
    if (interval.lower < min || interval.upper > max) {
      throw new RangeError(`IntervalPlot interval ${interval.id} must be within min and max`);
    }
  }
}

/** Position on a finite scale, clamped to a flat series' midpoint. */
function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return (value - min) / (max - min);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function classes(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(" ");
}
