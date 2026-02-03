const express = require('express');
const router = express.Router();
const {
  createPrescription,
  getPrescriptionsByPet,
  getUpcomingReminders,
  getOwnerUpcomingReminders,
  updatePrescription,
  deletePrescription,
  getVaccinationSummary,
  generatePrescriptionPDF  // Make sure this is exported from controller
} = require('../controllers/prescriptionController');

// Import middleware
const { protect, authorize } = require('../middleware/auth');
const PetProfile = require('../models/PetProfile');

// Middleware: Ensure owner owns the pet
const authorizePetOwner = async (req, res, next) => {
  try {
    const { petId } = req.params;
    const pet = await PetProfile.findById(petId);

    if (!pet) {
      return res.status(404).json({ message: 'Pet not found' });
    }

    if (pet.ownerId.toString() !== req.user.id) {
      return res.status(403).json({
        message: 'Not authorized: You do not own this pet'
      });
    }

    req.pet = pet;
    next();
  } catch (error) {
    res.status(500).json({ message: 'Error in ownership verification', error: error.message });
  }
};

// Middleware: Ensure owner ID matches authenticated user
const authorizeSelfOwner = (req, res, next) => {
  if (req.params.ownerId !== req.user.id) {
    return res.status(403).json({
      message: 'Not authorized to view reminders for other owners'
    });
  }
  next();
};

// === Vet-Only Routes (Create, Update, Delete) ===
router.post('/', protect, authorize('vet'), createPrescription);
router.put('/:id', protect, authorize('vet'), updatePrescription);
router.delete('/:id', protect, authorize('vet'), deletePrescription);

// === Shared Routes with Role-Based Access ===

// Get prescriptions for a specific pet
router.get('/pet/:petId', protect, (req, res, next) => {
  if (req.user.role === 'owner') return authorizePetOwner(req, res, next);
  if (req.user.role === 'vet') return next();
  return res.status(403).json({ message: 'Access denied' });
}, getPrescriptionsByPet);

// Get upcoming reminders for a pet
router.get('/pet/:petId/upcoming', protect, (req, res, next) => {
  if (req.user.role === 'owner') return authorizePetOwner(req, res, next);
  if (req.user.role === 'vet') return next();
  return res.status(403).json({ message: 'Access denied' });
}, getUpcomingReminders);

// Get vaccination summary for a pet
router.get('/pet/:petId/vaccinations', protect, (req, res, next) => {
  if (req.user.role === 'owner') return authorizePetOwner(req, res, next);
  if (req.user.role === 'vet') return next();
  return res.status(403).json({ message: 'Access denied' });
}, getVaccinationSummary);

// Get upcoming reminders across all owner's pets
router.get('/owner/:ownerId/upcoming', protect, authorize('owner'), authorizeSelfOwner, getOwnerUpcomingReminders);

// === PDF Download Route ===
router.get('/:id/pdf', protect, async (req, res, next) => {
  try {
    // Find the prescription to check authorization
    const prescription = await require('../models/Prescription')
      .findById(req.params.id)
      .populate('petId', 'ownerId');

    if (!prescription) {
      return res.status(404).json({ message: 'Prescription not found' });
    }

    const pet = prescription.petId;
    if (!pet) {
      return res.status(404).json({ message: 'Associated pet not found' });
    }

    // Allow: Vet OR Owner of the pet
    if (req.user.role === 'vet') {
      return next();
    }

    if (req.user.role === 'owner' && pet.ownerId.toString() === req.user.id) {
      return next();
    }

    return res.status(403).json({ message: 'Not authorized to download this prescription' });
  } catch (err) {
    return res.status(500).json({ message: 'Authorization check failed' });
  }
}, generatePrescriptionPDF);

module.exports = router;