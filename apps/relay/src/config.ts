import dotenv from 'dotenv';

dotenv.config();

const parsePort = (value: string | undefined) => {
  if (!value) return 3000;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 3000;
};

export const config = {
  port: parsePort(process.env.PORT),
  databaseUrl: process.env.DATABASE_URL,
  logLevel: process.env.LOG_LEVEL ?? 'info'
};
