import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { auditUsers } from '../config/userIndexes.js';

try {
  // Aquest comandament no crea índexs ni modifica comptes.
  mongoose.set('autoIndex', false);
  await connectDB();
  const report = await auditUsers();
  console.log(JSON.stringify(report, null, 2));
  if (report.duplicateGroups.length || report.invalidUserIds.length || report.nonCanonicalPreferencesIds.length) {
    process.exitCode = 1;
  }
} catch {
  console.error('No s’ha pogut completar l’auditoria d’usuaris');
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
