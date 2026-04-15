import { z } from "zod";

// ─── Printer hardware reference (baked from real device PPD) ─
// Kyocera TASKalfa 6054ci + DF-7150 + Punch + Folding + Inserter
const CUPS_OPTIONS_DESC = `Raw CUPS/PPD options. These override named params (duplex, paper_size, etc).

=== INSTALLED HARDWARE ===
Printer: Kyocera TASKalfa 6054ci (socket://192.168.70.116:9100)
Finisher: DF-7150, Punch unit, Folding unit, Inserter (2 tray)
Paper feeders: Cassette 1-4 (PF730A-D) + Multi-purpose tray (MF1)

=== OPTIONS QUICK REFERENCE ===

Staple (Stpl): None | Center | Front | Rear
  Center=中綴じ用 Front=左上 Rear=右上
  → 必ずScnt=Allも設定すること
  → 使えない紙サイズ: A5,A6,B6,封筒,SRA3,Executive,ISOB5,Statement,Folio
  → 使えない紙種類: Cardstock,Envelope,Labels,Rough,Transparency

Staple grouping (Scnt): None | All | Each2..Each100

Punch (Pnch): None | 2Hole | 3Hole | 4Hole
  → 使えない紙サイズ: A6,B6,封筒,Executive,ISOB5,SRA3,OficioII,OficioMX
  → 使えない紙種類: Cardstock,Envelope,Labels,Prepunched,Transparency

中綴じ製本 (KCBooklet): None | Left | Right
  ⚠ PageSizeは「仕上がりサイズ」を指定。プリンタが自動的に倍サイズの紙を使う。
    PageSize=A4 → A3紙に印刷して折り → A4冊子
    PageSize=A5 → A4紙に印刷して折り → A5冊子
    PageSize=B5 → B4紙に印刷して折り → B5冊子
    PageSize=Letter → Tabloid紙に印刷して折り → Letter冊子
  → A3/B4/Tabloid等はPageSizeとして指定不可（倍サイズの紙が存在しないため）
  → Stplと同時指定不可（中綴じは内部で自動ステープル）
  → Fold=True で折りを追加

製本折り (Fold): False | True → KCBookletと併用のみ

折りモード (FldA): None | Bifold | Trifold | Zfold | EngrFold
  Bifold(二つ折り):
    → 使えるサイズ: A3,A4,B4,B5,Letter,Legal,Tabloid,SRA3,P12X18,OficioII,P8K
    → A5以下は不可
  Trifold(三つ折り):
    → 使えるサイズ: A3,A4,Letter,Legal,Tabloid のみ（B4,B5も不可）
  → 全折りで不可な紙種類: Cardstock,Envelope,Labels,Rough,Thick,Transparency,Vellum,Letterhead,Preprinted
  → OutputBin=FLDTRAY を必ず設定

折り面 (FldB/BiFldB): None | FPInside | FPOutside
折り方向 (FldC/ZFldC): None | RIGHTL | LEFTR
折り方法 (FldD/ZFldD/BFpS): None | FLD1..FLD5

用紙サイズ (PageSize): A4 | A3 | A5 | A6 | B4 | B5 | Letter | Legal | Tabloid | SRA3 等
給紙トレイ (InputSlot): Auto | PF730A | PF730B | PF730C | PF730D | MF1 | ST11
  PF730A-D=カセット1-4, MF1=手差し, ST11=サイドトレイ
  ⚠ 印刷前に get_printer_status でトレイの紙設定を確認すること
用紙種類 (MediaType): PrnDef | Auto | Plain | Thick | Cardstock | Envelope | Labels 等
両面 (Duplex): None | DuplexNoTumble(長辺) | DuplexTumble(短辺)
カラー (ColorModel): CMYK | Gray
排紙先 (OutputBin): None | INNERTRAY | LFTTRAYDWN | SEPARATORTRAY | FDStackerA/B | FLDTRAY | MBDWN01-07

=== よくある組み合わせ ===
A4両面+左上ステープル+パンチ: {"Stpl":"Front","Scnt":"All","Pnch":"2Hole","Duplex":"DuplexNoTumble","PageSize":"A4"}
A4中綴じ製本(折り付き): {"KCBooklet":"Left","Fold":"True","PageSize":"A4"}
  ↑ A3紙に2面付け印刷→中綴じステープル→折り→A4冊子
B5中綴じ製本: {"KCBooklet":"Left","Fold":"True","PageSize":"B5"}
  ↑ B4紙使用→B5冊子
A4三つ折り: {"FldA":"Trifold","FldB":"FPInside","OutputBin":"FLDTRAY","PageSize":"A4"}
A3二つ折り: {"FldA":"Bifold","FldB":"FPInside","OutputBin":"FLDTRAY","PageSize":"A3"}
厚紙カセット2から: {"InputSlot":"PF730B","MediaType":"Thick","PageSize":"A4"}

=== 重要な制約まとめ ===
1. KCBooklet(中綴じ)とStpl(ステープル)は同時指定不可。中綴じは自動ステープル。
2. 折り(FldA)使用時はOutputBin=FLDTRAY必須。
3. A5以下の小さい紙はステープル/折り不可（コーナーステープルもA5不可）。
4. 封筒/ラベル/OHPはステープル/パンチ/折りすべて不可。
5. 厚紙(Cardstock/Thick)はステープル/パンチ/折りすべて不可。
6. 中綴じのPageSizeは仕上がりサイズ。A4→A3紙、B5→B4紙を自動使用。A3/B4自体はPageSizeに指定不可。
7. 三つ折りはA3/A4/Letter/Legal/Tabloidのみ。B4/B5も不可。
8. validate_print_options で事前に必ず検証すること（3192ルールで判定）。
9. get_printer_status でトレイの紙サイズ・紙種類を確認してから印刷すること。`;

export const PrintDocumentInputSchema = z.object({
  document_base64: z.string().min(1).describe("Base64-encoded document content"),
  filename: z.string().min(1).max(255).describe("Original filename with extension (e.g. 'report.pdf', 'slides.pptx')"),
  printer: z.string().optional().describe("Printer name. Default: TASKalfa-6054ci"),
  copies: z.number().int().min(1).max(999).default(1).describe("Number of copies"),
  duplex: z.enum(["one-sided", "two-sided-long-edge", "two-sided-short-edge"]).optional(),
  paper_size: z.string().optional().describe("A4, A3, Letter, etc"),
  color_mode: z.enum(["color", "monochrome"]).optional(),
  orientation: z.enum(["portrait", "landscape"]).optional(),
  page_ranges: z.string().optional().describe("'1-5', '2,4,6'"),
  fit_to_page: z.boolean().default(false),
  cups_options: z.record(z.string(), z.string()).optional().describe(CUPS_OPTIONS_DESC),
}).strict();
export type PrintDocumentInput = z.infer<typeof PrintDocumentInputSchema>;

export const ValidatePrintOptionsInputSchema = z.object({
  cups_options: z.record(z.string(), z.string()).describe("Options to validate (same format as print_document cups_options)"),
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
  printer: z.string().optional(),
  completed: z.boolean().default(false),
}).strict();
export type GetPrintJobsInput = z.infer<typeof GetPrintJobsInputSchema>;

export const GetJobStatusInputSchema = z.object({
  job_id: z.string().min(1).describe("Job ID (e.g. '42')"),
}).strict();
export type GetJobStatusInput = z.infer<typeof GetJobStatusInputSchema>;

export const CancelPrintJobInputSchema = z.object({
  job_id: z.string().min(1),
}).strict();
export type CancelPrintJobInput = z.infer<typeof CancelPrintJobInputSchema>;

export const ConvertToPdfInputSchema = z.object({
  document_base64: z.string().min(1),
  filename: z.string().min(1).max(255).describe("Filename with extension (e.g. 'report.docx')"),
}).strict();
export type ConvertToPdfInput = z.infer<typeof ConvertToPdfInputSchema>;

export const PrintUrlInputSchema = z.object({
  url: z.string().url(),
  filename: z.string().min(1).max(255).describe("Filename for format detection"),
  printer: z.string().optional(),
  copies: z.number().int().min(1).max(999).default(1),
  cups_options: z.record(z.string(), z.string()).optional().describe("Same as print_document cups_options"),
}).strict();
export type PrintUrlInput = z.infer<typeof PrintUrlInputSchema>;

export const GetSupportedFormatsInputSchema = z.object({}).strict();
export type GetSupportedFormatsInput = z.infer<typeof GetSupportedFormatsInputSchema>;
