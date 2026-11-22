const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
process.chdir(__dirname);
if (!process.env.DATABASE_URL_FILE) throw new Error('DATABASE_URL_FILE is required');
const result = spawnSync(
  'node',
  [
    require.resolve('prisma/build/index.js'),
    'migrate',
    'deploy',
    '--schema',
    'prisma/schema.prisma',
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: fs.readFileSync(process.env.DATABASE_URL_FILE, 'utf8').trim(),
    },
  },
);
if (result.status !== 0) process.exit(result.status ?? 1);
const grants = spawnSync(
  'node',
  [
    require.resolve('prisma/build/index.js'),
    'db',
    'execute',
    '--schema',
    'prisma/schema.prisma',
    '--file',
    'grants.sql',
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: fs.readFileSync(process.env.DATABASE_URL_FILE, 'utf8').trim(),
    },
  },
);
process.exit(grants.status ?? 1);
