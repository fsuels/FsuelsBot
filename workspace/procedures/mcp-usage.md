# MCP Server Usage Guide
> Model Context Protocol servers for Ghost Broker ecosystem

**Last Updated:** 2026-02-03  
**Config File:** `config/mcp-servers.yaml`

---

## What is MCP?

The **Model Context Protocol (MCP)** is an open standard that enables AI assistants to connect directly with external data sources and services. Instead of manual API integration, MCP provides a universal "language" for AI-to-service communication.

**Key Benefits:**
- Natural language queries to databases and APIs
- Standardized across AI clients (Claude, Cursor, Windsurf)
- No custom integration code needed
- Real-time data access

---

## Available MCP Servers

| Service | Status | Use Case |
|---------|--------|----------|
| **Terminator** | ✅ Available | Desktop automation, mouse/keyboard control |
| **Shopify** | ✅ Available | Orders, products, customers |
| **Google Analytics** | ✅ Available | Traffic, conversions, user behavior |
| **Supabase** | ⏳ Pending T151 | Ghost Broker database queries |

---

## 1. Terminator MCP (Desktop Automation)

### Purpose
Control your entire desktop via AI:
- "Click the submit button in the browser"
- "Type my email into this form"
- "Open Calculator, compute 42 * 17, and tell me the result"
- "Take a screenshot of the current window"

### Quick Setup

**One-liner (Claude Code):**
```bash
claude mcp add terminator "npx -y terminator-mcp-agent@latest"
```

**MCP Config (Cursor, VS Code, Windsurf):**
```json
{
  "mcpServers": {
    "terminator-mcp-agent": {
      "command": "npx",
      "args": ["-y", "terminator-mcp-agent@latest"],
      "env": {
        "LOG_LEVEL": "info",
        "RUST_BACKTRACE": "1"
      }
    }
  }
}
```

### Key Features
- **Uses your browser session** - no need to relogin
- **Doesn't take over cursor/keyboard** - runs in background
- **Multi-modal** - pixels, DOM, and Accessibility tree

### Available Capabilities

| Capability | Description |
|------------|-------------|
| `click` | Click at coordinates or element selector |
| `type` | Type text input |
| `press` | Press keyboard shortcuts |
| `screenshot` | Capture screen or window |
| `find` | Locate elements by text/image |
| `inspect` | Windows UI Automation API |

### Example Queries
```
"Navigate to settings in this app"
"Find the login button and click it"
"Fill out this form with my saved details"
"Check my email and summarize unread messages"
```

---

## 2. Shopify MCP

### Purpose
Query dresslikemommy store data via natural language:
- "Check today's orders"
- "List low-stock products"
- "Show top customers by total spent"

### Setup

```bash
# Clone community server
git clone https://github.com/siddhantbajaj/shopify-mcp-server.git
cd shopify-mcp-server

# Install with uv
uv venv
.venv\Scripts\activate  # Windows
uv pip install -e .
```

### Configuration

Create `.env` in the server directory:
```env
SHOPIFY_SHOP_URL=dresslikemommy-com.myshopify.com
SHOPIFY_API_KEY=your_api_key
SHOPIFY_PASSWORD=your_api_password
SHOPIFY_ACCESS_TOKEN=your_access_token
```

### Getting Credentials

1. Go to Shopify Admin → Settings → Apps → Develop apps
2. Create new app: "Ghost Broker MCP"
3. Configure Admin API scopes:
   - `read_products`
   - `read_orders`
   - `read_customers`
   - `read_inventory`
4. Install app → Copy Admin API access token

### Available Tools

| Tool | Description | Example |
|------|-------------|---------|
| `get-product-list` | List products with details | "Show all products under $50" |
| `get-customer-list` | Customer data with order history | "Find VIP customers (5+ orders)" |

### Example Queries

```
"How many products do we have?"
"List the 5 most expensive products"
"Show customers who spent over $200 total"
"What products are from vendor 'BuckyDrop'?"
```

---

## 2. Google Analytics MCP

### Purpose
Query GA4 data conversationally:
- "How many users visited yesterday?"
- "What's our conversion rate this week?"
- "Which traffic sources drive revenue?"

### Setup

```bash
git clone https://github.com/googleanalytics/google-analytics-mcp.git
cd google-analytics-mcp
npm install
```

### Configuration

Requires Google Cloud setup:
1. Create project in Google Cloud Console
2. Enable Analytics Data API
3. Create service account or OAuth credentials
4. Grant access to GA4 property

### Example Queries

```
"How many users did I have yesterday?"
"What were my top selling products yesterday?"
"What's the bounce rate for mobile vs desktop?"
"Which landing pages have the highest conversion?"
"Create a data-driven marketing plan with $5k/month budget"
```

### Use Cases for Ghost Broker

- **Daily Briefings:** "Summarize yesterday's traffic and conversions"
- **Trend Analysis:** "Compare this week's performance to last week"
- **Marketing Insights:** "Which campaigns are driving the most revenue?"
- **Product Research:** "What products do people view but not buy?"

---

## 3. Supabase MCP

### Purpose
Direct database queries for Ghost Broker backend:
- User management
- Agent configurations
- Analytics data

### Status
⏳ **Pending:** Requires T151 (Ghost Broker backend) completion

### Setup (When Ready)

**Option A: Hosted MCP (Simplest)**
```json
{
  "mcpServers": {
    "supabase": {
      "type": "http",
      "url": "https://mcp.supabase.com/mcp?project_ref=YOUR_PROJECT_REF&read_only=true"
    }
  }
}
```

**Option B: CI/Automated**
```json
{
  "mcpServers": {
    "supabase": {
      "type": "http",
      "url": "https://mcp.supabase.com/mcp?project_ref=${SUPABASE_PROJECT_REF}",
      "headers": {
        "Authorization": "Bearer ${SUPABASE_ACCESS_TOKEN}"
      }
    }
  }
}
```

### Security Best Practices

⚠️ **CRITICAL:** Follow these for any Supabase MCP usage:

1. **Never use production data** — MCP is for development only
2. **Enable read_only=true** — Prevents accidental writes
3. **Scope to project_ref** — Don't expose all projects
4. **Use branching** — Test changes safely before production

### Available Tool Groups

| Group | Tools | Description |
|-------|-------|-------------|
| `database` | list_tables, execute_sql, apply_migration | Query and modify schema |
| `debugging` | get_logs, get_postgres_config | Troubleshoot issues |
| `development` | generate_types | TypeScript types from schema |
| `docs` | search_docs | Search Supabase documentation |
| `functions` | list/deploy edge functions | Serverless functions |
| `storage` | list buckets/objects | File storage management |
| `branching` | create/merge branches | Database branching (paid) |

### Example Queries (When Ready)

```
"What tables are in the database?"
"Show all users who signed up this week"
"Find agents with configuration errors"
"What are the most common user actions?"
"Generate TypeScript types for the users table"
```

---

## Integration with Clawdbot

### Current State
Clawdbot uses **direct tool calls** rather than MCP. MCP is designed for:
- Claude Desktop
- Cursor IDE
- Windsurf
- Other MCP-compatible clients

### Future Integration
To add MCP to Clawdbot:
1. Create skill wrapper for MCP client
2. Route natural language queries through MCP
3. Return structured responses

### Alternative: Direct API Calls
For Clawdbot, consider creating direct Shopify/Supabase skills:
- `skills/shopify/` — Direct Admin API integration
- `skills/supabase/` — Direct Supabase client

This gives more control than MCP's generic interface.

---

## Quick Reference

### Shopify
```
# Start server
python -m shopify_mcp_server.server

# Required env vars
SHOPIFY_SHOP_URL, SHOPIFY_API_KEY, SHOPIFY_PASSWORD, SHOPIFY_ACCESS_TOKEN
```

### Google Analytics
```
# Start server
npm start (from google-analytics-mcp directory)

# Required: Google Cloud OAuth or service account
```

### Supabase
```
# Hosted URL (no local server needed)
https://mcp.supabase.com/mcp?project_ref=YOUR_REF&read_only=true

# Auth: Browser OAuth or PAT in Authorization header
```

---

## Resources

- **MCP Specification:** https://modelcontextprotocol.io
- **Shopify MCP:** https://github.com/siddhantbajaj/shopify-mcp-server
- **Shopify Official:** https://shopify.dev/docs/apps/build/storefront-mcp
- **Supabase MCP:** https://supabase.com/docs/guides/getting-started/mcp
- **Google Analytics MCP:** https://developers.google.com/analytics/devguides/MCP
