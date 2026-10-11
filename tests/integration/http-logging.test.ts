/**
 * HTTP トランスポート時の標準エラー出力ログ検証テスト
 *
 * 根拠 / Source:
 *   実装指示書v1 §3, §5(B1):
 *     - アプリのログはすべて標準エラー出力（stderr）へ
 *     - Logging capability宣言を外す
 *     - アクセスログに入力された法人番号・登録番号・検索語を残さない
 */

import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';

describe('HTTP transport logging to stderr', () => {
  it(
    'outputs logs to stderr and never logs input parameters',
    async () => {
      const testPort = '39999';
      const serverScript = path.resolve(process.cwd(), 'dist/server.js');
      const child = spawn(process.execPath, [serverScript], {
        env: {
          ...process.env,
          PORT: testPort,
          NTA_APPLICATION_ID: '1234567890123',
          LOG_LEVEL: 'info',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const stderrLines: string[] = [];
      const stdoutLines: string[] = [];

      const stderrRl = readline.createInterface({ input: child.stderr });
      stderrRl.on('line', (line) => {
        const trimmed = line.trim();
        if (trimmed.length > 0) {
          stderrLines.push(trimmed);
        }
      });

      const stdoutRl = readline.createInterface({ input: child.stdout });
      stdoutRl.on('line', (line) => {
        const trimmed = line.trim();
        if (trimmed.length > 0) {
          stdoutLines.push(trimmed);
        }
      });

      // 起動待ち（listening ログが stderr に出るのを待機）
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Server start timed out')), 5000);
        const check = () => {
          if (stderrLines.some((l) => l.includes('listening'))) {
            clearTimeout(timeout);
            resolve();
          } else {
            setTimeout(check, 50);
          }
        };
        check();
      });

      // /health への GET リクエスト
      await fetch(`http://localhost:${testPort}/health`);

      // /mcp への POST リクエスト（ツール呼び出し）
      const testCorporateNumber = '5111101000006';
      await fetch(`http://localhost:${testPort}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'validate_corporate_number',
            arguments: { corporate_number: testCorporateNumber },
          },
        }),
      });

      child.kill('SIGTERM');
      await new Promise((resolve) => child.on('close', resolve));

      // 検証 A: ログは標準エラー出力（stderr）に出力されていること
      expect(stderrLines.length).toBeGreaterThan(0);
      expect(stderrLines.some((l) => l.includes('listening'))).toBe(true);

      // 検証 B: 標準出力（stdout）にはログ行が出力されないこと
      expect(stdoutLines).toEqual([]);

      // 検証 C: 入力された法人番号が stderr ログに含まれていないこと
      for (const line of stderrLines) {
        expect(line).not.toContain(testCorporateNumber);
      }
    },
    10000,
  );
});
