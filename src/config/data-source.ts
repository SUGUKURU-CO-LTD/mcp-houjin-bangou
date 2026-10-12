/**
 * Data Source Configuration
 *
 * 根拠 / Source:
 *   docs/plan/corp-check-interface-v1.md §1, §6.1 (v1.6 凍結仕様)
 *   実装指示書v1 §5(B4):
 *     - データ源の切り替え（ホスト版はDB、ローカル版はWeb-API）は、設定1か所で行う。DB方式では openWorldHint を false にする
 *     - ホスト版では国税庁のアプリケーションIDを使わない（Web-API利用規約 第9条第1項第五号）
 */

export type DataSourceMode = 'web-api' | 'db';

let currentMode: DataSourceMode = (process.env.DATA_SOURCE as DataSourceMode) || 'web-api';

export function getDataSourceMode(): DataSourceMode {
  return currentMode;
}

export function setDataSourceMode(mode: DataSourceMode): void {
  currentMode = mode;
}

export function isDbMode(): boolean {
  return currentMode === 'db';
}
