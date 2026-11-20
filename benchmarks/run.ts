import { Bench } from 'tinybench';
import {
  computeCheckDigit,
  isValidCheckDigit,
  normalizeAndValidateCorporateNumber,
} from '../src/domain/check-digit.js';
import { normalizeAndValidateInvoiceNumber } from '../src/domain/invoice-number.js';
import { normalizeCompanyName } from '../src/domain/normalizer.js';
import { parseNtaCsv } from '../src/api/csv-parser.js';

const sampleCsv = [
  '2019-04-05,1,1,1',
  '1,5111101000006,01,1,2019-04-03,2015-10-05,"株式会社検索対象除外",,301,"東京都","千代田区","（東京市神田区小川町一丁目１０番地）",,13,101,1000000,,,,,,,2015-10-05,1,,,,,,1',
].join('\n');

const bench = new Bench({ time: 1000, warmupTime: 250 });

bench
  .add('computeCheckDigit(12 digits)', () => {
    computeCheckDigit('111101000006');
  })
  .add('isValidCheckDigit(13 digits)', () => {
    isValidCheckDigit('5111101000006');
  })
  .add('normalizeAndValidateCorporateNumber(full-width)', () => {
    normalizeAndValidateCorporateNumber('５１１１１０１０００００６');
  })
  .add('normalizeAndValidateInvoiceNumber(T-number)', () => {
    normalizeAndValidateInvoiceNumber('Ｔ８０４０００１９９９０１３');
  })
  .add('normalizeCompanyName((株) + old kanji)', () => {
    normalizeCompanyName('（株）髙橋商事');
  })
  .add('parseNtaCsv(one row)', () => {
    parseNtaCsv(sampleCsv);
  });

await bench.run();

const rows = bench.tasks.map((task) => {
  const result = task.result;
  const throughput = result?.throughput;
  const latency = result?.latency;
  return {
    task: task.name,
    'ops/sec': throughput === undefined ? 'n/a' : Math.round(throughput.mean).toLocaleString(),
    'mean (us)': latency === undefined ? 'n/a' : (latency.mean * 1000).toFixed(3),
    'p99 (us)': latency === undefined ? 'n/a' : (latency.p99 * 1000).toFixed(3),
  };
});

console.table(rows);
