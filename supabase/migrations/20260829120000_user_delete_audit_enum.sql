-- Isolado em migration própria: um valor de enum recém-criado não pode ser
-- usado (comparado/castado) na mesma transação em que foi adicionado. A RPC
-- da próxima migration referencia 'delete' — mesma restrição já documentada
-- em 20260828132000_route_access_audit_enum.sql.
ALTER TYPE public.role_audit_action ADD VALUE 'delete';
