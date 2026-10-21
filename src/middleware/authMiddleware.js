const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const { logAudit } = require('./auditLogger');

dotenv.config();

/**
 * Middleware: Authenticates JWT from Authorization header
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Access Denied: Missing authentication token.'
    });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decodedUser) => {
    if (err) {
      return res.status(403).json({
        success: false,
        message: 'Invalid, corrupted, or expired session token.'
      });
    }

    req.user = decodedUser;
    next();
  });
}

/**
 * Middleware: Authorizes specific role names
 * @param  {...string} allowedRoles 
 */
function authorizeRoles(...allowedRoles) {
  return async (req, res, next) => {
    if (!req.user || !req.user.role_name) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: User context not found.'
      });
    }

    const normalizedAllowed = allowedRoles.map(r => r.toUpperCase());
    const userRole = req.user.role_name.toUpperCase();

    // ADMIN always has overarching access if needed or check role
    if (!normalizedAllowed.includes(userRole) && userRole !== 'ADMIN') {
      // Log unauthorized access attempt
      try {
        await logAudit({
          userId: req.user.user_id,
          actionType: 'VIEW',
          moduleAccessed: 'ACCESS_CONTROL',
          targetCitizenId: req.params.citizenId || req.body.citizen_id || 'UNKNOWN',
          ipAddress: req.ip || req.connection?.remoteAddress || '127.0.0.1',
          userAgent: req.headers['user-agent'] || 'UNKNOWN',
          notes: `Forbidden access attempt by ${userRole} to route requiring [${allowedRoles.join(', ')}]`
        });
      } catch (logErr) {
        console.error('[Audit Error in authorizeRoles]', logErr.message);
      }

      return res.status(403).json({
        success: false,
        message: `Forbidden: Your role (${req.user.role_name}) does not have permission to access this resource.`
      });
    }

    next();
  };
}

module.exports = {
  authenticateToken,
  authorizeRoles
};
