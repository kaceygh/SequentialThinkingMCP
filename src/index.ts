import { Server, StreamableHttpTransport, SSETransport } from '@modelcontextprotocol/sdk';

// Initialize MCP Server
const server = new Server({
  transports: [
    new StreamableHttpTransport(),
    new SSETransport()
  ]
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Sequential Thinking MCP Server running on port ${PORT}`);
});

// Health check endpoint
server.app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});
