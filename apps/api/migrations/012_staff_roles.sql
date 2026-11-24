UPDATE accounts SET role='operator',name=CASE WHEN email='dispatcher@farvater.test' AND name='Анна · диспетчер'
  THEN 'Анна' ELSE name END WHERE role='dispatcher';
UPDATE invitations SET role='operator' WHERE role='dispatcher';

ALTER TABLE accounts DROP CONSTRAINT accounts_role_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_role_check CHECK(role IN ('manager','operator','driver'));
ALTER TABLE invitations DROP CONSTRAINT invitations_role_check;
ALTER TABLE invitations ADD CONSTRAINT invitations_role_check CHECK(role IN ('operator','driver'));

CREATE INDEX audit_staff_activity ON audit (actor,id DESC);
