const express = require('express');
const router = express.Router();
const {
  registerOwner,
  getAllOwners,
  getOwnerById,
  updateOwner,
  deleteOwner,
  getOwnerSummary
} = require('../controllers/petOwnerController');

// Import authentication middleware
const { protect, authorize, authorizeVetAccess } = require('../middleware/auth');

// === Public Route ===
router.post('/register', registerOwner);

// === Protected Routes ===

// Middleware to ensure user can only access their own profile
const authorizeSelf = (req, res, next) => {
  if (req.user.role === 'owner' && req.params.id !== req.user.id) {
    return res.status(403).json({
      message: 'Not authorized: You can only access your own profile'
    });
  }
  next();
};

// Get owner's own profile
router.get('/:id', protect, authorize('owner'), authorizeSelf, getOwnerById);

// Get owner's summary (dashboard stats)
router.get('/:id/summary', protect, authorize('owner'), authorizeSelf, getOwnerSummary);

// Update own profile
router.put('/:id', protect, authorize('owner'), updateOwner);

// Soft-delete own account (optional — dangerous, you might want to disable)
router.delete('/:id', protect, authorize('owner'), authorizeSelf, deleteOwner);

// === Admin / Vet Primary Routes ===
// List all owners (useful for clinic admins or support)
router.get('/', protect, authorize('vet'), authorizeVetAccess('Primary'), getAllOwners);

// Primary Vet can delete owner accounts if needed (rare, but possible for support)
router.delete('/:id', protect, authorize('vet'), authorizeVetAccess('Primary'), deleteOwner);

// Optional: Allow Primary Vets to view any owner profile (e.g., during support)
router.get('/:id', protect, authorize('vet'), authorizeVetAccess('Primary'), getOwnerById);

module.exports = router;