# printer-mcp-server

**AIに「印刷して」と言うだけ。**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-Streamable_HTTP-orange)](https://modelcontextprotocol.io)
[![Tools](https://img.shields.io/badge/Tools-11-green)]()
[![Formats](https://img.shields.io/badge/Formats-70-blue)]()

> **エンドポイント:** `https://printer-mcp.appserver.tokyo/mcp`
> **LP:** [daisukehori.github.io/printer-mcp-server](https://daisukehori.github.io/printer-mcp-server/)

Kyocera TASKalfa 6054ci ネットワーク複合機をMCP化。**70種類のファイル形式**に対応。ファイルをアップロードして印刷指示を出すだけ。PDF・画像はそのまま、iPhoneのHEIC写真・Photoshop・Illustrator・カメラRAWはImageMagickで変換、Markdown・HTML・CAD(DXF)はpandoc/wkhtmltopdf/ezdxfで変換、Office文書はGraph APIでPDF変換。7種類のステープル・パンチ・中綴じ製本（タテ・ヨコ）・折り・面付けなどフィニッシャー機能をフル制御。**3,192件のPPDハードウェア制約ルール**による事前バリデーション付き。

## ゼロトークン印刷

```bash
# ステップ1: bash_toolでアップロード（トークン消費ゼロ）
curl -sF "file=@/mnt/user-data/uploads/photo.heic" https://printer-mcp.appserver.tokyo/upload
# → {"file_id":"abc123","filename":"photo.heic","size":2450000}

# ステップ2: MCPツールで印刷（HEIC→JPEG自動変換→CUPS）
print_uploaded(file_id="abc123", cups_options={"Stpl":"DualLeft","Scnt":"All","Duplex":"DuplexNoTumble"})
```

AIはファイル形式を意識不要。何でも同じ操作で印刷されます。

## 対応ファイル形式（70種類）

| カテゴリ | 数 | 形式 | 変換方法 |
|:--|:--|:--|:--|
| **直接印刷** | 12 | PDF, PS, EPS, TXT, JPEG, PNG, TIFF, GIF, BMP | そのままCUPS |
| **画像変換** | 34 | **HEIC, HEIF** (iPhone), PSD, PSB (Photoshop), AI (Illustrator), XCF (GIMP), AVIF, WEBP, SVG, TGA, ICO, PCX + カメラRAW 22種 (DNG, CR2, CR3, NEF, ARW, ORF, RAF, RW2, PEF, MEF, MRW, SRF, SR2, ERF, KDC, CRW, NRW, RAW, 3FR, X3F 等) | ImageMagick → JPEG |
| **ドキュメント変換** | 5 | MD, Markdown, HTML, HTM, **DXF** (AutoCAD 2D) | pandoc+wkhtmltopdf / ezdxf+matplotlib |
| **Office変換** | 19 | DOCX, DOC, XLSX, XLS, PPTX, PPT, CSV, RTF, ODT, DOCM, XLSM, XLSB, PPTM, PPSX, PPS, DOTX, DOTM, XLTX, POTX | Graph API → PDF |

## アーキテクチャ

```
Claude.ai / Claude Desktop / Claude Code / Cursor
  ↓ bash_tool: curl -sF "file=@doc.pptx" .../upload → {file_id}
  ↓ MCP: print_uploaded(file_id, cups_options)
Cloudflare Tunnel (printer-mcp.appserver.tokyo)
  ↓
┌──────────────────────────────────────────────────────┐
│ Proxmox LXC (VMID 312, Ubuntu 24.04)                 │
│  /upload → /tmp/ (30分自動削除)                        │
│  printer-mcp-server (Node.js 22)                      │
│   ├── PDF/画像/テキスト → 直接 CUPS                    │
│   ├── HEIC/PSD/AI/RAW → ImageMagick → JPEG → CUPS    │
│   ├── MD/HTML → pandoc+wkhtmltopdf → PDF → CUPS       │
│   ├── DXF → ezdxf+matplotlib → PNG → CUPS             │
│   ├── Office → Graph API → PDF → CUPS                 │
│   └── validate → 3,192 PPD + PRESCRIBE制約             │
│  CUPS + Kyocera UPD v10.0 + カスタムPPD                │
│   └── socket:// → TASKalfa 6054ci                     │
└──────────────────────────────────────────────────────┘
```

## ハードウェア構成

| 装置 | 型番 | 主な能力 |
|:--|:--|:--|
| 複合機 | TASKalfa 6054ci | 60ppm, A3, カラー, 52-300gsm |
| フィニッシャー | DF-7150 | 4,000枚排紙, **100枚ステープル**, 2トレイ |
| 中折りユニット | BF-9100 | 中綴じ**最大20枚(80p)**, 二つ折り, 三つ折り |
| パンチ | PH-7B | 2穴/3穴/4穴 |
| インサーター | IS-7100 | 2トレイ, 表紙・裏表紙・合紙挿入 |

## ツール一覧 (11 tools)

| # | ツール | 種別 | 説明 |
|:--|:--|:--|:--|
| 1 | `print_uploaded` | Write | **メイン印刷。** /upload→file_id→印刷（ゼロトークン） |
| 2 | `print_url` | Write | URLダウンロード→変換→印刷 |
| 3 | `validate_print_options` | Read | **3,192件PPD制約 + CUPSビルトイン検証** |
| 4 | `list_uploads` | Read | アップロード済みファイル一覧 |
| 5 | `get_printer_capabilities` | Read | PPDオプション一覧 (filter付) |
| 6 | `get_supported_formats` | Read | 対応形式一覧 |
| 7 | `list_printers` | Read | プリンタ一覧 |
| 8 | `get_printer_status` | Read | 状態 + トレイ紙設定 |
| 9 | `get_print_jobs` | Read | キュー一覧 |
| 10 | `get_job_status` | Read | ジョブ詳細 + CUPSログ |
| 11 | `cancel_print_job` | Destructive | ジョブキャンセル |

### HTTPエンドポイント

| エンドポイント | 認証 | 説明 |
|:--|:--|:--|
| `POST /upload` | 不要 | multipart/form-dataでファイルアップロード（30分自動削除） |
| `GET /uploads` | 不要 | アップロード済みファイル一覧 |
| `GET /health` | 不要 | ヘルスチェック |

## ステープル（全7種類）

[PRESCRIBE Commands Reference](https://dam.kyoceradocumentsolutions.com/content/dam/gdam_dc/dc_global/document/manual/common/PrescribeCom_KD_EN_202301.pdf) のSTTPLコマンド仕様に基づくStaplePosition値をPPDに追加。

| cups_options | PRESCRIBE pos | 動作 | 実機 |
|:--|:--|:--|:--|
| `Stpl=Front` | 1 | 左下コーナー1箇所 | ✅ |
| `Stpl=Rear` | 2 | 左上コーナー1箇所 | - |
| `Stpl=DualLeft` | 3 | **左辺2箇所** | ✅ |
| `Stpl=Center` | 3 | =DualLeft（PPD互換名） | ✅ |
| `Stpl=TopRight` | 51 | 右上コーナー1箇所 | - |
| `Stpl=DualRight` | 53 | 右辺2箇所 | - |
| `Stpl=DualTop` | 54 | 上辺2箇所 | - |

## 中綴じ製本 (KCBooklet)

```jsonc
// A4タテ左綴じ → A3紙に2面付け → 自動ステープル → 折り → A4冊子
{"KCBooklet":"Left", "Fold":"True", "PageSize":"A4"}

// A4ヨコ上下見開き → 上辺綴じ、上下にめくる冊子
{"KCBooklet":"Left", "Fold":"True", "PageSize":"A4", "orientation-requested":"4"}

// 横長PPTX → A4縦に2スライド配置 → 中綴じ製本
{"number-up":"2", "KCBooklet":"Left", "Fold":"True", "PageSize":"A4"}
```

## LXC依存ソフトウェア

| ソフト | バージョン | 用途 |
|:--|:--|:--|
| CUPS | 2.4 | 印刷キュー管理 |
| Kyocera UPD | v10.0 | プリンタドライバ + PPD |
| Ghostscript | 10.02 | PS/EPS/AI処理 |
| ImageMagick | 6.9.12 | HEIC/PSD/RAW/WEBP/SVG等の画像変換 |
| libheif | 1.17.6 | HEIC/HEIF/AVIFデコード |
| dcraw | 9.28 | カメラRAW(CR2/NEF/ARW等)デコード |
| pandoc | 3.1.3 | Markdown → HTML変換 |
| wkhtmltopdf | 0.12.6 | HTML → PDF変換 |
| ezdxf + matplotlib | Python | DXF(AutoCAD 2D) → PNG変換 |

## リファレンス

| ドキュメント | URL |
|:--|:--|
| PRESCRIBE Commands Reference | [PDF](https://dam.kyoceradocumentsolutions.com/content/dam/gdam_dc/dc_global/document/manual/common/PrescribeCom_KD_EN_202301.pdf) |
| TASKalfa 6054ci Operation Guide | [PDF](https://www.kyoceradocumentsolutions.us/content/dam/download-center-americas-cf/us/documents/user-guides/2554ci_3554ci_4054ci_5054ci_6054ci_7054ciENOGR2024_7_pdf.download.pdf) |
| Kyocera PPD (OpenPrinting) | [Link](https://www.openprinting.org/driver/Postscript-Kyocera/) |

## ライセンス

MIT
