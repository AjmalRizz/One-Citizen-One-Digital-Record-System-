const { pool } = require('../config/db');

/**
 * GET /api/audit/logs
 * ADMIN only: Paginated audit logs with search and filter capabilities
 */
async function getAuditLogs(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const { action_type, module_accessed, target_citizen_id, user_id } = req.query;

    let whereClauses = [];
    let params = [];

    if (action_type) {
      whereClauses.push(`a.action_type = ?`);
      params.push(action_type.toUpperCase());
    }

    if (module_accessed) {
      whereClauses.push(`a.module_accessed LIKE ?`);
      params.push(`%${module_accessed}%`);
    }

    if (target_citizen_id) {
      whereClauses.push(`a.target_citizen_id LIKE ?`);
      params.push(`%${target_citizen_id}%`);
    }

    if (user_id) {
      whereClauses.push(`a.user_id = ?`);
      params.push(parseInt(user_id, 10));
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // Count total matching records
    const [countRows] = await pool.query(
      `SELECT COUNT(*) as total FROM audit_logs a ${whereSql}`,
      params
    );
    const total = countRows[0].total;

    // Fetch paginated logs with joined username and role
    const [rows] = await pool.query(
      `SELECT a.log_id, a.user_id, a.action_type, a.module_accessed, a.target_citizen_id,
              a.ip_address, a.user_agent, a.timestamp,
              u.username, r.role_name
       FROM audit_logs a
       LEFT JOIN users u ON a.user_id = u.user_id
       LEFT JOIN roles r ON u.role_id = r.role_id
       ${whereSql}
       ORDER BY a.timestamp DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return res.status(200).json({
      success: true,
      pagination: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit) || 1
      },
      data: rows
    });
  } catch (error) {
    console.error('[getAuditLogs Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve audit log records.',
      error: error.message
    });
  }
}

module.exports = {
  getAuditLogs
};
