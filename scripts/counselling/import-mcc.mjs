// NEET PG counselling data for Mochi's counselling helper.
//
//   node import-mcc.mjs <dataDir> <pdf or folder of PDFs>...
//
// Reads MCC "Final Allotment Result" PDFs (downloaded from mcc.nic.in → PG Medical Counselling),
// turns each into text (`pdftotext -raw`, from poppler / xpdf), reads every allotted seat, and adds
// that round's closing ranks to <dataDir>/<year>.json; <dataDir>/index.json lists the years and
// rounds. The year and round come from the PDF's own heading ("NEET-PG Counselling Seats
// Allotment -2026 Round- 2"), so files can have any name.
//
// In the mochi-releases repo this runs as a GitHub Action whenever a PDF is added to
// data/counselling/incoming/ (.github/workflows/counselling.yml), so a new round reaches the apps
// without an app update. MCC's site doesn't allow automated downloads, so the PDF is added by hand.
// Needs Node 24+ (it imports the TypeScript parser directly) and `pdftotext` on PATH (or PDFTOTEXT=…).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { addRound, emptyYear, parseAllotment } from './counselling.ts';

const [dataDir, ...inputs] = process.argv.slice(2);
if (!dataDir || !inputs.length) throw new Error('Usage: node import-mcc.mjs <dataDir> <pdf or folder>...');
const pdftotext = process.env.PDFTOTEXT || 'pdftotext';
const MIN_ROWS = 500; // a real allotment list has thousands of seats
const KEEP_YEARS = 3;

const pdfs = inputs.flatMap((p) => (statSync(p).isDirectory() ? readdirSync(p).filter((f) => /\.pdf$/i.test(f)).map((f) => join(p, f)) : [p]));
mkdirSync(dataDir, { recursive: true });
const indexFile = join(dataDir, 'index.json');
const index = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')) : { updatedAt: null, years: [], imported: [] };
const tmp = mkdtempSync(join(tmpdir(), 'mcc-'));
const done = [];

for (const pdf of pdfs) {
  const txt = join(tmp, 'r.txt');
  execFileSync(pdftotext, ['-raw', '-enc', 'UTF-8', pdf, txt]);
  const text = readFileSync(txt, 'utf8');
  const head = text.match(/Seats Allotment\s*-\s*(\d{4})\s*Round\s*-\s*([A-Za-z0-9-]+)/i);
  if (!head) {
    console.log(`skip ${basename(pdf)}: not an MCC PG allotment result (no "Seats Allotment -YYYY Round- N" heading)`);
    continue;
  }
  const year = Number(head[1]);
  const round = /^\d+$/.test(head[2]) ? head[2] : /stray/i.test(head[2]) ? 'Stray' : head[2];
  const rows = parseAllotment(text);
  if (rows.length < MIN_ROWS) {
    console.log(`skip ${basename(pdf)}: only ${rows.length} seats read`);
    continue;
  }
  const yearFile = join(dataDir, `${year}.json`);
  const data = existsSync(yearFile) ? JSON.parse(readFileSync(yearFile, 'utf8')) : emptyYear(year);
  const publishedOn = text.match(/(\d{2})-(\d{2})-(\d{4}) \d{2}:\d{2}:\d{2} [AP]M/);
  const meta = { round, title: `NEET PG counselling ${year}, round ${round} (MCC final allotment)`, url: 'https://mcc.nic.in/pg-medical-counselling/', publishedOn: publishedOn ? `${publishedOn[3]}-${publishedOn[2]}-${publishedOn[1]}` : '' };
  writeFileSync(yearFile, JSON.stringify(addRound(data, meta, rows)));
  index.imported = [...index.imported.filter((x) => !(x.year === year && x.round === round)), { year, round, rows: rows.length, file: basename(pdf), at: new Date().toISOString() }];
  done.push(pdf);
  console.log(`imported ${year} round ${round}: ${rows.length} seats (${basename(pdf)})`);
}

if (done.length) {
  const years = [...new Set(index.imported.map((x) => x.year))].sort((a, b) => b - a).slice(0, KEEP_YEARS);
  index.years = years.map((y) => {
    const d = JSON.parse(readFileSync(join(dataDir, `${y}.json`), 'utf8'));
    return { year: y, rounds: d.rounds.map((r) => ({ round: r.round, publishedOn: r.publishedOn, seats: r.rows })), file: `${y}.json` };
  });
  index.updatedAt = new Date().toISOString();
  writeFileSync(indexFile, JSON.stringify(index, null, 1));
}
// For the workflow: which PDFs were imported (so it can remove them from incoming/).
writeFileSync(join(tmp, 'done.txt'), done.join('\n'));
console.log(done.length ? `Data updated (${done.length} file${done.length === 1 ? '' : 's'}).` : 'Nothing imported.');
if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `imported=${done.length}\n`, { flag: 'a' });
