# printer-mcp-server

**AIに「印刷して」と言うだけ。**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-Streamable_HTTP-orange)](https://modelcontextprotocol.io)
[![Tools](https://img.shields.io/badge/Tools-11-green)]()

> **エンドポイント:** `https://printer-mcp.appserver.tokyo/mcp`
> **LP:** [daisukehori.github.io/printer-mcp-server](https://daisukehori.github.io/printer-mcp-server/)

Kyocera TASKalfa 6054ci ネットワーク複合機をMCP化。PDFや画像はそのまま、Office文書はMicrosoft Graph APIで自動PDF変換して印刷。ステープル・パンチ・中綴じ製本・折りなどフィニッシャー機能をフル制御。**3,192件のPPDハードウェア制約ルール**による事前バリデーション付き。

```
ユーザー: 「この報告書をA4両面で左上ステープル、2穴パンチで10部印刷して」

AI: トレイ確認... A4普通紙あり。オプション検証中...
    ✅ 全オプション有効（2,134ルール検査済み）
    📄 report.docx → Graph API変換 → PDF (245KB)
    🖨 印刷開始: Job #42, 10部, A4両面, 左上ステープル, 2穴パンチ
    ✅ 印刷完了
```

## アーキテクチャ

```
Claude.ai / Claude Code / Cursor
  ↓ MCP (Streamable HTTP)
Cloudflare Tunnel (printer-mcp.appserver.tokyo)
  ↓
┌─────────────────────────────────────────────────────┐
│ Proxmox LXC (Ubuntu 24.04)                          │
│                                                      │
│  printer-mcp-server (Node.js 22)                     │
│   ├── PDF/画像/テキスト → 直接 CUPS                   │
│   ├── Office → Graph API → PDF → CUPS               │
│   └── validate → 3,192 PPD制約ルール検査              │
│                                                      │
│  CUPS + Kyocera UPD v10.0                            │
│   └── socket:// → TASKalfa 6054ci                    │
└─────────────────────────────────────────────────────┘
```

## ハードウェア構成

| 装置 | 型番 | 能力 |
|:--|:--|:--|
| 複合機 | TASKalfa 6054ci | 60ppm, A3, カラー |
| フィニッシャー | DF-7150 | 4,000枚排紙, **100枚ステープル** |
| 中折りユニット | BF-9100 | 中綴じ**最大20枚(80p)**, 三つ折り |
| パンチ | PH-7B | 2穴/3穴/4穴 |
| インサーター | IS-7100 | 2トレイ, 表紙・合紙挿入 |
| 給紙 | PF-7150 | カセット1-4 + 手差し |

## ツール一覧 (11 tools)

| # | ツール | 種別 | 説明 |
|:--|:--|:--|:--|
| 1 | `print_document` | W | ファイル印刷。Office自動変換＋フィニッシャー完全対応 |
| 2 | `print_url` | W | URLからダウンロード→変換→印刷 |
| 3 | `convert_to_pdf` | R | Office→PDF変換のみ（プレビュー用） |
| 4 | `validate_print_options` | R | **3,192件PPD制約で事前検証** |
| 5 | `list_printers` | R | プリンタ一覧 |
| 6 | `get_printer_status` | R | 詳細ステータス+トレイ紙設定 |
| 7 | `get_printer_capabilities` | R | PPDオプション一覧(filter付) |
| 8 | `get_print_jobs` | R | キュー一覧(完了含む) |
| 9 | `get_job_status` | R | ジョブ詳細+CUPSエラーログ |
| 10 | `cancel_print_job` | D | ジョブキャンセル |
| 11 | `get_supported_formats` | R | 対応形式一覧 |

## フィニッシャー機能

### ステープル

```jsonc
{"Stpl":"Front","Scnt":"All"}  // 左上コーナー、全ページ1セット
{"Stpl":"Rear","Scnt":"All"}   // 右上コーナー
// Center = 中綴じ用（KCBooklet使用時は自動適用）
```
**上限:** 普通紙100枚。A5以下/封筒/厚紙/ラベル/OHP不可。

### パンチ

```jsonc
{"Pnch":"2Hole"}  // 2穴
{"Pnch":"4Hole"}  // 4穴
```
**不可:** A6以下, 封筒, 厚紙, ラベル, 穴あき済み紙, OHP

### 中綴じ製本

```jsonc
// 左綴じ（横書き）→ A3紙に2面付け → 中綴じ → 折り → A4冊子
{"KCBooklet":"Left","Fold":"True","PageSize":"A4"}

// 右綴じ（縦書き・和文）
{"KCBooklet":"Right","Fold":"True","PageSize":"A4"}
```
⚠ **PageSizeは仕上がりサイズ。** A4指定→A3紙自動使用。B5→B4。
⚠ Stplと同時指定不可（自動ステープル）。
**上限:** 20枚(80p), 60-90gsm普通紙のみ。

### 折り

```jsonc
// A4三つ折り（宛名が外側に見える、封筒用）
{"FldA":"Trifold","FldB":"FPInside","FldC":"RIGHTL","OutputBin":"FLDTRAY","PageSize":"A4"}

// A3二つ折り
{"FldA":"Bifold","BiFldB":"FPInside","OutputBin":"FLDTRAY","PageSize":"A3"}
```

| モード | 対応サイズ | 最大枚数 |
|:--|:--|:--|
| 二つ折り(Bifold) | A3,A4,B4,B5,Letter等 | 3枚 |
| 三つ折り(Trifold) | **A4,Letterのみ** | 3枚 |
| Z折り | ZF-7100必要(未装着) | - |

⚠ **OutputBin=FLDTRAY必須。** 普通紙のみ（厚紙/ラベル/OHP不可）。

### 両面

```jsonc
{"Duplex":"DuplexNoTumble"}  // 長辺綴じ（縦向き→左右めくり）
{"Duplex":"DuplexTumble"}    // 短辺綴じ（横向き→上下見開き）
```

## PPD制約バリデーション

`validate_print_options` はPPDから抽出した3,192件のルールで事前検証。

```
❌ ステープル(Front) と 中綴じ製本(Left) は同時に指定できません
❌ 折りモード(Bifold) と 用紙サイズ(A5) は同時に指定できません
❌ 用紙種類(Cardstock) と パンチ(2Hole) は同時に指定できません
✅ 全て有効。印刷できます。（2,134ルール検査済み）
```

### 10の重要ルール

1. 中綴じとステープルは同時不可（中綴じは自動ステープル）
2. 折り使用時は `OutputBin=FLDTRAY` 必須
3. A5以下はステープル/折り不可
4. 封筒/ラベル/OHPは後処理全不可
5. 厚紙はステープル/パンチ/折り全不可
6. 中綴じPageSizeは仕上がりサイズ（A4→A3紙自動）
7. 三つ折りはA4/Letterのみ
8. 中綴じ最大20枚(80p)、折り最大3枚、普通紙のみ
9. 印刷前に `validate_print_options` で必ず検証
10. `get_printer_status` でトレイ紙設定を確認してから印刷

## セットアップ

### 前提
- Proxmox VE / Ubuntu LXC
- Kyocera TASKalfa（社内LAN）
- Azure AD アプリ登録（Office変換用）

### 1. LXCセットアップ

```bash
# CUPS + Kyoceraドライバ + プリンタ登録 + フィニッシャー設定
bash setup-lxc.sh
```

### 2. MCPサーバー

```bash
cd /opt && git clone <repo> && cd printer-mcp-server
npm install && npm run build
# systemdサービス作成 → 環境変数設定 → 起動
```

### 3. Cloudflare Tunnel

```bash
cloudflared service install <TOKEN>
```

### 4. Claude.aiに接続

```
URL: https://printer-mcp.your-domain/mcp?key=YOUR_API_KEY
```

## Office変換

### Graph API（現在稼働中）

Azure AD → アプリ登録 → `Files.ReadWrite.All`(アプリケーション権限) → 管理者同意

```
GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_USER_ID
```

### Mac Office（将来、100%忠実）

Mac準備後に `mac/setup-mac.sh` 実行 → 環境変数追加で自動切替:

```
MAC_HOST, MAC_USER, MAC_SSH_KEY
```

## 開発

```bash
npm install && npm run build && npm start
```

## ライセンス

MIT
