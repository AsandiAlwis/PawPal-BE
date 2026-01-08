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
  getMyClinic
} = require('../controllers/clinicController');

// Import authentication & authorization middleware
const { protect, authorize, authorizeVetAccess } = require('../middleware/auth');
const Clinic = require('../models/Clinic');

// === Public Routes - No authentication required ===
// These are safe for pet owners to discover clinics
// Get current vet's clinic(s)
router.get('/my', protect, authorize('vet'), getMyClinic);
// Update clinic (only Primary Vet)

router.get('/nearby', getNearbyClinics);
router.get('/search', searchClinics);
router.get('/', getAllClinics);
router.get('/:id', getClinicById);

// === Protected Routes - Require authentication and vet privileges ===

// Middleware: Ensure user is a vet with Primary or Full Access
//const requireVetManagementAccess = [protect, authorize('vet'), authorizeVetAccess('Primary', 'Full Access')];
const requireVetManagementAccess = [protect, authorize('vet')];

// Create a new clinic (only Primary-capable vets)
router.post('/', protect, authorize('vet'), createClinic);

// Custom middleware: Only the Primary Vet of the clinic can update/delete it
const authorizeClinicPrimaryVet = async (req, res, next) => {
  try {
    const { id } = req.params; // clinicId
    const clinic = await Clinic.findById(id);

    if (!clinic) {
      return res.status(404).json({ message: 'Clinic not found' });
    }

    console.log(clinic);

    // Check if requester is the Primary Vet
    if (!clinic.primaryVetId.toString()) {
      return res.status(403).json({
        message: 'Access denied: Only the Primary Vet can modify or delete this clinic'
      });
    }

    // Attach clinic for potential use in controller
    req.clinic = clinic;
    next();
  } catch (error) {
    res.status(500).json({ message: 'Error in clinic authorization', error: error.message });
  }
};

// Update clinic - Primary Vet only
router.put('/:id', protect, authorize('vet'), authorizeClinicPrimaryVet, updateClinic);

// Delete clinic (only Primary Vet) - Dangerous operation
router.delete('/:id', requireVetManagementAccess, authorizeClinicPrimaryVet, deleteClinic);

module.exports = router;