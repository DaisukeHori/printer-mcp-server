import { z } from "zod";

// ─── Printer hardware reference (baked from real device PPD + spec sheets) ─
const CUPS_OPTIONS_DESC = `Raw CUPS/PPD options. These override named params (duplex, paper_size, etc).

=== 実機ハードウェア構成 ===
プリンタ: Kyocera TASKalfa 6054ci (60ppm, A3対応)
フィニッシャー: DF-7150 (4,000枚排紙, 100枚ステープル)
中折りユニット: BF-9100 (中綴じ製本+三つ折り)
パンチユニット: PH-7B (2穴/3穴/4穴)
インサーター: IS-7100 (2トレイ, 表紙・合紙挿入)
給紙: カセット1-4 (PF730A-D) + 手差し (MF1)

=== ステープル (Stpl + Scnt) ===
Stpl: None | Front(左上) | Rear(右上) | Center(中綴じ)
Scnt: None | All(全ページ1セット) | Each2..Each100(N枚ごと)
  ⚠ Stpl設定時はScntも必ず設定すること
  物理上限: 普通紙(64gsm) 最大100枚、厚紙は枚数減少
  コーナーステープル(Front/Rear):
    → 使える紙サイズ: A4, A3, B4, B5, Letter, Legal, Tabloid, P8K, P16K, P12X18, OficioII, OficioMX
    → 使えない紙サイズ: A5以下, 封筒, SRA3, Executive, ISOB5, Folio, Statement
  中綴じステープル(Center):
    → 同上の紙サイズ制約 + KCBooklet使用時は自動適用されるのでStplは指定不要
  使えない紙種類: Cardstock, Envelope, Labels, Rough, Transparency

=== パンチ (Pnch) ===
Pnch: None | 2Hole | 3Hole | 4Hole
  使えない紙サイズ: A6, B6, 封筒, Executive, ISOB5, SRA3, OficioII, OficioMX
  使えない紙種類: Cardstock, Envelope, Labels, Prepunched, Transparency

=== 中綴じ製本 (KCBooklet + Fold) ===
KCBooklet: None | Left(左綴じ=横書き用) | Right(右綴じ=縦書き・和文用)
Fold: False | True (中折り)
  ⚠ PageSizeは「仕上がりサイズ」を指定。プリンタが自動的に倍サイズの紙を使う:
    PageSize=A4 → A3紙に2面付け印刷 → 中綴じ+折り → A4冊子
    PageSize=A5 → A4紙に印刷 → A5冊子
    PageSize=B5 → B4紙に印刷 → B5冊子
    PageSize=Letter → Tabloid紙に印刷 → Letter冊子
  ⚠ A3/B4/Tabloid自体はPageSizeに指定不可（倍サイズの紙がないため）
  ⚠ KCBookletとStplは同時指定不可（中綴じは自動でセンターステープル）
  物理上限: BF-9100は最大20枚（=80ページ冊子）、60-90gsm普通紙のみ
  左綴じ(Left): 英語・横書き文書向け（左側を綴じて右にめくる）
  右綴じ(Right): 日本語縦書き・漫画向け（右側を綴じて左にめくる）

=== 折りモード (FldA + FldB + FldC) ===
FldA: None | Bifold(二つ折り) | Trifold(三つ折り) | Zfold(Z折り) | EngrFold(エンジニアリング折り)
FldB: None | FPInside(1ページ目が内側) | FPOutside(1ページ目が外側)
BiFldB: None | FPInside | FPOutside （二つ折り専用の面指定）
FldC: None | RIGHTL(右から左) | LEFTR(左から右) （折り方向）
FldD: None | FLD1..FLD5 （折り方法バリエーション）
  ⚠ OutputBin=FLDTRAY を必ず設定すること

  二つ折り(Bifold):
    使えるサイズ: A3, A4, B4, B5, Letter, Legal, Tabloid, SRA3, P12X18, OficioII, P8K
    使えないサイズ: A5以下（小さすぎて折れない）
    重ね折り: 最大3枚まで（請求書を封筒に入れる用途等）

  三つ折り(Trifold):
    使えるサイズ: A4, Letter のみ（BF-9100の制約）
    ⚠ A3/B4/Tabloidの三つ折りにはZF-7100(Z折りユニット)が必要→未装着
    重ね折り: 最大3枚まで
    FldB=FPInside: 宛名面が外側になる（封筒に入れてそのまま見える）
    FldB=FPOutside: 宛名面が内側になる（開けないと見えない）

  Z折り: ZF-7100未装着のため使用不可

  全折りで使えない紙種類:
    Cardstock, Envelope, Labels, Rough, Thick, Transparency, Vellum, Letterhead, Preprinted
    → 普通紙(Plain, 60-90gsm)のみ対応

=== 用紙設定 ===
用紙サイズ (PageSize): A4 | A3 | A5 | A6 | B4 | B5 | Letter | Legal | Tabloid | SRA3 等
給紙トレイ (InputSlot): Auto | PF730A(カセット1) | PF730B(カセット2) | PF730C(カセット3) | PF730D(カセット4) | MF1(手差し) | ST11(サイドトレイ)
  ⚠ 印刷前に get_printer_status でトレイの紙設定を確認すること
  ⚠ ドライバ指定のPageSize/MediaTypeとトレイ実紙が不一致だとエラーになる
用紙種類 (MediaType): PrnDef | Auto | Plain | Thick | Cardstock | Envelope | Labels | Transparency | Rough | Letterhead | Bond | Color | Preprinted | Prepunched | Recycled | Vellum | CoatedPaper | Highqlty
両面 (Duplex): None(片面) | DuplexNoTumble(両面長辺綴じ=縦向き標準) | DuplexTumble(両面短辺綴じ=横向き上下見開き)
  長辺綴じ(NoTumble): 縦向きの資料を左右にめくる（通常の両面印刷）
  短辺綴じ(Tumble): 横向きの資料を上下にめくる（カレンダーやメモ帳のように）
カラー (ColorModel): CMYK(カラー) | Gray(モノクロ)
排紙先 (OutputBin): None | INNERTRAY | LFTTRAYDWN | SEPARATORTRAY | FDStackerA/B | FLDTRAY(折りトレイ) | MBDWN01-07(メールボックス)

=== インサーター (IS-7100) ===
CvrM: 表紙の用紙種類指定（Inserter1/Inserter2から給紙）
BackCvrM: 裏表紙の用紙種類指定
  → 表紙付き冊子や章区切り合紙の挿入が可能

=== よくある組み合わせ ===
A4両面+左上ステープル+パンチ:
  {"Stpl":"Front","Scnt":"All","Pnch":"2Hole","Duplex":"DuplexNoTumble","PageSize":"A4"}
A4中綴じ製本(左綴じ・折り付き):
  {"KCBooklet":"Left","Fold":"True","PageSize":"A4"}
  → A3紙に2面付け→中綴じステープル→中折り→A4冊子
A4中綴じ製本(右綴じ・縦書き用):
  {"KCBooklet":"Right","Fold":"True","PageSize":"A4"}
A4三つ折り(宛名が外側):
  {"FldA":"Trifold","FldB":"FPInside","FldC":"RIGHTL","OutputBin":"FLDTRAY","PageSize":"A4"}
A3二つ折り:
  {"FldA":"Bifold","BiFldB":"FPInside","OutputBin":"FLDTRAY","PageSize":"A3"}
厚紙カセット2:
  {"InputSlot":"PF730B","MediaType":"Thick","PageSize":"A4"}
横向き短辺綴じ両面:
  {"Duplex":"DuplexTumble","PageSize":"A4"}

=== 重要な制約まとめ ===
1. KCBooklet(中綴じ)とStpl(ステープル)は同時指定不可。中綴じは自動ステープル。
2. 折り(FldA)使用時はOutputBin=FLDTRAY必須。
3. A5以下はステープル/折り不可。A6以下はパンチも不可。
4. 封筒/ラベル/OHPはステープル/パンチ/折りすべて不可。
5. 厚紙/ラフ紙は折り不可。厚紙はステープル/パンチも不可。
6. 中綴じのPageSizeは仕上がりサイズ。A4→A3紙、B5→B4紙を自動使用。
7. 三つ折りはA4/Letterのみ（BF-9100の制約）。A3三つ折りにはZ折りユニット必要(未装着)。
8. 中綴じ製本は最大20枚(80ページ)、折りは最大3枚重ね。普通紙(60-90gsm)のみ。
9. validate_print_options で事前に必ず検証すること（3192ルールで自動判定）。
10. get_printer_status でトレイの紙サイズ・紙種類を確認してから印刷すること。`;

export const PrintDocumentInputSchema = z.object({
  document_base64: z.string().min(1).describe("Base64-encoded document content"),
  filename: z.string().min(1).max(255).describe("Original filename (e.g. 'report.pdf', 'slides.pptx'). Office files auto-converted to PDF via Graph API."),
  printer: z.string().optional().describe("Printer name. Default: TASKalfa-6054ci"),
  copies: z.number().int().min(1).max(999).default(1),
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
  printer: z.string().min(1).describe("Printer name. Returns: state, active jobs, tray paper config, supply levels"),
}).strict();
export type GetPrinterStatusInput = z.infer<typeof GetPrinterStatusInputSchema>;

export const GetPrinterCapabilitiesInputSchema = z.object({
  printer: z.string().min(1),
  filter: z.string().optional().describe("Filter: 'staple','punch','fold','tray','media','booklet','output','duplex','color','inserter'"),
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
  cups_options: z.record(z.string(), z.string()).optional().describe("Same as print_document cups_options"),
}).strict();
export type PrintUrlInput = z.infer<typeof PrintUrlInputSchema>;

export const GetSupportedFormatsInputSchema = z.object({}).strict();
export type GetSupportedFormatsInput = z.infer<typeof GetSupportedFormatsInputSchema>;
