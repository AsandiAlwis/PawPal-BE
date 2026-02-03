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

    // Use req.user.id — reliable and already verified
    const vet = await Veterinarian.findById(req.user.id)
      .select('currentActiveClinicId clinicId firstName lastName');

    if (!vet) {
      return res.status(404).json({
        success: false,
        message: 'Veterinarian not found'
      });
    }

    const clinicId = vet.currentActiveClinicId || vet.clinicId;

    if (!clinicId) {
      return res.status(400).json({
        success: false,
        message: 'No active clinic assigned to this veterinarian'
      });
    }

    // Fetch the clinic (optional — just for name in response)
    const clinic = await Clinic.findById(clinicId).select('name address phoneNumber');

    const pendingPets = await PetProfile.find({
      registeredClinicId: clinicId,
      registrationStatus: 'Pending',
      isDeleted: { $ne: true }
    })
      .populate('ownerId', 'firstName lastName email phoneNumber')
      .populate('registeredClinicId', 'name address phoneNumber')
      .sort({ createdAt: -1 })
      .lean(); // faster response

    return res.status(200).json({
      success: true,
      count: pendingPets.length,
      pendingPets,
      clinicInfo: clinic ? {
        id: clinic._id,
        name: clinic.name,
        address: clinic.address,
        phoneNumber: clinic.phoneNumber
      } : { id: clinicId }
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