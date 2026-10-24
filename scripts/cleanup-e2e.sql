-- Remove end-to-end test records. Real catalog/owner rows are untouched.
DELETE FROM reviews WHERE public_name IN ('E2E Reviewer');
DELETE FROM booking_notes WHERE booking_id IN (SELECT id FROM bookings WHERE customer_name = 'E2E Customer');
DELETE FROM booking_status_history WHERE booking_id IN (SELECT id FROM bookings WHERE customer_name = 'E2E Customer');
DELETE FROM booking_quote_history WHERE booking_id IN (SELECT id FROM bookings WHERE customer_name = 'E2E Customer');
DELETE FROM bookings WHERE customer_name = 'E2E Customer';
DELETE FROM vehicles WHERE display_name LIKE 'E2E Test Tuk%';
SELECT (SELECT count(*) FROM bookings) AS bookings, (SELECT count(*) FROM reviews) AS reviews, (SELECT count(*) FROM vehicles) AS vehicles;
