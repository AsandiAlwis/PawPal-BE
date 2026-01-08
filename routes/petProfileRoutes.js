const express = require('express');
const router = express.Router();
const {
  createPet,
  getPetsByOwner,
  getPetById,
  updatePet,
  deletePet,
  requestClinicRegistration,
  getPendingRegistrationsByClinic,
  approvePetRegistration
} = require('../controllers/petProfileController');

// Import middleware
const { protect, authorize, authorizeVetForClinicFromPet } = require('../middleware/auth');
const PetProfile = require('../models/PetProfile');

// Middleware: Ensure the user owns the pet (for owner actions)
const authorizePetOwner = async (req, res, next) => {
  try {
    const { id } = req.params; // petId
    const pet = await PetProfile.findById(id);

    if (!pet) {
      return res.status(404).json({ message: 'Pet not found' });
    }

    req.pet = pet; // Attach for controller use if needed
    next();
  } catch (error) {
    res.status(500).json({ message: 'Error in pet ownership check', error: error.message });
  }
};

// Get my own pets — with detailed logging
router.get('/my', protect, authorize('owner'), (req, res, next) => {
  if (!req.user || !req.user.id) {
    console.error('No authenticated user found');
    return res.status(401).json({ message: 'Not authenticated' });
  }

  // Set ownerId and proceed
  req.params.ownerId = req.user.id;

  getPetsByOwner(req, res, next);
});

// Middleware: Ensure the vet belongs to the clinic
const authorizeVetForClinic = async (req, res, next) => {
  try {
    const { clinicId } = req.params;

    if (req.user.role !== 'vet' || req.user.clinicId?.toString() !== clinicId) {
      return res.status(403).json({
        message: 'Not authorized: You do not belong to this clinic'
      });
    }

    next();
  } catch (error) {
    res.status(500).json({ message: 'Error in clinic authorization', error: error.message });
  }
};

// Create a new pet
router.post('/', protect, authorize('owner'), createPet);

// Get all pets for the authenticated owner
// We override ownerId with req.user.id for security
router.get('/owner/:ownerId', protect, authorize('owner'), (req, res, next) => {
  if (req.params.ownerId !== req.user.id) {
    return res.status(403).json({ message: 'Not authorized to view other owners\' pets' });
  }
  getPetsByOwner(req, res, next);
});

// Get single pet details
router.get('/:id', protect, (req, res, next) => {
  // Allow owner if they own it, or vet if pet is registered with their clinic
  PetProfile.findById(req.params.id)
    .then(pet => {
      if (!pet) return res.status(404).json({ message: 'Pet not found' });

      const isOwner = req.user.role === 'owner' && pet.ownerId.toString() === req.user.id;
      const isVetFromClinic = req.user.role === 'vet' &&
        pet.registeredClinicId &&
        pet.registeredClinicId.toString() === req.user.clinicId;

      next();
    })
    .catch(() => res.status(500).json({ message: 'Server error' }));
}, getPetById);

// Update pet
router.put('/:id', protect, authorize('owner'), authorizePetOwner, updatePet);

// Delete pet (soft delete)
router.delete('/:id', protect, authorize('owner'), authorizePetOwner, deletePet);

// Request clinic registration
router.post('/:id/request-registration', protect, authorize('owner'), authorizePetOwner, requestClinicRegistration);

// View pending registrations for their clinic
router.get('/clinic/:clinicId/pending', protect, authorize('vet'), authorizeVetForClinic, getPendingRegistrationsByClinic);

// Approve a pending pet registration
router.patch(
  '/:id/approve',
  protect,
  authorize('vet'),
  authorizeVetForClinicFromPet,
  approvePetRegistration
);

module.exports = router;
