// middleware/auth.js
const jwt = require('jsonwebtoken');
const PetOwner = require('../models/PetOwner');
const Veterinarian = require('../models/Veterinarian');

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';

// Protect routes - verify JWT and attach user to req
exports.protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    console.log('No token provided');
    return res.status(401).json({ 
      success: false,
      message: 'Not authorized, no token provided' 
    });
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET);
    console.log('Token verified successfully:', decoded);

    const userId = decoded.id || decoded._id;
    let role = decoded.role; // This should always exist in a well-formed token

    console.log('User ID from token:', userId);
    console.log('Role from token:', role);

    if (!userId) {
      console.error('No user ID found in token');
      return res.status(401).json({ 
        success: false,
        message: 'Invalid token: no user ID' 
      });
    }

    if (!role || !['owner', 'vet'].includes(role)) {
      console.log('No valid role in token, attempting to determine from database...');

      // Fallback: try to discover who this user is
      let user = await Veterinarian.findById(userId).select('-passwordHash');
      if (user) {
        role = 'vet';
        console.log('Determined role: vet');
      } else {
        user = await PetOwner.findById(userId).select('-passwordHash');
        if (user) {
          role = 'owner';
          console.log('Determined role: owner');
        }
      }

      if (!role) {
        console.error('Could not determine user role from either collection');
        return res.status(401).json({ 
          success: false,
          message: 'User not found or invalid role' 
        });
      }
    }

    // Fetch user according to role
    let user;
    if (role === 'owner') {
      user = await PetOwner.findById(userId).select('-passwordHash');
      console.log('Fetched PetOwner:', user ? 'Found' : 'Not found');
    } else if (role === 'vet') {
      try {
        user = await Veterinarian.findById(userId)
          .select('-passwordHash')
          .populate('currentActiveClinicId', 'name address phoneNumber');
        console.log('Fetched Veterinarian with populate:', user ? 'Found' : 'Not found');
      } catch (populateError) {
        console.log('Populate failed:', populateError.message);
        user = await Veterinarian.findById(userId).select('-passwordHash');
        console.log('Fetched Veterinarian (no populate):', user ? 'Found' : 'Not found');
      }
    }

    if (!user) {
      console.error(`User not found for ID: ${userId}, role: ${role}`);
      return res.status(401).json({ 
        success: false,
        message: 'Not authorized, user not found' 
      });
    }

    // Vet-specific status check
    if (role === 'vet' && user.status !== 'Active') {
      console.error('Veterinarian is not active:', user.status);
      return res.status(401).json({ 
        success: false,
        message: 'Account is not active. Please contact administrator.' 
      });
    }

    // Build lean req.user object (no userType anymore)
    req.user = {
      id: user._id,
      email: user.email,
      role: role
    };

    // Vet-specific fields
    if (role === 'vet') {
      req.user.accessLevel = user.accessLevel || null;

      if (user.currentActiveClinicId) {
        if (typeof user.currentActiveClinicId === 'object') {
          // Populated
          req.user.clinicId = user.currentActiveClinicId._id;
          req.user.clinic = {
            id: user.currentActiveClinicId._id,
            name: user.currentActiveClinicId.name,
            address: user.currentActiveClinicId.address,
            phoneNumber: user.currentActiveClinicId.phoneNumber
          };
        } else {
          // Just ObjectId
          req.user.clinicId = user.currentActiveClinicId;
        }
      } else {
        req.user.clinicId = null;
      }

      req.user.currentActiveClinicId = user.currentActiveClinicId || null;
      req.user.isPrimaryVet   = user.isPrimaryVet || false;
      req.user.ownedClinics   = user.ownedClinics || [];
      
      console.log('Vet clinic info:', req.user.clinic);
    }

    next();
  } catch (error) {
    console.error('=== AUTH MIDDLEWARE ERROR ===');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        success: false,
        message: 'Invalid token signature' 
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false,
        message: 'Token expired, please login again' 
      });
    }

    return res.status(401).json({ 
      success: false,
      message: 'Not authorized, token failed',
      error: error.message 
    });
  }
};

// ────────────────────────────────────────────────
// Authorize specific roles (owner / vet)
exports.authorize = (...roles) => {
  return (req, res, next) => {
    console.log('Authorization check - User:', req.user?.id, 'Role:', req.user?.role);
    console.log('Required roles:', roles);

    if (!req.user || !req.user.role) {
      return res.status(401).json({ 
        success: false,
        message: 'Not authenticated' 
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        success: false,
        message: `Forbidden: required role is one of: ${roles.join(', ')}` 
      });
    }

    console.log('Authorization passed');
    next();
  };
};

// Authorize vet access levels (Primary, Full Access, Normal Access)
exports.authorizeVetAccess = (...levels) => {
  return (req, res, next) => {
    if (req.user.role !== 'vet') {
      return res.status(403).json({ 
        success: false,
        message: 'Vet access required' 
      });
    }

    if (!levels.includes(req.user.accessLevel)) {
      return res.status(403).json({
        success: false,
        message: `Vet access denied: requires ${levels.join(' or ')} access level`
      });
    }

    next();
  };
};

// Middleware: Ensure vet belongs to the clinic requested for the pet
const authorizeVetForClinicFromPet = async (req, res, next) => {
  try {
    const { id } = req.params; // petId

    const pet = await PetProfile.findById(id);

    if (!pet) {
      return res.status(404).json({ 
        success: false,
        message: 'Pet not found' 
      });
    }

    if (!pet.registeredClinicId) {
      return res.status(400).json({ 
        success: false,
        message: 'This pet has no clinic registration request' 
      });
    }

    if (req.user.role !== 'vet' || !req.user.clinicId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized: Veterinarian access required with active clinic'
      });
    }

    const vetClinicId = req.user.clinicId.toString();
    const petClinicId = pet.registeredClinicId.toString();

    if (vetClinicId !== petClinicId) {
      console.log(`Clinic mismatch - Vet: ${vetClinicId}, Pet: ${petClinicId}`);
      return res.status(403).json({
        success: false,
        message: 'Not authorized: This pet registration request is not for your clinic'
      });
    }

    req.pet = pet;
    next();
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: 'Error in vet clinic authorization', 
      error: error.message 
    });
  }
};

module.exports = {
  protect: exports.protect,
  authorize: exports.authorize,
  authorizeVetAccess: exports.authorizeVetAccess,
  authorizeVetForClinicFromPet
};