import { z } from "zod";

export const PrintDocumentInputSchema = z.object({
  document_base64: z.string()
    .min(1)
    .describe("Base64-encoded document content (PDF, PostScript, text, image)"),
  filename: z.string()
    .min(1)
    .max(255)
    .describe("Original filename with extension, e.g. 'report.pdf'"),
  printer: z.string()
    .optional()
    .describe("Target printer name. If omitted, uses the system default printer."),
  copies: z.number()
    .int()
    .min(1)
    .max(999)
    .default(1)
    .describe("Number of copies to print (default: 1)"),
  duplex: z.enum(["one-sided", "two-sided-long-edge", "two-sided-short-edge"])
    .optional()
    .describe("Duplex mode"),
  paper_size: z.string()
    .optional()
    .describe("Paper size, e.g. 'A4', 'A3', 'Letter'"),
  color_mode: z.enum(["color", "monochrome"])
    .optional()
    .describe("Print in color or monochrome"),
  orientation: z.enum(["portrait", "landscape"])
    .optional()
    .describe("Page orientation"),
  page_ranges: z.string()
    .optional()
    .describe("Page range, e.g. '1-5', '2,4,6'"),
  fit_to_page: z.boolean()
    .default(false)
    .describe("Scale content to fit paper"),
  cups_options: z.record(z.string(), z.string())
    .optional()
    .describe(
      "Arbitrary CUPS/PPD options as key-value pairs. ALWAYS run get_printer_capabilities first to discover valid options. " +
      "Common Kyocera options: " +
      "KyoStaple (None/TopLeft/TopRight/DualLeft/DualTop/...), " +
      "KyoPunch (None/TwoHoles/ThreeHoles/FourHoles), " +
      "KyoFold (None/HalfFold/TriFold/ZFold), " +
      "KyoBooklet (None/LeftEdge/RightEdge), " +
      "InputSlot (Auto/Tray1/Tray2/Tray3/MPTray), " +
      "MediaType (Auto/Plain/Rough/Thick1/Thick2/Thick3/Labels/Transparency/Envelope/Cardstock/...), " +
      "Resolution (600dpi/1200dpi), " +
      "CvrM (cover mode), Ecop (eco print On/Off). " +
      "These take PRIORITY over the named params above."
    ),
}).strict();

export type PrintDocumentInput = z.infer<typeof PrintDocumentInputSchema>;

export const ListPrintersInputSchema = z.object({}).strict();
export type ListPrintersInput = z.infer<typeof ListPrintersInputSchema>;

export const GetPrinterStatusInputSchema = z.object({
  printer: z.string().min(1).describe("Printer name as shown by list_printers"),
}).strict();
export type GetPrinterStatusInput = z.infer<typeof GetPrinterStatusInputSchema>;

export const GetPrinterCapabilitiesInputSchema = z.object({
  printer: z.string().min(1).describe("Printer name"),
  filter: z.string().optional()
    .describe("Case-insensitive filter for option names: 'staple', 'punch', 'fold', 'tray', 'media', 'booklet', etc. Omit to list ALL options."),
}).strict();
export type GetPrinterCapabilitiesInput = z.infer<typeof GetPrinterCapabilitiesInputSchema>;

export const GetPrintJobsInputSchema = z.object({
  printer: z.string().optional().describe("Filter by printer name. Omit for all."),
  completed: z.boolean().default(false).describe("Include recently completed jobs (via CUPS log)"),
}).strict();
export type GetPrintJobsInput = z.infer<typeof GetPrintJobsInputSchema>;

export const GetJobStatusInputSchema = z.object({
  job_id: z.string().min(1).describe("Print job ID, e.g. '42' or 'Kyocera-TASKalfa-6054ci-42'"),
}).strict();
export type GetJobStatusInput = z.infer<typeof GetJobStatusInputSchema>;

export const CancelPrintJobInputSchema = z.object({
  job_id: z.string().min(1).describe("Print job ID to cancel"),
}).strict();
export type CancelPrintJobInput = z.infer<typeof CancelPrintJobInputSchema>;

export const ConvertToPdfInputSchema = z.object({
  document_base64: z.string().min(1).describe("Base64-encoded document content"),
  filename: z.string().min(1).max(255).describe("Original filename with extension, e.g. 'report.docx'"),
}).strict();
export type ConvertToPdfInput = z.infer<typeof ConvertToPdfInputSchema>;

export const PrintUrlInputSchema = z.object({
  url: z.string().url().describe("URL of the file to download and print"),
  filename: z.string().min(1).max(255).describe("Filename to use (for format detection), e.g. 'report.pdf'"),
  printer: z.string().optional().describe("Target printer name"),
  copies: z.number().int().min(1).max(999).default(1).describe("Number of copies"),
  cups_options: z.record(z.string(), z.string()).optional()
    .describe("CUPS/PPD options (same as print_document)"),
}).strict();
export type PrintUrlInput = z.infer<typeof PrintUrlInputSchema>;

export const GetSupportedFormatsInputSchema = z.object({}).strict();
export type GetSupportedFormatsInput = z.infer<typeof GetSupportedFormatsInputSchema>;
