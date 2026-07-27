// SequentialThinkingMCP - ESM + Streamable HTTP transport (2026-07-27)
// Uses SDK official StreamableHTTPServerTransport, no supergateway needed.
// HTTP endpoints:
//   - /mcp     : MCP over Streamable HTTP (POST initialize/tools.list/tools.call; GET SSE stream)
//   - /health  : dcdeploy health check
//   - /sse     : legacy SSE heartbeat (kept for compatibility; real MCP is under /mcp)

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

// ---------------------------------------------------------------------------
// Sequential Thinking in-memory state (single default session)
// ---------------------------------------------------------------------------
const sessions = new Map();
function getSession(id) {
  if (!sessions.has(id)) sessions.set(id, { thoughts: [], branches: {} });
  return sessions.get(id);
}

// ---------------------------------------------------------------------------
// MCP Server factory (one McpServer instance per HTTP session)
// Each session needs its own server instance because SDK 1.29 McpServer
// only allows a single connect() call per instance.
// ---------------------------------------------------------------------------
function createMcpServer() {
  const server = new McpServer(
    { name: 'sequentialthinking-mcp', version: '1.0.0' },
    { capabilities: { tools: {}, logging: {} } }
  );
  registerTools(server);
  return server;
}

function registerTools(mcp) {
  mcp.tool('sequentialthinking',
  'A detailed tool for dynamic and reflective problem-solving. Breaks complex tasks into discrete steps, supports branching and revision of previous thoughts.',
  {
    thought: z.string().describe('Current thinking step'),
    nextThoughtNeeded: z.boolean().describe('Whether another thought step is needed'),
    thoughtNumber: z.number().int().min(1).describe('Thought number (1-indexed)'),
    totalThoughts: z.number().int().min(1).describe('Total expected thoughts'),
    isRevision: z.boolean().optional().describe('Whether this revises a previous thought'),
    revisesThought: z.number().int().min(1).optional().describe('Which thought number is being revised'),
    branchFromThought: z.number().int().min(1).optional().describe('Branching point thought number'),
    branchId: z.string().optional().describe('Branch identifier')
  },
  async (args) => {
    const sess = getSession('default');
    const record = {
      thoughtNumber: args.thoughtNumber,
      thought: args.thought,
      nextThoughtNeeded: args.nextThoughtNeeded,
      isRevision: !!args.isRevision,
      revisesThought: args.revisesThought ?? null,
      branchFromThought: args.branchFromThought ?? null,
      branchId: args.branchId ?? null,
      timestamp: new Date().toISOString()
    };
    sess.thoughts.push(record);
    if (record.branchFromThought) {
      const bid = record.branchId || 'default';
      if (!sess.branches[bid]) sess.branches[bid] = [];
      sess.branches[bid].push(record);
    }
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          thoughtNumber: record.thoughtNumber,
          totalThoughts: args.totalThoughts,
          nextThoughtNeeded: record.nextThoughtNeeded,
          branches: Object.keys(sess.branches),
          thoughtHistoryLength: sess.thoughts.length
        }, null, 2)
      }]
    };
  }
);

mcp.tool(
  'get_thoughts',
  'Retrieve the current sequential thinking history (debugging / inspection).',
  {},
  async () => {
    const sess = getSession('default');
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ thoughts: sess.thoughts, branches: sess.branches }, null, 2)
      }]
    };
  }
);

mcp.tool(
  'clear_thoughts',
  'Reset the sequential thinking history.',
  {},
  async () => {
    sessions.delete('default');
    return { content: [{ type: 'text', text: JSON.stringify({ cleared: true }) }] };
  }
);
}

// ---------------------------------------------------------------------------
// Streamable HTTP transport (stateful: one transport per session)
// We create a new transport on initialize, store by session id.
// ---------------------------------------------------------------------------
const httpTransports = new Map(); // sessionId -> { transport }

// ---------------------------------------------------------------------------
// Express HTTP server
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: '10mb' }));
const PORT = process.env.PORT || 8000;
const START_TIME = Date.now();

// dcdeploy health check
// Root path responds OK for health probes that hit /
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'sequentialthinking-mcp',
    endpoints: { health: '/health', mcp: '/mcp' }
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    uptime_s: Math.floor((Date.now() - START_TIME) / 1000),
    timestamp: new Date().toISOString(),
    service: 'sequentialthinking-mcp',
    mcp_tools: ['sequentialthinking', 'get_thoughts', 'clear_thoughts'],
    transports: ['streamable-http'],
    active_sessions: httpTransports.size
  });
});

// MCP Streamable HTTP endpoint: handles POST (initialize/tools/call) and GET (SSE stream)
app.post('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  const existing = sessionId ? httpTransports.get(sessionId) : undefined;
  try {
    if (existing) {
      // Reuse existing transport for this session
      await existing.transport.handleRequest(req, res, req.body);
      return;
    }
    if (!sessionId && isInitializeRequest(req.body)) {
      // New initialization request: create transport + server, connect BEFORE handling
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          // Store transport once session is fully initialized (avoids race)
          httpTransports.set(sid, { transport, server: sessionServer });
          console.log(`Session initialized: ${sid}, total: ${httpTransports.size}`);
        }
      });
      const sessionServer = createMcpServer();
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && httpTransports.has(sid)) {
          httpTransports.delete(sid);
          sessionServer.close().catch(() => {});
          console.log(`Session closed: ${sid}, remaining: ${httpTransports.size}`);
        }
      };
      // Connect the transport to the MCP server BEFORE handling the request
      await sessionServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }
    // Invalid request: no session id and not an initialize request
    res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
      id: null
    });
  } catch (err) {
    console.error('POST /mcp error:', err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal error', data: err.message },
        id: null
      });
    }
  }
});

app.get('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  if (!sessionId || !httpTransports.has(sessionId)) {
    res.status(400).json({ error: 'invalid_session', message: 'Valid mcp-session-id header required for GET' });
    return;
  }
  await httpTransports.get(sessionId).transport.handleRequest(req, res);
});

app.delete('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  if (!sessionId || !httpTransports.has(sessionId)) {
    res.status(400).json({ error: 'invalid_session' });
    return;
  }
  const entry = httpTransports.get(sessionId);
  await entry.transport.handleRequest(req, res, req.body);
});

// Legacy SSE heartbeat endpoint (for backward compat, clients that expect /sse)
app.get('/sse', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.write(`event: ready\ndata: ${JSON.stringify({ service: 'sequentialthinking-mcp', time: new Date().toISOString(), mcp_endpoint: '/mcp' })}\n\n`);
  const timer = setInterval(() => {
    res.write(`event: ping\ndata: ${JSON.stringify({ time: new Date().toISOString() })}\n\n`);
  }, 15000);
  req.on('close', () => clearInterval(timer));
});

const HOST = '0.0.0.0';
const server = app.listen(PORT, HOST, () => {
  console.log(`SequentialThinkingMCP listening on ${HOST}:${PORT}`);
  console.log(`  Health:   http://localhost:${PORT}/health`);
  console.log(`  MCP:      http://localhost:${PORT}/mcp  (Streamable HTTP)`);
  console.log(`  Legacy:   http://localhost:${PORT}/sse  (heartbeat only)`);
  console.log(`  Tools:    sequentialthinking, get_thoughts, clear_thoughts`);
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
async function shutdown(signal) {
  console.log(`Received ${signal}, shutting down...`);
  for (const [id, entry] of httpTransports) {
    try { await entry.transport.close(); } catch (e) {}
    try { await entry.server.close(); } catch (e) {}
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
