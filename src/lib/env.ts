/**
 * 環境変数の Zod validation
 * Startup-time environment variable validation with Zod
 * Validasi variabel lingkungan saat startup
 */

import { z } from 'zod';
import { DATA_SOURCE_MODES } from '../domain/tool-annotations.js';

const EnvSchema = z
  .object({
    DATA_SOURCE: z.enum(DATA_SOURCE_MODES).default('web-api'),
    DATABASE_URL: z.string().optional(),
    NTA_APPLICATION_ID: z
      .string()
      .optional()
      .describe(
        '国税庁が発行したアプリケーション ID (13桁)。ホスト版(DB)では使わない。第一編 §5.1 参照。',
      ),
    NTA_BASE_URL: z.string().url().default('https://api.houjin-bangou.nta.go.jp/4'),
    PORT: z.coerce.number().int().positive().default(3001),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    NTA_RATE_LIMIT_RPS: z.coerce.number().positive().default(1),
    NTA_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
    ALLOWED_ORIGINS: z
      .string()
      .default('')
      .describe(
        'カンマ区切りの許可Origin一覧（例: https://claude.ai,https://chatgpt.com）。Originヘッダーがある場合のみ照合し、不一致はHTTP 403を返す。',
      ),
    TRUST_PROXY: z.coerce
      .number()
      .int()
      .min(0)
      .default(1)
      .describe(
        'Expressのtrust proxyホップ数。Cloud Run前段のGoogle Front End (GFE) 1段を信頼するため既定値は1。',
      ),
    RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(60_000)
      .describe('IP単位レート制限の集計ウィンドウ（ミリ秒、既定60000ms=1分）'),
    RATE_LIMIT_MAX_REQUESTS: z.coerce
      .number()
      .int()
      .positive()
      .default(60)
      .describe('集計ウィンドウあたりの1 IP最大リクエスト数（既定60）'),
    OPENAI_APPS_CHALLENGE_TOKEN: z
      .string()
      .default('')
      .describe('ChatGPT Apps ドメイン確認用のチャレンジトークン。未設定（空文字）時は404を返す。'),
  })
  .superRefine((val, ctx) => {
    if (
      val.DATA_SOURCE === 'web-api' &&
      (!val.NTA_APPLICATION_ID || val.NTA_APPLICATION_ID.trim() === '')
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['NTA_APPLICATION_ID'],
        message: 'NTA_APPLICATION_ID is required when DATA_SOURCE is web-api',
      });
    }
    if (val.DATA_SOURCE === 'db' && (!val.DATABASE_URL || val.DATABASE_URL.trim() === '')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL is required when DATA_SOURCE is db',
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

let cachedEnv: Env | undefined;

/**
 * 環境変数を取得 (起動時に一度だけ parse、以降はキャッシュ)
 */
export function getEnv(): Env {
  if (cachedEnv === undefined) {
    const result = EnvSchema.safeParse(process.env);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
        .join('\n');
      throw new Error(`Invalid environment variables:\n${issues}`);
    }
    cachedEnv = result.data;
  }
  return cachedEnv;
}

/** テスト専用: 環境変数キャッシュをリセット */
export function resetEnvCache(): void {
  cachedEnv = undefined;
}
