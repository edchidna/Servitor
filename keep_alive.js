const http = require('http');

let readinessCheck = () => false;

const server = http.createServer((req, res) => {
  const pathname = (req.url || '/').split('?')[0];

  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end("I'm alive");
    return;
  }

  if (pathname === '/ready') {
    let ready = false;

    try {
      ready = readinessCheck() === true;
    } catch (error) {
      console.error('Readiness check failed:', error);
    }

    res.writeHead(ready ? 200 : 503, {
      'Content-Type': 'text/plain; charset=utf-8'
    });
    res.end(ready ? 'Servitor is ready' : 'Servitor is not ready');
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

const port = Number(process.env.PORT || 8080);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid PORT value: ${process.env.PORT}`);
}

server.setReadinessCheck = check => {
  if (typeof check !== 'function') {
    throw new TypeError('Readiness check must be a function.');
  }

  readinessCheck = check;
};

server.listen(port);

module.exports = server;
