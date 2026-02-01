# Ghost Broker AI - Tawk.to Auto-Responder

Cloudflare Worker that automatically responds to Tawk.to chat messages as Ghost Broker AI.

## Setup

### 1. Get API Keys

**Tawk.to API Key:**
1. Go to Tawk.to Dashboard → Administration → Settings → API Access
2. Create new API key with chat permissions
3. Copy the key

**Anthropic API Key:**
- Get from https://console.anthropic.com/

### 2. Deploy to Cloudflare Workers

```bash
# Install wrangler
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Set secrets
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put TAWK_API_KEY

# Deploy
wrangler deploy
```

### 3. Configure Tawk.to Webhook

1. Go to Tawk.to Dashboard → Administration → Settings → Webhooks
2. Add new webhook:
   - URL: `https://ghost-broker-chat.<your-subdomain>.workers.dev`
   - Events: `chat:start`, `chat:message`
3. Save

## How It Works

1. Visitor opens chat → Webhook fires `chat:start` → Bot sends welcome
2. Visitor sends message → Webhook fires `chat:message` → Claude generates response → Bot replies

## Cost

- **Cloudflare Workers**: Free tier = 100,000 requests/day
- **Claude API**: ~$0.003 per message (Sonnet)

## Customization

Edit `GHOST_BROKER_PERSONA` in worker.js to change the AI's personality.
