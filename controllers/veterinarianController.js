const Veterinarian = require('../models/Veterinarian');
const Clinic = require('../models/Clinic');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

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

    let accessLevel = 'Normal Access';
    let ownedClinics = [];
    let currentActiveClinicId = null;

    // Handle Primary Vet logic
    if (isPrimaryVet) {
      accessLevel = 'Primary';
      // Primary vets start with no clinics - they create them separately
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

// Create sub-account by Primary or Full Access Vet
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
      accessLevel = 'Normal Access'
    } = req.body;

    const creatorVetId = req.user?.id;

    if (!creatorVetId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const creator = await Veterinarian.findById(creatorVetId);
    if (!creator || !['Primary', 'Full Access'].includes(creator.accessLevel)) {
      return res.status(403).json({
        message: 'Only Primary or Full Access vets can create sub-accounts'
      });
    }

    // Must be linked to the same clinic
    if (!req.body.clinicId) {
      return res.status(400).json({
        message: 'clinicId is required'
      });
    }

    // For primary vets, check if they own the clinic
    if (creator.accessLevel === 'Primary') {
      if (!creator.ownedClinics.includes(req.body.clinicId)) {
        return res.status(403).json({
          message: 'You do not own this clinic'
        });
      }
    } else {
      // For Full Access vets, check if they're in the same clinic
      if (!creator.currentActiveClinicId || creator.currentActiveClinicId.toString() !== req.body.clinicId) {
        return res.status(403).json({
          message: 'You can only add staff to your current active clinic'
        });
      }
    }

    // Prevent creating another Primary Vet via sub-account
    if (accessLevel === 'Primary') {
      return res.status(403).json({ message: 'Cannot assign Primary access via sub-account' });
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

    console.log('-------------------------',clinic)
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

// Update vet profile (self or by Primary/Full Access)
// Update vet profile (self or by Primary/Full Access)
const updateVet = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Prevent changing critical fields - Remove 'email' from restricted
    const restricted = ['accessLevel', 'ownedClinics', 'createdByVetId', 'status'];
    for (let field of restricted) {
      if (updates[field]) {
        return res.status(403).json({ message: `${field} cannot be modified` });
      }
    }

    // If email is being changed, check if new email already exists
    if (updates.email) {
      const existingVetWithEmail = await Veterinarian.findOne({ 
        email: updates.email.toLowerCase().trim(),
        _id: { $ne: id } // Exclude current vet
      });
      
      if (existingVetWithEmail) {
        return res.status(400).json({ 
          message: 'Email already in use by another veterinarian' 
        });
      }
    }

    // If updating currentActiveClinicId, verify permissions
    if (updates.currentActiveClinicId) {
      const vet = await Veterinarian.findById(id);
      if (!vet) {
        return res.status(404).json({ message: 'Veterinarian not found' });
      }
      
      // Check if vet has access to the new clinic
      if (vet.accessLevel === 'Primary') {
        // Primary vets can only switch to clinics they own
        if (!vet.ownedClinics.includes(updates.currentActiveClinicId)) {
          return res.status(403).json({ 
            message: 'You can only switch to clinics you own' 
          });
        }
      } else {
        // Non-primary vets can only be assigned by Primary/Full Access vets
        if (req.user?.id === id) {
          return res.status(403).json({ 
            message: 'You cannot change your own clinic assignment' 
          });
        }
      }
    }

    // If updating own profile
    if (req.user?.id === id) {
      // Allow personal info update including email
    } else {
      // Only Primary/Full Access can update others
      const requester = await Veterinarian.findById(req.user?.id);
      if (!requester || !['Primary', 'Full Access'].includes(requester.accessLevel)) {
        return res.status(403).json({ message: 'Insufficient permissions' });
      }
    }

    // Clean up updates
    const cleanUpdates = { ...updates };
    
    // Trim string fields
    if (cleanUpdates.firstName) cleanUpdates.firstName = cleanUpdates.firstName.trim();
    if (cleanUpdates.lastName) cleanUpdates.lastName = cleanUpdates.lastName.trim();
    if (cleanUpdates.email) cleanUpdates.email = cleanUpdates.email.toLowerCase().trim();
    if (cleanUpdates.phoneNumber) cleanUpdates.phoneNumber = cleanUpdates.phoneNumber.trim();
    if (cleanUpdates.veterinaryId) cleanUpdates.veterinaryId = cleanUpdates.veterinaryId.trim();
    if (cleanUpdates.specialization) cleanUpdates.specialization = cleanUpdates.specialization.trim();

    const vet = await Veterinarian.findByIdAndUpdate(
      id,
      cleanUpdates,
      { new: true, runValidators: true }
    ).select('-passwordHash');

    if (!vet) {
      return res.status(404).json({ message: 'Veterinarian not found' });
    }

    res.status(200).json({
      message: 'Profile updated successfully',
      vet
    });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(400).json({
      message: 'Error updating profile',
      error: error.message
    });
  }
};

// Deactivate vet account (Primary Vet only)
const deactivateVet = async (req, res) => {
  try {
    const { id } = req.params;
    const requesterId = req.user?.id;

    const requester = await Veterinarian.findById(requesterId);
    if (!requester || requester.accessLevel !== 'Primary') {
      return res.status(403).json({ message: 'Only Primary Vet can deactivate accounts' });
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

// Get dashboard stats for Primary Vet
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
    if (user.accessLevel === 'Primary') {
      hasAccess = user.ownedClinics.includes(clinicId);
    } else {
      hasAccess = user.currentActiveClinicId?.toString() === clinicId;
    }

    if (!hasAccess || !['Primary', 'Full Access'].includes(user.accessLevel)) {
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

    // Build clinics list – start with owned (if Primary)
    let clinics = [];

    if (vet.accessLevel === 'Primary' && vet.ownedClinics?.length > 0) {
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

    res.status(200).json({
      message: 'Clinics retrieved successfully',
      total: clinics.length,
      clinics,
      currentActiveClinic: vet.currentActiveClinicId || null,
      currentActiveClinicId: vet.currentActiveClinicId?._id || null,
      vetInfo: {
        vetId: vet._id,
        firstName: vet.firstName,
        lastName: vet.lastName,
        accessLevel: vet.accessLevel,
        veterinaryId: vet.veterinaryId,
        canCreateClinics: vet.accessLevel === 'Primary',
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

// Create a new clinic (Primary vet can create multiple clinics)
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

    // Only Primary vets can create clinics
    if (!req.user || req.user.role !== 'vet') {
      return res.status(403).json({
        message: 'Access denied: Only veterinarians can create clinics'
      });
    }

    const vet = await Veterinarian.findById(req.user.id);
    if (!vet || vet.accessLevel !== 'Primary') {
      return res.status(403).json({
        message: 'Access denied: Only Primary veterinarians can create clinics'
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

// Switch active clinic for primary vet
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

    // Only Primary vets can switch clinics
    if (vet.accessLevel !== 'Primary') {
      return res.status(403).json({
        message: 'Access denied: Only Primary veterinarians can switch clinics'
      });
    }

    // Check if the clinic belongs to this vet
    if (!vet.ownedClinics.includes(clinicId)) {
      return res.status(403).json({
        message: 'Access denied: You do not own this clinic'
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

const getStaffByPrimaryVet = async (req, res) => {
  try {
    const primaryVetId = req.user?.id;
    if (!primaryVetId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const primaryVet = await Veterinarian.findById(primaryVetId)
      .populate('currentActiveClinicId', 'name address phoneNumber');

    if (!primaryVet || primaryVet.accessLevel !== 'Primary') {
      return res.status(403).json({ 
        message: 'Only Primary veterinarians can access all staff' 
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

    console.log('Owned clinic IDs:', ownedClinicIds.map(id => id.toString()));
    console.log('Searching staff/vets in clinics:', clinicIdsToSearch.map(id => id.toString()));

    if (clinicIdsToSearch.length === 0) {
      return res.status(200).json({
        message: 'No clinics found. Only primary vet is available.',
        totalStaff: 1,
        staff: [formatVetAsStaff(primaryVet, true)],
        clinics: []
      });
    }

    const ClinicStaff = require('../models/ClinicStaff');

    // ── Fetch Veterinarians ───────────────────────────────────────────────
    const vets = await Veterinarian.find({
      $or: [
        { _id: primaryVetId }, // Always include primary vet
        { 
          currentActiveClinicId: { $in: clinicIdsToSearch },
          status: 'Active',
          _id: { $ne: primaryVetId }
        }
      ]
    })
      .select('-passwordHash')
      .populate('currentActiveClinicId', 'name address phoneNumber');

    console.log(`Found ${vets.length} veterinarians (including primary)`);

    // ── Fetch Clinic Staff ────────────────────────────────────────────────
    const staff = await ClinicStaff.find({
      clinicId: { $in: clinicIdsToSearch },
      status: 'Active'
    })
      .select('-passwordHash')
      .populate('clinicId', 'name address phoneNumber');

    console.log(`Found ${staff.length} clinic staff members`);

    // ── Format primary vet ────────────────────────────────────────────────
    const formattedPrimary = {
      ...formatVetAsStaff(primaryVet, true),
      clinic: primaryVet.currentActiveClinicId || null,
      type: 'Veterinarian',
      isPrimary: true
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
    const allStaff = [formattedPrimary, ...formattedVets, ...formattedStaff];

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
const formatVetAsStaff = (vet, isPrimary) => {
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
      role: vet.specialization || (isPrimary ? 'Primary Veterinarian' : 'Veterinarian'),
      specialization: vet.specialization,
      licenseId: vet.veterinaryId,
      isPrimary: isPrimary,
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
    const primaryVet = await Veterinarian.findById(primaryVetId);
    if (!primaryVet || primaryVet.accessLevel !== 'Primary') {
      return res.status(403).json({ 
        message: 'Only Primary veterinarians can delete accounts' 
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

    // Check if primary vet owns the clinic where this vet is active
    let hasPermission = false;
    
    if (vetToDelete.currentActiveClinicId) {
      // Check if primary vet owns the clinic where target vet is active
      hasPermission = primaryVet.ownedClinics && 
                     primaryVet.ownedClinics.some(clinicId => 
                       clinicId.toString() === vetToDelete.currentActiveClinicId.toString()
                     );
      
      console.log('Primary vet owned clinics:', primaryVet.ownedClinics?.map(c => c.toString()));
      console.log('Vet clinic ID:', vetToDelete.currentActiveClinicId.toString());
      console.log('Has permission?', hasPermission);
    }

    // Also check if the vet was created by this primary vet
    const wasCreatedByPrimaryVet = vetToDelete.createdByVetId && 
                                   vetToDelete.createdByVetId.toString() === primaryVetId.toString();
    
    console.log('Was created by primary vet?', wasCreatedByPrimaryVet);
    console.log('Created by:', vetToDelete.createdByVetId);

    // Allow deletion if:
    // 1. Vet is in a clinic owned by primary vet, OR
    // 2. Vet was created by primary vet
    if (!hasPermission && !wasCreatedByPrimaryVet) {
      return res.status(403).json({
        message: 'You can only delete veterinarians from clinics you own or those you created'
      });
    }

    // Check if this is a primary vet (shouldn't happen due to earlier check, but just in case)
    if (vetToDelete.accessLevel === 'Primary') {
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

// Delete clinic staff (Primary Vet only)
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

    // Find the primary vet
    const primaryVet = await Veterinarian.findById(primaryVetId);
    if (!primaryVet || primaryVet.accessLevel !== 'Primary') {
      return res.status(403).json({ 
        message: 'Only Primary veterinarians can delete clinic staff' 
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

    // Check if primary vet owns the clinic
    const ownsClinic = primaryVet.ownedClinics && 
                      primaryVet.ownedClinics.some(clinicId => 
                        clinicId.toString() === clinicStaff.clinicId.toString()
                      );
    
    console.log('Primary vet owned clinics:', primaryVet.ownedClinics?.map(c => c.toString()));
    console.log('Owns clinic?', ownsClinic);

    // Also check if the staff was created by this primary vet
    const wasCreatedByPrimaryVet = clinicStaff.createdBy && 
                                   clinicStaff.createdBy.toString() === primaryVetId.toString();
    
    console.log('Was created by primary vet?', wasCreatedByPrimaryVet);

    if (!ownsClinic && !wasCreatedByPrimaryVet) {
      return res.status(403).json({
        message: 'You can only delete staff from clinics you own or those you created'
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

// Activate veterinarian account (Primary Vet only)
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

    // Find the primary vet
    const primaryVet = await Veterinarian.findById(primaryVetId);
    if (!primaryVet || primaryVet.accessLevel !== 'Primary') {
      return res.status(403).json({ 
        message: 'Only Primary veterinarians can activate accounts' 
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

    // Check permissions
    let hasPermission = false;
    if (vetToActivate.currentActiveClinicId) {
      // Check if primary vet owns the clinic where target vet is active
      hasPermission = primaryVet.ownedClinics && 
                     primaryVet.ownedClinics.some(clinicId => 
                       clinicId.toString() === vetToActivate.currentActiveClinicId.toString()
                     );
      
      console.log('Primary vet owned clinics:', primaryVet.ownedClinics?.map(c => c.toString()));
      console.log('Vet clinic ID:', vetToActivate.currentActiveClinicId?.toString());
      console.log('Has permission?', hasPermission);
    }

    // Also check if the vet was created by this primary vet
    const wasCreatedByPrimaryVet = vetToActivate.createdByVetId && 
                                   vetToActivate.createdByVetId.toString() === primaryVetId.toString();
    
    console.log('Was created by primary vet?', wasCreatedByPrimaryVet);
    console.log('Created by:', vetToActivate.createdByVetId);

    // Allow activation if:
    // 1. Vet is in a clinic owned by primary vet, OR
    // 2. Vet was created by primary vet
    if (!hasPermission && !wasCreatedByPrimaryVet) {
      return res.status(403).json({
        message: 'You can only activate veterinarians from clinics you own or those you created'
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
  getStaffByPrimaryVet,
  deleteVet,         
  deleteClinicStaff 
};