-- migrate:up
update jobs
  set result_payload = null
  where result_payload is not null;

-- migrate:down
-- no-op (data purge)
