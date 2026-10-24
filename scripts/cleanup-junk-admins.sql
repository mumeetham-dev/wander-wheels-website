-- Remove junk admin accounts created while a stale server was running.
DELETE FROM admin_sessions WHERE admin_id IN (
  SELECT id FROM admins WHERE email IN (
    'fake@wanderwheels-invalid-xyz123.com',
    'someone@gmail.con',
    'wanderwheels.e2e.test@gmail.com'
  )
);
DELETE FROM admins WHERE email IN (
  'fake@wanderwheels-invalid-xyz123.com',
  'someone@gmail.con',
  'wanderwheels.e2e.test@gmail.com'
);
SELECT email, role, is_active FROM admins;
