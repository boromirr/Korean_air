import { chromium, type Browser, type Locator, type Page, type Response } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { CollectionError, SOURCE_URL, validateFutureMonth, validateRoute } from './collector.js';

export type HandoffCabin = 'economy' | 'premium' | 'prestige';
export interface HandoffSelection {
  origin: string;
  destination: string;
  month: string;
  returnMonth?: string;
  tripType: 'ONE_WAY' | 'ROUND_TRIP';
  cabin: HandoffCabin;
  outboundDate: string;
  returnDate?: string;
}

export type HandoffResult = {
  status: 'ready';
  stage: 'date_selected' | 'form_filled';
  selection: HandoffSelection;
  message: string;
} | { status: 'failed'; code: string; message: string; stage?: string };

const ALL_FILTERS = [
  '일반석 보너스', '프리미엄석 보너스', '프리미엄석 좌석승급',
  '프레스티지석 보너스', '프레스티지석 좌석승급', '일등석 보너스/좌석승급',
] as const;
const AWARD_LABELS: Record<HandoffCabin, string> = {
  economy: '일반석 보너스', premium: '프리미엄석 보너스', prestige: '프레스티지석 보너스',
};
const RESULT_DIALOG = '[role="dialog"][aria-labelledby="modals-travelCalendar-title"]';
const SECURITY_NOTICE = /access denied|접근이 차단|접속이 차단|비정상적인 접근|보안 문자|자동입력 방지|로봇이 아님|verify you are human|checking your browser|captcha/i;

function invalid(message: string): never {
  throw new CollectionError('INVALID_SELECTION', message);
}

function validDate(value: unknown, month: string, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/u.test(value)) {
    invalid(`${label}를 다시 선택하세요.`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value || !value.startsWith(`${month}-`)) {
    invalid(`${label}가 조회한 달에 포함되는지 확인하세요.`);
  }
  return value;
}

export function normalizeHandoffSelection(input: unknown, now = new Date()): HandoffSelection {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('선택한 여정을 확인할 수 없습니다.');
  const data = input as Record<string, unknown>;
  const origin = typeof data.origin === 'string' ? data.origin.trim().toUpperCase() : '';
  const destination = typeof data.destination === 'string' ? data.destination.trim().toUpperCase() : '';
  validateRoute(origin, destination);
  if (typeof data.month !== 'string') invalid('조회할 달을 선택하세요.');
  validateFutureMonth(data.month, now);
  if (data.tripType !== 'ONE_WAY' && data.tripType !== 'ROUND_TRIP') invalid('편도 또는 왕복을 선택하세요.');
  if (data.cabin !== 'economy' && data.cabin !== 'premium' && data.cabin !== 'prestige') invalid('좌석 등급을 다시 선택하세요.');
  const selection: HandoffSelection = {
    origin, destination, month: data.month, tripType: data.tripType, cabin: data.cabin,
    outboundDate: validDate(data.outboundDate, data.month, '가는 날'),
  };
  const hasReturnMonth = data.returnMonth !== undefined && data.returnMonth !== null && data.returnMonth !== '';
  const hasReturnDate = data.returnDate !== undefined && data.returnDate !== null && data.returnDate !== '';
  if (data.tripType === 'ONE_WAY') {
    if (hasReturnMonth || hasReturnDate) invalid('편도에서는 오는 날을 선택할 수 없습니다.');
    return selection;
  }
  if (typeof data.returnMonth !== 'string' || !hasReturnMonth) invalid('오는 달을 선택하세요.');
  validateFutureMonth(data.returnMonth, now);
  if (data.returnMonth < data.month) invalid('오는 달은 가는 달보다 빠를 수 없습니다.');
  selection.returnMonth = data.returnMonth;
  if (hasReturnDate) {
    selection.returnDate = validDate(data.returnDate, data.returnMonth, '오는 날');
    if (selection.returnDate < selection.outboundDate) invalid('오는 날은 가는 날보다 빠를 수 없습니다.');
  }
  return selection;
}

export function handoffSelectionPlan(selection: HandoffSelection) {
  return {
    tripSuffix: selection.tripType === 'ONE_WAY' ? 'OW' : 'RT',
    // Two deliberate month selections are required for a same-month round trip.
    months: [selection.month, ...(selection.returnMonth ? [selection.returnMonth] : [])],
    awardLabel: AWARD_LABELS[selection.cabin],
    outboundDay: Number(selection.outboundDate.slice(-2)),
    returnDay: selection.returnDate ? Number(selection.returnDate.slice(-2)) : null,
  };
}

export function restrictedFirstPartyResponse(url: string, status: number): boolean {
  try {
    const hostname = new URL(url).hostname;
    return (hostname === 'koreanair.com' || hostname.endsWith('.koreanair.com')) && [401, 403, 429].includes(status);
  } catch { return false; }
}

/** Stops every later UI operation when a first-party restriction is observed. */
export class HandoffAccessGuard {
  stage = 'page_open';
  private restriction: CollectionError | null = null;
  private rejectRestriction!: (error: CollectionError) => void;
  private readonly stopped: Promise<never>;
  private readonly onResponse: (response: Response) => void;

  constructor(private readonly page: Page) {
    this.stopped = new Promise<never>((_resolve, reject) => { this.rejectRestriction = reject; });
    // The rejection can occur between steps; always install a handler immediately.
    void this.stopped.catch(() => undefined);
    this.onResponse = (response) => {
      if (restrictedFirstPartyResponse(response.url(), response.status())) {
        this.stop(new CollectionError('ACCESS_RESTRICTED', `대한항공에서 접근을 제한했습니다(HTTP ${response.status()}). 자동 입력을 중단했습니다.`));
      }
    };
    page.on('response', this.onResponse);
  }

  private stop(error: CollectionError): void {
    if (this.restriction) return;
    this.restriction = error;
    this.rejectRestriction(error);
  }

  async check(): Promise<void> {
    if (this.restriction) throw this.restriction;
    const text = await Promise.race([
      this.page.locator('body').innerText({ timeout: 3_000 }).catch(() => ''), this.stopped,
    ]);
    if (SECURITY_NOTICE.test(text)) {
      this.stop(new CollectionError('USER_ACTION_REQUIRED', '대한항공의 보안 확인 화면이 나타나 자동 입력을 중단했습니다.'));
    }
    if (this.restriction) throw this.restriction;
  }

  async step<T>(operation: () => Promise<T>): Promise<T> {
    await this.check();
    const result = await Promise.race([operation(), this.stopped]);
    await this.check();
    return result;
  }

  dispose(): void { this.page.off('response', this.onResponse); }
}

function koreanDatePattern(value: string): RegExp {
  const [year, month, day] = value.split('-');
  return new RegExp(`${year}년\\s*0?${Number(month)}월\\s*0?${Number(day)}일`, 'u');
}

async function fillPublicForm(page: Page, selection: HandoffSelection, guard: HandoffAccessGuard): Promise<void> {
  const plan = handoffSelectionPlan(selection);
  await guard.step(() => page.goto(SOURCE_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 }));
  await guard.step(() => page.locator('#bonusTripTypeLabel_OW').waitFor({ state: 'attached', timeout: 30_000 }));
  guard.stage = 'cookie_consent';
  const consent = page.getByRole('button', { name: '필수 쿠키만 허용', exact: true });
  const consentVisible = await guard.step(() => consent.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false));
  if (consentVisible) await guard.step(() => consent.click());
  guard.stage = 'trip_type';
  await guard.step(() => page.locator(`#bonusTripTypeLabel_${plan.tripSuffix}`).click());
  if (!(await guard.step(() => page.locator(`#bonusTripType_${plan.tripSuffix}`).isChecked()))) {
    throw new CollectionError('STRUCTURE_CHANGED', '대한항공 화면에서 편도·왕복 선택을 확인하지 못했습니다.');
  }
  for (const [button, field, code] of [
    ['From 출발지', '출발지 검색', selection.origin], ['To 도착지', '도착지 검색', selection.destination],
  ] as const) {
    guard.stage = button === 'From 출발지' ? 'origin_search' : 'destination_search';
    await guard.step(() => page.getByRole('button', { name: button, exact: true }).click());
    const input = page.getByRole('combobox', { name: field, exact: true });
    await guard.step(() => input.waitFor({ state: 'visible' }));
    // A click waits for the newly opened field to be enabled and receives focus;
    // typing before this dialog finishes opening can lose the first key event.
    await guard.step(() => input.click());
    await guard.step(() => input.fill(''));
    // Real key events are required by the observed airport autocomplete control.
    await guard.step(() => input.pressSequentially(code, { delay: 60 }));
    if (await guard.step(() => input.inputValue()) !== code) {
      throw new CollectionError('FORM_FAILED', '공항 코드가 입력되지 않았습니다. 열린 대한항공 창에서 확인하세요.');
    }
    guard.stage = button === 'From 출발지' ? 'origin_select' : 'destination_select';
    await guard.step(() => page.getByRole('option', { name: new RegExp(`^${code}\\b`, 'u') }).click());
  }
  guard.stage = 'month_open';
  await guard.step(() => page.locator('#seatCalendarBtn').click());
  for (const [index, month] of plan.months.entries()) {
    guard.stage = index === 0 ? 'outbound_month' : 'return_month';
    const [year, number] = month.split('-');
    // On a same-month round trip the first selection changes this button's
    // accessible name to “선택됨 ,가는 달, 11월”; the second click sets the return.
    const name = index === 1 && month === plan.months[0]
      ? new RegExp(`^선택됨\\s*,\\s*가는 달,\\s*${Number(number)}월$`, 'u')
      : `${Number(number)}월`;
    await guard.step(() => page.getByRole('group', { name: year, exact: true })
      .getByRole('button', { name, exact: true }).click());
  }
  guard.stage = 'month_confirm';
  await guard.step(() => page.getByRole('button', { name: '선택', exact: true }).click());
}

async function filterAwards(page: Page, panel: Locator, selection: HandoffSelection, guard: HandoffAccessGuard): Promise<void> {
  const direction = guard.stage.startsWith('return') ? 'return' : 'outbound';
  guard.stage = `${direction}_filter_open`;
  await guard.step(() => panel.locator('#bonusFilterBtn').click());
  const filter = page.getByRole('dialog', { name: '보너스 좌석 필터', exact: true });
  if (await guard.step(() => filter.getByRole('checkbox').count()) !== ALL_FILTERS.length) {
    throw new CollectionError('STRUCTURE_CHANGED', '대한항공의 좌석 등급 필터를 확인하지 못했습니다.');
  }
  const desired = AWARD_LABELS[selection.cabin];
  guard.stage = `${direction}_filter_select`;
  // Preserve one award type; upgrades are never treated as mileage award seats.
  for (const name of [desired, ...ALL_FILTERS.filter((name) => name !== desired)]) {
    const checkbox = filter.getByRole('checkbox', { name, exact: true });
    const checked = await guard.step(() => checkbox.isChecked());
    if (checked !== (name === desired)) {
      const id = await guard.step(() => checkbox.getAttribute('id'));
      if (!id || !/^[A-Za-z][\w:-]*$/u.test(id)) {
        throw new CollectionError('STRUCTURE_CHANGED', '대한항공의 좌석 등급 선택 항목을 확인하지 못했습니다.');
      }
      // The visual labels cover the native checkboxes in the observed UI.
      await guard.step(() => filter.locator(`label[for="${id}"]`).click());
      if (await guard.step(() => checkbox.isChecked()) !== (name === desired)) {
        throw new CollectionError('STRUCTURE_CHANGED', '대한항공 화면에 좌석 등급을 적용하지 못했습니다.');
      }
    }
  }
  guard.stage = `${direction}_filter_apply`;
  const apply = filter.getByRole('button', { name: '선택 완료', exact: true });
  // Mobile exposes a confirmation button; desktop uses the observed close button.
  if (await guard.step(() => apply.isVisible())) await guard.step(() => apply.click());
  else await guard.step(() => filter.getByRole('button', { name: '닫기', exact: true }).click());
  const labels = await guard.step(() => panel.locator('.bonus-calendar__icons li').allTextContents());
  if (labels.some((text) => text.trim() !== desired)) {
    throw new CollectionError('FILTER_FAILED', '대한항공 달력에 선택한 좌석 등급을 적용하지 못했습니다.');
  }
}

async function verifyPanelMonth(panel: Locator, month: string, guard: HandoffAccessGuard): Promise<void> {
  await guard.step(() => panel.locator('#bonusCalendarTableWrapEl tbody td[id^="day_"]').first().waitFor({ timeout: 30_000 }));
  const [year, number] = month.split('-');
  const displayedMonth = await guard.step(() => panel.locator('#travelCalendarListBtn').innerText());
  if (displayedMonth.replace(/\s+/gu, ' ').trim() !== `${year}년 ${Number(number)}월`) {
    throw new CollectionError('STRUCTURE_CHANGED', '대한항공 달력의 월이 선택한 달과 다릅니다.');
  }
}

async function selectPublicDate(page: Page, dialog: Locator, panel: Locator, date: string, guard: HandoffAccessGuard): Promise<void> {
  const direction = guard.stage.startsWith('return') ? 'return' : 'outbound';
  guard.stage = `${direction}_date_click`;
  await guard.step(() => panel.locator(`#day_${Number(date.slice(-2))}`).click());
  const datePattern = koreanDatePattern(date);
  const selectedDate = dialog.locator('#travelCalendarBottom').filter({ hasText: datePattern });
  guard.stage = `${direction}_date_detail`;
  // A first round-trip departure can immediately switch to the return tab,
  // removing the departure detail panel while preserving the confirmed date.
  await guard.step(() => Promise.race([
    selectedDate.waitFor({ state: 'visible', timeout: 5_000 }),
    page.locator('#seatScroll:visible').filter({ hasText: datePattern }).waitFor({ state: 'visible', timeout: 5_000 }),
  ]));
  if (await guard.step(() => selectedDate.isVisible())) return;
  const confirm = page.getByRole('button', { name: '해당 날짜 선택', exact: true });
  // Mobile opens a date-detail dialog that needs confirmation. Desktop applies
  // the selection directly and hides this same button in its side panel.
  guard.stage = `${direction}_date_confirm`;
  if (await guard.step(() => confirm.isVisible())) await guard.step(() => confirm.click());
  guard.stage = `${direction}_date_verify`;
  await guard.step(() => selectedDate.waitFor({ state: 'visible', timeout: 5_000 }));
}

async function selectCalendarDates(page: Page, selection: HandoffSelection, guard: HandoffAccessGuard): Promise<void> {
  guard.stage = 'calendar_search';
  await guard.step(() => page.getByRole('button', { name: '조회', exact: true }).click());
  const dialog = page.locator(RESULT_DIALOG);
  await guard.step(() => dialog.waitFor({ state: 'visible', timeout: 30_000 }));
  guard.stage = 'calendar_route';
  const title = await guard.step(() => dialog.locator('#modals-travelCalendar-title').innerText());
  const airportCodes = title.match(/\b[A-Z]{3}\b/gu);
  if (!airportCodes || airportCodes[0] !== selection.origin || airportCodes[1] !== selection.destination) {
    throw new CollectionError('STRUCTURE_CHANGED', '대한항공 달력의 출발·도착 공항이 선택한 노선과 다릅니다.');
  }
  const outboundPanel = selection.tripType === 'ROUND_TRIP'
    ? dialog.getByRole('tabpanel', { name: '가는 날', exact: true }) : dialog;
  guard.stage = 'outbound_month_verify';
  await verifyPanelMonth(outboundPanel, selection.month, guard);
  await filterAwards(page, outboundPanel, selection, guard);
  await selectPublicDate(page, dialog, outboundPanel, selection.outboundDate, guard);
  if (selection.tripType === 'ROUND_TRIP' && selection.returnDate && selection.returnMonth) {
    // The initial departure can advance automatically; revisiting a selected
    // itinerary can keep the departure tab active, so inspect the actual tab.
    const inboundTab = dialog.getByRole('tab', { name: '오는 날', exact: true });
    guard.stage = 'return_tab';
    if (await guard.step(() => inboundTab.getAttribute('aria-selected')) !== 'true') {
      await guard.step(() => inboundTab.click());
    }
    const inboundPanel = dialog.getByRole('tabpanel', { name: '오는 날', exact: true });
    guard.stage = 'return_month_verify';
    await verifyPanelMonth(inboundPanel, selection.returnMonth, guard);
    // Filters are separate for each direction in the observed round-trip UI.
    await filterAwards(page, inboundPanel, selection, guard);
    await selectPublicDate(page, dialog, inboundPanel, selection.returnDate, guard);
  }
  guard.stage = 'selection_verify';
  const selectedDates = await guard.step(() => dialog.locator('#travelCalendarBottom').innerText());
  if (!koreanDatePattern(selection.outboundDate).test(selectedDates)
      || (selection.returnDate && !koreanDatePattern(selection.returnDate).test(selectedDates))) {
    throw new CollectionError('DATE_NOT_SELECTED', '대한항공 달력에서 선택한 날짜를 확인하지 못했습니다. 열린 창에서 확인하세요.');
  }
}

export function sanitizedHandoffFailure(error: unknown, stage?: string): Extract<HandoffResult, { status: 'failed' }> {
  const code = stage?.includes('filter') ? 'FILTER_FAILED'
    : stage?.includes('date') || stage === 'selection_verify' ? 'DATE_NOT_SELECTED'
    : stage === 'browser_open' ? 'BROWSER_OPEN_FAILED'
    : stage ? 'FORM_FAILED' : 'HANDOFF_FAILED';
  const diagnosticStage = stage ? { stage } : {};
  return error instanceof CollectionError
    ? { status: 'failed', code: error.code, message: error.message, ...diagnosticStage }
    : { status: 'failed', code, message: code === 'FILTER_FAILED' ? '대한항공 화면에 좌석 등급을 적용하지 못했습니다.'
      : code === 'DATE_NOT_SELECTED' ? '대한항공 달력에서 선택한 날짜를 확인하지 못했습니다.'
      : '대한항공 화면에 자동 입력을 완료하지 못했습니다. 열린 창에서 입력 내용을 확인하세요.', ...diagnosticStage };
}

/** Fixed-path, public-element diagnostics only; no document HTML or browser errors. */
async function saveFailureEvidence(page: Page, selection: HandoffSelection, failure: Extract<HandoffResult, { status: 'failed' }>): Promise<void> {
  if (failure.code === 'ACCESS_RESTRICTED' || failure.code === 'USER_ACTION_REQUIRED' || page.isClosed()) return;
  const url = new URL(page.url());
  if (url.origin !== new URL(SOURCE_URL).origin || url.pathname !== new URL(SOURCE_URL).pathname) return;
  // A person may have started using the window; never record logged-in pages.
  const logout = page.getByRole('link', { name: '로그아웃', exact: true }).or(page.getByRole('button', { name: '로그아웃', exact: true }));
  if (await logout.count()) return;
  const folder = fileURLToPath(new URL('../artifacts/airline-handoff/', import.meta.url));
  await mkdir(folder, { recursive: true });
  const visibleTexts: Record<string, string[]> = {};
  for (const selector of ['#seatCalendarBtn', '#modals-travelCalendar-title', '#travelCalendarListBtn', '#travelCalendarBottom', '#seatScroll']) {
    const nodes = page.locator(`${selector}:visible`);
    visibleTexts[selector] = (await nodes.allTextContents()).map((text) => text.replace(/\s+/gu, ' ').trim().slice(0, 500));
  }
  const filter = page.getByRole('dialog', { name: '보너스 좌석 필터', exact: true });
  const filters: { name: string; checked: boolean }[] = [];
  if (await filter.isVisible()) {
    for (const name of ALL_FILTERS) {
      const checkbox = filter.getByRole('checkbox', { name, exact: true });
      if (await checkbox.count() === 1) filters.push({ name, checked: await checkbox.isChecked() });
    }
  }
  let airport: { name: string; value: string; options: string[] } | undefined;
  let airportDialog: Locator | undefined;
  if (/^(origin|destination)_(search|select)$/u.test(failure.stage ?? '')) {
    const name = failure.stage?.startsWith('origin') ? '출발지 검색' : '도착지 검색';
    const dialog = page.getByRole('dialog', { name, exact: true });
    const input = page.getByRole('combobox', { name, exact: true });
    if (await dialog.isVisible()) {
      const value = await input.inputValue();
      if (/^[A-Z]{0,3}$/u.test(value)) airportDialog = dialog;
      airport = {
        name,
        // Only a public three-letter airport query belongs in these diagnostics.
        value: /^[A-Z]{0,3}$/u.test(value) ? value : '[공항 코드 외 입력 생략]',
        options: (await dialog.getByRole('option').allTextContents())
          .map((text) => text.replace(/\s+/gu, ' ').trim()).filter((text) => /^[A-Z]{3}\b/u.test(text)).slice(0, 20),
      };
    }
  }
  await writeFile(`${folder}/last-failure.json`, JSON.stringify({
    recordedAt: new Date().toISOString(), failure, selection, visibleTexts, filters, airport,
  }, null, 2), { mode: 0o600 });
  // Crop to the public calendar or public search form so account headers are excluded.
  const calendar = page.locator(RESULT_DIALOG);
  const area = airportDialog ?? (await calendar.isVisible() ? calendar : page.getByRole('main'));
  if (await area.count() === 1 && await area.isVisible()) {
    await area.screenshot({ path: `${folder}/last-failure.png`, timeout: 5_000 });
  }
}

async function keepWindowOpen(browser: Browser, page: Page): Promise<void> {
  if (!browser.isConnected()) return;
  if (page.isClosed()) { await browser.close(); return; }
  await new Promise<void>((resolve) => {
    browser.once('disconnected', () => resolve());
    page.once('close', () => { void browser.close().catch(() => undefined).finally(resolve); });
  });
}

/** One user-requested public form handoff; never enters login or booking pages. */
export async function openAirlineHandoff(input: unknown, report: (result: HandoffResult) => void): Promise<void> {
  let browser: Browser | undefined;
  let page: Page | undefined;
  let guard: HandoffAccessGuard | undefined;
  let selection: HandoffSelection | undefined;
  let initialStage = 'input_validation';
  try {
    selection = normalizeHandoffSelection(input);
    initialStage = 'browser_open';
    browser = await chromium.launch({ channel: 'chrome', headless: false });
    const context = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', viewport: { width: 1440, height: 1100 } });
    page = await context.newPage();
    page.setDefaultTimeout(15_000);
    guard = new HandoffAccessGuard(page);
    await fillPublicForm(page, selection, guard);
    if (selection.tripType === 'ONE_WAY' || selection.returnDate) {
      await selectCalendarDates(page, selection, guard);
      report({ status: 'ready', stage: 'date_selected', selection, message: '대한항공 새 창에 선택한 노선·날짜·좌석 등급을 입력했습니다.' });
    } else {
      report({ status: 'ready', stage: 'form_filled', selection, message: '대한항공 새 창에 왕복 노선과 가는 달·오는 달을 입력했습니다. 날짜와 좌석 등급은 열린 창에서 선택하세요.' });
    }
  } catch (error) {
    // A late restriction takes priority over a simultaneous locator timeout.
    try { await guard?.check(); } catch (restriction) { error = restriction; }
    const failure = sanitizedHandoffFailure(error, guard?.stage ?? initialStage);
    if (page && selection) await saveFailureEvidence(page, selection, failure).catch(() => undefined);
    report(failure);
  } finally {
    guard?.dispose();
  }
  // Once handed over, no further automation runs. The user controls this window.
  if (browser && page) await keepWindowOpen(browser, page);
  else if (browser) await browser.close();
}
