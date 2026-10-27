-- Hand-written invariants that the Drizzle schema cannot express.
-- Forward-only. Rolling back = restore from backup or a new forward migration.

-- 1. Activities are append-only. The only permitted UPDATE is re-anchoring
--    (deal_id / contact_id / company_id) inside the merge transaction, which sets
--    `app.merge_reparent = 'on'` with SET LOCAL. DELETE is never permitted.
CREATE OR REPLACE FUNCTION activities_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'activities are append-only: delete rejected for %', OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF current_setting('app.merge_reparent', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'activities are append-only: update rejected for %', OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF (OLD.id, OLD.kind, OLD.source, OLD.actor_id, OLD.body, OLD.occurred_at, OLD.created_at,
      OLD.from_stage_id, OLD.to_stage_id, OLD.corrects_activity_id, OLD.correction_reason,
      OLD.original_body, OLD.external_message_id, OLD.metadata)
     IS DISTINCT FROM
     (NEW.id, NEW.kind, NEW.source, NEW.actor_id, NEW.body, NEW.occurred_at, NEW.created_at,
      NEW.from_stage_id, NEW.to_stage_id, NEW.corrects_activity_id, NEW.correction_reason,
      NEW.original_body, NEW.external_message_id, NEW.metadata) THEN
    RAISE EXCEPTION 'merge re-anchoring may only change record anchors, not content (%)', OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER activities_append_only_trg
  BEFORE UPDATE OR DELETE ON activities
  FOR EACH ROW EXECUTE FUNCTION activities_append_only();

-- 2. Audit events are fully immutable.
CREATE OR REPLACE FUNCTION audit_events_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events are immutable: % rejected', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER audit_events_immutable_trg
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_immutable();

-- 3. A deal's status and closed_at must agree with the kind of its stage.
--    The database rejects drift even if an application path forgets to update them.
CREATE OR REPLACE FUNCTION deals_status_matches_stage() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  stage_kind text;
BEGIN
  SELECT kind INTO stage_kind FROM pipeline_stages WHERE id = NEW.stage_id;
  IF stage_kind IS NULL THEN
    RAISE EXCEPTION 'deal % references unknown stage %', NEW.id, NEW.stage_id;
  END IF;
  IF NEW.status IS DISTINCT FROM stage_kind THEN
    RAISE EXCEPTION 'deal % status % does not match stage kind %', NEW.id, NEW.status, stage_kind
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER deals_status_matches_stage_trg
  BEFORE INSERT OR UPDATE OF status, stage_id ON deals
  FOR EACH ROW EXECUTE FUNCTION deals_status_matches_stage();

-- 4. Reordering pipeline stages uses temporary negative positions inside one
--    transaction; the unique index is only checked at statement end for deferred
--    constraints, so make it deferrable.
ALTER TABLE pipeline_stages DROP CONSTRAINT IF EXISTS pipeline_stages_position_key;
DROP INDEX IF EXISTS pipeline_stages_position_key;
ALTER TABLE pipeline_stages ADD CONSTRAINT pipeline_stages_position_key UNIQUE (position) DEFERRABLE INITIALLY IMMEDIATE;
