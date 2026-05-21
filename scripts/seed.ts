// Import from source so seed works before `pnpm build`
import { loadConfig } from '../packages/config/src/index.ts';
import { connectDatabase, seedDevData } from '../packages/database/src/index.ts';

async function main() {
  const config = loadConfig();
  const db = await connectDatabase(config.MONGODB_URI);
  await seedDevData(db);
  console.log('Seeded dev tenant t_123 and mailbox m_45');
  await db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
