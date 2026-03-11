const Appointment = require('../models/Appointment');
const PetProfile = require('../models/PetProfile');
const Clinic = require('../models/Clinic');
const MedicalRecord = require('../models/MedicalRecord');
const Prescription = require('../models/Prescription');
const cloudinary = require('cloudinary').v2;

// Book a new appointment (Pet Owner)
exports.bookAppointment = async (req, res) => {
  try {
    const { petId, clinicId, vetId, dateTime, reason, notes } = req.body || {};

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

    // === REAL-TIME UPDATE ===
    const io = req.app.get('socketio');
    if (io) {
      // Notify the specific vet
      io.to(vetId.toString()).emit('newAppointment', appointment);
      console.log(`📡 Socket: Notified vet ${vetId} about new appointment`);
    }
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

    // Security: Enhanced Vet sees all, Basic staff/vet sees appointments in their clinic
    const isEnhanced = req.user.role === 'vet' && req.user.accessLevel === 'Enhanced';

    // Instead of completely blocking, we will enforce the clinicId constraint in the query.

    let query = {};
    if (isEnhanced && req.user.id.toString() === vetId) {
      // Enhanced vet looking at their own ID get global system view
      query = {};
    } else {
      // Basic access level: see all appointments for their clinic
      if (req.user.clinicId) {
        query = { clinicId: req.user.clinicId };
      } else {
        query = { vetId };
      }
    }

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
      .populate('clinicId', 'name address phoneNumber')
      .populate('vetId', 'firstName lastName')
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
    const { reason } = req.body || {};

    const appointment = await Appointment.findById(id).populate('petId', 'ownerId');

    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    // Security check
    let isAuthorized = false;

    // 1. Owner check
    if (req.user.role === 'owner') {
      const ownerId = appointment.ownerId || (appointment.petId && appointment.petId.ownerId);
      if (ownerId && ownerId.toString() === req.user.id.toString()) {
        isAuthorized = true;
      }
    }

    // 2. Vet check
    if (req.user.role === 'vet') {
      const isEnhanced = req.user.accessLevel === 'Enhanced';
      const isAssignedVet = appointment.vetId && appointment.vetId.toString() === req.user.id.toString();
      const isClinicVet = req.user.clinicId && appointment.clinicId && appointment.clinicId.toString() === req.user.clinicId.toString();

      if (isEnhanced || isAssignedVet || isClinicVet) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      return res.status(403).json({ message: 'You are not authorized to cancel this appointment' });
    }

    // Update the appointment
    const updateData = { status: 'Canceled' };
    if (reason) {
      updateData.notes = appointment.notes
        ? `${appointment.notes}\n\nCancellation reason: ${reason}`
        : `Cancellation reason: ${reason}`;
    }

    const updated = await Appointment.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    ).populate('petId vetId clinicId ownerId');

    res.status(200).json({
      message: 'Appointment canceled successfully',
      appointment: updated
    });

    // === REAL-TIME UPDATE ===
    try {
      const io = req.app.get('socketio');
      if (io && updated) {
        // More robust ID extraction
        const vetId = updated.vetId?._id?.toString() || updated.vetId?.toString();
        const ownerId = updated.ownerId?._id?.toString() || updated.ownerId?.toString() || (updated.petId?.ownerId?.toString());

        if (vetId) {
          io.to(vetId).emit('appointmentStatusChanged', updated);
        }
        if (ownerId) {
          io.to(ownerId).emit('appointmentStatusChanged', updated);
        }
        console.log(`📡 Socket: Notified related parties about cancellation of ${id}`);
      }
    } catch (socketErr) {
      console.error('Socket notification failed for cancellation:', socketErr.message);
      // Don't fail the request just because socket notification failed
    }

  } catch (error) {
    console.error('Error in cancelAppointment:', error);
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

    const isEnhanced = req.user.accessLevel === 'Enhanced';
    const isAssignedVet = appointment.vetId.toString() === req.user.id.toString();
    const isClinicVet = req.user.clinicId && appointment.clinicId.toString() === req.user.clinicId.toString();

    if (!isEnhanced && !isAssignedVet && !isClinicVet) {
      return res.status(403).json({
        message: 'You can only confirm appointments belonging to your clinic'
      });
    }

    const updated = await Appointment.findByIdAndUpdate(
      id,
      { status: 'Confirmed' },
      { new: true }
    ).populate('petId vetId clinicId ownerId');

    res.status(200).json({
      message: 'Appointment confirmed',
      appointment: updated
    });

    const io = req.app.get('socketio');
    if (io && updated) {
      const ownerId = updated.ownerId?._id?.toString() || updated.ownerId?.toString();
      if (ownerId) {
        io.to(ownerId).emit('appointmentStatusChanged', updated);
      }
    }
  } catch (error) {
    res.status(400).json({
      message: 'Error confirming appointment',
      error: error.message
    });
  }
};

// Manage Appointment (Vet only) - Add notes, prescriptions, complete status
exports.manageAppointment = async (req, res) => {
  try {
    const { id } = req.params;
    const { diagnosis, medicalNotes, status } = req.body || {};

    const appointment = await Appointment.findById(id);
    if (!appointment) return res.status(404).json({ message: 'Appointment not found' });

    // Handle File Uploads to Cloudinary
    const uploadToCloudinary = (fileBuffer, folder) => {
      return new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
          { folder, resource_type: 'auto' },
          (error, result) => {
            if (error) reject(error);
            else resolve(result.secure_url);
          }
        ).end(fileBuffer);
      });
    };

    if (req.files) {
      if (req.files.medicalRecord && req.files.medicalRecord[0]) {
        const url = await uploadToCloudinary(req.files.medicalRecord[0].buffer, 'vet-medical-records');
        appointment.medicalRecordUrl = url;
      }
      if (req.files.prescription && req.files.prescription[0]) {
        const url = await uploadToCloudinary(req.files.prescription[0].buffer, 'vet-prescriptions');
        appointment.prescriptionUrl = url;
      }
    }

    if (diagnosis !== undefined) appointment.diagnosis = diagnosis;
    if (medicalNotes !== undefined) appointment.medicalNotes = medicalNotes;
    if (status) appointment.status = status;

    await appointment.save();

    // If appointment is completed, automatically create/update a Medical Record entry
    if (status === 'Completed' || appointment.status === 'Completed') {
      try {
        let medicalRecord = await MedicalRecord.findOne({ appointmentId: appointment._id });

        if (!medicalRecord) {
          medicalRecord = new MedicalRecord({
            petId: appointment.petId,
            vetId: appointment.vetId,
            appointmentId: appointment._id,
            diagnosis: appointment.diagnosis || appointment.reason || 'Medical Notes from Appointment',
            treatmentNotes: appointment.medicalNotes || '',
            date: appointment.dateTime || new Date(),
            visibleToOwner: true,
            attachments: [appointment.medicalRecordUrl].filter(Boolean)
          });
        } else {
          medicalRecord.diagnosis = appointment.diagnosis || medicalRecord.diagnosis;
          medicalRecord.treatmentNotes = appointment.medicalNotes || medicalRecord.treatmentNotes;
          if (appointment.medicalRecordUrl && !medicalRecord.attachments.includes(appointment.medicalRecordUrl)) {
            medicalRecord.attachments.push(appointment.medicalRecordUrl);
          }
        }
        await medicalRecord.save();

        // Handle structured prescriptions if provided
        const { prescriptions } = req.body || {};
        if (prescriptions) {
          let presArray = [];
          try {
            presArray = typeof prescriptions === 'string' ? JSON.parse(prescriptions) : prescriptions;
          } catch (e) {
            console.error('Error parsing prescriptions JSON:', e);
          }

          if (Array.isArray(presArray) && presArray.length > 0) {
            // Optional: delete old prescriptions for this record to avoid duplicates on multi-save
            await Prescription.deleteMany({ medicalRecordId: medicalRecord._id });

            for (const pres of presArray) {
              if (pres.medicationName && pres.medicationName.trim()) {
                const newPres = new Prescription({
                  petId: appointment.petId,
                  medicalRecordId: medicalRecord._id,
                  medicationName: pres.medicationName.trim(),
                  dosage: pres.dosage?.trim() || '',
                  duration: pres.duration?.trim() || '',
                  instructions: pres.instructions?.trim() || '',
                  type: pres.type || 'Medication',
                  dueDate: pres.dueDate ? new Date(pres.dueDate) : null,
                  createdBy: req.user.id
                });
                await newPres.save();
              }
            }
          }
        }
      } catch (recordError) {
        console.error('Error auto-creating medical record or prescriptions:', recordError);
      }
    }

    const updated = await Appointment.findById(id)
      .populate({
        path: 'petId',
        populate: { path: 'ownerId', select: 'firstName lastName phoneNumber email' }
      })
      .populate('clinicId', 'name address phoneNumber')
      .populate('vetId', 'firstName lastName specialization')
      .populate('ownerId', 'firstName lastName');

    res.status(200).json({
      message: 'Appointment updated successfully',
      appointment: updated
    });

    const io = req.app.get('socketio');
    if (io && updated) {
      const ownerId = updated.ownerId?._id?.toString() || updated.ownerId?.toString();
      if (ownerId) {
        io.to(ownerId).emit('appointmentStatusChanged', updated);
      }
    }

  } catch (error) {
    console.error('Error managing appointment:', error);
    res.status(400).json({ message: 'Error managing appointment', error: error.message });
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

// Get ONLY the count of today's appointments for a vet
// Fast and lightweight — ideal for dashboard stats
exports.getTodayAppointmentsCountByVet = async (req, res) => {
  try {
    const { vetId } = req.params;

    // === Security: Only allow the vet to see their own count ===
    if (!req.user || req.user.role !== 'vet') {
      return res.status(403).json({
        message: 'Access denied: Only veterinarians can access this data'
      });
    }

    // If Enhanced, allow viewing ANY vet's stats (Global)
    // For Basic, we will restrict to their clinicId in the DB query below.
    const isEnhanced = req.user.accessLevel === 'Enhanced';

    // Define today's date range (00:00:00 to 23:59:59)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Count appointments for today
    let countQuery = {
      dateTime: { $gte: today, $lt: tomorrow },
      status: 'Confirmed'
    };

    // If NOT Enhanced, only count for the specific clinic (or vet if no clinic)
    if (!isEnhanced) {
      if (req.user.clinicId) {
        countQuery.clinicId = req.user.clinicId;
      } else {
        countQuery.vetId = vetId;
      }
    }

    const count = await Appointment.countDocuments(countQuery);

    res.status(200).json({
      message: isEnhanced ? "Total today's appointments (Global)" : "Today's appointments count retrieved",
      vetId: isEnhanced ? 'GLOBAL' : vetId,
      todayDate: today.toISOString().split('T')[0],
      todayAppointmentsCount: count
    });

  } catch (error) {
    console.error('Error in getTodayAppointmentsCountByVet:', error);
    res.status(500).json({
      message: 'Error fetching today\'s appointments count',
      error: error.message
    });
  }
};

// Get all appointments for the logged-in owner
exports.getMyAppointments = async (req, res) => {
  try {
    // Only owners can access this route
    if (req.user.role !== 'owner') {
      return res.status(403).json({
        message: 'Only pet owners can access their appointments'
      });
    }

    const ownerId = req.user.id;

    // Get query parameters for filtering
    const {
      status,
      upcoming,
      past,
      clinicId,
      startDate,
      endDate,
      sortBy = 'dateTime',
      sortOrder = 'desc'
    } = req.query;

    // Build query
    let query = { ownerId };

    // Filter by status
    if (status) {
      query.status = status;
    }

    // Filter by date range
    if (startDate || endDate) {
      query.dateTime = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        query.dateTime.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.dateTime.$lte = end;
      }
    } else {
      // Default filters if no date range
      if (upcoming === 'true') {
        query.dateTime = { $gte: new Date() };
      } else if (past === 'true') {
        query.dateTime = { $lt: new Date() };
      }
    }

    // Filter by clinic
    if (clinicId) {
      query.clinicId = clinicId;
    }

    // Determine sort order
    const sortDirection = sortOrder === 'asc' ? 1 : -1;
    const sortOptions = {};
    sortOptions[sortBy] = sortDirection;

    // Fetch appointments with full details
    const appointments = await Appointment.find(query)
      .populate([
        {
          path: 'petId',
          select: 'name species breed photo registrationStatus',
          populate: {
            path: 'registeredClinicId',
            select: 'name'
          }
        },
        {
          path: 'vetId',
          select: 'firstName lastName specialization avatar email phoneNumber'
        },
        {
          path: 'clinicId',
          select: 'name address phoneNumber operatingHours'
        },
        {
          path: 'ownerId',
          select: 'firstName lastName email phoneNumber'
        }
      ])
      .sort(sortOptions);

    // Format the response with additional info
    const formattedAppointments = appointments.map(appointment => {
      const appointmentObj = appointment.toObject();

      // Calculate time ago for past appointments
      if (appointment.dateTime < new Date()) {
        const diffMs = new Date() - appointment.dateTime;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays === 0) appointmentObj.timeAgo = 'Today';
        else if (diffDays === 1) appointmentObj.timeAgo = 'Yesterday';
        else if (diffDays < 7) appointmentObj.timeAgo = `${diffDays} days ago`;
        else if (diffDays < 30) appointmentObj.timeAgo = `${Math.floor(diffDays / 7)} weeks ago`;
        else appointmentObj.timeAgo = `${Math.floor(diffDays / 30)} months ago`;
      } else {
        // Calculate time until appointment
        const diffMs = appointment.dateTime - new Date();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays === 0) appointmentObj.timeUntil = 'Today';
        else if (diffDays === 1) appointmentObj.timeUntil = 'Tomorrow';
        else if (diffDays < 7) appointmentObj.timeUntil = `in ${diffDays} days`;
        else if (diffDays < 30) appointmentObj.timeUntil = `in ${Math.floor(diffDays / 7)} weeks`;
        else appointmentObj.timeUntil = `in ${Math.floor(diffDays / 30)} months`;
      }

      return appointmentObj;
    });

    // Calculate stats
    const totalCount = appointments.length;
    const upcomingCount = appointments.filter(a => a.dateTime >= new Date() && a.status !== 'Canceled' && a.status !== 'Completed').length;
    const pendingCount = appointments.filter(a => a.status === 'Booked').length;
    const confirmedCount = appointments.filter(a => a.status === 'Confirmed').length;
    const canceledCount = appointments.filter(a => a.status === 'Canceled').length;
    const completedCount = appointments.filter(a => a.status === 'Completed').length;

    res.status(200).json({
      success: true,
      count: totalCount,
      stats: {
        total: totalCount,
        upcoming: upcomingCount,
        pending: pendingCount,
        confirmed: confirmedCount,
        canceled: canceledCount,
        completed: completedCount
      },
      filters: {
        status: status || 'all',
        upcoming: upcoming || 'false',
        past: past || 'false',
        clinicId: clinicId || 'all',
        dateRange: {
          start: startDate,
          end: endDate
        }
      },
      appointments: formattedAppointments
    });

  } catch (error) {
    console.error('Error fetching my appointments:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching your appointments',
      error: error.message
    });
  }
};