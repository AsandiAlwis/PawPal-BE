const express = require('express');
const router = express.Router();
const petController = require('../controllers/petProfileController');
const Clinic = require('../models/Clinic');
const Veterinarian = require('../models/Veterinarian');
const PetProfile = require('../models/PetProfile');
const { protect, authorize } = require('../middleware/auth');

// ────────────────────────────────────────────────
//          TEST ENDPOINT (keep this for debugging)
// ────────────────────────────────────────────────
router.get('/test-simple', protect, authorize('vet'), async (req, res) => {
  try {
    console.log('=== TEST SIMPLE ENDPOINT ===');
    console.log('req.user:', req.user);

    const vet = await Veterinarian.findById(req.user.id)
      .select('firstName lastName currentActiveClinicId clinicId')
      .populate('currentActiveClinicId', 'name address phoneNumber');

    if (!vet) {
      return res.status(404).json({
        success: false,
        message: 'Veterinarian not found'
      });
    }

    const clinicId = vet.currentActiveClinicId?._id || vet.clinicId;

    return res.status(200).json({
      success: true,
      message: 'Test endpoint works!',
      vet: {
        id: vet._id,
        name: `${vet.firstName} ${vet.lastName}`,
        currentActiveClinicId: vet.currentActiveClinicId?._id || null,
        clinicId: vet.clinicId || null
      },
      clinic: vet.currentActiveClinicId ? {
        id: vet.currentActiveClinicId._id,
        name: vet.currentActiveClinicId.name,
        address: vet.currentActiveClinicId.address,
        phoneNumber: vet.currentActiveClinicId.phoneNumber
      } : null
    });
  } catch (error) {
    console.error('Test endpoint error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// ────────────────────────────────────────────────
//  Get pending registrations for vet's current clinic
// ────────────────────────────────────────────────
router.get('/clinic/pending', protect, authorize('vet'), async (req, res) => {
  try {
    console.log('=== GET /clinic/pending ===');
    console.log('User:', req.user.id, req.user.role);

    const isEnhanced = req.user.accessLevel === 'Enhanced';

    let query = {
      registrationStatus: 'Pending',
      isDeleted: { $ne: true }
    };

    if (!isEnhanced) {
      if (!req.user.clinicId) {
        return res.status(200).json({ success: true, count: 0, pendingPets: [], isGlobalView: false });
      }
      query.registeredClinicId = req.user.clinicId;
    }

    const pendingPets = await PetProfile.find(query)
      .populate('ownerId', 'firstName lastName email phoneNumber')
      .populate('registeredClinicId', 'name address phoneNumber')
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      count: pendingPets.length,
      pendingPets,
      isGlobalView: isEnhanced
    });
  } catch (error) {
    console.error('Error in /clinic/pending:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// ────────────────────────────────────────────────
//                    OWNER ROUTES
// ────────────────────────────────────────────────

router.get('/my', protect, authorize('owner'), (req, res) => {
  req.params.ownerId = req.user.id;
  return petController.getPetsByOwner(req, res);
});

router.post('/', protect, authorize('owner'), petController.createPet);

router.get('/owner/:ownerId', protect, authorize('owner', 'vet'), petController.getPetsByOwner);

router.get('/:id', protect, petController.getPetById);

router.put('/:id', protect, authorize('owner'), petController.updatePet);

router.delete('/:id', protect, authorize('owner'), petController.deletePet);
router.delete('/:id/personal-records/:recordId', protect, authorize('owner'), petController.removePersonalRecord);

router.post('/:id/request-registration', protect, authorize('owner'), petController.requestClinicRegistration);

// ────────────────────────────────────────────────
//               CLINIC-SCOPED ROUTES
// ────────────────────────────────────────────────

router.get('/clinic/:clinicId/pending', protect, petController.getPendingRegistrationsByClinic);
router.get('/clinic/:clinicId/approved', protect, petController.getApprovedRegistrationsByClinic);
router.get('/clinic/:clinicId/registered-count', protect, petController.getRegisteredPetsCountByClinic);
router.get('/clinic/:clinicId/pending-count', protect, petController.getPendingRegistrationsCountByClinic);

// ────────────────────────────────────────────────
//           REGISTRATION APPROVAL (VET ONLY)
// ────────────────────────────────────────────────

router.patch('/:id/approve', protect, authorize('vet'), petController.approvePetRegistration);
router.patch('/:id/reject', protect, authorize('vet'), petController.rejectPetRegistration);

router.get('/clinic/registered', protect, authorize('vet'), petController.getRegisteredPetsForVetClinic);

module.exports = router;