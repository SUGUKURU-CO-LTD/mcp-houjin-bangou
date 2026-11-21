/**
 * 国税庁 法人番号 Web-API Ver.4.0 クライアント
 * National Tax Agency Corporate Number Web-API Ver.4.0 client
 *
 * 根拠 / Source:
 *   国税庁仕様書 第二編 (概要) + 第六編 (Ver.4.0)
 *   エンドポイント: https://api.houjin-bangou.nta.go.jp/4/{num|diff|name}
 *   応答形式: type=02 (CSV UTF-8)
 *
 * DI seam: fetchImpl でテスト時差替え可能
 */

import { NtaApiError } from '../lib/errors.js';
import { Result } from '../lib/result.js';
import { TokenBucket } from './rate-limiter.js';
import { parseNtaCsv, type ParsedNtaResponse } from './csv-parser.js';

export interface NtaClientConfig {
  applicationId: string;
  baseUrl: string;
  timeoutMs: number;
  rps: number;
  userAgent?: string;
  fetchImpl?: typeof fetch;
  /** バックオフ発動時のフック (Logging 連携用) */
  onBackoff?: (waitMs: number) => void;
}

/**
 * 法人番号指定検索 (/4/num) のパラメータ
 * 根拠: 第六編 §2.1, 第二編 §2.1.3
 */
export interface LookupByNumberParams {
  /** 13桁の法人番号、最大10件 */
  numbers: string[];
  /** 変更履歴要否 (0=最新のみ / 1=含める)、デフォルト 0 */
  history?: '0' | '1';
}

/**
 * 法人名指定検索 (/4/name) のパラメータ
 * 根拠: 第六編 §4.1, 第二編 §4.1.3
 */
export interface SearchByNameParams {
  /** 商号又は名称 (UTF-8、最大150文字 日本語 / 300文字 英語) */
  name: string;
  /** 検索方式 (1=前方一致 / 2=部分一致)、デフォルト 1 */
  mode?: '1' | '2';
  /** 検索対象 (1=JIS1-2水準あいまい / 2=JIS1-4水準完全 / 3=英語)、デフォルト 1 */
  target?: '1' | '2' | '3';
  /** 所在地 (都道府県コード2桁 or 都道府県+市区町村5桁) */
  address?: string;
  /** 法人種別 (01/02/03/04、最大4件カンマ区切り) */
  kind?: string;
  /** 変更履歴を含めるか (0/1)、デフォルト 0 */
  change?: '0' | '1';
  /** 登記記録の閉鎖等を含めるか (0/1)、デフォルト 1 */
  close?: '0' | '1';
  /** 法人番号指定年月日 開始 (YYYY-MM-DD) */
  from?: string;
  /** 法人番号指定年月日 終了 (YYYY-MM-DD) */
  to?: string;
  /** 分割番号 (1-99999)、デフォルト 1 */
  divide?: number;
}

export interface NtaClient {
  lookupByNumber(params: LookupByNumberParams): Promise<Result<ParsedNtaResponse, NtaApiError>>;
  searchByName(params: SearchByNameParams): Promise<Result<ParsedNtaResponse, NtaApiError>>;
  /** 3年無利用停止を防止するための health ping */
  ping(): Promise<Result<true, NtaApiError>>;
}

/**
 * NtaClient のファクトリ関数 (DI seam)
 */
export function createNtaClient(config: NtaClientConfig): NtaClient {
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  const limiter = new TokenBucket({ rps: config.rps });
  const userAgent = config.userAgent ?? '@sugukuru/mcp-houjin-bangou';

  async function callApi(
    path: string,
    params: URLSearchParams,
  ): Promise<Result<ParsedNtaResponse, NtaApiError>> {
    try {
      await limiter.acquire();
    } catch (err) {
      return Result.err(NtaApiError.fromUnknown(err, [config.applicationId]));
    }

    params.set('id', config.applicationId);
    params.set('type', '02'); // ADR-0003: CSV UTF-8 固定

    const url = `${config.baseUrl}${path}?${params.toString()}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const res = await fetchImpl(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'User-Agent': userAgent,
          Accept: 'text/csv',
        },
      });

      if (res.status === 403) {
        const waitMs = limiter.triggerBackoff();
        if (config.onBackoff) config.onBackoff(waitMs);
        return Result.err(
          NtaApiError.fromHttpStatus(
            403,
            `Rate limited by NTA. Backoff ${waitMs}ms applied. (別添1 第9条第1項三号)`,
          ),
        );
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return Result.err(NtaApiError.fromHttpStatus(res.status, body));
      }

      limiter.resetBackoff();
      const csvText = await res.text();
      try {
        const parsed = parseNtaCsv(csvText);
        return Result.ok(parsed);
      } catch (err) {
        return Result.err(
          new NtaApiError(
            `Failed to parse NTA CSV: ${err instanceof Error ? err.message : String(err)}`,
            'parse_error',
          ),
        );
      }
    } catch (err) {
      return Result.err(NtaApiError.fromUnknown(err, [config.applicationId]));
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return {
    async lookupByNumber(params) {
      if (params.numbers.length === 0 || params.numbers.length > 10) {
        return Result.err(
          new NtaApiError(
            'numbers must contain 1-10 corporate numbers (第二編 §2.1.3)',
            'http_400',
          ),
        );
      }
      const search = new URLSearchParams({
        number: params.numbers.join(','),
        history: params.history ?? '0',
      });
      return callApi('/num', search);
    },
    async searchByName(params) {
      if (params.name.length === 0) {
        return Result.err(
          new NtaApiError('name parameter is required (第二編 §4.1.3)', 'http_400'),
        );
      }
      const search = new URLSearchParams();
      search.set('name', params.name);
      if (params.mode !== undefined) search.set('mode', params.mode);
      if (params.target !== undefined) search.set('target', params.target);
      if (params.address !== undefined) search.set('address', params.address);
      if (params.kind !== undefined) search.set('kind', params.kind);
      if (params.change !== undefined) search.set('change', params.change);
      if (params.close !== undefined) search.set('close', params.close);
      if (params.from !== undefined) search.set('from', params.from);
      if (params.to !== undefined) search.set('to', params.to);
      if (params.divide !== undefined) search.set('divide', String(params.divide));
      return callApi('/name', search);
    },
    async ping() {
      // ダミー番号 0000000000000 → 404 相当の応答が返る (または 200 空結果)
      // 目的は ID の active 状態維持 (第一編 §5.3、3年無利用停止防止)
      const result = await this.lookupByNumber({ numbers: ['0000000000000'] });
      if (Result.isOk(result)) return Result.ok(true);
      const err = result.error;
      // 404 は「該当なし」で OK、403 は rate limit、その他は真のエラー
      if (err.code === 'http_404') return Result.ok(true);
      return Result.err(err);
    },
  };
}
