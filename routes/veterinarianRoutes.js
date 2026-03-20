const express = require('express');
const router = express.Router();
const {
  registerVet,
  createSubAccount,
  getVetsByClinic,
  getVetById,
  updateVet,
  activateVet,
  deactivateVet,
  getClinicStaffStats,
  getMyClinics,
  createClinic,
  switchActiveClinic,
  getStaffByEnhancedVet,
  deleteVet,
  deleteClinicStaff,
  getVetNotifications,
  getAllVets,
  markNotificationAsRead
} = require('../controllers/veterinarianController');  // Ensure this path is correct

// Import middleware
const { protect, authorize, authorizeVetAccess } = require('../middleware/auth');
const Veterinarian = require('../models/Veterinarian');

// === Public Route ===
router.post('/register', registerVet);

// === All routes below require authentication ===
router.use(protect);

// Get all staff from all clinics owned by the Enhanced vet
router.get('/clinics/staff', getStaffByEnhancedVet);

// Get all active veterinarians (for public booking)
router.get('/all-vets', getAllVets);

// Get vet notifications
router.get('/notifications', getVetNotifications);

// Mark notification as read
router.patch('/notifications/:type/:id/read', markNotificationAsRead);

// Get logged-in vet's clinics
router.get('/my-clinics', (req, res) => {
  // Only vets can access this endpoint
  if (req.user.role !== 'vet') {
    return res.status(403).json({
      message: 'Access denied: Only veterinarians can access this endpoint'
    });
  }
  getMyClinics(req, res);
});

// Create a new clinic (Enhanced Vet only)
router.post('/clinics', authorizeVetAccess('Enhanced'), createClinic);

// Switch active clinic (Enhanced Vet only)
router.post('/switch-clinic', authorizeVetAccess('Enhanced'), switchActiveClinic);

// View own profile or any vet profile (useful for clinic directory)
router.get('/:id', getVetById);

// Update profile (self or authorized management)
router.put('/:id', async (req, res) => {
  try {
    const requesterId = req.user.id;
    const targetId = req.params.id;

    if (requesterId.toString() === targetId.toString()) {
      return updateVet(req, res);
    }

    const requester = await Veterinarian.findById(requesterId);
    if (!requester || requester.accessLevel !== 'Enhanced') {
      return res.status(403).json({
        message: 'Only Enhanced veterinarians can update other profiles'
      });
    }

    return updateVet(req, res);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all vets in a clinic
router.get('/clinic/:clinicId', getVetsByClinic);

// Create sub-account (Enhanced only)
router.post('/sub-account', authorizeVetAccess('Enhanced'), createSubAccount);

// Get clinic staff stats (Enhanced only)
router.get('/clinic/:clinicId/stats', authorizeVetAccess('Enhanced'), async (req, res) => {
  const userId = req.user.id;
  const user = await Veterinarian.findById(userId);

  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }

  // Check if user has access to this clinic
  let hasAccess = false;
  if (user.accessLevel === 'Enhanced') {
    // Enhanced vets can see stats for clinics they own OR their current active clinic
    const ownsClinic = user.ownedClinics && user.ownedClinics.some(clinicId =>
      clinicId.toString() === req.params.clinicId
    );
    const isActiveClinic = user.currentActiveClinicId &&
      user.currentActiveClinicId.toString() === req.params.clinicId;

    hasAccess = ownsClinic || isActiveClinic;
  }

  if (!hasAccess) {
    return res.status(403).json({
      message: 'Not authorized: Stats are only available for clinics you have access to'
    });
  }

  getClinicStaffStats(req, res);
});

// Deactivate a vet account (Enhanced Vet only)
router.patch('/:id/deactivate', authorizeVetAccess('Enhanced'), async (req, res) => {
  // Prevent self-deactivation
  if (req.params.id === req.user.id) {
    return res.status(400).json({
      message: 'You cannot deactivate your own account'
    });
  }

  const requesterId = req.user.id;
  const targetVetId = req.params.id;

  // Get requester info
  const requester = await Veterinarian.findById(requesterId);
  if (!requester) {
    return res.status(404).json({ message: 'Requester not found' });
  }

  // Get target vet info
  const targetVet = await Veterinarian.findById(targetVetId);
  if (!targetVet) {
    return res.status(404).json({ message: 'Veterinarian not found' });
  }

  // Check if target vet is in requester's clinic(s)
  let hasPermission = false;

  if (requester.accessLevel === 'Enhanced' || requester.accessLevel === 'Primary') {
    // Enhanced vets have system-wide access and can deactivate any vet
    hasPermission = true;
  }

  if (!hasPermission) {
    return res.status(403).json({
      message: 'You can only deactivate staff from clinics you own'
    });
  }

  deactivateVet(req, res);
});

// In vetRoutes.js, add:
router.get('/debug/clinic-ownership/:clinicId', protect, async (req, res) => {
  try {
    const clinicId = req.params.clinicId;
    const vetId = req.user.id;

    const vet = await Veterinarian.findById(vetId);
    const clinic = await Clinic.findById(clinicId);

    const ownsClinic = vet.ownedClinics && vet.ownedClinics.some(id =>
      id.toString() === clinicId
    );

    res.status(200).json({
      vet: {
        id: vet._id,
        name: `${vet.firstName} ${vet.lastName}`,
        accessLevel: vet.accessLevel,
        ownedClinics: vet.ownedClinics?.map(id => id.toString()),
        currentActiveClinicId: vet.currentActiveClinicId?.toString()
      },
      clinic: clinic ? {
        id: clinic._id,
        name: clinic.name,
        primaryVetId: clinic.primaryVetId?.toString()
      } : null,
      ownershipCheck: {
        clinicId: clinicId,
        ownsClinic: ownsClinic,
        isPrimaryVetOfClinic: clinic?.primaryVetId?.toString() === vetId,
        clinicInOwnedClinics: vet.ownedClinics?.map(id => id.toString()).includes(clinicId)
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete veterinarian (Enhanced Vet only)
router.delete('/:id', authorizeVetAccess('Enhanced'), deleteVet);

// Delete clinic staff (Enhanced Vet only) - Add this new route
router.delete('/clinic-staff/:id', authorizeVetAccess('Enhanced'), deleteClinicStaff);

// Add this route
router.patch('/:id/activate', protect, authorizeVetAccess('Enhanced'), activateVet);

module.exports = router;