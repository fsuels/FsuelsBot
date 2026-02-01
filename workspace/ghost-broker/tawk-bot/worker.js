/**
 * Ghost Broker AI - Tawk.to Auto-Responder
 * Cloudflare Worker that responds to chat messages as Ghost Broker AI
 */

const GHOST_BROKER_PERSONA = `You are Ghost Broker AI, an intelligent AI agent assistant. 
You help users understand AI agents, automation, and how Ghost Broker can help them.
Be helpful, concise, and friendly. Keep responses under 200 words.
If asked about pricing or specific services, direct them to book a consultation.
Website: https://ghostbrokerai.xyz`;

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    try {
      const payload = await request.json();
      
      // Tawk.to webhook events: chat:start, chat:message, chat:end, ticket:create
      const event = payload.event;
      
      if (event === 'chat:start') {
        // Send welcome message
        await sendTawkMessage(env, payload.chatId, 
          "👻 Hey! I'm Ghost Broker AI. How can I help you with AI agents today?");
        return new Response('OK');
      }
      
      if (event === 'chat:message' && payload.message?.sender?.type === 'visitor') {
        // Visitor sent a message - generate AI response
        const visitorMessage = payload.message.text;
        const aiResponse = await generateResponse(env, visitorMessage);
        await sendTawkMessage(env, payload.chatId, aiResponse);
        return new Response('OK');
      }
      
      return new Response('OK');
    } catch (error) {
      console.error('Error:', error);
      return new Response('Error: ' + error.message, { status: 500 });
    }
  },
};

async function generateResponse(env, userMessage) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system: GHOST_BROKER_PERSONA,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  const data = await response.json();
  return data.content[0].text;
}

async function sendTawkMessage(env, chatId, message) {
  // Tawk.to REST API to send message
  const response = await fetch(`https://api.tawk.to/v3/chats/${chatId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.TAWK_API_KEY}`,
    },
    body: JSON.stringify({
      body: message,
      type: 'agent',
    }),
  });
  
  return response.ok;
}
