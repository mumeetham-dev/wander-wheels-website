UPDATE site_settings SET setting_value = '"+94716240412"' WHERE setting_key = 'contact_phone';
UPDATE site_settings SET setting_value = '"94716240412"' WHERE setting_key = 'whatsapp_number';
SELECT setting_key, setting_value FROM site_settings WHERE is_public;
