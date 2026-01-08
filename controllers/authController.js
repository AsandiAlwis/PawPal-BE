// controllers/authController.js
const PetOwner = require('../models/PetOwner');
const Veterinarian = require('../models/Veterinarian');
const bcrypt = require('bcryptjs');
const generateToken = require('../utils/generateToken');

// Login for both Pet Owners and Veterinarians
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Please provide email and password' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check in both collections
    let user = await PetOwner.findOne({ email: normalizedEmail });
    let role = 'owner';

    if (!user) {
      user = await Veterinarian.findOne({ email: normalizedEmail, status: 'Active' });
      role = 'vet';
    }

    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Compare password
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Generate token
    const token = generateToken(user._id);

    // Response data
    const responseUser = {
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role,
      // Vet-specific
      accessLevel: role === 'vet' ? user.accessLevel : null,
      clinicId: role === 'vet' ? user.clinicId : null,
      isPrimaryVet: role === 'vet' ? user.isPrimaryVet : null
    };

    res.status(200).json({
      message: 'Login successful',
      token,
      user: responseUser
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error during login', error: error.message });
  }
};

// Get current logged-in user profile
exports.getMe = async (req, res) => {
  try {
    let user = await PetOwner.findById(req.user.id)
      .select('-passwordHash -__v'); // Exclude password and version

    let role = 'owner';

    if (!user) {
      user = await Veterinarian.findById(req.user.id)
        .select('-passwordHash -__v')
        .populate('clinicId', 'name address phoneNumber');
      role = 'vet';
    }

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Build response with common + role-specific fields
    const responseUser = {
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phoneNumber: user.phoneNumber || null,
      address: user.address || null,
      role,
    };

    // Add vet-specific fields if applicable
    if (role === 'vet') {
      responseUser.accessLevel = user.accessLevel || null;
      responseUser.clinicId = user.clinicId?._id || null;
      responseUser.isPrimaryVet = user.isPrimaryVet || false;
      responseUser.clinic = user.clinicId ? {
        name: user.clinicId.name,
        address: user.clinicId.address,
        phoneNumber: user.clinicId.phoneNumber
      } : null;
    }

    res.status(200).json({
      user: responseUser
    });
  } catch (error) {
    console.error('Error in getMe:', error);
    res.status(500).json({ 
      message: 'Error fetching profile',
      error: error.message 
    });
  }
};