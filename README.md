# printer-mcp-server

**AIに「印刷して」と言うだけ。**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-Streamable_HTTP-orange)](https://modelcontextprotocol.io)
[![Tools](https://img.shields.io/badge/Tools-11-green)]()

> **エンドポイント:** `https://printer-mcp.appserver.tokyo/mcp`
> **LP:** [daisukehori.github.io/printer-mcp-server](https://daisukehori.github.io/printer-mcp-server/)

Kyocera TASKalfa 6054ci ネットワーク複合機をMCP化。ファイルをアップロードして印刷指示を出すだけ。PDF・画像はそのまま、Office文書はサーバー側でGraph API経由PDF自動変換。ステープル・パンチ・中綴じ製本・折り・面付けなどフィニッシャー機能をフル制御。**3,192件のPPDハードウェア制約ルール**による事前バリデーション付き。

## ゼロトークン印刷

ファイル転送にトークンを一切使いません。

```bash
# ステップ1: bash_toolでアップロード（トークン消費ゼロ）
curl -sF "file=@/mnt/user-data/uploads/report.pptx" https://printer-mcp.appserver.tokyo/upload
# → {"file_id":"abc123","filename":"report.pptx","size":2450000}

# ステップ2: MCPツールで印刷
print_uploaded(file_id="abc123", cups_options={"Stpl":"DualLeft","Scnt":"All","Duplex":"DuplexNoTumble"})
```

AIはファイル形式を意識不要。何でも同じ操作で印刷されます。

## アーキテクチャ

```
Claude.ai / Claude Desktop / Claude Code / Cursor
  ↓ bash_tool: curl -sF "file=@doc.pptx" .../upload → {file_id}
  ↓ MCP: print_uploaded(file_id, cups_options)
Cloudflare Tunnel (printer-mcp.appserver.tokyo)
  ↓
┌────────────────────────────────────────────────────┐
│ Proxmox LXC (VMID 312, Ubuntu 24.04)               │
│  /upload → /tmp/ (30分自動削除)                      │
│  printer-mcp-server (Node.js 22)                    │
│   ├── PDF/画像/テキスト → 直接 CUPS                  │
│   ├── Office → Graph API → PDF → CUPS              │
│   └── validate → 3,192 PPD + PRESCRIBE制約          │
│  CUPS + Kyocera UPD v10.0 + カスタムPPD              │
│   └── socket:// → TASKalfa 6054ci                   │
└────────────────────────────────────────────────────┘
```

## ハードウェア構成

| 装置 | 型番 | 主な能力 |
|:--|:--|:--|
| 複合機 | TASKalfa 6054ci | 60ppm, A3, カラー, 52-300gsm |
| フィニッシャー | DF-7150 | 4,000枚排紙, **100枚ステープル**, 2トレイ |
| 中折りユニット | BF-9100 | 中綴じ**最大20枚(80p)**, 二つ折り, 三つ折り. 60-90gsm |
| パンチ | PH-7B | 2穴/3穴/4穴 |
| インサーター | IS-7100 | 2トレイ, 表紙・裏表紙・合紙挿入 |
| 給紙 | PF-7150 | カセット1-4 (各600枚) + 手差し |

## ツール一覧 (11 tools)

| # | ツール | 種別 | 説明 |
|:--|:--|:--|:--|
| 1 | `print_uploaded` | Write | **メイン印刷。** /upload済みファイルをfile_idで印刷（ゼロトークン） |
| 2 | `print_url` | Write | URLダウンロード→変換→印刷 |
| 3 | `validate_print_options` | Read | **3,192件PPD制約 + CUPSビルトイン対応** |
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

## ステープル（全7種類、実機検証済み）

[Kyocera PRESCRIBE Commands Command Reference](https://dam.kyoceradocumentsolutions.com/content/dam/gdam_dc/dc_global/document/manual/common/PrescribeCom_KD_EN_202301.pdf) の STPL コマンド仕様に基づくStaplePosition値をPPDに追加。

| cups_options | PRESCRIBE pos | 動作 | 実機 |
|:--|:--|:--|:--|
| `Stpl=Front` | 1 | 左下コーナー1箇所 | ✅ |
| `Stpl=Rear` | 2 | 左上コーナー1箇所 | - |
| `Stpl=DualLeft` | 3 | **左辺2箇所** | ✅ |
| `Stpl=Center` | 3 | =DualLeft（PPD互換名） | ✅ |
| `Stpl=TopRight` | 51 | 右上コーナー1箇所 | - |
| `Stpl=DualRight` | 53 | 右辺2箇所 | - |
| `Stpl=DualTop` | 54 | 上辺2箇所 | - |

> position 50-54 は PRESCRIBE仕様で "certain copier models only"。TASKalfa 6054ciはコピー機能付きMFPのため対応している可能性が高い。

⚠ `Scnt=All` 必須。最大100枚（普通紙）。A5以下/封筒/厚紙不可。

## 中綴じ製本 (KCBooklet)

```jsonc
// A4タテ左綴じ（横書き）→ A3紙に2面付け → 自動ステープル → 折り → A4冊子
{"KCBooklet":"Left", "Fold":"True", "PageSize":"A4"}

// A4ヨコ上下見開き（横向き中綴じ）→ 上辺綴じ、上下にめくる冊子
{"KCBooklet":"Left", "Fold":"True", "PageSize":"A4", "orientation-requested":"4"}

// 右綴じ（縦書き・和文）→ B4紙使用 → B5冊子
{"KCBooklet":"Right", "Fold":"True", "PageSize":"B5"}

// 横長PPTX → A4縦に2スライド配置 → 中綴じ製本
{"number-up":"2", "KCBooklet":"Left", "Fold":"True", "PageSize":"A4"}
```

- PageSize = **仕上がりサイズ**（A4→A3紙、B5→B4紙を自動使用）
- Left=左綴じ(横書き)、Right=右綴じ(縦書き)
- **最大20枚(80p)**、60-90gsm普通紙のみ
- orientation-requested=4 で横向き中綴じ（上下見開き） ✅実機確認済み

## 折り

| モード | 対応サイズ | 最大枚数 |
|:--|:--|:--|
| 二つ折り (Bifold) | A3,A4,B4,B5,Letter等 | 3枚 |
| 三つ折り (Trifold) | **A4, Letterのみ** | 3枚 |

⚠ `OutputBin=FLDTRAY` 必須。普通紙(60-90gsm)のみ。

## 面付け (number-up)

```jsonc
{"number-up":"4", "number-up-layout":"lrtb", "PageSize":"A4"}  // 4ページ/枚
```

- KCBookletと**併用可能**（CUPSレベル面付け→ドライバレベル製本）
- layout: `lrtb`(標準), `rltb`(縦書き向け) 等

## PPD制約バリデーション

`validate_print_options` で3,192件のルール + CUPSビルトインオプションを自動検証。

## セットアップ（5ステップ）

Proxmox LXC + CUPS + Kyoceraドライバ + Cloudflare Tunnel の構成。

1. **LXCコンテナ作成** — Ubuntu 24.04テンプレートからクローン
2. **CUPS + Kyoceraドライバ** — UPD v10.0 + lpadmin + フィニッシャー設定
3. **MCPサーバー** — git clone → npm install → npm run build → systemd
4. **Cloudflare Tunnel** — cloudflared → hostname → http://localhost:3000
5. **Claude.aiに接続** — Settings → MCP → Add

詳細手順はリポジトリ内の `setup-lxc.sh` を参照。

## リファレンス

| ドキュメント | URL |
|:--|:--|
| PRESCRIBE Commands Reference | [PDF](https://dam.kyoceradocumentsolutions.com/content/dam/gdam_dc/dc_global/document/manual/common/PrescribeCom_KD_EN_202301.pdf) |
| TASKalfa 6054ci Operation Guide | [PDF](https://www.kyoceradocumentsolutions.us/content/dam/download-center-americas-cf/us/documents/user-guides/2554ci_3554ci_4054ci_5054ci_6054ci_7054ciENOGR2024_7_pdf.download.pdf) |
| Kyocera PPD (OpenPrinting) | [Link](https://www.openprinting.org/driver/Postscript-Kyocera/) |

## ライセンス

MIT
