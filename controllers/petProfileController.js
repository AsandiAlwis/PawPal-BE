const PetProfile = require('../models/PetProfile');
const PetOwner = require('../models/PetOwner');
const Clinic = require('../models/Clinic');

// Create a new pet profile (Pet Owner only)
exports.createPet = async (req, res) => {
  try {
    const {
      name,
      species,
      breed,
      dateOfBirth,
      gender,
      color,
      weight,
      microchipNumber,
      photo,
      notes
    } = req.body;

    // Required fields
    if (!name || !species) {
      return res.status(400).json({
        message: 'Pet name and species are required'
      });
    }

    // Validate gender
    if (gender && !['Male', 'Female', 'Other'].includes(gender)) {
      return res.status(400).json({
        message: 'Gender must be Male, Female, or Other'
      });
    }

    // Owner ID from authenticated user (later via JWT)
    const ownerId = req.body.ownerId || req.user?.id;
    if (!ownerId) {
      return res.status(401).json({ message: 'Owner authentication required' });
    }

    // Verify owner exists
    const owner = await PetOwner.findById(ownerId);
    if (!owner) {
      return res.status(404).json({ message: 'Owner not found' });
    }

    const pet = new PetProfile({
      ownerId,
      name: name.trim(),
      species: species.trim(),
      breed: breed?.trim() || '',
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
      gender,
      color: color?.trim() || '',
      weight: weight ? parseFloat(weight) : null,
      microchipNumber: microchipNumber?.trim() || '',
      photo: photo || '', // URL from upload (Cloudinary/Multer)
      notes: notes?.trim() || '',
      registrationStatus: 'Pending', // Default until clinic approves
      registeredClinicId: null
    });

    await pet.save();

    // Populate owner info
    await pet.populate('ownerId', 'firstName lastName email phoneNumber');

    res.status(201).json({
      message: 'Pet profile created successfully',
      pet
    });
  } catch (error) {
    res.status(400).json({
      message: 'Error creating pet profile',
      error: error.message
    });
  }
};

// Get all pets belonging to an owner
exports.getPetsByOwner = async (req, res) => {
  try {
    const { ownerId } = req.params;
    const { status } = req.query;

    const ownerExists = await PetOwner.findById(ownerId);
    if (!ownerExists) {
      return res.status(404).json({ message: 'Owner not found' });
    }

    let query = { 
      ownerId,
      isDeleted: { $ne: true }  // ← THIS LINE IS THE FIX: exclude soft-deleted pets
    };

    if (status) {
      query.registrationStatus = status;
    }

    const pets = await PetProfile.find(query)
      .populate('registeredClinicId', 'name address phoneNumber')
      .sort({ name: 1 });

    res.status(200).json({
      count: pets.length,
      pets
    });
  } catch (error) {
    console.error('Error in getPetsByOwner:', error);
    res.status(500).json({
      message: 'Error fetching pets by owner',
      error: error.message
    });
  }
};

// Get single pet by ID (with full details)
exports.getPetById = async (req, res) => {
  try {
    const { id } = req.params;

    const pet = await PetProfile.findById(id)
      .populate('ownerId', 'firstName lastName email phoneNumber')
      .populate('registeredClinicId', 'name address phoneNumber operatingHours');

    if (!pet) {
      return res.status(404).json({ message: 'Pet not found' });
    }

    res.status(200).json(pet);
  } catch (error) {
    res.status(500).json({
      message: 'Error fetching pet',
      error: error.message
    });
  }
};

// Update pet profile (Owner only)
exports.updatePet = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Prevent changing ownerId or registration status directly
    if (updates.ownerId) {
      return res.status(403).json({ message: 'Cannot change pet owner' });
    }
    if (updates.registrationStatus || updates.registeredClinicId) {
      return res.status(403).json({
        message: 'Registration status can only be updated by clinic'
      });
    }

    // Validate gender if updated
    if (updates.gender && !['Male', 'Female', 'Other'].includes(updates.gender)) {
      return res.status(400).json({ message: 'Invalid gender value' });
    }

    const pet = await PetProfile.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    )
      .populate('ownerId', 'firstName lastName')
      .populate('registeredClinicId', 'name');

    if (!pet) {
      return res.status(404).json({ message: 'Pet not found' });
    }

    res.status(200).json({
      message: 'Pet profile updated successfully',
      pet
    });
  } catch (error) {
    res.status(400).json({
      message: 'Error updating pet profile',
      error: error.message
    });
  }
};

// Soft delete pet profile
exports.deletePet = async (req, res) => {
  try {
    const { id } = req.params;

    const pet = await PetProfile.findByIdAndUpdate(
      id,
      { isDeleted: true, deletedAt: new Date() },
      { new: true }
    );

    if (!pet) {
      return res.status(404).json({ message: 'Pet not found' });
    }

    res.status(200).json({
      message: 'Pet profile soft-deleted successfully',
      pet
    });
  } catch (error) {
    res.status(500).json({
      message: 'Error deleting pet profile',
      error: error.message
    });
  }
};

// Request registration with a clinic (Owner action)
exports.requestClinicRegistration = async (req, res) => {
  try {
    const { id } = req.params; // petId
    const { clinicId } = req.body;

    if (!clinicId) {
      return res.status(400).json({ message: 'clinicId is required' });
    }

    const pet = await PetProfile.findById(id);
    if (!pet) {
      return res.status(404).json({ message: 'Pet not found' });
    }

    const clinic = await Clinic.findById(clinicId);
    if (!clinic) {
      return res.status(404).json({ message: 'Clinic not found' });
    }

    // Update status to Pending if not already registered
    if (pet.registrationStatus !== 'Pending') {
      pet.registrationStatus = 'Pending';
      pet.registeredClinicId = clinicId;
      await pet.save();
    }

    res.status(200).json({
      message: 'Registration request sent to clinic',
      pet
    });
  } catch (error) {
    res.status(400).json({
      message: 'Error requesting clinic registration',
      error: error.message
    });
  }
};

// Get pets pending registration for a clinic (Vet dashboard)
exports.getPendingRegistrationsByClinic = async (req, res) => {
  try {
    const { clinicId } = req.params;

    const pets = await PetProfile.find({
      //registeredClinicId: clinicId,
      registrationStatus: 'Pending'
    })
      .populate('ownerId', 'firstName lastName email phoneNumber')
      .sort({ createdAt: -1 });

    res.status(200).json({
      count: pets.length,
      pendingPets: pets
    });
  } catch (error) {
    res.status(500).json({
      message: 'Error fetching pending registrations',
      error: error.message
    });
  }
};

// Approve pet registration (Vet only - for their clinic)
exports.approvePetRegistration = async (req, res) => {
  try {
    const { id } = req.params; // petId

    const pet = await PetProfile.findOne({
      _id: id,
      registeredClinicId: req.user.clinicId, // Ensure it belongs to the vet's clinic
      registrationStatus: 'Pending'
    });

    if (!pet) {
      return res.status(404).json({
        message: 'Pet not found or not pending registration in your clinic'
      });
    }

    pet.registrationStatus = 'Approved';
    await pet.save();

    // Optionally populate for response
    await pet.populate('ownerId', 'firstName lastName email phoneNumber');
    await pet.populate('registeredClinicId', 'name');

    res.status(200).json({
      message: 'Pet registration approved successfully',
      pet
    });
  } catch (error) {
    console.error('Error approving pet registration:', error);
    res.status(500).json({
      message: 'Error approving registration',
      error: error.message
    });
  }
};