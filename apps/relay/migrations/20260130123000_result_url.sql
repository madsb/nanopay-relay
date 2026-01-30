-- migrate:up
alter table jobs
  add column if not exists result_url text null;

alter table jobs
  drop constraint if exists jobs_delivered_result;

alter table jobs
  drop constraint if exists jobs_failed_error;

alter table jobs
  drop constraint if exists jobs_terminal_clear;

alter table jobs
  add constraint jobs_delivered_result check (
    status <> 'delivered'
    or (result_url is not null and error is null)
  );

alter table jobs
  add constraint jobs_failed_error check (
    status <> 'failed'
    or (error is not null and result_url is null)
  );

alter table jobs
  add constraint jobs_terminal_clear check (
    status not in ('canceled', 'expired')
    or (result_url is null and error is null)
  );

-- migrate:down
alter table jobs
  drop constraint if exists jobs_delivered_result;

alter table jobs
  drop constraint if exists jobs_failed_error;

alter table jobs
  drop constraint if exists jobs_terminal_clear;

alter table jobs
  add constraint jobs_delivered_result check (
    status <> 'delivered'
    or (result_payload is not null and error is null)
  );

alter table jobs
  add constraint jobs_failed_error check (
    status <> 'failed' or error is not null
  );

alter table jobs
  add constraint jobs_terminal_clear check (
    status not in ('canceled', 'expired')
    or (result_payload is null and error is null)
  );

alter table jobs
  drop column if exists result_url;
