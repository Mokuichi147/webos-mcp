# @mokuichi/webos-mcp

LG webOS TV を操作する MCP (Model Context Protocol) サーバーです。
SSAP (Second Screen Application Protocol) で TV と直接通信するため、TV 側への追加インストールは不要です。

- アプリ起動・音量・リモコンキー・マウスポインタ・外部入力の操作
- 放送の選局、現在の番組・番組表の取得
- スクリーンショットの取得（LLM が画面を見ながら操作できる）
- Wake-on-LAN による電源オン

## セットアップ

### 1. MCP クライアントに登録

Claude Desktop / Claude Code などの設定に追加します。

```json
{
  "mcpServers": {
    "webos": {
      "command": "npx",
      "args": ["-y", "@mokuichi/webos-mcp"]
    }
  }
}
```

### 2. TV とペアリング

MCP クライアントから次の順で呼びます。

1. `discover_devices` — LAN 上の TV を探索
2. `pair_device` — TV 画面に表示される承認ダイアログで「はい」を選ぶと `client-key` が保存される

CLI から事前にペアリングしておくこともできます。

```bash
npx -y @mokuichi/webos-mcp discover
```

```bash
npx -y @mokuichi/webos-mcp pair 192.168.1.20 --name living-room
```

以降は `launch_app` などのツールをそのまま呼べます。

## ツール

TV を操作するツールはすべて `device`（登録名または IP）を省略可能な引数として受け取ります。省略時は既定デバイスを使います。

### デバイス管理

| ツール | 説明 |
| --- | --- |
| `discover_devices` | LAN 上の webOS TV を SSDP で探索 |
| `pair_device` | TV とペアリングして `client-key` と MAC アドレスを保存 |
| `list_devices` | 登録済みデバイスの一覧 |
| `remove_device` | 登録を削除 |
| `set_default_device` | 既定デバイスを設定 |

### アプリ

| ツール | 説明 |
| --- | --- |
| `list_apps` | インストール済みアプリの ID とタイトル |
| `get_current_app` | 前面に表示中のアプリ |
| `launch_app` | アプリを起動。`params` で起動引数を渡せる（例: YouTube の `contentTarget` に動画 URL） |
| `close_app` | アプリを終了（ブラウザ等のシステムアプリは `403` で拒否される） |
| `open_url` | TV のブラウザで URL を開く |

### 音量・音声

| ツール | 説明 |
| --- | --- |
| `get_volume` | 音量とミュート状態 |
| `volume_up` / `volume_down` | 音量を 1 段階上下 |
| `set_volume` | 音量を 0〜100 で設定 |
| `mute` | ミュートの ON / OFF / トグル |
| `get_sound_output` / `set_sound_output` | 音声出力先（`tv_speaker`, `external_optical`, `external_arc`, `bt_soundbar` など）の取得・変更 |

### 入力操作

| ツール | 説明 |
| --- | --- |
| `send_key` | リモコンキーを送信（複数指定で順送り）。`HOME` `BACK` `ENTER` `UP` `DOWN` `PLAY` `0`〜`9` など |
| `send_mouse` | マジックリモコンのポインタを相対移動・クリック・スクロール |
| `insert_text` / `delete_text` | フォーカス中のテキストフィールドへ文字入力・削除 |
| `media_control` | `play` `pause` `stop` `rewind` `fastForward` |
| `list_inputs` / `switch_input` | 外部入力（HDMI など）の一覧と切替 |

### 放送（チューナー）

| ツール | 説明 |
| --- | --- |
| `watch_tv` | アプリや外部入力から放送視聴に切替 |
| `list_channels` | チャンネル一覧。種別（地デジ / BS / CS / 4K）や局名で絞り込み |
| `get_current_channel` | 視聴中のチャンネルと放送中の番組（名前・内容・時刻） |
| `get_program_guide` | 視聴中チャンネルの番組表 |
| `set_channel` | 選局。番号（`011` / `41`）・局名（`NHK総合`、部分一致）・`channelId` のいずれでも指定可 |
| `channel_up` / `channel_down` | チャンネル送り |

### 電源・システム

| ツール | 説明 |
| --- | --- |
| `power_on` | Wake-on-LAN で電源オン |
| `power_off` | 電源オフ（スタンバイ） |
| `get_power_state` | 電源状態 |
| `screenshot` | 画面のスクリーンショット（960×540 JPEG）を画像として返す |
| `get_settings` / `set_settings` | システム設定（画質・音声など）の取得・変更 |
| `show_toast` | 画面にトースト通知を表示 |
| `get_system_info` | モデル名などの情報 |

## 制限事項

| 項目 | 内容 |
| --- | --- |
| スクリーンショット | 解像度は TV 側で 960×540 に固定。DRM 保護された動画（Netflix / Prime Video など）の再生中は黒く写る |
| 電源オン | SSAP では不可能なため Wake-on-LAN を使う。TV 側で「ネットワーク経由で電源オン」等の設定が必要。`power_off` 直後は TV がシャットダウン中のため `get_power_state` は接続エラーを返す |
| 放送情報 | `get_current_channel` / `get_program_guide` は放送視聴中のみ取得できる。番組表は視聴中チャンネルの分のみ。`set_channel` 系は必要に応じて自動で放送視聴に切り替える |
| 文字入力 | システムの仮想キーボードがテキストフィールドにフォーカスしている場合のみ動作する（ブラウザなど）。YouTube のようにアプリ独自のキーボードを持つアプリには入力できない。ブラウザでキーボードが出ない場合は `send_mouse` でフィールドをクリックする |
| マウス座標 | 1920×1080 相当の相対移動（`screenshot` の座標の 2 倍）。絶対位置へ動かすには大きな負の値で左上に寄せてから移動する |
| 設定変更 | `set_settings` は `WRITE_SETTINGS` 権限が必要。署名なしマニフェストで登録された TV では `401` になる（後述） |
| 再生制御 | `media_control` はアプリ依存。YouTube で動作確認済み |

## 設定ファイル

デバイス情報は `~/.config/webos-mcp/devices.json`（`XDG_CONFIG_HOME` を尊重）に保存されます。

```json
{
  "version": 1,
  "defaultDevice": "living-room",
  "devices": {
    "living-room": {
      "name": "living-room",
      "host": "192.168.1.20",
      "id": "560ad548-....",
      "model": "OLED65B6MJA",
      "clientKey": "...",
      "mac": "D0:CD:BF:...",
      "wifiMac": "70:3E:76:..."
    }
  }
}
```

### CLI オプション / 環境変数

| オプション | 環境変数 | 説明 |
| --- | --- | --- |
| `--device <name>` | `WEBOS_DEVICE` | 既定デバイス名 |
| `--host <ip>` | `WEBOS_HOST` | 設定ファイルを使わず直接接続する TV |
| `--client-key <key>` | `WEBOS_CLIENT_KEY` | `--host` と併用する client-key |
| `--config-dir <dir>` | `WEBOS_CONFIG_DIR` | 設定ディレクトリ |
| `--debug` | `WEBOS_MCP_DEBUG=1` | デバッグログを stderr に出力 |

## ファームウェアとマニフェスト

webOS 26 以降のファームウェアは、従来のリモコンアプリ由来の署名付きマニフェストを
`403 Pairing rejected: blacklisted certificate detected` で拒否します。
本サーバーはまず署名付きで登録を試み、拒否された場合のみ署名なしマニフェストで再登録します。
署名なしでは `WRITE_SETTINGS` など一部の権限が付与されないため、`set_settings` が `401` になります。

## 開発

```bash
npm install
```

```bash
npm run build
```

```bash
node dist/cli.js discover
```

## ロードマップ

- [x] SSAP による探索・ペアリング・アプリ／音量／キー操作
- [x] 放送・スクリーンショット・Wake-on-LAN
- [ ] TV 側 Companion アプリ（Luna API ブリッジ）
- [ ] SSAP / Luna の自動切替と Luna 固有ツール（高解像度キャプチャ、設定変更など）

## License

MIT
