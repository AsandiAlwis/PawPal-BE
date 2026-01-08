const express = require('express');
const router = express.Router();
const {
  bookAppointment,
  getAppointmentsByPet,
  getAppointmentsByVet,
  getUpcomingAppointmentsByClinic,
  updateAppointment,
  cancelAppointment,
  confirmAppointment,
  getAppointmentById
} = require('../controllers/appointmentController');

const { protect, authorize } = require('../middleware/auth');

// Custom middleware: Allow owner or vet to cancel
const allowCancel = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Not authenticated' });
  }

  if (req.user.role === 'owner' || req.user.role === 'vet') {
    return next();
  }

  return res.status(403).json({ message: 'Not authorized to cancel this appointment' });
};

// === Routes ===

// Book appointment (owner only)
router.post('/book', protect, authorize('owner'), bookAppointment);

// Get appointments by pet (owner only)
router.get('/pet/:petId', protect, authorize('owner'), getAppointmentsByPet);

// Get single appointment (authenticated user)
router.get('/:id', protect, getAppointmentById);

// Vet routes
router.get('/vet/:vetId', protect, authorize('vet'), getAppointmentsByVet);
//router.get('/clinic/:clinicId/upcoming', protect, authorize('vet'), getUpcomingAppointmentsByClinic);

// Update appointment (vet only)
//router.put('/:id', protect, authorize('vet'), updateAppointment);

// Confirm appointment (vet only)
//router.patch('/:id/confirm', protect, authorize('vet'), confirmAppointment);

// Cancel appointment (owner or vet)
//router.patch('/:id/cancel', protect, allowCancel, cancelAppointment);

module.exports = router;