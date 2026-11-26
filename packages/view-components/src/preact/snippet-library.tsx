/** @jsxImportSource preact */

import type { ComponentChildren, JSX } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { Button, CodeBlock } from "./components.tsx";

export interface SnippetLibraryEntry {
  /** Stable identifier passed back to the caller in onInspect. */
  readonly id: string;
  readonly name: string;
  readonly description?: string;
}

export interface SnippetLibrarySource {
  readonly name: string;
  readonly description?: string;
  readonly code: string;
}

export interface SnippetLibraryLabels {
  readonly title: string;
  readonly search: string;
  readonly view: string;
  readonly viewNamed: (name: string) => string;
  readonly back: string;
  readonly empty: string;
  readonly noMatch: string;
}

export interface SnippetLibraryProps {
  readonly entries?: readonly SnippetLibraryEntry[];
  readonly source?: SnippetLibrarySource;
  readonly labels: SnippetLibraryLabels;
  readonly busy?: boolean;
  /** Optional navigation shown beside the library title while browsing. */
  readonly headerAction?: ComponentChildren;
  readonly onInspect?: (entry: SnippetLibraryEntry) => void;
  readonly onBack?: () => void;
}

/** Search snippet metadata and present caller-supplied source as exact, selectable text. */
export function SnippetLibrary({
  entries = [],
  source,
  labels,
  busy = false,
  headerAction,
  onInspect,
  onBack,
}: SnippetLibraryProps): JSX.Element {
  const [filter, setFilter] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    (source ? heading.current : search.current)?.focus();
  }, [source]);

  const query = filter.trim().toLocaleLowerCase();
  const matches = entries.filter(({ name, description }) =>
    name.toLocaleLowerCase().includes(query) ||
    description?.toLocaleLowerCase().includes(query)
  );

  return (
    <section class="mcp-view-snippet-library" aria-label={labels.title} aria-busy={busy}>
      <header class="mcp-view-snippet-header">
        <h2>{labels.title}</h2>
        {!source && headerAction}
      </header>
      {source
        ? (
          <div class="mcp-view-snippet-source">
            <h3 ref={heading} tabIndex={-1}>
              <bdi>{source.name}</bdi>
            </h3>
            {source.description && <p dir="auto">{source.description}</p>}
            <div
              class="mcp-view-snippet-code"
              role="region"
              aria-label={labels.viewNamed(source.name)}
              tabIndex={0}
              dir="ltr"
            >
              <CodeBlock>{source.code}</CodeBlock>
            </div>
            {onBack && (
              <Button disabled={busy} onClick={onBack}>
                {labels.back}
              </Button>
            )}
          </div>
        )
        : (
          <>
            <label class="mcp-view-snippet-search">
              {labels.search}
              <input
                class="mcp-view-text-input"
                type="search"
                ref={search}
                value={filter}
                onInput={(event) => setFilter(event.currentTarget.value)}
              />
            </label>
            {matches.length > 0
              ? (
                <ul class="mcp-view-snippet-list">
                  {matches.map((entry) => (
                    <li key={entry.id}>
                      <div>
                        <strong>
                          <bdi>{entry.name}</bdi>
                        </strong>
                        {entry.description && <p dir="auto">{entry.description}</p>}
                      </div>
                      <button
                        class="mcp-view-button"
                        type="button"
                        disabled={busy || !onInspect}
                        aria-label={labels.viewNamed(entry.name)}
                        onClick={() => onInspect?.(entry)}
                      >
                        {labels.view}
                      </button>
                    </li>
                  ))}
                </ul>
              )
              : (
                <p class="mcp-view-snippet-empty" role="status">
                  {entries.length ? labels.noMatch : labels.empty}
                </p>
              )}
          </>
        )}
    </section>
  );
}
