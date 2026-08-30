/**
 * Lịch tháng — mức độ hoàn thành từng ngày (FR-SET-08).
 */

import { setMain, pageShell, globalBanners } from '../ui/layout.js';
import { loadingBlock } from '../ui/components.js';
import { escapeHtml, todayKey, parseDateKey, monthKey } from '../core/util.js';
import { isMember, isAdmin } from '../core/auth.js';
import { getDailySetsInRange, getProgress, getPersonal, getConfig } from '../domain/service.js';
import { scoreOfSet } from '../domain/rules.js';
import { navigate } from '../core/router.js';

const DOW = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

export async function render({ query }) {
  setMain(pageShell(loadingBlock()));

  const today = todayKey();
  const ym = query.m || monthKey();
  const [y, m] = ym.split('-').map(Number);

  const first = new Date(y, m - 1, 1);
  const daysInMonth = new Date(y, m, 0).getDate();
  const dateKeys = Array.from({ length: daysInMonth },
    (_, i) => `${y}-${String(m).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`);

  const [config, officialSets, progress, personal] = await Promise.all([
    getConfig(),
    getDailySetsInRange(dateKeys),
    isMember() ? getProgress() : Promise.resolve({ items: [] }),
    isMember() ? getPersonal() : Promise.resolve({ sets: [] }),
  ]);

  const personalByDate = new Map((personal.sets || []).map(s => [s.date, s]));

  const leadingBlanks = first.getDay();
  const cells = [];
  for (let i = 0; i < leadingBlanks; i++) cells.push('<div class="cal-cell is-empty"></div>');

  for (const key of dateKeys) {
    const official = officialSets.get(key);
    const own = personalByDate.get(key);
    const set = official ?? own;
    const day = Number(key.slice(-2));

    let mini = '';
    if (set) {
      const score = scoreOfSet(set, progress, config);
      mini = `<div class="cal-mini" title="${score.done}/${score.total} bài hoàn thành">
        ${(set.slots || []).map(s => {
          if (!s.problemId) return '<i></i>';
          const st = (progress.items || []).find(i => i.problemId === s.problemId)?.status;
          const cls = st === 'COMPLETED' ? 'done' : st === 'HARD_STUCK' ? 'stuck' : st === 'IN_PROGRESS' ? 'prog' : '';
          return `<i class="${cls}"></i>`;
        }).join('')}
      </div>`;
    }

    const marks = [
      official ? '<span class="tiny" title="Có bộ đề chính thức">●</span>' : '',
      own ? '<span class="tiny" title="Có bộ đề cá nhân">◇</span>' : '',
    ].join('');

    cells.push(`<a class="cal-cell${key === today ? ' is-today' : ''}" href="#/sets/${key}">
      <div class="row-tight"><span class="cal-num">${day}</span><span class="spacer"></span>${marks}</div>
      ${mini}
    </a>`);
  }

  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;

  setMain(pageShell(`
    ${globalBanners()}
    <div class="row" style="margin-bottom:1rem">
      <h1 style="margin:0">Tháng ${m}/${y}</h1>
      <span class="spacer"></span>
      <a class="btn btn-sm" href="#/calendar?m=${prev}">← Tháng trước</a>
      <a class="btn btn-sm" href="#/calendar?m=${monthKey()}">Hôm nay</a>
      <a class="btn btn-sm" href="#/calendar?m=${next}">Tháng sau →</a>
    </div>

    <div class="card card-pad">
      <div class="cal-grid" style="margin-bottom:.3rem">
        ${DOW.map(d => `<div class="cal-dow">${d}</div>`).join('')}
      </div>
      <div class="cal-grid">${cells.join('')}</div>
    </div>

    <div class="card card-pad" style="margin-top:1rem">
      <div class="row small muted">
        <span>● có bộ đề chính thức</span>
        <span>◇ có bộ đề cá nhân</span>
        <span class="row-tight"><i style="display:inline-block;width:16px;height:4px;border-radius:2px;background:var(--ok)"></i> hoàn thành</span>
        <span class="row-tight"><i style="display:inline-block;width:16px;height:4px;border-radius:2px;background:var(--info)"></i> đang làm</span>
        <span class="row-tight"><i style="display:inline-block;width:16px;height:4px;border-radius:2px;background:var(--warn)"></i> hard stuck</span>
      </div>
    </div>
  `));
}
