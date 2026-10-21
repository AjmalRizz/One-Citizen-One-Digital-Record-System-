/**
 * Migration: Add profile_picture column to citizens and users tables
 */
const { pool } = require('../config/db');

async function migrate() {
  console.log('[Migration] Checking and adding profile_picture columns...');
  try {
    // Check citizens table
    const [cCols] = await pool.query("SHOW COLUMNS FROM citizens LIKE 'profile_picture'");
    if (cCols.length === 0) {
      await pool.query('ALTER TABLE citizens ADD COLUMN profile_picture VARCHAR(255) NULL AFTER blood_group');
      console.log('[Migration] Added column profile_picture to citizens table.');
    } else {
      console.log('[Migration] Column profile_picture already exists in citizens table.');
    }

    // Check users table
    const [uCols] = await pool.query("SHOW COLUMNS FROM users LIKE 'profile_picture'");
    if (uCols.length === 0) {
      await pool.query('ALTER TABLE users ADD COLUMN profile_picture VARCHAR(255) NULL AFTER email');
      console.log('[Migration] Added column profile_picture to users table.');
    } else {
      console.log('[Migration] Column profile_picture already exists in users table.');
    }

    console.log('[Migration] Schema migration completed successfully.');
    process.exit(0);
  } catch (error) {
    console.error('[Migration Error]', error.message);
    process.exit(1);
  }
}

migrate();
