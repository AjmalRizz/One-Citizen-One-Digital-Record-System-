const path = require('path');
const fs = require('fs');
const { pool } = require('../config/db');
const { logAudit } = require('../middleware/auditLogger');
const { uploadDir } = require('../middleware/uploadMiddleware');

/**
 * POST /api/documents/upload
 * Upload document metadata and file to /uploads
 */
async function uploadDocument(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No document file uploaded. Supported formats: PDF, PNG, JPEG, WebP.'
      });
    }

    const {
      citizen_id,
      module_category = 'MEDICAL',
      document_title
    } = req.body;

    if (!citizen_id || !document_title) {
      // Clean up uploaded file if validation fails
      if (req.file.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({
        success: false,
        message: 'citizen_id and document_title are required.'
      });
    }

    const validCategories = ['BIRTH', 'MEDICAL', 'EDUCATION', 'PASSPORT', 'PROPERTY', 'MARRIAGE', 'DEATH'];
    const category = validCategories.includes(module_category.toUpperCase())
      ? module_category.toUpperCase()
      : 'MEDICAL';

    // Verify citizen existence
    const [citizenRows] = await pool.query(
      `SELECT citizen_id FROM citizens WHERE citizen_id = ?`,
      [citizen_id]
    );
    if (citizenRows.length === 0) {
      if (req.file.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(404).json({
        success: false,
        message: `Citizen with ID '${citizen_id}' not found.`
      });
    }

    const relativeFilePath = path.relative(path.resolve(__dirname, '..', '..'), req.file.path).replace(/\\/g, '/');

    const [result] = await pool.query(
      `INSERT INTO document_uploads
       (citizen_id, module_category, document_title, file_path, file_mime_type, uploaded_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        citizen_id,
        category,
        document_title.trim(),
        relativeFilePath,
        req.file.mimetype,
        req.user.user_id
      ]
    );

    // Audit log
    await logAudit({
      userId: req.user.user_id,
      actionType: 'CREATE',
      moduleAccessed: `DOCUMENT_UPLOAD_${category}`,
      targetCitizenId: citizen_id,
      ipAddress: req.ip || req.connection?.remoteAddress || '127.0.0.1',
      userAgent: req.headers['user-agent'] || 'UNKNOWN'
    });

    return res.status(201).json({
      success: true,
      message: 'Document uploaded and registered successfully.',
      doc_id: result.insertId,
      document: {
        doc_id: result.insertId,
        citizen_id,
        module_category: category,
        document_title,
        file_mime_type: req.file.mimetype,
        file_path: relativeFilePath,
        original_name: req.file.originalname,
        size_bytes: req.file.size
      }
    });
  } catch (error) {
    console.error('[uploadDocument Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to upload and store document.',
      error: error.message
    });
  }
}

/**
 * GET /api/documents/:citizenId
 * Retrieve list of uploaded documents for a citizen
 */
async function getCitizenDocuments(req, res) {
  try {
    const { citizenId } = req.params;
    const userRole = (req.user.role_name || '').toUpperCase();

    if (userRole === 'CITIZEN' && req.user.associated_citizen_id !== citizenId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You can only view your own uploaded documents.'
      });
    }

    let query = `
      SELECT d.doc_id, d.citizen_id, d.module_category, d.document_title,
             d.file_path, d.file_mime_type, d.uploaded_at, u.username as uploaded_by
      FROM document_uploads d
      LEFT JOIN users u ON d.uploaded_by_user_id = u.user_id
      WHERE d.citizen_id = ?
    `;
    const params = [citizenId];

    // Filter by role category if applicable
    if (userRole === 'HOSPITAL') {
      query += ` AND d.module_category = 'MEDICAL'`;
    } else if (userRole === 'SCHOOL' || userRole === 'UNIVERSITY') {
      query += ` AND d.module_category = 'EDUCATION'`;
    } else if (userRole === 'POLICE' || userRole === 'IMMIGRATION') {
      query += ` AND d.module_category IN ('PASSPORT', 'BIRTH')`;
    }

    query += ` ORDER BY d.uploaded_at DESC`;

    const [rows] = await pool.query(query, params);

    // Audit log
    await logAudit({
      userId: req.user.user_id,
      actionType: 'VIEW',
      moduleAccessed: 'DOCUMENT_LIST',
      targetCitizenId: citizenId,
      ipAddress: req.ip || req.connection?.remoteAddress || '127.0.0.1',
      userAgent: req.headers['user-agent'] || 'UNKNOWN'
    });

    return res.status(200).json({
      success: true,
      data: rows
    });
  } catch (error) {
    console.error('[getCitizenDocuments Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve documents.',
      error: error.message
    });
  }
}

/**
 * GET /api/documents/file/:docId
 * Stream document content to authorized user
 */
async function downloadDocument(req, res) {
  try {
    const { docId } = req.params;

    const [rows] = await pool.query(
      `SELECT * FROM document_uploads WHERE doc_id = ?`,
      [docId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Document record not found.'
      });
    }

    const doc = rows[0];
    const userRole = (req.user.role_name || '').toUpperCase();

    if (userRole === 'CITIZEN' && req.user.associated_citizen_id !== doc.citizen_id) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized access to document.'
      });
    }

    const absolutePath = path.resolve(__dirname, '..', '..', doc.file_path);
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({
        success: false,
        message: 'Underlying file not found on disk storage.'
      });
    }

    // Audit log document view
    await logAudit({
      userId: req.user.user_id,
      actionType: 'VIEW',
      moduleAccessed: `DOCUMENT_FILE_${doc.module_category}`,
      targetCitizenId: doc.citizen_id,
      ipAddress: req.ip || req.connection?.remoteAddress || '127.0.0.1',
      userAgent: req.headers['user-agent'] || 'UNKNOWN'
    });

    res.setHeader('Content-Type', doc.file_mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${doc.document_title}${path.extname(doc.file_path)}"`);
    const stream = fs.createReadStream(absolutePath);
    return stream.pipe(res);
  } catch (error) {
    console.error('[downloadDocument Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to stream document.',
      error: error.message
    });
  }
}

/**
 * DELETE /api/documents/:docId
 * Delete an uploaded civil document file and database record
 */
async function deleteDocument(req, res) {
  const { docId } = req.params;
  const userRole = (req.user.role_name || '').toUpperCase();
  const userId = req.user.user_id;

  try {
    const [rows] = await pool.query(
      `SELECT doc_id, citizen_id, module_category, document_title, file_path, uploaded_by_user_id
       FROM document_uploads WHERE doc_id = ?`,
      [docId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Document not found.'
      });
    }

    const doc = rows[0];

    // Authorization: Citizens are strictly prohibited from deleting documents.
    if (userRole === 'CITIZEN') {
      return res.status(403).json({
        success: false,
        message: 'Security Violation: Citizens are not permitted to delete information or documents.'
      });
    }

    if (!['ADMIN', 'REGISTRAR'].includes(userRole) && doc.uploaded_by_user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Your role is not authorized to delete documents.'
      });
    }

    // Unlink physical file from disk
    const absolutePath = path.resolve(__dirname, '..', '..', doc.file_path);
    if (fs.existsSync(absolutePath)) {
      try {
        fs.unlinkSync(absolutePath);
      } catch (err) {
        console.warn(`[deleteDocument] Failed to unlink file ${absolutePath}:`, err.message);
      }
    }

    // Delete record from database
    await pool.query('DELETE FROM document_uploads WHERE doc_id = ?', [docId]);

    // Audit log
    await logAudit({
      userId,
      actionType: 'DELETE',
      moduleAccessed: `DOCUMENT_DELETE_${doc.module_category}`,
      targetCitizenId: doc.citizen_id,
      ipAddress: req.ip || req.connection?.remoteAddress || '127.0.0.1',
      userAgent: req.headers['user-agent'] || 'UNKNOWN'
    });

    return res.status(200).json({
      success: true,
      message: `Document '${doc.document_title}' was successfully deleted.`
    });
  } catch (error) {
    console.error('[deleteDocument Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete document.',
      error: error.message
    });
  }
}

module.exports = {
  uploadDocument,
  getCitizenDocuments,
  downloadDocument,
  deleteDocument
};
