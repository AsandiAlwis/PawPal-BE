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
      isPrimaryVet = false
    } = req.body;

    // Required fields
    if (!firstName || !lastName || !email || !password || !veterinaryId || !phoneNumber) {
      return res.status(400).json({
        message: 'firstName, lastName, email, password, phoneNumber, and veterinaryId are required'
      });
    }

    // Check if email or veterinaryId already exists
    const existingVet = await Veterinarian.findOne({
      $or: [
        { email: email.toLowerCase().trim() },
        { veterinaryId: veterinaryId.trim() }
      ]
    });

    if (existingVet) {
      return res.status(409).json({
        message: 'A veterinarian with this email or license already exists'
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password, salt);

    let accessLevel = 'Basic';
    let ownedClinics = [];
    let currentActiveClinicId = null;

    // Handle Primary Vet logic
    if (isPrimaryVet) {
      accessLevel = 'Enhanced';
      // Primary vets (now Enhanced) start with no clinics - they create them separately
    }

    // Create the vet
    const vet = new Veterinarian({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.toLowerCase().trim(),
      passwordHash,
      phoneNumber: phoneNumber.trim(),
      veterinaryId: veterinaryId.trim(),
      specialization: specialization?.trim() || '',
      accessLevel,
      ownedClinics,
      currentActiveClinicId,
      status: 'Active'
    });

    await vet.save();

    const vetResponse = vet.toObject();
    delete vetResponse.passwordHash;

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
    const existing = await Veterinarian.findOne({
      $or: [
        { email: email.toLowerCase().trim() },
        { veterinaryId: veterinaryId.trim() }
      ]
    });
    if (existing) {
      return res.status(409).json({ message: 'Email or license already in use' });
    }

    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password, salt);

    // For sub-accounts, they only work at one clinic
    const subVet = new Veterinarian({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.toLowerCase().trim(),
      passwordHash,
      phoneNumber: phoneNumber?.trim() || '',
      veterinaryId: veterinaryId.trim(),
      specialization: specialization?.trim() || '',
      currentActiveClinicId: req.body.clinicId,
      accessLevel,
      createdByVetId: creatorVetId,
      status: 'Active'
    });

    await subVet.save();

    const response = subVet.toObject();
    delete response.passwordHash;

    res.status(201).json({
      message: 'Sub-account created successfully',
      vet: response
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

    // Find vets who have this clinic as their current active clinic OR own it
    const vets = await Veterinarian.find({
      $or: [
        { currentActiveClinicId: clinicId },
        { ownedClinics: clinicId }
      ],
      status: 'Active'
    })
      .select('-passwordHash')
      .sort({ accessLevel: -1, firstName: 1 });

    res.status(200).json({
      clinicName: clinic.name,
      primaryVetId: clinic.primaryVetId,
      totalVets: vets.length,
      vets
    });
  } catch (error) {
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
    if (req.user?.staffRole && requesterId === id) {
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

      return res.status(200).json({
        message: 'Staff updated successfully',
        vet: updatedStaff
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
    const isSelf = requesterId === id;
    const isAuthorized = isSelf || requester.accessLevel === 'Enhanced';

    if (!isAuthorized) {
      return res.status(403).json({ message: 'Not authorized to update this profile' });
    }

    // Critical field protection
    const cleanUpdates = { ...updates };
    const restricted = ['ownedClinics', 'createdByVetId', 'googleId', 'passwordHash'];

    // If not Enhanced, cannot change accessLevel or status of others
    if (requester.accessLevel !== 'Enhanced') {
      restricted.push('accessLevel', 'status');
    }

    // Even Enhanced cannot change their own accessLevel or another Enhanced's level
    if (isSelf || vetToUpdate.accessLevel === 'Enhanced') {
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

    // Trim string fields
    if (cleanUpdates.firstName) cleanUpdates.firstName = cleanUpdates.firstName.trim();
    if (cleanUpdates.lastName) cleanUpdates.lastName = cleanUpdates.lastName.trim();
    if (cleanUpdates.email) cleanUpdates.email = cleanUpdates.email.toLowerCase().trim();
    if (cleanUpdates.phoneNumber) cleanUpdates.phoneNumber = cleanUpdates.phoneNumber.trim();
    if (cleanUpdates.veterinaryId) cleanUpdates.veterinaryId = cleanUpdates.veterinaryId.trim();
    if (cleanUpdates.specialization) cleanUpdates.specialization = cleanUpdates.specialization.trim();

    // Update the veterinarian
    const updatedVet = await Veterinarian.findByIdAndUpdate(
      id,
      cleanUpdates,
      { new: true, runValidators: true }
    ).select('-passwordHash');

    res.status(200).json({
      message: 'Veterinarian updated successfully',
      vet: updatedVet
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
          type: 'Veterinarian',
          isPrimary: false
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
    const clinics = await Clinic.find({ _id: { $in: clinicIdsToSearch } })
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

    // Check if requester is a Primary veterinarian
    if (primaryVet.accessLevel !== 'Primary') {
      return res.status(403).json({
        message: 'Only Primary veterinarians can delete accounts'
      });
    }


    // Check if this is a primary vet (shouldn't happen due to earlier check, but just in case)
    if (vetToDelete.accessLevel === 'Enhanced') {
      return res.status(403).json({
        message: 'Cannot delete another Primary veterinarian account'
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

    // 1. Pending pet registration requests
    let pendingPetsQuery = {
      registrationStatus: 'Pending',
      isDeleted: { $ne: true },
      $or: [
        { isReadByVet: false },
        { isReadByVet: { $exists: false } }
      ]
    };
    if (vet.accessLevel !== 'Enhanced') {
      if (clinicId) pendingPetsQuery.registeredClinicId = clinicId;
    } else if (clinicId || ownedClinics.length > 0) {
      const clinicsToSearch = [clinicId, ...ownedClinics].filter(Boolean);
      pendingPetsQuery.registeredClinicId = { $in: clinicsToSearch };
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

    let appointmentsFilter = {};
    if (vet.accessLevel !== 'Enhanced') {
      appointmentsFilter.vetId = vetId;
    } else if (clinicId || ownedClinics.length > 0) {
      const clinicsToSearch = [clinicId, ...ownedClinics].filter(Boolean);
      appointmentsFilter.clinicId = { $in: clinicsToSearch };
    }

    // Combine: Booked (Requests - any future) OR Confirmed (Reminders - today/tomorrow)
    let appointmentsQuery = {
      ...appointmentsFilter,
      $or: [
        { isReadByVet: false },
        { isReadByVet: { $exists: false } }
      ],
      $and: [
        {
          $or: [
            { status: 'Booked', dateTime: { $gte: today } },
            { status: 'Confirmed', dateTime: { $gte: today, $lt: dayAfterTomorrow } }
          ]
        }
      ]
    };

    const upcomingAppointments = await Appointment.find(appointmentsQuery)
      .populate('petId', 'name photo')
      .populate('clinicId', 'name')
      .sort({ dateTime: 1 });

    // 3. Chat notifications (Unread messages from Owners)
    let chatQuery = { senderType: 'Owner', isRead: { $ne: true } };

    // Find pets linked to the vet's clinics
    if (vet.accessLevel !== 'Enhanced') {
      const clinicsToSearch = [clinicId, ...ownedClinics].filter(Boolean);
      const pets = await PetProfile.find({ registeredClinicId: { $in: clinicsToSearch.length > 0 ? clinicsToSearch : [clinicId] } }).select('_id');
      const petIds = pets.map(p => p._id);
      chatQuery.petId = { $in: petIds };
    } else if (clinicId || ownedClinics.length > 0) {
      const clinicsToSearch = [clinicId, ...ownedClinics].filter(Boolean);
      const pets = await PetProfile.find({ registeredClinicId: { $in: clinicsToSearch } }).select('_id');
      const petIds = pets.map(p => p._id);
      chatQuery.petId = { $in: petIds };
    }

    const unreadChats = await ChatMessage.find(chatQuery)
      .populate({
        path: 'petId',
        select: 'name photo ownerId',
        populate: { path: 'ownerId', select: '_id' }
      })
      .sort({ timestamp: -1 });

    // Transform chats to include ownerId at top level for easier frontend navigation
    const transformedChats = unreadChats.map(chat => {
      const chatObj = chat.toObject();
      return {
        ...chatObj,
        // Since we filtered by senderType: 'Owner', senderId is the owner's ID
        ownerId: chatObj.senderId?.toString() || chatObj.petId?.ownerId?._id || chatObj.petId?.ownerId
      };
    });

    console.log(`Notifications found - Registrations: ${pendingRegistrations.length}, Appointments: ${upcomingAppointments.length}, Chats: ${transformedChats.length}`);

    res.status(200).json({
      success: true,
      notifications: {
        pendingRegistrations: pendingRegistrations,
        appointments: upcomingAppointments,
        unreadChats: transformedChats
      }
    });
  } catch (error) {
    console.error('Error in getVetNotifications:', error);
    res.status(500).json({ message: 'Error fetching notifications', error: error.message });
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