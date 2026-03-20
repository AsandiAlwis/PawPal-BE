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
    
    // If an owner is canceling, mark it as unread for the vet so they get a notification
    if (req.user.role === 'owner') {
      updateData.isReadByVet = false;
    }

    if (reason) {
      updateData.notes = appointment.notes
        ? `${appointment.notes}\n\nCancellation reason: ${reason}`
        : `Cancellation reason: ${reason}`;
    }

    const updated = await Appointment.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    ).populate([
      {
        path: 'petId',
        populate: { path: 'ownerId', select: 'firstName lastName phoneNumber' }
      },
      'vetId',
      'clinicId',
      'ownerId'
    ]);

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
    ).populate([
      {
        path: 'petId',
        populate: { path: 'ownerId', select: 'firstName lastName phoneNumber' }
      },
      'vetId',
      'clinicId',
      'ownerId'
    ]);

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
            attachments: [appointment.medicalRecordUrl].filter(Boolean),
            prescriptionUrl: appointment.prescriptionUrl || null
          });
        } else {
          medicalRecord.diagnosis = appointment.diagnosis || medicalRecord.diagnosis;
          medicalRecord.treatmentNotes = appointment.medicalNotes || medicalRecord.treatmentNotes;
          if (appointment.medicalRecordUrl && !medicalRecord.attachments.includes(appointment.medicalRecordUrl)) {
            medicalRecord.attachments.push(appointment.medicalRecordUrl);
          }
          if (appointment.prescriptionUrl) {
            medicalRecord.prescriptionUrl = appointment.prescriptionUrl;
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

// Reschedule appointment (Owner only)
exports.rescheduleAppointment = async (req, res) => {
  try {
    const { id } = req.params;
    const { dateTime } = req.body;

    if (!dateTime) {
      return res.status(400).json({ message: 'New date and time are required' });
    }

    const appointment = await Appointment.findById(id);
    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    // Security check: Only the owner can reschedule
    const ownerId = appointment.ownerId || (appointment.petId && appointment.petId.ownerId);
    if (ownerId && ownerId.toString() !== req.user.id.toString()) {
      return res.status(403).json({ message: 'Not authorized to reschedule this appointment' });
    }

    // Only BOOKED or CONFIRMED can be rescheduled
    if (!['Booked', 'Confirmed'].includes(appointment.status)) {
      return res.status(400).json({
        message: `Cannot reschedule an appointment that is ${appointment.status.toLowerCase()}`
      });
    }

    // Check for conflicting appointments for the same vet at the new time
    const conflicting = await Appointment.findOne({
      _id: { $ne: id },
      vetId: appointment.vetId,
      dateTime: new Date(dateTime),
      status: { $nin: ['Canceled', 'Completed'] }
    });

    if (conflicting) {
      return res.status(409).json({
        message: 'The veterinarian is not available at the selected time slot'
      });
    }

    // Update the appointment
    appointment.dateTime = new Date(dateTime);
    
    await appointment.save();

    const updated = await Appointment.findById(id)
      .populate([
        {
          path: 'petId',
          populate: { path: 'ownerId', select: 'firstName lastName phoneNumber' }
        },
        'vetId',
        'clinicId',
        'ownerId'
      ]);

    res.status(200).json({
      message: 'Appointment rescheduled successfully',
      appointment: updated
    });

    // Notify the related parties via socket
    try {
      const io = req.app.get('socketio');
      if (io && updated) {
        const vetId = updated.vetId?._id?.toString() || updated.vetId?.toString();
        const ownerId = updated.ownerId?._id?.toString() || updated.ownerId?.toString();

        if (vetId) {
          io.to(vetId).emit('appointmentStatusChanged', updated);
        }
        if (ownerId) {
          io.to(ownerId).emit('appointmentStatusChanged', updated);
        }
      }
    } catch (socketErr) {
      console.error('Socket notification failed for rescheduling:', socketErr.message);
    }

  } catch (error) {
    console.error('Error rescheduling appointment:', error);
    res.status(500).json({
      message: 'Error rescheduling appointment',
      error: error.message
    });
  }
};

// Get appointment-based notifications for the logged-in owner
exports.getOwnerNotifications = async (req, res) => {
  try {
    const ownerId = req.user.id;
    const now = new Date();
    const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const Prescription = require('../models/Prescription');
    const MedicalRecord = require('../models/MedicalRecord');

    // Fetch all non-cancelled recent or upcoming appointments for the owner
    const appointments = await Appointment.find({
      ownerId,
      $or: [
        { dateTime: { $gte: now } },                         // future
        { updatedAt: { $gte: new Date(now - 7 * 24 * 3600 * 1000) } } // last 7 days
      ]
    })
      .populate('petId', 'name species photo')
      .populate('vetId', 'firstName lastName specialization')
      .populate('clinicId', 'name address')
      .sort({ dateTime: 1 });

    const notifications = [];

    for (const appt of appointments) {
      const apptDate = new Date(appt.dateTime);
      const petName = appt.petId?.name || 'Your pet';
      const vetName = appt.vetId ? `Dr. ${appt.vetId.firstName} ${appt.vetId.lastName}` : 'Your vet';
      const clinicName = appt.clinicId?.name || 'the clinic';
      const dateStr = apptDate.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

      // Upcoming within 48 hours
      if (appt.status !== 'Canceled' && apptDate >= now && apptDate <= in48h) {
        notifications.push({
          id: `upcoming_${appt._id}`,
          type: 'reminder',
          icon: 'schedule',
          title: `Upcoming Appointment`,
          message: `${petName}'s appointment with ${vetName} at ${clinicName} is on ${dateStr}.`,
          appointmentId: appt._id,
          petId: appt.petId?._id,
          petPhoto: appt.petId?.photo,
          createdAt: appt.dateTime,
          priority: 'high'
        });
      }

      // Confirmed
      if (appt.status === 'Confirmed' && apptDate >= now) {
        notifications.push({
          id: `confirmed_${appt._id}`,
          type: 'confirmed',
          icon: 'check_circle',
          title: `Appointment Confirmed`,
          message: `${petName}'s appointment with ${vetName} on ${dateStr} has been confirmed.`,
          appointmentId: appt._id,
          petId: appt.petId?._id,
          petPhoto: appt.petId?.photo,
          createdAt: new Date(),
          priority: 'medium'
        });
      }

      // Cancelled
      if (appt.status === 'Canceled') {
        notifications.push({
          id: `cancelled_${appt._id}`,
          type: 'cancelled',
          icon: 'cancel',
          title: `Appointment Cancelled`,
          message: `${petName}'s appointment scheduled for ${dateStr} was cancelled.`,
          appointmentId: appt._id,
          petId: appt.petId?._id,
          petPhoto: appt.petId?.photo,
          createdAt: new Date(),
          priority: 'medium'
        });
      }

      // Completed — check for vet-uploaded OR structured prescriptions
      if (appt.status === 'Completed') {
        // Check for structured prescriptions (form-typed by vet via medical record)
        const medRecord = await MedicalRecord.findOne({ appointmentId: appt._id });
        const structuredPresCount = medRecord
          ? await Prescription.countDocuments({ medicalRecordId: medRecord._id, isDeleted: { $ne: true } })
          : 0;

        const hasPrescriptions = appt.prescriptionUrl || structuredPresCount > 0;

        if (hasPrescriptions) {
          // Fetch medication names for the message
          let medicationSummary = '';
          if (medRecord && structuredPresCount > 0) {
            const presList = await Prescription.find({ medicalRecordId: medRecord._id, isDeleted: { $ne: true } }).limit(2);
            medicationSummary = presList.map(p => p.medicationName).join(', ');
            if (structuredPresCount > 2) medicationSummary += '...';
          }

          notifications.push({
            id: `prescription_${appt._id}`,
            type: 'prescription',
            icon: 'medication',
            title: `Prescription Available`,
            message: medicationSummary 
              ? `New prescription for ${petName}: ${medicationSummary}. Ready to view.`
              : `A new prescription for ${petName} from ${vetName} is ready to view.`,
            appointmentId: appt._id,
            petId: appt.petId?._id,
            petPhoto: appt.petId?.photo,
            prescriptionUrl: (appt.prescriptionUrl || (medRecord && medRecord.prescriptionUrl)) || null,
            createdAt: new Date(),
            priority: 'high'
          });
        }
      }

      // Completed with medical record
      if (appt.status === 'Completed' && appt.medicalRecordUrl) {
        notifications.push({
          id: `record_${appt._id}`,
          type: 'medical_record',
          icon: 'assignment',
          title: `Medical Record Updated`,
          message: `${vetName} has added a medical record for ${petName}'s visit on ${dateStr}.`,
          appointmentId: appt._id,
          petId: appt.petId?._id,
          petPhoto: appt.petId?.photo,
          createdAt: new Date(),
          priority: 'medium'
        });
      }

      // Rescheduled
      if (appt.status === 'Rescheduled') {
        notifications.push({
          id: `rescheduled_${appt._id}`,
          type: 'rescheduled',
          icon: 'event_repeat',
          title: `Appointment Rescheduled`,
          message: `${petName}'s appointment has been rescheduled to ${dateStr}.`,
          appointmentId: appt._id,
          petId: appt.petId?._id,
          petPhoto: appt.petId?.photo,
          createdAt: new Date(),
          priority: 'medium'
        });
      }
    }

    // Sort: high priority first, then by date desc
    notifications.sort((a, b) => {
      if (a.priority === 'high' && b.priority !== 'high') return -1;
      if (b.priority === 'high' && a.priority !== 'high') return 1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    res.status(200).json({ count: notifications.length, notifications });
  } catch (error) {
    console.error('Error getting owner notifications:', error);
    res.status(500).json({ message: 'Error fetching notifications', error: error.message });
  }
};