import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// Create MCP Server
const server = new Server(
  { name: 'sequential-thinking-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// Tool: Sequential Thinking Analysis
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'sequential_thinking_analyze',
        description: 'Perform sequential thinking analysis on a problem or question',
        inputSchema: {
          type: 'object',
          properties: {
            problem: { type: 'string', description: 'The problem or question to analyze' },
            context: { type: 'string', description: 'Optional context for the analysis' }
          },
          required: ['problem']
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  if (name === 'sequential_thinking_analyze') {
    const problem = (args as any).problem as string;
    const context = (args as any).context as string | undefined;
    
    // Sequential thinking logic would go here
    return {
      content: [
        {
          type: 'text',
          text: `Sequential Thinking Analysis for: ${problem}\n\nContext: ${context || 'None provided'}`
        }
      ]
    };
  }
  
  throw new Error(`Unknown tool: ${name}`);
});

// Start server
const transport = new StdioServerTransport();
server.connect(transport);

console.log('Sequential Thinking MCP Server started');
