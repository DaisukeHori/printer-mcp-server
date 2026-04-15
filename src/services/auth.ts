import type { Request, Response, NextFunction } from "express";

const MCP_API_KEY = process.env.MCP_API_KEY || "";

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip auth if no key is configured (dev mode)
  if (!MCP_API_KEY) {
    next();
    return;
  }

  // Check Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (token === MCP_API_KEY) {
      next();
      return;
    }
  }

  // Check query parameter
  const queryKey = req.query.key;
  if (queryKey === MCP_API_KEY) {
    next();
    return;
  }

  res.status(401).json({ error: "Unauthorized: invalid or missing API key" });
}
