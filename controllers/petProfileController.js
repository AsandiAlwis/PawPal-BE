const PetProfile = require('../models/PetProfile');
const PetOwner = require('../models/PetOwner');
const Clinic = require('../models/Clinic');
const Veterinarian = require('../models/Veterinarian');
const ClinicStaff = require('../models/ClinicStaff');
const ChatMessage = require('../models/ChatMessage');

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
      lastVaccinationDate,
      medicalRecords,
      photo,
      notes,
      clinicId // ← ADD THIS
    } = req.body;

    // Required fields
    if (!name || !species) {
      return res.status(400).json({
        message: 'Pet name and species are required'
      });
    }

    // Optional: Validate clinicId if provided
    if (clinicId) {
      const clinic = await Clinic.findById(clinicId);
      if (!clinic) {
        return res.status(400).json({
          message: 'Invalid clinic ID'
        });
      }
    }

    // Validate gender
    if (gender && !['Male', 'Female', 'Other'].includes(gender)) {
      return res.status(400).json({
        message: 'Gender must be Male, Female, or Other'
      });
    }

    // Owner ID from authenticated user
    const ownerId = req.body.ownerId || req.user?.id;
    if (!ownerId) {
      return res.status(401).json({ message: 'Owner authentication required' });
    }

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
      lastVaccinationDate: lastVaccinationDate ? new Date(lastVaccinationDate) : null,
      medicalRecords: medicalRecords || '',
      photo: photo || '',
      notes: notes?.trim() || '',
      registrationStatus: clinicId ? 'Pending' : 'Pending', // Still pending until approved
      registeredClinicId: clinicId || null // ← NOW SAVED!
    });

    await pet.save();

    // Populate for response
    await pet.populate('ownerId', 'firstName lastName email phoneNumber');
    if (pet.registeredClinicId) {
      await pet.populate('registeredClinicId', 'name address phoneNumber');
    }

    res.status(201).json({
      message: 'Pet profile created successfully',
      pet
    });
  } catch (error) {
    console.error('Error creating pet:', error);
    res.status(500).json({
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

    // Fetch the last message for each pet
    const petsWithLastMessage = await Promise.all(pets.map(async (pet) => {
      const lastMsg = await ChatMessage.findOne({ petId: pet._id })
        .sort({ timestamp: -1 })
        .limit(1);

      return {
        ...pet.toObject(),
        lastMessage: lastMsg ? lastMsg.content : null,
        lastMessageTime: lastMsg ? lastMsg.timestamp : null
      };
    }));

    res.status(200).json({
      count: pets.length,
      pets: petsWithLastMessage
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

// Get pets pending registration for a clinic (Vet dashboard) - FIXED VERSION
exports.getPendingRegistrationsByClinic = async (req, res) => {
  try {
    // Get clinicId from params and ensure it's a string
    let clinicId = req.params?.clinicId;

    // If clinicId is an object, extract the string value
    if (clinicId && typeof clinicId === 'object') {
      console.log('Warning: clinicId is an object, extracting string value');
      clinicId = clinicId.toString();
    }

    if (!clinicId) {
      // Try to get clinicId from veterinarian or staff record
      if (req.user?.role === 'vet') {
        const veterinarian = await Veterinarian.findOne({ email: req.user.email });
        if (veterinarian && veterinarian.currentActiveClinicId) {
          clinicId = veterinarian.currentActiveClinicId.toString();
        } else {
          // Fallback to ClinicStaff if not found as Veterinarian
          const staff = await ClinicStaff.findOne({ email: req.user.email });
          if (staff && staff.clinicId) {
            clinicId = staff.clinicId.toString();
          }
        }
      }
    }

    if (!clinicId) {
      return res.status(400).json({
        message: 'Clinic ID not found. Please ensure you are associated with a clinic.'
      });
    }

    // Ensure clinicId is a string
    clinicId = clinicId.toString();

    // Verify clinic exists
    const clinic = await Clinic.findById(clinicId);
    if (!clinic) {
      return res.status(404).json({ message: 'Clinic not found' });
    }

    const { status } = req.query;
    const registrationStatus = status || 'Pending';

    const pets = await PetProfile.find({
      registeredClinicId: clinicId,
      registrationStatus: registrationStatus,
      isDeleted: { $ne: true }
    })
      .populate('ownerId', 'firstName lastName email phoneNumber')
      .populate('registeredClinicId', 'name address phoneNumber')
      .sort({ createdAt: -1 });

    res.status(200).json({
      count: pets.length,
      pendingPets: pets,
      clinicInfo: {
        id: clinic._id,
        name: clinic.name,
        address: clinic.address
      }
    });

  } catch (error) {
    console.error('[PENDING CONTROLLER ERROR] Full error:', error);
    console.error('[PENDING CONTROLLER ERROR] Stack:', error.stack);
    res.status(500).json({
      message: 'Error fetching pending registrations',
      error: error.message
    });
  }
};

// Alternative: Get pending registrations by vet ID (for the route /vets/:vetId/pets/pending)
exports.getPendingRegistrationsByVet = async (req, res) => {
  try {
    const { vetId } = req.params;

    // Verify the vet exists
    const veterinarian = await Veterinarian.findById(vetId);
    if (!veterinarian) {
      return res.status(404).json({ message: 'Veterinarian not found' });
    }

    const clinicId = veterinarian.clinicId;
    if (!clinicId) {
      return res.status(400).json({
        message: 'Veterinarian is not associated with any clinic'
      });
    }

    const pets = await PetProfile.find({
      registeredClinicId: clinicId,
      registrationStatus: 'Pending',
      isDeleted: { $ne: true }
    })
      .populate('ownerId', 'firstName lastName email phoneNumber')
      .populate('registeredClinicId', 'name address phoneNumber')
      .sort({ createdAt: -1 });

    res.status(200).json({
      count: pets.length,
      pendingPets: pets,
      clinicInfo: {
        id: clinicId,
        name: veterinarian.clinicName || 'Clinic'
      }
    });
  } catch (error) {
    console.error('Error fetching pending registrations by vet:', error);
    res.status(500).json({
      message: 'Error fetching pending registrations',
      error: error.message
    });
  }
};

// Get approved pets for a clinic (Vet dashboard - view registered pets) - FIXED VERSION
exports.getApprovedRegistrationsByClinic = async (req, res) => {
  try {
    // Get clinicId and ensure it's a string
    let { clinicId } = req.params;

    // If clinicId is an object, extract the string value
    if (clinicId && typeof clinicId === 'object') {
      console.log('Warning: clinicId is an object in getApprovedRegistrationsByClinic, converting to string');
      clinicId = clinicId.toString();
    }

    if (!clinicId) {
      return res.status(400).json({ message: 'Clinic ID is required' });
    }

    // Ensure clinicId is a string
    clinicId = clinicId.toString();

    // Validate clinic exists
    const clinic = await Clinic.findById(clinicId);
    if (!clinic) {
      return res.status(404).json({ message: 'Clinic not found' });
    }

    const pets = await PetProfile.find({
      registeredClinicId: clinicId,
      registrationStatus: 'Approved',
      isDeleted: { $ne: true }
    })
      .populate('ownerId', 'firstName lastName email phoneNumber address')
      .sort({ createdAt: -1 });

    res.status(200).json({
      count: pets.length,
      approvedPets: pets
    });
  } catch (error) {
    console.error('Error fetching approved registrations:', error);
    res.status(500).json({
      message: 'Error fetching approved pet registrations',
      error: error.message
    });
  }
};

// Get ONLY the count of approved registered pets for a clinic
// Ideal for dashboard stats — fast and lightweight
exports.getRegisteredPetsCountByClinic = async (req, res) => {
  try {
    const { clinicId } = req.params;

    const isVetRole = req.user.role === 'vet';
    const isExplicitStaff = req.user.role === 'staff' || req.user.role === 'staffMember';

    if (!req.user || (!isVetRole && !isExplicitStaff)) {
      return res.status(403).json({
        message: 'Access denied: Only clinic staff and veterinarians can access this data'
      });
    }

    let hasAccess = false;

    // Try finding in Veterinarian first
    const vet = await Veterinarian.findById(req.user.id);
    if (vet) {
      if (vet.currentActiveClinicId && vet.currentActiveClinicId.toString() === clinicId) {
        hasAccess = true;
      } else if (vet.clinicId && vet.clinicId.toString() === clinicId) {
        hasAccess = true;
      } else if (vet.ownedClinics && vet.ownedClinics.some(id => id.toString() === clinicId)) {
        hasAccess = true;
      }
    } else {
      // Try finding in ClinicStaff
      const staff = await ClinicStaff.findById(req.user.id);
      if (staff) {
        if (staff.clinicId && staff.clinicId.toString() === clinicId) {
          hasAccess = true;
        } else if (staff.assignedClinics && staff.assignedClinics.some(id => id.toString() === clinicId)) {
          hasAccess = true;
        }
      }
    }

    if (!hasAccess) {
      return res.status(403).json({
        message: 'You do not have permission to view stats for this clinic'
      });
    }

    // Verify clinic exists
    const clinicExists = await Clinic.findById(clinicId);
    if (!clinicExists) {
      return res.status(404).json({ message: 'Clinic not found' });
    }

    // Count pets
    const count = await PetProfile.countDocuments({
      registeredClinicId: clinicId,
      registrationStatus: 'Approved',
      isDeleted: { $ne: true }
    });

    res.status(200).json({
      message: 'Registered pets count retrieved successfully',
      clinicId,
      totalRegisteredPets: count
    });

  } catch (error) {
    console.error('Error in getRegisteredPetsCountByClinic:', error);
    res.status(500).json({
      message: 'Error fetching registered pets count',
      error: error.message
    });
  }
};

// Get ONLY the count of pending pet registrations for a clinic
// Ideal for dashboard stats — fast and lightweight
exports.getPendingRegistrationsCountByClinic = async (req, res) => {
  try {
    const { clinicId } = req.params;

    const isStaff = req.user.role === 'staff' || req.user.role === 'staffMember';
    const isVet = req.user.role === 'vet';

    if (!req.user || (!isVet && !isStaff)) {
      return res.status(403).json({
        message: 'Access denied: Only clinic staff and veterinarians can access this data'
      });
    }

    const isEnhanced = req.user.accessLevel === 'Enhanced';

    if (!isEnhanced) {
      let userClinicId = null;
      const vet = await Veterinarian.findById(req.user.id);
      if (vet) {
        userClinicId = vet.clinicId || vet.currentActiveClinicId;
      } else {
        const staff = await ClinicStaff.findById(req.user.id);
        userClinicId = staff?.clinicId;
      }

      if (userClinicId && userClinicId.toString() !== clinicId) {
        return res.status(403).json({
          message: 'You do not have permission to view stats for this clinic'
        });
      }
    }

    // Optional: Verify clinic exists
    const clinicExists = await Clinic.findById(clinicId);
    if (!clinicExists) {
      return res.status(404).json({ message: 'Clinic not found' });
    }

    // Count only pending registrations
    const count = await PetProfile.countDocuments({
      registeredClinicId: clinicId,
      registrationStatus: 'Pending',
      isDeleted: { $ne: true }
    });

    res.status(200).json({
      message: 'Pending registrations count retrieved successfully',
      clinicId,
      totalPendingRegistrations: count
    });

  } catch (error) {
    console.error('Error in getPendingRegistrationsCountByClinic:', error);
    res.status(500).json({
      message: 'Error fetching pending registrations count',
      error: error.message
    });
  }
};

exports.approvePetRegistration = async (req, res) => {
  try {
    const { id } = req.params; // petId

    // Find the pet that's pending registration
    const pet = await PetProfile.findOne({
      _id: id,
      registrationStatus: 'Pending'
    });

    if (!pet) {
      console.error('Pet not found or not pending registration');
      return res.status(404).json({
        message: 'Pet not found or not pending registration'
      });
    }

    // Update status
    pet.registrationStatus = 'Approved';
    pet.registrationApprovedAt = new Date();
    pet.registrationApprovedBy = req.user.id;

    await pet.save();

    // Populate for response
    await pet.populate('ownerId', 'firstName lastName email phoneNumber');
    await pet.populate('registeredClinicId', 'name address');

    res.status(200).json({
      success: true,
      message: 'Pet registration approved successfully',
      pet
    });
  } catch (error) {
    console.error('Error approving pet registration:', error);
    res.status(500).json({
      success: false,
      message: 'Error approving registration',
      error: error.message
    });
  }
};

exports.rejectPetRegistration = async (req, res) => {
  try {
    const { id } = req.params; // petId
    const { reason } = req.body || {}; // Optional rejection reason

    // Find the pet
    const pet = await PetProfile.findOne({
      _id: id,
      registrationStatus: 'Pending'
    });

    if (!pet) {
      return res.status(404).json({
        message: 'Pet not found or not pending registration'
      });
    }

    // Update status
    pet.registrationStatus = 'Rejected';
    pet.registrationRejectedAt = new Date();
    pet.registrationRejectedBy = req.user.id;

    if (reason && reason.trim()) {
      pet.rejectionReason = reason.trim();
    }

    await pet.save();

    // Populate for response
    await pet.populate('ownerId', 'firstName lastName email phoneNumber');
    await pet.populate('registeredClinicId', 'name');

    res.status(200).json({
      success: true,
      message: 'Pet registration rejected successfully',
      pet
    });

  } catch (error) {
    console.error('Error rejecting pet registration:', error);
    res.status(500).json({
      success: false,
      message: 'Error rejecting registration',
      error: error.message
    });
  }
};

// Get registered/approved pets for vet's clinic
exports.getRegisteredPetsForVetClinic = async (req, res) => {
  try {
    if (req.user.role !== 'vet') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Veterinarians only.'
      });
    }

    // 1. Determine Access Level
    const isEnhanced = req.user.accessLevel === 'Enhanced';

    let query = {
      registrationStatus: 'Approved',
      isDeleted: { $ne: true }
    };

    // If Basic Access, only show pets for their assigned clinic
    if (!isEnhanced) {
      if (!req.user.clinicId) {
        return res.status(200).json({ success: true, count: 0, registeredPets: [], isGlobalView: false });
      }
      query.registeredClinicId = req.user.clinicId;
    }

    // 2. Fetch approved pets
    const registeredPets = await PetProfile.find(query)
      .populate('ownerId', 'firstName lastName email phoneNumber')
      .populate('registeredClinicId', 'name address phoneNumber')
      .sort({ registrationApprovedAt: -1, name: 1 });

    res.status(200).json({
      success: true,
      count: registeredPets.length,
      registeredPets: registeredPets,
      isGlobalView: isEnhanced
    });

  } catch (error) {
    console.error('Error fetching registered pets:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching registered pets',
      error: error.message
    });
  }
};

// Alternative: Get registered pets by clinic ID (for Enhanced vets)
exports.getRegisteredPetsByClinic = async (req, res) => {
  try {
    const { clinicId } = req.params;

    // Verify clinic exists
    const clinic = await Clinic.findById(clinicId);
    if (!clinic) {
      return res.status(404).json({
        success: false,
        message: 'Clinic not found'
      });
    }

    // Get approved pets
    const registeredPets = await PetProfile.find({
      registeredClinicId: clinicId,
      registrationStatus: 'Approved',
      isDeleted: { $ne: true }
    })
      .populate('ownerId', 'firstName lastName email phoneNumber')
      .populate('registeredClinicId', 'name address phoneNumber')
      .sort({ registrationApprovedAt: -1, name: 1 });

    res.status(200).json({
      success: true,
      count: registeredPets.length,
      registeredPets: registeredPets,
      clinicInfo: {
        id: clinic._id,
        name: clinic.name,
        address: clinic.address
      }
    });

  } catch (error) {
    console.error('Error fetching registered pets by clinic:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching registered pets',
      error: error.message
    });
  }
};