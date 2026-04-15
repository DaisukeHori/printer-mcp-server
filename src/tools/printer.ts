import { readFile } from "node:fs/promises";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  PrintUrlInputSchema,
  ValidatePrintOptionsInputSchema,
  ListPrintersInputSchema,
  GetPrinterStatusInputSchema,
  GetPrinterCapabilitiesInputSchema,
  GetPrintJobsInputSchema,
  GetJobStatusInputSchema,
  CancelPrintJobInputSchema,
  GetSupportedFormatsInputSchema,
  PrintUploadedInputSchema,
  ListUploadsInputSchema,
  type PrintUrlInput,
  type ValidatePrintOptionsInput,
  type GetPrinterStatusInput,
  type GetPrinterCapabilitiesInput,
  type GetPrintJobsInput,
  type GetJobStatusInput,
  type CancelPrintJobInput,
  type PrintUploadedInput,
} from "../schemas/printer.js";
import * as cups from "../services/cups.js";
import * as converter from "../services/converter.js";
import * as ppdConstraints from "../services/ppdConstraints.js";
import * as upload from "../services/upload.js";

// ─── Helpers ────────────────────────────────────────────────

function err(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}
function ok(data: unknown) {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text" as const, text }] };
}

/**
 * Core logic: receive base64 file → detect format → convert if needed → print via CUPS.
 * Returns structured PrintResult.
 */
async function processAndPrint(
  docBase64: string,
  filename: string,
  options: cups.PrintOptions,
): Promise<cups.PrintResult> {
  const route = converter.detectRoute(filename);

  if (route === "unsupported") {
    return {
      success: false, jobId: "", printer: options.printer || "(default)",
      message: `Unsupported file format: ${filename}. Use get_supported_formats to see what's accepted.`,
      commandOutput: "",
    };
  }

  let printBase64 = docBase64;
  let printFilename = filename;

  // Convert image files (HEIC/HEIF/AVIF/WEBP/SVG/PSD/AI/RAW/etc) via ImageMagick
  if (route === "image-convert") {
    const buf = Buffer.from(docBase64, "base64");
    const result = await converter.convertImageFile(buf, filename);

    if (!result.success) {
      return {
        success: false, jobId: "", printer: options.printer || "(default)",
        message: result.error,
        commandOutput: "",
      };
    }

    printBase64 = result.pdfBase64;
    printFilename = filename.replace(/\.[^.]+$/, ".jpg");

    if (result.pdfPath) {
      await converter.cleanupTempPdf(result.pdfPath);
    }
  }

  // Convert document files (MD/HTML → PDF, DXF → PNG) via pandoc/wkhtmltopdf/ezdxf
  if (route === "document-convert") {
    const buf = Buffer.from(docBase64, "base64");
    const result = await converter.convertDocumentFile(buf, filename);

    if (!result.success) {
      return {
        success: false, jobId: "", printer: options.printer || "(default)",
        message: result.error,
        commandOutput: "",
      };
    }

    printBase64 = result.pdfBase64;
    const isImage = filename.match(/\.dxf$/i);
    printFilename = filename.replace(/\.[^.]+$/, isImage ? ".png" : ".pdf");

    if (result.pdfPath) {
      await converter.cleanupTempPdf(result.pdfPath);
    }
  }

  // Convert Office files via Mac or Graph API
  if (route === "mac-office") {
    if (!converter.isOfficeConversionAvailable()) {
      return {
        success: false, jobId: "", printer: options.printer || "(default)",
        message: "Office file detected but no converter configured. Set GRAPH_* env vars (or MAC_HOST + MAC_USER for Mac). Only PDF/image/text can be printed directly.",
        commandOutput: "",
      };
    }

    const buf = Buffer.from(docBase64, "base64");
    const result = await converter.convertOfficeFile(buf, filename);

    if (!result.success) {
      return {
        success: false, jobId: "", printer: options.printer || "(default)",
        message: result.error,
        commandOutput: "",
      };
    }

    // Use the converted PDF for printing
    printBase64 = result.pdfBase64;
    printFilename = filename.replace(/\.[^.]+$/, ".pdf");

    // Cleanup temp PDF after printing will be handled by cups.printDocument
    if (result.pdfPath) {
      await converter.cleanupTempPdf(result.pdfPath);
    }
  }

  return cups.printDocument(printBase64, printFilename, options);
}

// ─── Tool registration ──────────────────────────────────────

export function registerPrinterTools(server: McpServer): void {

  // ═══ 1. print_url ════════════════════════════════════════

  server.registerTool(
    "print_url",
    {
      title: "Print from URL",
      description: `Download a file from a URL and print it. Supports the same formats as print_document.
Useful for printing files from OneDrive, SharePoint, S3 presigned URLs, or any public URL.
The filename parameter is used for format detection (e.g. 'report.docx').`,
      inputSchema: PrintUrlInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (params: PrintUrlInput) => {
      try {
        // Download file
        const response = await fetch(params.url);
        if (!response.ok) {
          return err(`Download failed: HTTP ${response.status} ${response.statusText}`);
        }
        const arrayBuf = await response.arrayBuffer();
        const base64 = Buffer.from(arrayBuf).toString("base64");

        const result = await processAndPrint(base64, params.filename, {
          printer: params.printer,
          copies: params.copies,
          cupsOptions: params.cups_options,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: !result.success };
      } catch (e) { return err(`Error: ${(e as Error).message}`); }
    }
  );

  // ═══ 2. list_printers ════════════════════════════════════

  server.registerTool(
    "list_printers",
    {
      title: "List printers",
      description: `List all CUPS-configured printers with name, state, URI, and default flag.`,
      inputSchema: ListPrintersInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const printers = await cups.listPrinters();
        if (printers.length === 0) return ok("No printers configured.");
        return ok(printers);
      } catch (e) { return err(`Error: ${(e as Error).message}`); }
    }
  );

  // ═══ 5. get_printer_status ═══════════════════════════════

  server.registerTool(
    "get_printer_status",
    {
      title: "Get printer status",
      description: `Detailed status: state, active jobs, device URI, supply/media levels (IPP).`,
      inputSchema: GetPrinterStatusInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params: GetPrinterStatusInput) => {
      try { return ok(await cups.getPrinterStatus(params.printer)); }
      catch (e) { return err(`Error: ${(e as Error).message}`); }
    }
  );

  // ═══ 6. get_printer_capabilities ═════════════════════════

  server.registerTool(
    "get_printer_capabilities",
    {
      title: "Get printer capabilities",
      description: `List PPD/CUPS options. MUST call before using cups_options in print_document.
Use filter to narrow: 'staple', 'punch', 'fold', 'tray', 'media', 'booklet', 'insert'.`,
      inputSchema: GetPrinterCapabilitiesInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params: GetPrinterCapabilitiesInput) => {
      try {
        const caps = await cups.getPrinterCapabilities(params.printer, params.filter);
        if (caps.length === 0) return ok(params.filter ? `No options matching "${params.filter}".` : "No options found.");
        return ok(caps);
      } catch (e) { return err(`Error: ${(e as Error).message}`); }
    }
  );

  // ═══ 7. get_print_jobs ═══════════════════════════════════

  server.registerTool(
    "get_print_jobs",
    {
      title: "Get print jobs",
      description: `List active/pending jobs. Set completed=true for recent completed jobs too.`,
      inputSchema: GetPrintJobsInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params: GetPrintJobsInput) => {
      try {
        const jobs = await cups.getPrintJobs(params.printer, params.completed);
        if (jobs.length === 0) return ok("No print jobs found.");
        return ok(jobs);
      } catch (e) { return err(`Error: ${(e as Error).message}`); }
    }
  );

  // ═══ 8. get_job_status ═══════════════════════════════════

  server.registerTool(
    "get_job_status",
    {
      title: "Get job status",
      description: `Detailed status for a specific job: IPP attributes + CUPS error log. Use after print_document.`,
      inputSchema: GetJobStatusInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params: GetJobStatusInput) => {
      try { return ok(await cups.getJobStatus(params.job_id)); }
      catch (e) { return err(`Error: ${(e as Error).message}`); }
    }
  );

  // ═══ 9. cancel_print_job ═════════════════════════════════

  server.registerTool(
    "cancel_print_job",
    {
      title: "Cancel print job",
      description: `Cancel an active or pending print job.`,
      inputSchema: CancelPrintJobInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (params: CancelPrintJobInput) => {
      try { return ok(await cups.cancelPrintJob(params.job_id)); }
      catch (e) { return err(`Error: ${(e as Error).message}`); }
    }
  );

  // ═══ 10. get_supported_formats (bonus) ═══════════════════

  server.registerTool(
    "get_supported_formats",
    {
      title: "Get supported formats",
      description: `List all file formats that can be printed or converted. Shows which formats go directly to CUPS and which require Mac Office conversion.`,
      inputSchema: GetSupportedFormatsInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const formats = converter.getSupportedFormats();
      const macStatus = converter.getConverterStatus();
      return ok({
        directPrint: { description: "Sent directly to CUPS (no conversion)", formats: formats.direct },
        imageConvert: { description: "Converted to JPEG via ImageMagick (iPhone/Adobe/Camera RAW/etc)", formats: formats.imageConvert },
        documentConvert: { description: "Converted to PDF/PNG via pandoc/wkhtmltopdf/ezdxf (Markdown/HTML/DXF)", formats: formats.documentConvert },
        macOfficeConvert: { description: "Converted to PDF via Graph API (Office documents)", formats: formats.macOffice, status: macStatus },
      });
    }
  );

  // ═══ 11. validate_print_options ═══════════════════════════

  server.registerTool(
    "validate_print_options",
    {
      title: "Validate print options",
      description: `Check if cups_options are valid and compatible with the installed hardware BEFORE printing.

Three-level validation:
  1. Value check: Is each option name and value recognized by the PPD?
  2. PPD constraint check: Does the Kyocera PPD prohibit this combination? (3192 hardware rules)
  3. Soft warnings: Missing related options (e.g., Stpl without Scnt)

ALWAYS call this before print_document when using finisher options.
Catches issues like: booklet with incompatible paper size, punch on thick paper,
fold on envelopes, staple+booklet conflicts, etc.

Example: validate_print_options(cups_options: {"KCBooklet":"Left","Fold":"True","PageSize":"A4"})`,
      inputSchema: ValidatePrintOptionsInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params: ValidatePrintOptionsInput) => {
      try {
        const printer = params.printer || "TASKalfa-6054ci";
        const caps = await cups.getPrinterCapabilities(printer);

        // ── Step 1: Value validation ──
        // CUPS built-in options (not in PPD but valid)
        const cupsBuiltins = new Set([
          "number-up", "number-up-layout", "page-ranges", "fit-to-page",
          "orientation-requested", "media", "sides", "print-quality",
          "print-color-mode", "output-order", "page-border",
        ]);

        const validOptions = new Map<string, Set<string>>();
        for (const cap of caps) {
          validOptions.set(cap.option, new Set(cap.choices));
        }

        const valueResults: { option: string; value: string; valid: boolean; reason: string }[] = [];
        for (const [key, value] of Object.entries(params.cups_options)) {
          const validValues = validOptions.get(key);
          if (!validValues) {
            if (cupsBuiltins.has(key)) {
              valueResults.push({ option: key, value, valid: true, reason: "CUPS built-in (not in PPD, but valid)" });
            } else {
              valueResults.push({ option: key, value, valid: false, reason: `Unknown option "${key}"` });
            }
          } else if (!validValues.has(value)) {
            valueResults.push({ option: key, value, valid: false, reason: `Invalid value. Valid: ${[...validValues].join(", ")}` });
          } else {
            valueResults.push({ option: key, value, valid: true, reason: "OK" });
          }
        }

        const allValuesValid = valueResults.every(r => r.valid);

        // ── Step 2: PPD constraint check (only if values are valid) ──
        let constraintResult = { violations: [] as any[], checkedConstraints: 0, applicableConstraints: 0 };
        if (allValuesValid) {
          constraintResult = await ppdConstraints.checkConstraints(params.cups_options, printer);
        }

        // ── Step 3: Soft warnings ──
        const warnings: string[] = [];
        const opts = params.cups_options;
        if (opts.KCBooklet && opts.KCBooklet !== "None" && opts.Stpl && opts.Stpl !== "Center" && opts.Stpl !== "None") {
          warnings.push("中綴じ製本にはStpl=Center（中綴じホチキス）を使用してください。Front/Rearはコーナーステープルです。");
        }
        if (opts.Fold === "True" && (!opts.KCBooklet || opts.KCBooklet === "None")) {
          warnings.push("Fold=TrueはKCBooklet用です。単独の折りにはFldAを使ってください。");
        }
        if (opts.FldA && opts.FldA !== "None" && (!opts.OutputBin || opts.OutputBin !== "FLDTRAY")) {
          warnings.push("折り(FldA)使用時はOutputBin=FLDTRAYに設定してください。");
        }
        if (opts.Stpl && opts.Stpl !== "None" && (!opts.Scnt || opts.Scnt === "None")) {
          warnings.push("Stpl設定時はScntも必要です。Scnt=All（全ページ1セット）またはScnt=EachN（N枚ごと）。");
        }

        // ── Summary ──
        const hasViolations = constraintResult.violations.length > 0;
        const hasInvalidValues = !allValuesValid;
        const printable = !hasInvalidValues && !hasViolations;

        return ok({
          printable,
          summary: hasInvalidValues
            ? `❌ ${valueResults.filter(r => !r.valid).length}個の不正な値があります`
            : hasViolations
              ? `❌ ${constraintResult.violations.length}個のハードウェア制約に違反しています`
              : warnings.length > 0
                ? `⚠️ 印刷可能ですが${warnings.length}件の注意があります`
                : "✅ 全て有効。印刷できます。",
          valueCheck: valueResults,
          hardwareConstraintViolations: constraintResult.violations.map(v => ({
            message: v.message,
            conflicting: v.conflicting.map((c: any) => `${c.option}=${c.value}`),
          })),
          warnings,
          stats: {
            totalPpdConstraints: constraintResult.checkedConstraints,
            applicableToYourOptions: constraintResult.applicableConstraints,
            violations: constraintResult.violations.length,
          },
        });
      } catch (e) { return err(`Error: ${(e as Error).message}`); }
    }
  );

  // ═══ 12. print_uploaded ════════════════════════════════════

  server.registerTool(
    "print_uploaded",
    {
      title: "Print uploaded file",
      description: `Print a file that was uploaded via /upload endpoint. NO base64 needed — zero token cost.

WORKFLOW:
  1. User uploads file to Claude.ai
  2. Claude uses bash_tool: curl -sF "file=@/mnt/user-data/uploads/FILE" https://printer-mcp.appserver.tokyo/upload
     → Returns: {"file_id":"abc123","filename":"report.pdf","size":245000}
  3. Claude calls print_uploaded(file_id="abc123", cups_options={...})

This avoids base64 encoding which would consume hundreds of thousands of tokens for large files.`,
      inputSchema: PrintUploadedInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (params: PrintUploadedInput) => {
      try {
        const fileData = await upload.readFileAsBase64(params.file_id);
        if (!fileData) {
          return err(`File not found: ${params.file_id}. It may have expired (30 min) or was already used. Re-upload via /upload.`);
        }

        const cupsOpts: Record<string, string> = { ...(params.cups_options || {}) };
        const options: cups.PrintOptions = {
          printer: params.printer,
          copies: params.copies,
          cupsOptions: cupsOpts,
        };
        if (params.duplex) {
          const duplexMap: Record<string, string> = {
            "one-sided": "None", "two-sided-long-edge": "DuplexNoTumble", "two-sided-short-edge": "DuplexTumble",
          };
          cupsOpts.Duplex = duplexMap[params.duplex] || "None";
        }
        if (params.paper_size) cupsOpts.PageSize = params.paper_size;
        if (params.color_mode) cupsOpts.ColorModel = params.color_mode === "monochrome" ? "Gray" : "CMYK";
        if (params.orientation) cupsOpts["orientation-requested"] = params.orientation === "landscape" ? "4" : "3";
        if (params.page_ranges) cupsOpts["page-ranges"] = params.page_ranges;
        if (params.fit_to_page) cupsOpts["fit-to-page"] = "true";

        const result = await processAndPrint(fileData.base64, fileData.filename, options);

        // Clean up uploaded file after printing
        await upload.deleteFile(params.file_id);

        if (!result.success) return err(result.message);
        return ok(result);
      } catch (e) { return err(`Error: ${(e as Error).message}`); }
    }
  );

  // ═══ 13. list_uploads ═════════════════════════════════════

  server.registerTool(
    "list_uploads",
    {
      title: "List uploaded files",
      description: "Show files uploaded via /upload endpoint that are available for print_uploaded.",
      inputSchema: ListUploadsInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const files = upload.listFiles();
      if (files.length === 0) {
        return ok("No uploaded files. Upload via: curl -sF 'file=@path' https://printer-mcp.appserver.tokyo/upload");
      }
      return ok(files.map(f => ({
        file_id: f.file_id,
        filename: f.filename,
        size: f.size,
        age_seconds: Math.round((Date.now() - f.uploaded_at) / 1000),
      })));
    }
  );
}
