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
  getAppointmentById,
  getTodayAppointmentsCountByVet,
  getMyAppointments 
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
router.post('/book', protect, bookAppointment);

// Get appointments by pet (owner only)
router.get('/pet/:petId', protect, getAppointmentsByPet);

// Get single appointment (authenticated user)
router.get('/:id', protect, getAppointmentById);

// Vet routes
router.get('/vet/:vetId', protect, getAppointmentsByVet);

// routes/appointmentRoutes.js
router.get(
  '/vet/:vetId/today-count',
  protect,
  getTodayAppointmentsCountByVet
);
//router.get('/clinic/:clinicId/upcoming', protect, authorize('vet'), getUpcomingAppointmentsByClinic);

// Update appointment (vet only)
//router.put('/:id', protect, authorize('vet'), updateAppointment);

// Confirm appointment (vet only)
//router.patch('/:id/confirm', protect, authorize('vet'), confirmAppointment);

// Cancel appointment (owner or vet)
//router.patch('/:id/cancel', protect, allowCancel, cancelAppointment);

// Then add this route (place it after the '/book' route):
router.get('/owner/my-appointments', protect, authorize('owner'), getMyAppointments);

module.exports = router;