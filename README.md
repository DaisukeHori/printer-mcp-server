# printer-mcp-server

ネットワーク複合機（Kyocera TASKalfa 6054ci）をMCP経由で制御するサーバー。  
Office文書（Word/Excel/PowerPoint）はMac上のMicrosoft Officeで100%忠実にPDF変換してから印刷。  
フィニッシャー（ステープル/パンチ/折り/製本）、トレイ選択、紙質設定にフル対応。

## アーキテクチャ

```
Claude.ai / Claude Code
  ↓ MCP (Streamable HTTP)
  ↓
Cloudflare Tunnel (printer-mcp.appserver.tokyo)
  ↓
┌─────────────────────────────────────────────────────┐
│ Proxmox LXC (Ubuntu)                                │
│                                                      │
│  printer-mcp-server (Node.js)                        │
│   ├── PDF/画像/テキスト → 直接 CUPS                   │
│   └── Office系 → SSH → Mac で変換 → PDF → CUPS       │
│                                                      │
│  CUPS + Kyocera UPD ドライバ                          │
│   └── IPP → Kyocera TASKalfa 6054ci                  │
└──────────────────┬──────────────────────────────────┘
                   │ SSH (scp + osascript)
┌──────────────────▼──────────────────────────────────┐
│ Mac (ヘッドレス, 社内LAN)                             │
│  ├── Microsoft Office for Mac                        │
│  ├── AppleScript (Word/Excel/PowerPoint → PDF)       │
│  └── /opt/printer-mcp/convert.sh                     │
└─────────────────────────────────────────────────────┘
```

## MCP ツール一覧 (10 tools)

| # | ツール | 種別 | 説明 |
|---|---|---|---|
| 1 | `print_document` | W | ファイル印刷（Office自動変換、cups_options完全対応） |
| 2 | `print_url` | W | URLからダウンロード→変換→印刷 |
| 3 | `convert_to_pdf` | R | PDF変換のみ（プレビュー用、base64 PDF返却） |
| 4 | `list_printers` | R | プリンタ一覧 |
| 5 | `get_printer_status` | R | プリンタ詳細ステータス（IPPサプライ情報含む） |
| 6 | `get_printer_capabilities` | R | PPDオプション一覧（filter付き絞り込み） |
| 7 | `get_print_jobs` | R | 印刷キュー一覧（完了ジョブ含む） |
| 8 | `get_job_status` | R | 個別ジョブ詳細 + CUPSエラーログ |
| 9 | `cancel_print_job` | WD | ジョブキャンセル |
| 10 | `get_supported_formats` | R | 対応ファイル形式一覧 |

### 対応ファイル形式

**直接印刷（変換不要）:** PDF, PostScript, テキスト, JPEG, PNG, TIFF, BMP, GIF

**Mac Office変換→印刷（100%忠実）:** DOCX, DOC, XLSX, XLS, PPTX, PPT, DOCM, XLSM, PPTM, RTF, ODT, CSV, その他Office形式

### cups_options の使い方

```
1. get_printer_capabilities(filter="staple")
   → KyoStaple: None / *TopLeft / TopRight / DualLeft / DualTop ...

2. print_document(
     document_base64: "...",
     filename: "report.docx",
     cups_options: {
       "KyoStaple": "TopLeft",
       "KyoPunch": "TwoHoles",
       "InputSlot": "Tray2",
       "MediaType": "Thick1"
     }
   )

3. get_job_status(job_id: "42")
```

## セットアップ

### 前提条件

- Proxmox VE クラスタ
- Kyocera TASKalfa 6054ci（社内LAN、IPP有効）
- Mac（Intel or Apple Silicon、Microsoft Office for Mac インストール済み）

### Step 1: LXC セットアップ

```bash
# Proxmoxで VMID 311 からLXCクローン
ssh root@<LXC_IP>
PRINTER_IP=<プリンタIP> bash setup-lxc.sh
```

CUPS + Kyocera UPD ドライバ + Node.js + MCPサーバーが自動セットアップされます。

### Step 2: Mac セットアップ

```bash
# Macに mac/ ディレクトリをコピーして実行
scp -r mac/ user@mac:/tmp/
ssh user@mac 'bash /tmp/mac/setup-mac.sh'
```

Office確認 + SSH有効化 + 変換スクリプト配置 + ヘッドレス設定が行われます。

### Step 3: SSH鍵接続

```bash
# LXCで実行
ssh-keygen -t ed25519 -f /root/.ssh/printer-mcp-mac -N ''
ssh-copy-id -i /root/.ssh/printer-mcp-mac.pub user@<MAC_IP>

# テスト
ssh -i /root/.ssh/printer-mcp-mac user@<MAC_IP> '/opt/printer-mcp/convert.sh'
```

### Step 4: 環境変数設定

`/etc/systemd/system/printer-mcp.service` に以下を追加:

```ini
Environment=MAC_HOST=192.168.x.x
Environment=MAC_USER=username
Environment=MAC_SSH_KEY=/root/.ssh/printer-mcp-mac
```

```bash
systemctl daemon-reload && systemctl restart printer-mcp
```

### Step 5: Cloudflare Tunnel

```
printer-mcp.appserver.tokyo → http://localhost:3000
```

### Step 6: フィニッシャー設定

```bash
# 実機のハードウェア構成に合わせて設定
lpadmin -p Kyocera-TASKalfa-6054ci -o KyoFinisher=FinisherDF7140
lpadmin -p Kyocera-TASKalfa-6054ci -o KyoPunchUnit=Installed
lpadmin -p Kyocera-TASKalfa-6054ci -o KyoBookletFolder=Installed
systemctl restart cups
```

## 環境変数

| 変数 | 説明 | デフォルト |
|---|---|---|
| `PORT` | MCPサーバーポート | `3000` |
| `MCP_API_KEY` | API認証キー | - |
| `MAC_HOST` | Mac IP アドレス | - |
| `MAC_USER` | Mac SSH ユーザー | - |
| `MAC_SSH_KEY` | Mac SSH秘密鍵パス | `/root/.ssh/printer-mcp-mac` |
| `MAC_CONVERT_DIR` | Mac側作業ディレクトリ | `/tmp/printer-mcp-convert` |
| `MAC_SCRIPT_PATH` | Mac側変換スクリプトパス | `/opt/printer-mcp/convert.sh` |

## 開発

```bash
npm install
npm run build
npm start

# 開発モード
npm run dev
```

## ライセンス

MIT
