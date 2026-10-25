/**
 * Counselling helper (NEET PG, All India counselling by MCC). The weekly job in the
 * mochi-releases repo reads each round's "Final Allotment Result" PDF (as text from
 * `pdftotext -raw`), works out the closing rank for every institute + course + quota +
 * seat category, and publishes it; the apps download it and show, for a rank and
 * category, where students with that rank got seats. Pure: no I/O.
 */

/** MCC quotas as printed in the allotment PDFs. */
export const MCC_QUOTAS = [
  'All India',
  'DNB Quota',
  'Self-Financed Merit Seat',
  'Delhi University Quota',
  'IP University Quota',
  'Non-Resident Indian',
  'Aligarh Muslim University',
  'Banaras Hindu University',
  'Jain Minority Quota',
  'Muslim Minority Quota',
] as const;

export type SeatCategory = 'Open' | 'OBC' | 'EWS' | 'SC' | 'ST';
export const SEAT_CATEGORIES: readonly SeatCategory[] = ['Open', 'OBC', 'EWS', 'SC', 'ST'];

export interface AllotmentRow {
  rank: number;
  quota: string;
  institute: string;
  course: string;
  /** The seat's category (an Open seat can go to anyone). */
  seat: SeatCategory;
  pwd: boolean;
  remark: string;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const QUOTA_RE = MCC_QUOTAS.map(esc).join('|');
// Category words as printed: seat categories use Open/BC/EWS/SC/ST, candidate ones General/OBC/EWS/SC/ST.
const CAT = '(?:Open|GN|General|BC|OBC|EW|EWS|SC|ST)(?: PwD)?';
const COURSE_START = /\b(M\.D\.|M\.S\.|DNB\b|Diploma\b|DIPLOMA\b|PG Diploma\b|D\.N\.B\b|DrNB\b|M\.Ch\b|MDS\b|Dip\.)|Dermatology, Venereology and Leprosy \(D\.D\.V\.L\.\)/;

const seatCategory = (s: string): SeatCategory | null => {
  const k = s.replace(/ PwD$/, '');
  if (k === 'Open' || k === 'GN' || k === 'General') return 'Open';
  if (k === 'BC' || k === 'OBC') return 'OBC';
  if (k === 'EW' || k === 'EWS') return 'EWS';
  if (k === 'SC' || k === 'ST') return k;
  return null;
};

const SMALL = new Set(['and', 'of', 'the', 'in', 'with', 'for']);
const titleCase = (s: string) =>
  s
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\b([a-z])([a-z]*)/g, (w, a: string, b: string) => (SMALL.has(w) ? w : a.toUpperCase() + b))
    .replace(/^([a-z])/, (a) => a.toUpperCase());

/** "Name, City,ADDRESS…" → "Name, City" (the address starts after a comma with no space). */
export function instituteName(s: string): string {
  const t = s.replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim();
  const m = t.match(/^(.*?[^,]),(?=\S)/);
  // Drop a trailing PIN code ("New Delhi, Delhi-110060" → "New Delhi, Delhi").
  const name = (m ? m[1]! : t).trim().replace(/[\s-]*\d{6}$/, '').trim();
  return name.length > 140 ? `${name.slice(0, 140)}…` : name;
}

/** Tidy a course name: "M.D. Radio-Diagnosis /Radiology" → "M.D. Radio-Diagnosis/Radiology". */
export const courseName = (s: string) => s.replace(/\s+/g, ' ').replace(/\s*\/\s*/g, '/').replace(/\s*,\s*/g, ', ').trim();

/** Every allotted seat in one round's result (text from `pdftotext -raw`). Rows without a seat are skipped. */
export function parseAllotment(raw: string): AllotmentRow[] {
  const text = raw
    .replace(/NEET-PG Counselling Seats Allotment\s*-\s*\d{4}\s*Round-\s*\S+/gi, ' ')
    .replace(/SNo Rank Allotted Quota Allotted Institute Course Alloted\s+Category\s+Candidate\s+Category\s+Remarks/gi, ' ')
    .replace(/Page No\.\s*\d+/gi, ' ')
    .replace(/\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2} [AP]M/g, ' ')
    .replace(/\s+/g, ' ');
  const start = new RegExp(`(?:^| )(\\d+) (\\d+) (${QUOTA_RE}) `, 'g');
  const starts: { at: number; end: number; rank: number; quota: string }[] = [];
  for (const m of text.matchAll(start)) starts.push({ at: m.index!, end: m.index! + m[0].length, rank: Number(m[2]), quota: m[3]! });
  const tail = new RegExp(`^(.*?) (${CAT}) (${CAT}) (.*)$`);
  const rows: AllotmentRow[] = [];
  starts.forEach((s, i) => {
    const body = text.slice(s.end, i + 1 < starts.length ? starts[i + 1]!.at : text.length).trim();
    const m = body.match(tail);
    if (!m) return;
    const [, middle, seatRaw, , remark] = m;
    const seat = seatCategory(seatRaw!);
    if (!seat) return;
    // DNB seats: "<hospital, address> (NBEMS) GENERAL MEDICINE" — the course follows "(NBEMS)" in capitals.
    const nbems = middle!.lastIndexOf('(NBEMS)');
    const c = nbems > 0 ? nbems : middle!.search(COURSE_START);
    if (c <= 0) return;
    const institute = instituteName(middle!.slice(0, c));
    const course = nbems > 0 ? `DNB ${titleCase(middle!.slice(nbems + 7))}` : courseName(middle!.slice(c));
    if (!institute || !course) return;
    rows.push({ rank: s.rank, quota: s.quota, institute, course, seat, pwd: / PwD$/.test(seatRaw!), remark: remark!.trim() });
  });
  return rows;
}

/** One line of the published data: the closing (highest allotted) rank for a seat type in a round. */
export interface ClosingRank {
  institute: number; // index into CounsellingYear.institutes
  course: number; // index into courses
  quota: number; // index into MCC_QUOTAS-like quotas list
  seat: SeatCategory;
  pwd: boolean;
  round: string; // "1", "2", "3", "Stray"
  closing: number;
  opening: number;
  seats: number;
}

export interface CounsellingYear {
  year: number;
  /** Rounds included, with the official file each came from. */
  rounds: { round: string; title: string; url: string; publishedOn: string; rows: number }[];
  institutes: string[];
  courses: string[];
  quotas: string[];
  /** [institute, course, quota, seat, pwd(0/1), round, closing, opening, seats] — compact for download. */
  closing: [number, number, number, SeatCategory, 0 | 1, string, number, number, number][];
}

export function emptyYear(year: number): CounsellingYear {
  return { year, rounds: [], institutes: [], courses: [], quotas: [], closing: [] };
}

/** Add one round's rows to a year's data (replacing that round if it was there). */
export function addRound(data: CounsellingYear, round: { round: string; title: string; url: string; publishedOn: string }, rows: AllotmentRow[]): CounsellingYear {
  const out: CounsellingYear = {
    ...data,
    institutes: [...data.institutes],
    courses: [...data.courses],
    quotas: [...data.quotas],
    closing: data.closing.filter((c) => c[5] !== round.round),
    rounds: [...data.rounds.filter((r) => r.round !== round.round), { ...round, rows: rows.length }].sort((a, b) => roundOrder(a.round) - roundOrder(b.round)),
  };
  const idx = (list: string[], v: string) => {
    let i = list.indexOf(v);
    if (i < 0) i = list.push(v) - 1;
    return i;
  };
  const groups = new Map<string, { inst: number; course: number; quota: number; seat: SeatCategory; pwd: boolean; ranks: number[] }>();
  for (const r of rows) {
    const inst = idx(out.institutes, r.institute);
    const course = idx(out.courses, r.course);
    const quota = idx(out.quotas, r.quota);
    const key = `${inst}|${course}|${quota}|${r.seat}|${r.pwd ? 1 : 0}`;
    const g = groups.get(key) ?? { inst, course, quota, seat: r.seat, pwd: r.pwd, ranks: [] };
    g.ranks.push(r.rank);
    groups.set(key, g);
  }
  for (const g of groups.values()) {
    out.closing.push([g.inst, g.course, g.quota, g.seat, g.pwd ? 1 : 0, round.round, Math.max(...g.ranks), Math.min(...g.ranks), g.ranks.length]);
  }
  return out;
}

/** "1" < "2" < "3" < "Stray" / "Mop-up" (later rounds close at higher ranks). */
export function roundOrder(r: string): number {
  const n = Number(r);
  return Number.isFinite(n) ? n : /mop/i.test(r) ? 4 : 5;
}

/**
 * Which counselling a result file belongs to, from its link title (and the upload date in its
 * address as a fallback):
 *   "Final Allotment Result for PG Counselling Round 1 dated 24.10.2026" → 2026, round "1"
 *   "Final Allotment Result for Round 3 of PG Counselling 2024" (uploaded 2025/01) → 2024, round "3"
 * Provisional results, notices and lists aren't final allotments: null.
 */
export function parseResultTitle(title: string, url = ''): { round: string; publishedOn: string; year: number } | null {
  const t = title.replace(/\s+/g, ' ');
  if (!/final allotment result/i.test(t) || !/\bPG\b/i.test(t) || /provisional|notice|revised|nri|list of|special stray/i.test(t)) return null;
  const round = t.match(/round[\s-]*(\d+)/i)?.[1] ?? (/stray/i.test(t) ? 'Stray' : /mop/i.test(t) ? 'Mop-up' : null);
  if (!round) return null;
  const d = t.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  const up = url.match(/uploads\/(\d{4})\/(\d{2})\//);
  const publishedOn = d ? `${d[3]}-${d[2]!.padStart(2, '0')}-${d[1]!.padStart(2, '0')}` : up ? `${up[1]}-${up[2]}-01` : '';
  if (!publishedOn) return null;
  // The counselling year: as written ("PG Counselling 2024", "PG 2021"), else from the date —
  // counselling runs from about August to the next spring, so January–May belongs to the year before.
  const named = t.match(/(?:counselling|\bPG)\s*(?:-\s*)?(20\d{2})/i)?.[1];
  const y = Number(publishedOn.slice(0, 4));
  const m = Number(publishedOn.slice(5, 7));
  return { round, publishedOn, year: named ? Number(named) : m <= 5 ? y - 1 : y };
}

// --- In the app: where can this rank get a seat? -------------------------------------------

export type Chance = 'safe' | 'possible' | 'reach';

export interface SeatOption {
  institute: string;
  course: string;
  quota: string;
  seat: SeatCategory;
  /** Closing rank in the latest round we have for that year, and in round 1. */
  closing: number;
  round: string;
  round1Closing: number | null;
  year: number;
  chance: Chance;
}

/**
 * Seats a candidate could have got: Open seats plus seats of their own category (PwD seats only
 * for PwD candidates), where their rank is within (or near) the closing rank. "safe" = rank at or
 * below 90% of the closing rank, "possible" = up to the closing rank, "reach" = up to 25% past it.
 */
export function seatOptions(
  data: CounsellingYear,
  q: { rank: number; category: SeatCategory; pwd: boolean; quotas?: string[]; course?: string; institute?: string },
): SeatOption[] {
  if (!(q.rank > 0)) return [];
  const want = (c: SeatCategory) => c === 'Open' || c === q.category;
  const courseQ = q.course?.trim().toLowerCase() ?? '';
  const instQ = q.institute?.trim().toLowerCase() ?? '';
  // Per seat type, the latest round's closing rank (and round 1's).
  const best = new Map<string, { row: CounsellingYear['closing'][number]; r1: number | null }>();
  for (const row of data.closing) {
    const [inst, course, quota, seat, pwd, round, closing] = row;
    if (!want(seat) || (pwd === 1 && !q.pwd)) continue;
    if (q.quotas?.length && !q.quotas.includes(data.quotas[quota]!)) continue;
    if (courseQ && !data.courses[course]!.toLowerCase().includes(courseQ)) continue;
    if (instQ && !data.institutes[inst]!.toLowerCase().includes(instQ)) continue;
    const key = `${inst}|${course}|${quota}|${seat}|${pwd}`;
    const e = best.get(key) ?? { row, r1: null };
    if (round === '1') e.r1 = closing;
    if (roundOrder(round) >= roundOrder(e.row[5])) e.row = row;
    best.set(key, e);
  }
  const out: SeatOption[] = [];
  for (const { row, r1 } of best.values()) {
    const [inst, course, quota, seat, , round, closing] = row;
    const chance: Chance | null = q.rank <= closing * 0.9 ? 'safe' : q.rank <= closing ? 'possible' : q.rank <= closing * 1.25 ? 'reach' : null;
    if (!chance) continue;
    out.push({ institute: data.institutes[inst]!, course: data.courses[course]!, quota: data.quotas[quota]!, seat, closing, round, round1Closing: r1, year: data.year, chance });
  }
  // Keep one entry per institute + course + quota (the better of Open / own category), hardest-to-get first.
  const byPlace = new Map<string, SeatOption>();
  for (const o of out) {
    const k = `${o.institute}|${o.course}|${o.quota}`;
    const prev = byPlace.get(k);
    if (!prev || o.closing > prev.closing) byPlace.set(k, o);
  }
  return [...byPlace.values()].sort((a, b) => a.closing - b.closing);
}
