-- Step 6 cleanup: test bookings + disabled test editor. Catalog/owner untouched.
DELETE FROM booking_notes WHERE booking_id IN (SELECT id FROM bookings WHERE customer_name = 'T6 Customer');
DELETE FROM booking_status_history WHERE booking_id IN (SELECT id FROM bookings WHERE customer_name = 'T6 Customer');
DELETE FROM booking_quote_history WHERE booking_id IN (SELECT id FROM bookings WHERE customer_name = 'T6 Customer');
DELETE FROM reviews WHERE booking_id IN (SELECT id FROM bookings WHERE customer_name = 'T6 Customer');
DELETE FROM bookings WHERE customer_name = 'T6 Customer';
DELETE FROM admin_sessions WHERE admin_id IN (SELECT id FROM admins WHERE email = 't6editor@gmail.com');
DELETE FROM admins WHERE email = 't6editor@gmail.com';
SELECT (SELECT count(*) FROM bookings) AS bookings,
       (SELECT count(*) FROM reviews) AS reviews,
       (SELECT count(*) FROM vehicles) AS vehicles;
SELECT email, role, is_active FROM admins;
