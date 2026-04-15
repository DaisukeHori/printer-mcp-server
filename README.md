# printer-mcp-server

**AIに「印刷して」と言うだけ。**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-Streamable_HTTP-orange)](https://modelcontextprotocol.io)
[![Tools](https://img.shields.io/badge/Tools-11-green)]()

> **エンドポイント:** `https://printer-mcp.appserver.tokyo/mcp`
> **LP:** [daisukehori.github.io/printer-mcp-server](https://daisukehori.github.io/printer-mcp-server/)

Kyocera TASKalfa 6054ci ネットワーク複合機をMCP化。ファイルをアップロードして印刷指示を出すだけ。PDF・画像はそのまま、Office文書（DOCX/XLSX/PPTX）はサーバー側でMicrosoft Graph API経由でPDF自動変換して印刷。ステープル・パンチ・中綴じ製本・折り・面付けなどフィニッシャー機能をフル制御。**3,192件のPPDハードウェア制約ルール**による事前バリデーション付き。

## ゼロトークン印刷

従来のMCPツールではファイルをbase64エンコードしてツール引数に入れる必要があり、10ページのPDFだけで数十万トークンを消費していました。

このMCPサーバーでは **`/upload` エンドポイント + `print_uploaded` ツール** の2段構成で、ファイル転送にトークンを一切使いません。

```bash
# ステップ1: bash_toolでファイルアップロード（トークン消費ゼロ）
curl -sF "file=@/mnt/user-data/uploads/report.pptx" https://printer-mcp.appserver.tokyo/upload
# → {"file_id":"abc123","filename":"report.pptx","size":2450000}

# ステップ2: MCPツールで印刷指示（トークン消費: cups_optionsの数十トークンのみ）
print_uploaded(file_id="abc123", cups_options={"Duplex":"DuplexNoTumble","PageSize":"A4"})
```

AIはファイル形式を意識する必要はありません。PDF送ろうがPPTX送ろうがDOCX送ろうが同じ操作です。LXC内で拡張子を見て自動判定・変換・印刷します。

## アーキテクチャ

```
Claude.ai / Claude Desktop / Claude Code / Cursor
  ↓ bash_tool: curl -sF "file=@doc.pptx" .../upload
  ↓ → {"file_id":"abc123"}
  ↓ MCP: print_uploaded(file_id, cups_options)
  ↓
Cloudflare Tunnel (printer-mcp.appserver.tokyo)
  ↓
┌─────────────────────────────────────────────────────┐
│ Proxmox LXC (VMID 312, Ubuntu 24.04)                │
│                                                      │
│  /upload → /tmp/printer-mcp-uploads/ (30分自動削除)   │
│                                                      │
│  printer-mcp-server (Node.js 22, port 3000)          │
│   ├── PDF/画像/テキスト → 直接 CUPS                   │
│   ├── Office → Graph API → PDF → CUPS               │
│   └── validate → 3,192 PPD制約ルール検査              │
│                                                      │
│  CUPS + Kyocera UPD v10.0                            │
│   └── socket://192.168.70.116:9100                   │
│       → Kyocera TASKalfa 6054ci                      │
└─────────────────────────────────────────────────────┘
```

### Office変換の優先順位

| 優先度 | 方式 | 再現性 | 条件 |
|:--|:--|:--|:--|
| 1 | Mac Office (SSH + AppleScript) | 100% | `MAC_HOST` 設定時 |
| 2 | Graph API (OneDrive経由) | 98-99% | `GRAPH_*` 設定時 ← 現在 |
| 3 | 直接印刷のみ | - | 両方未設定 |

## ハードウェア構成

| 装置 | 型番 | 主な能力 |
|:--|:--|:--|
| 複合機 | TASKalfa 6054ci | 60ppm, A3, カラー, 52-300gsm |
| フィニッシャー | DF-7150 | 4,000枚排紙, **100枚ステープル** (3種), 2トレイ |
| 中折りユニット | BF-9100 | 中綴じ**最大20枚(80p)**, 二つ折り, 三つ折り. 60-90gsm |
| パンチ | PH-7B | 2穴/3穴/4穴 |
| インサーター | IS-7100 | 2トレイ, 表紙・裏表紙・合紙挿入 |
| 給紙 | PF-7150 | カセット1-4 (各600枚) + 手差し |

## ツール一覧 (11 tools)

### 印刷

| ツール | 種別 | 説明 |
|:--|:--|:--|
| `print_uploaded` | Write | **メイン印刷ツール。** /upload済みファイルをfile_idで印刷。base64不要（ゼロトークン） |
| `print_url` | Write | URLダウンロード→変換→印刷 |

### バリデーション・情報

| ツール | 種別 | 説明 |
|:--|:--|:--|
| `validate_print_options` | Read | **3,192件PPD制約ルールで事前検証。** CUPSビルトインオプション(number-up等)にも対応 |
| `get_printer_capabilities` | Read | PPDオプション一覧。filter引数で絞込 (`staple`, `fold`, `booklet`, `tray`等) |
| `get_supported_formats` | Read | 対応ファイル形式一覧 |
| `list_uploads` | Read | /upload済みファイル一覧 |

### プリンタ管理

| ツール | 種別 | 説明 |
|:--|:--|:--|
| `list_printers` | Read | 登録プリンタ一覧 |
| `get_printer_status` | Read | プリンタ状態 + トレイ紙サイズ・紙種類 |
| `get_print_jobs` | Read | キュー一覧（`completed: true`で完了ジョブも取得） |
| `get_job_status` | Read | 個別ジョブ詳細 + CUPSエラーログ |
| `cancel_print_job` | Destructive | ジョブキャンセル |

### HTTPエンドポイント（MCP外）

| エンドポイント | 認証 | 説明 |
|:--|:--|:--|
| `POST /upload` | 不要 | multipart/form-dataでファイルアップロード。30分で自動削除 |
| `GET /uploads` | 不要 | アップロード済みファイル一覧 |
| `GET /health` | 不要 | ヘルスチェック |

## AIの推奨ワークフロー

```
1. get_printer_status("TASKalfa-6054ci")
   → プリンタ状態確認 + トレイの紙設定確認

2. bash_tool: curl -sF "file=@/mnt/user-data/uploads/FILENAME" https://printer-mcp.appserver.tokyo/upload
   → {"file_id":"abc123"}

3. cups_options を組み立て（print_uploadedのdescription内リファレンスから）

4. validate_print_options(cups_options)
   → 3,192ルール検証 → ✅ or ❌ + 日本語エラー

5. print_uploaded(file_id="abc123", cups_options)
   → Office自動変換 → CUPS印刷

6. get_job_status(job_id)
   → 完了確認
```

## フィニッシャー機能

### ステープル

```jsonc
{"Stpl":"Front","Scnt":"All"}  // 左上コーナー
{"Stpl":"Rear","Scnt":"All"}   // 右上コーナー
```
**上限:** 普通紙100枚。A5以下/封筒/厚紙不可。Scnt必須。

### パンチ

```jsonc
{"Pnch":"2Hole"}  // 2穴
{"Pnch":"4Hole"}  // 4穴
```
**不可:** A6以下, 封筒, 厚紙, ラベル, 穴あき済み紙, OHP

### 中綴じ製本 (KCBooklet)

```jsonc
// 左綴じ（横書き）→ A3紙に2面付け → 自動ステープル → 中折り → A4冊子
{"KCBooklet":"Left", "Fold":"True", "PageSize":"A4"}

// 右綴じ（縦書き・和文）→ B4紙使用 → B5冊子
{"KCBooklet":"Right", "Fold":"True", "PageSize":"B5"}
```

| 項目 | 詳細 |
|:--|:--|
| PageSize | **仕上がりサイズ**を指定。A4→A3紙、B5→B4紙を自動使用 |
| Left / Right | Left=左綴じ(横書き)、Right=右綴じ(縦書き・和文) |
| 上限 | **20枚(80ページ)**、60-90gsm普通紙のみ |
| 制約 | Stplと同時指定不可（自動センターステープル） |

### 折り

```jsonc
// A4三つ折り（宛名が外側に見える＝封筒にそのまま入れて読める）
{"FldA":"Trifold", "FldB":"FPInside", "FldC":"RIGHTL", "OutputBin":"FLDTRAY", "PageSize":"A4"}

// A3二つ折り
{"FldA":"Bifold", "BiFldB":"FPInside", "OutputBin":"FLDTRAY", "PageSize":"A3"}
```

| モード | 対応サイズ | 最大枚数 |
|:--|:--|:--|
| 二つ折り (Bifold) | A3,A4,B4,B5,Letter等 | 3枚 |
| 三つ折り (Trifold) | **A4, Letterのみ** | 3枚 |

⚠ **OutputBin=FLDTRAY 必須。** 普通紙(60-90gsm)のみ。

### 面付け (number-up)

```jsonc
// A4に4ページ配置
{"number-up":"4", "number-up-layout":"lrtb", "PageSize":"A4"}

// 横長PPTX → A4縦に2スライド配置 → 中綴じ製本
{"number-up":"2", "KCBooklet":"Left", "Fold":"True", "PageSize":"A4"}
```

| 値 | 意味 |
|:--|:--|
| `number-up=2,4,6,9,16` | 1枚にNページ配置 |
| `number-up-layout=lrtb` | 左→右、上→下（標準） |
| `number-up-layout=rltb` | 右→左（縦書き向け） |

number-upはCUPSレベルの処理、KCBookletはドライバレベルの処理なので**併用可能**。面付け後に製本されます。

### 両面

| 値 | 意味 |
|:--|:--|
| `DuplexNoTumble` | 長辺綴じ（縦向き→左右めくり、通常の両面） |
| `DuplexTumble` | 短辺綴じ（横向き→上下見開き、カレンダー式） |

## PPD制約バリデーション (3,192ルール)

```
入力: {"KCBooklet":"Left", "Stpl":"Front"}
→ ❌ ステープル(Front) と 中綴じ製本(Left) は同時に指定できません

入力: {"FldA":"Bifold", "PageSize":"A5"}
→ ❌ 折りモード(Bifold) と 用紙サイズ(A5) は同時に指定できません

入力: {"number-up":"2", "KCBooklet":"Left", "Fold":"True", "PageSize":"A4"}
→ ✅ 全て有効。（number-up: CUPS built-in, KCBooklet/Fold/PageSize: PPD validated）
```

### 10の重要ルール

1. **中綴じとステープルは同時不可。** 中綴じは自動ステープル
2. **折り使用時は `OutputBin=FLDTRAY` 必須**
3. **A5以下はステープル/折り不可。** A6以下はパンチも不可
4. **封筒/ラベル/OHPは後処理全不可**
5. **厚紙(Cardstock/Thick)はステープル/パンチ/折り全不可**
6. **中綴じPageSizeは仕上がりサイズ。** A4→A3紙、B5→B4紙を自動使用
7. **三つ折りはA4/Letterのみ。** A3三つ折りにはZF-7100(未装着)が必要
8. **中綴じ最大20枚(80p)、折り最大3枚。** 普通紙(60-90gsm)のみ
9. **印刷前に `validate_print_options` で必ず検証**
10. **`get_printer_status` でトレイ紙設定を確認してから印刷**

## 対応ファイル形式

| カテゴリ | 形式 | 処理 |
|:--|:--|:--|
| 直接印刷 | PDF, PS, TXT, JPEG, PNG, TIFF, BMP, GIF | そのままCUPS |
| Office変換 | DOCX, DOC, XLSX, XLS, PPTX, PPT, DOCM, XLSM, PPTM, RTF, ODT, CSV | Graph API → PDF → CUPS |

AIはファイル形式を意識不要。どのファイルでも同じ `/upload` → `print_uploaded` フローで印刷されます。

## セットアップ（5ステップ）

Vercelワンクリックではありません。**Proxmox LXC + CUPS + Kyoceraドライバ + Cloudflare Tunnel** の構成です。

### 前提条件

| 必要なもの | 説明 |
|:--|:--|
| Proxmox VE | LXCホスト。ベアメタルでも可 |
| Kyocera TASKalfa | 社内LANに接続済み。socket://IP:9100 で到達可能 |
| Cloudflare アカウント | Tunnel用。ドメインをCloudflareで管理 |
| Azure AD (Entra ID) | Office変換用。Files.ReadWrite.All権限 |

### ステップ1: LXCコンテナ作成

```bash
pct clone 314 312 --hostname printer-mcp --storage local-lvm --full
pct set 312 --cores 2 --memory 4096 --onboot 1
pct start 312
```

### ステップ2: CUPS + Kyoceraドライバ

```bash
apt-get update && apt-get install -y cups cups-client cups-filters ghostscript curl

# Kyocera UPD v10.0ドライバ
dpkg -i kyodialog_10.0-0_amd64.deb && apt-get install -y -f

# プリンタ登録
lpadmin -p TASKalfa-6054ci -E \
  -v 'socket://YOUR_PRINTER_IP:9100' \
  -P /usr/share/ppd/kyocera/Kyocera_TASKalfa_6054ci.ppd \
  -D 'Kyocera TASKalfa 6054ci'
lpadmin -d TASKalfa-6054ci

# フィニッシャー設定
lpadmin -p TASKalfa-6054ci -o Option17=DF7150   # フィニッシャー
lpadmin -p TASKalfa-6054ci -o Option21=True      # パンチ
lpadmin -p TASKalfa-6054ci -o Option22=True      # 折り
lpadmin -p TASKalfa-6054ci -o Option28=True      # インサーター
```

### ステップ3: MCPサーバーデプロイ

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

cd /opt && git clone https://github.com/DaisukeHori/printer-mcp-server.git
cd printer-mcp-server && npm install && npm run build
```

systemdサービス (`/etc/systemd/system/printer-mcp.service`):
```ini
[Unit]
Description=Printer MCP Server
After=network.target cups.service

[Service]
Type=simple
WorkingDirectory=/opt/printer-mcp-server
ExecStart=/usr/bin/node dist/index.js
Restart=always
Environment=PORT=3000
Environment=MCP_API_KEY=your-api-key-here
Environment=GRAPH_TENANT_ID=your-tenant-id
Environment=GRAPH_CLIENT_ID=your-client-id
Environment=GRAPH_CLIENT_SECRET=your-secret
Environment=GRAPH_USER_ID=user@company.com

[Install]
WantedBy=multi-user.target
```

### ステップ4: Cloudflare Tunnel

```bash
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
dpkg -i cloudflared.deb
cloudflared service install <YOUR_TUNNEL_TOKEN>
```

### ステップ5: クライアント接続

**Claude.ai:**
```
Settings → MCP → Add → URL: https://printer-mcp.your-domain.com/mcp?key=your-api-key
```

**Claude Desktop / Cursor:**
```json
{
  "mcpServers": {
    "printer": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://printer-mcp.your-domain.com/mcp?key=your-api-key"]
    }
  }
}
```

## 環境変数

| 変数 | 説明 | 必須 |
|:--|:--|:--|
| `PORT` | サーバーポート | デフォルト: 3000 |
| `MCP_API_KEY` | MCPツール認証キー | 推奨 |
| `GRAPH_TENANT_ID` | Azure AD テナントID | Office変換時 |
| `GRAPH_CLIENT_ID` | Azure AD クライアントID | Office変換時 |
| `GRAPH_CLIENT_SECRET` | Azure AD シークレット | Office変換時 |
| `GRAPH_USER_ID` | OneDrive用ユーザーメール | Office変換時 |
| `MAC_HOST` | Mac IPアドレス | Mac変換時(将来) |
| `MAC_USER` | Mac SSHユーザー | Mac変換時(将来) |
| `MAC_SSH_KEY` | Mac SSH秘密鍵パス | Mac変換時(将来) |

## セキュリティ

| 項目 | 詳細 |
|:--|:--|
| 通信 | HTTPS (Cloudflare Tunnel + TLS) |
| MCP認証 | APIキー (`?key=` or `Authorization: Bearer`) |
| /upload | 認証不要（一時ファイル、30分で自動削除） |
| Graph API | OAuth2 Client Credentials、一時ファイルは変換後即削除 |
| LXC | Proxmox上の隔離コンテナ |

## ライセンス

MIT
