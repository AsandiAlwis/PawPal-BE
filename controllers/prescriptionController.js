const Prescription = require('../models/Prescription');
const PetProfile = require('../models/PetProfile');
const MedicalRecord = require('../models/MedicalRecord');

// Create a new prescription or vaccination (Veterinarian only)
exports.createPrescription = async (req, res) => {
  try {
    const {
      petId,
      medicalRecordId, // Optional link to medical record
      medicationName,
      dosage,
      duration,
      instructions,
      type, // 'Medication' or 'Vaccination'
      dueDate // Required for reminders (e.g., next vaccination date)
    } = req.body;

    // Required fields validation
    if (!petId || !medicationName || !dosage || !type) {
      return res.status(400).json({
        message: 'petId, medicationName, dosage, and type are required'
      });
    }

    if (!['Medication', 'Vaccination'].includes(type)) {
      return res.status(400).json({
        message: 'type must be "Medication" or "Vaccination"'
      });
    }

    if (type === 'Vaccination' && !dueDate) {
      return res.status(400).json({
        message: 'dueDate is required for vaccinations (next booster date)'
      });
    }

    // Verify pet exists
    const pet = await PetProfile.findById(petId).select('name registeredClinicId ownerId');
    if (!pet) {
      return res.status(404).json({ message: 'Pet not found' });
    }

    // Optional: Verify medicalRecordId belongs to this pet
    if (medicalRecordId) {
      const record = await MedicalRecord.findOne({ _id: medicalRecordId, petId });
      if (!record) {
        return res.status(404).json({ message: 'Medical record not found or does not belong to this pet' });
      }
    }

    const prescription = new Prescription({
      petId,
      medicalRecordId: medicalRecordId || null,
      medicationName: medicationName.trim(),
      dosage: dosage.trim(),
      duration: duration?.trim() || '',
      instructions: instructions?.trim() || '',
      type,
      dueDate: dueDate ? new Date(dueDate) : null,
      createdBy: req.user.id  // ← Added here: the logged-in veterinarian
    });

    await prescription.save();

    // Populate related data
    await prescription.populate('petId', 'name species breed');
    await prescription.populate('medicalRecordId', 'date diagnosis');
    // Optional: also populate the vet who created it
    await prescription.populate('createdBy', 'firstName lastName');

    res.status(201).json({
      message: `${type} prescribed successfully`,
      prescription
    });
  } catch (error) {
    res.status(400).json({
      message: 'Error creating prescription',
      error: error.message
    });
  }
};

// Get all prescriptions/vaccinations for a pet
exports.getPrescriptionsByPet = async (req, res) => {
  try {
    const { petId } = req.params;
    const { type, activeOnly } = req.query; // Optional filters

    // Verify pet exists
    const pet = await PetProfile.findById(petId);
    if (!pet) {
      return res.status(404).json({ message: 'Pet not found' });
    }

    // Base query: only active (non-deleted) records
    let query = {
      petId,
      isDeleted: { $ne: true }
    };

    // Filter by type if provided
    if (type && ['Medication', 'Vaccination'].includes(type)) {
      query.type = type;
    }

    // Optional: only show upcoming (dueDate in future) — mainly for vaccinations
    if (activeOnly === 'true') {
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Normalize to start of day
      query.dueDate = { $gte: today };
    }

    const prescriptions = await Prescription.find(query)
      .populate('petId', 'name species breed photo')
      .populate({
        path: 'medicalRecordId',
        select: 'date diagnosis visibleToOwner',
        populate: {
          path: 'vetId',
          select: 'firstName lastName'
        }
      })
      .sort({ createdAt: -1 }) // Most recent first — consistent and expected
      // Alternative: .sort({ dueDate: 1 }) for upcoming first

    res.status(200).json({
      count: prescriptions.length,
      prescriptions
    });

  } catch (error) {
    console.error('Error in getPrescriptionsByPet:', error);
    res.status(500).json({
      message: 'Error fetching prescriptions',
      error: error.message
    });
  }
};

// Get upcoming reminders (medications & vaccinations due soon)
exports.getUpcomingReminders = async (req, res) => {
  try {
    const { petId } = req.params;
    const { daysAhead = 30 } = req.query;

    const petExists = await PetProfile.findById(petId);
    if (!petExists) {
      return res.status(404).json({ message: 'Pet not found' });
    }

    const today = new Date();
    const futureDate = new Date();
    futureDate.setDate(today.getDate() + parseInt(daysAhead));

    const upcoming = await Prescription.find({
      petId,
      dueDate: { $gte: today, $lte: futureDate },
      type: { $in: ['Medication', 'Vaccination'] }
    })
      .sort({ dueDate: 1 })
      .populate('petId', 'name photo')
      .select('medicationName type dueDate instructions');

    res.status(200).json({
      daysAhead: parseInt(daysAhead),
      count: upcoming.length,
      reminders: upcoming
    });
  } catch (error) {
    res.status(500).json({
      message: 'Error fetching upcoming reminders',
      error: error.message
    });
  }
};

// Get all upcoming reminders for an owner (across all their pets)
exports.getOwnerUpcomingReminders = async (req, res) => {
  try {
    const { ownerId } = req.params;
    const { daysAhead = 30 } = req.query;

    const today = new Date();
    const futureDate = new Date();
    futureDate.setDate(today.getDate() + parseInt(daysAhead));

    const reminders = await Prescription.aggregate([
      {
        $lookup: {
          from: 'petprofiles',
          localField: 'petId',
          foreignField: '_id',
          as: 'pet'
        }
      },
      { $unwind: '$pet' },
      { $match: { 'pet.ownerId': ownerId } },
      {
        $match: {
          dueDate: { $gte: today, $lte: futureDate },
          type: { $in: ['Medication', 'Vaccination'] }
        }
      },
      {
        $sort: { dueDate: 1 }
      },
      {
        $project: {
          medicationName: 1,
          type: 1,
          dueDate: 1,
          instructions: 1,
          petName: '$pet.name',
          petId: '$pet._id'
        }
      }
    ]);

    res.status(200).json({
      ownerId,
      daysAhead: parseInt(daysAhead),
      count: reminders.length,
      reminders
    });
  } catch (error) {
    res.status(500).json({
      message: 'Error fetching owner reminders',
      error: error.message
    });
  }
};

// Update prescription (Vet only)
exports.updatePrescription = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Prevent changing petId
    if (updates.petId) {
      return res.status(400).json({ message: 'Cannot change associated pet' });
    }

    if (updates.type && !['Medication', 'Vaccination'].includes(updates.type)) {
      return res.status(400).json({ message: 'Invalid type' });
    }

    const prescription = await Prescription.findByIdAndUpdate(
      id,
      updates,
      { new: true, runValidators: true }
    )
      .populate('petId', 'name')
      .populate('medicalRecordId', 'date');

    if (!prescription) {
      return res.status(404).json({ message: 'Prescription not found' });
    }

    res.status(200).json({
      message: 'Prescription updated successfully',
      prescription
    });
  } catch (error) {
    res.status(400).json({
      message: 'Error updating prescription',
      error: error.message
    });
  }
};

// Soft delete prescription
exports.deletePrescription = async (req, res) => {
  try {
    const { id } = req.params;

    const prescription = await Prescription.findByIdAndUpdate(
      id,
      { isDeleted: true, deletedAt: new Date() },
      { new: true }
    );

    if (!prescription) {
      return res.status(404).json({ message: 'Prescription not found' });
    }

    res.status(200).json({
      message: 'Prescription deleted successfully (soft delete)',
      prescription
    });
  } catch (error) {
    res.status(500).json({
      message: 'Error deleting prescription',
      error: error.message
    });
  }
};

// Get vaccination history summary for a pet
exports.getVaccinationSummary = async (req, res) => {
  try {
    const { petId } = req.params;

    const vaccinations = await Prescription.find({
      petId,
      type: 'Vaccination'
    })
      .sort({ dueDate: -1 })
      .select('medicationName dueDate instructions createdAt');

    const nextDue = vaccinations.find(v => v.dueDate && new Date(v.dueDate) > new Date());

    res.status(200).json({
      totalVaccinations: vaccinations.length,
      nextDueVaccination: nextDue || null,
      history: vaccinations
    });
  } catch (error) {
    res.status(500).json({
      message: 'Error fetching vaccination summary',
      error: error.message
    });
  }
};

// Generate and stream PDF prescription
exports.generatePrescriptionPDF = async (req, res) => {
  try {
    const { id } = req.params;

    const prescription = await Prescription.findById(id)
      .populate({
        path: 'petId',
        select: 'name species breed dateOfBirth photo ownerId',
        populate: {
          path: 'ownerId',
          select: 'firstName lastName phoneNumber email'
        }
      })
      .populate({
        path: 'medicalRecordId',
        select: 'date diagnosis vetId',
        populate: {
          path: 'vetId',
          select: 'firstName lastName'
        }
      });

    if (!prescription) {
      return res.status(404).json({ message: 'Prescription not found' });
    }

    const pet = prescription.petId;
    if (!pet) {
      return res.status(404).json({ message: 'Associated pet not found' });
    }

    // Install required package: npm install pdfkit
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 50, size: 'A4' });

    // Set headers for download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Prescription_${pet.name}_${prescription.medicationName.replace(/[^a-z0-9]/gi, '_')}_${new Date().toISOString().slice(0,10)}.pdf"`
    );

    doc.pipe(res);

    // Header
    doc.fontSize(24).text('Veterinary Prescription', { align: 'center' });
    doc.moveDown(2);

    // Pet Info
    doc.fontSize(16).text('Pet Information', { underline: true });
    doc.fontSize(12)
      .text(`Name: ${pet.name}`)
      .text(`Species: ${pet.species}`)
      .text(`Breed: ${pet.breed || 'Not specified'}`)
      .text(`Date of Birth: ${pet.dateOfBirth ? new Date(pet.dateOfBirth).toLocaleDateString() : 'Unknown'}`)
      .moveDown();

    // Owner Info
    if (pet.ownerId) {
      doc.fontSize(16).text('Owner Information', { underline: true });
      doc.fontSize(12)
        .text(`Name: ${pet.ownerId.firstName} ${pet.ownerId.lastName}`)
        .text(`Phone: ${pet.ownerId.phoneNumber || 'Not provided'}`)
        .text(`Email: ${pet.ownerId.email || 'Not provided'}`)
        .moveDown();
    }

    // Issuing Vet (if from medical record)
    if (prescription.medicalRecordId && prescription.medicalRecordId.vetId) {
      doc.text(`Issued by: Dr. ${prescription.medicalRecordId.vetId.firstName} ${prescription.medicalRecordId.vetId.lastName}`);
      doc.moveDown();
    }

    // Prescription Details
    doc.fontSize(18).text('Prescription Details', { underline: true });
    doc.moveDown(0.5);

    const details = [
      { label: 'Type', value: prescription.type },
      { label: 'Medication/Vaccine', value: prescription.medicationName },
      { label: 'Dosage', value: prescription.dosage },
      { label: 'Duration', value: prescription.duration || 'N/A' },
      { label: 'Due Date / Next Booster', value: prescription.dueDate ? new Date(prescription.dueDate).toLocaleDateString() : 'N/A' },
    ];

    details.forEach(item => {
      doc.fontSize(14).text(`${item.label}:`, { continued: true });
      doc.fontSize(14).text(` ${item.value}`, { align: 'left' });
    });

    doc.moveDown(2);

    // Instructions
    doc.fontSize(16).text('Instructions', { underline: true });
    doc.fontSize(12).text(
      prescription.instructions || 'No specific instructions provided.',
      { align: 'justify' }
    );

    // Footer
    doc.moveDown(4);
    doc.fontSize(10)
      .text(`Issued on: ${new Date().toLocaleDateString()}`, { align: 'center' })
      .text('This is an official veterinary prescription.', { align: 'center' });

    doc.end();

  } catch (error) {
    console.error('PDF Generation Error:', error);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Failed to generate PDF' });
    }
  }
};