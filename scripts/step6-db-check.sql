-- Step 6 checks: injection tables intact, payloads stored literally, history written.
SELECT count(*) AS bookings FROM bookings;
SELECT booking_code, customer_name, status FROM bookings ORDER BY created_at;
SELECT count(*) AS history_rows FROM booking_status_history;
SELECT booking_code, left(extra_requests, 80) AS extra FROM bookings WHERE extra_requests LIKE '%script%';
SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'bookings';
