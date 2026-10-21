-- Audit logs are append-only: block UPDATE, DELETE and TRUNCATE for every role.
CREATE OR REPLACE FUNCTION ems_block_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (% blocked)', TG_OP USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION ems_block_audit_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION ems_block_audit_mutation();
--> statement-breakpoint
-- Issued payslips are frozen documents.
CREATE OR REPLACE FUNCTION ems_block_payslip_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'payslips are immutable once issued (% blocked)', TG_OP USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER payslips_immutable
  BEFORE UPDATE OR DELETE ON payslips
  FOR EACH ROW EXECUTE FUNCTION ems_block_payslip_mutation();
--> statement-breakpoint
-- Approved payroll records are financially final. Only payment tracking and
-- superseding (by an approved revision) may change; amounts can never be edited.
CREATE OR REPLACE FUNCTION ems_guard_final_payroll() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('approved', 'superseded') THEN
      RAISE EXCEPTION 'finalized payroll records cannot be deleted' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'superseded' THEN
    RAISE EXCEPTION 'superseded payroll records are immutable' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'approved' THEN
    IF NEW.basic_salary IS DISTINCT FROM OLD.basic_salary
      OR NEW.gross_earnings IS DISTINCT FROM OLD.gross_earnings
      OR NEW.total_deductions IS DISTINCT FROM OLD.total_deductions
      OR NEW.net_pay IS DISTINCT FROM OLD.net_pay
      OR NEW.currency IS DISTINCT FROM OLD.currency
      OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
      OR NEW.period_id IS DISTINCT FROM OLD.period_id
      OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
      OR NEW.prepared_by IS DISTINCT FROM OLD.prepared_by
      OR NEW.status NOT IN ('approved', 'superseded') THEN
      RAISE EXCEPTION 'approved payroll records are immutable; create an adjustment revision' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER payroll_records_guard
  BEFORE UPDATE OR DELETE ON payroll_records
  FOR EACH ROW EXECUTE FUNCTION ems_guard_final_payroll();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION ems_guard_final_payroll_items() RETURNS trigger AS $$
DECLARE
  rec_status text;
BEGIN
  SELECT status INTO rec_status FROM payroll_records
    WHERE id = COALESCE(NEW.record_id, OLD.record_id);
  IF rec_status IN ('approved', 'superseded', 'pending_approval') THEN
    RAISE EXCEPTION 'line items are locked once a payroll record is submitted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER payroll_line_items_guard
  BEFORE INSERT OR UPDATE OR DELETE ON payroll_line_items
  FOR EACH ROW EXECUTE FUNCTION ems_guard_final_payroll_items();
--> statement-breakpoint
-- Employment numbers are permanent once issued.
CREATE OR REPLACE FUNCTION ems_guard_employment_number() RETURNS trigger AS $$
BEGIN
  IF OLD.employment_number IS NOT NULL AND NEW.employment_number IS DISTINCT FROM OLD.employment_number THEN
    RAISE EXCEPTION 'employment numbers are immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER employees_number_immutable
  BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION ems_guard_employment_number();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION ems_block_employee_delete() RETURNS trigger AS $$
BEGIN
  IF OLD.employment_number IS NOT NULL THEN
    RAISE EXCEPTION 'issued employment records are archived, never deleted' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER employees_no_delete
  BEFORE DELETE ON employees
  FOR EACH ROW EXECUTE FUNCTION ems_block_employee_delete();
