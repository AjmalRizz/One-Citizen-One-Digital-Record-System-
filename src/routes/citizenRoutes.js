const express = require('express');
const router = express.Router();
const {
  getCitizenById,
  searchCitizens,
  uploadCitizenPhoto,
  updateCitizenInfo,
  deleteCitizenPhoto,
  clearCitizenField,
  deleteCitizenRecord
} = require('../controllers/citizenController');
const { authenticateToken, authorizeRoles } = require('../middleware/authMiddleware');
const { upload } = require('../middleware/uploadMiddleware');

// Search endpoint for authorized roles
router.get(
  '/search',
  authenticateToken,
  authorizeRoles('HOSPITAL', 'SCHOOL', 'UNIVERSITY', 'POLICE', 'IMMIGRATION', 'REGISTRAR', 'ADMIN'),
  searchCitizens
);

// Upload citizen profile picture
router.post(
  '/:citizenId/photo',
  authenticateToken,
  upload.single('photo'),
  uploadCitizenPhoto
);

// Delete citizen profile picture (restore initials)
router.delete('/:citizenId/photo', authenticateToken, deleteCitizenPhoto);

// Clear specific citizen field (contact_phone, current_address)
router.delete('/:citizenId/field/:fieldName', authenticateToken, clearCitizenField);

// Update citizen information (Only ADMIN authorized)
router.put('/:citizenId', authenticateToken, authorizeRoles('ADMIN'), updateCitizenInfo);

// Delete or deactivate citizen record
router.delete('/:citizenId', authenticateToken, deleteCitizenRecord);

// Get partitioned citizen record based on requesting role
router.get('/:citizenId', authenticateToken, getCitizenById);

module.exports = router;
