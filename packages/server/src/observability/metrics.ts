/**
 * Server Metrics Collector for @casys/mcp-server
 *
 * In-memory counters, histograms, and gauges with Prometheus text format export.
 * Designed to be embedded in McpApp — no external dependencies.
 *
 * @module lib/server/observability/metrics
 */

/**
 * Histogram bucket
 */
interface HistogramBucket {
  le: number;
  count: number;
}

/**
 * Latency histogram with cumulative buckets
 */
interface Histogram {
  buckets: HistogramBucket[];
  sum: number;
  count: number;
}

/**
 * Default histogram buckets (milliseconds)
 */
const DEFAULT_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

function createHistogram(buckets: number[] = DEFAULT_BUCKETS): Histogram {
  return {
    buckets: buckets.map((le) => ({ le, count: 0 })),
    sum: 0,
    count: 0,
  };
}

function observeHistogram(histogram: Histogram, value: number): void {
  histogram.sum += value;
  histogram.count++;
  for (const bucket of histogram.buckets) {
    if (value <= bucket.le) {
      bucket.count++;
    }
  }
}

/**
 * Metrics snapshot returned by getMetrics()
 */
export interface ServerMetricsSnapshot {
  counters: {
    tool_calls_total: number;
    tool_calls_success: number;
    tool_calls_failed: number;
    requests_rate_limited: number;
    requests_rejected_backpressure: number;
    auth_success: number;
    auth_failed: number;
    auth_cache_hits: number;
  };
  histograms: {
    tool_call_duration_ms: Histogram;
  };
  gauges: {
    active_requests: number;
    queued_requests: number;
    rate_limiter_keys: number;
  };
  collected_at: number;
  uptime_seconds: number;
}

/**
 * Tool call metrics by tool name
 */
interface PerToolMetrics {
  calls: number;
  success: number;
  failed: number;
  totalDurationMs: number;
}

/**
 * Server metrics collector.
 *
 * @example
 * ```typescript
 * const metrics = new ServerMetrics();
 * metrics.recordToolCall("my_tool", true, 42);
 * console.log(metrics.toPrometheusFormat());
 * ```
 */
export class ServerMetrics {
  private startTime = Date.now();

  // Counters
  private toolCallsTotal = 0;
  private toolCallsSuccess = 0;
  private toolCallsFailed = 0;
  private requestsRateLimited = 0;
  private requestsRejectedBackpressure = 0;
  private authSuccess = 0;
  private authFailed = 0;
  private authCacheHits = 0;

  // Histogram
  private toolCallDuration = createHistogram();

  // Per-tool breakdown
  private perTool = new Map<string, PerToolMetrics>();

  // Gauges (set externally via setGauge)
  private activeRequests = 0;
  private queuedRequests = 0;
  private rateLimiterKeys = 0;

  /**
   * Record a completed tool call
   */
  recordToolCall(toolName: string, success: boolean, durationMs: number): void {
    this.toolCallsTotal++;
    if (success) {
      this.toolCallsSuccess++;
    } else {
      this.toolCallsFailed++;
    }
    observeHistogram(this.toolCallDuration, durationMs);

    // Per-tool
    let pt = this.perTool.get(toolName);
    if (!pt) {
      pt = { calls: 0, success: 0, failed: 0, totalDurationMs: 0 };
      this.perTool.set(toolName, pt);
    }
    pt.calls++;
    if (success) pt.success++;
    else pt.failed++;
    pt.totalDurationMs += durationMs;
  }

  recordRateLimited(): void {
    this.requestsRateLimited++;
  }

  recordBackpressureRejected(): void {
    this.requestsRejectedBackpressure++;
  }

  recordAuth(success: boolean): void {
    if (success) this.authSuccess++;
    else this.authFailed++;
  }

  recordAuthCacheHit(): void {
    this.authCacheHits++;
  }

  /**
   * Update gauge values (called periodically or on-demand)
   */
  setGauges(gauges: {
    activeRequests?: number;
    queuedRequests?: number;
    rateLimiterKeys?: number;
  }): void {
    if (gauges.activeRequests !== undefined) {
      this.activeRequests = gauges.activeRequests;
    }
    if (gauges.queuedRequests !== undefined) {
      this.queuedRequests = gauges.queuedRequests;
    }
    if (gauges.rateLimiterKeys !== undefined) {
      this.rateLimiterKeys = gauges.rateLimiterKeys;
    }
  }

  /**
   * Get current metrics snapshot
   */
  getSnapshot(): ServerMetricsSnapshot {
    return {
      counters: {
        tool_calls_total: this.toolCallsTotal,
        tool_calls_success: this.toolCallsSuccess,
        tool_calls_failed: this.toolCallsFailed,
        requests_rate_limited: this.requestsRateLimited,
        requests_rejected_backpressure: this.requestsRejectedBackpressure,
        auth_success: this.authSuccess,
        auth_failed: this.authFailed,
        auth_cache_hits: this.authCacheHits,
      },
      histograms: {
        tool_call_duration_ms: { ...this.toolCallDuration },
      },
      gauges: {
        active_requests: this.activeRequests,
        queued_requests: this.queuedRequests,
        rate_limiter_keys: this.rateLimiterKeys,
      },
      collected_at: Date.now(),
      uptime_seconds: Math.floor((Date.now() - this.startTime) / 1000),
    };
  }

  /**
   * Prometheus text format export
   */
  toPrometheusFormat(prefix = "mcp_server"): string {
    const m = this.getSnapshot();
    const lines: string[] = [];

    // --- Counters ---
    const counter = (name: string, help: string, value: number) => {
      lines.push(`# HELP ${prefix}_${name} ${help}`);
      lines.push(`# TYPE ${prefix}_${name} counter`);
      lines.push(`${prefix}_${name} ${value}`);
    };

    counter(
      "tool_calls_total",
      "Total tool calls",
      m.counters.tool_calls_total,
    );
    counter(
      "tool_calls_success_total",
      "Successful tool calls",
      m.counters.tool_calls_success,
    );
    counter(
      "tool_calls_failed_total",
      "Failed tool calls",
      m.counters.tool_calls_failed,
    );
    counter(
      "requests_rate_limited_total",
      "Requests rejected by rate limiter",
      m.counters.requests_rate_limited,
    );
    counter(
      "requests_backpressure_total",
      "Requests rejected by backpressure",
      m.counters.requests_rejected_backpressure,
    );
    counter(
      "auth_success_total",
      "Successful auth verifications",
      m.counters.auth_success,
    );
    counter(
      "auth_failed_total",
      "Failed auth verifications",
      m.counters.auth_failed,
    );
    counter(
      "auth_cache_hits_total",
      "Auth token cache hits",
      m.counters.auth_cache_hits,
    );

    // --- Per-tool counters ---
    lines.push(`# HELP ${prefix}_tool_calls_by_name Tool calls by tool name`);
    lines.push(`# TYPE ${prefix}_tool_calls_by_name counter`);
    for (const [name, pt] of this.perTool) {
      lines.push(
        `${prefix}_tool_calls_by_name{tool="${name}",status="success"} ${pt.success}`,
      );
      lines.push(
        `${prefix}_tool_calls_by_name{tool="${name}",status="failed"} ${pt.failed}`,
      );
    }

    // --- Histogram ---
    const h = m.histograms.tool_call_duration_ms;
    lines.push(
      `# HELP ${prefix}_tool_call_duration_ms Tool call duration in milliseconds`,
    );
    lines.push(`# TYPE ${prefix}_tool_call_duration_ms histogram`);
    for (const bucket of h.buckets) {
      lines.push(
        `${prefix}_tool_call_duration_ms_bucket{le="${bucket.le}"} ${bucket.count}`,
      );
    }
    lines.push(`${prefix}_tool_call_duration_ms_bucket{le="+Inf"} ${h.count}`);
    lines.push(`${prefix}_tool_call_duration_ms_sum ${h.sum}`);
    lines.push(`${prefix}_tool_call_duration_ms_count ${h.count}`);

    // --- Gauges ---
    const gauge = (name: string, help: string, value: number) => {
      lines.push(`# HELP ${prefix}_${name} ${help}`);
      lines.push(`# TYPE ${prefix}_${name} gauge`);
      lines.push(`${prefix}_${name} ${value}`);
    };

    gauge(
      "active_requests",
      "Currently executing requests",
      m.gauges.active_requests,
    );
    gauge(
      "queued_requests",
      "Requests waiting in queue",
      m.gauges.queued_requests,
    );
    gauge(
      "rate_limiter_keys",
      "Tracked rate limiter keys",
      m.gauges.rate_limiter_keys,
    );
    gauge("uptime_seconds", "Server uptime in seconds", m.uptime_seconds);

    return lines.join("\n") + "\n";
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.toolCallsTotal = 0;
    this.toolCallsSuccess = 0;
    this.toolCallsFailed = 0;
    this.requestsRateLimited = 0;
    this.requestsRejectedBackpressure = 0;
    this.authSuccess = 0;
    this.authFailed = 0;
    this.authCacheHits = 0;
    this.toolCallDuration = createHistogram();
    this.perTool.clear();
    this.activeRequests = 0;
    this.queuedRequests = 0;
    this.rateLimiterKeys = 0;
    this.startTime = Date.now();
  }
}
