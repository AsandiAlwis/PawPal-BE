const PetOwner = require('../models/PetOwner');
const Veterinarian = require('../models/Veterinarian');
const bcrypt = require('bcryptjs');
const generateToken = require('../utils/generateToken');

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ 
        success: false,
        message: 'Please provide email and password' 
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    console.log(`Login attempt: ${normalizedEmail}`);

    // Try PetOwner first (most common case?)
    let user = await PetOwner.findOne({ email: normalizedEmail });
    let role = 'owner';
    let modelName = 'PetOwner';

    // If not found → try Veterinarian
    if (!user) {
      user = await Veterinarian.findOne({ 
        email: normalizedEmail,
        status: 'Active' 
      }).populate('currentActiveClinicId', 'name address phoneNumber');

      if (user) {
        role = 'vet';
        modelName = 'Veterinarian';
      }
    }

    if (!user) {
      return res.status(401).json({ 
        success: false,
        message: 'Invalid email or password' 
      });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ 
        success: false,
        message: 'Invalid email or password' 
      });
    }

    // Generate token → only role, no userType
    const token = generateToken({
      id: user._id,
      email: user.email,
      role: role
    });

    // Prepare safe user object for response
    const responseUser = {
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: role,
      phoneNumber: user.phoneNumber || null,
      address: user.address || null
    };

    // Vet-specific fields
    if (role === 'vet') {
      responseUser.accessLevel = user.accessLevel || null;
      responseUser.isPrimaryVet = user.isPrimaryVet || false;
      responseUser.ownedClinics = user.ownedClinics || [];

      if (user.currentActiveClinicId) {
        if (typeof user.currentActiveClinicId === 'object') {
          // populated
          responseUser.currentActiveClinicId = user.currentActiveClinicId._id;
          responseUser.clinicId = user.currentActiveClinicId._id;
          responseUser.clinic = {
            id: user.currentActiveClinicId._id,
            name: user.currentActiveClinicId.name,
            address: user.currentActiveClinicId.address,
            phoneNumber: user.currentActiveClinicId.phoneNumber
          };
        } else {
          // just ObjectId (shouldn't happen after populate, but safe)
          responseUser.currentActiveClinicId = user.currentActiveClinicId;
          responseUser.clinicId = user.currentActiveClinicId;
        }
      } else {
        responseUser.clinicId = null;
        responseUser.currentActiveClinicId = null;
      }
    }

    return res.status(200).json({
      success: true,
      message: `${role === 'vet' ? 'Veterinarian' : 'Pet owner'} login successful`,
      token,
      user: responseUser
    });

  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ 
      success: false,
      message: 'Server error during login',
      error: error.message 
    });
  }
};

// ────────────────────────────────────────────────

exports.getMe = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ 
        success: false,
        message: 'Not authorized - no user ID' 
      });
    }

    let user = await PetOwner.findById(req.user.id)
      .select('-passwordHash -__v');

    let role = 'owner';

    if (!user) {
      user = await Veterinarian.findById(req.user.id)
        .select('-passwordHash -__v')
        .populate('currentActiveClinicId', 'name address phoneNumber');
      role = 'vet';
    }

    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }

    const responseUser = {
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phoneNumber: user.phoneNumber || null,
      address: user.address || null,
      role
    };

    if (role === 'vet') {
      responseUser.accessLevel = user.accessLevel || null;
      responseUser.isPrimaryVet = user.isPrimaryVet || false;
      responseUser.ownedClinics = user.ownedClinics || [];

      if (user.currentActiveClinicId && typeof user.currentActiveClinicId === 'object') {
        responseUser.clinic = {
          id: user.currentActiveClinicId._id,
          name: user.currentActiveClinicId.name,
          address: user.currentActiveClinicId.address,
          phoneNumber: user.currentActiveClinicId.phoneNumber
        };
        responseUser.clinicId = user.currentActiveClinicId._id;
        responseUser.currentActiveClinicId = user.currentActiveClinicId._id;
      } else {
        responseUser.clinicId = null;
        responseUser.currentActiveClinicId = null;
      }
    }

    return res.status(200).json({
      success: true,
      user: responseUser
    });

  } catch (error) {
    console.error('getMe error:', error);
    return res.status(500).json({ 
      success: false,
      message: 'Error fetching user profile',
      error: error.message 
    });
  }
};