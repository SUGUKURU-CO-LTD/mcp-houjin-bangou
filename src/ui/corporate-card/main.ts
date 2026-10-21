import { App, applyDocumentTheme } from '@modelcontextprotocol/ext-apps';
import { VERSION } from '../../version';
import {
  buildCorporateCardViewModel,
  buildSearchSimilarArgs,
  type LookupCorporateOutput,
} from '../shared';
import './styles.css';

const app = new App({ name: 'houjin-bangou-corporate-card', version: VERSION }, {});
const root = document.getElementById('app');

function appendFact(dl: HTMLDListElement, label: string, value: string | Node): void {
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  if (typeof value === 'string') {
    dd.textContent = value;
  } else {
    dd.appendChild(value);
  }
  dl.append(dt, dd);
}

function renderEmpty(message: string): void {
  if (root === null) return;
  const section = document.createElement('section');
  section.className = 'empty-state';

  const p = document.createElement('p');
  p.textContent = message;

  const small = document.createElement('small');
  small.textContent =
    'lookup_corporate_by_number の結果を受け取ると、ここに法人カードが表示されます。';

  section.append(p, small);
  root.replaceChildren(section);
}

function renderCard(output: LookupCorporateOutput): void {
  if (root === null) return;
  const vm = buildCorporateCardViewModel(output);
  if (vm === null) {
    renderEmpty('該当する法人情報がありません。');
    return;
  }

  const header = document.createElement('section');
  header.className = 'header';

  const titleWrap = document.createElement('div');
  const h1 = document.createElement('h1');
  h1.textContent = vm.name;
  titleWrap.appendChild(h1);

  if (vm.name_kana !== null) {
    const kanaP = document.createElement('p');
    kanaP.className = 'kana';
    kanaP.textContent = vm.name_kana;
    titleWrap.appendChild(kanaP);
  }

  const statusSpan = document.createElement('span');
  statusSpan.className = `status ${vm.status_badge.className}`;
  statusSpan.textContent = vm.status_badge.label;

  header.append(titleWrap, statusSpan);

  const facts = document.createElement('dl');
  facts.className = 'facts';

  const codeEl = document.createElement('code');
  codeEl.textContent = vm.corporate_number;
  appendFact(facts, '法人番号', codeEl);
  appendFact(facts, '法人種別', vm.legal_type);

  if (vm.address_warning !== null) {
    const locWrap = document.createElement('div');
    const locText = document.createElement('span');
    locText.textContent = vm.location;
    const warnP = document.createElement('p');
    warnP.className = 'address-warning';
    warnP.textContent = vm.address_warning;
    locWrap.append(locText, warnP);
    appendFact(facts, '本店所在地', locWrap);
  } else {
    appendFact(facts, '本店所在地', vm.location);
  }

  appendFact(facts, '郵便番号', vm.post_code_display);
  appendFact(facts, '状態', vm.status_badge.label);

  if (vm.status === 'closed' || vm.close_date !== null) {
    appendFact(facts, '閉鎖年月日', vm.close_date ?? '未登録');
  }
  if (vm.status === 'closed' || vm.close_cause !== null) {
    appendFact(facts, '閉鎖事由', vm.close_cause ?? '未登録');
  }

  appendFact(facts, '最終更新日', vm.update_date);
  if (vm.data_as_of !== null) {
    appendFact(facts, 'データ時点', vm.data_as_of);
  }

  const actions = document.createElement('section');
  actions.className = 'actions';

  const searchBtn = document.createElement('button');
  searchBtn.type = 'button';
  searchBtn.id = 'search-similar';
  searchBtn.textContent = '類似商号を検索';
  searchBtn.addEventListener('click', () => {
    void searchSimilar(vm.name);
  });

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.id = 'copy-number';
  copyBtn.textContent = '法人番号をコピー';
  copyBtn.addEventListener('click', () => {
    void navigator.clipboard?.writeText(vm.corporate_number);
  });

  actions.append(searchBtn, copyBtn);

  const children: Node[] = [header, facts, actions];

  if (vm.attribution !== null) {
    const footer = document.createElement('footer');
    const attrP = document.createElement('p');
    attrP.className = 'attribution';
    attrP.textContent = vm.attribution;
    footer.appendChild(attrP);
    children.push(footer);
  }

  root.replaceChildren(...children);
}

async function searchSimilar(name: string): Promise<void> {
  renderEmpty('類似商号を検索しています...');
  try {
    const result = await app.callServerTool({
      name: 'search_corporate_by_name',
      arguments: buildSearchSimilarArgs(name),
    });
    if (result.isError) {
      renderEmpty('検索に失敗しました。tool result を確認してください。');
      return;
    }
    renderCard((result.structuredContent ?? {}) as LookupCorporateOutput);
  } catch (error) {
    renderEmpty(error instanceof Error ? error.message : '検索に失敗しました。');
  }
}

app.onhostcontextchanged = (ctx) => {
  if (ctx.theme !== undefined) applyDocumentTheme(ctx.theme);
};

app.ontoolresult = (params) => {
  renderCard((params.structuredContent ?? {}) as LookupCorporateOutput);
};

await app.connect();
