import type { Kysely } from 'kysely';
import type { Database } from './db';
import type { JobTable } from './db/types';
import { LIMITS } from './limits';

export const fetchJobForUpdate = async (
  db: Kysely<Database>,
  jobId: string
): Promise<JobTable | undefined> =>
  db.selectFrom('jobs').selectAll().where('job_id', '=', jobId).forUpdate().executeTakeFirst();

export const expireJobIfNeeded = async (
  db: Kysely<Database>,
  job: JobTable,
  now = new Date()
): Promise<JobTable> => {
  if (job.status === 'quoted' && job.quote_expires_at && job.quote_expires_at <= now) {
    const updated = await db
      .updateTable('jobs')
      .set({ status: 'expired' })
      .where('job_id', '=', job.job_id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return updated;
  }

  if (
    job.status === 'accepted' &&
    !job.payment_tx_hash &&
    job.updated_at <= new Date(now.getTime() - LIMITS.acceptPaymentTtlMs)
  ) {
    const updated = await db
      .updateTable('jobs')
      .set({ status: 'expired' })
      .where('job_id', '=', job.job_id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return updated;
  }

  return job;
};
