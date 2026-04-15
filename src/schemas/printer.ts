import { z } from "zod";

// ─── Compact reference (detailed info via get_printer_capabilities) ─
const CUPS_OPTIONS_DESC = `CUPS/PPD options. Use validate_print_options BEFORE printing.

WORKFLOW: get_printer_status → build options → validate_print_options → print_document → get_job_status

KEY OPTIONS:
  Stpl: Front(左上1箇所)|Rear(右上1箇所)|DualLeft(左辺2箇所)|Center(左辺2箇所,DualLeftと同じ) + Scnt:All必須. Max100枚. A5以下/封筒/厚紙不可
  Pnch: 2Hole|3Hole|4Hole. A6以下/封筒/厚紙不可
  KCBooklet: Left(横書き)|Right(縦書き) + Fold:True. PageSize=仕上がりサイズ(A4→A3紙自動). Max20枚(80p),60-90gsm. Stplと同時不可
  FldA: Bifold(A3-B5)|Trifold(A4/Letterのみ) + FldB:FPInside|FPOutside + OutputBin:FLDTRAY必須. Max3枚,普通紙のみ
  Duplex: DuplexNoTumble(長辺)|DuplexTumble(短辺)
  number-up: 2|4|6|9|16 (1枚にNページ面付け). KCBookletと併用可(面付け後に製本)
  number-up-layout: lrtb(左→右,上→下,標準)|rltb(右→左,縦書き向け)|tblr|btlr|btrl|lrbt|rlbt|tbrl
  PageSize: A4|A3|A5|B4|B5|Letter|Legal|Tabloid等
  InputSlot: Auto|PF730A-D(カセット1-4)|MF1(手差し)
  MediaType: Plain|Thick|Cardstock|Envelope|Labels等
  ColorModel: CMYK|Gray
  OutputBin: None|INNERTRAY|FLDTRAY(折り用)等

COMMON:
  A4両面+左上1箇所ステープル+パンチ: {"Stpl":"Front","Scnt":"All","Pnch":"2Hole","Duplex":"DuplexNoTumble","PageSize":"A4"}
  A4両面+左辺2箇所ステープル: {"Stpl":"DualLeft","Scnt":"All","Duplex":"DuplexNoTumble","PageSize":"A4"}
  A4中綴じ左綴じ: {"KCBooklet":"Left","Fold":"True","PageSize":"A4"}
  A4三つ折り: {"FldA":"Trifold","FldB":"FPInside","OutputBin":"FLDTRAY","PageSize":"A4"}
  A4に4ページ面付け: {"number-up":"4","number-up-layout":"lrtb","PageSize":"A4"}
  2ページ面付け+両面+ステープル(紙節約): {"number-up":"2","Duplex":"DuplexNoTumble","Stpl":"Front","Scnt":"All","PageSize":"A4"}
  4ページ面付け+両面+パンチ(配布資料): {"number-up":"4","number-up-layout":"lrtb","Duplex":"DuplexNoTumble","Pnch":"2Hole","PageSize":"A4"}
  A3に2ページ面付け+二つ折り(リーフレット): {"number-up":"2","FldA":"Bifold","BiFldB":"FPInside","OutputBin":"FLDTRAY","PageSize":"A3"}
  横長PPTX→A4縦2up→中綴じ製本: {"number-up":"2","KCBooklet":"Left","Fold":"True","PageSize":"A4"}`;

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

export const PrintUploadedInputSchema = z.object({
  file_id: z.string().min(1).describe("File ID returned by /upload endpoint"),
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
export type PrintUploadedInput = z.infer<typeof PrintUploadedInputSchema>;

export const ListUploadsInputSchema = z.object({}).strict();
export type ListUploadsInput = z.infer<typeof ListUploadsInputSchema>;
