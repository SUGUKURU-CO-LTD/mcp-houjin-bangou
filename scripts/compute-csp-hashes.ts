#!/usr/bin/env tsx
import { createHash } from 'node:crypto';
import { closeSync, ftruncateSync, openSync, readdirSync, readFileSync, writeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function sha256Base64(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('base64');
}

function extractInlineTagContents(html: string, tagName: 'script' | 'style'): string[] {
  const openRegex = new RegExp(`<${tagName}\\b[^>]*>`, 'gi');
  const closeRegex = new RegExp(`</${tagName}\\s*>`, 'gi');
  const openMatches = [...html.matchAll(openRegex)];
  const closeMatches = [...html.matchAll(closeRegex)];

  if (openMatches.length !== closeMatches.length) {
    throw new Error(
      `Mismatched <${tagName}> open (${openMatches.length}) and close (${closeMatches.length}) tags`,
    );
  }

  const contents: string[] = [];
  for (let i = 0; i < openMatches.length; i++) {
    const openMatch = openMatches[i];
    const closeMatch = closeMatches[i];
    if (
      !openMatch ||
      !closeMatch ||
      openMatch.index === undefined ||
      closeMatch.index === undefined
    ) {
      continue;
    }
    const contentStart = openMatch.index + openMatch[0].length;
    const contentEnd = closeMatch.index;
    if (contentEnd < contentStart) {
      throw new Error(`Invalid <${tagName}> tag nesting at index ${openMatch.index}`);
    }
    contents.push(html.slice(contentStart, contentEnd));
  }
  return contents;
}

export function injectCspIntoHtml(html: string): string {
  const withoutExisting = html.replace(
    /\s*<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>/gi,
    '',
  );

  const scripts = extractInlineTagContents(withoutExisting, 'script');
  const styles = extractInlineTagContents(withoutExisting, 'style');

  const scriptHashes = scripts.map((s) => `'sha256-${sha256Base64(s)}'`).join(' ');
  const styleHashes = styles.map((s) => `'sha256-${sha256Base64(s)}'`).join(' ');
  const csp = [
    "default-src 'none'",
    `script-src ${scriptHashes || "'none'"}`,
    `style-src ${styleHashes || "'none'"}`,
    'img-src data:',
    'font-src data:',
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "require-trusted-types-for 'script'",
    'trusted-types houjin-mcp-ui',
  ].join('; ');

  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp.replace(/"/g, '&quot;')}" />`;

  // Keep <meta charset="UTF-8"> first in <head> while placing CSP before all scripts/styles.
  const charsetRegex = /(<meta\s+charset=["'][^"']+["']\s*\/?>)/i;
  if (charsetRegex.test(withoutExisting)) {
    return withoutExisting.replace(charsetRegex, `$1\n    ${meta}`);
  }
  if (/<head>/i.test(withoutExisting)) {
    return withoutExisting.replace(/<head>/i, `<head>\n    ${meta}`);
  }
  throw new Error('HTML file is missing <head> element for CSP injection');
}

function isEnoent(err: unknown): boolean {
  return Boolean(
    err &&
    typeof err === 'object' &&
    'code' in err &&
    (err as { code?: unknown }).code === 'ENOENT',
  );
}

function injectCspIfPresent(filePath: string): boolean {
  let fd: number;
  try {
    fd = openSync(filePath, 'r+');
  } catch (err) {
    if (isEnoent(err)) {
      return false;
    }
    throw err;
  }
  try {
    const html = readFileSync(fd, 'utf8');
    const updated = injectCspIntoHtml(html);
    ftruncateSync(fd, 0);
    writeSync(fd, updated, 0, 'utf8');
    return true;
  } finally {
    closeSync(fd);
  }
}

export function injectCsp(filePath: string): void {
  if (!injectCspIfPresent(filePath)) {
    throw new Error(`Built UI file not found: ${filePath}. Run "pnpm build:ui" first.`);
  }
}

function main(): void {
  const uiRoot = path.resolve(process.cwd(), 'dist/ui');
  let entries;
  try {
    entries = readdirSync(uiRoot, { withFileTypes: true });
  } catch (err) {
    if (isEnoent(err)) {
      process.stderr.write(`Error: ${uiRoot} does not exist. Run "pnpm build:ui" first.\n`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  let count = 0;
  const sharedHtmlPath = path.join(uiRoot, 'mcp-app.html');
  if (injectCspIfPresent(sharedHtmlPath)) {
    process.stdout.write(`Injected CSP into ${sharedHtmlPath}\n`);
    count += 1;
  }

  for (const dir of entries) {
    if (!dir.isDirectory()) continue;
    const htmlPath = path.join(uiRoot, dir.name, 'mcp-app.html');
    if (injectCspIfPresent(htmlPath)) {
      process.stdout.write(`Injected CSP into ${htmlPath}\n`);
      count += 1;
    }
  }

  if (count === 0) {
    process.stderr.write(`Error: No UI entry directories found in ${uiRoot}.\n`);
    process.exitCode = 1;
  }
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  main();
}
