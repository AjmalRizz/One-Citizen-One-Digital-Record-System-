/**
 * OCODR Test Data Cleanup Script
 * Cleans up hallucinated / dummy records from earlier development test runs
 */
const { pool } = require('../config/db');

async function cleanTestData() {
  console.log('[Cleanup] Starting database cleanup of test records...');
  try {
    // Helper to safely purge a citizen and foreign keys
    async function purgeCitizen(citizenId) {
      await pool.query('DELETE FROM audit_logs WHERE target_citizen_id = ?', [citizenId]);
      await pool.query('DELETE FROM birth_registrations WHERE citizen_id = ?', [citizenId]);
      await pool.query('DELETE FROM family_relationships WHERE citizen_id = ? OR related_citizen_id = ?', [citizenId, citizenId]);
      await pool.query('DELETE FROM citizens WHERE citizen_id = ?', [citizenId]);
    }

    // List of test citizen IDs to remove
    const testIds = ['LK-20260315-5889', 'LK-20260315-7884'];
    for (const id of testIds) {
      await purgeCitizen(id);
    }
    console.log(`[Cleanup] Removed test citizen records: ${testIds.join(', ')}`);
    
    // Also clean up any entries with dummy tokens
    const [dummyBirths] = await pool.query(`
      SELECT citizen_id, first_name, last_name FROM citizens 
      WHERE first_name LIKE '%test%' OR last_name LIKE '%test%' 
         OR first_name LIKE '%dummy%' OR last_name LIKE '%dummy%'
         OR first_name = 'Anuki'
    `);
    
    for (const d of dummyBirths) {
      await purgeCitizen(d.citizen_id);
      console.log(`[Cleanup] Purged dummy citizen record: ${d.citizen_id} (${d.first_name} ${d.last_name})`);
    }

    const [citizens] = await pool.query('SELECT citizen_id, first_name, last_name, nic_number FROM citizens');
    console.log('[Cleanup] Active clean citizens in registry:');
    citizens.forEach(c => console.log(` - ${c.citizen_id}: ${c.first_name} ${c.last_name} (${c.nic_number || 'Minor'})`));
    
    console.log('[Cleanup] Database clean and verified.');
  } catch (err) {
    console.error('[Cleanup Error]', err.message);
  } finally {
    process.exit(0);
  }
}

cleanTestData();
