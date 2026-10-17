/// <reference lib="dom" />
/**
 * Detail view: shows one invoice + Back button. Back → ctx.navigate("list").
 */

import { defineView } from "@mcpview/view";
import type { AppState, Invoice } from "./state.ts";

export const detailView = defineView<AppState, { id: string }, Invoice | null>({
  onEnter(ctx, { id }) {
    // In a real app: const res = await ctx.callTool("einvoice_invoice_get", { id });
    const found = ctx.state.invoices?.find((i) => i.id === id) ?? null;
    return found;
  },

  render(_ctx, invoice) {
    if (!invoice) {
      queueMicrotask(attachBack);
      return `
        <header class="app-header">
          <button id="back" class="btn-back" aria-label="Back to list">← Back</button>
          <h1>Not found</h1>
        </header>
        <p class="muted">This invoice does not exist.</p>
      `;
    }

    queueMicrotask(attachBack);
    return `
      <header class="app-header">
        <button id="back" class="btn-back" aria-label="Back to list">← Back</button>
        <h1>${escapeHtml(invoice.number)}</h1>
      </header>
      <dl class="detail">
        <dt>Customer</dt><dd>${escapeHtml(invoice.customer)}</dd>
        <dt>Amount</dt><dd>${formatMoney(invoice.amount, invoice.currency)}</dd>
        <dt>Status</dt><dd><span class="status status-${invoice.status}">${invoice.status}</span></dd>
        <dt>Issued</dt><dd>${invoice.issuedAt}</dd>
        <dt>Invoice ID</dt><dd><code>${invoice.id}</code></dd>
      </dl>
      <p class="muted">
        Navigated here via <code>ctx.navigate("detail", { id })</code> —
        no <code>sendMessage</code>, no chat roundtrip, no new viewer card.
      </p>
    `;
  },
});

function attachBack(): void {
  const btn = document.getElementById("back");
  if (!btn) return;
  btn.addEventListener("click", () => {
    // deno-lint-ignore no-explicit-any
    const h = (globalThis as any).__mcpApp;
    if (h) h.navigate("list");
  });
}

function formatMoney(n: number, ccy: string): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: ccy })
    .format(n);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }
    )[c]!);
}
