# User Flow — From local data to shareable dashboard

> How a non-technical user creates and shares a dashboard with mcp-compose.

## Prerequisites

- mcp-compose CLI installed (`deno install -g jsr:@mcpview/compose`)
- An agent (LLM) that guides the process
- Data sources: local databases, cloud APIs, or both

## The 4-step flow

### 1. DISCOVER — Agent reads available MCPs

The agent reads the static manifests from the MCP registry (JSR). Each manifest declares the MCP's
tools, emits/accepts, and required environment variables.

```
Agent: "What data sources do you want to connect?"
       Available MCPs:
       - postgres (local DB)
       - mcp-einvoice (Iopole API)
       - mcp-erpnext (ERPNext)
       - ...

User:  "My postgres database and Iopole invoices"
```

No MCP is started at this point. The agent works from metadata only.

### 2. CONFIGURE — User provides credentials

The agent reads `requiredEnv` from each manifest and asks for the missing values.

```
Agent: "I need these credentials:"
       postgres: DATABASE_URL
       einvoice: IOPOLE_CLIENT_ID, IOPOLE_CLIENT_SECRET, IOPOLE_CUSTOMER_ID

User:  DATABASE_URL=postgres://localhost:5432/mydb
       IOPOLE_CLIENT_ID=xxx
       ...
```

Credentials are stored locally (`.env` or keychain). Never sent to the cloud.

### 3. COMPOSE — Agent generates template, user previews locally

The agent generates a YAML template with the layout, sync rules, and sources. The runtime starts the
MCPs locally, composes the dashboard, and serves it on localhost for preview.

```
Agent: "I've composed a dashboard with:"
       - Invoice list (left sidebar)
       - Invoice detail (center)
       - Monthly chart (bottom)
       Layout: areas grid with sidebar + main + bottom

       Preview: http://localhost:8080
       "Does this look right?"

User:  "Move the chart to the right instead of bottom"

Agent: → updates the YAML template, recomposes
       "Updated. Check http://localhost:8080"

User:  "Perfect, deploy it"
```

The YAML template:

```yaml
name: Invoice Dashboard
sources:
  - id: invoices
    manifest: mcp-einvoice
    calls:
      - tool: einvoice_invoice_search
  - id: detail
    manifest: mcp-einvoice
    calls:
      - tool: einvoice_invoice_detail
        args: { invoice_id: "{{selected_invoice}}" }
  - id: chart
    manifest: postgres
    calls:
      - tool: query
        args: { sql: "SELECT month, sum(amount) FROM invoices GROUP BY month" }
orchestration:
  layout:
    areas:
      - [invoices, detail, chart]
    columns: [1, 2, 1]
    gap: normal
  sync:
    - from: "mcp-einvoice:einvoice_invoice_search"
      event: "invoice.selected"
      to: "mcp-einvoice:einvoice_invoice_detail"
      action: "invoice.show"
```

### 4. DEPLOY — Shareable link, tunnel for local data

The runtime deploys a relay worker on Deno Deploy and opens a WebSocket tunnel for MCPs that need
local data access.

```
Agent: "Deploying..."
       ✓ Relay created on Deno Deploy
       ✓ mcp-einvoice connected (cloud — Iopole API)
       ✓ postgres connected (local — tunnel via WebSocket)

       Dashboard: https://dashboard-abc123.deno.dev
       Share this link. Active while your machine is running.

User:  → sends link to colleague
       → colleague opens dashboard, sees live data
       → data comes from user's local DB via tunnel
```

## Mixed sources in one dashboard

A single dashboard can combine:

- **Local MCPs** (postgres → Docker DB, ERPNext → local Docker) → Data stays local, tunnel routes
  tool calls
- **Cloud MCPs** (einvoice → Iopole API) → MCP runs on Deploy or connects directly

The agent and the user don't need to think about this distinction. The manifest declares the
transport type, the runtime handles the rest.

## What you can build

Any application that can be expressed as:

- Multiple data sources (MCPs)
- Composed into a layout (areas grid)
- With cross-UI events (sync rules)
- Served as a web dashboard

Examples:

- **Business dashboard**: invoices + CRM + charts from multiple sources
- **System monitoring**: local metrics + cloud alerts + status timeline
- **Data exploration**: DB browser + visualization + filters
- **Operations console**: order management + inventory + logistics

The limit is the available MCP catalog. If there's a MCP for the data source, it can be composed
into a dashboard.

## Lifecycle

```
compose  → preview locally → iterate with agent
deploy   → shareable link → tunnel keeps data local
teardown → relay deleted, tunnel closed, link dies
```

The shareable link is ephemeral by default. When the user stops the CLI (Ctrl+C or machine
shutdown), the tunnel drops and the link stops working. The relay is cleaned up on Deno Deploy.
