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

    if (!type) {
      return res.status(400).json({
        message: 'type is required'
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
      .populate('createdBy', 'firstName lastName')
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

    if (updates.type && !updates.type) {
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

// Generate and stream PDF prescription report for multiple prescriptions
exports.generatePrescriptionPDF = async (req, res) => {
  try {
    const { id } = req.params;
    const reportType = req.query.reportType || 'prescription'; // 'prescription' or 'vaccination'
    const isVaccinationReport = reportType === 'vaccination';

    // Find all prescriptions for this medical record
    const prescriptions = await Prescription.find({ medicalRecordId: id, isDeleted: { $ne: true } })
      .populate({
        path: 'petId',
        select: 'name species breed dateOfBirth photo ownerId registeredClinicId',
        populate: [
          {
            path: 'ownerId',
            select: 'firstName lastName phoneNumber email'
          },
          {
            path: 'registeredClinicId',
            select: 'name address phoneNumber'
          }
        ]
      })
      .populate({
        path: 'medicalRecordId',
        select: 'date diagnosis vetId',
        populate: {
          path: 'vetId',
          select: 'firstName lastName'
        }
      });

    // Fallback: If no prescriptions found for medicalRecordId, try finding by ID as fallback for single prescription
    let finalPrescriptions = prescriptions;
    if (prescriptions.length === 0) {
      const singlePres = await Prescription.findById(id)
        .populate({
          path: 'petId',
          select: 'name species breed dateOfBirth photo ownerId registeredClinicId',
          populate: [
            {
              path: 'ownerId',
              select: 'firstName lastName phoneNumber email'
            },
            {
              path: 'registeredClinicId',
              select: 'name address phoneNumber'
            }
          ]
        })
        .populate({
          path: 'medicalRecordId',
          select: 'date diagnosis vetId',
          populate: {
            path: 'vetId',
            select: 'firstName lastName'
          }
        });
      if (!singlePres) {
        return res.status(404).json({ message: 'No prescriptions found for this record' });
      }
      finalPrescriptions = [singlePres];
    }

    const firstPres = finalPrescriptions[0];
    const pet = firstPres.petId;
    if (!pet) {
      return res.status(404).json({ message: 'Associated pet not found' });
    }

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 50, size: 'A4' });

    const reportLabel = isVaccinationReport ? 'Vaccination_Report' : 'Prescription_Report';
    const filename = `${reportLabel}_${pet.name}_${new Date().toISOString().slice(0, 10)}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    doc.pipe(res);

    // Color Palette — purple for vaccination, green for prescription
    const primaryColor = isVaccinationReport ? '#7b1fa2' : '#2e7d32';

    // --- Header Section ---
    doc.rect(0, 0, 612, 120).fill(primaryColor);
    doc.fillColor('#ffffff')
      .fontSize(26)
      .font('Helvetica-Bold')
      .text(isVaccinationReport ? 'PAWPAL - VACCINATION REPORT' : 'PAWPAL - PRESCRIPTION REPORT', 50, 45);

    doc.fontSize(10)
      .font('Helvetica')
      .text(isVaccinationReport ? 'OFFICIAL VETERINARY VACCINATION RECORD' : 'OFFICIAL VETERINARY MEDICAL RECORD', 50, 80);

    // --- Pet & Owner Info ---
    doc.fillColor('#000000').moveDown(6);
    const startY = 160;
    doc.fontSize(14).font('Helvetica-Bold').fillColor(primaryColor).text('PET INFORMATION', 50, startY);
    doc.fontSize(14).font('Helvetica-Bold').text('OWNER INFORMATION', 320, startY);

    doc.rect(50, startY + 20, 240, 1).fill(primaryColor);
    doc.rect(320, startY + 20, 240, 1).fill(primaryColor);

    doc.fillColor('#333333').fontSize(11).font('Helvetica').moveDown(1.5);

    let currentY = startY + 35;
    doc.text(`Name`, 50, currentY);
    doc.font('Helvetica-Bold').text(`: ${pet.name}`, 110, currentY);

    doc.font('Helvetica').text(`Species`, 50, currentY + 18);
    doc.font('Helvetica-Bold').text(`: ${pet.species}`, 110, currentY + 18);

    doc.font('Helvetica').text(`Breed`, 50, currentY + 36);
    doc.font('Helvetica-Bold').text(`: ${pet.breed || 'N/A'}`, 110, currentY + 36);

    doc.font('Helvetica').text(`DOB`, 50, currentY + 54);
    doc.font('Helvetica-Bold').text(`: ${pet.dateOfBirth ? new Date(pet.dateOfBirth).toLocaleDateString() : 'N/A'}`, 110, currentY + 54);

    if (pet.ownerId) {
      doc.font('Helvetica').text(`Name`, 320, currentY);
      doc.font('Helvetica-Bold').text(`: ${pet.ownerId.firstName} ${pet.ownerId.lastName}`, 380, currentY);

      doc.font('Helvetica').text(`Phone`, 320, currentY + 18);
      doc.font('Helvetica-Bold').text(`: ${pet.ownerId.phoneNumber || 'N/A'}`, 380, currentY + 18);

      doc.font('Helvetica').text(`Email`, 320, currentY + 36);
      doc.font('Helvetica-Bold').text(`: ${pet.ownerId.email || 'N/A'}`, 380, currentY + 36);
    }

    // --- Clinical Context ---
    doc.moveDown(6);
    const middleY = doc.y;
    doc.fontSize(14).font('Helvetica-Bold').fillColor(primaryColor).text('CLINICAL CONTEXT', 50, middleY);
    doc.rect(50, middleY + 20, 510, 1).fill(primaryColor);

    doc.fillColor('#333333').fontSize(11).font('Helvetica').moveDown(2.5);

    // Build clinical context rows dynamically
    const clinic = pet.registeredClinicId;
    let clinicalY = middleY + 35;
    const labelX = 50;
    const valueX = 200;
    const rowH = 18;

    if (firstPres.medicalRecordId && firstPres.medicalRecordId.vetId) {
      doc.font('Helvetica-Bold').text('Attending Veterinarian:', labelX, clinicalY);
      doc.font('Helvetica').text(`Dr. ${firstPres.medicalRecordId.vetId.firstName} ${firstPres.medicalRecordId.vetId.lastName}`, valueX, clinicalY);
      clinicalY += rowH;
    }

    if (clinic) {
      doc.font('Helvetica-Bold').text('Clinic Name:', labelX, clinicalY);
      doc.font('Helvetica').text(clinic.name || 'N/A', valueX, clinicalY);
      clinicalY += rowH;

      doc.font('Helvetica-Bold').text('Clinic Address:', labelX, clinicalY);
      const cleanAddress = (clinic.address || 'N/A').replace(/\r?\n|\r/g, ', ');
      doc.font('Helvetica').text(cleanAddress, valueX, clinicalY, { lineBreak: false });
      clinicalY += rowH;

      doc.font('Helvetica-Bold').text('Contact Number:', labelX, clinicalY);
      doc.font('Helvetica').text(clinic.phoneNumber || 'N/A', valueX, clinicalY);
      clinicalY += rowH;
    }

    doc.font('Helvetica-Bold').text('Date Issued:', labelX, clinicalY);
    doc.font('Helvetica').text(new Date(firstPres.createdAt).toLocaleDateString(), valueX, clinicalY);

    // --- Render Section based on report type ---
    if (isVaccinationReport) {
      // For vaccination reports — all items are vaccinations (type !== 'Medication')
      const vaccinationItems = finalPrescriptions.filter(p => p.type !== 'Medication');
      const allItems = vaccinationItems.length > 0 ? vaccinationItems : finalPrescriptions;

      doc.moveDown(4);
      doc.fontSize(16).font('Helvetica-Bold').fillColor(primaryColor).text('VACCINATIONS', 50);
      doc.rect(50, doc.y + 2, 510, 2).fill(primaryColor);
      doc.moveDown(1);

      allItems.forEach((pres, index) => {
        if (doc.y > 700) doc.addPage();

        doc.fillColor('#000000').fontSize(12).font('Helvetica-Bold').text(`${index + 1}. ${pres.medicationName}`);
        doc.fontSize(10).font('Helvetica').fillColor('#444444')
          .text(`Vaccine Type  : ${pres.type}`, 70)
          .text(`Dosage        : ${pres.dosage || 'N/A'}`, 70)
          .text(`Next Due Date : ${pres.dueDate ? new Date(pres.dueDate).toLocaleDateString() : 'N/A'}`, 70)
          .text(`Instructions  : ${pres.instructions || 'Follow as directed.'}`, 70);

        doc.moveDown(1);
        doc.rect(70, doc.y, 450, 0.5).fill('#eeeeee');
        doc.moveDown(1);
      });

    } else {
      // For prescription reports — split into medications and vaccinations
      const medications = finalPrescriptions.filter(p => p.type === 'Medication');
      const vaccinations = finalPrescriptions.filter(p => p.type !== 'Medication');

      // --- Render Medications ---
      if (medications.length > 0) {
        doc.moveDown(4);
        doc.fontSize(16).font('Helvetica-Bold').fillColor(primaryColor).text('MEDICATIONS (Rx)', 50);
        doc.rect(50, doc.y + 2, 510, 2).fill(primaryColor);
        doc.moveDown(1);

        medications.forEach((pres, index) => {
          if (doc.y > 700) doc.addPage();

          doc.fillColor('#000000').fontSize(12).font('Helvetica-Bold').text(`${index + 1}. ${pres.medicationName}`);
          doc.fontSize(10).font('Helvetica').fillColor('#444444')
            .text(`Dosage: ${pres.dosage}`, 70)
            .text(`Duration: ${pres.duration || 'As directed'}`, 70)
            .text(`Instructions: ${pres.instructions || 'Follow as directed.'}`, 70);

          doc.moveDown(1);
          doc.rect(70, doc.y, 450, 0.5).fill('#eeeeee');
          doc.moveDown(1);
        });
      }

      // --- Render Vaccinations (in prescription report) ---
      if (vaccinations.length > 0) {
        doc.moveDown(2);
        doc.fontSize(16).font('Helvetica-Bold').fillColor('#7b1fa2').text('VACCINATIONS', 50);
        doc.rect(50, doc.y + 2, 510, 2).fill('#7b1fa2');
        doc.moveDown(1);

        vaccinations.forEach((pres, index) => {
          if (doc.y > 700) doc.addPage();

          doc.fillColor('#000000').fontSize(12).font('Helvetica-Bold').text(`${index + 1}. ${pres.medicationName}`);
          doc.fontSize(10).font('Helvetica').fillColor('#444444')
            .text(`Type: ${pres.type}`, 70)
            .text(`Next Due Date: ${pres.dueDate ? new Date(pres.dueDate).toLocaleDateString() : 'N/A'}`, 70, doc.y, { continued: false });

          doc.moveDown(1);
          doc.rect(70, doc.y, 450, 0.5).fill('#eeeeee');
          doc.moveDown(1);
        });
      }
    }

    // --- Footer ---
    const footerY = 750;
    doc.rect(0, 800, 612, 42).fill(primaryColor);
    doc.fillColor('#999999').fontSize(9).font('Helvetica')
      .text('This document is generated by PawPal (PetCare-2025). Follow all veterinary instructions.', 50, footerY, { align: 'center' })
      .moveDown(0.5)
      .fontSize(8)
      .text(`Report Generated On: ${new Date().toLocaleString()}`, { align: 'center' });

    doc.end();

  } catch (error) {
    console.error('PDF Generation Error:', error);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Failed to generate PDF' });
    }
  }
};
