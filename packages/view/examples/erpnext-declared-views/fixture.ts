/** Read-only Frappe HTTP fixture for the unmodified @casys/mcp-erpnext 3.5.0 server. */
function invoice(id: number, customer: string, amount: number, due_date: string, status: string) {
  return {
    doctype: "Sales Invoice",
    name: `SYN-INV-${String(id).padStart(3, "0")}`,
    customer,
    company: "Test Only",
    due_date,
    posting_date: "2026-05-01",
    docstatus: 1,
    status,
    grand_total: amount || 999,
    outstanding_amount: amount,
    currency: "EUR",
    party_account_currency: "EUR",
    modified: `2026-06-0${id}`,
  };
}
const rows = [
  invoice(1, "Fixture Amber", 120, "2026-06-01", "Overdue"),
  invoice(2, "Fixture Blue", 180, "2026-06-02", "Overdue"),
  invoice(3, "Fixture Settled", 0, "2026-06-01", "Paid"),
  invoice(4, "Fixture Future", 45, "2099-01-01", "Unpaid"),
];
type Field = keyof typeof rows[number];
function compare(a: string | number, b: string | number) {
  return a < b ? -1 : a > b ? 1 : 0;
}
function parse(query: URLSearchParams, key: string, fallback: unknown) {
  const s = query.get(key);
  return s ? JSON.parse(s) : fallback;
}
const port = Number(Deno.args[0] ?? 45790);
Deno.serve({ hostname: "127.0.0.1", port }, (request) => {
  if (request.method !== "GET") {
    return Response.json({ error: "Read-only fixture" }, { status: 405 });
  }
  const url = new URL(request.url);
  const path = decodeURIComponent(url.pathname);
  const q = url.searchParams;
  if (path === "/api/resource/DocType/Sales Invoice") {
    return Response.json({
      data: {
        name: "Sales Invoice",
        fields: Object.keys(rows[0]).map((fieldname) => ({
          fieldname,
          label: fieldname,
          fieldtype: "Data",
          in_list_view: 1,
        })),
      },
    });
  }
  if (path.startsWith("/api/resource/Sales Invoice/")) {
    const row = rows.find((r) => r.name === path.split("/").pop());
    return row
      ? Response.json({ data: { ...row, items: [] } })
      : Response.json({ error: "Missing invoice" }, { status: 404 });
  }
  if (path === "/api/resource/Sales Invoice") {
    try {
      let filtered = [...rows];
      for (const filter of parse(q, "filters", [])) {
        const [field, op, value] = filter.slice(-3) as [Field, string, string | number];
        if (!Object.hasOwn(rows[0], field) || !["=", ">", "<", ">=", "<=", "in"].includes(op)) {
          throw new Error("Unsupported filter");
        }
        filtered = filtered.filter((r) => {
          const c = compare(r[field], value);
          switch (op) {
            case "=":
              return c === 0;
            case ">":
              return c > 0;
            case "<":
              return c < 0;
            case ">=":
              return c >= 0;
            case "<=":
              return c <= 0;
            default:
              return Array.isArray(value) && value.includes(r[field]);
          }
        });
      }
      for (const term of (q.get("order_by") ?? "name asc").split(",").reverse()) {
        const [field, direction] = term.trim().split(/\s+/);
        filtered.sort((a, b) =>
          compare(a[field as Field], b[field as Field]) *
          (direction?.toLowerCase() === "desc" ? -1 : 1)
        );
      }
      const start = Number(q.get("limit_start") ?? 0),
        limit = Number(q.get("limit_page_length") ?? q.get("limit") ?? 20);
      const fields: string[] = parse(q, "fields", ["*"]);
      const data = filtered.slice(start, start + limit).map((r) =>
        fields.includes("*") ? r : Object.fromEntries(
          fields.filter((f) => Object.hasOwn(r, f)).map((f) => [f, r[f as Field]]),
        )
      );
      return Response.json({ data });
    } catch {
      return Response.json({ error: "Unsupported fixture query" }, { status: 400 });
    }
  }
  if (path.startsWith("/api/method/")) return Response.json({ message: [] });
  return Response.json({ error: "Unknown fixture route" }, { status: 404 });
});
