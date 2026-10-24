-- Ledger integrity, enforced by the database rather than application code.
--
-- 1. Every journal entry balances (debits = credits per currency) and has at
--    least two lines. Checked by a DEFERRABLE INITIALLY DEFERRED constraint
--    trigger, so lines can be inserted one at a time and are verified at commit.
-- 2. Posted entries and lines are immutable: no UPDATE, no DELETE, no TRUNCATE.
--    Corrections are reversing entries (journal_entry.reverses_entry_id, unique).
-- 3. Lines can only be added in the transaction that created their entry.
-- 4. Entries dated inside a locked accounting period are rejected; locks are
--    one-way.
-- The only escape hatch is the scoped demo reset: inside one transaction,
-- `SET LOCAL eve.demo_reset_org = '<org id>'` permits deleting rows that belong
-- to that org, and only if the org is flagged is_demo.

CREATE OR REPLACE FUNCTION eve_demo_reset_allowed(target_org text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('eve.demo_reset_org', true), '') = target_org
     AND EXISTS (SELECT 1 FROM organization o WHERE o.id = target_org AND o.is_demo);
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION eve_journal_entry_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'journal entries are immutable; post a reversing entry instead (entry %)', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF eve_demo_reset_allowed(OLD.org_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'journal entries cannot be deleted (entry %)', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER journal_entry_immutable
  BEFORE UPDATE OR DELETE ON journal_entry
  FOR EACH ROW EXECUTE FUNCTION eve_journal_entry_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION eve_journal_line_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  entry_org text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'journal lines are immutable (line %)', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  SELECT org_id INTO entry_org FROM journal_entry WHERE id = OLD.entry_id;
  IF eve_demo_reset_allowed(entry_org) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'journal lines cannot be deleted (line %)', OLD.id
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER journal_line_immutable
  BEFORE UPDATE OR DELETE ON journal_line
  FOR EACH ROW EXECUTE FUNCTION eve_journal_line_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION eve_no_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% cannot be truncated', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER journal_entry_no_truncate BEFORE TRUNCATE ON journal_entry
  FOR EACH STATEMENT EXECUTE FUNCTION eve_no_truncate();
--> statement-breakpoint
CREATE TRIGGER journal_line_no_truncate BEFORE TRUNCATE ON journal_line
  FOR EACH STATEMENT EXECUTE FUNCTION eve_no_truncate();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION eve_journal_line_same_tx() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  entry_txid bigint;
BEGIN
  SELECT created_txid INTO entry_txid FROM journal_entry WHERE id = NEW.entry_id;
  IF entry_txid IS DISTINCT FROM txid_current() THEN
    RAISE EXCEPTION 'cannot add lines to posted entry % from another transaction', NEW.entry_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER journal_line_same_tx
  BEFORE INSERT ON journal_line
  FOR EACH ROW EXECUTE FUNCTION eve_journal_line_same_tx();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION eve_journal_entry_period() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  original_org text;
BEGIN
  IF NEW.created_txid IS DISTINCT FROM txid_current() THEN
    RAISE EXCEPTION 'created_txid is assigned by the database' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM accounting_period p
     WHERE p.org_id = NEW.org_id AND p.locked
       AND NEW.entry_date BETWEEN p.starts_on AND p.ends_on
  ) THEN
    RAISE EXCEPTION 'accounting period containing % is locked', NEW.entry_date
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.reverses_entry_id IS NOT NULL THEN
    SELECT org_id INTO original_org FROM journal_entry WHERE id = NEW.reverses_entry_id;
    IF original_org IS DISTINCT FROM NEW.org_id THEN
      RAISE EXCEPTION 'reversal must belong to the same organization' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER journal_entry_period_check
  BEFORE INSERT ON journal_entry
  FOR EACH ROW EXECUTE FUNCTION eve_journal_entry_period();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION eve_check_entry_balanced(target_entry text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  line_count integer;
  unbalanced text;
BEGIN
  -- The entry may have been removed by a scoped demo reset in this transaction.
  IF NOT EXISTS (SELECT 1 FROM journal_entry WHERE id = target_entry) THEN RETURN; END IF;
  SELECT count(*) INTO line_count FROM journal_line WHERE entry_id = target_entry;
  IF line_count < 2 THEN
    RAISE EXCEPTION 'journal entry % needs at least two lines (has %)', target_entry, line_count
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT string_agg(currency, ', ') INTO unbalanced FROM (
    SELECT currency FROM journal_line WHERE entry_id = target_entry
     GROUP BY currency HAVING sum(debit_minor) <> sum(credit_minor)
  ) u;
  IF unbalanced IS NOT NULL THEN
    RAISE EXCEPTION 'journal entry % does not balance (debits <> credits in %)', target_entry, unbalanced
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION eve_journal_balance_line() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM eve_check_entry_balanced(NEW.entry_id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION eve_journal_balance_entry() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM eve_check_entry_balanced(NEW.id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_line_balanced
  AFTER INSERT ON journal_line
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION eve_journal_balance_line();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_entry_has_lines
  AFTER INSERT ON journal_entry
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION eve_journal_balance_entry();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION eve_period_lock_one_way() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.locked AND NOT eve_demo_reset_allowed(OLD.org_id) THEN
      RAISE EXCEPTION 'locked accounting periods cannot be deleted' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.locked AND (NOT NEW.locked OR NEW.starts_on <> OLD.starts_on OR NEW.ends_on <> OLD.ends_on) THEN
    RAISE EXCEPTION 'locked accounting periods cannot be reopened or resized' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER accounting_period_one_way
  BEFORE UPDATE OR DELETE ON accounting_period
  FOR EACH ROW EXECUTE FUNCTION eve_period_lock_one_way();
--> statement-breakpoint
-- Approvals are evidence; they are append-only too.
CREATE OR REPLACE FUNCTION eve_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND eve_demo_reset_allowed(OLD.org_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER approval_append_only BEFORE UPDATE OR DELETE ON approval
  FOR EACH ROW EXECUTE FUNCTION eve_append_only();
--> statement-breakpoint
CREATE TRIGGER decision_log_append_only BEFORE UPDATE OR DELETE ON decision_log
  FOR EACH ROW EXECUTE FUNCTION eve_append_only();
