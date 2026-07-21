const { MCPServer, StdioServerTransport } = require('@modelcontextprotocol/sdk');
const http = require('http');

// 1. 初始化 MCP 服务器
const server = new MCPServer();
const transport = new StdioServerTransport();
server.connect(transport);

// 2. 创建 HTTP 服务器（健康检查 + SSE 转发）
const PORT = 8000;
const httpServer = http.createServer((req, res) => {
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'healthy' }));
    return;
  }
  
  res.writeHead(404);
  res.end('Not Found');
});

// 3. 启动 HTTP 服务器
httpServer.listen(PORT, () => {
  console.log(`Health check server running on port ${PORT}`);
  console.log('Sequential Thinking MCP Server started');
});

// 4. 优雅退出
process.on('SIGTERM', () => {
  httpServer.close();
  process.exit(0);
});
