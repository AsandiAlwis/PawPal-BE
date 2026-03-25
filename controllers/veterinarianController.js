const Veterinarian = require('../models/Veterinarian');
const ClinicStaff = require('../models/ClinicStaff');
const Clinic = require('../models/Clinic');
const PetProfile = require('../models/PetProfile');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const Appointment = require('../models/Appointment');
const ChatMessage = require('../models/ChatMessage');

// Register a new Veterinarian (can be Primary Vet or standalone)
const registerVet = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      password,
      phoneNumber,
      veterinaryId,
      specialization,
      address,
      isPrimaryVet = false
    } = req.body;

    // Required fields
    if (!firstName || !lastName || !email || !password || !phoneNumber || !address) {
      return res.status(400).json({
        message: 'firstName, lastName, email, password, phoneNumber, and address are required'
      });
    }

    // Check if email or veterinaryId already exists
    const orConditions = [{ email: email.toLowerCase().trim() }];
    if (veterinaryId && veterinaryId.trim() !== '') {
      orConditions.push({ veterinaryId: veterinaryId.trim() });
    }

    const existingVet = await Veterinarian.findOne({
      $or: orConditions
    });

    if (existingVet) {
      const isEmailDup = existingVet.email.toLowerCase() === email.toLowerCase().trim();
      return res.status(409).json({
        message: isEmailDup 
          ? 'A veterinarian with this email already exists' 
          : 'A veterinarian with this license ID already exists'
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password, salt);

    let accessLevel = 'Enhanced'; // Default to Enhanced as requested
    let ownedClinics = [];
    
    // Fetch all existing clinics to assign to the new vet
    const allClinics = await Clinic.find({});
    const assignedClinics = allClinics.map(clinic => clinic._id);
    let currentActiveClinicId = assignedClinics.length > 0 ? assignedClinics[0] : null;

    // Handle Primary Vet logic
    if (isPrimaryVet) {
      accessLevel = 'Enhanced';
      // Primary vets (now Enhanced) start with no clinics - they create them separately
    }

    // Create the vet
    const vetData = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.toLowerCase().trim(),
      passwordHash,
      phoneNumber: phoneNumber.trim(),
      specialization: specialization?.trim() || '',
      address: address?.trim() || '',
      accessLevel,
      ownedClinics,
      currentActiveClinicId,
      assignedClinics,
      clinicId: currentActiveClinicId,
      status: 'Active'
    };

    if (veterinaryId?.trim()) {
      vetData.veterinaryId = veterinaryId.trim();
    }

    const vet = new Veterinarian(vetData);

    await vet.save();

    const vetResponse = {
      id: vet._id,
      firstName: vet.firstName,
      lastName: vet.lastName,
      email: vet.email,
      phoneNumber: vet.phoneNumber,
      accessLevel: vet.accessLevel,
      status: vet.status,
      role: 'vet'
    };

    res.status(201).json({
      message: 'Veterinarian registered successfully',
      vet: vetResponse
    });
  } catch (error) {
    console.error('Error registering vet:', error);
    res.status(400).json({
      message: 'Error registering veterinarian',
      error: error.message
    });
  }
};

// Create sub-account by Primary or Enhanced Vet
const createSubAccount = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      password,
      phoneNumber,
      veterinaryId,
      specialization,
      accessLevel = 'Basic'
    } = req.body;

    const creatorVetId = req.user?.id;

    if (!creatorVetId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const creator = await Veterinarian.findById(creatorVetId);
    if (!creator || creator.accessLevel !== 'Enhanced') {
      return res.status(403).json({
        message: 'Only Enhanced vets can create sub-accounts'
      });
    }

    // Must be linked to the same clinic
    if (!req.body.clinicId) {
      return res.status(400).json({
        message: 'clinicId is required'
      });
    }

    // For Enhanced vets, check if they own the clinic
    if (creator.accessLevel === 'Enhanced') {
      if (!creator.ownedClinics.includes(req.body.clinicId)) {
        return res.status(403).json({
          message: 'You do not own this clinic'
        });
      }
    } else {
      // For Basic vets, check if they're in the same clinic
      if (!creator.currentActiveClinicId || creator.currentActiveClinicId.toString() !== req.body.clinicId) {
        return res.status(403).json({
          message: 'You can only add staff to your current active clinic'
        });
      }
    }

    // Prevent creating another Enhanced Vet via sub-account
    if (accessLevel === 'Enhanced') {
      return res.status(403).json({ message: 'Cannot assign Enhanced access via sub-account' });
    }

    // Duplicate check
    const orConditions = [{ email: email.toLowerCase().trim() }];
    if (veterinaryId && veterinaryId.trim() !== '') {
      orConditions.push({ veterinaryId: veterinaryId.trim() });
    }

    const existing = await Veterinarian.findOne({
      $or: orConditions
    });
    if (existing) {
      return res.status(409).json({ message: 'Email or license already in use' });
    }

    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password, salt);

    const subVetData = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.toLowerCase().trim(),
      passwordHash,
      phoneNumber: phoneNumber?.trim() || '',
      specialization: specialization?.trim() || '',
      address: 'Registered by Clinic', // Skip 'Complete Profile' popup
      currentActiveClinicId: req.body.clinicId,
      accessLevel,
      createdByVetId: creatorVetId,
      status: 'Active'
    };

    if (veterinaryId?.trim()) {
      subVetData.veterinaryId = veterinaryId.trim();
    }

    const subVet = new Veterinarian(subVetData);

    await subVet.save();

    const subVetResponse = {
      id: subVet._id,
      firstName: subVet.firstName,
      lastName: subVet.lastName,
      email: subVet.email,
      phoneNumber: subVet.phoneNumber,
      accessLevel: subVet.accessLevel,
      status: subVet.status,
      role: 'vet'
    };

    res.status(201).json({
      message: 'Sub-account created successfully',
      vet: subVetResponse
    });
  } catch (error) {
    res.status(400).json({
      message: 'Error creating sub-account',
      error: error.message
    });
  }
};

// Get all vets in a clinic (public or internal dashboard)
const getVetsByClinic = async (req, res) => {
  try {
    const { clinicId } = req.params;


    const clinic = await Clinic.findById(clinicId);

    console.log('-------------------------', clinic)
    if (!clinic) {
      return res.status(404).json({ message: 'Clinic not found' });
    }

    console.log('=== getVetsByClinic DEBUG ===');
    console.log('Target Clinic ID:', clinicId);
    
    const mongooseClinicId = new mongoose.Types.ObjectId(clinicId);

    // Find vets who have this clinic as their current active clinic OR own it OR are assigned
    const vets = await Veterinarian.find({
      $or: [
        { currentActiveClinicId: mongooseClinicId },
        { clinicId: mongooseClinicId },
        { ownedClinics: { $in: [mongooseClinicId] } },
        { assignedClinics: { $in: [mongooseClinicId] } }
      ],
      status: 'Active'
    })
      .select('-passwordHash')
      .sort({ accessLevel: -1, firstName: 1 });

    console.log(`Found ${vets.length} vets for clinic ${clinicId}:`, vets.map(v => `${v.firstName} ${v.lastName} (ID: ${v._id})`));
    console.log('=============================');

    res.status(200).json({
      clinicName: clinic.name,
      primaryVetId: clinic.primaryVetId,
      totalVets: vets.length,
      vets
    });
  } catch (error) {
    console.error('Error in getVetsByClinic:', error);
    res.status(500).json({
      message: 'Error fetching veterinarians',
      error: error.message
    });
  }
};

// Get single vet profile
const getVetById = async (req, res) => {
  try {
    const { id } = req.params;

    const vet = await Veterinarian.findById(id)
      .select('-passwordHash')
      .populate('currentActiveClinicId', 'name address phoneNumber')
      .populate('ownedClinics', 'name address phoneNumber');

    if (!vet) {
      return res.status(404).json({ message: 'Veterinarian not found' });
    }

    res.status(200).json(vet);
  } catch (error) {
    res.status(500).json({
      message: 'Error fetching veterinarian',
      error: error.message
    });
  }
};

// Get all active veterinarians (for public booking)
const getAllVets = async (req, res) => {
  try {
    const vets = await Veterinarian.find({ status: 'Active' })
      .select('-passwordHash')
      .sort({ firstName: 1 });

    res.status(200).json({
      success: true,
      count: vets.length,
      vets
    });
  } catch (error) {
    res.status(500).json({
      message: 'Error fetching veterinarians',
      error: error.message
    });
  }
};

const updateVet = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const requesterId = req.user?.id;

    // Handle ClinicStaff trying to update their own profile
    if (req.user?.staffRole && requesterId.toString() === id.toString()) {
      const ClinicStaff = require('../models/ClinicStaff');
      const staffToUpdate = await ClinicStaff.findById(id);
      if (!staffToUpdate) return res.status(404).json({ message: 'Staff member not found' });

      const cleanUpdates = { ...updates };
      delete cleanUpdates.clinicId;
      delete cleanUpdates.assignedClinics;
      delete cleanUpdates.role;
      delete cleanUpdates.accessLevel;
      delete cleanUpdates.status;
      delete cleanUpdates.passwordHash;

      if (cleanUpdates.firstName) cleanUpdates.firstName = cleanUpdates.firstName.trim();
      if (cleanUpdates.lastName) cleanUpdates.lastName = cleanUpdates.lastName.trim();
      if (cleanUpdates.phoneNumber) cleanUpdates.phoneNumber = cleanUpdates.phoneNumber.trim();
      if (cleanUpdates.email) cleanUpdates.email = cleanUpdates.email.toLowerCase().trim();

      const updatedStaff = await ClinicStaff.findByIdAndUpdate(
        id, cleanUpdates, { new: true, runValidators: true }
      ).select('-passwordHash');

      const responseUser = {
        id: updatedStaff._id,
        firstName: updatedStaff.firstName,
        lastName: updatedStaff.lastName,
        email: updatedStaff.email,
        phoneNumber: updatedStaff.phoneNumber || null,
        role: 'vet',
        staffRole: updatedStaff.role || null,
        clinicId: updatedStaff.clinicId || null
      };

      return res.status(200).json({
        message: 'Staff updated successfully',
        vet: responseUser
      });
    }

    const requester = await Veterinarian.findById(requesterId);

    if (!requester) {
      return res.status(401).json({ message: 'Requester not found' });
    }

    const vetToUpdate = await Veterinarian.findById(id);
    if (!vetToUpdate) {
      return res.status(404).json({ message: 'Veterinarian not found' });
    }

    // Authorization:
    // 1. Self-update
    // 2. Enhanced update of sub-accounts
    const isSelf = requesterId.toString() === id.toString();
    const isAuthorized = isSelf || requester.accessLevel === 'Enhanced';

    if (!isAuthorized) {
      return res.status(403).json({ message: 'Not authorized to update this profile' });
    }

    // Critical field protection
    const cleanUpdates = { ...updates };
    const restricted = ['ownedClinics', 'createdByVetId', 'googleId'];

    // Handle password update
    if (cleanUpdates.password) {
      const salt = await bcrypt.genSalt(12);
      cleanUpdates.passwordHash = await bcrypt.hash(cleanUpdates.password, salt);
      delete cleanUpdates.password;
    } else {
      restricted.push('passwordHash');
    }

    // If not Enhanced, cannot change accessLevel or status of others
    if (requester.accessLevel !== 'Enhanced') {
      restricted.push('accessLevel', 'status');
    }

    // Even Enhanced cannot change another Enhanced's level
    if (isSelf) {
      // Allow self-set to Enhanced if desired
      if (cleanUpdates.accessLevel !== 'Enhanced') {
        delete cleanUpdates.accessLevel;
      }
    } else if (vetToUpdate.accessLevel === 'Enhanced') {
      delete cleanUpdates.accessLevel;
    }

    for (let field of restricted) {
      delete cleanUpdates[field];
    }

    // If email is being changed, check if new email already exists
    if (cleanUpdates.email && cleanUpdates.email.toLowerCase().trim() !== vetToUpdate.email.toLowerCase()) {
      const existingVetWithEmail = await Veterinarian.findOne({
        email: cleanUpdates.email.toLowerCase().trim(),
        _id: { $ne: id }
      });

      if (existingVetWithEmail) {
        return res.status(400).json({
          message: 'Email already in use by another veterinarian'
        });
      }
    }

    // Check if new veterinary ID already exists
    if (cleanUpdates.veterinaryId && cleanUpdates.veterinaryId.trim() !== (vetToUpdate.veterinaryId || '')) {
      const existingVetWithId = await Veterinarian.findOne({ 
        veterinaryId: cleanUpdates.veterinaryId.trim(),
        _id: { $ne: id }
      });
      if (existingVetWithId) {
        return res.status(400).json({ 
          message: 'Veterinary license ID is already in use by another veterinarian' 
        });
      }
    }

    // If assignedClinics is provided, update clinicId for backward compatibility
    if (cleanUpdates.assignedClinics && Array.isArray(cleanUpdates.assignedClinics)) {
      if (cleanUpdates.assignedClinics.length > 0) {
        cleanUpdates.clinicId = cleanUpdates.assignedClinics[0];
        cleanUpdates.currentActiveClinicId = cleanUpdates.assignedClinics[0];
      } else {
        cleanUpdates.clinicId = null;
        cleanUpdates.currentActiveClinicId = null;
      }
    }

    // Trim string fields and omit if empty to avoid unique index collisions
    if (cleanUpdates.firstName) cleanUpdates.firstName = cleanUpdates.firstName.trim();
    if (cleanUpdates.lastName) cleanUpdates.lastName = cleanUpdates.lastName.trim();
    if (cleanUpdates.email) cleanUpdates.email = cleanUpdates.email.toLowerCase().trim();
    if (cleanUpdates.phoneNumber) cleanUpdates.phoneNumber = cleanUpdates.phoneNumber.trim();
    
    const updateData = { ...cleanUpdates };
    const unsetData = {};

    if (typeof cleanUpdates.veterinaryId === 'string') {
      const trimmed = cleanUpdates.veterinaryId.trim();
      if (trimmed) {
        updateData.veterinaryId = trimmed;
      } else {
        delete updateData.veterinaryId;
        unsetData.veterinaryId = 1;
      }
    }
    
    if (typeof cleanUpdates.specialization === 'string') {
      const trimmed = cleanUpdates.specialization.trim();
      if (trimmed) {
        updateData.specialization = trimmed;
      } else {
        delete updateData.specialization;
        unsetData.specialization = 1;
      }
    }
    
    if (updateData.address) updateData.address = updateData.address.trim();

    const finalUpdate = { $set: updateData };
    if (Object.keys(unsetData).length > 0) {
      finalUpdate.$unset = unsetData;
    }

    // Update the veterinarian
    const updatedVet = await Veterinarian.findByIdAndUpdate(
      id,
      finalUpdate,
      { new: true, runValidators: true }
    ); // Don't use .select('-passwordHash') here yet as we need it for the flag

    const responseUser = {
      id: updatedVet._id,
      firstName: updatedVet.firstName,
      lastName: updatedVet.lastName,
      email: updatedVet.email,
      phoneNumber: updatedVet.phoneNumber || null,
      address: updatedVet.address || null,
      role: 'vet',
      accessLevel: updatedVet.accessLevel,
      veterinaryId: updatedVet.veterinaryId || null,
      specialization: updatedVet.specialization || null,
      ownedClinics: updatedVet.ownedClinics || [],
      currentActiveClinicId: updatedVet.currentActiveClinicId || null,
      hasPassword: !!updatedVet.passwordHash
    };

    res.status(200).json({
      message: 'Veterinarian updated successfully',
      vet: responseUser
    });

  } catch (error) {
    console.error('Error updating veterinarian:', error);
    res.status(500).json({
      message: 'Error updating veterinarian profile',
      error: error.message
    });
  }
};

// Deactivate vet account (Enhanced Vet only)
const deactivateVet = async (req, res) => {
  try {
    const { id } = req.params;
    const requesterId = req.user?.id;

    const requester = await Veterinarian.findById(requesterId);
    if (!requester || requester.accessLevel !== 'Enhanced') {
      return res.status(403).json({ message: 'Only Enhanced Vet can deactivate accounts' });
    }

    if (requesterId === id) {
      return res.status(400).json({ message: 'Cannot deactivate your own account' });
    }

    const vet = await Veterinarian.findByIdAndUpdate(
      id,
      { status: 'Deactivated' },
      { new: true }
    ).select('firstName lastName status');

    if (!vet) {
      return res.status(404).json({ message: 'Veterinarian not found' });
    }

    res.status(200).json({
      message: 'Veterinarian account deactivated',
      vet
    });
  } catch (error) {
    res.status(500).json({
      message: 'Error deactivating account',
      error: error.message
    });
  }
};

// Get dashboard stats for Enhanced Vet
const getClinicStaffStats = async (req, res) => {
  try {
    const { clinicId } = req.params;
    const userId = req.user?.id;

    const user = await Veterinarian.findById(userId);
    if (!user) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Check if user has access to this clinic
    let hasAccess = false;
    if (user.accessLevel === 'Enhanced') {
      hasAccess = user.ownedClinics.includes(clinicId);
    } else {
      hasAccess = user.currentActiveClinicId?.toString() === clinicId;
    }

    if (!hasAccess || user.accessLevel !== 'Enhanced') {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Get stats for this clinic
    const stats = await Veterinarian.aggregate([
      {
        $match: {
          $or: [
            { currentActiveClinicId: new mongoose.Types.ObjectId(clinicId) },
            { ownedClinics: new mongoose.Types.ObjectId(clinicId) }
          ],
          status: 'Active'
        }
      },
      {
        $group: {
          _id: '$accessLevel',
          count: { $sum: 1 }
        }
      }
    ]);

    const total = await Veterinarian.countDocuments({
      $or: [
        { currentActiveClinicId: clinicId },
        { ownedClinics: clinicId }
      ],
      status: 'Active'
    });

    res.status(200).json({
      totalActiveVets: total,
      breakdown: Object.fromEntries(stats.map(s => [s._id, s.count]))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get clinics for the logged-in veterinarian
const getMyClinics = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    if (req.user.role !== 'vet') {
      return res.status(403).json({ message: 'Access denied: Only veterinarians can access clinic information' });
    }

    const vetId = req.user.id;

    // Populate both fields
    const vet = await Veterinarian.findById(vetId)
      .populate('ownedClinics')
      .populate('currentActiveClinicId')   // ← important: populate this too!
      .select('firstName lastName accessLevel ownedClinics currentActiveClinicId veterinaryId');

    if (!vet) {
      return res.status(404).json({ message: 'Veterinarian not found' });
    }

    // Build clinics list
    let clinics = [];

    if (vet.accessLevel === 'Enhanced') {
      // Enhanced vets get access to ALL clinics in the system as requested
      clinics = await Clinic.find({});
    } else if (vet.ownedClinics?.length > 0) {
      clinics = [...vet.ownedClinics];
    }

    // Always try to add current active clinic (if set)
    if (vet.currentActiveClinicId) {
      const activeId = vet.currentActiveClinicId._id.toString();

      // Avoid duplicate if it's already in the owned list
      const isDuplicate = clinics.some(clinic => clinic._id.toString() === activeId);

      if (!isDuplicate) {
        clinics.push(vet.currentActiveClinicId);
      }
    }

    // Optional: sort by name or some priority if you want
    // clinics.sort((a, b) => a.name.localeCompare(b.name));

    // Calculate pet counts for each clinic
    const clinicsWithPetsCount = await Promise.all(
      clinics.map(async (clinic) => {
        const petsCount = await PetProfile.countDocuments({
          registeredClinicId: clinic._id,
          registrationStatus: 'Approved',
          isDeleted: { $ne: true }
        });
        return {
          ...clinic.toObject ? clinic.toObject() : clinic,
          petsCount
        };
      })
    );

    res.status(200).json({
      message: 'Clinics retrieved successfully',
      total: clinicsWithPetsCount.length,
      clinics: clinicsWithPetsCount,
      currentActiveClinic: vet.currentActiveClinicId || null,
      currentActiveClinicId: vet.currentActiveClinicId?._id || null,
      vetInfo: {
        vetId: vet._id,
        firstName: vet.firstName,
        lastName: vet.lastName,
        accessLevel: vet.accessLevel,
        veterinaryId: vet.veterinaryId,
        canCreateClinics: vet.accessLevel === 'Enhanced',
        hasActiveClinic: !!vet.currentActiveClinicId,
      }
    });
  } catch (error) {
    console.error('Error fetching clinics for vet:', error);
    res.status(500).json({
      message: 'Error fetching clinics',
      error: error.message
    });
  }
};

// Create a new clinic (Enhanced vet can create multiple clinics)
const createClinic = async (req, res) => {
  try {
    const {
      name,
      address,
      phoneNumber,
      operatingHours,
      location,
      description
    } = req.body;

    // Only Enhanced vets can create clinics
    if (!req.user || req.user.role !== 'vet') {
      return res.status(403).json({
        message: 'Access denied: Only veterinarians can create clinics'
      });
    }

    const vet = await Veterinarian.findById(req.user.id);
    if (!vet || vet.accessLevel !== 'Enhanced') {
      return res.status(403).json({
        message: 'Access denied: Only Enhanced veterinarians can create clinics'
      });
    }

    // Basic validation
    if (!name || !address || !phoneNumber) {
      return res.status(400).json({
        message: 'Name, address, and phone number are required'
      });
    }

    // Create the clinic
    const clinic = new Clinic({
      name: name.trim(),
      address: address.trim(),
      phoneNumber: phoneNumber.trim(),
      operatingHours: operatingHours?.trim() || '',
      description: description?.trim() || '',
      location: location || { type: 'Point', coordinates: [0, 0] },
      primaryVetId: vet._id
    });

    await clinic.save();

    // Add this clinic to the vet's ownedClinics array
    vet.ownedClinics.push(clinic._id);

    // If this is the vet's first clinic, set it as current active clinic
    if (vet.ownedClinics.length === 1) {
      vet.currentActiveClinicId = clinic._id;
    }

    await vet.save();

    res.status(201).json({
      message: 'Clinic created successfully',
      clinic,
      vetClinicsCount: vet.ownedClinics.length
    });
  } catch (error) {
    console.error('Error creating clinic:', error);
    res.status(400).json({
      message: 'Error creating clinic',
      error: error.message
    });
  }
};

// Switch active clinic for Enhanced vet
const switchActiveClinic = async (req, res) => {
  try {
    const { clinicId } = req.body;

    if (!req.user || req.user.role !== 'vet') {
      return res.status(403).json({
        message: 'Access denied: Veterinarian authentication required'
      });
    }

    const vet = await Veterinarian.findById(req.user.id);
    if (!vet) {
      return res.status(404).json({ message: 'Veterinarian not found' });
    }

    // Only Enhanced vets can switch clinics
    if (vet.accessLevel !== 'Enhanced') {
      return res.status(403).json({
        message: 'Access denied: Only Enhanced veterinarians can switch clinics'
      });
    }

    // If Enhanced, they can switch to ANY clinic. If not, only owned ones.
    const hasAccess = vet.accessLevel === 'Enhanced' ||
      vet.ownedClinics.includes(clinicId);

    if (!hasAccess) {
      return res.status(403).json({
        message: 'No access to this clinic'
      });
    }

    // Update active clinic
    vet.currentActiveClinicId = clinicId;
    await vet.save();

    res.status(200).json({
      message: 'Active clinic switched successfully',
      currentActiveClinicId: clinicId,
      totalClinicsOwned: vet.ownedClinics.length
    });
  } catch (error) {
    console.error('Error switching active clinic:', error);
    res.status(500).json({
      message: 'Error switching active clinic',
      error: error.message
    });
  }
};

const getStaffByEnhancedVet = async (req, res) => {
  try {
    const primaryVetId = req.user?.id;
    if (!primaryVetId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const primaryVet = await Veterinarian.findById(primaryVetId)
      .populate('currentActiveClinicId', 'name address phoneNumber');

    if (!primaryVet || primaryVet.accessLevel !== 'Enhanced') {
      return res.status(403).json({
        message: 'Only Enhanced veterinarians can access all staff'
      });
    }

    // Get owned clinics + current active clinic
    const ownedClinicIds = primaryVet.ownedClinics || [];
    let clinicIdsToSearch = [...ownedClinicIds];

    if (primaryVet.currentActiveClinicId) {
      const activeIdStr = primaryVet.currentActiveClinicId._id.toString();
      if (!clinicIdsToSearch.some(id => id.toString() === activeIdStr)) {
        clinicIdsToSearch.push(primaryVet.currentActiveClinicId._id);
      }
    }

    console.log(`Searching staff/vets in clinics: ${clinicIdsToSearch.length === 0 ? 'ALL' : clinicIdsToSearch.join(', ')}`);

    const ClinicStaff = require('../models/ClinicStaff');

    // ── Fetch Veterinarians ───────────────────────────────────────────────
    let vetQuery = {};
    if (primaryVet.accessLevel === 'Enhanced') {
      // Enhanced gets ALL active vets in the system
      vetQuery = { status: 'Active' };
    } else {
      vetQuery = {
        $or: [
          { _id: primaryVetId },
          { currentActiveClinicId: { $in: clinicIdsToSearch }, status: 'Active' }
        ]
      };
    }

    const vets = await Veterinarian.find(vetQuery)
      .select('-passwordHash')
      .populate('currentActiveClinicId', 'name address phoneNumber');

    console.log(`Found ${vets.length} veterinarians`);

    // ── Fetch Clinic Staff ────────────────────────────────────────────────
    let staffQuery = {};
    if (primaryVet.accessLevel === 'Enhanced') {
      // Enhanced gets ALL active staff in the system
      staffQuery = { status: 'Active' };
    } else {
      staffQuery = {
        clinicId: { $in: clinicIdsToSearch },
        status: 'Active'
      };
    }

    const staff = await ClinicStaff.find(staffQuery)
      .select('-passwordHash')
      .populate('clinicId', 'name address phoneNumber');

    console.log(`Found ${staff.length} clinic staff members`);

    // ── Format Enhanced vet ────────────────────────────────────────────────
    const formattedEnhanced = {
      ...formatVetAsStaff(primaryVet, true),
      clinic: primaryVet.currentActiveClinicId || null,
      type: 'Veterinarian',
      isEnhanced: true
    };

    // ── Format other veterinarians ────────────────────────────────────────
    const formattedVets = vets
      .filter(vet => vet._id.toString() !== primaryVetId.toString()) // exclude primary from this list
      .map(vet => {
        console.log(
          `Formatting vet: ${vet.firstName || '?'} ${vet.lastName || '?'} | ` +
          `ID: ${vet._id} | ` +
          `Clinic: ${vet.currentActiveClinicId?.name || '(not populated)'}`
        );

        return {
          _id: vet._id,
          firstName: vet.firstName || 'Unknown',
          lastName: vet.lastName || 'Unknown',
          email: vet.email || null,
          phoneNumber: vet.phoneNumber || null,
          veterinaryId: vet.veterinaryId || null,
          specialization: vet.specialization || null,
          accessLevel: vet.accessLevel,
          status: vet.status,
          currentActiveClinicId: vet.currentActiveClinicId?._id?.toString() || null,
          clinic: vet.currentActiveClinicId || null,
          assignedClinics: (vet.assignedClinics || []).map(id => id.toString()),
          type: 'Veterinarian',
          isPrimary: false,
          details: {
            role: 'Veterinarian',
            specialization: vet.specialization || null,
            licenseId: vet.veterinaryId || null,
            isPrimary: false,
            accessLevel: vet.accessLevel
          }
        };
      });

    // ── Format clinic staff ───────────────────────────────────────────────
    const formattedStaff = staff.map(s => ({
      _id: s._id,
      firstName: s.firstName || 'Unknown',
      lastName: s.lastName || 'Unknown',
      email: s.email || null,
      phoneNumber: s.phoneNumber || null,
      veterinaryId: null,
      specialization: null,
      accessLevel: s.accessLevel,
      status: s.status,
      currentActiveClinicId: s.clinicId?._id?.toString() || null,
      assignedClinics: s.assignedClinics || [],
      clinic: s.clinicId || null,
      type: 'Staff',
      details: {
        role: s.role,
        specialization: null,
        licenseId: null,
        isPrimary: false,
        accessLevel: s.accessLevel
      }
    }));

    // ── Combine everything ────────────────────────────────────────────────
    const allStaff = [formattedEnhanced, ...formattedVets, ...formattedStaff];

    // ── Fetch clinic details for context ──────────────────────────────────
    let clinicQuery = { _id: { $in: clinicIdsToSearch } };
    if (primaryVet.accessLevel === 'Enhanced') {
      // Enhanced vets should see ALL clinics in the system for assignment
      clinicQuery = {};
    }
    
    const clinics = await Clinic.find(clinicQuery)
      .select('name address phoneNumber');

    // ── Final response ────────────────────────────────────────────────────
    res.status(200).json({
      message: 'Staff retrieved successfully',
      totalStaff: allStaff.length,
      totalClinics: clinics.length,
      clinics,
      staff: allStaff
    });

  } catch (error) {
    console.error('Error fetching staff by primary vet:', error);
    res.status(500).json({
      message: 'Error fetching clinic staff',
      error: error.message
    });
  }
};

// Helper function to format veterinarian as staff
const formatVetAsStaff = (vet, isEnhanced) => {
  return {
    _id: vet._id,
    firstName: vet.firstName,
    lastName: vet.lastName,
    email: vet.email,
    phoneNumber: vet.phoneNumber,
    veterinaryId: vet.veterinaryId,
    specialization: vet.specialization,
    accessLevel: vet.accessLevel,
    status: vet.status,
    currentActiveClinicId: vet.currentActiveClinicId?._id,
    type: 'Veterinarian',
    details: {
      role: vet.specialization || (isEnhanced ? 'Enhanced Veterinarian' : 'Veterinarian'),
      specialization: vet.specialization,
      licenseId: vet.veterinaryId,
      isEnhanced: isEnhanced,
      accessLevel: vet.accessLevel
    }
  };
};

// Delete veterinarian account (Primary Vet only)
const deleteVet = async (req, res) => {
  try {
    const { id } = req.params;
    const primaryVetId = req.user?.id;

    console.log('=== DELETE VETERINARIAN DEBUG ===');
    console.log('Vet ID to delete:', id);
    console.log('Primary vet ID:', primaryVetId);

    // Check authentication
    if (!primaryVetId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    // Find the primary vet
    const requester = await Veterinarian.findById(primaryVetId);
    if (!requester || requester.accessLevel !== 'Enhanced') {
      return res.status(403).json({
        message: 'You can only delete veterinarians if you have Enhanced access level'
      });
    }

    // Prevent self-deletion
    if (id === primaryVetId) {
      return res.status(400).json({
        message: 'You cannot delete your own account'
      });
    }

    // Find the veterinarian to delete
    const vetToDelete = await Veterinarian.findById(id);
    if (!vetToDelete) {
      return res.status(404).json({ message: 'Veterinarian not found' });
    }

    console.log('Vet to delete:', `${vetToDelete.firstName} ${vetToDelete.lastName}`);
    console.log('Access level:', vetToDelete.accessLevel);
    console.log('Current clinic ID:', vetToDelete.currentActiveClinicId);

    // Check if this is a primary vet (shouldn't happen due to earlier check, but just in case)
    if (vetToDelete.accessLevel === 'Enhanced') {
      return res.status(403).json({
        message: 'Cannot delete another Enhanced veterinarian account'
      });
    }

    // Soft delete (recommended) - change status to 'Deleted'
    vetToDelete.status = 'Deleted';
    await vetToDelete.save();

    console.log('Veterinarian soft-deleted successfully');

    // Or for hard delete (use with caution):
    // await Veterinarian.findByIdAndDelete(id);
    // console.log('Veterinarian hard-deleted successfully');

    res.status(200).json({
      message: 'Veterinarian deleted successfully',
      vet: {
        id: vetToDelete._id,
        firstName: vetToDelete.firstName,
        lastName: vetToDelete.lastName,
        email: vetToDelete.email,
        status: vetToDelete.status
      }
    });

  } catch (error) {
    console.error('Error deleting veterinarian:', error);
    res.status(500).json({
      message: 'Error deleting veterinarian account',
      error: error.message
    });
  }
};

// Delete clinic staff (Enhanced Vet only)
const deleteClinicStaff = async (req, res) => {
  try {
    const { id } = req.params;
    const primaryVetId = req.user?.id;

    console.log('=== DELETE CLINIC STAFF DEBUG ===');
    console.log('Clinic staff ID to delete:', id);
    console.log('Primary vet ID:', primaryVetId);

    // Check authentication
    if (!primaryVetId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    // Find the Enhanced vet
    const primaryVet = await Veterinarian.findById(primaryVetId);
    if (!primaryVet || primaryVet.accessLevel !== 'Enhanced') {
      return res.status(403).json({
        message: 'Only Enhanced veterinarians can delete clinic staff'
      });
    }

    // Import ClinicStaff model
    const ClinicStaff = require('../models/ClinicStaff');

    // Find the clinic staff member
    const clinicStaff = await ClinicStaff.findById(id);
    if (!clinicStaff) {
      return res.status(404).json({ message: 'Staff member not found' });
    }

    console.log('Clinic staff found:', `${clinicStaff.firstName} ${clinicStaff.lastName}`);
    console.log('Clinic ID:', clinicStaff.clinicId);
    console.log('Created by:', clinicStaff.createdBy);

    // Enhanced vets can delete any clinic staff
    if (primaryVet.accessLevel !== 'Enhanced') {
      return res.status(403).json({
        message: 'Only Enhanced veterinarians can delete clinic staff'
      });
    }


    // Soft delete (recommended)
    clinicStaff.status = 'Deleted';
    await clinicStaff.save();

    console.log('Clinic staff soft-deleted successfully');

    // Or for hard delete:
    // await ClinicStaff.findByIdAndDelete(id);
    // console.log('Clinic staff hard-deleted successfully');

    res.status(200).json({
      message: 'Staff member deleted successfully',
      staff: {
        id: clinicStaff._id,
        firstName: clinicStaff.firstName,
        lastName: clinicStaff.lastName,
        email: clinicStaff.email,
        status: clinicStaff.status
      }
    });

  } catch (error) {
    console.error('Error deleting clinic staff:', error);
    res.status(500).json({
      message: 'Error deleting staff member',
      error: error.message
    });
  }
};

// Activate veterinarian account (Enhanced Vet only)
const activateVet = async (req, res) => {
  try {
    const { id } = req.params;
    const primaryVetId = req.user?.id;

    console.log('=== ACTIVATE VETERINARIAN DEBUG ===');
    console.log('Vet ID to activate:', id);
    console.log('Primary vet ID:', primaryVetId);

    // Check authentication
    if (!primaryVetId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    // Find the Enhanced vet
    const primaryVet = await Veterinarian.findById(primaryVetId);
    if (!primaryVet || primaryVet.accessLevel !== 'Enhanced') {
      return res.status(403).json({
        message: 'Only Enhanced veterinarians can activate accounts'
      });
    }

    // Find the veterinarian to activate
    const vetToActivate = await Veterinarian.findById(id);
    if (!vetToActivate) {
      return res.status(404).json({ message: 'Veterinarian not found' });
    }

    console.log('Vet to activate:', `${vetToActivate.firstName} ${vetToActivate.lastName}`);
    console.log('Current status:', vetToActivate.status);

    // Check if vet is already active
    if (vetToActivate.status === 'Active') {
      return res.status(400).json({
        message: 'Veterinarian is already active'
      });
    }

    // Enhanced vets can activate any account
    if (primaryVet.accessLevel !== 'Enhanced') {
      return res.status(403).json({
        message: 'Only Enhanced veterinarians can activate accounts'
      });
    }


    // Update status to Active
    vetToActivate.status = 'Active';
    await vetToActivate.save();

    console.log('Veterinarian activated successfully');

    res.status(200).json({
      message: 'Veterinarian activated successfully',
      vet: {
        id: vetToActivate._id,
        firstName: vetToActivate.firstName,
        lastName: vetToActivate.lastName,
        email: vetToActivate.email,
        status: vetToActivate.status
      }
    });

  } catch (error) {
    console.error('Error activating veterinarian:', error);
    res.status(500).json({
      message: 'Error activating veterinarian account',
      error: error.message
    });
  }
};

const getVetNotifications = async (req, res) => {
  try {
    const vetId = req.user.id;
    console.log(`Fetching notifications for Vet: ${vetId}`);

    let vet = await Veterinarian.findById(vetId);
    let isStaff = false;

    if (!vet) {
      vet = await ClinicStaff.findById(vetId);
      if (vet) {
        isStaff = true;
      }
    }

    if (!vet) {
      console.log('Vet/Staff not found in database');
      return res.status(404).json({ message: 'User not found' });
    }

    const clinicId = isStaff ? vet.clinicId : vet.currentActiveClinicId;
    const ownedClinics = isStaff ? [] : (vet.ownedClinics || []);

    // Build list of clinic IDs this user has access to
    const clinicsToSearch = [clinicId, ...ownedClinics].filter(Boolean);
    const hasMultipleClinics = clinicsToSearch.length > 0;

    // 1. Pending pet registration requests
    let pendingPetsQuery = {
      registrationStatus: 'Pending',
      isDeleted: { $ne: true },
      $or: [
        { isReadByVet: false },
        { isReadByVet: { $exists: false } }
      ]
    };

    if (isStaff || vet.accessLevel === 'Enhanced') {
      if (hasMultipleClinics) {
        pendingPetsQuery.registeredClinicId = { $in: clinicsToSearch };
      } else if (clinicId) {
        pendingPetsQuery.registeredClinicId = clinicId;
      }
    } else {
        // Basic vets see registrations for their clinic
        if (clinicId) pendingPetsQuery.registeredClinicId = clinicId;
    }

    const pendingRegistrations = await PetProfile.find(pendingPetsQuery)
      .populate('ownerId', 'firstName lastName photo')
      .populate('registeredClinicId', 'name')
      .sort({ createdAt: -1 })
      .limit(10);

    // 2. Appointment reminders & requests
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayAfterTomorrow = new Date(today);
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);

    // BUILD FILTER: Appointments where I am the vet OR they belong to a clinic I manage
    let accessFilter = [];
    
    // Always show appointments explicitly assigned to this vet
    if (!isStaff) accessFilter.push({ vetId: vetId });

    // Show appointments in clinics managed/active
    if (hasMultipleClinics) {
      accessFilter.push({ clinicId: { $in: clinicsToSearch } });
    } else if (clinicId) {
      accessFilter.push({ clinicId: clinicId });
    }

    let appointmentsQuery = {
      $and: [
        { $or: accessFilter },
        {
          $or: [
            // New requests: Always show until acted upon (never dismissable)
            { status: 'Booked', dateTime: { $gte: today } },
            // Reminders: Show if Confirmed AND today/tomorrow AND unread
            { 
              status: 'Confirmed', 
              dateTime: { $gte: today, $lt: dayAfterTomorrow },
              $or: [
                { isReadByVet: false },
                { isReadByVet: { $exists: false } }
              ]
            },
            // CANCELLATIONS: Show if unread by vet
            {
              status: 'Canceled',
              $or: [
                { isReadByVet: false },
                { isReadByVet: { $exists: false } }
              ]
            }
          ]
        }
      ]
    };

    const upcomingAppointments = await Appointment.find(appointmentsQuery)
      .populate('petId', 'name photo')
      .populate('clinicId', 'name')
      .sort({ dateTime: 1 })
      .limit(20);

    // 3. Chat notifications (Unread messages from Owners)
    let chatQuery = { senderType: 'Owner', isRead: { $ne: true } };

    // Find pet ids for filtering chats - use all clinics the user has access to
    if (hasMultipleClinics || clinicId) {
        const pets = await PetProfile.find({ 
            registeredClinicId: { $in: hasMultipleClinics ? clinicsToSearch : [clinicId] } 
        }).select('_id');
        const petIdsToFilter = pets.map(p => p._id);
        chatQuery.petId = { $in: petIdsToFilter };
    }

    const unreadChats = await ChatMessage.find(chatQuery)
      .populate({
        path: 'petId',
        select: 'name photo ownerId',
        populate: { path: 'ownerId', select: '_id' }
      })
      .sort({ timestamp: -1 })
      .limit(20);

    // Transform chats...
    const transformedChats = unreadChats.map(chat => {
      const chatObj = chat.toObject ? chat.toObject() : chat;
      return {
        ...chatObj,
        ownerId: chatObj.senderId?.toString() || chatObj.petId?.ownerId?._id || chatObj.petId?.ownerId
      };
    });

    console.log(`📡 VetNotifications for ${vet.firstName}: Regs:${pendingRegistrations.length}, Appts:${upcomingAppointments.length}, Chats:${transformedChats.length}`);

    res.status(200).json({
      success: true,
      notifications: {
        pendingRegistrations,
        appointments: upcomingAppointments,
        unreadChats: transformedChats
      }
    });
  } catch (error) {
    console.error('❌ Error in getVetNotifications:', error);
    res.status(500).json({ success: false, message: 'Error fetching notifications', error: error.message });
  }
};

/**
 * Mark a notification as read (dismiss from bell icon)
 * @route PATCH /api/vets/notifications/:type/:id/read
 */
const markNotificationAsRead = async (req, res) => {
  try {
    const { type, id } = req.params;
    console.log(`Marking notification as read: type=${type}, id=${id}`);

    let result = null;
    if (type === 'registration') {
      result = await PetProfile.updateOne({ _id: id }, { isReadByVet: true });
    } else if (type === 'appointment') {
      result = await Appointment.updateOne({ _id: id }, { isReadByVet: true });
    } else {
      return res.status(400).json({ success: false, message: 'Invalid notification type' });
    }

    console.log(`Update result for ${type} ${id}:`, result);
    res.status(200).json({
      success: true,
      message: 'Notification marked as read',
      found: result.matchedCount > 0,
      modified: result.modifiedCount > 0
    });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Export all functions
module.exports = {
  registerVet,
  createSubAccount,
  getVetsByClinic,
  getVetById,
  updateVet,
  deactivateVet,
  activateVet,
  getClinicStaffStats,
  getMyClinics,
  createClinic,
  switchActiveClinic,
  getStaffByEnhancedVet,
  deleteVet,
  deleteClinicStaff,
  getVetNotifications,
  getAllVets,
  markNotificationAsRead
};