import { readFile } from "node:fs/promises";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  PrintDocumentInputSchema,
  PrintUrlInputSchema,
  ConvertToPdfInputSchema,
  ValidatePrintOptionsInputSchema,
  ListPrintersInputSchema,
  GetPrinterStatusInputSchema,
  GetPrinterCapabilitiesInputSchema,
  GetPrintJobsInputSchema,
  GetJobStatusInputSchema,
  CancelPrintJobInputSchema,
  GetSupportedFormatsInputSchema,
  type PrintDocumentInput,
  type PrintUrlInput,
  type ConvertToPdfInput,
  type ValidatePrintOptionsInput,
  type GetPrinterStatusInput,
  type GetPrinterCapabilitiesInput,
  type GetPrintJobsInput,
  type GetJobStatusInput,
  type CancelPrintJobInput,
} from "../schemas/printer.js";
import * as cups from "../services/cups.js";
import * as converter from "../services/converter.js";
// Use unified conversion: Mac (primary) → Graph API (fallback)

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

  // ═══ 1. print_document ════════════════════════════════════

  server.registerTool(
    "print_document",
    {
      title: "Print document",
      description: `Print a document to Kyocera TASKalfa 6054ci (DF-7150 finisher installed).

SUPPORTED FILES: PDF, images (JPG/PNG/TIFF), text → direct print. Office files (DOCX/XLSX/PPTX) → auto-converted to PDF via Graph API.

WORKFLOW for finisher options:
  1. Build cups_options from the reference in the parameter description
  2. Call validate_print_options to verify the options are valid
  3. Call print_document with the verified options
  4. Call get_job_status to confirm completion

cups_options parameter contains full hardware reference with all valid values and common combinations.`,
      inputSchema: PrintDocumentInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (params: PrintDocumentInput) => {
      try {
        const result = await processAndPrint(params.document_base64, params.filename, {
          printer: params.printer,
          copies: params.copies,
          duplex: params.duplex,
          paperSize: params.paper_size,
          colorMode: params.color_mode,
          orientation: params.orientation,
          pageRanges: params.page_ranges,
          fitToPage: params.fit_to_page,
          cupsOptions: params.cups_options,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: !result.success };
      } catch (e) { return err(`Error: ${(e as Error).message}`); }
    }
  );

  // ═══ 2. print_url ════════════════════════════════════════

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

  // ═══ 3. convert_to_pdf ═══════════════════════════════════

  server.registerTool(
    "convert_to_pdf",
    {
      title: "Convert to PDF",
      description: `Convert an Office document (DOCX/XLSX/PPTX/etc.) to PDF without printing.
Returns the PDF as base64. Uses Microsoft Office for Mac for 100% fidelity conversion.
Use this to preview or verify a document before printing.`,
      inputSchema: ConvertToPdfInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params: ConvertToPdfInput) => {
      try {
        const route = converter.detectRoute(params.filename);

        if (route === "direct") {
          return ok({ success: true, message: "File is already in a directly printable format (PDF/image/text). No conversion needed.", pdfBase64: params.document_base64 });
        }
        if (route === "unsupported") {
          return err(`Unsupported format: ${params.filename}`);
        }
        if (!converter.isOfficeConversionAvailable()) {
          return err("No Office converter configured. Set GRAPH_* env vars (or MAC_HOST + MAC_USER for Mac).");
        }

        const buf = Buffer.from(params.document_base64, "base64");
        const result = await converter.convertOfficeFile(buf, params.filename);

        if (result.pdfPath) await converter.cleanupTempPdf(result.pdfPath);

        if (!result.success) return err(result.error);

        return ok({
          success: true,
          originalFile: result.originalFile,
          pdfSize: result.fileSize,
          pdfSizeKB: Math.round(result.fileSize / 1024),
          pdfBase64: result.pdfBase64,
          message: `Converted ${result.originalFile} → PDF (${Math.round(result.fileSize / 1024)} KB)`,
        });
      } catch (e) { return err(`Error: ${(e as Error).message}`); }
    }
  );

  // ═══ 4. list_printers ════════════════════════════════════

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
        macOfficeConvert: { description: "Converted to PDF via Mac Office (100% fidelity)", formats: formats.macOffice, status: macStatus },
      });
    }
  );

  // ═══ 11. validate_print_options ═══════════════════════════

  server.registerTool(
    "validate_print_options",
    {
      title: "Validate print options",
      description: `Check if a set of cups_options is valid BEFORE sending to print.
Returns which options are valid, invalid, and any compatibility warnings.
ALWAYS call this before print_document when using finisher options (staple, punch, fold, booklet).

Example: validate_print_options(cups_options: {"Stpl":"Front","Pnch":"2Hole","PageSize":"A4"})`,
      inputSchema: ValidatePrintOptionsInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params: ValidatePrintOptionsInput) => {
      try {
        const printer = params.printer || "TASKalfa-6054ci";
        const caps = await cups.getPrinterCapabilities(printer);

        // Build lookup: optionName → Set of valid values
        const validOptions = new Map<string, Set<string>>();
        for (const cap of caps) {
          validOptions.set(cap.option, new Set(cap.choices));
        }

        const results: { option: string; value: string; valid: boolean; reason: string }[] = [];
        const warnings: string[] = [];

        for (const [key, value] of Object.entries(params.cups_options)) {
          const validValues = validOptions.get(key);
          if (!validValues) {
            results.push({ option: key, value, valid: false, reason: `Unknown option "${key}". Use get_printer_capabilities to see all options.` });
          } else if (!validValues.has(value)) {
            results.push({ option: key, value, valid: false, reason: `Invalid value "${value}". Valid: ${[...validValues].join(", ")}` });
          } else {
            results.push({ option: key, value, valid: true, reason: "OK" });
          }
        }

        // Compatibility checks
        const opts = params.cups_options;
        if (opts.KCBooklet && opts.KCBooklet !== "None" && opts.Stpl && opts.Stpl !== "Center" && opts.Stpl !== "None") {
          warnings.push("Booklet mode typically requires Stpl=Center (saddle-stitch) or Stpl=None.");
        }
        if (opts.Fold === "True" && (!opts.KCBooklet || opts.KCBooklet === "None")) {
          warnings.push("Fold=True is for booklet folding. Set KCBooklet=Left or Right, or use FldA for standalone folding.");
        }
        if (opts.FldA && opts.FldA !== "None" && (!opts.OutputBin || opts.OutputBin !== "FLDTRAY")) {
          warnings.push("When using FldA (folding mode), set OutputBin=FLDTRAY to route output to the fold tray.");
        }
        if (opts.Stpl && opts.Stpl !== "None" && (!opts.Scnt || opts.Scnt === "None")) {
          warnings.push("Stpl is set but Scnt (staple method) is not. Add Scnt=All to staple the whole job, or Scnt=EachN for N-page sets.");
        }

        const allValid = results.every(r => r.valid);
        return ok({
          valid: allValid && warnings.length === 0,
          allOptionsRecognized: allValid,
          results,
          warnings,
          summary: allValid
            ? (warnings.length > 0 ? `All options valid but ${warnings.length} warning(s).` : "All options valid. Safe to print.")
            : `${results.filter(r => !r.valid).length} invalid option(s) found.`,
        });
      } catch (e) { return err(`Error: ${(e as Error).message}`); }
    }
  );
}
