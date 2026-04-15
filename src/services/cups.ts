import { exec } from "node:child_process";
import { writeFile, unlink, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { COMMAND_TIMEOUT } from "../constants.js";

const TMP_DIR = "/tmp/printer-mcp";

interface ExecResult {
  stdout: string;
  stderr: string;
}

async function execCommand(cmd: string): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: COMMAND_TIMEOUT, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`Command failed (exit ${error.code}): ${error.message}\nstderr: ${stderr}\nstdout: ${stdout}`));
        return;
      }
      resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

// Allow non-zero exit for some commands
async function execCommandSafe(cmd: string): Promise<ExecResult> {
  return new Promise((resolve) => {
    exec(cmd, { timeout: COMMAND_TIMEOUT, maxBuffer: 2 * 1024 * 1024 }, (_error, stdout, stderr) => {
      resolve({ stdout: (stdout || "").trim(), stderr: (stderr || "").trim() });
    });
  });
}

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface PrinterInfo {
  name: string;
  description: string;
  location: string;
  state: "idle" | "printing" | "disabled" | "unknown";
  stateMessage: string;
  isDefault: boolean;
  accepting: boolean;
  uri: string;
}

export interface PrintJob {
  id: string;
  printer: string;
  user: string;
  title: string;
  size: string;
  state: string;
  stateReasons: string;
  createdAt: string;
  completedAt: string;
  pages: string;
}

export interface PrinterCapability {
  option: string;
  label: string;
  defaultValue: string;
  choices: string[];
}

export interface PrintResult {
  success: boolean;
  jobId: string;
  printer: string;
  message: string;
  commandOutput: string;
}

export interface PrintOptions {
  printer?: string;
  copies?: number;
  duplex?: "one-sided" | "two-sided-long-edge" | "two-sided-short-edge";
  paperSize?: string;
  colorMode?: "color" | "monochrome";
  orientation?: "portrait" | "landscape";
  pageRanges?: string;
  fitToPage?: boolean;
  cupsOptions?: Record<string, string>;
}

// ─────────────────────────────────────────────────────────────
// Printer listing
// ─────────────────────────────────────────────────────────────

export async function listPrinters(): Promise<PrinterInfo[]> {
  const printers: PrinterInfo[] = [];

  // Default
  let defaultPrinter = "";
  try {
    const { stdout } = await execCommand("lpstat -d 2>/dev/null");
    const m = stdout.match(/system default destination:\s*(\S+)/);
    if (m) defaultPrinter = m[1];
  } catch { /* none */ }

  // Printer list
  try {
    const { stdout } = await execCommand("lpstat -p -l 2>/dev/null");
    if (!stdout) return printers;

    // Device URIs
    const uriMap: Record<string, string> = {};
    try {
      const { stdout: vOut } = await execCommand("lpstat -v 2>/dev/null");
      for (const line of vOut.split("\n")) {
        const m = line.match(/device for\s+(\S+):\s*(.+)/);
        if (m) uriMap[m[1]] = m[2].trim();
      }
    } catch { /* ok */ }

    // Accepting status
    const acceptMap: Record<string, boolean> = {};
    try {
      const { stdout: aOut } = await execCommand("lpstat -a 2>/dev/null");
      for (const line of aOut.split("\n")) {
        const m = line.match(/^(\S+)\s+(accepting|not accepting)/);
        if (m) acceptMap[m[1]] = m[2] === "accepting";
      }
    } catch { /* ok */ }

    const blocks = stdout.split(/(?=^printer\s)/m);
    for (const block of blocks) {
      const nameMatch = block.match(/^printer\s+(\S+)\s+(.+)/m);
      if (!nameMatch) continue;
      const name = nameMatch[1];
      const statusLine = nameMatch[2];

      let description = "";
      let location = "";
      const descMatch = block.match(/Description:\s*(.+)/);
      if (descMatch) description = descMatch[1].trim();
      const locMatch = block.match(/Location:\s*(.+)/);
      if (locMatch) location = locMatch[1].trim();

      const state: PrinterInfo["state"] = statusLine.includes("idle") ? "idle" :
        statusLine.includes("printing") ? "printing" :
        statusLine.includes("disabled") ? "disabled" : "unknown";

      printers.push({
        name,
        description,
        location,
        state,
        stateMessage: statusLine.trim(),
        isDefault: name === defaultPrinter,
        accepting: acceptMap[name] ?? !statusLine.includes("not accepting"),
        uri: uriMap[name] || "",
      });
    }
  } catch { /* no printers */ }

  return printers;
}

// ─────────────────────────────────────────────────────────────
// Printer status (rich)
// ─────────────────────────────────────────────────────────────

export async function getPrinterStatus(printerName: string): Promise<string> {
  const parts: string[] = [];

  // Basic lpstat
  const { stdout: lpOut } = await execCommandSafe(`lpstat -p "${printerName}" -l 2>/dev/null`);
  if (!lpOut) throw new Error(`Printer "${printerName}" not found. Run list_printers to see available printers.`);
  parts.push("=== Printer Status ===", lpOut);

  // Accepting?
  const { stdout: acceptOut } = await execCommandSafe(`lpstat -a "${printerName}" 2>/dev/null`);
  if (acceptOut) parts.push("", "=== Accepting Jobs ===", acceptOut);

  // Device URI
  const { stdout: devOut } = await execCommandSafe(`lpstat -v "${printerName}" 2>/dev/null`);
  if (devOut) parts.push("", "=== Device URI ===", devOut);

  // Active jobs on this printer
  const { stdout: jobOut } = await execCommandSafe(`lpstat -o "${printerName}" 2>/dev/null`);
  parts.push("", "=== Active Jobs ===", jobOut || "(no active jobs)");

  // Try IPP attributes for toner/paper (only if ipptool available)
  const { stdout: ippCheck } = await execCommandSafe("which ipptool 2>/dev/null");
  if (ippCheck) {
    const { stdout: devUri } = await execCommandSafe(`lpstat -v "${printerName}" 2>/dev/null`);
    const uriMatch = devUri.match(/ipp[s]?:\/\/\S+/);
    if (uriMatch) {
      const { stdout: ippOut } = await execCommandSafe(
        `ipptool -tv "${uriMatch[0]}" -d "uri=${uriMatch[0]}" /usr/share/cups/ipptool/get-printer-attributes.test 2>/dev/null | grep -iE "(marker|supply|state|media-ready|toner|paper)" | head -30`
      );
      if (ippOut) parts.push("", "=== Supplies/Media (IPP) ===", ippOut);
    }
  }

  return parts.join("\n");
}

// ─────────────────────────────────────────────────────────────
// Capabilities (with filter)
// ─────────────────────────────────────────────────────────────

export async function getPrinterCapabilities(printerName: string, filter?: string): Promise<PrinterCapability[]> {
  const { stdout } = await execCommandSafe(`lpoptions -p "${printerName}" -l 2>/dev/null`);
  if (!stdout) throw new Error(`Printer "${printerName}" not found or has no configurable options. Is the Kyocera UPD driver installed?`);

  const capabilities: PrinterCapability[] = [];
  for (const line of stdout.split("\n")) {
    // Format: "OptionName/Label: choice1 *defaultChoice choice3"
    const match = line.match(/^(\S+)\/([^:]+):\s*(.+)$/);
    if (!match) continue;

    const option = match[1];
    const label = match[2].trim();

    // Apply filter
    if (filter) {
      const f = filter.toLowerCase();
      if (!option.toLowerCase().includes(f) && !label.toLowerCase().includes(f)) continue;
    }

    const choicesRaw = match[3].split(/\s+/);
    const choices: string[] = [];
    let defaultValue = "";

    for (const c of choicesRaw) {
      if (c.startsWith("*")) {
        const val = c.slice(1);
        defaultValue = val;
        choices.push(val);
      } else {
        choices.push(c);
      }
    }

    capabilities.push({ option, label, defaultValue, choices });
  }

  return capabilities;
}

// ─────────────────────────────────────────────────────────────
// Print jobs (active + optionally completed)
// ─────────────────────────────────────────────────────────────

export async function getPrintJobs(printerName?: string, includeCompleted?: boolean): Promise<PrintJob[]> {
  const jobs: PrintJob[] = [];

  // Active jobs via lpstat -o
  const activeCmd = printerName
    ? `lpstat -o "${printerName}" 2>/dev/null`
    : "lpstat -o 2>/dev/null";
  const { stdout: activeOut } = await execCommandSafe(activeCmd);

  if (activeOut && !activeOut.includes("no entries")) {
    for (const line of activeOut.split("\n")) {
      const match = line.match(/^(\S+)\s+(\S+)\s+(\d+)\s+(.+)$/);
      if (!match) continue;
      const fullId = match[1];
      const printerFromId = fullId.replace(/-\d+$/, "");
      const jobId = fullId.match(/-(\d+)$/)?.[1] || fullId;
      jobs.push({
        id: jobId,
        printer: printerFromId,
        user: match[2],
        title: "",
        size: match[3],
        state: "active",
        stateReasons: "",
        createdAt: match[4].trim(),
        completedAt: "",
        pages: "",
      });
    }
  }

  // Completed jobs from CUPS page_log (recent 50)
  if (includeCompleted) {
    const { stdout: logOut } = await execCommandSafe(
      "tail -100 /var/log/cups/page_log 2>/dev/null | tail -50"
    );
    if (logOut) {
      for (const line of logOut.split("\n")) {
        // Format: PrinterName user jobId dateGroup pageNum copies jobBilling jobOriginating jobName media sides
        const parts = line.split(/\s+/);
        if (parts.length < 6) continue;
        const pName = parts[0];
        if (printerName && pName !== printerName) continue;
        jobs.push({
          id: parts[2] || "?",
          printer: pName,
          user: parts[1] || "?",
          title: parts.slice(8).join(" ") || "",
          size: "",
          state: "completed",
          stateReasons: "",
          createdAt: parts[3]?.replace("[", "") || "",
          completedAt: parts[3]?.replace("[", "") || "",
          pages: parts[4] || "",
        });
      }
    }
  }

  return jobs;
}

// ─────────────────────────────────────────────────────────────
// Single job status (detailed)
// ─────────────────────────────────────────────────────────────

export async function getJobStatus(jobId: string): Promise<string> {
  // Try lpstat -l for this job
  const { stdout: lpOut } = await execCommandSafe(`lpstat -l -W all 2>/dev/null | grep -A5 "${jobId}"`);

  // Also try CUPS API attributes
  const { stdout: attrOut } = await execCommandSafe(
    `ipptool -tv ipp://localhost/jobs/${jobId} /usr/share/cups/ipptool/get-job-attributes.test 2>/dev/null | head -40`
  );

  // Also check CUPS error log for this job
  const { stdout: logOut } = await execCommandSafe(
    `grep "\\[Job ${jobId}\\]" /var/log/cups/error_log 2>/dev/null | tail -20`
  );

  const parts: string[] = [];
  if (lpOut) parts.push("=== Job Info ===", lpOut);
  else parts.push(`=== Job ${jobId} ===`, "(not found in active queue — may be completed or cancelled)");

  if (attrOut) parts.push("", "=== IPP Job Attributes ===", attrOut);
  if (logOut) parts.push("", "=== CUPS Log (last 20 lines) ===", logOut);

  if (!lpOut && !attrOut && !logOut) {
    parts.push("", "No information found for this job ID.");
    parts.push("The job may have already completed. Try get_print_jobs with completed=true.");
  }

  return parts.join("\n");
}

// ─────────────────────────────────────────────────────────────
// Cancel job
// ─────────────────────────────────────────────────────────────

export async function cancelPrintJob(jobId: string): Promise<string> {
  const { stdout, stderr } = await execCommandSafe(`cancel "${jobId}" 2>&1`);
  const output = [stdout, stderr].filter(Boolean).join("\n");
  if (output.includes("not found") || output.includes("does not exist")) {
    throw new Error(`Job ${jobId} not found. It may have already completed or been cancelled. Use get_print_jobs to check.`);
  }
  return `Cancelled job ${jobId}.\n${output}`.trim();
}

// ─────────────────────────────────────────────────────────────
// Print document (with arbitrary CUPS options)
// ─────────────────────────────────────────────────────────────

export async function printDocument(
  documentBase64: string,
  filename: string,
  options: PrintOptions
): Promise<PrintResult> {
  await mkdir(TMP_DIR, { recursive: true });
  const tmpFile = join(TMP_DIR, `${randomUUID()}-${filename}`);

  try {
    const buffer = Buffer.from(documentBase64, "base64");
    if (buffer.length === 0) throw new Error("Document is empty (0 bytes after base64 decode).");
    await writeFile(tmpFile, buffer);

    // Build lp command
    const args: string[] = [];
    const resolvedPrinter = options.printer || "";

    if (resolvedPrinter) args.push(`-d "${resolvedPrinter}"`);
    if (options.copies && options.copies > 1) args.push(`-n ${options.copies}`);

    // Collect all -o options
    const opts: string[] = [];

    if (options.duplex) opts.push(`sides=${options.duplex}`);
    if (options.paperSize) opts.push(`media=${options.paperSize}`);
    if (options.colorMode) {
      opts.push(options.colorMode === "monochrome" ? "ColorModel=Gray" : "ColorModel=CMYK");
    }
    if (options.orientation === "landscape") opts.push("orientation-requested=4");
    if (options.pageRanges) opts.push(`page-ranges=${options.pageRanges}`);
    if (options.fitToPage) opts.push("fit-to-page=true");

    // Arbitrary CUPS options (these override named params if overlapping)
    if (options.cupsOptions) {
      for (const [key, value] of Object.entries(options.cupsOptions)) {
        // Remove any existing option with the same key
        const idx = opts.findIndex(o => o.startsWith(`${key}=`));
        if (idx >= 0) opts.splice(idx, 1);
        opts.push(`${key}=${value}`);
      }
    }

    for (const opt of opts) {
      args.push(`-o "${opt}"`);
    }

    args.push(`-t "${filename}"`);
    args.push(`"${tmpFile}"`);

    const cmd = `lp ${args.join(" ")}`;
    const { stdout, stderr } = await execCommandSafe(cmd);
    const output = [stdout, stderr].filter(Boolean).join("\n");

    // Parse job ID
    const jobMatch = stdout.match(/request id is\s+(\S+)/);
    const jobId = jobMatch ? jobMatch[1] : "";

    if (!jobId) {
      // Print failed
      return {
        success: false,
        jobId: "",
        printer: resolvedPrinter || "(default)",
        message: `Print command did not return a job ID. This usually indicates an error.`,
        commandOutput: output,
      };
    }

    // Build option summary for return
    const optSummary = opts.length > 0 ? opts.join(", ") : "(defaults)";

    return {
      success: true,
      jobId,
      printer: resolvedPrinter || "(default)",
      message: `Print job submitted: ${jobId}`,
      commandOutput: [
        `Job ID:   ${jobId}`,
        `File:     ${filename} (${(buffer.length / 1024).toFixed(1)} KB)`,
        `Printer:  ${resolvedPrinter || "(default)"}`,
        `Copies:   ${options.copies || 1}`,
        `Options:  ${optSummary}`,
        ``,
        `Use get_job_status with job_id="${jobId.replace(/^.*-/, "")}" to track progress.`,
        `Use get_print_jobs to see the full queue.`,
      ].join("\n"),
    };
  } finally {
    try { await unlink(tmpFile); } catch { /* ok */ }
  }
}
