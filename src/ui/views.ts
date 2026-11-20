/**
 * MCP Apps Interactive Multi-View Controller (`corporate-card` & `search-results`).
 *
 * Uses strictly safe DOM creation (`document.createElement` + `textContent`) and
 * CSSOM property setters so air-gapped CSP (`style-src 'sha256-...'`, `font-src data:`,
 * `require-trusted-types-for 'script'`) holds without violations.
 */

import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
  type McpUiDisplayMode,
  type McpUiHostContext,
} from '@modelcontextprotocol/ext-apps';
import {
  buildCorporateCardViewModel,
  buildCorporateMasterCopyText,
  buildInvoiceCardViewModel,
  buildLookupByNumberArgs,
  buildLookupInvoiceArgs,
  buildNtaHistoryUrl,
  buildPaginatedSearchArgs,
  buildSearchResultsViewModel,
  buildSearchSimilarArgs,
  extractQueryContextFromCursor,
  extractReferenceDateFromContent,
  extractSearchQueryFromContent,
  extractToolErrorViewModel,
  isInvoiceOutput,
  type CorporateCardViewModel,
  type InvoiceCardViewModel,
  type LookupCorporateOutput,
  type LookupInvoiceOutput,
  type SearchCorporateOutput,
  type SearchQueryContext,
  type SearchResultsViewModel,
  type ToolErrorViewModel,
} from './shared';

export type DefaultUiMode = 'corporate-card' | 'search-results';

export interface McpUiBootstrapOptions {
  name: string;
  version: string;
  defaultMode: DefaultUiMode;
}

type StatusFilter = 'all' | 'active' | 'closed';

interface SearchPageSnapshot {
  output: SearchCorporateOutput;
  cursorUsed: string | null;
}

type ViewState =
  | {
      kind: 'corporate-card';
      output: LookupCorporateOutput;
      inlineInvoice?: {
        output?: LookupInvoiceOutput;
        referenceDate: string;
        error?: ToolErrorViewModel;
      };
    }
  | {
      kind: 'invoice-card';
      output: LookupInvoiceOutput;
      referenceDate: string;
    }
  | {
      kind: 'search-results';
      output: SearchCorporateOutput;
      queryContext: SearchQueryContext | null;
      pageHistory: SearchPageSnapshot[];
      filter: StatusFilter;
    }
  | {
      kind: 'error';
      error: ToolErrorViewModel;
    }
  | {
      kind: 'cancelled';
      reason: string | null;
    };

interface HistoryEntry {
  state: ViewState;
  backLabel: string;
  focusSelector?: string;
  scrollY: number;
}

interface LastToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export async function bootstrapMcpUiApp(options: McpUiBootstrapOptions): Promise<App> {
  const app = new App(
    { name: options.name, version: options.version },
    { availableDisplayModes: ['inline', 'fullscreen'] },
  );
  const root = document.getElementById('app');

  const activeTimers = new Set<ReturnType<typeof setTimeout>>();
  let inFlightAbort: AbortController | null = null;
  let hasReceivedResult = false;
  let currentState: ViewState | null = null;
  let historyStack: HistoryEntry[] = [];
  let lastToolCall: LastToolCall | null = null;
  let initialSearchContext: SearchQueryContext | null = null;
  let currentDisplayMode: McpUiDisplayMode = 'inline';
  let canFullscreen = false;
  let lastAnnouncedCopyMessage = '';

  function clearTimers(): void {
    for (const t of activeTimers) {
      clearTimeout(t);
    }
    activeTimers.clear();
  }

  function abortInFlight(): void {
    if (inFlightAbort) {
      inFlightAbort.abort();
      inFlightAbort = null;
    }
  }

  function nextAbortSignal(): AbortSignal {
    abortInFlight();
    inFlightAbort = new AbortController();
    return inFlightAbort.signal;
  }

  function applyHostContext(ctx: McpUiHostContext | undefined): void {
    if (!ctx) return;
    if (ctx.theme !== undefined) {
      applyDocumentTheme(ctx.theme);
    }
    if (ctx.styles?.variables !== undefined) {
      applyHostStyleVariables(ctx.styles.variables);
    }
    if (ctx.safeAreaInsets !== undefined) {
      const docEl = document.documentElement;
      docEl.style.setProperty('--safe-area-top', `${ctx.safeAreaInsets.top}px`);
      docEl.style.setProperty('--safe-area-right', `${ctx.safeAreaInsets.right}px`);
      docEl.style.setProperty('--safe-area-bottom', `${ctx.safeAreaInsets.bottom}px`);
      docEl.style.setProperty('--safe-area-left', `${ctx.safeAreaInsets.left}px`);
    }
    const prevCanFullscreen = canFullscreen;
    const prevMode = currentDisplayMode;
    if (ctx.displayMode !== undefined) {
      currentDisplayMode = ctx.displayMode;
      document.documentElement.dataset['displayMode'] = ctx.displayMode;
    }
    if (ctx.availableDisplayModes !== undefined) {
      canFullscreen = ctx.availableDisplayModes.includes('fullscreen');
    }
    if ((prevCanFullscreen !== canFullscreen || prevMode !== currentDisplayMode) && currentState) {
      renderCurrentState(false);
    }
  }

  function canCallServerTools(): boolean {
    const caps = app.getHostCapabilities();
    return caps === undefined || caps.serverTools !== undefined;
  }

  function canOpenLinks(): boolean {
    return app.getHostCapabilities()?.openLinks !== undefined;
  }

  async function syncModelContext(
    summaryText: string,
    structured: Record<string, unknown>,
  ): Promise<void> {
    const mc = app.getHostCapabilities()?.updateModelContext;
    if (!mc) return;
    try {
      const payload: {
        content?: Array<{ type: 'text'; text: string }>;
        structuredContent?: Record<string, unknown>;
      } = {};
      if (mc.text !== undefined) {
        payload.content = [{ type: 'text', text: summaryText }];
      }
      if (mc.structuredContent !== undefined) {
        payload.structuredContent = structured;
      }
      if (payload.content !== undefined || payload.structuredContent !== undefined) {
        await app.updateModelContext(payload);
      }
    } catch {
      // Ignore host context sync rejections so UI interactions remain uninterrupted.
    }
  }

  function legacyCopyText(text: string): boolean {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.insetBlockStart = '0';
    field.style.opacity = '0';
    field.style.pointerEvents = 'none';
    document.body.appendChild(field);
    field.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      field.remove();
    }
  }

  function reportCopyOutcome(button: HTMLButtonElement, tip: HTMLElement, ok: boolean): void {
    button.removeAttribute('data-copied');
    button.removeAttribute('data-failed');
    let msg = ok ? 'コピーしました' : 'コピー失敗';
    if (msg === lastAnnouncedCopyMessage) {
      msg += '\u00A0';
    }
    lastAnnouncedCopyMessage = msg;
    tip.textContent = '';
    button.setAttribute(ok ? 'data-copied' : 'data-failed', '');
    requestAnimationFrame(() => {
      tip.textContent = msg;
    });
    const timer = setTimeout(() => {
      activeTimers.delete(timer);
      button.removeAttribute('data-copied');
      button.removeAttribute('data-failed');
      tip.textContent = '';
    }, 2000);
    activeTimers.add(timer);
  }

  function createCopyControl(
    id: string,
    label: string,
    textToCopy: string,
    ariaLabel?: string,
  ): HTMLElement {
    const group = document.createElement('span');
    group.className = 'copy-group';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = id;
    btn.className = 'btn-secondary';
    btn.textContent = label;
    if (ariaLabel !== undefined) {
      btn.setAttribute('aria-label', ariaLabel);
    }

    const tip = document.createElement('span');
    tip.className = 'copy-tip';
    tip.setAttribute('role', 'status');

    btn.addEventListener('click', () => {
      void (async () => {
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(textToCopy);
            reportCopyOutcome(btn, tip, true);
          } else {
            reportCopyOutcome(btn, tip, legacyCopyText(textToCopy));
          }
        } catch {
          reportCopyOutcome(btn, tip, legacyCopyText(textToCopy));
        }
      })();
    });

    group.append(btn, tip);
    return group;
  }

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

  function createStatusPill(className: string, glyph: string, label: string): HTMLSpanElement {
    const span = document.createElement('span');
    span.className = `status ${className}`;
    const g = document.createElement('span');
    g.className = 'status-glyph';
    g.setAttribute('aria-hidden', 'true');
    g.textContent = glyph;
    span.append(g, document.createTextNode(label));
    return span;
  }

  function createTopBar(): HTMLElement | null {
    const topEntry = historyStack[historyStack.length - 1];
    if (!topEntry && !canFullscreen) return null;

    const bar = document.createElement('nav');
    bar.className = 'top-bar';
    bar.setAttribute('aria-label', '表示ナビゲーション');

    if (topEntry) {
      const backBtn = document.createElement('button');
      backBtn.type = 'button';
      backBtn.id = 'nav-back';
      backBtn.className = 'btn-ghost';
      backBtn.textContent = `← ${topEntry.backLabel}`;
      backBtn.addEventListener('click', () => {
        const popped = historyStack.pop();
        if (!popped) return;
        currentState = popped.state;
        renderCurrentState(false);
        window.scrollTo({ top: popped.scrollY, behavior: 'instant' as ScrollBehavior });
        if (popped.focusSelector) {
          const target = root?.querySelector<HTMLElement>(popped.focusSelector);
          target?.focus();
        }
      });
      bar.appendChild(backBtn);
    } else {
      bar.appendChild(document.createElement('span'));
    }

    if (canFullscreen) {
      const modeBtn = document.createElement('button');
      modeBtn.type = 'button';
      modeBtn.id = 'toggle-display-mode';
      modeBtn.className = 'btn-ghost';
      const nextMode: McpUiDisplayMode =
        currentDisplayMode === 'fullscreen' ? 'inline' : 'fullscreen';
      modeBtn.textContent = currentDisplayMode === 'fullscreen' ? '通常表示に戻す' : '全画面で表示';
      modeBtn.addEventListener('click', () => {
        void (async () => {
          try {
            const res = await app.requestDisplayMode({ mode: nextMode });
            currentDisplayMode = res.mode;
            document.documentElement.dataset['displayMode'] = res.mode;
            renderCurrentState(false);
          } catch {
            // Host denied display mode switch.
          }
        })();
      });
      bar.appendChild(modeBtn);
    }

    return bar;
  }

  function pushHistoryAndTransition(
    nextState: ViewState,
    backLabel: string,
    focusSelector?: string,
  ): void {
    if (currentState !== null) {
      historyStack.push({
        state: currentState,
        backLabel,
        focusSelector,
        scrollY: window.scrollY,
      });
    }
    currentState = nextState;
    renderCurrentState(true);
  }

  function renderLoadingSkeleton(message: string): void {
    if (root === null) return;
    const wrap = document.createElement('section');
    wrap.className = 'skeleton-panel';
    wrap.setAttribute('aria-busy', 'true');

    const p = document.createElement('p');
    p.className = 'loading';
    p.textContent = message;

    const l1 = document.createElement('div');
    l1.className = 'skeleton-line short';
    const l2 = document.createElement('div');
    l2.className = 'skeleton-line medium';
    const l3 = document.createElement('div');
    l3.className = 'skeleton-line';

    wrap.append(p, l1, l2, l3);
    root.replaceChildren(wrap);
  }

  function createFooter(
    attribution: string | null,
    taxDisclaimer?: string | null,
  ): HTMLElement | null {
    if (attribution === null && (taxDisclaimer === undefined || taxDisclaimer === null)) {
      return null;
    }
    const footer = document.createElement('footer');
    if (taxDisclaimer !== undefined && taxDisclaimer !== null) {
      const discP = document.createElement('p');
      discP.className = 'disclaimer';
      discP.textContent = taxDisclaimer;
      footer.appendChild(discP);
    }
    if (attribution !== null) {
      const attrP = document.createElement('p');
      attrP.className = 'attribution';
      attrP.textContent = attribution;
      footer.appendChild(attrP);
    }
    return footer;
  }

  async function executeDrillCorporate(
    corporateNumber: string,
    backLabel: string,
    focusSelector?: string,
  ): Promise<void> {
    const signal = nextAbortSignal();
    renderLoadingSkeleton(`法人番号 ${corporateNumber} の公表情報を取得しています...`);
    try {
      const res = await app.callServerTool(
        {
          name: 'lookup_corporate_by_number',
          arguments: buildLookupByNumberArgs(corporateNumber),
        },
        { signal },
      );
      if (res.isError) {
        const errVm = extractToolErrorViewModel(res);
        if (errVm) {
          pushHistoryAndTransition({ kind: 'error', error: errVm }, backLabel, focusSelector);
        }
        return;
      }
      const output = (res.structuredContent ?? {}) as LookupCorporateOutput;
      const vm = buildCorporateCardViewModel(output);
      pushHistoryAndTransition({ kind: 'corporate-card', output }, backLabel, focusSelector);
      if (vm) {
        void syncModelContext(
          `ユーザーが法人カードを表示中: ${vm.name}（法人番号: ${vm.corporate_number}, 状態: ${vm.status_badge.label}, データ時点: ${vm.data_as_of ?? '不明'}）`,
          { viewed_corporation: vm },
        );
      }
    } catch (err) {
      if (signal.aborted) return;
      pushHistoryAndTransition(
        {
          kind: 'error',
          error: {
            code: 'INTERNAL_ERROR',
            message: err instanceof Error ? err.message : '詳細情報の取得に失敗しました。',
            is_data_unavailable: false,
            is_rate_limited: false,
            is_not_found: false,
            is_invalid_input: false,
          },
        },
        backLabel,
        focusSelector,
      );
    }
  }

  async function executeSimilarSearch(name: string): Promise<void> {
    const args = buildSearchSimilarArgs(name);
    const queryName = args.name;
    const signal = nextAbortSignal();
    renderLoadingSkeleton(`「${queryName}」の類似商号を検索しています...`);
    try {
      const res = await app.callServerTool(
        {
          name: 'search_corporate_by_name',
          arguments: args,
        },
        { signal },
      );
      if (res.isError) {
        const errVm = extractToolErrorViewModel(res);
        if (errVm) {
          pushHistoryAndTransition(
            { kind: 'error', error: errVm },
            '法人カードに戻る',
            '#search-similar',
          );
        }
        return;
      }
      const output = (res.structuredContent ?? {}) as SearchCorporateOutput;
      pushHistoryAndTransition(
        {
          kind: 'search-results',
          output,
          queryContext: { name: queryName },
          pageHistory: [],
          filter: 'all',
        },
        '法人カードに戻る',
        '#search-similar',
      );
      const searchVm = buildSearchResultsViewModel(output);
      void syncModelContext(`ユーザーが類似商号「${queryName}」を検索: ${searchVm.summary_text}`, {
        search_query: queryName,
        returned_count: searchVm.returned_count,
        total_count: searchVm.total_count,
      });
    } catch (err) {
      if (signal.aborted) return;
      pushHistoryAndTransition(
        {
          kind: 'error',
          error: {
            code: 'INTERNAL_ERROR',
            message: err instanceof Error ? err.message : '検索に失敗しました。',
            is_data_unavailable: false,
            is_rate_limited: false,
            is_not_found: false,
            is_invalid_input: false,
          },
        },
        '法人カードに戻る',
        '#search-similar',
      );
    }
  }

  async function executeInlineInvoiceCheck(
    corpState: Extract<ViewState, { kind: 'corporate-card' }>,
    corporateNumber: string,
    referenceDate: string,
    statusSlot: HTMLElement,
  ): Promise<void> {
    const signal = nextAbortSignal();
    statusSlot.textContent = `登録番号 T${corporateNumber} のインボイス公表情報を照会しています...`;
    try {
      const res = await app.callServerTool(
        {
          name: 'lookup_invoice_issuer',
          arguments: buildLookupInvoiceArgs(corporateNumber, referenceDate),
        },
        { signal },
      );
      if (res.isError) {
        const errVm = extractToolErrorViewModel(res);
        corpState.inlineInvoice = {
          referenceDate,
          error: errVm ?? {
            code: 'INTERNAL_ERROR',
            message: 'インボイス照会に失敗しました。',
            is_data_unavailable: false,
            is_rate_limited: false,
            is_not_found: false,
            is_invalid_input: false,
          },
        };
        renderCurrentState(false);
        return;
      }
      const invOutput = (res.structuredContent ?? {}) as LookupInvoiceOutput;
      corpState.inlineInvoice = {
        output: invOutput,
        referenceDate,
      };
      renderCurrentState(false);
      const invVm = buildInvoiceCardViewModel(invOutput);
      if (invVm) {
        void syncModelContext(
          `ユーザーが適格請求書発行事業者情報を確認: ${invVm.registration_number} (${invVm.status_badge.label}${referenceDate ? `, 基準日: ${referenceDate}` : ''}, データ時点: ${invVm.data_as_of ?? '不明'})`,
          { verified_invoice_issuer: invVm, reference_date: referenceDate || null },
        );
      }
    } catch (err) {
      if (signal.aborted) return;
      corpState.inlineInvoice = {
        referenceDate,
        error: {
          code: 'INTERNAL_ERROR',
          message: err instanceof Error ? err.message : 'インボイス照会に失敗しました。',
          is_data_unavailable: false,
          is_rate_limited: false,
          is_not_found: false,
          is_invalid_input: false,
        },
      };
      renderCurrentState(false);
    }
  }

  function renderInlineInvoiceSummary(
    invVm: InvoiceCardViewModel,
    referenceDate: string,
  ): HTMLElement {
    const box = document.createElement('div');
    box.className = 'invoice-inline-card';

    const top = document.createElement('div');
    top.className = 'header';
    const title = document.createElement('h2');
    title.textContent = `適格請求書発行事業者 公表情報 (${invVm.registration_number})`;
    const badge = createStatusPill(
      invVm.status_badge.className,
      invVm.status_badge.glyph,
      invVm.status_badge.label,
    );
    top.append(title, badge);
    box.appendChild(top);

    if (invVm.not_found_notice !== null) {
      const note = document.createElement('p');
      note.className = 'notice-box';
      note.textContent = invVm.not_found_notice;
      box.appendChild(note);
    }

    const dl = document.createElement('dl');
    dl.className = 'facts';
    const code = document.createElement('code');
    code.textContent = invVm.registration_number;
    appendFact(dl, '登録番号', code);
    appendFact(dl, '事業者区分', invVm.business_type_label);
    if (invVm.registration_date !== null) {
      appendFact(dl, '登録年月日', invVm.registration_date);
    }
    if (invVm.cancellation_date !== null) {
      appendFact(dl, '取消年月日', invVm.cancellation_date);
    }
    if (invVm.expiration_date !== null) {
      appendFact(dl, '失効年月日', invVm.expiration_date);
    }
    if (invVm.reference_date_verdict !== null) {
      const verdictPill = createStatusPill(
        invVm.reference_date_verdict.className,
        invVm.reference_date_verdict.glyph,
        `${referenceDate ? `${referenceDate}: ` : ''}${invVm.reference_date_verdict.label}`,
      );
      appendFact(dl, '基準日判定', verdictPill);
    }
    if (invVm.data_as_of !== null) {
      appendFact(dl, 'データ時点', invVm.data_as_of);
    }
    box.appendChild(dl);

    if (referenceDate !== '' && invVm.data_as_of !== null && referenceDate > invVm.data_as_of) {
      const horizonWarn = document.createElement('p');
      horizonWarn.className = 'address-warning';
      horizonWarn.textContent = `※基準日（${referenceDate}）はデータ時点（${invVm.data_as_of}）より後の日付のため、データ時点以降の登録取消・失効等は反映されていません。`;
      box.appendChild(horizonWarn);
    }

    const actionRow = document.createElement('div');
    actionRow.className = 'actions';
    actionRow.appendChild(
      createCopyControl(
        'copy-inline-invoice',
        '登録番号 (T番号) をコピー',
        invVm.registration_number,
      ),
    );
    box.appendChild(actionRow);

    const footer = createFooter(invVm.attribution, invVm.tax_disclaimer);
    if (footer !== null) {
      box.appendChild(footer);
    }
    return box;
  }

  function buildCorporateCardElement(
    state: Extract<ViewState, { kind: 'corporate-card' }>,
    focusHeading: boolean,
  ): HTMLElement {
    const vm: CorporateCardViewModel | null = buildCorporateCardViewModel(state.output);
    if (vm === null) {
      const empty = document.createElement('section');
      empty.className = 'empty-state';
      const p = document.createElement('p');
      p.textContent = '該当する法人情報がありません。';
      empty.appendChild(p);
      return empty;
    }

    const card = document.createElement('article');
    card.className = 'surface-card';

    const header = document.createElement('section');
    header.className = 'header';

    const titleWrap = document.createElement('div');
    const h1 = document.createElement('h1');
    h1.textContent = vm.name;
    if (focusHeading) {
      h1.tabIndex = -1;
    }
    titleWrap.appendChild(h1);

    if (vm.name_kana !== null) {
      const kanaP = document.createElement('p');
      kanaP.className = 'kana';
      kanaP.textContent = vm.name_kana;
      titleWrap.appendChild(kanaP);
    }

    const statusPill = createStatusPill(
      vm.status_badge.className,
      vm.status === 'closed' ? '■' : '●',
      vm.status_badge.label,
    );
    header.append(titleWrap, statusPill);

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
      const warnGlyph = document.createElement('span');
      warnGlyph.setAttribute('aria-hidden', 'true');
      warnGlyph.textContent = '▲ ';
      warnP.append(warnGlyph, document.createTextNode(vm.address_warning));
      locWrap.append(locText, warnP);
      appendFact(facts, '本店所在地', locWrap);
    } else {
      appendFact(facts, '本店所在地', vm.location);
    }

    const postSpan = document.createElement('span');
    postSpan.className = 'tabular';
    postSpan.textContent = vm.post_code_display;
    appendFact(facts, '郵便番号', postSpan);
    appendFact(facts, '状態', vm.status_badge.label);

    if (vm.status === 'closed' || vm.close_date !== null) {
      const closeDateSpan = document.createElement('span');
      closeDateSpan.className = 'tabular';
      closeDateSpan.textContent = vm.close_date ?? '未登録';
      appendFact(facts, '閉鎖年月日', closeDateSpan);
    }
    if (vm.status === 'closed' || vm.close_cause !== null) {
      appendFact(facts, '閉鎖事由', vm.close_cause ?? '未登録');
    }

    if (vm.successor_corporate_number !== null) {
      const succWrap = document.createElement('div');
      succWrap.className = 'inline-fact-action';
      const succCode = document.createElement('code');
      succCode.textContent = vm.successor_corporate_number;
      succWrap.appendChild(succCode);
      if (canCallServerTools()) {
        const succBtn = document.createElement('button');
        succBtn.type = 'button';
        succBtn.id = 'lookup-successor';
        succBtn.className = 'btn-ghost';
        succBtn.textContent = '承継先法人を照会 →';
        const succNum = vm.successor_corporate_number;
        succBtn.addEventListener('click', () => {
          void executeDrillCorporate(succNum, '元の法人カードに戻る', '#lookup-successor');
        });
        succWrap.appendChild(succBtn);
      }
      appendFact(facts, '承継先法人番号', succWrap);
    }

    const updateSpan = document.createElement('span');
    updateSpan.className = 'tabular';
    updateSpan.textContent = vm.update_date;
    appendFact(facts, '最終更新日', updateSpan);

    if (vm.data_as_of !== null) {
      const asOfSpan = document.createElement('span');
      asOfSpan.className = 'tabular';
      asOfSpan.textContent = vm.data_as_of;
      appendFact(facts, 'データ時点', asOfSpan);
    }

    const actions = document.createElement('section');
    actions.className = 'actions';

    if (canCallServerTools()) {
      const searchBtn = document.createElement('button');
      searchBtn.type = 'button';
      searchBtn.id = 'search-similar';
      searchBtn.className = 'btn-primary';
      searchBtn.textContent = '類似商号を検索';
      searchBtn.addEventListener('click', () => {
        void executeSimilarSearch(vm.name);
      });
      actions.appendChild(searchBtn);
    }

    const inlineInvVm = state.inlineInvoice?.output
      ? buildInvoiceCardViewModel(state.inlineInvoice.output)
      : null;

    actions.appendChild(
      createCopyControl(
        'copy-number',
        '法人番号をコピー',
        vm.corporate_number,
        `法人番号 ${vm.corporate_number} をコピー`,
      ),
    );

    actions.appendChild(
      createCopyControl(
        'copy-master-record',
        'マスタ登録用に一括コピー',
        buildCorporateMasterCopyText(vm, inlineInvVm),
        `${vm.name} の取引先マスタ登録用情報を一括コピー`,
      ),
    );

    let openLinkNote: HTMLParagraphElement | null = null;
    if (canOpenLinks()) {
      const linkBtn = document.createElement('button');
      linkBtn.type = 'button';
      linkBtn.id = 'open-nta-history';
      linkBtn.className = 'btn-secondary';
      linkBtn.textContent = '国税庁公表サイトで履歴確認 ↗';
      openLinkNote = document.createElement('p');
      openLinkNote.className = 'hint';
      openLinkNote.setAttribute('role', 'status');
      linkBtn.addEventListener('click', () => {
        void (async () => {
          try {
            const res = await app.openLink({ url: buildNtaHistoryUrl(vm.corporate_number) });
            if (res.isError && openLinkNote) {
              openLinkNote.textContent = '外部リンクの起動がホスト設定によりキャンセルされました。';
            }
          } catch {
            if (openLinkNote) {
              openLinkNote.textContent = '外部リンクを開けませんでした。';
            }
          }
        })();
      });
      actions.appendChild(linkBtn);
    }

    card.append(header, facts, actions);
    if (openLinkNote !== null) {
      card.appendChild(openLinkNote);
    }

    if (canCallServerTools()) {
      const invSection = document.createElement('section');
      invSection.className = 'invoice-section';

      const invTitle = document.createElement('h2');
      invTitle.textContent = '適格請求書（インボイス）登録照会';

      const controls = document.createElement('div');
      controls.className = 'invoice-controls';

      const dateGroup = document.createElement('div');
      dateGroup.className = 'field-group';
      const dateLabel = document.createElement('label');
      dateLabel.htmlFor = 'invoice-ref-date';
      dateLabel.textContent = '取引基準日（任意）';
      const dateInput = document.createElement('input');
      dateInput.type = 'date';
      dateInput.id = 'invoice-ref-date';
      dateInput.value = state.inlineInvoice?.referenceDate ?? '';
      dateGroup.append(dateLabel, dateInput);

      const checkBtn = document.createElement('button');
      checkBtn.type = 'button';
      checkBtn.id = 'check-invoice';
      checkBtn.className = 'btn-secondary';
      checkBtn.textContent = `インボイス登録を確認 (T${vm.corporate_number})`;

      const invStatusSlot = document.createElement('div');
      invStatusSlot.className = 'loading';
      invStatusSlot.setAttribute('role', 'status');

      checkBtn.addEventListener('click', () => {
        void executeInlineInvoiceCheck(state, vm.corporate_number, dateInput.value, invStatusSlot);
      });

      controls.append(dateGroup, checkBtn);
      invSection.append(invTitle, controls, invStatusSlot);

      if (state.inlineInvoice?.error) {
        const err = state.inlineInvoice.error;
        if (err.is_data_unavailable) {
          const infoBox = document.createElement('div');
          infoBox.className = 'notice-box';
          const p = document.createElement('p');
          p.textContent = err.message;
          const copyT = createCopyControl(
            'copy-expected-t-number',
            `T${vm.corporate_number} をコピー`,
            `T${vm.corporate_number}`,
          );
          infoBox.append(p, copyT);
          invSection.appendChild(infoBox);
        } else {
          const errBox = document.createElement('div');
          errBox.className = 'error-panel';
          errBox.setAttribute('role', 'alert');
          const p = document.createElement('p');
          p.textContent = err.message;
          errBox.appendChild(p);
          invSection.appendChild(errBox);
        }
      } else if (state.inlineInvoice?.output) {
        const invVm = buildInvoiceCardViewModel(state.inlineInvoice.output);
        if (invVm) {
          invSection.appendChild(
            renderInlineInvoiceSummary(invVm, state.inlineInvoice.referenceDate),
          );
        }
      }

      card.appendChild(invSection);
    }

    const footer = createFooter(vm.attribution);
    if (footer !== null) {
      card.appendChild(footer);
    }

    return card;
  }

  function buildInvoiceCardElement(
    state: Extract<ViewState, { kind: 'invoice-card' }>,
    focusHeading: boolean,
  ): HTMLElement {
    const vm = buildInvoiceCardViewModel(state.output);
    if (vm === null) {
      const empty = document.createElement('section');
      empty.className = 'empty-state';
      const p = document.createElement('p');
      p.textContent = '適格請求書発行事業者の照会結果がありません。';
      empty.appendChild(p);
      return empty;
    }

    const card = document.createElement('article');
    card.className = 'surface-card';

    const header = document.createElement('section');
    header.className = 'header';

    const titleWrap = document.createElement('div');
    const h1 = document.createElement('h1');
    h1.textContent = vm.corporate_name ?? '適格請求書発行事業者 公表情報';
    if (focusHeading) {
      h1.tabIndex = -1;
    }
    const subP = document.createElement('p');
    subP.className = 'kana tabular';
    subP.textContent = `登録番号: ${vm.registration_number}`;
    titleWrap.append(h1, subP);

    const statusPill = createStatusPill(
      vm.status_badge.className,
      vm.status_badge.glyph,
      vm.status_badge.label,
    );
    header.append(titleWrap, statusPill);
    card.appendChild(header);

    if (vm.individual_privacy_notice !== null) {
      const priv = document.createElement('p');
      priv.className = 'notice-box';
      priv.textContent = vm.individual_privacy_notice;
      card.appendChild(priv);
    }

    if (vm.not_found_notice !== null) {
      const nf = document.createElement('p');
      nf.className = 'notice-box';
      nf.textContent = vm.not_found_notice;
      card.appendChild(nf);
    }

    const facts = document.createElement('dl');
    facts.className = 'facts';

    const regCode = document.createElement('code');
    regCode.textContent = vm.registration_number;
    appendFact(facts, '登録番号', regCode);
    appendFact(facts, '事業者区分', vm.business_type_label);

    if (vm.corporate_name !== null) {
      appendFact(facts, '公表名称', vm.corporate_name);
    }
    if (vm.location !== null) {
      appendFact(facts, '所在地', vm.location);
    }
    appendFact(facts, '登録状態', vm.status_badge.label);

    if (vm.registration_date !== null) {
      const regSpan = document.createElement('span');
      regSpan.className = 'tabular';
      regSpan.textContent = vm.registration_date;
      appendFact(facts, '登録年月日', regSpan);
    }
    if (vm.cancellation_date !== null) {
      const cancelSpan = document.createElement('span');
      cancelSpan.className = 'tabular';
      cancelSpan.textContent = vm.cancellation_date;
      appendFact(facts, '取消年月日', cancelSpan);
    }
    if (vm.expiration_date !== null) {
      const expSpan = document.createElement('span');
      expSpan.className = 'tabular';
      expSpan.textContent = vm.expiration_date;
      appendFact(facts, '失効年月日', expSpan);
    }
    if (vm.reference_date_verdict !== null) {
      const verdictPill = createStatusPill(
        vm.reference_date_verdict.className,
        vm.reference_date_verdict.glyph,
        `${state.referenceDate ? `${state.referenceDate}: ` : ''}${vm.reference_date_verdict.label}`,
      );
      appendFact(facts, '基準日判定', verdictPill);
    }
    if (vm.data_as_of !== null) {
      const asOfSpan = document.createElement('span');
      asOfSpan.className = 'tabular';
      asOfSpan.textContent = vm.data_as_of;
      appendFact(facts, 'データ時点', asOfSpan);
    }
    card.appendChild(facts);

    if (
      state.referenceDate !== '' &&
      vm.data_as_of !== null &&
      state.referenceDate > vm.data_as_of
    ) {
      const horizonWarn = document.createElement('p');
      horizonWarn.className = 'address-warning';
      horizonWarn.textContent = `※基準日（${state.referenceDate}）はデータ時点（${vm.data_as_of}）より後の日付のため、データ時点以降の登録取消・失効等は反映されていません。`;
      card.appendChild(horizonWarn);
    }

    const actions = document.createElement('section');
    actions.className = 'actions';
    actions.appendChild(
      createCopyControl(
        'copy-invoice-number',
        '登録番号をコピー',
        vm.registration_number,
        `登録番号 ${vm.registration_number} をコピー`,
      ),
    );

    if (vm.derived_corporate_number !== null && canCallServerTools()) {
      const corpBtn = document.createElement('button');
      corpBtn.type = 'button';
      corpBtn.id = 'view-corporate-card';
      corpBtn.className = 'btn-primary';
      corpBtn.textContent = '法人基本情報カードを表示';
      const corpNum = vm.derived_corporate_number;
      corpBtn.addEventListener('click', () => {
        void executeDrillCorporate(corpNum, 'インボイス照会結果に戻る', '#view-corporate-card');
      });
      actions.appendChild(corpBtn);
    }
    card.appendChild(actions);

    if (canCallServerTools()) {
      const recheckSec = document.createElement('section');
      recheckSec.className = 'invoice-section';
      const controls = document.createElement('div');
      controls.className = 'invoice-controls';

      const dateGroup = document.createElement('div');
      dateGroup.className = 'field-group';
      const dateLabel = document.createElement('label');
      dateLabel.htmlFor = 'recheck-ref-date';
      dateLabel.textContent = '基準日を指定して有効性を再確認';
      const dateInput = document.createElement('input');
      dateInput.type = 'date';
      dateInput.id = 'recheck-ref-date';
      dateInput.value = state.referenceDate;
      dateGroup.append(dateLabel, dateInput);

      const recheckBtn = document.createElement('button');
      recheckBtn.type = 'button';
      recheckBtn.id = 'recheck-invoice-date';
      recheckBtn.className = 'btn-secondary';
      recheckBtn.textContent = '基準日で再照会';
      recheckBtn.addEventListener('click', () => {
        void (async () => {
          const nextRefDate = dateInput.value;
          const signal = nextAbortSignal();
          renderLoadingSkeleton(
            `基準日 ${nextRefDate || '指定なし'} で ${vm.registration_number} を再照会しています...`,
          );
          try {
            const res = await app.callServerTool(
              {
                name: 'lookup_invoice_issuer',
                arguments: buildLookupInvoiceArgs(vm.registration_number, nextRefDate),
              },
              { signal },
            );
            if (res.isError) {
              const errVm = extractToolErrorViewModel(res);
              if (errVm) {
                pushHistoryAndTransition(
                  { kind: 'error', error: errVm },
                  'インボイス照会結果に戻る',
                  '#recheck-invoice-date',
                );
              }
              return;
            }
            const nextOutput = (res.structuredContent ?? {}) as LookupInvoiceOutput;
            currentState = {
              kind: 'invoice-card',
              output: nextOutput,
              referenceDate: nextRefDate,
            };
            renderCurrentState(true);
            const updatedVm = buildInvoiceCardViewModel(nextOutput);
            if (updatedVm) {
              void syncModelContext(
                `ユーザーがインボイス登録状態を基準日 (${nextRefDate || '指定なし'}) で再確認: ${updatedVm.registration_number} (${updatedVm.status_badge.label})`,
                { verified_invoice_issuer: updatedVm, reference_date: nextRefDate || null },
              );
            }
          } catch (err) {
            if (signal.aborted) return;
            pushHistoryAndTransition(
              {
                kind: 'error',
                error: {
                  code: 'INTERNAL_ERROR',
                  message: err instanceof Error ? err.message : '再照会に失敗しました。',
                  is_data_unavailable: false,
                  is_rate_limited: false,
                  is_not_found: false,
                  is_invalid_input: false,
                },
              },
              'インボイス照会結果に戻る',
              '#recheck-invoice-date',
            );
          }
        })();
      });

      controls.append(dateGroup, recheckBtn);
      recheckSec.appendChild(controls);
      card.appendChild(recheckSec);
    }

    const footer = createFooter(vm.attribution, vm.tax_disclaimer);
    if (footer !== null) {
      card.appendChild(footer);
    }

    return card;
  }

  async function executeSearchPage(
    state: Extract<ViewState, { kind: 'search-results' }>,
    nextCursor: string,
  ): Promise<void> {
    if (!state.queryContext) return;
    const signal = nextAbortSignal();
    renderLoadingSkeleton(`「${state.queryContext.name}」の次のページを取得しています...`);
    try {
      const res = await app.callServerTool(
        {
          name: 'search_corporate_by_name',
          arguments: buildPaginatedSearchArgs(state.queryContext, nextCursor),
        },
        { signal },
      );
      if (res.isError) {
        const errVm = extractToolErrorViewModel(res);
        if (errVm) {
          pushHistoryAndTransition({ kind: 'error', error: errVm }, '検索結果に戻る', '#next-page');
        }
        return;
      }
      const nextOutput = (res.structuredContent ?? {}) as SearchCorporateOutput;
      currentState = {
        kind: 'search-results',
        output: nextOutput,
        queryContext: state.queryContext,
        pageHistory: [...state.pageHistory, { output: state.output, cursorUsed: nextCursor }],
        filter: state.filter,
      };
      renderCurrentState(true);
      const nextVm = buildSearchResultsViewModel(nextOutput);
      void syncModelContext(
        `ユーザーが検索結果ページ ${state.pageHistory.length + 2} を表示中 (${nextVm.summary_text})`,
        {
          page: state.pageHistory.length + 2,
          returned_count: nextVm.returned_count,
          total_count: nextVm.total_count,
        },
      );
    } catch (err) {
      if (signal.aborted) return;
      pushHistoryAndTransition(
        {
          kind: 'error',
          error: {
            code: 'INTERNAL_ERROR',
            message: err instanceof Error ? err.message : '次ページの取得に失敗しました。',
            is_data_unavailable: false,
            is_rate_limited: false,
            is_not_found: false,
            is_invalid_input: false,
          },
        },
        '検索結果に戻る',
        '#next-page',
      );
    }
  }

  function buildSearchResultsElement(
    state: Extract<ViewState, { kind: 'search-results' }>,
    focusHeading: boolean,
  ): HTMLElement {
    const vm: SearchResultsViewModel = buildSearchResultsViewModel(state.output);
    const container = document.createElement('section');

    if (vm.results.length === 0 && state.pageHistory.length === 0) {
      const emptyBox = document.createElement('div');
      emptyBox.className = 'empty-state';
      const emptyP = document.createElement('p');
      emptyP.className = 'empty';
      emptyP.textContent = '該当する法人情報がありません。';
      emptyBox.appendChild(emptyP);
      container.appendChild(emptyBox);
      const footer = createFooter(vm.attribution);
      if (footer !== null) {
        container.appendChild(footer);
      }
      return container;
    }

    const summary = document.createElement('section');
    summary.className = 'summary';

    const h1 = document.createElement('h1');
    h1.id = 'search-results-heading';
    h1.textContent = state.queryContext?.name
      ? `「${state.queryContext.name}」の検索結果`
      : '検索結果';
    if (focusHeading) {
      h1.tabIndex = -1;
    }

    const countP = document.createElement('p');
    countP.className = 'tabular';
    countP.textContent =
      vm.data_as_of !== null
        ? `${vm.summary_text}（データ時点: ${vm.data_as_of}）`
        : vm.summary_text;

    summary.append(h1, countP);
    container.appendChild(summary);

    const activeCount = vm.results.filter((r) => r.status === 'active').length;
    const closedCount = vm.results.filter((r) => r.status === 'closed').length;

    if ((activeCount > 0 && closedCount > 0) || state.filter !== 'all') {
      const filterBar = document.createElement('div');
      filterBar.className = 'filter-bar';
      filterBar.setAttribute('role', 'group');
      filterBar.setAttribute('aria-label', '登記状態フィルタ');

      const filters: Array<{ key: StatusFilter; label: string }> = [
        { key: 'all', label: `すべて (${vm.results.length})` },
        { key: 'active', label: `登記中のみ (${activeCount})` },
        { key: 'closed', label: `閉鎖のみ (${closedCount})` },
      ];

      for (const f of filters) {
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'filter-pill';
        pill.setAttribute('aria-pressed', state.filter === f.key ? 'true' : 'false');
        pill.textContent = f.label;
        pill.addEventListener('click', () => {
          state.filter = f.key;
          renderCurrentState(false);
        });
        filterBar.appendChild(pill);
      }
      container.appendChild(filterBar);
    }

    const filteredRows = vm.results.filter((r) => {
      if (state.filter === 'active') return r.status === 'active';
      if (state.filter === 'closed') return r.status === 'closed';
      return true;
    });

    const tableWrap = document.createElement('div');
    tableWrap.className = 'table-wrap';
    tableWrap.tabIndex = 0;
    tableWrap.setAttribute('role', 'region');
    tableWrap.setAttribute('aria-labelledby', 'search-results-heading');

    const table = document.createElement('table');
    const caption = document.createElement('caption');
    caption.className = 'visually-hidden';
    caption.textContent = '法人名検索結果一覧。名称を選択すると法人基本情報カードを表示します。';
    table.appendChild(caption);

    const colTitles = ['法人番号', '名称', '法人種別', '本店所在地', '最終更新日', '状態'] as const;
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    for (const colTitle of colTitles) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = colTitle;
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);

    const tbody = document.createElement('tbody');
    if (filteredRows.length === 0) {
      const emptyTr = document.createElement('tr');
      const emptyTd = document.createElement('td');
      emptyTd.colSpan = colTitles.length;
      emptyTd.className = 'empty';
      emptyTd.textContent =
        'このページには選択中の状態に該当する法人がありません（「すべて」を選択すると全件表示します）。';
      emptyTr.appendChild(emptyTd);
      tbody.appendChild(emptyTr);
    }
    for (const item of filteredRows) {
      const tr = document.createElement('tr');
      tr.className = 'result-row';
      tr.dataset['corporateNumber'] = item.corporate_number;

      const tdNum = document.createElement('td');
      tdNum.dataset['label'] = colTitles[0];
      const code = document.createElement('code');
      code.textContent = item.corporate_number;
      tdNum.appendChild(code);

      const tdName = document.createElement('td');
      tdName.dataset['label'] = colTitles[1];
      if (canCallServerTools()) {
        const selectBtn = document.createElement('button');
        selectBtn.type = 'button';
        selectBtn.className = 'corp-select-btn';
        selectBtn.textContent = item.name;
        selectBtn.setAttribute(
          'aria-label',
          `${item.name}（法人番号 ${item.corporate_number}）の詳細を表示`,
        );
        selectBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          void executeDrillCorporate(
            item.corporate_number,
            '検索結果一覧に戻る',
            `tr[data-corporate-number="${item.corporate_number}"] .corp-select-btn`,
          );
        });
        tdName.appendChild(selectBtn);
      } else {
        tdName.textContent = item.name;
      }

      const tdLegalType = document.createElement('td');
      tdLegalType.dataset['label'] = colTitles[2];
      tdLegalType.textContent = item.legal_type;

      const tdLocation = document.createElement('td');
      tdLocation.dataset['label'] = colTitles[3];
      tdLocation.textContent = item.location;

      const tdUpdate = document.createElement('td');
      tdUpdate.dataset['label'] = colTitles[4];
      tdUpdate.className = 'tabular';
      tdUpdate.textContent = item.update_date;

      const tdStatus = document.createElement('td');
      tdStatus.dataset['label'] = colTitles[5];
      tdStatus.appendChild(
        createStatusPill(
          item.status_badge.className,
          item.status === 'closed' ? '■' : '●',
          item.status_badge.label,
        ),
      );

      tr.append(tdNum, tdName, tdLegalType, tdLocation, tdUpdate, tdStatus);
      if (canCallServerTools()) {
        tr.addEventListener('click', (ev) => {
          if (window.getSelection()?.toString()) return;
          const target = ev.target as HTMLElement | null;
          if (target?.closest('button, a, input')) return;
          void executeDrillCorporate(
            item.corporate_number,
            '検索結果一覧に戻る',
            `tr[data-corporate-number="${item.corporate_number}"] .corp-select-btn`,
          );
        });
      }
      tbody.appendChild(tr);
    }

    table.append(thead, tbody);
    tableWrap.appendChild(table);
    container.appendChild(tableWrap);

    if (canCallServerTools()) {
      const hintP = document.createElement('p');
      hintP.className = 'hint';
      hintP.textContent = '法人名または行を選択すると、法人番号で詳細カードを表示します。';
      container.appendChild(hintP);
    }

    if (vm.address_warning !== null) {
      const warnP = document.createElement('p');
      warnP.className = 'address-warning';
      const warnGlyph = document.createElement('span');
      warnGlyph.setAttribute('aria-hidden', 'true');
      warnGlyph.textContent = '▲ ';
      warnP.append(warnGlyph, document.createTextNode(vm.address_warning));
      container.appendChild(warnP);
    }

    if (state.pageHistory.length > 0 || vm.next_cursor !== null) {
      const nav = document.createElement('nav');
      nav.className = 'pagination-bar';
      nav.setAttribute('aria-label', '検索結果ページ送り');

      const prevBtn = document.createElement('button');
      prevBtn.type = 'button';
      prevBtn.id = 'prev-page';
      prevBtn.className = 'btn-secondary';
      prevBtn.textContent = '← 前のページ';
      prevBtn.disabled = state.pageHistory.length === 0;
      prevBtn.addEventListener('click', () => {
        const prev = state.pageHistory[state.pageHistory.length - 1];
        if (!prev) return;
        currentState = {
          kind: 'search-results',
          output: prev.output,
          queryContext: state.queryContext,
          pageHistory: state.pageHistory.slice(0, -1),
          filter: state.filter,
        };
        renderCurrentState(true);
      });

      const pageSpan = document.createElement('span');
      pageSpan.className = 'page-indicator tabular';
      pageSpan.textContent = `ページ ${state.pageHistory.length + 1}`;

      nav.append(prevBtn, pageSpan);

      if (vm.next_cursor !== null && state.queryContext !== null && canCallServerTools()) {
        const nextBtn = document.createElement('button');
        nextBtn.type = 'button';
        nextBtn.id = 'next-page';
        nextBtn.className = 'btn-primary';
        nextBtn.textContent = '次のページを表示 →';
        const cursorVal = vm.next_cursor;
        nextBtn.addEventListener('click', () => {
          void executeSearchPage(state, cursorVal);
        });
        nav.appendChild(nextBtn);
      } else {
        nav.appendChild(document.createElement('span'));
      }

      container.appendChild(nav);
    }

    const footer = createFooter(vm.attribution);
    if (footer !== null) {
      container.appendChild(footer);
    }

    return container;
  }

  function buildErrorElement(error: ToolErrorViewModel, focusHeading: boolean): HTMLElement {
    const panel = document.createElement('section');
    panel.className = 'error-panel';
    panel.setAttribute('role', 'alert');

    const header = document.createElement('div');
    header.className = 'error-header';

    const h1 = document.createElement('h1');
    h1.textContent = error.is_not_found ? '該当データなし' : '照会エラー';
    if (focusHeading) {
      h1.tabIndex = -1;
    }
    header.appendChild(h1);

    if (error.code !== null) {
      const codeSpan = document.createElement('code');
      codeSpan.className = 'error-code';
      codeSpan.textContent = error.code;
      header.appendChild(codeSpan);
    }

    const msgP = document.createElement('p');
    msgP.textContent = error.message;
    panel.append(header, msgP);

    if (lastToolCall !== null && canCallServerTools() && historyStack.length === 0) {
      const actions = document.createElement('div');
      actions.className = 'actions';
      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.id = 'retry-tool';
      retryBtn.className = 'btn-secondary';
      retryBtn.textContent = '再試行';
      const savedCall = lastToolCall;
      retryBtn.addEventListener('click', () => {
        void (async () => {
          const signal = nextAbortSignal();
          renderLoadingSkeleton('再試行しています...');
          try {
            const res = await app.callServerTool(savedCall, { signal });
            handleIncomingToolResult(res);
          } catch (err) {
            if (signal.aborted) return;
            currentState = {
              kind: 'error',
              error: {
                code: 'INTERNAL_ERROR',
                message: err instanceof Error ? err.message : '再試行に失敗しました。',
                is_data_unavailable: false,
                is_rate_limited: false,
                is_not_found: false,
                is_invalid_input: false,
              },
            };
            renderCurrentState(true);
          }
        })();
      });
      actions.appendChild(retryBtn);
      panel.appendChild(actions);
    }

    return panel;
  }

  function buildCancelledElement(reason: string | null): HTMLElement {
    const box = document.createElement('section');
    box.className = 'empty-state';
    box.setAttribute('role', 'status');

    const p = document.createElement('p');
    p.textContent = reason
      ? `ツールの実行がキャンセルされました（${reason}）。`
      : 'ツールの実行がキャンセルされました。';
    box.appendChild(p);
    return box;
  }

  function renderCurrentState(focusHeading: boolean): void {
    if (root === null || currentState === null) return;
    const nodes: Node[] = [];
    const topBar = createTopBar();
    if (topBar !== null) {
      nodes.push(topBar);
    }

    let mainView: HTMLElement;
    switch (currentState.kind) {
      case 'corporate-card':
        mainView = buildCorporateCardElement(currentState, focusHeading);
        break;
      case 'invoice-card':
        mainView = buildInvoiceCardElement(currentState, focusHeading);
        break;
      case 'search-results':
        mainView = buildSearchResultsElement(currentState, focusHeading);
        break;
      case 'error':
        mainView = buildErrorElement(currentState.error, focusHeading);
        break;
      case 'cancelled':
        mainView = buildCancelledElement(currentState.reason);
        break;
    }

    nodes.push(mainView);
    root.replaceChildren(...nodes);

    if (focusHeading) {
      const heading = mainView.querySelector<HTMLElement>('h1[tabindex="-1"]');
      heading?.focus();
    }
  }

  function inferToolNameFromArgs(args: Record<string, unknown>): string {
    if (typeof args['registration_number'] === 'string') return 'lookup_invoice_issuer';
    if (typeof args['corporate_number'] === 'string') return 'lookup_corporate_by_number';
    if (typeof args['name'] === 'string') return 'search_corporate_by_name';
    return options.defaultMode === 'search-results'
      ? 'search_corporate_by_name'
      : 'lookup_corporate_by_number';
  }

  function handleIncomingToolResult(params: {
    isError?: boolean;
    _meta?: Record<string, unknown>;
    structuredContent?: Record<string, unknown>;
    content?: Array<{ type?: string; text?: string }>;
  }): void {
    abortInFlight();
    hasReceivedResult = true;
    historyStack = [];

    const errVm = extractToolErrorViewModel(params);
    if (errVm !== null) {
      currentState = { kind: 'error', error: errVm };
      renderCurrentState(false);
      return;
    }

    const sc = (params.structuredContent ?? {}) as Record<string, unknown>;
    if (isInvoiceOutput(sc)) {
      const refDate =
        typeof lastToolCall?.arguments['reference_date'] === 'string' &&
        lastToolCall.arguments['reference_date'] !== ''
          ? lastToolCall.arguments['reference_date']
          : extractReferenceDateFromContent(params.content);
      currentState = {
        kind: 'invoice-card',
        output: sc,
        referenceDate: refDate,
      };
      renderCurrentState(false);
      return;
    }

    if (
      options.defaultMode === 'search-results' ||
      (Array.isArray(sc['results']) && sc['corporation'] === undefined)
    ) {
      const searchOut = sc as SearchCorporateOutput;
      const recoveredContext =
        initialSearchContext ??
        extractQueryContextFromCursor(searchOut.next_cursor) ??
        (() => {
          const fromText = extractSearchQueryFromContent(params.content);
          return fromText !== null ? { name: fromText } : null;
        })();
      currentState = {
        kind: 'search-results',
        output: searchOut,
        queryContext: recoveredContext,
        pageHistory: [],
        filter: 'all',
      };
      renderCurrentState(false);
      return;
    }

    currentState = {
      kind: 'corporate-card',
      output: sc as LookupCorporateOutput,
    };
    renderCurrentState(false);
  }

  app.addEventListener('toolinputpartial', (params) => {
    if (hasReceivedResult) return;
    const args = params.arguments ?? {};
    if (typeof args['registration_number'] === 'string') {
      renderLoadingSkeleton(`インボイス登録番号 ${args['registration_number']} を照会中...`);
    } else if (typeof args['corporate_number'] === 'string') {
      renderLoadingSkeleton(`法人番号 ${args['corporate_number']} を照会中...`);
    } else if (typeof args['name'] === 'string') {
      renderLoadingSkeleton(`商号「${args['name']}」を検索準備中...`);
    }
  });

  app.addEventListener('toolinput', (params) => {
    const args = params.arguments ?? {};
    const toolName = app.getHostContext()?.toolInfo?.tool.name ?? inferToolNameFromArgs(args);
    lastToolCall = { name: toolName, arguments: args };

    if (typeof args['name'] === 'string' && args['name'].trim() !== '') {
      initialSearchContext = {
        name: args['name'],
        prefecture: typeof args['prefecture'] === 'string' ? args['prefecture'] : undefined,
        limit: typeof args['limit'] === 'number' ? args['limit'] : undefined,
      };
    }

    if (!hasReceivedResult) {
      if (typeof args['registration_number'] === 'string') {
        renderLoadingSkeleton(
          `登録番号 ${args['registration_number']} の公表情報を取得しています...`,
        );
      } else if (typeof args['corporate_number'] === 'string') {
        renderLoadingSkeleton(`法人番号 ${args['corporate_number']} の公表情報を取得しています...`);
      } else if (typeof args['name'] === 'string') {
        renderLoadingSkeleton(`「${args['name']}」を検索しています...`);
      }
    }
  });

  app.addEventListener('toolresult', (params) => {
    handleIncomingToolResult(params);
  });

  app.addEventListener('toolcancelled', (params) => {
    abortInFlight();
    hasReceivedResult = true;
    historyStack = [];
    currentState = {
      kind: 'cancelled',
      reason: typeof params.reason === 'string' ? params.reason : null,
    };
    renderCurrentState(false);
  });

  app.addEventListener('hostcontextchanged', (ctx) => {
    applyHostContext(ctx);
  });

  app.onteardown = async () => {
    clearTimers();
    abortInFlight();
    return {};
  };

  await app.connect();
  applyHostContext(app.getHostContext());

  return app;
}
