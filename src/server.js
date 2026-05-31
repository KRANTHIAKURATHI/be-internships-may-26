import Fastify from 'fastify';
import dotenv from 'dotenv';
import { postSignal, getSignals } from './signals.js';
import { pingDb } from './db.js';

dotenv.config();
const API_KEY = process.env.API_KEY;
const PORT = Number(process.env.PORT || 8080);

if (!API_KEY) {
  console.error('Missing required environment variable API_KEY');
  process.exit(1);
}

const app = Fastify({ logger: { level: 'info' } });

app.addHook('onRequest', async (req, reply) => {
  if (req.url === '/healthz') return;
  const key = req.headers['x-api-key'];
  if (!key || key !== API_KEY) {
    reply.code(401).send({ error: 'unauthorized' });
  }
});

app.get('/healthz', async () => {
  try {
    pingDb();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: 'db_unavailable' };
  }
});
app.post('/v1/signals', postSignal);
app.get('/v1/signals', getSignals);

app.listen({ host: '0.0.0.0', port: PORT }).catch((e) => {
  app.log.error(e);
  process.exit(1);
});
