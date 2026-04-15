import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import multer from "multer";
import { join } from "node:path";
import { SERVER_NAME, SERVER_VERSION, DEFAULT_PORT, MCP_PATH } from "./constants.js";
import { authMiddleware } from "./services/auth.js";
import { registerPrinterTools } from "./tools/printer.js";
import { getConverterStatus } from "./services/converter.js";
import * as upload from "./services/upload.js";

// ─── Multer setup ───────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, upload.getUploadDir()),
  filename: (_req, file, cb) => {
    const fileId = upload.generateFileId();
    // Preserve original extension
    const ext = file.originalname.includes(".")
      ? "." + file.originalname.split(".").pop()
      : "";
    cb(null, `${fileId}${ext}`);
  },
});
const uploader = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB max
});

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

  // Ensure upload directory exists
  await upload.ensureUploadDir();

  // Cleanup old uploads every 5 minutes
  setInterval(() => upload.cleanupOldFiles(), 5 * 60 * 1000);

  // Parse JSON bodies (MCP uses JSON-RPC)
  app.use(express.json({ limit: "100mb" }));

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", name: SERVER_NAME, version: SERVER_VERSION });
  });

  // ─── File upload endpoint ─────────────────────────────────
  app.post("/upload", uploader.single("file"), (req, res) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No file uploaded. Use multipart/form-data with field name 'file'." });
      return;
    }

    // Extract file_id from saved filename (without extension)
    const fileId = file.filename.replace(/\.[^.]+$/, "");
    const entry = upload.registerFile(fileId, file.originalname, file.path, file.size);

    res.json({
      file_id: entry.file_id,
      filename: entry.filename,
      size: entry.size,
      expires_in: "30 minutes",
      usage: `Use print_uploaded(file_id="${entry.file_id}", cups_options={...}) to print.`,
    });
  });

  // List uploaded files
  app.get("/uploads", (_req, res) => {
    const files = upload.listFiles();
    res.json({ count: files.length, files: files.map(f => ({
      file_id: f.file_id,
      filename: f.filename,
      size: f.size,
      uploaded_at: new Date(f.uploaded_at).toISOString(),
    }))});
  });

  // ─── MCP endpoint ─────────────────────────────────────────
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

  // Handle GET and DELETE for MCP protocol
  app.get(MCP_PATH, (_req, res) => {
    res.writeHead(405).end(JSON.stringify({ error: "Method not allowed. Use POST for MCP requests." }));
  });

  app.delete(MCP_PATH, (_req, res) => {
    res.writeHead(405).end(JSON.stringify({ error: "Method not allowed. Sessions are not supported." }));
  });

  const port = parseInt(process.env.PORT || String(DEFAULT_PORT), 10);
  app.listen(port, "0.0.0.0", () => {
    console.error(`${SERVER_NAME} v${SERVER_VERSION} running on http://0.0.0.0:${port}${MCP_PATH}`);
    console.error(`Upload endpoint: http://0.0.0.0:${port}/upload`);
    console.error(`Health check: http://0.0.0.0:${port}/health`);
    if (process.env.MCP_API_KEY) {
      console.error("API key authentication: ENABLED");
    } else {
      console.error("API key authentication: DISABLED (set MCP_API_KEY to enable)");
    }
    console.error(`Office converter: ${getConverterStatus()}`);
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
