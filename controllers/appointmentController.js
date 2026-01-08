const Appointment = require('../models/Appointment');
const PetProfile = require('../models/PetProfile');
const Clinic = require('../models/Clinic');

// Book a new appointment (Pet Owner)
exports.bookAppointment = async (req, res) => {
  try {
    const { petId, clinicId, vetId, dateTime, reason, notes } = req.body;

    if (!petId || !clinicId || !vetId || !dateTime) {
      return res.status(400).json({
        message: 'petId, clinicId, vetId, and dateTime are required'
      });
    }

    // Fetch pet with owner info
    const pet = await PetProfile.findById(petId)
      .populate('ownerId', 'firstName lastName email phoneNumber');

    if (!pet) {
      return res.status(404).json({ message: 'Pet not found' });
    }

    // Security: Owner can only book for their own pet
    if (req.user.role === 'owner' && pet.ownerId._id.toString() !== req.user.id) {
      return res.status(403).json({
        message: 'You can only book appointments for your own pets'
      });
    }

    // Optional clinic registration check
    if (pet.registeredClinicId && pet.registeredClinicId.toString() !== clinicId) {
      return res.status(403).json({
        message: 'This pet is not registered with the selected clinic'
      });
    }

    // Check for conflicting appointments
    const conflicting = await Appointment.findOne({
      vetId,
      dateTime: new Date(dateTime),
      status: { $nin: ['Canceled', 'Completed'] }
    });

    if (conflicting) {
      return res.status(409).json({
        message: 'Vet is not available at this time slot'
      });
    }

    const appointment = new Appointment({
      petId,
      ownerId: pet.ownerId._id, // ← Set from pet
      clinicId,
      vetId,
      dateTime: new Date(dateTime),
      reason: reason?.trim(),
      notes: notes?.trim(),
      status: 'Booked'
    });

    await appointment.save();

    // Populate full details
    await appointment.populate([
      { path: 'petId', select: 'name species breed photo' },
      { path: 'ownerId', select: 'firstName lastName email phoneNumber' },
      { path: 'vetId', select: 'firstName lastName specialization' },
      { path: 'clinicId', select: 'name address phoneNumber' }
    ]);

    res.status(201).json({
      message: 'Appointment booked successfully',
      appointment
    });
  } catch (error) {
    console.error('Error booking appointment:', error);
    res.status(400).json({
      message: 'Error booking appointment',
      error: error.message
    });
  }
};

// Get appointments by pet (for owner or vet)
exports.getAppointmentsByPet = async (req, res) => {
  try {
    const { petId } = req.params;
    const { status, upcoming } = req.query;

    const pet = await PetProfile.findById(petId);
    if (!pet) {
      return res.status(404).json({ message: 'Pet not found' });
    }

    // Security check for owners
    if (req.user.role === 'owner' && pet.ownerId.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    let query = { petId };
    if (status) query.status = status;
    if (upcoming === 'true') query.dateTime = { $gte: new Date() };

    const appointments = await Appointment.find(query)
      .populate('vetId', 'firstName lastName specialization')
      .populate('clinicId', 'name address phoneNumber')
      .populate('ownerId', 'firstName lastName')
      .sort({ dateTime: -1 });

    res.status(200).json({
      count: appointments.length,
      appointments
    });
  } catch (error) {
    res.status(500).json({
      message: 'Error fetching appointments',
      error: error.message
    });
  }
};

// Get appointments by vet
exports.getAppointmentsByVet = async (req, res) => {
  try {
    const { vetId } = req.params;
    const { date, clinicId } = req.query;

    // Security: Vet can only view their own appointments
    if (req.user.role === 'vet' && req.user.id !== vetId) {
      return res.status(403).json({ message: 'You can only view your own appointments' });
    }

    let query = { vetId };

    if (clinicId) query.clinicId = clinicId;

    if (date) {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(date);
      end.setHours(23, 59, 59, 999);
      query.dateTime = { $gte: start, $lte: end };
    }

    const appointments = await Appointment.find(query)
      .populate({
        path: 'petId',
        select: 'name species breed photo',
        populate: { path: 'ownerId', select: 'firstName lastName phoneNumber' }
      })
      .populate('clinicId', 'name')
      .sort({ dateTime: 1 });

    res.status(200).json({
      count: appointments.length,
      appointments
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching appointments', error: error.message });
  }
};

// Cancel appointment (owner or vet)
exports.cancelAppointment = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const appointment = await Appointment.findById(id)
      .populate('petId', 'ownerId');

    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    // Security: Owner or vet from the same clinic can cancel
    const isOwner = req.user.role === 'owner' && appointment.petId.ownerId.toString() === req.user.id;
    const isVet = req.user.role === 'vet' && appointment.vetId.toString() === req.user.id;

    if (!isOwner && !isVet) {
      return res.status(403).json({ message: 'You can only cancel your own appointments' });
    }

    const updated = await Appointment.findByIdAndUpdate(
      id,
      { 
        status: 'Canceled', 
        notes: reason ? `Cancellation reason: ${reason}` : appointment.notes 
      },
      { new: true }
    )
      .populate('petId vetId clinicId ownerId');

    res.status(200).json({
      message: 'Appointment canceled successfully',
      appointment: updated
    });
  } catch (error) {
    res.status(400).json({
      message: 'Error canceling appointment',
      error: error.message
    });
  }
};

// Confirm appointment (Vet only)
exports.confirmAppointment = async (req, res) => {
  try {
    const { id } = req.params;

    const appointment = await Appointment.findById(id);
    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    // Only the assigned vet can confirm
    if (req.user.role === 'vet' && appointment.vetId.toString() !== req.user.id) {
      return res.status(403).json({ message: 'You can only confirm your own appointments' });
    }

    const updated = await Appointment.findByIdAndUpdate(
      id,
      { status: 'Confirmed' },
      { new: true }
    )
      .populate('petId vetId clinicId ownerId');

    res.status(200).json({
      message: 'Appointment confirmed',
      appointment: updated
    });
  } catch (error) {
    res.status(400).json({
      message: 'Error confirming appointment',
      error: error.message
    });
  }
};

// Get single appointment by ID (with full details)
exports.getAppointmentById = async (req, res) => {
  try {
    const { id } = req.params;

    const appointment = await Appointment.findById(id)
      .populate('petId', 'name species breed photo')
      .populate('ownerId', 'firstName lastName email phoneNumber')
      .populate('vetId', 'firstName lastName specialization')
      .populate('clinicId', 'name address phoneNumber');

    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    // Security check
    const isOwner = req.user.role === 'owner' && appointment.ownerId._id.toString() === req.user.id;
    const isVet = req.user.role === 'vet' && appointment.vetId.toString() === req.user.id;

    if (!isOwner && !isVet) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.status(200).json(appointment);
  } catch (error) {
    res.status(500).json({
      message: 'Error fetching appointment',
      error: error.message
    });
  }
};