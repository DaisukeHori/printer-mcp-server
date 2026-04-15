import { exec } from "node:child_process";
import { writeFile, readFile, unlink, mkdir } from "node:fs/promises";
import { join, extname, basename } from "node:path";
import { randomUUID } from "node:crypto";

const TMP_DIR = "/tmp/printer-mcp";
const CONVERT_TIMEOUT = 120_000; // 2 min for large files

// ─── Configuration (from env) ───────────────────────────────

function getMacConfig() {
  const host = process.env.MAC_HOST || "";
  const user = process.env.MAC_USER || "";
  const keyPath = process.env.MAC_SSH_KEY || "/root/.ssh/printer-mcp-mac";
  const remoteDir = process.env.MAC_CONVERT_DIR || "/tmp/printer-mcp-convert";
  const scriptPath = process.env.MAC_SCRIPT_PATH || "/opt/printer-mcp/convert.sh";

  return { host, user, keyPath, remoteDir, scriptPath };
}

export function isMacConfigured(): boolean {
  const { host, user } = getMacConfig();
  return host !== "" && user !== "";
}

// ─── Format detection ───────────────────────────────────────

const DIRECT_PRINT_FORMATS = new Set([
  ".pdf", ".ps", ".eps",
  ".txt", ".text",
  ".jpg", ".jpeg", ".png", ".tiff", ".tif", ".gif", ".bmp",
]);

const OFFICE_FORMATS = new Set([
  // Word
  ".doc", ".docx", ".docm", ".dotx", ".dotm", ".rtf", ".odt",
  // Excel
  ".xls", ".xlsx", ".xlsm", ".xlsb", ".xltx", ".csv",
  // PowerPoint
  ".ppt", ".pptx", ".pptm", ".ppsx", ".pps", ".potx",
]);

export type ConvertRoute = "direct" | "mac-office" | "unsupported";

export function detectRoute(filename: string): ConvertRoute {
  const ext = extname(filename).toLowerCase();
  if (DIRECT_PRINT_FORMATS.has(ext)) return "direct";
  if (OFFICE_FORMATS.has(ext)) return "mac-office";
  return "unsupported";
}

export function getSupportedFormats(): { direct: string[]; macOffice: string[]; } {
  return {
    direct: [...DIRECT_PRINT_FORMATS].sort(),
    macOffice: [...OFFICE_FORMATS].sort(),
  };
}

// ─── Shell execution ────────────────────────────────────────

function execAsync(cmd: string, timeout = CONVERT_TIMEOUT): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`Command failed (exit ${error.code}): ${error.message}\nstderr: ${stderr}\nstdout: ${stdout}`));
        return;
      }
      resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

// ─── Mac conversion interface ───────────────────────────────

export interface ConvertResult {
  success: boolean;
  pdfPath: string;
  pdfBase64: string;
  originalFile: string;
  fileSize: number;
  error: string;
  route: ConvertRoute;
}

/**
 * Convert an Office document to PDF via Mac.
 * 1. SCP file to Mac
 * 2. SSH exec convert.sh
 * 3. SCP result PDF back
 * 4. Cleanup both sides
 */
export async function convertViaMac(
  fileBuffer: Buffer,
  filename: string,
): Promise<ConvertResult> {
  const mac = getMacConfig();

  if (!mac.host || !mac.user) {
    return {
      success: false,
      pdfPath: "",
      pdfBase64: "",
      originalFile: filename,
      fileSize: 0,
      error: "Mac conversion server not configured. Set MAC_HOST and MAC_USER environment variables.",
      route: "mac-office",
    };
  }

  await mkdir(TMP_DIR, { recursive: true });

  const jobId = randomUUID().slice(0, 8);
  const localInput = join(TMP_DIR, `${jobId}-${filename}`);
  const ext = extname(filename);
  const pdfName = basename(filename, ext) + ".pdf";
  const localOutput = join(TMP_DIR, `${jobId}-${pdfName}`);
  const remoteInput = `${mac.remoteDir}/${jobId}-${filename}`;
  const remoteOutput = `${mac.remoteDir}/${jobId}-${pdfName}`;

  const sshOpts = `-i "${mac.keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=10`;
  const sshTarget = `${mac.user}@${mac.host}`;

  try {
    // Write input file locally
    await writeFile(localInput, fileBuffer);

    // Ensure remote directory exists
    await execAsync(`ssh ${sshOpts} ${sshTarget} "mkdir -p ${mac.remoteDir}"`);

    // SCP file to Mac
    await execAsync(`scp ${sshOpts} "${localInput}" "${sshTarget}:${remoteInput}"`);

    // Execute conversion on Mac
    const { stdout: convertOut } = await execAsync(
      `ssh ${sshOpts} ${sshTarget} '${mac.scriptPath} "${remoteInput}"'`
    );

    // Parse JSON result from convert.sh
    let macResult: { success: boolean; output: string; size?: number; error: string };
    try {
      macResult = JSON.parse(convertOut);
    } catch {
      return {
        success: false,
        pdfPath: "",
        pdfBase64: "",
        originalFile: filename,
        fileSize: 0,
        error: `Mac returned non-JSON output: ${convertOut}`,
        route: "mac-office",
      };
    }

    if (!macResult.success) {
      return {
        success: false,
        pdfPath: "",
        pdfBase64: "",
        originalFile: filename,
        fileSize: 0,
        error: `Mac conversion failed: ${macResult.error}`,
        route: "mac-office",
      };
    }

    // SCP result PDF back
    await execAsync(`scp ${sshOpts} "${sshTarget}:${remoteOutput}" "${localOutput}"`);

    // Read PDF
    const pdfBuffer = await readFile(localOutput);

    return {
      success: true,
      pdfPath: localOutput,
      pdfBase64: pdfBuffer.toString("base64"),
      originalFile: filename,
      fileSize: pdfBuffer.length,
      error: "",
      route: "mac-office",
    };
  } catch (err) {
    return {
      success: false,
      pdfPath: "",
      pdfBase64: "",
      originalFile: filename,
      fileSize: 0,
      error: `Mac conversion error: ${(err as Error).message}`,
      route: "mac-office",
    };
  } finally {
    // Cleanup local
    try { await unlink(localInput); } catch { /* ok */ }
    // Don't delete localOutput here - caller may need it for printing
    // Cleanup remote
    try {
      await execAsync(
        `ssh ${sshOpts} ${sshTarget} "rm -f '${remoteInput}' '${remoteOutput}'"`,
        10_000
      );
    } catch { /* ok */ }
  }
}

/**
 * Cleanup a local temp PDF after printing
 */
export async function cleanupTempPdf(pdfPath: string): Promise<void> {
  if (pdfPath && pdfPath.startsWith(TMP_DIR)) {
    try { await unlink(pdfPath); } catch { /* ok */ }
  }
}
