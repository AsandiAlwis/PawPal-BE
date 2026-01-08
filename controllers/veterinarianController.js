const Veterinarian = require('../models/Veterinarian');
const Clinic = require('../models/Clinic');
const bcrypt = require('bcryptjs');

// Register a new Veterinarian (can be Primary Vet or standalone)
exports.registerVet = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      password,
      phoneNumber,
      veterinaryId,
      specialization,
      clinicId,             // Optional for Primary Vet
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

    let finalClinicId = null;
    let accessLevel = 'Normal Access';
    let isPrimary = false;

    // Handle Primary Vet logic
    if (isPrimaryVet) {
      accessLevel = 'Primary';
      isPrimary = true;

      if (clinicId) {
        // Linking to an existing clinic
        const clinic = await Clinic.findById(clinicId);
        if (!clinic) {
          return res.status(404).json({ message: 'Clinic not found' });
        }
        if (clinic.primaryVetId) {
          return res.status(403).json({
            message: 'This clinic already has a Primary Vet'
          });
        }
        finalClinicId = clinicId;
      } else {
        // Create a new clinic automatically
        const clinicName = `${firstName} ${lastName}'s Clinic`; // Or let them provide name later
        const newClinic = new Clinic({
          name: clinicName,
          address: '', // Can be updated later in clinic settings
          phoneNumber: phoneNumber,
          primaryVetId: null // Will be set after vet is created
        });

        await newClinic.save();
        finalClinicId = newClinic._id;
      }
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
      clinicId: finalClinicId,
      accessLevel,
      isPrimaryVet: isPrimary,
      createdByVetId: null,
      status: 'Active'
    });

    await vet.save();

    // If Primary Vet and new clinic was created → link them
    if (isPrimaryVet && !clinicId) {
      await Clinic.findByIdAndUpdate(finalClinicId, { primaryVetId: vet._id });
    }

    // If linking to existing clinic → update primaryVetId
    if (isPrimaryVet && clinicId) {
      await Clinic.findByIdAndUpdate(clinicId, { primaryVetId: vet._id });
    }

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
exports.createSubAccount = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      password,
      phoneNumber,
      veterinaryId,
      specialization,
      accessLevel = 'Normal Access' // 'Full Access' // Only Primary can set Full Access
    } = req.body;

    const creatorVetId = req.user?.id; // From JWT after auth middleware

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
    if (!req.body.clinicId || req.body.clinicId !== creator.clinicId.toString()) {
      return res.status(400).json({
        message: 'clinicId is required and must match your clinic'
      });
    }

    // Prevent creating another Primary Vet via sub-account
    if (accessLevel === 'Primary') {
      return res.status(403).json({ message: 'Cannot assign Primary access via sub-account' });
    }

    // Duplicate check
    const existing = await Veterinarian.findOne({
      $or: [{ email }, { veterinaryId }]
    });
    if (existing) {
      return res.status(409).json({ message: 'Email or license already in use' });
    }

    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password, salt);

    const subVet = new Veterinarian({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.toLowerCase().trim(),
      passwordHash,
      phoneNumber,
      veterinaryId,
      specialization: specialization?.trim() || '',
      clinicId: req.body.clinicId,
      accessLevel, // 'Normal Access' or 'Full Access'
      isPrimaryVet: false,
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
exports.getVetsByClinic = async (req, res) => {
  try {
    const { clinicId } = req.params;

    const clinic = await Clinic.findById(clinicId);
    if (!clinic) {
      return res.status(404).json({ message: 'Clinic not found' });
    }

    const vets = await Veterinarian.find({ clinicId, status: 'Active' })
      .select('-passwordHash')
      .sort({ isPrimaryVet: -1, accessLevel: -1, firstName: 1 });

    res.status(200).json({
      clinicName: clinic.name,
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
exports.getVetById = async (req, res) => {
  try {
    const { id } = req.params;

    const vet = await Veterinarian.findById(id)
      .select('-passwordHash')
      .populate('clinicId', 'name address phoneNumber');

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
exports.updateVet = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Prevent changing critical fields
    const restricted = ['clinicId', 'accessLevel', 'isPrimaryVet', 'createdByVetId'];
    for (let field of restricted) {
      if (updates[field]) {
        return res.status(403).json({ message: `${field} cannot be modified` });
      }
    }

    // If updating own profile
    if (req.user?.id === id) {
      // Allow personal info update
    } else {
      // Only Primary/Full Access can update others
      const requester = await Veterinarian.findById(req.user?.id);
      if (!requester || !['Primary', 'Full Access'].includes(requester.accessLevel)) {
        return res.status(403).json({ message: 'Insufficient permissions' });
      }
    }

    const vet = await Veterinarian.findByIdAndUpdate(
      id,
      updates,
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
    res.status(400).json({
      message: 'Error updating profile',
      error: error.message
    });
  }
};

// Deactivate vet account (Primary Vet only)
exports.deactivateVet = async (req, res) => {
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
exports.getClinicStaffStats = async (req, res) => {
  try {
    const { clinicId } = req.params;
    const userId = req.user?.id;

    const user = await Veterinarian.findById(userId);
    if (!user || user.clinicId.toString() !== clinicId || !['Primary', 'Full Access'].includes(user.accessLevel)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const stats = await Veterinarian.aggregate([
      { $match: { clinicId: new mongoose.Types.ObjectId(clinicId), status: 'Active' } },
      {
        $group: {
          _id: '$accessLevel',
          count: { $sum: 1 }
        }
      }
    ]);

    const total = await Veterinarian.countDocuments({ clinicId, status: 'Active' });

    res.status(200).json({
      totalActiveVets: total,
      breakdown: Object.fromEntries(stats.map(s => [s._id, s.count]))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};