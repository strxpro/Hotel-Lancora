// Deletes the local demo database; it is regenerated (relative to today) on the next request.
import fs from 'node:fs';
import path from 'node:path';
const file = path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'db.json');
if (fs.existsSync(file)) {
  fs.unlinkSync(file);
  console.log('Database demo rimosso: verrà rigenerato alla prossima richiesta.');
} else console.log('Nessun database da rimuovere.');
