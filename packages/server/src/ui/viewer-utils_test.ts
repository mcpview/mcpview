/**
 * Tests for MCP Apps viewer utilities
 *
 * Level 1: resolveViewerDistPath — resolves dist HTML path for a viewer
 * Level 2: discoverViewers — auto-discovers viewer directories
 *
 * @module lib/server/src/ui/viewer-utils_test
 */

import { assertEquals } from "@std/assert";
import { discoverViewers, resolveViewerDistPath } from "./viewer-utils.ts";

// ── resolveViewerDistPath ────────────────────────────────────────

Deno.test("resolveViewerDistPath - returns first candidate that exists", () => {
  const exists = (path: string) => path.includes("src/ui/dist/invoice-viewer");
  const result = resolveViewerDistPath(
    "file:///fake/project/server.ts",
    "invoice-viewer",
    exists,
  );
  assertEquals(result?.endsWith("src/ui/dist/invoice-viewer/index.html"), true);
});

Deno.test("resolveViewerDistPath - falls back to ui-dist candidate", () => {
  const exists = (path: string) => path.includes("ui-dist/invoice-viewer");
  const result = resolveViewerDistPath(
    "file:///fake/project/server.ts",
    "invoice-viewer",
    exists,
  );
  assertEquals(result?.endsWith("ui-dist/invoice-viewer/index.html"), true);
});

Deno.test("resolveViewerDistPath - returns null when no candidate exists", () => {
  const exists = () => false;
  const result = resolveViewerDistPath(
    "file:///fake/project/server.ts",
    "invoice-viewer",
    exists,
  );
  assertEquals(result, null);
});

Deno.test("resolveViewerDistPath - handles file:// URLs", () => {
  const exists = (path: string) => path.includes("src/ui/dist/chart");
  const result = resolveViewerDistPath(
    "file:///home/user/project/server.ts",
    "chart",
    exists,
  );
  assertEquals(result !== null, true);
  assertEquals(result!.startsWith("/home/user/project/"), true);
});

Deno.test("resolveViewerDistPath - returns HTTPS URL for remote moduleUrl", () => {
  const exists = (path: string) => path.includes("src/ui/dist/invoice-viewer");
  const result = resolveViewerDistPath(
    "https://jsr.io/@casys/mcp-einvoice/0.5.2/",
    "invoice-viewer",
    exists,
  );
  assertEquals(
    result,
    "https://jsr.io/@casys/mcp-einvoice/0.5.2/src/ui/dist/invoice-viewer/index.html",
  );
});

Deno.test("resolveViewerDistPath - returns null for HTTPS when exists returns false", () => {
  const exists = () => false;
  const result = resolveViewerDistPath(
    "https://jsr.io/@casys/mcp-einvoice/0.5.2/",
    "invoice-viewer",
    exists,
  );
  assertEquals(result, null);
});

Deno.test("resolveViewerDistPath - HTTPS falls back to ui-dist candidate", () => {
  const exists = (path: string) => path.includes("ui-dist/chart");
  const result = resolveViewerDistPath(
    "https://cdn.example.com/pkg/1.0.0/",
    "chart",
    exists,
  );
  assertEquals(
    result,
    "https://cdn.example.com/pkg/1.0.0/ui-dist/chart/index.html",
  );
});

// ── discoverViewers ──────────────────────────────────────────────

Deno.test("discoverViewers - finds directories containing index.html", () => {
  const entries = [
    { name: "invoice-viewer", isDirectory: true },
    { name: "doclist-viewer", isDirectory: true },
    { name: "shared", isDirectory: true },
    { name: "dist", isDirectory: true },
    { name: "node_modules", isDirectory: true },
    { name: "global.css", isDirectory: false },
    { name: "build-all.mjs", isDirectory: false },
  ];
  const readDir = () => entries;
  const hasIndexHtml = (_dir: string, name: string) =>
    ["invoice-viewer", "doclist-viewer"].includes(name);

  const result = discoverViewers("/fake/ui", { readDir, hasIndexHtml });
  assertEquals(result, ["doclist-viewer", "invoice-viewer"]);
});

Deno.test("discoverViewers - skips reserved directories", () => {
  const entries = [
    { name: "shared", isDirectory: true },
    { name: "dist", isDirectory: true },
    { name: "node_modules", isDirectory: true },
    { name: ".cache", isDirectory: true },
  ];
  const readDir = () => entries;
  const hasIndexHtml = () => true;

  const result = discoverViewers("/fake/ui", { readDir, hasIndexHtml });
  assertEquals(result, []);
});

Deno.test("discoverViewers - skips directories without index.html", () => {
  const entries = [
    { name: "invoice-viewer", isDirectory: true },
    { name: "orphan-dir", isDirectory: true },
  ];
  const readDir = () => entries;
  const hasIndexHtml = (_dir: string, name: string) =>
    name === "invoice-viewer";

  const result = discoverViewers("/fake/ui", { readDir, hasIndexHtml });
  assertEquals(result, ["invoice-viewer"]);
});

Deno.test("discoverViewers - returns sorted names", () => {
  const entries = [
    { name: "zebra-viewer", isDirectory: true },
    { name: "alpha-viewer", isDirectory: true },
    { name: "mid-viewer", isDirectory: true },
  ];
  const readDir = () => entries;
  const hasIndexHtml = () => true;

  const result = discoverViewers("/fake/ui", { readDir, hasIndexHtml });
  assertEquals(result, ["alpha-viewer", "mid-viewer", "zebra-viewer"]);
});

Deno.test("discoverViewers - returns empty for empty directory", () => {
  const readDir = () => [];
  const hasIndexHtml = () => true;

  const result = discoverViewers("/fake/ui", { readDir, hasIndexHtml });
  assertEquals(result, []);
});
