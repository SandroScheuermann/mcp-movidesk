import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MovideskClient } from "./movideskClient.js";
import { registerTools } from "./tools.js";

const token = process.env.MOVIDESK_TOKEN;

if (!token) {
  console.error("MOVIDESK_TOKEN nao configurado.");
  process.exit(1);
}

const server = new McpServer({
  name: "mcp-movidesk",
  version: "0.1.0"
});

const client = new MovideskClient({ token });

registerTools(server, client);

const transport = new StdioServerTransport();
await server.connect(transport);

console.error("Movidesk MCP server iniciado via stdio.");
