# printer-mcp-server

**AIに「印刷して」と言うだけ。**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-Streamable_HTTP-orange)](https://modelcontextprotocol.io)
[![Tools](https://img.shields.io/badge/Tools-11-green)]()

> **エンドポイント:** `https://printer-mcp.appserver.tokyo/mcp`
> **LP:** [daisukehori.github.io/printer-mcp-server](https://daisukehori.github.io/printer-mcp-server/)

Kyocera TASKalfa 6054ci ネットワーク複合機をMCP化。PDFや画像はそのまま、Office文書（DOCX/XLSX/PPTX）はMicrosoft Graph APIで自動PDF変換して印刷。ステープル・パンチ・中綴じ製本・折りなどフィニッシャー機能をフル制御。**3,192件のPPDハードウェア制約ルール**による事前バリデーション付き。

```
ユーザー: 「この報告書をA4両面で左上ステープル、2穴パンチで10部印刷して」

AI: get_printer_status → idle, カセット1: A4普通紙
    validate_print_options → ✅ 2,134ルール検査済み
    report.docx → Graph API変換 → PDF (245KB)
    🖨 Job #42 送信: 10部, A4両面, 左上ステープル, 2穴パンチ
    get_job_status → ✅ 印刷完了
```

## なぜ必要か

オフィスの複合機は多機能だけど、設定が複雑。中綴じ製本するには紙サイズは仕上がりサイズで指定、三つ折りは A4 しかできない、厚紙にパンチは不可...。**3,192件もの制約ルール**が存在し、間違えるとエラーか意図しない出力になります。

このMCPサーバーは：
- 制約ルールを**全てバリデーションエンジンに内蔵**。印刷前に自動検証
- **フィニッシャーの全オプション・物理スペック・制約をdescriptionに焼き込み**。AIが正しい設定を自力で組み立て可能
- **Office文書を自動PDF変換**。Word/Excel/PowerPointをそのまま送るだけ
- AIの推奨ワークフロー（トレイ確認→検証→印刷→完了確認）もdescriptionに記載済み

## アーキテクチャ

```
Claude.ai / Claude Desktop / Claude Code / Cursor
  ↓ MCP (Streamable HTTP + API Key認証)
Cloudflare Tunnel (printer-mcp.appserver.tokyo)
  ↓
┌─────────────────────────────────────────────────────┐
│ Proxmox LXC (VMID 312, Ubuntu 24.04)                │
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
         ↕ Microsoft Graph API (OAuth2 Client Credentials)
     OneDrive (一時Upload → ?format=pdf → Download → Delete)
```

### Office変換の優先順位

| 優先度 | 方式 | 再現性 | 条件 |
|:--|:--|:--|:--|
| 1 | Mac Office (SSH + AppleScript) | 100% | `MAC_HOST` 設定時 |
| 2 | Graph API (OneDrive経由) | 98-99% | `GRAPH_*` 設定時 ← 現在 |
| 3 | 直接印刷のみ | - | 両方未設定 |

Mac設定時、Graph APIは自動的にフォールバックに回ります。

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

### 印刷・変換

| ツール | 種別 | 説明 |
|:--|:--|:--|
| `print_document` | Write | base64ファイル印刷。Office自動変換。cups_optionsでフィニッシャー完全制御 |
| `print_url` | Write | URLダウンロード→変換→印刷 |
| `convert_to_pdf` | Read | Office→PDF変換のみ（プレビュー用、base64返却） |

### バリデーション・情報

| ツール | 種別 | 説明 |
|:--|:--|:--|
| `validate_print_options` | Read | **3,192件PPD制約ルールで事前検証。** 紙サイズ×紙種類×フィニッシャーの全組合せ互換性チェック |
| `get_printer_capabilities` | Read | PPDオプション一覧。filter引数で絞込 (`staple`, `fold`, `booklet`, `tray`等) |
| `get_supported_formats` | Read | 対応ファイル形式一覧 |

### プリンタ管理

| ツール | 種別 | 説明 |
|:--|:--|:--|
| `list_printers` | Read | 登録プリンタ一覧 |
| `get_printer_status` | Read | プリンタ状態 + トレイ紙サイズ・紙種類 |
| `get_print_jobs` | Read | キュー一覧（`completed: true`で完了ジョブも取得） |
| `get_job_status` | Read | 個別ジョブ詳細 + CUPSエラーログ |
| `cancel_print_job` | Destructive | ジョブキャンセル |

## フィニッシャー機能

### ステープル

```jsonc
// 左上コーナーステープル（最も一般的）
{"Stpl":"Front", "Scnt":"All", "PageSize":"A4", "Duplex":"DuplexNoTumble"}
// 右上コーナーステープル
{"Stpl":"Rear", "Scnt":"All"}
```

**上限:** 普通紙(64gsm) **100枚**。A5以下/封筒/厚紙/ラベル/OHP不可。
**Scnt必須:** `All`(全ページ1セット) or `Each5`(5枚ごと) 等。

### パンチ

```jsonc
{"Pnch":"2Hole"}  // 2穴パンチ
{"Pnch":"4Hole"}  // 4穴パンチ
```

**不可:** A6以下, 封筒, 厚紙, ラベル, 穴あき済み紙, OHP

### 中綴じ製本 (KCBooklet)

```jsonc
// 左綴じ（横書き）→ A3紙に2面付け → 中綴じステープル → 中折り → A4冊子
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
| 対応サイズ | A4, A5, B5, Letter, P16K, Statement |

### 折り

```jsonc
// A4三つ折り（宛名が外側に見える＝封筒に入れてそのまま読める）
{"FldA":"Trifold", "FldB":"FPInside", "FldC":"RIGHTL", "OutputBin":"FLDTRAY", "PageSize":"A4"}

// A3二つ折り
{"FldA":"Bifold", "BiFldB":"FPInside", "OutputBin":"FLDTRAY", "PageSize":"A3"}
```

| モード | 対応サイズ | 最大枚数 | 備考 |
|:--|:--|:--|:--|
| 二つ折り (Bifold) | A3,A4,B4,B5,Letter等 | 3枚 | A5以下不可 |
| 三つ折り (Trifold) | **A4, Letterのみ** | 3枚 | BF-9100制約 |
| Z折り (Zfold) | - | - | ZF-7100未装着 |

| オプション | 意味 |
|:--|:--|
| `FldB=FPInside` | 1ページ目が内側（三つ折りで宛名が外に見える） |
| `FldB=FPOutside` | 1ページ目が外側（開けないと見えない） |
| `FldC=RIGHTL` | 右から左に折る |
| `FldC=LEFTR` | 左から右に折る |

⚠ **OutputBin=FLDTRAY 必須。** 普通紙(60-90gsm)のみ。

### 両面印刷

| 値 | 意味 | 用途 |
|:--|:--|:--|
| `DuplexNoTumble` | 長辺綴じ | 縦向き資料を左右にめくる（通常の両面） |
| `DuplexTumble` | 短辺綴じ | 横向き資料を上下にめくる（カレンダー式） |

## PPD制約バリデーション (3,192ルール)

`validate_print_options` は Kyocera PPDファイルから抽出した**3,192件の UIConstraints + cupsUIConstraints** ルールを使って、印刷前にオプション互換性を自動検証します。

```
入力: {"KCBooklet":"Left", "Stpl":"Front"}
→ ❌ ステープル(Front) と 中綴じ製本(Left) は同時に指定できません

入力: {"FldA":"Bifold", "PageSize":"A5"}
→ ❌ 折りモード(Bifold) と 用紙サイズ(A5) は同時に指定できません

入力: {"MediaType":"Cardstock", "Pnch":"2Hole"}
→ ❌ 用紙種類(Cardstock) と パンチ(2Hole) は同時に指定できません

入力: {"Stpl":"Front","Scnt":"All","Pnch":"2Hole","Duplex":"DuplexNoTumble","PageSize":"A4"}
→ ✅ 全て有効。印刷できます。（2,134ルール検査済み、違反0）
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

## セットアップ（5ステップ）

このMCPサーバーは「Vercelにデプロイして終わり」ではありません。**Proxmox LXC + CUPS + Kyoceraドライバ + Cloudflare Tunnel** の構成で、社内LANのプリンタをインターネット経由でMCP公開します。

### 前提条件

| 必要なもの | 説明 |
|:--|:--|
| Proxmox VE | LXCホスト。ベアメタルでも可 |
| Kyocera TASKalfa | 社内LANに接続済み。socket://IP:9100 で到達可能 |
| Cloudflare アカウント | Tunnel用。ドメインをCloudflareで管理 |
| Azure AD (Entra ID) | Office変換用。Files.ReadWrite.All権限 |

### ステップ1: LXCコンテナ作成

Proxmox上でUbuntu 24.04 LXCを作成:

```bash
# テンプレートからクローン（推奨）
pct clone 313 312 --hostname printer-mcp --storage local-lvm --full
pct set 312 --cores 2 --memory 4096 --onboot 1
pct start 312
```

### ステップ2: CUPS + Kyoceraドライバ

LXCにSSHして実行:

```bash
apt-get update && apt-get install -y cups cups-client cups-filters ghostscript curl

# Kyocera Universal Print Driver v10.0
# Kyocera公式サイトからdebパッケージをダウンロード
dpkg -i kyodialog_10.0-0_amd64.deb && apt-get install -y -f

# プリンタ登録
lpadmin -p TASKalfa-6054ci -E \
  -v 'socket://YOUR_PRINTER_IP:9100' \
  -P /usr/share/ppd/kyocera/Kyocera_TASKalfa_6054ci.ppd \
  -D 'Kyocera TASKalfa 6054ci'
lpadmin -d TASKalfa-6054ci

# フィニッシャー設定（装着済みオプションに合わせて変更）
lpadmin -p TASKalfa-6054ci -o Option17=DF7150     # フィニッシャー
lpadmin -p TASKalfa-6054ci -o Option21=True        # パンチ
lpadmin -p TASKalfa-6054ci -o Option22=True        # 折り
lpadmin -p TASKalfa-6054ci -o Option23=True        # インナーシフトトレイ
lpadmin -p TASKalfa-6054ci -o Option28=True        # インサーター

# テスト印刷
echo "Hello MCP" | lp -d TASKalfa-6054ci
```

### ステップ3: MCPサーバーデプロイ

```bash
# Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

# リポジトリクローン
cd /opt
git clone https://github.com/DaisukeHori/printer-mcp-server.git
cd printer-mcp-server
npm install && npm run build
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
# Office変換用（Graph API）
Environment=GRAPH_TENANT_ID=your-tenant-id
Environment=GRAPH_CLIENT_ID=your-client-id
Environment=GRAPH_CLIENT_SECRET=your-secret
Environment=GRAPH_USER_ID=user@company.com

[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable --now printer-mcp
```

### ステップ4: Cloudflare Tunnel

LXCから直接Cloudflare Tunnelを張る:

```bash
# cloudflaredインストール
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
dpkg -i cloudflared.deb

# Tunnel作成（CloudflareダッシュボードでTokenを取得）
cloudflared service install <YOUR_TUNNEL_TOKEN>
```

Cloudflare Dashboardで Ingress 設定:
```
hostname: printer-mcp.your-domain.com
service:  http://localhost:3000
```

DNS CNAME レコードが自動作成されます。

### ステップ5: クライアント接続

**Claude.ai (Web):**
Settings → MCP → Add:
```
URL: https://printer-mcp.your-domain.com/mcp?key=your-api-key
```

**Claude Desktop / Cursor / Windsurf:**
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

**Claude Code:**
```bash
claude mcp add --transport http printer \
  https://printer-mcp.your-domain.com/mcp?key=your-api-key
```

## Office変換の設定 (Graph API)

### Azure ADアプリ登録

1. [Azure Portal](https://portal.azure.com) → Microsoft Entra ID → アプリの登録 → 新規登録
2. 名前: `printer-mcp-server` (任意)
3. API のアクセス許可 → アクセス許可の追加:
   - Microsoft Graph → **アプリケーションの許可** → `Files.ReadWrite.All`
4. **管理者の同意を与える** (テナント管理者が必要)
5. 証明書とシークレット → 新しいクライアントシークレット（推奨: 24ヶ月）

### 環境変数

```bash
GRAPH_TENANT_ID=<ディレクトリ(テナント)ID>
GRAPH_CLIENT_ID=<アプリケーション(クライアント)ID>
GRAPH_CLIENT_SECRET=<クライアントシークレットの値>
GRAPH_USER_ID=<OneDrive一時保存用ユーザーのメールアドレス>
```

> `GRAPH_USER_ID` のユーザーのOneDriveに一時ファイルがアップロードされ、PDF変換後に自動削除されます。専用のサービスアカウントを推奨します。

### Mac Office変換（将来）

Macが決まったら `mac/setup-mac.sh` を実行し、環境変数を追加するだけ:

```bash
MAC_HOST=192.168.x.x    # MacのIP
MAC_USER=username        # SSHユーザー
MAC_SSH_KEY=/root/.ssh/printer-mcp-mac  # SSH秘密鍵
```

Mac設定時、Graph APIは自動的にフォールバックに回ります。

## 対応ファイル形式

| カテゴリ | 形式 | 処理 |
|:--|:--|:--|
| 直接印刷 | PDF, PS, TXT, JPEG, PNG, TIFF, BMP, GIF | そのままCUPS |
| Office変換 | DOCX, DOC, XLSX, XLS, PPTX, PPT, DOCM, XLSM, PPTM, RTF, ODT, CSV | Graph API → PDF → CUPS |

## 環境変数一覧

| 変数 | 説明 | 必須 |
|:--|:--|:--|
| `PORT` | サーバーポート | デフォルト: 3000 |
| `MCP_API_KEY` | API認証キー | 推奨 |
| `GRAPH_TENANT_ID` | Azure AD テナントID | Office変換時 |
| `GRAPH_CLIENT_ID` | Azure AD クライアントID | Office変換時 |
| `GRAPH_CLIENT_SECRET` | Azure AD シークレット | Office変換時 |
| `GRAPH_USER_ID` | OneDrive用ユーザーメール | Office変換時 |
| `MAC_HOST` | Mac IPアドレス | Mac変換時 |
| `MAC_USER` | Mac SSHユーザー名 | Mac変換時 |
| `MAC_SSH_KEY` | Mac SSH秘密鍵パス | Mac変換時 |

## セキュリティ

| 項目 | 詳細 |
|:--|:--|
| 通信 | HTTPS (Cloudflare Tunnel + TLS) |
| 認証 | APIキー (`Authorization: Bearer` or `?key=`) |
| Graph API | OAuth2 Client Credentials。トークン自動取得・キャッシュ(5分バッファ) |
| OneDrive | 一時ファイルは変換完了後に即削除 |
| LXC | Proxmox上の隔離コンテナで動作 |
| ソースコード | 全公開 |

## ライセンス

MIT
