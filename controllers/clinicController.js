const Clinic = require('../models/Clinic');
const Veterinarian = require('../models/Veterinarian');
const ClinicStaff = require('../models/ClinicStaff');
const PetProfile = require('../models/PetProfile');
const bcrypt = require('bcryptjs');

// Create a new clinic (Enhanced vet can create multiple clinics)
exports.createClinic = async (req, res) => {
  try {
    const {
      name,
      address,
      phoneNumber,
      operatingDays,
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

    // Validate location format if provided
    if (location && (!location.type || !Array.isArray(location.coordinates) || location.type !== 'Point')) {
      return res.status(400).json({
        message: 'Location must be a valid GeoJSON Point: { type: "Point", coordinates: [lng, lat] }'
      });
    }

    // Create the clinic
    const clinic = new Clinic({
      name: name.trim(),
      address: address.trim(),
      phoneNumber: phoneNumber.trim(),
      operatingDays: operatingDays || [],
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

// Get clinics for the logged-in veterinarian
exports.getMyClinic = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(200).json({ clinics: [] });
    }

    const vetId = req.user.id;

    const vet = await Veterinarian.findById(vetId)
      .populate('ownedClinics')
      .populate('currentActiveClinicId')
      .select('accessLevel ownedClinics currentActiveClinicId');

    if (!vet) {
      return res.status(200).json({ clinics: [] });
    }

    let clinics = [];

    if (vet.currentActiveClinicId) {
      // Prevent duplicate if it's already in ownedClinics
      const activeId = vet.currentActiveClinicId._id.toString();
      const alreadyIncluded = vet.ownedClinics.some(c => c._id.toString() === activeId);

      if (!alreadyIncluded) {
        clinics.push(vet.currentActiveClinicId);
      }
    }

    if (vet.accessLevel === 'Enhanced' && vet.ownedClinics.length > 0) {
      clinics = clinics.concat(vet.ownedClinics);
    }

    res.status(200).json({
      clinics,
      vetInfo: {
        accessLevel: vet.accessLevel,
        hasClinics: clinics.length > 0,
        isPrimaryVet: vet.accessLevel === 'Enhanced'
      }
    });
  } catch (error) {
    console.error('Error in getMyClinic:', error);
    res.status(500).json({
      message: 'Error fetching your clinics',
      error: error.message
    });
  }
};

// Get nearby clinics based on user's location
exports.getNearbyClinics = async (req, res) => {
  try {
    const { lng, lat, maxDistance = 10000 } = req.query;

    if (!lng || !lat) {
      return res.status(400).json({
        message: 'Longitude (lng) and latitude (lat) are required'
      });
    }

    const longitude = parseFloat(lng);
    const latitude = parseFloat(lat);
    const distance = parseInt(maxDistance, 10);

    if (isNaN(longitude) || isNaN(latitude)) {
      return res.status(400).json({
        message: 'Invalid coordinates: lng and lat must be numbers'
      });
    }

    const clinics = await Clinic.find({
      location: {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [longitude, latitude]
          },
          $maxDistance: distance // in meters
        }
      }
    }).select('-__v'); // Exclude version key

    res.status(200).json({
      count: clinics.length,
      clinics
    });
  } catch (error) {
    res.status(500).json({
      message: 'Error fetching nearby clinics',
      error: error.message
    });
  }
};

// Get a single clinic by ID
exports.getClinicById = async (req, res) => {
  try {
    const { id } = req.params;

    const clinic = await Clinic.findById(id)
      .populate('primaryVetId', 'firstName lastName email phoneNumber specialization');

    if (!clinic) {
      return res.status(404).json({ message: 'Clinic not found' });
    }

    res.status(200).json(clinic);
  } catch (error) {
    res.status(500).json({
      message: 'Error fetching clinic',
      error: error.message
    });
  }
};

// Update clinic details (only allowed for Primary or Enhanced vets)
exports.updateClinic = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Check authentication
    if (!req.user || req.user.role !== 'vet') {
      return res.status(403).json({
        message: 'Access denied: Only veterinarians can update clinics'
      });
    }

    const vet = await Veterinarian.findById(req.user.id);
    if (!vet) {
      return res.status(404).json({ message: 'Veterinarian not found' });
    }



    // Prevent updating primaryVetId
    if (updates.primaryVetId) {
      return res.status(403).json({
        message: 'Changing primary vet is not allowed through this endpoint'
      });
    }

    // Validate location if being updated
    if (updates.location) {
      if (!updates.location.type || !updates.location.coordinates || updates.location.type !== 'Point') {
        return res.status(400).json({
          message: 'Location must be a valid GeoJSON Point'
        });
      }
    }

    const clinic = await Clinic.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!clinic) {
      return res.status(404).json({ message: 'Clinic not found' });
    }

    res.status(200).json({
      message: 'Clinic updated successfully',
      clinic
    });
  } catch (error) {
    res.status(400).json({
      message: 'Error updating clinic',
      error: error.message
    });
  }
};

// Delete a clinic (Enhanced Vet only, and only clinics they own)
exports.deleteClinic = async (req, res) => {
  try {
    const { id } = req.params;

    // Check authentication
    if (!req.user || req.user.role !== 'vet') {
      return res.status(403).json({
        message: 'Access denied: Only veterinarians can delete clinics'
      });
    }

    const vet = await Veterinarian.findById(req.user.id);
    if (!vet || vet.accessLevel !== 'Enhanced') {
      return res.status(403).json({
        message: 'Access denied: Only Enhanced veterinarians can delete clinics'
      });
    }



    const clinic = await Clinic.findByIdAndDelete(id);

    if (!clinic) {
      return res.status(404).json({ message: 'Clinic not found' });
    }

    // Remove clinic from vet's ownedClinics array
    vet.ownedClinics = vet.ownedClinics.filter(clinicId => clinicId.toString() !== id);

    // If deleted clinic was current active clinic, reset it
    if (vet.currentActiveClinicId && vet.currentActiveClinicId.toString() === id) {
      vet.currentActiveClinicId = vet.ownedClinics.length > 0 ? vet.ownedClinics[0] : null;
    }

    await vet.save();

    res.status(200).json({
      message: 'Clinic deleted successfully',
      clinic,
      remainingClinics: vet.ownedClinics.length
    });
  } catch (error) {
    res.status(500).json({
      message: 'Error deleting clinic',
      error: error.message
    });
  }
};

// Unified endpoint: Add either a Veterinarian (sub-account) or non-vet ClinicStaff
exports.addClinicStaff = async (req, res) => {
  try {
    const {
      staffType,           // Required: 'veterinarian' or any other value
      firstName,
      lastName,
      email,
      password,
      phoneNumber,
      veterinaryId,        // Required only for veterinarian
      specialization,      // Optional for veterinarian
      accessLevel = 'Basic', // For veterinarian: 'Basic' or 'Enhanced'
      role,                // For non-vet: 'Receptionist', 'Vet Tech', 'Manager', 'Assistant', 'Kennel Staff'
      clinicId,            // Kept for backward compatibility
      clinicIds            // NEW: Support for multiple clinics
    } = req.body;

    // === 1. Authentication & Role Check ===
    if (!req.user || req.user.role !== 'vet') {
      return res.status(403).json({
        message: 'Access denied: Only veterinarians can add staff'
      });
    }

    // Find the creator (logged-in vet)
    const creator = await Veterinarian.findById(req.user.id);

    if (!creator) {
      return res.status(404).json({
        message: 'Your veterinarian account was not found'
      });
    }

    // Only Enhanced vets can add staff
    if (creator.accessLevel !== 'Enhanced') {
      return res.status(403).json({
        message: 'Permission denied: Only Enhanced veterinarians can add staff'
      });
    }

    // === 2. Clinic Verification ===
    // Determine the final set of clinic IDs
    const resolvedClinicIds = Array.isArray(clinicIds) ? clinicIds : (clinicId ? [clinicId] : []);

    if (resolvedClinicIds.length > 0) {
      for (const cid of resolvedClinicIds) {
        const clinic = await Clinic.findById(cid);
        if (!clinic) {
          return res.status(404).json({
            message: `Clinic not found: ${cid}`
          });
        }
      }
    }

    // === 3. Basic Validation ===
    if (!staffType || !firstName?.trim() || !lastName?.trim() || !email?.trim() || !password || !phoneNumber?.trim()) {
      return res.status(400).json({
        message: 'firstName, lastName, email, password, phoneNumber, and staffType are required'
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedStaffType = staffType.toLowerCase();

    // === 4. Add Veterinarian Sub-Account ===
    if (normalizedStaffType === 'veterinarian') {
      const existingVetEmail = await Veterinarian.findOne({ email: normalizedEmail });
      if (existingVetEmail) {
        return res.status(409).json({ message: 'Email address is already in use' });
      }

      if (phoneNumber?.trim()) {
        const existingVetPhone = await Veterinarian.findOne({ phoneNumber: phoneNumber.trim() });
        if (existingVetPhone) {
          return res.status(409).json({ message: 'Phone number is already in use' });
        }
      }

      const salt = await bcrypt.genSalt(12);
      const passwordHash = await bcrypt.hash(password, salt);

      const newVetData = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: normalizedEmail,
        passwordHash,
        phoneNumber: phoneNumber?.trim() || '',
        specialization: specialization?.trim() || '',
        address: 'Registered by Clinic',
        accessLevel: accessLevel || 'Basic',
        createdByVetId: creator._id,
        status: 'Active'
      };

      if (veterinaryId?.trim()) {
        newVetData.veterinaryId = veterinaryId.trim();
      }

      if (resolvedClinicIds.length > 0) {
        newVetData.currentActiveClinicId = resolvedClinicIds[0];
        newVetData.assignedClinics = resolvedClinicIds;
      } else {
        newVetData.assignedClinics = [];
      }

      const newVet = new Veterinarian(newVetData);
      await newVet.save();

      const response = newVet.toObject();
      delete response.passwordHash;

      return res.status(201).json({
        message: 'Veterinarian added successfully',
        staff: response
      });
    }

    // === 5. Add Non-Veterinarian Clinic Staff ===
    if (normalizedStaffType !== 'veterinarian') {
      if (!role) {
        return res.status(400).json({
          message: 'Role is required for non-veterinarian staff'
        });
      }

      const existingStaff = await ClinicStaff.findOne({ email: normalizedEmail });
      if (existingStaff) {
        return res.status(409).json({
          message: 'A staff member with this email already exists'
        });
      }

      const salt = await bcrypt.genSalt(12);
      const passwordHash = await bcrypt.hash(password, salt);

      const staffAccessLevel = accessLevel || 'Basic';

      const newStaffData = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: normalizedEmail,
        passwordHash,
        phoneNumber: phoneNumber?.trim() || '',
        role,
        accessLevel: staffAccessLevel,
        createdBy: creator._id,
        status: 'Active'
      };

      if (resolvedClinicIds.length > 0) {
        newStaffData.clinicId = resolvedClinicIds[0];
        newStaffData.assignedClinics = resolvedClinicIds;
      }

      const newStaff = new ClinicStaff(newStaffData);

      await newStaff.save();

      const response = newStaff.toObject();
      delete response.passwordHash;

      return res.status(201).json({
        message: `${role} added successfully`,
        staff: response
      });
    }

  } catch (error) {
    console.error('Error in addClinicStaff:', error);
    res.status(500).json({
      message: 'Error adding veterinarian',
      error: error.message
    });
  }
};

// Search clinics by name or address (useful for manual search)
exports.searchClinics = async (req, res) => {
  try {
    const { query } = req.query;

    if (!query || query.trim().length < 2) {
      return res.status(400).json({
        message: 'Search query must be at least 2 characters'
      });
    }

    const regex = new RegExp(query.trim(), 'i'); // Case-insensitive

    const clinics = await Clinic.find({
      $or: [
        { name: regex },
        { address: regex }
      ]
    }).select('name address phoneNumber location');

    res.status(200).json({
      count: clinics.length,
      clinics
    });
  } catch (error) {
    res.status(500).json({
      message: 'Error searching clinics',
      error: error.message
    });
  }
};

// Get all clinics (for admin dashboard or listing)
exports.getAllClinics = async (req, res) => {
  try {
    const clinics = await Clinic.find()
      .populate('primaryVetId', 'firstName lastName')
      .sort({ name: 1 });

    res.status(200).json({
      count: clinics.length,
      clinics
    });
  } catch (error) {
    res.status(500).json({
      message: 'Error fetching all clinics',
      error: error.message
    });
  }
};

// Get all staff members (vets + non-vet staff) for the logged-in vet's clinic
exports.getClinicStaff = async (req, res) => {
  try {
    // === 1. Authentication & Role Check ===
    if (!req.user || req.user.role !== 'vet') {
      return res.status(403).json({
        message: 'Access denied: Only veterinarians can view clinic staff'
      });
    }

    const vet = await Veterinarian.findById(req.user.id);
    if (!vet) {
      return res.status(404).json({
        message: 'Your veterinarian account was not found'
      });
    }

    // === 2. Determine which clinic to show staff for ===
    let clinicId;

    if (req.query.clinicId) {
      // If clinicId is specified in query, validate access
      clinicId = req.query.clinicId;
    } else {
      // If no clinicId specified, use current active clinic
      // For Enhanced vets, determine the clinic
      if (vet.currentActiveClinicId) {
        clinicId = vet.currentActiveClinicId;
      }
      else {
        return res.status(400).json({
          message: 'You are not associated with any clinic'
        });
      }
    }

    // === 3. Fetch Veterinarians for this clinic ===
    const vets = await Veterinarian.find({
      $or: [
        { currentActiveClinicId: clinicId },
        { ownedClinics: clinicId }
      ],
      status: 'Active'
    })
      .select('firstName lastName email phoneNumber veterinaryId specialization accessLevel createdAt')
      .sort({ accessLevel: -1, firstName: 1 });

    // === 4. Fetch Non-Vet Clinic Staff for this clinic ===
    const staff = await ClinicStaff.find({
      clinicId,
      status: 'Active'
    })
      .select('firstName lastName email phoneNumber role accessLevel createdAt')
      .sort({ role: 1, firstName: 1 });

    // === 5. Format unified response ===
    const formattedVets = vets.map(v => ({
      _id: v._id,
      type: 'Veterinarian',
      firstName: v.firstName,
      lastName: v.lastName,
      email: v.email,
      phoneNumber: v.phoneNumber || 'N/A',
      details: {
        licenseId: v.veterinaryId || 'N/A',
        specialization: v.specialization || 'General',
        accessLevel: v.accessLevel,
        isEnhanced: v.accessLevel === 'Enhanced'
      },
      createdAt: v.createdAt
    }));

    const formattedStaff = staff.map(s => ({
      _id: s._id,
      type: 'Clinic Staff',
      firstName: s.firstName,
      lastName: s.lastName,
      email: s.email,
      phoneNumber: s.phoneNumber || 'N/A',
      details: {
        role: s.role,
        accessLevel: s.accessLevel
      },
      createdAt: s.createdAt
    }));

    // Combine and sort by creation date (newest first)
    const allStaff = [...formattedVets, ...formattedStaff]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.status(200).json({
      message: 'Clinic staff retrieved successfully',
      clinicId,
      total: allStaff.length,
      staff: allStaff
    });

  } catch (error) {
    console.error('Error in getClinicStaff:', error);
    res.status(500).json({
      message: 'Error fetching clinic staff',
      error: error.message
    });
  }
};

// Get clinic staff count
exports.getClinicStaffCount = async (req, res) => {
  try {
    const { clinicId } = req.params;

    // === Security: Only allow vets from this clinic ===
    if (!req.user || req.user.role !== 'vet') {
      return res.status(403).json({
        message: 'Access denied: Only veterinarians can access this data'
      });
    }

    const vet = await Veterinarian.findById(req.user.id);
    if (!vet) {
      return res.status(404).json({ message: 'Veterinarian not found' });
    }


    // Verify clinic exists
    const clinicExists = await Clinic.findById(clinicId);
    if (!clinicExists) {
      return res.status(404).json({ message: 'Clinic not found' });
    }

    // Count active veterinarians for this clinic
    const vetCount = await Veterinarian.countDocuments({
      $or: [
        { currentActiveClinicId: clinicId },
        { ownedClinics: clinicId }
      ],
      status: 'Active'
    });

    // Count active non-vet staff for this clinic
    const staffCount = await ClinicStaff.countDocuments({
      clinicId,
      status: 'Active'
    });

    const totalStaff = vetCount + staffCount;

    res.status(200).json({
      message: 'Clinic staff count retrieved successfully',
      clinicId,
      totalStaff,
      breakdown: {
        veterinarians: vetCount,
        nonVetStaff: staffCount
      }
    });

  } catch (error) {
    console.error('Error in getClinicStaffCount:', error);
    res.status(500).json({
      message: 'Error fetching clinic staff count',
      error: error.message
    });
  }
};

// Get single clinic staff by ID
// Get single clinic staff by ID
exports.getClinicStaffById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Import models
    const ClinicStaff = require('../models/ClinicStaff');
    const Veterinarian = require('../models/Veterinarian');

    // Find the staff member with populated clinic data
    const staffMember = await ClinicStaff.findById(id)
      .populate('clinicId', 'name address phoneNumber')
      .populate('createdBy', 'firstName lastName email');

    if (!staffMember) {
      return res.status(404).json({
        message: 'Clinic staff member not found'
      });
    }

    if (!hasPermission) {
      return res.status(403).json({
        message: 'You do not have permission to view this staff member'
      });
    }

    // Format the response
    const formattedStaff = {
      _id: staffMember._id,
      firstName: staffMember.firstName,
      lastName: staffMember.lastName,
      email: staffMember.email,
      phoneNumber: staffMember.phoneNumber,
      role: staffMember.role,
      accessLevel: staffMember.accessLevel,
      status: staffMember.status,
      clinicId: staffMember.clinicId?._id,
      clinic: staffMember.clinicId,
      createdBy: staffMember.createdBy,
      createdAt: staffMember.createdAt,
      updatedAt: staffMember.updatedAt
    };

    res.status(200).json({
      message: 'Clinic staff member retrieved successfully',
      staff: formattedStaff
    });

  } catch (error) {
    console.error('Error fetching clinic staff by ID:', error);
    res.status(500).json({
      message: 'Error fetching staff member',
      error: error.message
    });
  }
};

// Update clinic staff
// Update clinic staff
exports.updateClinicStaff = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const updates = req.body;

    const ClinicStaff = require('../models/ClinicStaff');
    const Veterinarian = require('../models/Veterinarian');

    // Find the staff member
    const staffMember = await ClinicStaff.findById(id);
    if (!staffMember) {
      return res.status(404).json({ message: 'Staff member not found' });
    }

    // Check permissions
    const user = await Veterinarian.findById(userId);
    let hasPermission = false;

    if (user.accessLevel === 'Enhanced') {
      hasPermission = true; // Enhanced vets can update any staff member
    }

    if (!hasPermission) {
      return res.status(403).json({
        message: 'You do not have permission to update this staff member'
      });
    }

    // Clean up the updates object
    const cleanUpdates = { ...updates };

    // Prevent changing critical fields
    const restrictedFields = ['passwordHash', 'createdBy'];
    for (let field of restrictedFields) {
      delete cleanUpdates[field];
    }

    // If email is being changed, check if new email already exists
    if (cleanUpdates.email && cleanUpdates.email.toLowerCase().trim() !== staffMember.email.toLowerCase()) {
      const existingStaffWithEmail = await ClinicStaff.findOne({
        email: cleanUpdates.email.toLowerCase().trim(),
        _id: { $ne: id }
      });

      if (existingStaffWithEmail) {
        return res.status(400).json({
          message: 'Email already in use by another staff member'
        });
      }
    }

    // Trim string fields
    if (cleanUpdates.firstName) cleanUpdates.firstName = cleanUpdates.firstName.trim();
    if (cleanUpdates.lastName) cleanUpdates.lastName = cleanUpdates.lastName.trim();
    if (cleanUpdates.email) cleanUpdates.email = cleanUpdates.email.toLowerCase().trim();
    if (cleanUpdates.phoneNumber) cleanUpdates.phoneNumber = cleanUpdates.phoneNumber.trim();
    if (cleanUpdates.role) cleanUpdates.role = cleanUpdates.role.trim();

    // If assignedClinics is provided, update clinicId for backward compatibility
    if (cleanUpdates.assignedClinics && Array.isArray(cleanUpdates.assignedClinics)) {
      if (cleanUpdates.assignedClinics.length > 0) {
        cleanUpdates.clinicId = cleanUpdates.assignedClinics[0];
      } else {
        cleanUpdates.clinicId = null;
      }
    }


    // Update the staff member
    const updatedStaff = await ClinicStaff.findByIdAndUpdate(
      id,
      cleanUpdates,
      { new: true, runValidators: true }
    );

    res.status(200).json({
      message: 'Staff member updated successfully',
      staff: updatedStaff
    });

  } catch (error) {
    console.error('Error updating clinic staff:', error);
    res.status(500).json({
      message: 'Error updating staff member',
      error: error.message
    });
  }
};

// Deactivate clinic staff
exports.deactivateClinicStaff = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const ClinicStaff = require('../models/ClinicStaff');
    const Veterinarian = require('../models/Veterinarian');

    const staffMember = await ClinicStaff.findById(id);
    if (!staffMember) {
      return res.status(404).json({ message: 'Staff member not found' });
    }

    // Check permissions
    const user = await Veterinarian.findById(userId);
    let hasPermission = false;

    if (user.accessLevel === 'Enhanced' || user.accessLevel === 'Primary') {
      hasPermission = true; // Enhanced vets can deactivate any staff member
    }

    if (!hasPermission) {
      return res.status(403).json({
        message: 'You do not have permission to deactivate this staff member'
      });
    }

    // Update status
    staffMember.status = 'Inactive';
    await staffMember.save();

    res.status(200).json({
      message: 'Staff member deactivated successfully',
      staff: {
        id: staffMember._id,
        firstName: staffMember.firstName,
        lastName: staffMember.lastName,
        status: staffMember.status
      }
    });

  } catch (error) {
    console.error('Error deactivating clinic staff:', error);
    res.status(500).json({
      message: 'Error deactivating staff member',
      error: error.message
    });
  }
};

// Activate clinic staff
exports.activateClinicStaff = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const ClinicStaff = require('../models/ClinicStaff');
    const Veterinarian = require('../models/Veterinarian');

    const staffMember = await ClinicStaff.findById(id);
    if (!staffMember) {
      return res.status(404).json({ message: 'Staff member not found' });
    }

    // Check permissions
    const user = await Veterinarian.findById(userId);
    let hasPermission = false;

    if (user.accessLevel === 'Enhanced') {
      hasPermission = true; // Enhanced vets can activate any staff member
    }

    if (!hasPermission) {
      return res.status(403).json({
        message: 'You do not have permission to activate this staff member'
      });
    }

    // Update status
    staffMember.status = 'Active';
    await staffMember.save();

    res.status(200).json({
      message: 'Staff member activated successfully',
      staff: {
        id: staffMember._id,
        firstName: staffMember.firstName,
        lastName: staffMember.lastName,
        status: staffMember.status
      }
    });

  } catch (error) {
    console.error('Error activating clinic staff:', error);
    res.status(500).json({
      message: 'Error activating staff member',
      error: error.message
    });
  }
};

// Delete clinic staff
exports.deleteClinicStaff = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const ClinicStaff = require('../models/ClinicStaff');
    const Veterinarian = require('../models/Veterinarian');

    const staffMember = await ClinicStaff.findById(id);
    if (!staffMember) {
      return res.status(404).json({ message: 'Staff member not found' });
    }

    // Check permissions
    const user = await Veterinarian.findById(userId);
    let hasPermission = false;

    if (user.accessLevel === 'Enhanced') {
      hasPermission = true; // Enhanced vets can delete any staff member
    }

    if (!hasPermission) {
      return res.status(403).json({
        message: 'You do not have permission to delete this staff member'
      });
    }

    // Delete the staff member
    await ClinicStaff.findByIdAndDelete(id);

    res.status(200).json({
      message: 'Staff member deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting clinic staff:', error);
    res.status(500).json({
      message: 'Error deleting staff member',
      error: error.message
    });
  }
};

// Get clinics where the logged-in owner's pets are registered
exports.getClinicsForOwner = async (req, res) => {
  try {
    const ownerId = req.user.id;

    // Find all approved pet profiles for this owner
    const petProfiles = await PetProfile.find({
      ownerId,
      registrationStatus: 'Approved',
      isDeleted: { $ne: true }
    }).select('registeredClinicId');

    // Extract unique clinic IDs
    const clinicIds = [...new Set(petProfiles.map(p => p.registeredClinicId?.toString()).filter(id => !!id))];

    if (clinicIds.length === 0) {
      return res.status(200).json({ success: true, count: 0, clinics: [] });
    }

    // Fetch clinic details
    const clinics = await Clinic.find({
      _id: { $in: clinicIds }
    }).select('-__v');

    // Optionally add pet counts for each clinic
    const clinicsWithPetCounts = await Promise.all(clinics.map(async (clinic) => {
      const petCount = await PetProfile.countDocuments({
        ownerId,
        registeredClinicId: clinic._id,
        registrationStatus: 'Approved',
        isDeleted: { $ne: true }
      });
      return {
        ...clinic.toObject(),
        petsCount: petCount
      };
    }));

    res.status(200).json({
      success: true,
      count: clinicsWithPetCounts.length,
      clinics: clinicsWithPetCounts
    });
  } catch (error) {
    console.error('Error fetching clinics for owner:', error);
    res.status(500).json({
      message: 'Error fetching your clinics',
      error: error.message
    });
  }
};