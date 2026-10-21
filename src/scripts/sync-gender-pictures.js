const { pool } = require('../config/db');

async function syncPictures() {
  try {
    console.log('[Sync] Updating default pictures for citizens based on gender...');
    const [resM] = await pool.query(
      "UPDATE citizens SET profile_picture = '/uploads/citizen_bilaal.jpg' WHERE (profile_picture IS NULL OR profile_picture = '/uploads/citizen_yumna.jpg') AND UPPER(gender) IN ('M', 'MALE')"
    );
    console.log(`[Sync] Updated ${resM.affectedRows} male citizens to citizen_bilaal.jpg.`);

    const [resF] = await pool.query(
      "UPDATE citizens SET profile_picture = '/uploads/citizen_yumna.jpg' WHERE (profile_picture IS NULL OR profile_picture = '/uploads/citizen_bilaal.jpg') AND UPPER(gender) IN ('F', 'FEMALE')"
    );
    console.log(`[Sync] Updated ${resF.affectedRows} female citizens to citizen_yumna.jpg.`);

    // Reactivate default citizen user if needed
    await pool.query("UPDATE users SET is_active = 1, profile_picture = '/uploads/citizen_yumna.jpg' WHERE username = 'citizen'");
    console.log('[Sync] Ensured citizen user is active with female photo.');

    const [citizens] = await pool.query("SELECT citizen_id, first_name, last_name, gender, profile_picture FROM citizens");
    console.log('[Sync] Current citizens list:');
    citizens.forEach(c => console.log(` - ${c.first_name} ${c.last_name} (${c.gender}): ${c.profile_picture}`));
  } catch (err) {
    console.error('[Sync Error]', err);
  } finally {
    await pool.end();
  }
}

syncPictures();
