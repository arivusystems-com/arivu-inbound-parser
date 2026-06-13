import cors from 'cors';
import express from 'express';
import { loadConfig } from '@arivu/config';
import { connectDatabase, ensureMongoConnected, pingDatabase, startMongoConnectionMonitor } from '@arivu/database';
import { createLogger } from '@arivu/logger';
import {
  createRedisConnection,
  pingRedis,
  startRedisConnectionMonitor,
} from '@arivu/queue';
import { createAdminRouter } from './admin/routes.js';
import { createIntegrationRouter } from './integration/routes.js';
import { ValidationError } from './integration/validate.js';

const config = loadConfig();
const log = createLogger('api');
const redis = createRedisConnection(config.REDIS_URL, (err) => {
  log.warn({ err: err.message }, 'Redis connection error — is Docker running? (pnpm infra:up)');
});

let database: Awaited<ReturnType<typeof connectDatabase>> | null = null;

async function getDb() {
  if (!database) database = await connectDatabase(config.MONGODB_URI);
  return database;
}

const app = express();
app.use(cors());
app.use(express.json());

app.use('/integrations/v1', createIntegrationRouter(config, getDb, log));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'api' });
});

app.get('/health/ready', async (_req, res) => {
  try {
    await ensureMongoConnected(config.MONGODB_URI);
    await pingDatabase();
    await pingRedis(redis);
    res.json({ status: 'ok', service: 'api', mongo: 'ok', redis: 'ok' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'not ready';
    log.warn({ err: message }, 'Readiness check failed');
    res.status(503).json({ status: 'degraded', service: 'api', error: message });
  }
});

app.use(
  '/admin',
  createAdminRouter({
    config,
    getDb,
    log,
    redis,
  }),
);

app.use(
  (
    err: Error & { statusCode?: number },
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (err instanceof ValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    log.error({ err }, 'API error');
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
    res.status(status).json({ error: err.message });
  },
);

async function main() {
  await getDb();

  startMongoConnectionMonitor(config.MONGODB_URI, {
    onFailure: (err, failures) =>
      log.warn({ err: err.message, failures }, 'MongoDB health check failed'),
    onGiveUp: (err) => {
      log.fatal({ err }, 'MongoDB unreachable — exiting for restart');
      process.exit(1);
    },
  });
  startRedisConnectionMonitor(redis, {
    onFailure: (err, failures) =>
      log.warn({ err: err.message, failures }, 'Redis health check failed'),
    onGiveUp: (err) => {
      log.fatal({ err }, 'Redis unreachable — exiting for restart');
      process.exit(1);
    },
  });

  const server = app.listen(config.API_PORT, config.API_HOST, () => {
    log.info({ host: config.API_HOST, port: config.API_PORT }, 'API listening');
  });
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      log.fatal(
        { port: config.API_PORT },
        'Port already in use — stop the old process: pnpm dev:stop',
      );
      process.exit(1);
    }
    throw err;
  });
}

main().catch((err) => {
  log.fatal({ err }, 'API failed to start');
  process.exit(1);
});
