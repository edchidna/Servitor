const Database = require('better-sqlite3');

const db = new Database('./aar-database.db');

db.backup('./aar-database-backup.db')
  .then(() => {
    console.log('Database backup completed successfully.');
    db.close();
  })
  .catch(error => {
    console.error('Backup failed:', error);
    db.close();
    process.exitCode = 1;
  });