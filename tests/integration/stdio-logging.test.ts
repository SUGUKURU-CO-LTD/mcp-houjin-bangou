/**
 * stdio トランスポート時のログ分離テスト
 *
 * 根拠 / Source:
 *   実装指示書v1 §5(B1):
 *     - stdioで起動し、一連のツール呼び出しの間、標準出力にJSON-RPC以外の行が1行も出ないことを確かめるテストを追加する
 *     - アプリのログはすべて標準エラー出力へ
 *     - Loggingのcapability宣言を外す
 *     - アクセスログに入力された法人番号・登録番号・検索語を残さない
 */

import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import readline from 'node:readline';

interface JsonRpcMessage {
  jsonrpc: string;
  id?: number | string;
  method?: string;
  result?: unknown;
  error?: unknown;
  params?: unknown;
}

describe('stdio transport logging separation', () => {
  it(
    'ensures no non-JSON-RPC lines are emitted to stdout during server lifecycle and tool calls',
    async () => {
      const distServer = path.resolve(process.cwd(), 'dist/server.js');
      const srcServer = path.resolve(process.cwd(), 'src/server.ts');
      const tsxCli = path.resolve(process.cwd(), 'node_modules/tsx/dist/cli.mjs');

      let execArgs: string[];
      if (fs.existsSync(distServer)) {
        execArgs = [distServer, '--stdio'];
      } else {
        execArgs = [tsxCli, srcServer, '--stdio'];
      }

      const child = spawn(process.execPath, execArgs, {
        env: {
          ...process.env,
          NTA_APPLICATION_ID: '1234567890123',
          MCP_TRANSPORT: 'stdio',
          LOG_LEVEL: 'info',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const stdoutLines: string[] = [];
      const stderrLines: string[] = [];

      const stdoutRl = readline.createInterface({ input: child.stdout });
      stdoutRl.on('line', (line) => {
        const trimmed = line.trim();
        if (trimmed.length > 0) {
          stdoutLines.push(trimmed);
        }
      });

      const stderrRl = readline.createInterface({ input: child.stderr });
      stderrRl.on('line', (line) => {
        const trimmed = line.trim();
        if (trimmed.length > 0) {
          stderrLines.push(trimmed);
        }
      });

      // メッセージ待機ヘルパー
      const pendingResponses = new Map<number, (res: JsonRpcMessage) => void>();

      stdoutRl.on('line', (line) => {
        try {
          const msg = JSON.parse(line) as JsonRpcMessage;
          if (msg.id !== undefined && typeof msg.id === 'number') {
            const resolve = pendingResponses.get(msg.id);
            if (resolve) {
              resolve(msg);
              pendingResponses.delete(msg.id);
            }
          }
        } catch {
          // パース失敗した行も stdoutLines に記録されているため後でアサートされる
        }
      });

      const sendRequest = (id: number, method: string, params: Record<string, unknown> = {}) => {
        const req = { jsonrpc: '2.0', id, method, params };
        return new Promise<JsonRpcMessage>((resolve) => {
          pendingResponses.set(id, resolve);
          child.stdin.write(JSON.stringify(req) + '\n');
        });
      };

      const sendNotification = (method: string, params: Record<string, unknown> = {}) => {
        const notif = { jsonrpc: '2.0', method, params };
        child.stdin.write(JSON.stringify(notif) + '\n');
      };

      // 1. initialize
      const initRes = await sendRequest(1, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-stdio-client', version: '1.0.0' },
      });
      expect(initRes.error).toBeUndefined();
      const serverCaps = (initRes.result as { capabilities?: Record<string, unknown> })?.capabilities;
      // Logging capability が宣言されていないことを検証
      expect(serverCaps?.logging).toBeUndefined();

      // 2. notifications/initialized
      sendNotification('notifications/initialized');

      // 3. tools/list
      const toolsRes = await sendRequest(2, 'tools/list', {});
      expect(toolsRes.error).toBeUndefined();

      // 4. tools/call: validate_corporate_number (ローカル計算ツール)
      const testCorporateNumber = '5111101000006';
      const validateRes = await sendRequest(3, 'tools/call', {
        name: 'validate_corporate_number',
        arguments: {
          corporate_number: testCorporateNumber,
        },
      });
      expect(validateRes.error).toBeUndefined();

      // 5. tools/call: normalize_company_name (ローカル計算ツール)
      const testCompanyName = '（株）スグクルテスト商事';
      const normalizeRes = await sendRequest(4, 'tools/call', {
        name: 'normalize_company_name',
        arguments: {
          name: testCompanyName,
        },
      });
      expect(normalizeRes.error).toBeUndefined();

      // サーバーループの完了を待機してプロセス終了
      child.kill('SIGTERM');
      await new Promise((resolve) => child.on('close', resolve));

      // 検証 A: 標準出力（stdout）のすべての行が JSON-RPC であること
      expect(stdoutLines.length).toBeGreaterThan(0);
      const nonJsonRpcLines: string[] = [];
      for (const line of stdoutLines) {
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          if (parsed.jsonrpc !== '2.0') {
            nonJsonRpcLines.push(line);
          }
        } catch {
          nonJsonRpcLines.push(line);
        }
      }
      // 標準出力に JSON-RPC 以外の行が1行も出ないこと
      expect(nonJsonRpcLines).toEqual([]);

      // 検証 B: 標準エラー出力（stderr）にログが出力されていること
      expect(stderrLines.length).toBeGreaterThan(0);

      // 検証 C: アクセスログに入力された法人番号や検索語が残っていないこと
      for (const errLine of stderrLines) {
        expect(errLine).not.toContain(testCorporateNumber);
        expect(errLine).not.toContain(testCompanyName);
      }
    },
    10000,
  );
});
