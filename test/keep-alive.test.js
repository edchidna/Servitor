const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const test = require('node:test');

process.env.PORT = '0';
const server = require('../keep_alive');

async function request(path) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const req = http.get({
      hostname: '127.0.0.1',
      port: address.port,
      path
    }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
  });
}

test('health endpoint reports process liveness independently of readiness', async t => {
  if (!server.listening) await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  }));

  assert.deepEqual(await request('/health'), {
    status: 200,
    body: "I'm alive"
  });
  assert.deepEqual(await request('/'), {
    status: 200,
    body: "I'm alive"
  });
  assert.deepEqual(await request('/ready'), {
    status: 503,
    body: 'Servitor is not ready'
  });

  server.setReadinessCheck(() => true);
  assert.deepEqual(await request('/ready'), {
    status: 200,
    body: 'Servitor is ready'
  });

  server.setReadinessCheck(() => {
    throw new Error('readiness probe failure');
  });
  assert.deepEqual(await request('/ready'), {
    status: 503,
    body: 'Servitor is not ready'
  });
  assert.equal((await request('/unknown')).status, 404);
});
