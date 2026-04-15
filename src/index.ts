import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { SERVER_NAME, SERVER_VERSION, DEFAULT_PORT, MCP_PATH } from "./constants.js";
import { authMiddleware } from "./services/auth.js";
import { registerPrinterTools } from "./tools/printer.js";
import { isMacConfigured } from "./services/converter.js";

function createServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  registerPrinterTools(server);

  return server;
}

async function main(): Promise<void> {
  const app = express();

  // Parse JSON bodies (MCP uses JSON-RPC)
  app.use(express.json({ limit: "100mb" }));

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", name: SERVER_NAME, version: SERVER_VERSION });
  });

  // MCP endpoint with authentication
  app.post(MCP_PATH, authMiddleware, async (req, res) => {
    const server = createServer();

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // Handle GET and DELETE for MCP protocol (required by spec for session mgmt)
  app.get(MCP_PATH, (_req, res) => {
    res.writeHead(405).end(JSON.stringify({ error: "Method not allowed. Use POST for MCP requests." }));
  });

  app.delete(MCP_PATH, (_req, res) => {
    res.writeHead(405).end(JSON.stringify({ error: "Method not allowed. Sessions are not supported." }));
  });

  const port = parseInt(process.env.PORT || String(DEFAULT_PORT), 10);
  app.listen(port, "0.0.0.0", () => {
    console.error(`${SERVER_NAME} v${SERVER_VERSION} running on http://0.0.0.0:${port}${MCP_PATH}`);
    console.error(`Health check: http://0.0.0.0:${port}/health`);
    if (process.env.MCP_API_KEY) {
      console.error("API key authentication: ENABLED");
    } else {
      console.error("API key authentication: DISABLED (set MCP_API_KEY to enable)");
    }
    if (isMacConfigured()) {
      console.error(`Mac converter: ENABLED (${process.env.MAC_USER}@${process.env.MAC_HOST})`);
    } else {
      console.error("Mac converter: DISABLED (set MAC_HOST + MAC_USER for Office conversion)");
    }
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
