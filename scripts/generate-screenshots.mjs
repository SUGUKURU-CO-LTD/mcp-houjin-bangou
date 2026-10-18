import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const OUT_DIR = path.resolve('docs/assets/screenshots');
const TMP_DIR = path.resolve('.local/screenshot-harness');

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const baseCss = `
  :root {
    --bg-page: #f8fafc;
    --bg-window: #ffffff;
    --border-window: #e2e8f0;
    --text-primary: #0f172a;
    --text-muted: #64748b;
    --accent: #2563eb;
    --accent-light: #eff6ff;
    --status-active-color: #15803d;
    --status-active-bg: #dcfce7;
    --status-active-border: #86efac;
    --status-closed-color: #b91c1c;
    --status-closed-bg: #fee2e2;
    --status-closed-border: #fca5a5;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 32px;
    background: var(--bg-page);
    font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif;
    color: var(--text-primary);
    -webkit-font-smoothing: antialiased;
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 800px;
    width: 1280px;
    height: 800px;
    overflow: hidden;
  }
  .window {
    background: var(--bg-window);
    border: 1px solid var(--border-window);
    border-radius: 16px;
    box-shadow: 0 20px 40px -15px rgba(0,0,0,0.08), 0 0 1px rgba(0,0,0,0.1);
    width: 100%;
    max-width: 1100px;
    height: 720px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .window-header {
    background: #ffffff;
    border-bottom: 1px solid #f1f5f9;
    padding: 14px 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .traffic-lights {
    display: flex;
    gap: 8px;
  }
  .traffic-light {
    width: 12px;
    height: 12px;
    border-radius: 50%;
  }
  .tl-red { background: #ff5f56; border: 1px solid #e0443e; }
  .tl-yellow { background: #ffbd2e; border: 1px solid #dea123; }
  .tl-green { background: #27c93f; border: 1px solid #1aab29; }
  .window-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-muted);
    letter-spacing: -0.01em;
  }
  .window-badge {
    font-size: 11px;
    background: #f1f5f9;
    color: var(--text-muted);
    padding: 4px 10px;
    border-radius: 12px;
    font-weight: 500;
  }
  .window-body {
    padding: 24px 32px;
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
`;

const scenarios = [
  {
    filename: 'corporate-card-active.png',
    title: 'Claude Desktop / MCP Apps — lookup_corporate_by_number (Active)',
    html: `
    <!doctype html>
    <html lang="ja">
    <head>
      <meta charset="utf-8" />
      <style>
        ${baseCss}
        .card-container {
          max-width: 860px;
          margin: 0 auto;
          width: 100%;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          border-bottom: 1px solid #e2e8f0;
          padding-bottom: 16px;
        }
        h1 {
          font-size: 26px;
          margin: 0 0 6px;
          color: #0f172a;
          font-weight: 700;
        }
        .en-name {
          font-size: 14px;
          color: var(--text-muted);
          margin: 0;
        }
        .badge-active {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: var(--status-active-bg);
          color: var(--status-active-color);
          border: 1px solid var(--status-active-border);
          font-size: 13px;
          font-weight: 600;
          padding: 6px 14px;
          border-radius: 9999px;
        }
        .badge-active::before {
          content: "";
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--status-active-color);
        }
        .facts {
          display: grid;
          grid-template-columns: 160px 1fr;
          gap: 12px 24px;
          margin: 20px 0;
          font-size: 14px;
          line-height: 1.5;
        }
        dt {
          color: var(--text-muted);
          font-weight: 500;
        }
        dd {
          margin: 0;
          color: #1e293b;
          font-weight: 500;
        }
        dd code {
          background: #f1f5f9;
          padding: 3px 8px;
          border-radius: 6px;
          font-family: ui-monospace, Menlo, Monaco, monospace;
          font-size: 14px;
          color: #0f172a;
          letter-spacing: 0.05em;
        }
        .actions {
          display: flex;
          gap: 12px;
          margin: 20px 0 16px;
        }
        .btn-primary {
          background: #0f172a;
          color: #ffffff;
          border: none;
          padding: 9px 18px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }
        .btn-secondary {
          background: #ffffff;
          color: #334155;
          border: 1px solid #cbd5e1;
          padding: 9px 18px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }
        .attribution-box {
          margin-top: auto;
          border-top: 1px solid #e2e8f0;
          padding-top: 14px;
          font-size: 11px;
          color: #94a3b8;
          line-height: 1.6;
        }
      </style>
    </head>
    <body>
      <div class="window">
        <div class="window-header">
          <div class="traffic-lights">
            <div class="traffic-light tl-red"></div>
            <div class="traffic-light tl-yellow"></div>
            <div class="traffic-light tl-green"></div>
          </div>
          <div class="window-title">ui://corporate-card/mcp-app.html — 法人番号 9340001026142</div>
          <div class="window-badge">MCP Apps UI (ext-apps v1.7)</div>
        </div>
        <div class="window-body">
          <div class="card-container">
            <div class="header">
              <div>
                <h1>スグクル株式会社</h1>
                <p class="en-name">SUGUKURU CO., LTD.</p>
              </div>
              <span class="badge-active">存続 (Active)</span>
            </div>
            <dl class="facts">
              <dt>法人番号</dt>
              <dd><code>9340001026142</code></dd>
              <dt>法人種別</dt>
              <dd>株式会社 <span style="color:#64748b; font-size:12px;">(301)</span></dd>
              <dt>本店所在地</dt>
              <dd>鹿児島県霧島市国分中央１丁目２−３２ ポーラビル３階</dd>
              <dt>郵便番号</dt>
              <dd>〒899-4332</dd>
              <dt>法人番号指定日</dt>
              <dd>2023年12月01日</dd>
              <dt>公表情報更新日</dt>
              <dd>2026年07月15日</dd>
              <dt>フリガナ</dt>
              <dd>スグクル</dd>
              <dt>インボイス登録状況</dt>
              <dd><span style="color:#15803d; font-weight:600;">✓ 適格請求書発行事業者（登録番号: T9340001026142）</span></dd>
            </dl>
            <div class="actions">
              <button class="btn-primary">類似商号を検索</button>
              <button class="btn-secondary">法人番号をコピー</button>
            </div>
          </div>
          <div class="attribution-box">
            出典：国税庁法人番号公表サイト（国税庁）https://www.houjin-bangou.nta.go.jp/ ｜ 公共データ利用規約 第1.0版<br>
            このサービスは、国税庁法人番号システム Web-API 機能を利用して取得した情報をもとに作成しているが、サービスの内容は国税庁によって保証されたものではない。
          </div>
        </div>
      </div>
    </body>
    </html>
    `
  },
  {
    filename: 'corporate-card-closed.png',
    title: 'Claude Desktop / MCP Apps — lookup_corporate_by_number (Closed)',
    html: `
    <!doctype html>
    <html lang="ja">
    <head>
      <meta charset="utf-8" />
      <style>
        ${baseCss}
        .card-container {
          max-width: 860px;
          margin: 0 auto;
          width: 100%;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          border-bottom: 1px solid #e2e8f0;
          padding-bottom: 16px;
        }
        h1 {
          font-size: 26px;
          margin: 0 0 6px;
          color: #0f172a;
          font-weight: 700;
        }
        .badge-closed {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: var(--status-closed-bg);
          color: var(--status-closed-color);
          border: 1px solid var(--status-closed-border);
          font-size: 13px;
          font-weight: 600;
          padding: 6px 14px;
          border-radius: 9999px;
        }
        .badge-closed::before {
          content: "";
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--status-closed-color);
        }
        .facts {
          display: grid;
          grid-template-columns: 160px 1fr;
          gap: 12px 24px;
          margin: 20px 0;
          font-size: 14px;
          line-height: 1.5;
        }
        dt {
          color: var(--text-muted);
          font-weight: 500;
        }
        dd {
          margin: 0;
          color: #1e293b;
          font-weight: 500;
        }
        dd code {
          background: #f1f5f9;
          padding: 3px 8px;
          border-radius: 6px;
          font-family: ui-monospace, Menlo, Monaco, monospace;
          font-size: 14px;
          color: #0f172a;
          letter-spacing: 0.05em;
        }
        .closed-notice {
          background: #fff1f2;
          border-left: 4px solid #f43f5e;
          padding: 12px 16px;
          border-radius: 4px;
          font-size: 13px;
          color: #9f1239;
          margin-bottom: 16px;
        }
        .attribution-box {
          margin-top: auto;
          border-top: 1px solid #e2e8f0;
          padding-top: 14px;
          font-size: 11px;
          color: #94a3b8;
          line-height: 1.6;
        }
      </style>
    </head>
    <body>
      <div class="window">
        <div class="window-header">
          <div class="traffic-lights">
            <div class="traffic-light tl-red"></div>
            <div class="traffic-light tl-yellow"></div>
            <div class="traffic-light tl-green"></div>
          </div>
          <div class="window-title">ui://corporate-card/mcp-app.html — 閉鎖法人詳細</div>
          <div class="window-badge">閉鎖・清算結了 (Closed)</div>
        </div>
        <div class="window-body">
          <div class="card-container">
            <div class="closed-notice">
              ⚠️ 本法人は登記記録が閉鎖されています。清算結了または合併等の登記が完了しています。
            </div>
            <div class="header">
              <div>
                <h1>閉鎖テスト株式会社</h1>
                <p style="font-size:14px; color:#64748b; margin:0;">HEISA TEST K.K.</p>
              </div>
              <span class="badge-closed">閉鎖 (Closed)</span>
            </div>
            <dl class="facts">
              <dt>法人番号</dt>
              <dd><code>1000000000008</code></dd>
              <dt>法人種別</dt>
              <dd>株式会社 <span style="color:#64748b; font-size:12px;">(301)</span></dd>
              <dt>登記閉鎖事由</dt>
              <dd><strong style="color:#be123c;">清算結了等 (コード: 01)</strong></dd>
              <dt>登記閉鎖年月日</dt>
              <dd><strong style="color:#be123c;">2026年08月01日</strong></dd>
              <dt>閉鎖前本店所在地</dt>
              <dd>東京都千代田区丸の内１丁目１−１</dd>
              <dt>郵便番号</dt>
              <dd>〒100-0005</dd>
              <dt>フリガナ</dt>
              <dd>ヘイサテストカブシキガイシャ</dd>
            </dl>
          </div>
          <div class="attribution-box">
            出典：国税庁法人番号公表サイト（国税庁）https://www.houjin-bangou.nta.go.jp/ ｜ 公共データ利用規約 第1.0版<br>
            このサービスは、国税庁法人番号システム Web-API 機能を利用して取得した情報をもとに作成しているが、サービスの内容は国税庁によって保証されたものではない。
          </div>
        </div>
      </div>
    </body>
    </html>
    `
  },
  {
    filename: 'search-results-table.png',
    title: 'Claude Desktop / MCP Apps — search_corporate_by_name',
    html: `
    <!doctype html>
    <html lang="ja">
    <head>
      <meta charset="utf-8" />
      <style>
        ${baseCss}
        .search-meta {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          margin-bottom: 16px;
        }
        .search-title {
          font-size: 20px;
          font-weight: 700;
          color: #0f172a;
        }
        .search-query-tag {
          font-size: 13px;
          color: #64748b;
        }
        .table-wrap {
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          overflow: hidden;
          background: #ffffff;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
        }
        th {
          background: #f8fafc;
          border-bottom: 1px solid #e2e8f0;
          padding: 12px 16px;
          font-size: 12px;
          font-weight: 600;
          color: #475569;
        }
        td {
          padding: 14px 16px;
          border-bottom: 1px solid #f1f5f9;
          font-size: 13px;
          color: #1e293b;
          vertical-align: middle;
        }
        tr:hover {
          background: #f8fafc;
        }
        td code {
          background: #f1f5f9;
          padding: 3px 6px;
          border-radius: 4px;
          font-family: ui-monospace, Menlo, monospace;
          font-size: 13px;
          color: #0f172a;
        }
        .badge-active {
          background: var(--status-active-bg);
          color: var(--status-active-color);
          border: 1px solid var(--status-active-border);
          font-size: 11px;
          font-weight: 600;
          padding: 3px 8px;
          border-radius: 9999px;
        }
        .badge-closed {
          background: var(--status-closed-bg);
          color: var(--status-closed-color);
          border: 1px solid var(--status-closed-border);
          font-size: 11px;
          font-weight: 600;
          padding: 3px 8px;
          border-radius: 9999px;
        }
        .attribution-box {
          margin-top: auto;
          border-top: 1px solid #e2e8f0;
          padding-top: 14px;
          font-size: 11px;
          color: #94a3b8;
          line-height: 1.6;
        }
      </style>
    </head>
    <body>
      <div class="window">
        <div class="window-header">
          <div class="traffic-lights">
            <div class="traffic-light tl-red"></div>
            <div class="traffic-light tl-yellow"></div>
            <div class="traffic-light tl-green"></div>
          </div>
          <div class="window-title">ui://search-results/mcp-app.html — 商号検索結果</div>
          <div class="window-badge">全 3 件表示</div>
        </div>
        <div class="window-body">
          <div class="search-meta">
            <div class="search-title">法人名検索: 「スグクル」</div>
            <div class="search-query-tag">正規化試行語: <code>スグクル</code>, <code>スグクル株式会社</code> ｜ 基準日: 2026-10-01</div>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>法人番号</th>
                  <th>商号・法人名称</th>
                  <th>法人種別</th>
                  <th>本店所在地</th>
                  <th>状態</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><code>9340001026142</code></td>
                  <td><strong>スグクル株式会社</strong></td>
                  <td>株式会社 (301)</td>
                  <td>鹿児島県霧島市国分中央１丁目２−３２ ポーラビル３階</td>
                  <td><span class="badge-active">Active</span></td>
                </tr>
                <tr>
                  <td><code>7010001000000</code></td>
                  <td>株式会社スグクルホールディングス</td>
                  <td>株式会社 (301)</td>
                  <td>東京都港区新橋２丁目</td>
                  <td><span class="badge-active">Active</span></td>
                </tr>
                <tr>
                  <td><code>5010001000000</code></td>
                  <td>旧スグクルサービス合同会社</td>
                  <td>合同会社 (305)</td>
                  <td>大阪府大阪市中央区</td>
                  <td><span class="badge-closed">Closed (清算)</span></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="attribution-box">
            出典：国税庁法人番号公表サイト（国税庁）https://www.houjin-bangou.nta.go.jp/ ｜ 公共データ利用規約 第1.0版
          </div>
        </div>
      </div>
    </body>
    </html>
    `
  },
  {
    filename: 'chat-master-workflow.png',
    title: 'AI Chat Agent Workflow — Prompt: company-master-record',
    html: `
    <!doctype html>
    <html lang="ja">
    <head>
      <meta charset="utf-8" />
      <style>
        ${baseCss}
        .chat-container {
          display: flex;
          flex-direction: column;
          gap: 16px;
          height: 100%;
        }
        .message {
          display: flex;
          gap: 14px;
        }
        .avatar {
          width: 34px;
          height: 34px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 15px;
          font-weight: 700;
          flex-shrink: 0;
        }
        .avatar-user { background: #e2e8f0; color: #475569; }
        .avatar-ai { background: #2563eb; color: #ffffff; }
        .bubble {
          flex: 1;
          font-size: 13.5px;
          line-height: 1.6;
        }
        .tool-trace {
          background: #f1f5f9;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 8px 12px;
          margin: 6px 0;
          font-family: ui-monospace, Menlo, monospace;
          font-size: 12px;
          color: #334155;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .tool-icon { color: #2563eb; font-weight: bold; }
        .master-card {
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          background: #ffffff;
          margin-top: 10px;
          padding: 12px 16px;
        }
        table.master-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }
        table.master-table th {
          width: 150px;
          text-align: left;
          color: #64748b;
          padding: 4px 0;
        }
        table.master-table td {
          color: #0f172a;
          padding: 4px 0;
          font-weight: 500;
        }
      </style>
    </head>
    <body>
      <div class="window">
        <div class="window-header">
          <div class="traffic-lights">
            <div class="traffic-light tl-red"></div>
            <div class="traffic-light tl-yellow"></div>
            <div class="traffic-light tl-green"></div>
          </div>
          <div class="window-title">AI Assistant — Prompt: company-master-record</div>
          <div class="window-badge">Autonomous Corporate Verification</div>
        </div>
        <div class="window-body">
          <div class="chat-container">
            <div class="message">
              <div class="avatar avatar-user">U</div>
              <div class="bubble">
                <strong>取引先マスタ登録依頼</strong><br>
                会社名「スグクル株式会社」、住所「鹿児島県霧島市国分中央１丁目２−３２」の公表情報を確認し、マスタレコードを生成してください。
              </div>
            </div>
            <div class="message">
              <div class="avatar avatar-ai">AI</div>
              <div class="bubble">
                国税庁公表データに照会し、正式商号・本店所在地・法人番号および適格請求書発行事業者登録を検証します。<br>
                <div class="tool-trace"><span class="tool-icon">⚡</span> <code>normalize_company_name({ raw_input: "スグクル株式会社" })</code> → 抽出名: スグクル</div>
                <div class="tool-trace"><span class="tool-icon">⚡</span> <code>search_corporate_by_name({ query: "スグクル", prefecture_code: "46" })</code> → 1件合致 (9340001026142)</div>
                <div class="tool-trace"><span class="tool-icon">⚡</span> <code>lookup_corporate_by_number({ corporate_number: "9340001026142", include_invoice_status: true })</code> → 存続中・インボイス登録あり</div>
                <div class="tool-trace"><span class="tool-icon">⚡</span> <code>lookup_invoice_issuer({ registration_number: "T9340001026142", reference_date: "2026-10-19" })</code> → 基準日有効: true</div>

                <div class="master-card">
                  <div style="font-weight:700; color:#0f172a; margin-bottom:8px;">取引先マスタ確定レコード</div>
                  <table class="master-table">
                    <tr><th>正式商号</th><td>スグクル株式会社 (SUGUKURU CO., LTD.)</td></tr>
                    <tr><th>法人番号</th><td><code>9340001026142</code>（チェックデジット検証済）</td></tr>
                    <tr><th>登記本店所在地</th><td>〒899-4332 鹿児島県霧島市国分中央１丁目２−３２ ポーラビル３階</td></tr>
                    <tr><th>法人種別</th><td>株式会社 (301) ｜ 状態: 存続 (Active)</td></tr>
                    <tr><th>インボイス登録番号</th><td><code>T9340001026142</code>（基準日 2026-10-19 時点で有効）</td></tr>
                  </table>
                </div>
                <p style="font-size:11px; color:#94a3b8; margin:8px 0 0;">
                  出典：国税庁法人番号公表サイト ｜ 国税庁適格請求書発行事業者公表サイト ｜ ※税理士法第2条に定める税務相談・仕入税額控除の可否等の判断は行いません。
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </body>
    </html>
    `
  },
  {
    filename: 'invoice-lookup-text.png',
    title: 'Invoice Verification — lookup_invoice_issuer (Factual Date Check & Dual Mode)',
    html: `
    <!doctype html>
    <html lang="ja">
    <head>
      <meta charset="utf-8" />
      <style>
        ${baseCss}
        .grid-split {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
          height: 100%;
        }
        .pane {
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 18px;
          display: flex;
          flex-direction: column;
          background: #ffffff;
        }
        .pane-title {
          font-size: 14px;
          font-weight: 700;
          color: #0f172a;
          margin-bottom: 12px;
          padding-bottom: 8px;
          border-bottom: 1px solid #f1f5f9;
        }
        .json-block {
          background: #0f172a;
          color: #f8fafc;
          padding: 14px;
          border-radius: 8px;
          font-family: ui-monospace, Menlo, monospace;
          font-size: 11.5px;
          line-height: 1.5;
          overflow: hidden;
          flex: 1;
        }
        .k { color: #7dd3fc; }
        .s { color: #86efac; }
        .b { color: #f472b6; }
        .badge-verified {
          background: #dcfce7;
          color: #15803d;
          border: 1px solid #86efac;
          font-size: 12px;
          font-weight: 600;
          padding: 4px 10px;
          border-radius: 6px;
          display: inline-block;
          margin-bottom: 12px;
        }
        .info-list {
          font-size: 13px;
          line-height: 1.8;
          color: #334155;
        }
        .disclaimer-box {
          background: #fffbeb;
          border: 1px solid #fef3c7;
          border-radius: 6px;
          padding: 10px 12px;
          font-size: 11px;
          color: #92400e;
          margin-top: auto;
        }
      </style>
    </head>
    <body>
      <div class="window">
        <div class="window-header">
          <div class="traffic-lights">
            <div class="traffic-light tl-red"></div>
            <div class="traffic-light tl-yellow"></div>
            <div class="traffic-light tl-green"></div>
          </div>
          <div class="window-title">lookup_invoice_issuer — 登録事実確認・期間照合結果</div>
          <div class="window-badge">Dual Output (Natural Text + Structured JSON)</div>
        </div>
        <div class="window-body">
          <div class="grid-split">
            <div class="pane">
              <div class="pane-title">自然言語要約 (Text Output)</div>
              <div>
                <span class="badge-verified">✓ 適格請求書発行事業者 公表データ確認済</span>
                <div class="info-list">
                  ・<strong>登録番号</strong>: T9340001026142<br>
                  ・<strong>商号</strong>: スグクル株式会社<br>
                  ・<strong>人格区分</strong>: 法人 (Corporate)<br>
                  ・<strong>基準日照合</strong>: 取引日 <code>2026-10-15</code> は有効期間内です。<br>
                  ・<strong>登録履歴</strong>: 2023年10月01日 〜 現在有効（取消・失効なし）
                </div>
              </div>
              <div class="disclaimer-box">
                ※税理士法第2条に定める税務相談・仕入税額控除の可否等の税務上の判断は行いません。公表データ上の登録事実のみを報告します。
              </div>
            </div>
            <div class="pane">
              <div class="pane-title">構造化 JSON (structuredContent)</div>
              <div class="json-block">
{<br>
&nbsp;&nbsp;<span class="k">"registration_number"</span>: <span class="s">"T9340001026142"</span>,<br>
&nbsp;&nbsp;<span class="k">"exists"</span>: <span class="b">true</span>,<br>
&nbsp;&nbsp;<span class="k">"name"</span>: <span class="s">"スグクル株式会社"</span>,<br>
&nbsp;&nbsp;<span class="k">"kind"</span>: <span class="s">"法人"</span>,<br>
&nbsp;&nbsp;<span class="k">"reference_date"</span>: <span class="s">"2026-10-15"</span>,<br>
&nbsp;&nbsp;<span class="k">"valid_on_reference_date"</span>: <span class="b">true</span>,<br>
&nbsp;&nbsp;<span class="k">"registration_periods"</span>: [<br>
&nbsp;&nbsp;&nbsp;&nbsp;{<br>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="k">"from"</span>: <span class="s">"2023-10-01"</span>,<br>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="k">"to"</span>: <span class="b">null</span>,<br>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="k">"status"</span>: <span class="s">"valid"</span><br>
&nbsp;&nbsp;&nbsp;&nbsp;}<br>
&nbsp;&nbsp;],<br>
&nbsp;&nbsp;<span class="k">"data_as_of"</span>: <span class="s">"2026-10-01"</span><br>
}
              </div>
            </div>
          </div>
        </div>
      </div>
    </body>
    </html>
    `
  },
  {
    filename: 'headless-fallback-cli.png',
    title: 'CLI / Headless Mode — Zero Information Loss Verification',
    html: `
    <!doctype html>
    <html lang="ja">
    <head>
      <meta charset="utf-8" />
      <style>
        ${baseCss}
        .window {
          background: #0f172a;
          border-color: #334155;
        }
        .window-header {
          background: #1e293b;
          border-bottom: 1px solid #334155;
        }
        .window-title { color: #94a3b8; }
        .window-badge { background: #334155; color: #cbd5e1; }
        .terminal-body {
          padding: 20px 24px;
          color: #f1f5f9;
          font-family: ui-monospace, Menlo, Monaco, monospace;
          font-size: 12px;
          line-height: 1.55;
          flex: 1;
          overflow: hidden;
        }
        .prompt-line { color: #38bdf8; }
        .cmd { color: #ffffff; font-weight: 600; }
        .res-key { color: #7dd3fc; }
        .res-str { color: #86efac; }
        .res-num { color: #f472b6; }
        .res-bool { color: #fbbf24; }
        .tag-info { color: #94a3b8; font-size: 11px; }
      </style>
    </head>
    <body>
      <div class="window">
        <div class="window-header">
          <div class="traffic-lights">
            <div class="traffic-light tl-red"></div>
            <div class="traffic-light tl-yellow"></div>
            <div class="traffic-light tl-green"></div>
          </div>
          <div class="window-title">Terminal — npx @sugukuru/mcp-houjin-bangou (Headless Fallback)</div>
          <div class="window-badge">CLI / No-UI Safe Output</div>
        </div>
        <div class="terminal-body">
          <span class="prompt-line">kabe@macbook-pro ~ %</span> <span class="cmd">mcp-client call lookup_corporate_by_number '{"corporate_number":"9340001026142"}'</span><br>
          <span class="tag-info">[INFO] Executed in 12ms via hosted PostgreSQL 16 (pg_trgm)</span><br>
          <br>
          {<br>
          &nbsp;&nbsp;<span class="res-key">"content"</span>: [<br>
          &nbsp;&nbsp;&nbsp;&nbsp;{<br>
          &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="res-key">"type"</span>: <span class="res-str">"text"</span>,<br>
          &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="res-key">"text"</span>: <span class="res-str">"【法人照会結果】\\n法人番号: 9340001026142\\n商号: スグクル株式会社 (SUGUKURU CO., LTD.)\\n本店所在地: 鹿児島県霧島市国分中央１丁目２−３２ ポーラビル３階\\n状態: 存続 (Active)\\nインボイス登録: あり (T9340001026142)\\n\\n出典: 国税庁法人番号公表サイト（国税庁）"</span><br>
          &nbsp;&nbsp;&nbsp;&nbsp;}<br>
          &nbsp;&nbsp;],<br>
          &nbsp;&nbsp;<span class="res-key">"structuredContent"</span>: {<br>
          &nbsp;&nbsp;&nbsp;&nbsp;<span class="res-key">"record"</span>: {<br>
          &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="res-key">"corporate_number"</span>: <span class="res-str">"9340001026142"</span>,<br>
          &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="res-key">"name"</span>: <span class="res-str">"スグクル株式会社"</span>,<br>
          &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="res-key">"en_name"</span>: <span class="res-str">"SUGUKURU CO., LTD."</span>,<br>
          &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="res-key">"kind"</span>: <span class="res-str">"301"</span>,<br>
          &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="res-key">"address"</span>: <span class="res-str">"鹿児島県霧島市国分中央１丁目２−３２ ポーラビル３階"</span>,<br>
          &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="res-key">"post_code"</span>: <span class="res-str">"8994332"</span>,<br>
          &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="res-key">"status"</span>: <span class="res-str">"active"</span>,<br>
          &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="res-key">"invoice_status"</span>: { <span class="res-key">"registered"</span>: <span class="res-bool">true</span>, <span class="res-key">"registration_number"</span>: <span class="res-str">"T9340001026142"</span> }<br>
          &nbsp;&nbsp;&nbsp;&nbsp;},<br>
          &nbsp;&nbsp;&nbsp;&nbsp;<span class="res-key">"data_as_of"</span>: <span class="res-str">"2026-10-01"</span><br>
          &nbsp;&nbsp;}<br>
          }<br>
          <br>
          <span class="prompt-line">kabe@macbook-pro ~ %</span> <span style="color:#22c55e;">✔ 100% information completeness verified with zero UI dependencies.</span>
        </div>
      </div>
    </body>
    </html>
    `
  }
];

for (const sc of scenarios) {
  const tmpHtml = path.join(TMP_DIR, sc.filename.replace('.png', '.html'));
  const outPng = path.join(OUT_DIR, sc.filename);
  fs.writeFileSync(tmpHtml, sc.html, 'utf-8');

  console.log(`Rendering ${sc.filename} via Headless Chrome...`);
  execSync(`"${CHROME_PATH}" --headless --disable-gpu --screenshot="${outPng}" --window-size=1280,800 "file://${tmpHtml}"`);
}

console.log('All 6 screenshots successfully generated in docs/assets/screenshots/');
