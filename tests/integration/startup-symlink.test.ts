/**
 * シンボリックリンク経由（npx 起動時など）での起動判定テスト
 *
 * 根拠 / Source: Linear SLA2-323
 * 「起動判定を実体のパス（realpath）で比較するよう直す。シンボリックリンク経由（npx）で起動すると無出力で終了する不具合。リンク経由で起動するテストを足す」
 */

import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import readline from 'node:readline';

describe('Server startup via symlink (npx simulation)', () => {
  it('starts up and listens on port when invoked through a symlink', async () => {
    const serverScript = path.resolve(process.cwd(), 'dist/server.js');
    expect(fs.existsSync(serverScript)).toBe(true);

    const symlinkPath = path.resolve(process.cwd(), 'dist/symlink-test-bin.js');
    if (fs.existsSync(symlinkPath)) {
      fs.unlinkSync(symlinkPath);
    }
    fs.symlinkSync(serverScript, symlinkPath);

    const testPort = '39998';
    const child = spawn(process.execPath, [symlinkPath], {
      env: {
        ...process.env,
        PORT: testPort,
        NTA_APPLICATION_ID: '1234567890123',
        LOG_LEVEL: 'info',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stderrLines: string[] = [];
    const stderrRl = readline.createInterface({ input: child.stderr });
    stderrRl.on('line', (line) => {
      const trimmed = line.trim();
      if (trimmed.length > 0) {
        stderrLines.push(trimmed);
      }
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Server start via symlink timed out')),
          7000,
        );
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

      expect(stderrLines.some((l) => l.includes('listening'))).toBe(true);
    } finally {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.on('close', resolve));
      if (fs.existsSync(symlinkPath)) {
        fs.unlinkSync(symlinkPath);
      }
    }
  }, 15000);
});
