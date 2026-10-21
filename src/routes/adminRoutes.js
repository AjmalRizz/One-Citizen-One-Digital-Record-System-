const express = require('express');
const router = express.Router();
const {
  getOverviewCounts,
  getAllCitizens,
  deleteCitizen,
  getAllHospitalRecords,
  deleteHospitalRecord,
  getAllSchoolRecords,
  deleteSchoolRecord,
  getAllUniversityRecords,
  deleteUniversityRecord,
  getAllPoliceRecords,
  deletePoliceRecord,
  getAllImmigrationRecords,
  deleteImmigrationRecord,
  getAllRegistrarRecords,
  deleteRegistrarRecord
} = require('../controllers/adminController');
const { authenticateToken, authorizeRoles } = require('../middleware/authMiddleware');

// All admin routes require ADMIN role authentication
router.use(authenticateToken, authorizeRoles('ADMIN'));

// Sector Overview Statistics
router.get('/overview-counts', getOverviewCounts);

// Sector 1: Citizens
router.get('/citizens', getAllCitizens);
router.delete('/citizens/:citizenId', deleteCitizen);

// Sector 2: Hospital (Medical)
router.get('/hospital', getAllHospitalRecords);
router.delete('/hospital/:id', deleteHospitalRecord);

// Sector 3: School (Education)
router.get('/school', getAllSchoolRecords);
router.delete('/school/:id', deleteSchoolRecord);

// Sector 4: University (Higher Education)
router.get('/university', getAllUniversityRecords);
router.delete('/university/:id', deleteUniversityRecord);

// Sector 5: Police (Driving Licences)
router.get('/police', getAllPoliceRecords);
router.delete('/police/:id', deletePoliceRecord);

// Sector 6: Immigration (Passports)
router.get('/immigration', getAllImmigrationRecords);
router.delete('/immigration/:id', deleteImmigrationRecord);

// Sector 7: Registrar (Civil & Vital)
router.get('/registrar', getAllRegistrarRecords);
router.delete('/registrar/birth/:id', deleteRegistrarRecord);

module.exports = router;
