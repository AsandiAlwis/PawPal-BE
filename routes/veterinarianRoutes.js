const express = require('express');
const router = express.Router();
const {
  registerVet,
  createSubAccount,
  getVetsByClinic,
  getVetById,
  updateVet,
  deactivateVet,
  getClinicStaffStats
} = require('../controllers/veterinarianController');

// Import middleware
const { protect, authorize, authorizeVetAccess } = require('../middleware/auth');
const Veterinarian = require('../models/Veterinarian');

// === Public Route ===
router.post('/register', registerVet);

// === All routes below require authentication ===
router.use(protect);
router.use(authorize('vet')); // All vet routes require vet role

// View own profile or any vet profile (useful for clinic directory)
router.get('/:id', getVetById);

// Update own profile only
router.put('/:id', (req, res, next) => {
  if (req.params.id === req.user.id) {
    return updateVet(req, res, next);
  }
  return res.status(403).json({
    message: 'You can only update your own profile'
  });
});

// Get all vets in your own clinic
router.get('/clinic/:clinicId', async (req, res, next) => {
  if (req.params.clinicId !== req.user.clinicId?.toString()) {
    return res.status(403).json({
      message: 'Not authorized: You can only view staff from your own clinic'
    });
  }
  getVetsByClinic(req, res, next);
});

// Create sub-account (Primary or Full Access only)
router.post('/sub-account', authorizeVetAccess('Primary', 'Full Access'), createSubAccount);

// Get clinic staff stats (Primary or Full Access only)
router.get('/clinic/:clinicId/stats', authorizeVetAccess('Primary', 'Full Access'), async (req, res, next) => {
  if (req.params.clinicId !== req.user.clinicId?.toString()) {
    return res.status(403).json({
      message: 'Not authorized: Stats are only available for your own clinic'
    });
  }
  getClinicStaffStats(req, res, next);
});

// Deactivate a vet account (Primary Vet only)
router.patch('/:id/deactivate', authorizeVetAccess('Primary'), async (req, res, next) => {
  // Prevent self-deactivation
  if (req.params.id === req.user.id) {
    return res.status(400).json({
      message: 'You cannot deactivate your own account'
    });
  }

  // Optional: Ensure target vet is in the same clinic
  const targetVet = await Veterinarian.findById(req.params.id);
  if (!targetVet || targetVet.clinicId?.toString() !== req.user.clinicId?.toString()) {
    return res.status(403).json({
      message: 'You can only deactivate staff from your own clinic'
    });
  }

  deactivateVet(req, res, next);
});

module.exports = router;