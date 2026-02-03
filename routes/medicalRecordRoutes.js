const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const {
  createMedicalRecord,
  getRecordsByPet,
  getRecordById,
  updateMedicalRecord,
  toggleVisibility,
  deleteMedicalRecord,
  getMedicalSummaryByPet
} = require('../controllers/medicalRecordController');

// Import middleware
const { protect, authorize } = require('../middleware/auth');
const PetProfile = require('../models/PetProfile');

// Middleware: Ensure the authenticated owner owns the pet
const authorizePetOwner = async (req, res, next) => {
  try {
    const { petId } = req.params;
    const pet = await PetProfile.findById(petId);

    if (!pet) {
      return res.status(404).json({ message: 'Pet not found' });
    }

    if (pet.ownerId.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized: You do not own this pet' });
    }

    req.pet = pet; // Attach for potential use
    next();
  } catch (error) {
    res.status(500).json({ message: 'Error in ownership check', error: error.message });
  }
};

// === Vet-Only Routes (Create, Update, Delete, Toggle Visibility) ===
router.post('/', protect, authorize('vet'), createMedicalRecord);

router.put('/:id', protect, authorize('vet'), updateMedicalRecord);

router.patch('/:id/visibility', protect, authorize('vet'), toggleVisibility);

router.delete('/:id', protect, authorize('vet'), deleteMedicalRecord);

// === Shared Routes with Role-Based Logic ===

// Get all records for a pet
// - Owners: only visible records + must own the pet
// - Vets: all records (no visibility restriction)
router.get('/pet/:petId', protect, async (req, res, next) => {
  if (req.user.role === 'owner') {
    // Owner: enforce ownership + only visible records (handled in controller via ownerView)
    return authorizePetOwner(req, res, () => {
      req.query.ownerView = 'true'; // Force visible-only for owners
      getRecordsByPet(req, res, next);
    });
  }

  if (req.user.role === 'vet') {
    // Vet: can see all records (no ownerView filter)
    return getRecordsByPet(req, res, next);
  }

  res.status(403).json({ message: 'Access denied' });
});

// Get medical summary (dashboard stats)
// - Owners: for their own pets
// - Vets: allowed (useful for consultations)
router.get('/summary/pet/:petId', protect, (req, res, next) => {
  if (req.user.role === 'owner') {
    return authorizePetOwner(req, res, next);
  }
  // Vets can access any pet summary
  next();
}, getMedicalSummaryByPet);

// Get single medical record by ID
// - Owners: only if visibleToOwner = true
// - Vets: full access
router.get('/:id', protect, getRecordById);

// NEW: Direct upload route (optional, or handle in createMedicalRecord)
router.post(
  '/upload',
  protect,
  upload.array('attachments', 10),
  (req, res) => {
    try {
      const attachments = req.files.map(file => file.path); // Cloudinary secure_url
      res.status(200).json({
        message: 'Files uploaded successfully',
        attachments
      });
    } catch (error) {
      res.status(500).json({ message: 'Upload failed', error: error.message });
    }
  }
);

// Optional Enhancement: Add stricter vet clinic check
// Uncomment and adjust if vets should only access records from their clinic
/*
const authorizeVetForPet = async (req, res, next) => {
  const pet = await PetProfile.findById(req.params.petId);
  if (pet?.registeredClinicId?.toString() !== req.user.clinicId) {
    return res.status(403).json({ message: 'Not authorized: Pet not registered with your clinic' });
  }
  next();
};
*/

module.exports = router;