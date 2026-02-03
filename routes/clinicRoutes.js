// clinicRoutes.js
const express = require('express');
const router = express.Router();
const {
  createClinic,
  getNearbyClinics,
  getClinicById,
  updateClinic,
  deleteClinic,
  searchClinics,
  getAllClinics,
  getMyClinic,
  getClinicStaff,   
  addClinicStaff,
  getClinicStaffCount,
  getClinicStaffById,
  updateClinicStaff,
  deactivateClinicStaff,
  activateClinicStaff
} = require('../controllers/clinicController');

const { protect, authorize, authorizeVetAccess } = require('../middleware/auth');

// === Public Routes ===
router.get('/nearby', getNearbyClinics);
router.get('/search', searchClinics);
router.get('/', getAllClinics);

// === Protected Vet Routes ===
router.get('/my', protect, getMyClinic);

// STAFF ROUTES - MUST COME BEFORE /:id !!!
router.get('/staff', protect, authorize('vet'), authorizeVetAccess('Primary', 'Full Access'), getClinicStaff);
router.post('/staff', protect, authorize('vet'), authorizeVetAccess('Primary', 'Full Access'), addClinicStaff);

// === Clinic CRUD - :id routes LAST ===
router.get('/:id', getClinicById);                    // Now only matches real ObjectIds
router.put('/:id', protect, updateClinic);
router.delete('/:id', protect, authorize('vet'), authorizeVetAccess('Primary'), deleteClinic);

router.post('/', protect, authorize('vet'), createClinic);

// routes/clinicRoutes.js
router.get(
  '/:clinicId/staff-count',
  protect,
  getClinicStaffCount
);

router.get('/staff/:id', protect, authorize('vet'), authorizeVetAccess('Primary', 'Full Access'), getClinicStaffById);
router.put('/staff/:id', protect, authorize('vet'), authorizeVetAccess('Primary', 'Full Access'), updateClinicStaff);
router.patch('/staff/:id/deactivate', protect, authorize('vet'), authorizeVetAccess('Primary', 'Full Access'), deactivateClinicStaff);
router.patch('/staff/:id/activate', protect, authorize('vet'), authorizeVetAccess('Primary', 'Full Access'), activateClinicStaff);

module.exports = router;