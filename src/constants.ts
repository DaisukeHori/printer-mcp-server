export const SERVER_NAME = "printer-mcp-server";
export const SERVER_VERSION = "1.0.0";
export const DEFAULT_PORT = 3000;
export const MCP_PATH = "/mcp";

// CUPS command timeout (ms)
export const COMMAND_TIMEOUT = 30_000;

// Maximum file size for base64 document upload (50MB)
export const MAX_DOCUMENT_SIZE_BYTES = 50 * 1024 * 1024;

// Supported document formats for direct printing
export const SUPPORTED_FORMATS = [
  "application/pdf",
  "application/postscript",
  "text/plain",
  "image/jpeg",
  "image/png",
  "image/tiff",
] as const;

// Mac conversion timeout (ms) - Office can be slow on big files
export const MAC_CONVERT_TIMEOUT = 120_000;
