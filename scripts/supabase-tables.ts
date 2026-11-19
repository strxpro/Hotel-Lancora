/**
 * Copies the hotel's document (data/db.json) into the real Supabase tables and checks the result.
 *
 *   npm run db:tables            full copy + check (what is not in the document is removed from the tables)
 *   npm run db:tables -- --check only compare the number of rows, write nothing
 *   npm run db:start-test        stage 3b: pretend to be a new computer (an empty data folder, then one
 *                                with an older document) and start from the tables; the loaded document
 *                                is compared with data/db.json. Only reads from Supabase.
 *   npm run db:shadow            stage 3a: read the tables back, rebuild the document from them and compare
 *                                it value by value with data/db.json (writes nothing)
 *
 * Needs SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local and the tables of supabase/hotel-tables.sql
 * (paste that file once in the Supabase SQL editor). Safe to run again at any time: the document is
 * never changed, and the tables are simply brought back to what the document says.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '../src/lib/types';
import { cloudConfigured, cloudFetch, cloudRest } from '../src/server/db/cloud';
import { documentIssues, rowCounts, toTables, TABLE_NAMES } from '../src/server/db/tables';
import { TABLE_COLUMNS } from '../src/server/db/table-columns';
import { shadowCompare, startFromTables, syncTables, verifyTables } from '../src/server/db/tables-sync';
import { compareDocuments } from '../src/server/db/tables-read';

const checkOnly = process.argv.includes('--check');
const shadowOnly = process.argv.includes('--shadow');
const startTest = process.argv.includes('--start');
const file = path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'db.json');

function fail(message: string): never {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

async function all<T>(pathname: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const res = await cloudRest(`${pathname}&limit=1000&offset=${from}`, {}, 30_000);
    if (!res.ok) fail(`Odczyt ${pathname.split('?')[0]} nie powiódł się: Supabase ${res.status} ${await res.text()}`);
    const page = (await res.json()) as T[];
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

const money = (n: number) => Math.round(n * 100);

/** Stage 3a: is the document rebuilt from the tables the same as the document of the site? */
async function shadow() {
  let db = JSON.parse(fs.readFileSync(file, 'utf8')) as DB;
  let r = await shadowCompare(db);
  // the site exports a change about two seconds after saving it: if we caught it in between, look again
  for (let i = 0; i < 5 && r.error?.includes('versione'); i++) {
    await new Promise((done) => setTimeout(done, 3000));
    db = JSON.parse(fs.readFileSync(file, 'utf8')) as DB;
    r = await shadowCompare(db);
  }
  console.log(`Dokument: ${file} · wersja ${db.version}`);
  if (r.error) fail(`Nie udało się porównać: ${r.error}`);
  console.log(`Odczytano ${r.rows} wierszy z tabel w ${(r.ms / 1000).toFixed(1)} s i odtworzono z nich dokument.`);
  console.log(`\nRóżnice w wartościach:      ${r.real}`);
  for (const d of r.sample.slice(0, r.real)) console.log(`  ✖ ${d.path}: dokument ${JSON.stringify(d.document)} · tabele ${JSON.stringify(d.tables)}`);
  console.log(`Ta sama wartość, inny zapis: ${r.format}`);
  for (const d of r.sample.slice(r.real > 20 ? 20 : r.real)) console.log(`  · ${d.path}: dokument ${JSON.stringify(d.document)} · tabele ${JSON.stringify(d.tables)}`);
  console.log(`Listy w innej kolejności:    ${r.order.length}`);
  for (const o of r.order) console.log(`  · ${o.list}: ${o.outOfPlace} z ${o.rows} wierszy na innej pozycji`);
  if (!r.ok) fail(`Dokument odtworzony z tabel RÓŻNI SIĘ od dokumentu strony (${r.real} wartości).`);
  console.log(`\n✓ Dokument odtworzony z tabel ma dokładnie te same wartości co dokument strony${r.order.length ? '' : ' i tę samą kolejność na wszystkich listach'} (wersja ${db.version}).\n`);
  if (r.order.length) console.log('Kolejność list nie jest jeszcze w pełni zapisana: uruchom ponownie plik supabase/hotel-tables.sql w Supabase (dodaje tabelę hotel_list_order), potem `npm run db:tables`.\n');
}

/** Stage 3b: what a computer without data (or with an older document) would load when the site starts. */
async function startCheck() {
  const real = path.dirname(file);
  const scratch = path.join(process.cwd(), '.qa', `start-test-${process.pid}`);
  const cases: { name: string; prepare: (dir: string) => void }[] = [
    { name: 'nowy komputer (pusty folder danych)', prepare: () => {} },
    { name: 'komputer ze starszą wersją dokumentu', prepare: (dir) => { const old = JSON.parse(fs.readFileSync(file, 'utf8')) as DB; old.version -= 1; fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify(old)); } },
  ];
  let failed = false;
  try {
    for (const c of cases) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const dir = path.join(scratch, String(attempt));
        fs.rmSync(dir, { recursive: true, force: true });
        fs.mkdirSync(dir, { recursive: true });
        c.prepare(dir);
        process.env.DATA_DIR = dir;
        const started = Date.now();
        const r = await startFromTables();
        process.env.DATA_DIR = real;
        const current = JSON.parse(fs.readFileSync(file, 'utf8')) as DB;
        if (r.source !== 'tables') {
          console.log(`✖ ${c.name}: start NIE z tabel (${r.source}): ${r.detail}`);
          failed = true;
          break;
        }
        const loaded = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8')) as DB;
        // the site saved a change in the meantime: try again so both sides are the same version
        if (loaded.version !== current.version && attempt < 4) {
          await new Promise((done) => setTimeout(done, 3000));
          continue;
        }
        const cmp = compareDocuments(current, loaded);
        const ok = loaded.version === current.version && cmp.real.length === 0 && cmp.order.length === 0;
        console.log(`${ok ? '✓' : '✖'} ${c.name}: ${r.detail} · ${((Date.now() - started) / 1000).toFixed(1)} s · różnice w wartościach ${cmp.real.length}, listy w innej kolejności ${cmp.order.length}, inny zapis ${cmp.format.length}`);
        for (const d of cmp.real.slice(0, 10)) console.log(`    ✖ ${d.path}: dokument ${JSON.stringify(d.document)} · z tabel ${JSON.stringify(d.tables)}`);
        if (!ok) failed = true;
        break;
      }
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  if (failed) fail('Start z tabel NIE daje tego samego dokumentu co data/db.json.');
  console.log('\n✓ Start z tabel daje dokładnie ten sam dokument co data/db.json (wartości i kolejność list). data/db.json nie był zmieniany.\n');
}

async function main() {
  if (!cloudConfigured()) fail('Brak SUPABASE_URL / SUPABASE_SECRET_KEY w .env.local.');
  if (!fs.existsSync(file)) fail(`Nie ma pliku ${file}.`);
  if (shadowOnly) return shadow();
  if (startTest) return startCheck();
  const db = JSON.parse(fs.readFileSync(file, 'utf8')) as DB;
  const rows = toTables(db);
  const local = rowCounts(rows);
  console.log(`Dokument: ${file} · wersja ${db.version} · ${Object.values(local).reduce((a, b) => a + b, 0)} wierszy w ${TABLE_NAMES.length} tabelach`);

  const issues = documentIssues(db);
  if (issues.length) fail(`Dokument zawiera dane, których baza nie przyjmie:\n  - ${issues.join('\n  - ')}`);

  const state = await cloudFetch().catch(() => null);
  if (state && state.version !== db.version) console.log(`Uwaga: kopia dokumentu w Supabase (hotel_state) ma wersję ${state.version}, a plik lokalny ${db.version}. Kopiuję plik lokalny.`);

  if (!checkOnly) {
    const started = Date.now();
    const r = await syncTables(db, { full: true });
    if (!r.ok) fail(r.missing ? 'Tabel jeszcze nie ma w Supabase: wklej plik supabase/hotel-tables.sql w SQL Editor, naciśnij Run i uruchom ten skrypt ponownie.' : `Baza odrzuciła kopię: ${r.error}`);
    console.log(`Skopiowano ${r.upserts} wierszy w ${((Date.now() - started) / 1000).toFixed(1)} s (jedna transakcja).`);
  }

  // 1) number of rows in every table
  const check = await verifyTables(db, { readOnly: true }).catch((e: Error) => fail(`Nie udało się policzyć wierszy (tabel jeszcze nie ma w Supabase albo baza nie odpowiada): ${e.message}`));
  const width = Math.max(...TABLE_NAMES.map((t) => t.length));
  console.log(`\n${'tabela'.padEnd(width)}  dokument   baza`);
  for (const t of TABLE_NAMES) {
    const bad = check.mismatches.find((m) => m.table === t);
    if (check.missing.includes(t)) console.log(`${t.padEnd(width)}  ${String(local[t]).padStart(8)}  ${'—'.padStart(5)}  (tej tabeli nie ma jeszcze w bazie)`);
    else console.log(`${t.padEnd(width)}  ${String(local[t]).padStart(8)}  ${String(bad ? (bad.database ?? '—') : local[t]).padStart(5)}  ${bad ? '✖' : '✓'}`);
  }
  if (check.missing.length) console.log(`\nUwaga: w Supabase brakuje nowszej tabeli (${check.missing.join(', ')}). Uruchom ponownie plik supabase/hotel-tables.sql w SQL Editor — niczego nie kasuje — i powtórz ten skrypt.`);
  if (check.columns.length) console.log(`\nUwaga: w bazie brakuje kolumn (${check.columns.join(', ')}) — te pola nie trafiałyby do tabel. Uruchom ponownie plik supabase/hotel-tables.sql w SQL Editor — niczego nie kasuje — i powtórz ten skrypt.`);
  else console.log(`\nKolumny: baza ma wszystkie ${TABLE_NAMES.reduce((n, t) => n + TABLE_COLUMNS[t].length, 0)} kolumn, których używa strona (sprawdzone także w pustych tabelach).`);

  // 2) the rows that matter most, field by field: stays (room, nights, state, money) and payments
  const problems: string[] = [];
  const stays = await all<{ id: string; room_id: string | null; check_in: string; check_out: string; status: string; occupies_room: boolean; total: number; amount_paid: number }>('bookings?select=id,room_id,check_in,check_out,status,occupies_room,total,amount_paid&order=id');
  const byId = new Map(stays.map((s) => [s.id, s]));
  for (const b of rows.bookings as { id: string; room_id: string | null; check_in: string; check_out: string; status: string; occupies_room: boolean; total: number; amount_paid: number }[]) {
    const s = byId.get(b.id);
    if (!s) problems.push(`rezerwacji ${b.id} nie ma w bazie`);
    else if (s.room_id !== b.room_id || s.check_in !== b.check_in || s.check_out !== b.check_out || s.status !== b.status || s.occupies_room !== b.occupies_room || money(s.total) !== money(b.total) || money(s.amount_paid) !== money(b.amount_paid)) problems.push(`rezerwacja ${b.id} różni się od dokumentu`);
  }
  const pays = await all<{ id: string; booking_id: string; amount: number }>('payments?select=id,booking_id,amount&order=id');
  const paid = (list: { amount: number }[]) => list.reduce((sum, p) => sum + money(p.amount), 0);
  if (paid(pays) !== paid(rows.payments as { amount: number }[])) problems.push(`suma płatności: baza ${paid(pays) / 100} €, dokument ${paid(rows.payments as { amount: number }[]) / 100} €`);
  const meta = (await all<{ version: number }>('hotel_meta?select=version'))[0];
  if (!meta || Number(meta.version) !== db.version) problems.push(`hotel_meta.version = ${meta?.version ?? '—'}, dokument ${db.version}`);

  console.log(`\nRezerwacje porównane pole po polu: ${stays.length} · płatności: ${pays.length} (suma ${paid(pays) / 100} €) · wersja w tabelach: ${meta?.version ?? '—'}`);
  if (!check.ok || problems.length) fail(`Tabele NIE zgadzają się z dokumentem:\n  - ${[...check.mismatches.map((m) => `${m.table}: dokument ${m.document}, baza ${m.database ?? '—'}`), ...check.columns.map((c) => `brak kolumny ${c}`), ...problems.slice(0, 20)].join('\n  - ')}`);
  console.log(`\n✓ Wszystko się zgadza: ${check.rows} wierszy w ${check.tables} tabelach = dokument w wersji ${db.version}.\n`);
}

main().catch((e) => fail((e as Error).message));
