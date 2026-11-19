/**
 * Runs once when the server starts (not during the build).
 *  · Telegram: on a computer without a public address the site listens to the bot by itself.
 *  · Database: when Supabase is connected the site starts from the real tables when they hold a
 *    newer version than this computer (stage 3b, server/db/tables-sync.ts → startFromTables), then
 *    the copy of the whole document (hotel_state) is looked at as the backup, then the tables are
 *    brought to the version the site starts with.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NEXT_PHASE === 'phase-production-build') return;
  // `npm run dev` next to the real site: no second Telegram listener (the two kept kicking each
  // other off), no cloud sync, no sweepers or webhook changes. DEV_JOBS=on turns them on on purpose.
  if (process.env.NODE_ENV === 'development' && process.env.DEV_JOBS !== 'on') {
    console.log('[dev] versione di sviluppo: Telegram, copia cloud e lavori automatici spenti (DEV_JOBS=on per accenderli)');
    return;
  }
  try {
    const { startFromTables } = await import('./server/db/tables-sync');
    await startFromTables();
  } catch (e) {
    console.error('[tables] avvio dalle tabelle non riuscito:', (e as Error).message);
  }
  try {
    const { cloudHydrate } = await import('./server/db/cloud');
    await cloudHydrate();
  } catch (e) {
    console.error('[cloud] avvio senza copia cloud:', (e as Error).message);
  }
  try {
    // real tables (one-way export): registers the hook used after every saved change and, in the
    // background, checks that the tables hold the current version of the document
    const { tablesHydrate, startShadowReads } = await import('./server/db/tables-sync');
    const { readDb } = await import('./server/db/store');
    void tablesHydrate(readDb()).catch((e) => console.error('[tables]', (e as Error).message));
    // stage 3a: read the tables back and compare with the document (log only, the site does not use the result)
    startShadowReads(readDb);
  } catch (e) {
    console.error('[tables] esportazione non avviata:', (e as Error).message);
  }
  try {
    const { startHoldSweeper } = await import('./server/bookings');
    startHoldSweeper();
    const { startDailyJobs } = await import('./server/daily');
    startDailyJobs();
  } catch (e) {
    console.error('[prenotazioni] rilascio automatico non avviato:', (e as Error).message);
  }
  try {
    // "new card within X hours": at the deadline the booking is cancelled (booking-care.ts)
    const { startCareSweeper } = await import('./server/booking-care');
    startCareSweeper();
  } catch (e) {
    console.error('[carta] controllo delle scadenze non avviato:', (e as Error).message);
  }
  try {
    const { startCalendarSync } = await import('./server/channels/ical');
    startCalendarSync();
  } catch (e) {
    console.error('[ical] sincronizzazione calendari non avviata:', (e as Error).message);
  }
  try {
    // Stripe's notifications always point at the address the site has now (temporary link or domain)
    const { ensureStripeWebhook } = await import('./server/payments/webhook-setup');
    void ensureStripeWebhook()
      .then((ok) => ok && console.log('[stripe] avvisi di Stripe collegati a questo indirizzo'))
      .catch((e) => console.error('[stripe] avvisi non collegati:', (e as Error).message));
  } catch (e) {
    console.error('[stripe]', (e as Error).message);
  }
  try {
    const { startTelegramListener } = await import('./server/telegram/poller');
    startTelegramListener();
  } catch (e) {
    console.error('[telegram] ascolto non avviato:', (e as Error).message);
  }
}
