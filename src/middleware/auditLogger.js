const { pool } = require('../config/db');

/**
 * Persist an entry to the audit_logs table
 * @param {Object} params
 * @param {number} params.userId
 * @param {'VIEW'|'CREATE'|'UPDATE'|'DELETE'|'EXPORT'} params.actionType
 * @param {string} params.moduleAccessed
 * @param {string} params.targetCitizenId
 * @param {string} params.ipAddress
 * @param {string} params.userAgent
 */
async function logAudit({
  userId,
  actionType = 'VIEW',
  moduleAccessed,
  targetCitizenId,
  ipAddress = '127.0.0.1',
  userAgent = ''
}) {
  try {
    // Sanitize values
    const safeIp = (ipAddress || '127.0.0.1').replace('::ffff:', '').substring(0, 45);
    const safeUserAgent = (userAgent || 'UNKNOWN').substring(0, 255);
    const safeModule = (moduleAccessed || 'GENERAL').substring(0, 50);

    // Ensure targetCitizenId actually exists in citizens table or pass null
    let safeCitizenId = null;
    if (targetCitizenId && targetCitizenId !== 'N/A' && targetCitizenId !== 'UNKNOWN') {
      try {
        const [cCheck] = await pool.query('SELECT citizen_id FROM citizens WHERE citizen_id = ?', [targetCitizenId]);
        if (cCheck.length > 0) {
          safeCitizenId = cCheck[0].citizen_id;
        }
      } catch (err) {
        safeCitizenId = null;
      }
    }

    const validActions = ['VIEW', 'CREATE', 'UPDATE', 'DELETE', 'EXPORT'];
    const safeAction = validActions.includes(actionType) ? actionType : 'VIEW';

    await pool.query(
      `INSERT INTO audit_logs (user_id, action_type, module_accessed, target_citizen_id, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, safeAction, safeModule, safeCitizenId, safeIp, safeUserAgent]
    );
  } catch (error) {
    console.error('[Audit Logger Error] Failed to write audit log:', error.message);
  }
}

/**
 * Express middleware helper to automatically extract IP and user agent
 */
function auditMiddleware(actionType, moduleAccessed, getCitizenIdFn) {
  return async (req, res, next) => {
    // Call next first, then log response or log immediately
    const targetCitizenId = getCitizenIdFn
      ? getCitizenIdFn(req)
      : (req.params.citizenId || req.body.citizen_id || 'N/A');

    const userId = req.user ? req.user.user_id : 1;
    const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || '';

    // Log in background
    logAudit({
      userId,
      actionType,
      moduleAccessed,
      targetCitizenId,
      ipAddress,
      userAgent
    }).catch(err => console.error('[AuditMW Error]', err.message));

    next();
  };
}

module.exports = {
  logAudit,
  auditMiddleware
};
