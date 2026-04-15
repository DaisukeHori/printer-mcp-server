import { z } from "zod";

// ─── Printer hardware reference (baked from real device) ────
// Kyocera TASKalfa 6054ci + DF-7150 + Punch + Folding + Inserter
const CUPS_OPTIONS_DESC = `Raw CUPS/PPD options as key-value pairs. These override named params (duplex, paper_size, etc).

=== INSTALLED HARDWARE ===
Printer: Kyocera TASKalfa 6054ci
Finisher: DF-7150 (staple/punch/fold/booklet capable)
Punch unit: Installed (2-hole/3-hole/4-hole)
Folding unit: Installed (bi-fold/tri-fold/engineering fold)
Inserter: Installed (2 trays)
Paper feeders: 4 cassettes (PF730A-D) + Multi-purpose tray (MF1)

=== KEY OPTIONS AND VALID VALUES ===

Staple (Stpl): None | Center | Front | Rear
  - Center = saddle-stitch (center 2-point, for booklet)
  - Front = top-left corner
  - Rear = top-right corner

Staple grouping (Scnt): None | All | Each2..Each100
  - All = staple entire job as one set
  - EachN = staple every N pages as separate sets

Punch (Pnch): None | 2Hole | 2HoleEUR | 3Hole | 4Hole

Booklet (KCBooklet): None | Left | Right
  - Left = left-edge binding
  - Right = right-edge binding
  - Combine with Fold=True for folded booklet

Booklet fold (Fold): False | True
  - Only used with KCBooklet. Folds the booklet in half.

Folding mode (FldA): None | Bifold | Trifold | Zfold | EngrFold
Folding side (FldB): None | FPInside | FPOutside
Bi-fold side (BiFldB): None | FPInside | FPOutside
Folding direction (FldC): None | RIGHTL | LEFTR
Folding method (FldD): None | FLD1..FLD5
Z-fold direction (ZFldC): None | RIGHTL | LEFTR
Z-fold method (ZFldD): None | FLD1..FLD5

Paper size (PageSize): A4 | A3 | A5 | A6 | B4 | B5 | Letter | Legal | Tabloid | SRA3 | etc
Paper source (InputSlot): Auto | PF730A | PF730B | PF730C | PF730D | MF1 | ST11
  - PF730A-D = Cassette 1-4
  - MF1 = Multi-purpose tray
  - ST11 = Side tray
Paper type (MediaType): PrnDef | Auto | Plain | Transparency | Labels | Letterhead | Bond | Color | Preprinted | Prepunched | Recycled | Cardstock | Vellum | Envelope | Rough | Thick | CoatedPaper | Highqlty

Duplex (Duplex): None | DuplexTumble | DuplexNoTumble
  - None = one-sided
  - DuplexNoTumble = two-sided long-edge (default for duplex)
  - DuplexTumble = two-sided short-edge (flip on short edge)

Color (ColorModel): CMYK | Gray

Output bin (OutputBin): None | INNERTRAY | LFTTRAYDWN | SEPARATORTRAY | FDStackerA | FDStackerB | FLDTRAY | MBDWN01..MBDWN07
  - FLDTRAY = folding unit output tray
  - MBDWN01-07 = mailbox bins

=== COMMON COMBINATIONS ===
Staple top-left: {"Stpl":"Front","Scnt":"All"}
Staple + 2-hole punch: {"Stpl":"Front","Scnt":"All","Pnch":"2Hole"}
Booklet (folded, left-bind): {"KCBooklet":"Left","Fold":"True","Stpl":"Center","Scnt":"All"}
Tri-fold letter: {"FldA":"Trifold","FldB":"FPInside","OutputBin":"FLDTRAY"}
Two-sided A3 color: {"PageSize":"A3","Duplex":"DuplexNoTumble","ColorModel":"CMYK"}
Thick paper from tray 2: {"InputSlot":"PF730B","MediaType":"Thick"}`;

export const PrintDocumentInputSchema = z.object({
  document_base64: z.string().min(1).describe("Base64-encoded document content"),
  filename: z.string().min(1).max(255).describe("Original filename with extension (e.g. 'report.pdf', 'slides.pptx')"),
  printer: z.string().optional().describe("Printer name. Default: TASKalfa-6054ci"),
  copies: z.number().int().min(1).max(999).default(1).describe("Number of copies"),
  duplex: z.enum(["one-sided", "two-sided-long-edge", "two-sided-short-edge"]).optional().describe("Duplex mode (shorthand; cups_options Duplex takes priority)"),
  paper_size: z.string().optional().describe("Paper size shorthand: A4, A3, Letter, etc"),
  color_mode: z.enum(["color", "monochrome"]).optional().describe("Color shorthand"),
  orientation: z.enum(["portrait", "landscape"]).optional().describe("Orientation"),
  page_ranges: z.string().optional().describe("Page range: '1-5', '2,4,6'"),
  fit_to_page: z.boolean().default(false).describe("Scale to fit paper"),
  cups_options: z.record(z.string(), z.string()).optional().describe(CUPS_OPTIONS_DESC),
}).strict();
export type PrintDocumentInput = z.infer<typeof PrintDocumentInputSchema>;

export const ValidatePrintOptionsInputSchema = z.object({
  cups_options: z.record(z.string(), z.string()).describe("Options to validate. Same key-value format as print_document's cups_options."),
  printer: z.string().optional().describe("Printer name. Default: TASKalfa-6054ci"),
}).strict();
export type ValidatePrintOptionsInput = z.infer<typeof ValidatePrintOptionsInputSchema>;

export const ListPrintersInputSchema = z.object({}).strict();
export type ListPrintersInput = z.infer<typeof ListPrintersInputSchema>;

export const GetPrinterStatusInputSchema = z.object({
  printer: z.string().min(1).describe("Printer name"),
}).strict();
export type GetPrinterStatusInput = z.infer<typeof GetPrinterStatusInputSchema>;

export const GetPrinterCapabilitiesInputSchema = z.object({
  printer: z.string().min(1).describe("Printer name"),
  filter: z.string().optional().describe("Filter: 'staple', 'punch', 'fold', 'tray', 'media', 'booklet', 'output', 'duplex', 'color'"),
}).strict();
export type GetPrinterCapabilitiesInput = z.infer<typeof GetPrinterCapabilitiesInputSchema>;

export const GetPrintJobsInputSchema = z.object({
  printer: z.string().optional().describe("Filter by printer name"),
  completed: z.boolean().default(false).describe("Include completed jobs"),
}).strict();
export type GetPrintJobsInput = z.infer<typeof GetPrintJobsInputSchema>;

export const GetJobStatusInputSchema = z.object({
  job_id: z.string().min(1).describe("Job ID (e.g. '42')"),
}).strict();
export type GetJobStatusInput = z.infer<typeof GetJobStatusInputSchema>;

export const CancelPrintJobInputSchema = z.object({
  job_id: z.string().min(1).describe("Job ID to cancel"),
}).strict();
export type CancelPrintJobInput = z.infer<typeof CancelPrintJobInputSchema>;

export const ConvertToPdfInputSchema = z.object({
  document_base64: z.string().min(1).describe("Base64-encoded Office document"),
  filename: z.string().min(1).max(255).describe("Filename with extension (e.g. 'report.docx')"),
}).strict();
export type ConvertToPdfInput = z.infer<typeof ConvertToPdfInputSchema>;

export const PrintUrlInputSchema = z.object({
  url: z.string().url().describe("URL to download and print"),
  filename: z.string().min(1).max(255).describe("Filename for format detection (e.g. 'report.pdf')"),
  printer: z.string().optional().describe("Printer name"),
  copies: z.number().int().min(1).max(999).default(1),
  cups_options: z.record(z.string(), z.string()).optional().describe("Same as print_document cups_options"),
}).strict();
export type PrintUrlInput = z.infer<typeof PrintUrlInputSchema>;

export const GetSupportedFormatsInputSchema = z.object({}).strict();
export type GetSupportedFormatsInput = z.infer<typeof GetSupportedFormatsInputSchema>;
