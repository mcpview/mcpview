/// <reference lib="dom" />
/**
 * List view: shows 3 mocked invoices. Click a row → ctx.navigate("detail", { id }).
 */

import { defineView } from "@mcpview/view";
import type { AppState, Invoice } from "./state.ts";

const MOCK_INVOICES: Invoice[] = [
  {
    id: "inv-001",
    number: "F-2026-0001",
    customer: "Acme Corp",
    amount: 1250.0,
    currency: "EUR",
    status: "paid",
    issuedAt: "2026-03-14",
  },
  {
    id: "inv-002",
    number: "F-2026-0002",
    customer: "Globex SA",
    amount: 4890.5,
    currency: "EUR",
    status: "pending",
    issuedAt: "2026-03-28",
  },
  {
    id: "inv-003",
    number: "F-2026-0003",
    customer: "Initech SARL",
    amount: 320.75,
    currency: "EUR",
    status: "overdue",
    issuedAt: "2026-02-10",
  },
];

export const listView = defineView<AppState, void, Invoice[]>({
  onEnter(ctx) {
    // Keep invoices in shared state so the detail view can look them up
    // without a second callTool. In a real app you'd call
    // ctx.callTool("einvoice_invoice_search") here.
    ctx.state.invoices = MOCK_INVOICES;
    return MOCK_INVOICES;
  },

  render(_ctx, invoices) {
    const rows = invoices
      .map(
        (inv) => `
        <tr class="row" data-id="${inv.id}" tabindex="0" role="button"
            aria-label="Open invoice ${inv.number}">
          <td class="num">${inv.number}</td>
          <td>${escapeHtml(inv.customer)}</td>
          <td class="amount">${formatMoney(inv.amount, inv.currency)}</td>
          <td><span class="status status-${inv.status}">${inv.status}</span></td>
          <td class="date">${inv.issuedAt}</td>
        </tr>`,
      )
      .join("");

    // onLeave will remove the listener; we attach it after mount via
    // a microtask because innerHTML replaces the DOM *after* render() returns.
    queueMicrotask(() => attachRowHandlers());

    return `
      <header class="app-header">
        <h1>Invoices</h1>
        <p class="muted">${invoices.length} results · SPA navigation, no chat roundtrip</p>
      </header>
      <table class="invoices" aria-label="Invoice list">
        <thead>
          <tr>
            <th scope="col">Number</th>
            <th scope="col">Customer</th>
            <th scope="col" class="amount">Amount</th>
            <th scope="col">Status</th>
            <th scope="col">Issued</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  },
});

function attachRowHandlers(): void {
  const handle = (el: Element) => {
    const id = (el as HTMLElement).dataset.id;
    if (!id) return;
    // Navigate via the globally-exposed handle (see main.ts).
    // deno-lint-ignore no-explicit-any
    const h = (globalThis as any).__mcpApp;
    if (h) h.navigate("detail", { id });
  };

  document.querySelectorAll(".row").forEach((row) => {
    row.addEventListener("click", () => handle(row));
    row.addEventListener("keydown", (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === "Enter" || ke.key === " ") {
        ke.preventDefault();
        handle(row);
      }
    });
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
