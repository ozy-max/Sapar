import { createServer, Server, IncomingMessage, ServerResponse } from 'node:http';

export interface MockDownstream {
  readonly url: string;
  readonly port: number;
  server: Server;
  lastRequest: {
    method: string;
    url: string;
    headers: Record<string, string | string[] | undefined>;
    body: string;
  } | null;
  handler: (req: IncomingMessage, res: ServerResponse) => void;
  close: () => Promise<void>;
}

export function createMockDownstream(port: number): Promise<MockDownstream> {
  return new Promise((resolve, reject) => {
    const mock: MockDownstream = {
      url: `http://127.0.0.1:${port}`,
      port,
      server: undefined as unknown as Server,
      lastRequest: null,
      handler: (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      },
      close: () =>
        new Promise<void>((res, rej) => {
          mock.server.close((err) => (err ? rej(err) : res()));
        }),
    };

    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        mock.lastRequest = {
          method: req.method ?? 'GET',
          url: req.url ?? '/',
          headers: req.headers as Record<string, string | string[] | undefined>,
          body,
        };
        mock.handler(req, res);
      });
    });

    mock.server = server;

    server.listen(port, '127.0.0.1', () => {
      resolve(mock);
    });

    server.on('error', reject);
  });
}
