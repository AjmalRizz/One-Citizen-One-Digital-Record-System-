const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'ocodr_db',
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  waitForConnections: true,
  connectionLimit: 15,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  timezone: 'Z',
  dateStrings: true
});

// Test connection on startup and ensure schema extensions
async function ensureSchema(connection) {
  const addCol = async (table, col, def) => {
    try {
      await connection.query(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    } catch (e) {
      if (e.code !== 'ER_DUP_FIELDNAME') {
        // Suppress benign duplicate column errors
      }
    }
  };

  await addCol('birth_registrations', 'father_name', 'VARCHAR(150) NULL');
  await addCol('birth_registrations', 'father_nic', 'VARCHAR(30) NULL');
  await addCol('birth_registrations', 'father_phone', 'VARCHAR(30) NULL');
  await addCol('birth_registrations', 'mother_name', 'VARCHAR(150) NULL');
  await addCol('birth_registrations', 'mother_nic', 'VARCHAR(30) NULL');
  await addCol('birth_registrations', 'mother_phone', 'VARCHAR(30) NULL');
  await addCol('birth_registrations', 'informant_phone', 'VARCHAR(30) NULL');
  await addCol('birth_registrations', 'informant_nic', 'VARCHAR(30) NULL');

  await addCol('citizens', 'is_child', 'TINYINT(1) DEFAULT 0');
  await addCol('citizens', 'father_name', 'VARCHAR(150) NULL');
  await addCol('citizens', 'father_nic', 'VARCHAR(30) NULL');
  await addCol('citizens', 'mother_name', 'VARCHAR(150) NULL');
  await addCol('citizens', 'mother_nic', 'VARCHAR(30) NULL');

  try {
    await connection.query('ALTER TABLE marriages MODIFY COLUMN spouse_two_id VARCHAR(20) NULL');
  } catch (e) {}
  await addCol('marriages', 'spouse_two_name', 'VARCHAR(150) NULL');
}

async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log(`[Database] Connected successfully to MySQL database "${process.env.DB_NAME || 'ocodr_db'}" on ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 3306}`);
    await ensureSchema(connection);
    connection.release();
    return true;
  } catch (error) {
    console.error('[Database Error] Failed to connect to MySQL database:', error.message);
    return false;
  }
}

module.exports = {
  pool,
  testConnection
};
