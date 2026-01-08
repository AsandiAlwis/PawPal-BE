const PetOwner = require('../models/PetOwner');
const bcrypt = require('bcryptjs'); // Make sure to install: npm install bcryptjs

// Register a new Pet Owner
exports.registerOwner = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      address,
      phoneNumber,
      email,
      password,
      location // Optional: { type: 'Point', coordinates: [lng, lat] }
    } = req.body;

    // Required fields validation
    if (!firstName || !lastName || !email || !password || !phoneNumber || !address) {
      return res.status(400).json({
        message: 'firstName, lastName, email, password, phoneNumber, and address are required'
      });
    }

    // Check if email already exists
    const existingOwner = await PetOwner.findOne({ email: email.toLowerCase() });
    if (existingOwner) {
      return res.status(409).json({
        message: 'An account with this email already exists'
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password, salt);

    // Validate location format if provided
    let locationData = undefined;
    if (location) {
      if (!location.type || location.type !== 'Point' || !Array.isArray(location.coordinates) || location.coordinates.length !== 2) {
        return res.status(400).json({
          message: 'Location must be { type: "Point", coordinates: [longitude, latitude] }'
        });
      }
      locationData = {
        type: 'Point',
        coordinates: [parseFloat(location.coordinates[0]), parseFloat(location.coordinates[1])]
      };
    }

    const owner = new PetOwner({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      address: address.trim(),
      phoneNumber: phoneNumber.trim(),
      email: email.toLowerCase().trim(),
      passwordHash,
      location: locationData,
      profilePhoto: req.body.profilePhoto || '' // Optional URL
    });

    await owner.save();

    // Do not return passwordHash in response
    const ownerResponse = owner.toObject();
    delete ownerResponse.passwordHash;

    res.status(201).json({
      message: 'Pet owner registered successfully',
      owner: ownerResponse
    });
  } catch (error) {
    res.status(400).json({
      message: 'Error registering owner',
      error: error.message
    });
  }
};

// Get all pet owners (Admin use or search – use with caution)
exports.getAllOwners = async (req, res) => {
  try {
    const { page = 1, limit = 20, search } = req.query;

    let query = {};
    if (search) {
      const regex = new RegExp(search.trim(), 'i');
      query.$or = [
        { firstName: regex },
        { lastName: regex },
        { email: regex }
      ];
    }

    const owners = await PetOwner.find(query)
      .select('-passwordHash -__v') // Exclude sensitive fields
      .sort({ lastName: 1, firstName: 1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await PetOwner.countDocuments(query);

    res.status(200).json({
      owners,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
        hasMore: owners.length === parseInt(limit)
      }
    });
  } catch (error) {
    res.status(500).json({
      message: 'Error fetching owners',
      error: error.message
    });
  }
};

// Get owner by ID
exports.getOwnerById = async (req, res) => {
  try {
    const { id } = req.params;

    const owner = await PetOwner.findById(id)
      .select('-passwordHash -__v');

    if (!owner) {
      return res.status(404).json({ message: 'Owner not found' });
    }

    res.status(200).json(owner);
  } catch (error) {
    res.status(500).json({
      message: 'Error fetching owner',
      error: error.message
    });
  }
};

// Update owner profile (Owner themselves or admin)
exports.updateOwner = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Prevent updating email to an existing one
    if (updates.email) {
      const existing = await PetOwner.findOne({
        email: updates.email.toLowerCase(),
        _id: { $ne: id }
      });
      if (existing) {
        return res.status(409).json({
          message: 'This email is already in use by another account'
        });
      }
      updates.email = updates.email.toLowerCase().trim();
    }

    // Prevent direct password update here – use dedicated change password endpoint
    if (updates.password || updates.passwordHash) {
      return res.status(400).json({
        message: 'Use /change-password endpoint to update password'
      });
    }

    // Handle location update
    if (updates.location) {
      if (!updates.location.type || updates.location.type !== 'Point' || !Array.isArray(updates.location.coordinates)) {
        return res.status(400).json({
          message: 'Invalid location format'
        });
      }
      updates.location = {
        type: 'Point',
        coordinates: [
          parseFloat(updates.location.coordinates[0]),
          parseFloat(updates.location.coordinates[1])
        ]
      };
    }

    const owner = await PetOwner.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    ).select('-passwordHash -__v');

    if (!owner) {
      return res.status(404).json({ message: 'Owner not found' });
    }

    res.status(200).json({
      message: 'Owner updated successfully',
      owner
    });
  } catch (error) {
    res.status(400).json({
      message: 'Error updating owner',
      error: error.message
    });
  }
};

// Soft delete owner (recommended over hard delete)
exports.deleteOwner = async (req, res) => {
  try {
    const { id } = req.params;

    const owner = await PetOwner.findByIdAndUpdate(
      id,
      { isDeleted: true, deletedAt: new Date() },
      { new: true }
    ).select('-passwordHash');

    if (!owner) {
      return res.status(404).json({ message: 'Owner not found' });
    }

    res.status(200).json({
      message: 'Owner account soft-deleted successfully',
      owner
    });
  } catch (error) {
    res.status(500).json({
      message: 'Error deleting owner',
      error: error.message
    });
  }
};

// Get owner's pets count and basic info (dashboard summary)
exports.getOwnerSummary = async (req, res) => {
  try {
    const { id } = req.params;

    const owner = await PetOwner.findById(id).select('firstName lastName email');
    if (!owner) {
      return res.status(404).json({ message: 'Owner not found' });
    }

    const PetProfile = require('../models/PetProfile');
    const petCount = await PetProfile.countDocuments({ ownerId: id });
    const registeredPets = await PetProfile.countDocuments({
      ownerId: id,
      registrationStatus: 'Approved'
    });

    res.status(200).json({
      owner,
      stats: {
        totalPets: petCount,
        registeredPets,
        pendingRegistration: petCount - registeredPets
      }
    });
  } catch (error) {
    res.status(500).json({
      message: 'Error fetching owner summary',
      error: error.message
    });
  }
};