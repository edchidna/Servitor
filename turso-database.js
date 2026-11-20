'use strict';

// Shared asynchronous Turso/libSQL connection layer.
//
// This module deliberately does not initialize feature schemas. The application
// startup sequence must call initializeDatabase(), then await each feature
// module's initializeSchema() function before registering Discord handlers.

const { createClient } = require('@libsql/client');

let client = null;
let initializationPromise = null;
let closing = false;

function getDatabaseConfig() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url || typeof url !== 'string' || !url.trim()) {
    throw new Error('TURSO_DATABASE_URL is required.');
  }

  const normalizedUrl = url.trim();
  const isLocalFile = normalizedUrl.startsWith('file:');

  if (!isLocalFile && (!authToken || typeof authToken !== 'string' || !authToken.trim())) {
    throw new Error('TURSO_AUTH_TOKEN is required for a remote Turso database.');
  }

  return {
    url: normalizedUrl,
    ...(isLocalFile ? {} : { authToken: authToken.trim() })
  };
}

/**
 * Creates and verifies the shared libSQL client once per process.
 * Concurrent callers share the same initialization promise.
 */
async function initializeDatabase() {
  if (closing) {
    throw new Error('Database is currently shutting down.');
  }

  if (client) return client;
  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    const config = getDatabaseConfig();
    const nextClient = createClient(config);

    try {
      await nextClient.execute('SELECT 1 AS connected');
      client = nextClient;
      console.log('Turso database connection established.');
      return client;
    } catch (error) {
      nextClient.close();
      throw new Error('Could not connect to the Turso database.', {
        cause: error
      });
    } finally {
      initializationPromise = null;
    }
  })();

  return initializationPromise;
}

function getClient() {
  if (!client) {
    throw new Error(
      'Database is not initialized. Await initializeDatabase() before accessing it.'
    );
  }
  return client;
}

/**
 * Execute one parameterized statement.
 * ResultSet is returned unchanged so callers can inspect rowsAffected and
 * lastInsertRowid explicitly.
 */
async function execute(sql, args = []) {
  if (typeof sql !== 'string' || !sql.trim()) {
    throw new TypeError('SQL must be a non-empty string.');
  }
  return getClient().execute({ sql, args });
}

/**
 * Execute a fixed batch. Use only when statements do not depend on results
 * from earlier statements; dependent workflows belong in withTransaction().
 */
async function batch(statements, mode = 'write') {
  if (!Array.isArray(statements) || statements.length === 0) {
    throw new TypeError('Database batch requires at least one statement.');
  }
  return getClient().batch(statements, mode);
}

/**
 * Run dependent reads/writes through one interactive transaction.
 * The callback must use only the supplied transaction object for its SQL.
 */
async function withTransaction(callback, mode = 'write') {
  if (typeof callback !== 'function') {
    throw new TypeError('Transaction callback must be a function.');
  }

  const tx = await getClient().transaction(mode);
  let committed = false;

  try {
    const result = await callback(tx);
    await tx.commit();
    committed = true;
    return result;
  } catch (error) {
    if (!committed) {
      try {
        await tx.rollback();
      } catch (rollbackError) {
        if (error && typeof error === 'object') {
          error.rollbackError = rollbackError;
        } else {
          throw new AggregateError(
            [new Error(String(error)), rollbackError],
            'Database transaction failed and rollback also failed.'
          );
        }
      }
    }
    throw error;
  } finally {
    tx.close();
  }
}

/**
 * Close the process-wide client during an orderly shutdown.
 */
async function closeDatabase() {
  closing = true;

  if (initializationPromise) {
    try {
      await initializationPromise;
    } catch {
      // Preserve shutdown even if connection initialization failed.
    }
  }

  if (client) {
    client.close();
    client = null;
  }

  closing = false;
}

module.exports = {
  initializeDatabase,
  getClient,
  execute,
  batch,
  withTransaction,
  closeDatabase
};
