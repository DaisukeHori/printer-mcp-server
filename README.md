# printer-mcp-server

**AIに「印刷して」と言うだけ。**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-Streamable_HTTP-orange)](https://modelcontextprotocol.io)
[![Tools](https://img.shields.io/badge/Tools-11-green)]()
[![Formats](https://img.shields.io/badge/Formats-70-blue)]()

Kyocera TASKalfa 6054ci ネットワーク複合機をMCP化。**70種類のファイル形式**に対応。ファイルをアップロードして印刷指示を出すだけ。PDF・画像はそのまま、iPhoneのHEIC写真・Photoshop・Illustrator・カメラRAWはImageMagickで変換、Markdown・HTML・CAD(DXF)はpandoc/wkhtmltopdf/ezdxfで変換、Office文書はGraph APIでPDF変換。7種類のステープル・パンチ・中綴じ製本（タテ・ヨコ）・折り・面付けなどフィニッシャー機能をフル制御。**3,192件のPPDハードウェア制約ルール**による事前バリデーション付き。

---

## 目次

1. [ゼロトークン印刷](#ゼロトークン印刷)
2. [対応ファイル形式（70種類）](#対応ファイル形式70種類)
3. [ツール一覧（11ツール）](#ツール一覧11ツール)
4. [ステープル（全7種類）](#ステープル全7種類)
5. [中綴じ製本](#中綴じ製本)
6. [デプロイ手順（完全ガイド）](#デプロイ手順完全ガイド)
7. [リファレンス](#リファレンス)

---

## ゼロトークン印刷

```bash
# ステップ1: bash_toolでアップロード（トークン消費ゼロ）
curl -sF "file=@/mnt/user-data/uploads/photo.heic" https://your-printer-mcp.example.com/upload
# → {"file_id":"abc123","filename":"photo.heic","size":2450000}

# ステップ2: MCPツールで印刷（HEIC→JPEG自動変換→CUPS）
print_uploaded(file_id="abc123", cups_options={"Stpl":"DualLeft","Scnt":"All","Duplex":"DuplexNoTumble"})
```

## 対応ファイル形式（70種類）

| カテゴリ | 数 | 形式 | 変換方法 |
|:--|:--|:--|:--|
| **直接印刷** | 12 | PDF, PS, EPS, TXT, JPEG, PNG, TIFF, GIF, BMP | そのままCUPS |
| **画像変換** | 34 | HEIC, HEIF (iPhone), PSD, PSB (Photoshop), AI (Illustrator), XCF (GIMP), AVIF, WEBP, SVG + カメラRAW 22種 | ImageMagick → JPEG |
| **ドキュメント変換** | 5 | MD, HTML, DXF (AutoCAD 2D) | pandoc+wkhtmltopdf / ezdxf |
| **Office変換** | 19 | DOCX, XLSX, PPTX, DOC, XLS, PPT, CSV, RTF, ODT 等 | Graph API → PDF |

## ツール一覧（11ツール）

| # | ツール | 種別 | 説明 |
|:--|:--|:--|:--|
| 1 | `print_uploaded` | Write | **メイン印刷。** /upload→file_id→印刷（ゼロトークン） |
| 2 | `print_url` | Write | URLダウンロード→変換→印刷 |
| 3 | `validate_print_options` | Read | **3,192件PPD制約 + CUPSビルトイン検証** |
| 4 | `list_uploads` | Read | アップロード済みファイル一覧 |
| 5 | `get_printer_capabilities` | Read | PPDオプション一覧 (filter付) |
| 6 | `get_supported_formats` | Read | 対応形式一覧（4カテゴリ） |
| 7 | `list_printers` | Read | プリンタ一覧 |
| 8 | `get_printer_status` | Read | 状態 + トレイ紙設定 |
| 9 | `get_print_jobs` | Read | キュー一覧 |
| 10 | `get_job_status` | Read | ジョブ詳細 + CUPSログ |
| 11 | `cancel_print_job` | Destructive | ジョブキャンセル |

### HTTPエンドポイント（MCP外）

| エンドポイント | 認証 | 説明 |
|:--|:--|:--|
| `POST /upload` | 不要 | multipart/form-dataでファイルアップロード（30分自動削除） |
| `GET /uploads` | 不要 | アップロード済みファイル一覧 |
| `GET /health` | 不要 | ヘルスチェック |

## ステープル（全7種類）

[PRESCRIBE Commands Reference](https://dam.kyoceradocumentsolutions.com/content/dam/gdam_dc/dc_global/document/manual/common/PrescribeCom_KD_EN_202301.pdf) のSTTPLコマンド仕様に基づきPPDをカスタマイズ。

| cups_options | PRESCRIBE pos | 動作 | 実機 |
|:--|:--|:--|:--|
| `Stpl=Front` | 1 | 左下コーナー1箇所 | ✅ |
| `Stpl=Rear` | 2 | 左上コーナー1箇所 | - |
| `Stpl=DualLeft` | 3 | **左辺2箇所** | ✅ |
| `Stpl=Center` | 3 | =DualLeft（PPD互換名） | ✅ |
| `Stpl=TopRight` | 51 | 右上コーナー1箇所 | - |
| `Stpl=DualRight` | 53 | 右辺2箇所 | - |
| `Stpl=DualTop` | 54 | 上辺2箇所 | - |

## 中綴じ製本

```jsonc
// A4タテ左綴じ → A3紙使用 → A4冊子
{"KCBooklet":"Left", "Fold":"True", "PageSize":"A4"}

// A4ヨコ上下見開き → 上辺綴じ、上下にめくる冊子
{"KCBooklet":"Left", "Fold":"True", "PageSize":"A4", "orientation-requested":"4"}
```

---

## デプロイ手順（完全ガイド）

### 必要なもの（始める前に確認）

| 必要なもの | 説明 | なければどうする |
|:--|:--|:--|
| **Linuxサーバー** | Ubuntu 24.04推奨。Proxmox LXC、VPS、ベアメタル、何でもOK | VPSを借りるかProxmox上にLXC作成 |
| **Kyoceraプリンター** | LANケーブルで同じネットワークに接続済み | プリンターのIPアドレスをメモ（例: `192.168.70.116`） |
| **ドメイン + Cloudflareアカウント** | インターネット経由でアクセスするために必要 | [cloudflare.com](https://cloudflare.com) で無料アカウント作成 |
| **Azure ADアプリ（任意）** | Office文書（DOCX/XLSX/PPTX）をPDFに変換するのに必要 | なくてもPDF/画像/テキストの印刷はできる |

---

### Step 1: Linuxサーバーを準備する

**Proxmox LXCの場合（推奨）:**

```bash
# テンプレートからLXCコンテナを作成（VMID=312, 2コア, 4GB RAM, 20GBディスク）
pct clone 314 312 --hostname printer-mcp --storage local-lvm --full
pct set 312 --cores 2 --memory 4096 --swap 512 --onboot 1
pct start 312

# コンテナに入る
pct enter 312
```

**VPS / 普通のUbuntuサーバーの場合:**

SSHでサーバーにログインするだけでOK。以降の手順は同じです。

---

### Step 2: 基本ソフトウェアをインストール

```bash
# パッケージリストを更新
apt-get update

# CUPS（印刷システム）をインストール
apt-get install -y cups cups-client cups-filters ghostscript

# Node.js 22をインストール（MCPサーバーの実行に必要）
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

# Gitをインストール（ソースコードをダウンロードするために必要）
apt-get install -y git

# 画像変換ツールをインストール（HEIC/PSD/RAW等の変換に必要）
apt-get install -y imagemagick libheif-examples dcraw

# ドキュメント変換ツールをインストール（Markdown/HTML/DXFの変換に必要）
apt-get install -y pandoc wkhtmltopdf python3-pip
pip3 install ezdxf matplotlib --break-system-packages

# インストール確認（全部バージョンが出ればOK）
echo "=== 確認 ===" && node --version && npm --version && gs --version && convert --version | head -1 && pandoc --version | head -1
```

正常なら以下のような出力になります:
```
=== 確認 ===
v22.22.2
10.9.7
10.02.1
Version: ImageMagick 6.9.12-98 ...
pandoc 3.1.3
```

---

### Step 3: Kyoceraプリンタードライバをインストール

```bash
# Kyocera Linux UPD (Universal Print Driver) v10.0をダウンロード
# ※ Kyocera公式サイトからDLするか、社内のドライバCDからコピー
# dpkg -i kyodialog_10.0-0_amd64.deb
# apt-get install -y -f  # 依存関係を自動解決

# ドライバが入ると /usr/share/ppd/kyocera/ にPPDファイルが445個入る
ls /usr/share/ppd/kyocera/ | wc -l  # → 445
```

> ⚠️ Kyoceraドライバはプロプライエタリです。[Kyocera公式サポートページ](https://www.kyoceradocumentsolutions.com)からダウンロードしてください。「Linux UPD」で検索。

---

### Step 4: プリンターをCUPSに登録する

```bash
# プリンターを登録
#   -p: プリンター名（好きな名前。スペース不可）
#   -v: プリンターのアドレス（IPアドレスを自分のプリンターに変更する）
#   -P: PPDファイルのパス（機種に合わせて変更する）
#   -D: 説明文（何でもOK）
lpadmin -p TASKalfa-6054ci -E \
  -v 'socket://192.168.70.116:9100' \
  -P /usr/share/ppd/kyocera/Kyocera_TASKalfa_6054ci.ppd \
  -D 'Kyocera TASKalfa 6054ci'

# デフォルトプリンターに設定
lpadmin -d TASKalfa-6054ci

# フィニッシャーを有効化（自分のプリンターに合わせて変更）
lpadmin -p TASKalfa-6054ci -o Option17=DF7150   # フィニッシャー型番
lpadmin -p TASKalfa-6054ci -o Option21=True      # パンチユニット
lpadmin -p TASKalfa-6054ci -o Option22=True      # 折りユニット
lpadmin -p TASKalfa-6054ci -o Option28=True      # インサーター

# テスト印刷（1枚出てくればOK）
echo "Hello from CUPS!" | lp -d TASKalfa-6054ci
```

> 💡 `socket://192.168.70.116:9100` の部分を自分のプリンターのIPアドレスに変更すること。  
> 💡 プリンターのIPアドレスは、プリンター本体の画面から「システムメニュー > ネットワーク > TCP/IP」で確認できます。

---

### Step 5: PPDをカスタマイズする（ステープル追加）

Kyocera標準PPDにはステープルが3種類しかありません。[PRESCRIBE Commands Reference](https://dam.kyoceradocumentsolutions.com/content/dam/gdam_dc/dc_global/document/manual/common/PrescribeCom_KD_EN_202301.pdf) に基づき、追加のステープルオプションをPPDに書き足します。

```bash
# PPDをバックアップ
cp /etc/cups/ppd/TASKalfa-6054ci.ppd /etc/cups/ppd/TASKalfa-6054ci.ppd.bak

# DualLeft（左辺2箇所）、TopRight（右上）、DualRight（右辺2箇所）、DualTop（上辺2箇所）を追加
sed -i '/^\*?Stpl:/i \
*Stpl DualLeft/Left 2 Staples: "\
  userdict /UIStapleDetails known not {userdict /UIStapleDetails 10 dict put} if\
  userdict /UIStapleDetails get /StaplePosition 3 put\
  << /Staple 3 /StapleDetails UIStapleDetails >> setpagedevice"\
*End\
*Stpl TopRight/Top Right 1 Staple: "\
  userdict /UIStapleDetails known not {userdict /UIStapleDetails 10 dict put} if\
  userdict /UIStapleDetails get /StaplePosition 51 put\
  << /Staple 3 /StapleDetails UIStapleDetails >> setpagedevice"\
*End\
*Stpl DualRight/Right 2 Staples: "\
  userdict /UIStapleDetails known not {userdict /UIStapleDetails 10 dict put} if\
  userdict /UIStapleDetails get /StaplePosition 53 put\
  << /Staple 3 /StapleDetails UIStapleDetails >> setpagedevice"\
*End\
*Stpl DualTop/Top 2 Staples: "\
  userdict /UIStapleDetails known not {userdict /UIStapleDetails 10 dict put} if\
  userdict /UIStapleDetails get /StaplePosition 54 put\
  << /Staple 3 /StapleDetails UIStapleDetails >> setpagedevice"\
*End' /etc/cups/ppd/TASKalfa-6054ci.ppd

# CUPSを再起動して変更を反映
systemctl restart cups

# 確認（8つのステープルオプションが出ればOK）
lpoptions -p TASKalfa-6054ci -l | grep Stpl
# → Stpl/Staple: *None Center Front Rear DualLeft TopRight DualRight DualTop
```

---

### Step 6: MCPサーバーをデプロイする

```bash
# ソースコードをダウンロード
cd /opt
git clone https://github.com/DaisukeHori/printer-mcp-server.git
cd printer-mcp-server

# 依存パッケージをインストール（1分くらいかかる）
npm install

# TypeScriptをコンパイル
npm run build
```

---

### Step 7: systemdサービスを作成する

```bash
cat > /etc/systemd/system/printer-mcp.service << 'EOF'
[Unit]
Description=Printer MCP Server
After=network.target cups.service

[Service]
Type=simple
WorkingDirectory=/opt/printer-mcp-server
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5

# === 必須設定 ===
Environment=PORT=3000
Environment=NODE_ENV=production

# APIキー（好きな文字列に変更する。これがMCPの認証キーになる）
Environment=MCP_API_KEY=your-secret-api-key-here

# === Office変換（任意。なくてもPDF/画像は印刷できる）===
# Azure AD アプリ登録が必要。Files.ReadWrite.All権限。
# Environment=GRAPH_TENANT_ID=your-tenant-id
# Environment=GRAPH_CLIENT_ID=your-client-id
# Environment=GRAPH_CLIENT_SECRET=your-client-secret
# Environment=GRAPH_USER_ID=user@company.com

[Install]
WantedBy=multi-user.target
EOF

# サービスを有効化して起動
systemctl daemon-reload
systemctl enable printer-mcp
systemctl start printer-mcp

# 動作確認（activeと出ればOK）
systemctl status printer-mcp
```

ヘルスチェック:
```bash
curl http://localhost:3000/health
# → {"status":"ok"}
```

---

### Step 8: Cloudflare Tunnelでインターネットに公開する

Cloudflare Tunnelを使うと、ルーターのポート開放なしで安全にインターネットからアクセスできます。

```bash
# cloudflaredをインストール
curl -L --output cloudflared.deb \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
dpkg -i cloudflared.deb

# Cloudflareダッシュボードでトンネルを作成:
# 1. https://one.dash.cloudflare.com/ にログイン
# 2. Networks → Tunnels → Create a tunnel
# 3. 「Cloudflared」を選択
# 4. トンネル名を入力（例: printer-mcp）
# 5. 表示されるトークンをコピー

# トンネルをサービスとしてインストール（TOKENを自分のトークンに置き換える）
cloudflared service install <YOUR_TUNNEL_TOKEN>

# Cloudflareダッシュボードで Public Hostname を設定:
#   Subdomain: printer-mcp（好きなサブドメイン）
#   Domain: example.com（自分のドメイン）
#   Service Type: HTTP
#   URL: localhost:3000

# 動作確認（インターネット経由でアクセス）
curl https://printer-mcp.example.com/health
# → {"status":"ok"}
```

---

### Step 9: Claude.ai / Claude Desktop に接続する

**Claude.ai:**

1. [claude.ai](https://claude.ai) を開く
2. 左下の ⚙ Settings → MCP → Add
3. URL欄に入力: `https://printer-mcp.example.com/mcp?key=your-secret-api-key-here`
4. 「Save」をクリック
5. チャットで「このファイルを印刷して」と言うだけ！

**Claude Desktop / Cursor:**

`claude_desktop_config.json` に以下を追加:
```json
{
  "mcpServers": {
    "printer": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://printer-mcp.example.com/mcp?key=your-secret-api-key-here"]
    }
  }
}
```

---

### Step 10: 動作テスト

Claude.aiで以下を試してみる:

```
「添付したファイルをA4両面で左2箇所ステープルで印刷して」
```

AIが以下のワークフローを自動実行します:
1. `get_printer_status` — トレイの紙を確認
2. `bash_tool: curl -sF "file=@..." .../upload` — ファイルアップロード
3. `validate_print_options` — 3,192ルールで制約検証
4. `print_uploaded` — 印刷実行
5. `get_job_status` — 完了確認

---

## アーキテクチャ

```
Claude.ai / Claude Desktop / Claude Code
  ↓ bash_tool: curl -sF "file=@doc.pptx" .../upload → {file_id}
  ↓ MCP: print_uploaded(file_id, cups_options)
Cloudflare Tunnel (HTTPS)
  ↓
┌──────────────────────────────────────────────────────┐
│ Linux Server (Ubuntu 24.04)                           │
│  /upload → /tmp/ (30分自動削除)                        │
│  printer-mcp-server (Node.js 22, port 3000)           │
│   ├── PDF/画像/テキスト → 直接 CUPS                    │
│   ├── HEIC/PSD/AI/RAW → ImageMagick → JPEG → CUPS    │
│   ├── MD/HTML → pandoc+wkhtmltopdf → PDF → CUPS       │
│   ├── DXF → ezdxf+matplotlib → PNG → CUPS             │
│   ├── Office → Graph API → PDF → CUPS                 │
│   └── validate → 3,192 PPD制約ルール                    │
│  CUPS + Kyocera UPD v10.0 + カスタムPPD                │
│   └── socket://プリンターIP:9100 → プリンター            │
└──────────────────────────────────────────────────────┘
```

## 環境変数一覧

| 変数 | 説明 | 必須 |
|:--|:--|:--|
| `PORT` | サーバーポート（デフォルト: 3000） | いいえ |
| `MCP_API_KEY` | MCPツール認証キー | はい（推奨） |
| `GRAPH_TENANT_ID` | Azure AD テナントID | Office変換時のみ |
| `GRAPH_CLIENT_ID` | Azure AD クライアントID | Office変換時のみ |
| `GRAPH_CLIENT_SECRET` | Azure AD シークレット | Office変換時のみ |
| `GRAPH_USER_ID` | OneDriveユーザーメール | Office変換時のみ |

## リファレンス

| ドキュメント | URL |
|:--|:--|
| PRESCRIBE Commands Reference | [PDF](https://dam.kyoceradocumentsolutions.com/content/dam/gdam_dc/dc_global/document/manual/common/PrescribeCom_KD_EN_202301.pdf) |
| TASKalfa 6054ci Operation Guide | [PDF](https://www.kyoceradocumentsolutions.us/content/dam/download-center-americas-cf/us/documents/user-guides/2554ci_3554ci_4054ci_5054ci_6054ci_7054ciENOGR2024_7_pdf.download.pdf) |
| Kyocera PPD (OpenPrinting) | [Link](https://www.openprinting.org/driver/Postscript-Kyocera/) |

## ライセンス

MIT

---

## 関連 MCP サーバー

堀が公開している MCP サーバー群。すべて Claude.ai / Cursor / ChatGPT 等の MCP クライアントから利用可能。

| サーバー | ツール数 | 説明 |
|:--|:--:|:--|
| **[b2cloud-api](https://github.com/DaisukeHori/b2cloud-api)** | 14 | ヤマト B2クラウド送り状発行 API/MCP |
| **[cloudflare-mcp](https://github.com/DaisukeHori/cloudflare-mcp)** | 69 | Cloudflare 統合（Tunnel/DNS/Workers/Pages/R2/KV/SSL/Access） |
| **[hubspot-ma-mcp](https://github.com/DaisukeHori/hubspot-ma-mcp)** | 128 | HubSpot MA（CRM/Marketing/Knowledge Store） |
| **[msgraph-mcp-server](https://github.com/DaisukeHori/msgraph-mcp-server)** | 48 | Microsoft Graph API（Exchange/Teams/OneDrive/SharePoint） |
| **[playwright-devtools-mcp](https://github.com/DaisukeHori/playwright-devtools-mcp)** | 57 | Playwright + Chrome DevTools（ブラウザ自動化） |
| **[proxmox-mcp-server](https://github.com/DaisukeHori/proxmox-mcp-server)** | 35 | Proxmox VE 仮想化基盤操作 |
| **printer-mcp-server** ← 今ここ | — | CUPS ネットワークプリンタ制御（Kyocera TASKalfa） |
| **[yamato-printer-mcp-server](https://github.com/DaisukeHori/yamato-printer-mcp-server)** | — | ヤマト送り状サーマルプリンタ（ラズパイ + WS-420B） |
| **[ssh-mcp-server](https://github.com/DaisukeHori/ssh-mcp-server)** | 10 | SSH クライアント（セッション管理/非同期コマンド） |
| **[mac-remote-mcp](https://github.com/DaisukeHori/mac-remote-mcp)** | 34 | macOS リモート制御（Shell/GUI/ファイル/アプリ） |
| **[gemini-image-mcp](https://github.com/DaisukeHori/gemini-image-mcp)** | 4 | Gemini/Imagen 画像生成 |
| **[runpod-mcp](https://github.com/DaisukeHori/runpod-mcp)** | 36 | RunPod GPU FaaS（Pods/Endpoints/Jobs） |
| **[firecrawl-mcp](https://github.com/DaisukeHori/firecrawl-mcp)** | — | Firecrawl セルフホスト Web スクレイピング |
| **[ad-ops-mcp](https://github.com/DaisukeHori/ad-ops-mcp)** | 62 | 広告運用自動化（Google Ads/Meta/GBP/X） |
