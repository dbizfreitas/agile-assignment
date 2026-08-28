-- Isolado em migration própria: um valor de enum recém-criado não pode ser
-- usado (comparado/castado) na mesma transação em que foi adicionado. A
-- trigger da próxima migration referencia estes dois valores.
ALTER TYPE public.role_audit_action ADD VALUE 'route_grant';
ALTER TYPE public.role_audit_action ADD VALUE 'route_revoke';
