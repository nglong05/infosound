import { readFileSync } from 'node:fs';
import { PrismaClient, Prisma } from '../generated/client';

export function secret(name: string): string {
  const file = process.env[`${name}_FILE`];
  const value = file ? readFileSync(file, 'utf8').trim() : process.env[name];
  if (!value) throw new Error(`Missing required secret: ${name}_FILE`);
  return value;
}

export function createDatabase(): PrismaClient {
  // Call sites log stable event/error codes only; Prisma's textual error logging may contain values.
  return new PrismaClient({ datasources: { db: { url: secret('DATABASE_URL') } }, log: [] });
}
export const db = createDatabase();
export { Prisma, PrismaClient };
export * from '../generated/client';
