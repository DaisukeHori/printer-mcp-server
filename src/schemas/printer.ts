import { z } from "zod";

// ─── Compact reference (detailed info via get_printer_capabilities) ─
const CUPS_OPTIONS_DESC = `CUPS/PPD options. Use validate_print_options BEFORE printing.

WORKFLOW: get_printer_status → build options → validate_print_options → print_document → get_job_status

KEY OPTIONS:
  Stpl: Front(左上)|Rear(右上) + Scnt:All必須. Max100枚. A5以下/封筒/厚紙不可
  Pnch: 2Hole|3Hole|4Hole. A6以下/封筒/厚紙不可
  KCBooklet: Left(横書き)|Right(縦書き) + Fold:True. PageSize=仕上がりサイズ(A4→A3紙自動). Max20枚(80p),60-90gsm. Stplと同時不可
  FldA: Bifold(A3-B5)|Trifold(A4/Letterのみ) + FldB:FPInside|FPOutside + OutputBin:FLDTRAY必須. Max3枚,普通紙のみ
  Duplex: DuplexNoTumble(長辺)|DuplexTumble(短辺)
  PageSize: A4|A3|A5|B4|B5|Letter|Legal|Tabloid等
  InputSlot: Auto|PF730A-D(カセット1-4)|MF1(手差し)
  MediaType: Plain|Thick|Cardstock|Envelope|Labels等
  ColorModel: CMYK|Gray
  OutputBin: None|INNERTRAY|FLDTRAY(折り用)等

COMMON:
  A4両面+ステープル+パンチ: {"Stpl":"Front","Scnt":"All","Pnch":"2Hole","Duplex":"DuplexNoTumble","PageSize":"A4"}
  A4中綴じ左綴じ: {"KCBooklet":"Left","Fold":"True","PageSize":"A4"}
  A4三つ折り: {"FldA":"Trifold","FldB":"FPInside","OutputBin":"FLDTRAY","PageSize":"A4"}`;

export const PrintDocumentInputSchema = z.object({
  document_base64: z.string().min(1).describe("Base64-encoded document content"),
  filename: z.string().min(1).max(255).describe("Filename with extension. Office auto-converted to PDF."),
  printer: z.string().optional().describe("Default: TASKalfa-6054ci"),
  copies: z.number().int().min(1).max(999).default(1),
  duplex: z.enum(["one-sided", "two-sided-long-edge", "two-sided-short-edge"]).optional(),
  paper_size: z.string().optional(),
  color_mode: z.enum(["color", "monochrome"]).optional(),
  orientation: z.enum(["portrait", "landscape"]).optional(),
  page_ranges: z.string().optional().describe("'1-5', '2,4,6'"),
  fit_to_page: z.boolean().default(false),
  cups_options: z.record(z.string(), z.string()).optional().describe(CUPS_OPTIONS_DESC),
}).strict();
export type PrintDocumentInput = z.infer<typeof PrintDocumentInputSchema>;

export const ValidatePrintOptionsInputSchema = z.object({
  cups_options: z.record(z.string(), z.string()).describe("Options to validate before printing"),
  printer: z.string().optional().describe("Default: TASKalfa-6054ci"),
}).strict();
export type ValidatePrintOptionsInput = z.infer<typeof ValidatePrintOptionsInputSchema>;

export const ListPrintersInputSchema = z.object({}).strict();
export type ListPrintersInput = z.infer<typeof ListPrintersInputSchema>;

export const GetPrinterStatusInputSchema = z.object({
  printer: z.string().min(1).describe("Printer name"),
}).strict();
export type GetPrinterStatusInput = z.infer<typeof GetPrinterStatusInputSchema>;

export const GetPrinterCapabilitiesInputSchema = z.object({
  printer: z.string().min(1),
  filter: z.string().optional().describe("staple|punch|fold|tray|media|booklet|output|duplex|color|inserter"),
}).strict();
export type GetPrinterCapabilitiesInput = z.infer<typeof GetPrinterCapabilitiesInputSchema>;

export const GetPrintJobsInputSchema = z.object({
  printer: z.string().optional(),
  completed: z.boolean().default(false),
}).strict();
export type GetPrintJobsInput = z.infer<typeof GetPrintJobsInputSchema>;

export const GetJobStatusInputSchema = z.object({
  job_id: z.string().min(1),
}).strict();
export type GetJobStatusInput = z.infer<typeof GetJobStatusInputSchema>;

export const CancelPrintJobInputSchema = z.object({
  job_id: z.string().min(1),
}).strict();
export type CancelPrintJobInput = z.infer<typeof CancelPrintJobInputSchema>;

export const ConvertToPdfInputSchema = z.object({
  document_base64: z.string().min(1),
  filename: z.string().min(1).max(255),
}).strict();
export type ConvertToPdfInput = z.infer<typeof ConvertToPdfInputSchema>;

export const PrintUrlInputSchema = z.object({
  url: z.string().url(),
  filename: z.string().min(1).max(255),
  printer: z.string().optional(),
  copies: z.number().int().min(1).max(999).default(1),
  cups_options: z.record(z.string(), z.string()).optional().describe("Same format as print_document"),
}).strict();
export type PrintUrlInput = z.infer<typeof PrintUrlInputSchema>;

export const GetSupportedFormatsInputSchema = z.object({}).strict();
export type GetSupportedFormatsInput = z.infer<typeof GetSupportedFormatsInputSchema>;
