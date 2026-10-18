/**
 * Pure Preact presentation primitives for native applications and MCP Apps.
 *
 * Unlike `@mcpview/components/preact`, this entry point does not import the MCP
 * Apps lifecycle, iframe transport, surface registry, or postMessage bridge.
 *
 * Import as `@mcpview/components/preact/components`.
 *
 * @module
 */

export {
  Badge,
  BadgeGroup,
  Button,
  Card,
  CodeBlock,
  CrossSelection,
  DataTable,
  EmptyState,
  InlineCode,
  KeyValueList,
  Message,
  Metric,
  MetricGrid,
  NoticeGroup,
  renderStatusMessage,
  Row,
  Skeleton,
  Stack,
  StateMessage,
  TextInput,
  Toolbar,
} from "./src/preact/components.tsx";
export type {
  BadgeGroupProps,
  BadgeProps,
  ButtonProps,
  CardProps,
  CodeBlockProps,
  CrossSelectionProps,
  DataTableColumn,
  DataTableProps,
  EmptyStateProps,
  InlineCodeProps,
  KeyValueItem,
  KeyValueLayout,
  KeyValueListProps,
  MessageProps,
  MetricGridProps,
  MetricItem,
  MetricProps,
  NoticeGroupProps,
  PresentationTone,
  RowProps,
  SkeletonProps,
  StackProps,
  StateMessageProps,
  StatusMessageMount,
  TextInputProps,
  ToolbarProps,
} from "./src/preact/components.tsx";

export {
  ArtifactRow,
  DrillHint,
  LimitGauge,
  PATH_BAR_DEFAULT_MAX_VISIBLE,
  PathBar,
  Slot3D,
  StaleBanner,
  TreeList,
  TypeBadge,
} from "./src/preact/structural.tsx";
export type {
  ArtifactFingerprint,
  ArtifactRowProps,
  ArtifactVerification,
  DrillHintDirection,
  DrillHintProps,
  LimitGaugeLimit,
  LimitGaugeProps,
  PathBarItem,
  PathBarProps,
  Slot3DProps,
  StaleBannerAction,
  StaleBannerProps,
  TreeListNode,
  TreeListProps,
  TypeBadgeProps,
  ViewKind,
} from "./src/preact/structural.tsx";

export { IntervalPlot, SeriesChart, Sparkline } from "./src/preact/plots.tsx";
export type {
  IntervalPlotInterval,
  IntervalPlotProps,
  SeriesChartCursor,
  SeriesChartProps,
  SeriesChartReadout,
  SeriesChartSeries,
  SeriesChartSummaryItem,
  SeriesChartTone,
  SeriesPoint,
  SparklineProps,
} from "./src/preact/plots.tsx";

export {
  CollectionCard,
  ElementBody,
  ElementIdent,
  ElementLimit,
  ElementProvenance,
  ElementReading,
  ElementSection,
  ElementVerdict,
  SemanticElement,
  SemanticList,
} from "./src/preact/semantic-element.tsx";
export type {
  CollectionCardProps,
  ElementBodyProps,
  ElementIdentProps,
  ElementLimitProps,
  ElementProvenanceProps,
  ElementReadingProps,
  ElementSectionProps,
  ElementVerdictProps,
  SemanticElementDensity,
  SemanticElementProps,
  SemanticListProps,
} from "./src/preact/semantic-element.tsx";

export { Disclosure, FocusedView } from "./src/preact/focused-view.tsx";
export type { DisclosureProps, FocusedViewProps } from "./src/preact/focused-view.tsx";

// The stylesheet and its types ship from the package root with
// `installMcpViewTheme`, never from this entry. Re-exporting them here handed
// the whole sheet to every caller that only wanted one component: the theme is
// an explicit install, so it must cost an explicit import.
