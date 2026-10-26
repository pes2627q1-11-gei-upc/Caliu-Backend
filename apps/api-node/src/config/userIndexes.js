import User, { USERNAME_COLLATION } from '../models/User.js';
import { normalizeUsername, validatePreferences } from '../domain/userValidation.js';

// Auditoria de només lectura. No imprimeix noms, correus, hashes ni documents.
export async function auditUsers() {
  const duplicateGroups = await User.aggregate([
    { $match: { username: { $type: 'string' } } },
    { $group: { _id: '$username', count: { $sum: 1 }, ids: { $push: '$_id' } } },
    { $match: { count: { $gt: 1 } } },
    { $project: { _id: 0, ids: 1 } },
  ]).collation(USERNAME_COLLATION);
  const report = { duplicateGroups, invalidUserIds: [], nonCanonicalPreferencesIds: [], legacyUsernameIds: [] };
  for await (const user of User.find().select('username preferences').lean().cursor()) {
    if (user.username == null) report.legacyUsernameIds.push(String(user._id));
    else {
      try {
        if (normalizeUsername(user.username) !== user.username) report.invalidUserIds.push(String(user._id));
      } catch { report.invalidUserIds.push(String(user._id)); }
    }
    try {
      const canonical = validatePreferences({ preferences: user.preferences });
      if (JSON.stringify(canonical) !== JSON.stringify(user.preferences)) {
        report.nonCanonicalPreferencesIds.push(String(user._id));
      }
    } catch { report.nonCanonicalPreferencesIds.push(String(user._id)); }
  }
  return report;
}

export async function initializeUserIndexes() {
  const report = await auditUsers();
  if (report.duplicateGroups.length || report.invalidUserIds.length || report.nonCanonicalPreferencesIds.length) {
    const error = new Error('Cal regularitzar dades antigues; executa npm run users:audit (només lectura)');
    error.name = 'UserMigrationRequired';
    throw error;
  }
  // createIndexes no elimina ni modifica índexs existents (mai syncIndexes).
  await User.createIndexes();
  return report;
}
