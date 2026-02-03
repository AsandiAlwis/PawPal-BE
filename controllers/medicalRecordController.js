const MedicalRecord = require('../models/MedicalRecord');
const PetProfile = require('../models/PetProfile');
const { cloudinary } = require('../config/cloudinary');

exports.createMedicalRecord = async (req, res) => {
  try {
    const {
      petId,
      diagnosis,
      treatmentNotes,
      visibleToOwner = false,
      attachments = [] // Now expect array of Cloudinary URLs from frontend
    } = req.body;

    if (!petId || !diagnosis?.trim()) {
      return res.status(400).json({
        message: 'petId and diagnosis are required'
      });
    }

    const pet = await PetProfile.findById(petId)
      .populate('registeredClinicId')
      .select('name registeredClinicId');

    if (!pet) {
      return res.status(404).json({ message: 'Pet not found' });
    }

    // Optional: Check if vet belongs to pet's clinic
    // (You can add this later via req.user.clinicId)

    const record = new MedicalRecord({
      petId,
      vetId: req.user.id,
      diagnosis: diagnosis.trim(),
      treatmentNotes: treatmentNotes?.trim() || '',
      visibleToOwner,
      attachments, // ← Cloudinary URLs
      date: new Date()
    });

    await record.save();

    await record.populate('vetId', 'firstName lastName specialization');
    await record.populate('petId', 'name species breed photo');

    res.status(201).json({
      message: 'Medical record created successfully',
      record
    });
  } catch (error) {
    console.error('Error creating medical record:', error);
    res.status(500).json({
      message: 'Error creating medical record',
      error: error.message
    });
  }
};

// Get all medical records for a pet (with owner/vet view filtering)
exports.getRecordsByPet = async (req, res) => {
  try {
    const { petId } = req.params;
    const { ownerView, page = 1, limit = 20 } = req.query;

    // Validate pet exists
    const petExists = await PetProfile.findById(petId);
    if (!petExists) {
      return res.status(404).json({ message: 'Pet not found' });
    }

    const query = { 
      petId,
      isDeleted: { $ne: true } // ← ADD THIS LINE: Exclude soft-deleted records
    };

    // If ownerView=true → only show records marked visibleToOwner
    if (ownerView === 'true') {
      query.visibleToOwner = true;
    }

    const records = await MedicalRecord.find(query)
      .populate('vetId', 'firstName lastName specialization')
      .sort({ date: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await MedicalRecord.countDocuments(query);

    res.status(200).json({
      records,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
        hasMore: records.length === parseInt(limit)
      }
    });
  } catch (error) {
    res.status(500).json({
      message: 'Error fetching medical records',
      error: error.message
    });
  }
};

// Get single medical record by ID (with access control)
exports.getRecordById = async (req, res) => {
  try {
    const { id } = req.params;

    const record = await MedicalRecord.findById(id)
      .populate('vetId', 'firstName lastName specialization')
      .populate('petId', 'name species breed ownerId');

    if (!record) {
      return res.status(404).json({ message: 'Medical record not found' });
    }

    // Access control: if owner is requesting and record is not visible
    // This will be fully enforced with auth middleware
    // For now, just return with warning if hidden
    if (!record.visibleToOwner && req.user?.role === 'owner') {
      return res.status(403).json({
        message: 'This medical record is not visible to pet owners'
      });
    }

    res.status(200).json(record);
  } catch (error) {
    res.status(500).json({
      message: 'Error fetching medical record',
      error: error.message
    });
  }
};

// Update medical record (Vet only)
exports.updateMedicalRecord = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Prevent changing petId
    if (updates.petId) {
      return res.status(400).json({ message: 'Cannot change pet association' });
    }

    const record = await MedicalRecord.findByIdAndUpdate(
      id,
      updates,
      { new: true, runValidators: true }
    )
      .populate('vetId', 'firstName lastName')
      .populate('petId', 'name');

    if (!record) {
      return res.status(404).json({ message: 'Medical record not found' });
    }

    res.status(200).json({
      message: 'Medical record updated successfully',
      record
    });
  } catch (error) {
    res.status(400).json({
      message: 'Error updating medical record',
      error: error.message
    });
  }
};

// Toggle visibility to owner
exports.toggleVisibility = async (req, res) => {
  try {
    const { id } = req.params;
    const { visibleToOwner } = req.body;

    if (typeof visibleToOwner !== 'boolean') {
      return res.status(400).json({ message: 'visibleToOwner must be true or false' });
    }

    const record = await MedicalRecord.findByIdAndUpdate(
      id,
      { visibleToOwner },
      { new: true }
    );

    if (!record) {
      return res.status(404).json({ message: 'Medical record not found' });
    }

    res.status(200).json({
      message: `Record is now ${visibleToOwner ? 'visible' : 'hidden'} to owner`,
      record
    });
  } catch (error) {
    res.status(400).json({
      message: 'Error updating visibility',
      error: error.message
    });
  }
};

exports.deleteMedicalRecord = async (req, res) => {
  try {
    const { id } = req.params;

    const record = await MedicalRecord.findById(id);
    if (!record) {
      return res.status(404).json({ message: 'Medical record not found' });
    }

    // Optional: Delete files from Cloudinary
    if (record.attachments.length > 0) {
      const publicIds = record.attachments.map(url => {
        const parts = url.split('/');
        const fileName = parts[parts.length - 1];
        const publicId = `vet-medical-records/${fileName.split('.')[0]}`;
        return publicId;
      });
      await cloudinary.api.delete_resources(publicIds);
    }

    await MedicalRecord.findByIdAndDelete(id);

    res.status(200).json({
      message: 'Medical record permanently deleted'
    });
  } catch (error) {
    res.status(500).json({
      message: 'Error deleting medical record',
      error: error.message
    });
  }
};

// Get medical summary for a pet (dashboard stats)
exports.getMedicalSummaryByPet = async (req, res) => {
  try {
    const { petId } = req.params;

    const totalRecords = await MedicalRecord.countDocuments({ petId });
    const visibleRecords = await MedicalRecord.countDocuments({ petId, visibleToOwner: true });
    const latestVisit = await MedicalRecord.findOne({ petId })
      .sort({ date: -1 })
      .select('date diagnosis vetId')
      .populate('vetId', 'firstName lastName');

    res.status(200).json({
      totalRecords,
      visibleToOwner: visibleRecords,
      latestVisit: latestVisit || null,
      lastUpdated: latestVisit ? latestVisit.date : null
    });
  } catch (error) {
    res.status(500).json({
      message: 'Error fetching medical summary',
      error: error.message
    });
  }
};