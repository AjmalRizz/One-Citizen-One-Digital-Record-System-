const express = require('express');
const router = express.Router();
const {
  addMedicalRecord,
  addEducationRecord,
  registerBirth,
  addPassportRecord,
  addLicenceRecord,
  addMarriageRecord
} = require('../controllers/moduleController');
const { authenticateToken, authorizeRoles } = require('../middleware/authMiddleware');

// Healthcare Module: Add diagnosis / prescription (Hospital only)
router.post(
  '/medical/add',
  authenticateToken,
  authorizeRoles('HOSPITAL'),
  addMedicalRecord
);

// Education Module: Add school or higher education qualification (Citizen, School, University - NOT Admin)
router.post(
  '/education/add',
  authenticateToken,
  authorizeRoles('CITIZEN', 'SCHOOL', 'UNIVERSITY'),
  addEducationRecord
);

// Passport Module: Add passport details (Citizen, Immigration - NOT Admin)
router.post(
  '/passport/add',
  authenticateToken,
  authorizeRoles('CITIZEN', 'IMMIGRATION'),
  addPassportRecord
);
router.post(
  '/travel/passport/add',
  authenticateToken,
  authorizeRoles('CITIZEN', 'IMMIGRATION'),
  addPassportRecord
);

// Licence Module: Add driving licence details (Citizen, Police - NOT Admin)
router.post(
  '/licence/add',
  authenticateToken,
  authorizeRoles('CITIZEN', 'POLICE'),
  addLicenceRecord
);
router.post(
  '/travel/licence/add',
  authenticateToken,
  authorizeRoles('CITIZEN', 'POLICE'),
  addLicenceRecord
);

// Vital Statistics Module: Register new birth with atomic citizen creation (Citizen, Registrar - NOT Admin)
router.post(
  '/vital/register-birth',
  authenticateToken,
  authorizeRoles('CITIZEN', 'REGISTRAR'),
  registerBirth
);
router.post(
  '/vital/add-birth',
  authenticateToken,
  authorizeRoles('CITIZEN', 'REGISTRAR'),
  registerBirth
);

// Vital Statistics Module: Register civil marriage (Citizen, Registrar - NOT Admin)
router.post(
  '/vital/marriage/add',
  authenticateToken,
  authorizeRoles('CITIZEN', 'REGISTRAR'),
  addMarriageRecord
);

module.exports = router;

