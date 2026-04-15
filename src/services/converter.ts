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

function getGraphConfig() {
  const tenantId = process.env.GRAPH_TENANT_ID || "";
  const clientId = process.env.GRAPH_CLIENT_ID || "";
  const clientSecret = process.env.GRAPH_CLIENT_SECRET || "";
  const userId = process.env.GRAPH_USER_ID || "";
  return { tenantId, clientId, clientSecret, userId };
}

export function isMacConfigured(): boolean {
  const { host, user } = getMacConfig();
  return host !== "" && user !== "";
}

export function isGraphConfigured(): boolean {
  const { tenantId, clientId, clientSecret, userId } = getGraphConfig();
  return tenantId !== "" && clientId !== "" && clientSecret !== "" && userId !== "";
}

export function isOfficeConversionAvailable(): boolean {
  return isMacConfigured() || isGraphConfigured();
}

export function getConverterStatus(): string {
  if (isMacConfigured()) return `✅ Mac converter (${process.env.MAC_USER}@${process.env.MAC_HOST})`;
  if (isGraphConfigured()) return `✅ Graph API converter (${process.env.GRAPH_USER_ID})`;
  return "❌ No Office converter configured";
}

// ─── Format detection ───────────────────────────────────────

const DIRECT_PRINT_FORMATS = new Set([
  ".pdf", ".ps", ".eps",
  ".txt", ".text",
  ".jpg", ".jpeg", ".png", ".tiff", ".tif", ".gif", ".bmp",
]);

const IMAGE_CONVERT_FORMATS = new Set([
  // iPhone / Modern web
  ".heic", ".heif", ".avif", ".webp", ".svg", ".svgz",
  // Adobe
  ".psd", ".psb", ".ai",
  // GIMP
  ".xcf",
  // Legacy image
  ".tga", ".ico", ".cur", ".pcx",
  // Camera RAW (via dcraw/ImageMagick)
  ".dng", ".cr2", ".cr3", ".crw", ".nef", ".nrw", ".arw",
  ".orf", ".raf", ".rw2", ".pef", ".mef", ".mrw",
  ".srf", ".sr2", ".erf", ".kdc", ".raw", ".3fr", ".x3f",
]);

const DOCUMENT_CONVERT_FORMATS = new Set([
  ".md", ".markdown",   // Markdown → pandoc → HTML → wkhtmltopdf → PDF
  ".html", ".htm",      // HTML → wkhtmltopdf → PDF
  ".dxf",               // AutoCAD 2D → ezdxf + matplotlib → PNG
]);

const OFFICE_FORMATS = new Set([
  ".doc", ".docx", ".docm", ".dotx", ".dotm", ".rtf", ".odt",
  ".xls", ".xlsx", ".xlsm", ".xlsb", ".xltx", ".csv",
  ".ppt", ".pptx", ".pptm", ".ppsx", ".pps", ".potx",
]);

export type ConvertRoute = "direct" | "image-convert" | "document-convert" | "mac-office" | "unsupported";

export function detectRoute(filename: string): ConvertRoute {
  const ext = extname(filename).toLowerCase();
  if (DIRECT_PRINT_FORMATS.has(ext)) return "direct";
  if (IMAGE_CONVERT_FORMATS.has(ext)) return "image-convert";
  if (DOCUMENT_CONVERT_FORMATS.has(ext)) return "document-convert";
  if (OFFICE_FORMATS.has(ext)) return "mac-office";
  return "unsupported";
}

export function getSupportedFormats(): {
  direct: string[];
  imageConvert: string[];
  documentConvert: string[];
  macOffice: string[];
} {
  return {
    direct: [...DIRECT_PRINT_FORMATS].sort(),
    imageConvert: [...IMAGE_CONVERT_FORMATS].sort(),
    documentConvert: [...DOCUMENT_CONVERT_FORMATS].sort(),
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

// ─── Conversion result interface ────────────────────────────

export interface ConvertResult {
  success: boolean;
  pdfPath: string;
  pdfBase64: string;
  originalFile: string;
  fileSize: number;
  error: string;
  route: string;
}

// ─── Image conversion (HEIC/HEIF/AVIF/WEBP/SVG → JPEG) ───

export async function convertImageFile(
  fileBuffer: Buffer,
  filename: string,
): Promise<ConvertResult> {
  await mkdir(TMP_DIR, { recursive: true });
  const jobId = randomUUID().slice(0, 8);
  const localInput = join(TMP_DIR, `${jobId}-${filename}`);
  const ext = extname(filename);
  const jpgName = basename(filename, ext) + ".jpg";
  const localOutput = join(TMP_DIR, `${jobId}-${jpgName}`);

  try {
    await writeFile(localInput, fileBuffer);

    // ImageMagick convert: HEIC/HEIF/AVIF/WEBP/SVG → JPEG
    // -quality 95 for high quality, -density 300 for SVG rendering
    const density = ext.toLowerCase().match(/\.svg/) ? "-density 300" : "";
    await execAsync(
      `convert ${density} "${localInput}" -quality 95 -colorspace sRGB "${localOutput}"`,
      60_000,
    );

    const outputBuffer = await readFile(localOutput);

    return {
      success: true,
      pdfPath: localOutput, // reuse field for output path
      pdfBase64: outputBuffer.toString("base64"),
      originalFile: filename,
      fileSize: outputBuffer.length,
      error: "",
      route: "image-convert",
    };
  } catch (err) {
    return {
      success: false, pdfPath: "", pdfBase64: "", originalFile: filename,
      fileSize: 0, error: `Image conversion failed: ${(err as Error).message}`, route: "image-convert",
    };
  } finally {
    try { await unlink(localInput); } catch {}
  }
}

// ─── Document conversion (MD/HTML → PDF, DXF → PNG) ────────

export async function convertDocumentFile(
  fileBuffer: Buffer,
  filename: string,
): Promise<ConvertResult> {
  await mkdir(TMP_DIR, { recursive: true });
  const jobId = randomUUID().slice(0, 8);
  const ext = extname(filename).toLowerCase();
  const localInput = join(TMP_DIR, `${jobId}-${filename}`);

  try {
    await writeFile(localInput, fileBuffer);

    if (ext === ".dxf") {
      // DXF → PNG via ezdxf + matplotlib
      const outputPng = join(TMP_DIR, `${jobId}-${basename(filename, ext)}.png`);
      const pyScript = `
import ezdxf, sys
from ezdxf.addons.drawing import RenderContext, Frontend
from ezdxf.addons.drawing.matplotlib import MatplotlibBackend
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

try:
    doc = ezdxf.readfile("${localInput}")
except Exception:
    doc = ezdxf.read(open("${localInput}", "rb"))
msp = doc.modelspace()
fig = plt.figure(figsize=(11.69, 8.27))
ax = fig.add_axes([0, 0, 1, 1])
ctx = RenderContext(doc)
out = MatplotlibBackend(ax)
Frontend(ctx, out).draw_layout(msp)
fig.savefig("${outputPng}", dpi=200, bbox_inches='tight')
plt.close(fig)
print("OK")
`;
      await execAsync(`python3 -c '${pyScript.replace(/'/g, "'\"'\"'")}'`, 60_000);
      const outputBuffer = await readFile(outputPng);
      return {
        success: true, pdfPath: outputPng,
        pdfBase64: outputBuffer.toString("base64"),
        originalFile: filename, fileSize: outputBuffer.length, error: "", route: "dxf-convert",
      };
    }

    // MD / HTML → PDF via pandoc + wkhtmltopdf
    const outputPdf = join(TMP_DIR, `${jobId}-${basename(filename, ext)}.pdf`);

    if (ext === ".md" || ext === ".markdown") {
      // MD → HTML → PDF (pandoc + wkhtmltopdf)
      const intermediateHtml = join(TMP_DIR, `${jobId}-intermediate.html`);
      await execAsync(`pandoc "${localInput}" -t html5 --standalone -o "${intermediateHtml}"`, 30_000);
      await execAsync(`wkhtmltopdf --quiet --enable-local-file-access "${intermediateHtml}" "${outputPdf}"`, 60_000);
      try { await unlink(intermediateHtml); } catch {}
    } else {
      // HTML → PDF (wkhtmltopdf)
      await execAsync(`wkhtmltopdf --quiet --enable-local-file-access "${localInput}" "${outputPdf}"`, 60_000);
    }

    const pdfBuffer = await readFile(outputPdf);
    return {
      success: true, pdfPath: outputPdf,
      pdfBase64: pdfBuffer.toString("base64"),
      originalFile: filename, fileSize: pdfBuffer.length, error: "", route: "document-convert",
    };
  } catch (err) {
    return {
      success: false, pdfPath: "", pdfBase64: "", originalFile: filename,
      fileSize: 0, error: `Document conversion failed: ${(err as Error).message}`, route: "document-convert",
    };
  } finally {
    try { await unlink(localInput); } catch {}
  }
}

// ─── Graph API token cache ──────────────────────────────────

let graphTokenCache: { token: string; expiresAt: number } | null = null;

async function getGraphAccessToken(): Promise<string> {
  // Return cached token if still valid (5 min buffer)
  if (graphTokenCache && Date.now() < graphTokenCache.expiresAt - 300_000) {
    return graphTokenCache.token;
  }

  const { tenantId, clientId, clientSecret } = getGraphConfig();
  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
  });

  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Graph token request failed (${resp.status}): ${errText}`);
  }

  const data = (await resp.json()) as { access_token: string; expires_in: number };
  graphTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

// ─── Graph API conversion ───────────────────────────────────

export async function convertViaGraph(
  fileBuffer: Buffer,
  filename: string,
): Promise<ConvertResult> {
  const { userId } = getGraphConfig();
  const jobId = randomUUID().slice(0, 8);
  const remoteName = `${jobId}-${filename}`;
  const graphBase = "https://graph.microsoft.com/v1.0";

  try {
    const token = await getGraphAccessToken();
    const headers = { Authorization: `Bearer ${token}` };

    // 1. Upload file to OneDrive temp folder
    const uploadUrl = `${graphBase}/users/${userId}/drive/root:/printer-mcp-temp/${remoteName}:/content`;
    const uploadResp = await fetch(uploadUrl, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/octet-stream" },
      body: new Uint8Array(fileBuffer),
    });

    if (!uploadResp.ok) {
      const errText = await uploadResp.text();
      return {
        success: false, pdfPath: "", pdfBase64: "", originalFile: filename,
        fileSize: 0, error: `Graph upload failed (${uploadResp.status}): ${errText}`, route: "graph-api",
      };
    }

    const uploadData = (await uploadResp.json()) as { id: string };
    const itemId = uploadData.id;

    // 2. Download as PDF via ?format=pdf
    const pdfUrl = `${graphBase}/users/${userId}/drive/items/${itemId}/content?format=pdf`;
    const pdfResp = await fetch(pdfUrl, {
      headers,
      redirect: "follow",
    });

    if (!pdfResp.ok) {
      // Cleanup uploaded file
      await fetch(`${graphBase}/users/${userId}/drive/items/${itemId}`, {
        method: "DELETE", headers,
      }).catch(() => {});

      const errText = await pdfResp.text();
      return {
        success: false, pdfPath: "", pdfBase64: "", originalFile: filename,
        fileSize: 0, error: `Graph PDF conversion failed (${pdfResp.status}): ${errText}`, route: "graph-api",
      };
    }

    const pdfArrayBuf = await pdfResp.arrayBuffer();
    const pdfBuffer = Buffer.from(pdfArrayBuf);

    // 3. Delete temp file from OneDrive
    await fetch(`${graphBase}/users/${userId}/drive/items/${itemId}`, {
      method: "DELETE", headers,
    }).catch(() => {}); // best-effort cleanup

    // 4. Save locally for CUPS printing
    await mkdir(TMP_DIR, { recursive: true });
    const ext = extname(filename);
    const pdfName = basename(filename, ext) + ".pdf";
    const localOutput = join(TMP_DIR, `${jobId}-${pdfName}`);
    await writeFile(localOutput, pdfBuffer);

    return {
      success: true,
      pdfPath: localOutput,
      pdfBase64: pdfBuffer.toString("base64"),
      originalFile: filename,
      fileSize: pdfBuffer.length,
      error: "",
      route: "graph-api",
    };
  } catch (err) {
    return {
      success: false, pdfPath: "", pdfBase64: "", originalFile: filename,
      fileSize: 0, error: `Graph API error: ${(err as Error).message}`, route: "graph-api",
    };
  }
}

// ─── Mac SSH conversion ─────────────────────────────────────

export async function convertViaMac(
  fileBuffer: Buffer,
  filename: string,
): Promise<ConvertResult> {
  const mac = getMacConfig();
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
    await writeFile(localInput, fileBuffer);
    await execAsync(`ssh ${sshOpts} ${sshTarget} "mkdir -p ${mac.remoteDir}"`);
    await execAsync(`scp ${sshOpts} "${localInput}" "${sshTarget}:${remoteInput}"`);

    const { stdout: convertOut } = await execAsync(
      `ssh ${sshOpts} ${sshTarget} '${mac.scriptPath} "${remoteInput}"'`
    );

    let macResult: { success: boolean; output: string; size?: number; error: string };
    try { macResult = JSON.parse(convertOut); }
    catch { return { success: false, pdfPath: "", pdfBase64: "", originalFile: filename, fileSize: 0, error: `Mac returned non-JSON: ${convertOut}`, route: "mac-office" }; }

    if (!macResult.success) {
      return { success: false, pdfPath: "", pdfBase64: "", originalFile: filename, fileSize: 0, error: `Mac conversion failed: ${macResult.error}`, route: "mac-office" };
    }

    await execAsync(`scp ${sshOpts} "${sshTarget}:${remoteOutput}" "${localOutput}"`);
    const pdfBuffer = await readFile(localOutput);

    return { success: true, pdfPath: localOutput, pdfBase64: pdfBuffer.toString("base64"), originalFile: filename, fileSize: pdfBuffer.length, error: "", route: "mac-office" };
  } catch (err) {
    return { success: false, pdfPath: "", pdfBase64: "", originalFile: filename, fileSize: 0, error: `Mac error: ${(err as Error).message}`, route: "mac-office" };
  } finally {
    try { await unlink(localInput); } catch {}
    try { await execAsync(`ssh ${sshOpts} ${sshTarget} "rm -f '${remoteInput}' '${remoteOutput}'"`, 10_000); } catch {}
  }
}

// ─── Unified conversion (Mac → Graph API fallback) ──────────

export async function convertOfficeFile(
  fileBuffer: Buffer,
  filename: string,
): Promise<ConvertResult> {
  // Priority 1: Mac (100% fidelity)
  if (isMacConfigured()) {
    const result = await convertViaMac(fileBuffer, filename);
    if (result.success) return result;

    // Mac failed → fall back to Graph API if available
    if (isGraphConfigured()) {
      console.error(`Mac conversion failed, falling back to Graph API: ${result.error}`);
      return convertViaGraph(fileBuffer, filename);
    }
    return result;
  }

  // Priority 2: Graph API (~98-99% fidelity)
  if (isGraphConfigured()) {
    return convertViaGraph(fileBuffer, filename);
  }

  return {
    success: false, pdfPath: "", pdfBase64: "", originalFile: filename, fileSize: 0,
    error: "No Office converter configured. Set GRAPH_* or MAC_* environment variables.",
    route: "none",
  };
}

// ─── Cleanup ────────────────────────────────────────────────

export async function cleanupTempPdf(pdfPath: string): Promise<void> {
  if (pdfPath && pdfPath.startsWith(TMP_DIR)) {
    try { await unlink(pdfPath); } catch {}
  }
}
