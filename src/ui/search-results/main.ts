import { App, applyDocumentTheme } from '@modelcontextprotocol/ext-apps';
import { VERSION } from '../../version';
import {
  buildLookupByNumberArgs,
  buildSearchResultsViewModel,
  type SearchCorporateOutput,
} from '../shared';
import './styles.css';

const app = new App({ name: 'houjin-bangou-search-results', version: VERSION }, {});
const root = document.getElementById('app');

function createFooter(attribution: string | null): HTMLElement | null {
  if (attribution === null) return null;
  const footer = document.createElement('footer');
  const attrP = document.createElement('p');
  attrP.className = 'attribution';
  attrP.textContent = attribution;
  footer.appendChild(attrP);
  return footer;
}

function render(output: SearchCorporateOutput): void {
  if (root === null) return;
  const vm = buildSearchResultsViewModel(output);

  if (vm.results.length === 0) {
    const emptyP = document.createElement('p');
    emptyP.className = 'empty';
    emptyP.textContent = '該当する法人情報がありません。';

    const nodes: Node[] = [emptyP];
    const footer = createFooter(vm.attribution);
    if (footer !== null) {
      nodes.push(footer);
    }
    root.replaceChildren(...nodes);
    return;
  }

  const summary = document.createElement('section');
  summary.className = 'summary';

  const h1 = document.createElement('h1');
  h1.textContent = '検索結果';

  const countP = document.createElement('p');
  countP.textContent =
    vm.data_as_of !== null ? `${vm.summary_text}（データ時点: ${vm.data_as_of}）` : vm.summary_text;

  summary.append(h1, countP);

  const tableWrap = document.createElement('div');
  tableWrap.className = 'table-wrap';

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  for (const colTitle of ['法人番号', '名称', '法人種別', '本店所在地', '最終更新日', '状態']) {
    const th = document.createElement('th');
    th.textContent = colTitle;
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);

  const tbody = document.createElement('tbody');
  for (const item of vm.results) {
    const tr = document.createElement('tr');
    tr.className = 'result-row';
    tr.dataset['corporateNumber'] = item.corporate_number;

    const tdNum = document.createElement('td');
    const code = document.createElement('code');
    code.textContent = item.corporate_number;
    tdNum.appendChild(code);

    const tdName = document.createElement('td');
    tdName.textContent = item.name;

    const tdLegalType = document.createElement('td');
    tdLegalType.textContent = item.legal_type;

    const tdLocation = document.createElement('td');
    tdLocation.textContent = item.location;

    const tdUpdate = document.createElement('td');
    tdUpdate.textContent = item.update_date;

    const tdStatus = document.createElement('td');
    const statusSpan = document.createElement('span');
    statusSpan.className = `status ${item.status_badge.className}`;
    statusSpan.textContent = item.status_badge.label;
    tdStatus.appendChild(statusSpan);

    tr.append(tdNum, tdName, tdLegalType, tdLocation, tdUpdate, tdStatus);
    tr.addEventListener('click', () => {
      void lookupCorporate(item.corporate_number);
    });
    tbody.appendChild(tr);
  }

  table.append(thead, tbody);
  tableWrap.appendChild(table);

  const hintP = document.createElement('p');
  hintP.className = 'hint';
  hintP.textContent = '行を選択すると法人番号で詳細を再取得します。';

  const children: Node[] = [summary, tableWrap, hintP];

  if (vm.address_warning !== null) {
    const warnP = document.createElement('p');
    warnP.className = 'address-warning';
    warnP.textContent = vm.address_warning;
    children.push(warnP);
  }

  if (vm.next_cursor !== null) {
    const nextP = document.createElement('p');
    nextP.className = 'next';
    nextP.appendChild(document.createTextNode('次ページあり: '));
    const cursorCode = document.createElement('code');
    cursorCode.textContent = vm.next_cursor;
    nextP.appendChild(cursorCode);
    children.push(nextP);
  }

  const footer = createFooter(vm.attribution);
  if (footer !== null) {
    children.push(footer);
  }

  root.replaceChildren(...children);
}

function prependBanner(className: string, message: string): HTMLElement | null {
  if (root === null) return null;
  const p = document.createElement('p');
  p.className = className;
  p.textContent = message;
  root.prepend(p);
  return p;
}

async function lookupCorporate(corporateNumber: string): Promise<void> {
  if (root === null) return;
  const loadingEl = prependBanner(
    'loading',
    `法人番号 ${corporateNumber} の詳細を取得しています...`,
  );
  try {
    const result = await app.callServerTool({
      name: 'lookup_corporate_by_number',
      arguments: buildLookupByNumberArgs(corporateNumber),
    });
    if (result.isError) {
      loadingEl?.remove();
      prependBanner('empty', '詳細取得に失敗しました。');
      return;
    }
    render((result.structuredContent ?? {}) as SearchCorporateOutput);
  } catch (error) {
    loadingEl?.remove();
    prependBanner('empty', error instanceof Error ? error.message : '詳細取得に失敗しました。');
  }
}

app.onhostcontextchanged = (ctx) => {
  if (ctx.theme !== undefined) applyDocumentTheme(ctx.theme);
};

app.ontoolresult = (params) => {
  render((params.structuredContent ?? {}) as SearchCorporateOutput);
};

await app.connect();
