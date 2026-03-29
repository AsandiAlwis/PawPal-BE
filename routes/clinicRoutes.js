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
  getClinicsForOwner,
  getClinicStaff,
  addClinicStaff,
  getClinicStaffCount,
  getClinicStaffById,
  updateClinicStaff,
  deactivateClinicStaff,
  activateClinicStaff,
  deleteClinicStaff
} = require('../controllers/clinicController');

const { protect, authorize, authorizeVetAccess } = require('../middleware/auth');

// === Public Routes ===
router.get('/nearby', getNearbyClinics);
router.get('/search', searchClinics);
router.get('/', getAllClinics);

// === Protected Routes ===
router.get('/my', protect, getMyClinic);
router.get('/my-owner', protect, authorize('owner'), getClinicsForOwner);

// STAFF ROUTES - MUST COME BEFORE /:id !!!
router.get('/staff', protect, authorize('vet'), authorizeVetAccess('Enhanced'), getClinicStaff);
router.post('/staff', protect, authorize('vet'), authorizeVetAccess('Enhanced'), addClinicStaff);

// === Clinic CRUD - :id routes LAST ===
router.get('/:id', getClinicById);                    // Now only matches real ObjectIds
router.put('/:id', protect, updateClinic);
router.delete('/:id', protect, authorize('vet'), authorizeVetAccess('Enhanced'), deleteClinic);

router.post('/', protect, authorize('vet'), createClinic);

// routes/clinicRoutes.js
router.get(
  '/:clinicId/staff-count',
  protect,
  getClinicStaffCount
);

router.get('/staff/:id', protect, authorize('vet'), authorizeVetAccess('Enhanced'), getClinicStaffById);
router.put('/staff/:id', protect, authorize('vet'), authorizeVetAccess('Enhanced'), updateClinicStaff);
router.patch('/staff/:id/deactivate', protect, authorize('vet'), authorizeVetAccess('Enhanced'), deactivateClinicStaff);
router.patch('/staff/:id/activate', protect, authorize('vet'), authorizeVetAccess('Enhanced'), activateClinicStaff);
router.delete('/staff/:id', protect, authorize('vet'), authorizeVetAccess('Enhanced'), deleteClinicStaff);

module.exports = router;