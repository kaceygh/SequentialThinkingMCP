// SequentialThinkingMCP — MCP v2 无状态版（2026-07-28 规范）
// 迁移自 v1 会话式（原版：index.js.bak-v1-migrate）
// v2 API: McpServer.registerTool(name, config, cb)，inputSchema 用 z.object()
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { createMcpExpressApp } from '@modelcontextprotocol/express';

// ---------- 构建 MCP Server（无状态：每请求重建） ----------
function buildMcpServer() {
  const server = new McpServer({ name: 'SequentialThinkingMCP', version: '2.0.0' });

  server.registerTool(
    'sequentialthinking',
    {
      description: '思维链推理工具：模型通过持续调用按编号积累思考历史，支持修订(revise)与分支(branch)。',
      inputSchema: z.object({
        thought: z.string().describe('当前思考内容'),
        thoughtNumber: z.number().int().positive().describe('当前思考编号(1起)'),
        totalThoughts: z.number().int().positive().describe('计划思考总数'),
        nextThoughtNeeded: z.boolean().describe('是否还需继续思考'),
        branchId: z.string().optional().describe('分支标识'),
        isRevision: z.boolean().optional().describe('是否修订前序思考'),
        reviseThoughtNumber: z.number().int().positive().optional().describe('被修订的思考编号'),
      }),
    },
    async (args) => {
      const tag = args.isRevision ? 'REVISION' : args.branchId ? 'BRANCH' : 'THOUGHT';
      const text = '[' + tag + ' #' + args.thoughtNumber + '/' + args.totalThoughts + '] ' + args.thought +
        (args.nextThoughtNeeded ? ' (继续)' : ' (完成)');
      return {
        content: [{ type: 'text', text }],
        structuredContent: {
          thoughtNumber: args.thoughtNumber,
          totalThoughts: args.totalThoughts,
          nextThoughtNeeded: args.nextThoughtNeeded,
          branchId: args.branchId ?? null,
          isRevision: !!args.isRevision,
          reviseThoughtNumber: args.reviseThoughtNumber ?? null,
        },
      };
    }
  );

  server.registerTool(
    'clear_thoughts',
    {
      description: '清除思维历史，开始新的思考链（无状态下作为状态重置提示）。',
      inputSchema: z.object({
        branchId: z.string().optional().describe('可选：清除特定分支'),
      }),
    },
    async () => ({
      content: [{ type: 'text', text: '思维历史已重置，可开始新的思考链。' }],
      structuredContent: { cleared: true },
    })
  );


  server.registerTool(
    'get_thoughts',
    {
      description: '检索当前思维链历史（调试/检查）。无状态下由调用方携带 thoughts 历史，此处回显供梳理。',
      inputSchema: z.object({
        thoughts: z.array(z.object({
          thought: z.string(),
          thoughtNumber: z.number().int().positive(),
          branchId: z.string().optional(),
        })).optional().describe('调用方累积的思考历史'),
      }),
    },
    async (args) => {
      const thoughts = args.thoughts ?? [];
      return {
        content: [{ type: 'text', text: JSON.stringify({ thoughts, count: thoughts.length }, null, 2) }],
        structuredContent: { count: thoughts.length, thoughts },
      };
    }
  );

  return server;
}

// ---------- HTTP 服务（Express 适配器 + 手挂无状态 /mcp） ----------
const PORT = process.env.PORT || 8000;
const app = createMcpExpressApp();

// 健康检查（兼容 dcdeploy 探测 /health；v2 无状态）
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'SequentialThinkingMCP',
    version: '2.0.0',
    protocol: '2026-07-28',
    transport: 'streamable-http (stateless)',
    mcp_endpoint: '/mcp',
    mcp_tools: ['sequentialthinking', 'get_thoughts', 'clear_thoughts'],
  });
});

// MCP Streamable HTTP 无状态入口：每请求新建 transport + server
app.post('/mcp', async (req, res) => {
  try {
    const transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // 无状态：不生成 session，每请求独立
    });
    const server = buildMcpServer();
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('POST /mcp error:', err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error', data: String(err.message) }, id: null });
    }
  }
});

// 根入口指引
app.get('/', (_req, res) => {
  res.type('text/plain').send('SequentialThinkingMCP v2 (stateless) — 使用 POST /mcp 调用 MCP');
});

app.listen(PORT, () => {
  console.log('SequentialThinkingMCP v2 (stateless) listening on :' + PORT);
  console.log('  Health:  GET  /health');
  console.log('  MCP:     POST /mcp  (Streamable HTTP, no session)');
  console.log('  Tools:   sequentialthinking, get_thoughts, clear_thoughts');
});
