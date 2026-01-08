// middleware/auth.js
const jwt = require('jsonwebtoken');
const PetOwner = require('../models/PetOwner');
const Veterinarian = require('../models/Veterinarian');
const PetProfile = require('../models/PetProfile');

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';

// Protect routes - verify JWT and attach user to req
exports.protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ message: 'Not authorized, no token provided' });
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET);

    // Find user in both collections
    let user = await PetOwner.findById(decoded.id).select('-passwordHash');
    if (!user) {
      user = await Veterinarian.findById(decoded.id).select('-passwordHash');
    }

    if (!user) {
      return res.status(401).json({ message: 'Not authorized, user not found' });
    }

    // Add user and role to request
    req.user = {
      id: user._id,
      email: user.email,
      role: user instanceof PetOwner ? 'owner' : 'vet',
      // For vets: add access level
      accessLevel: user instanceof Veterinarian ? user.accessLevel : null,
      clinicId: user instanceof Veterinarian ? user.clinicId : null
    };

    next();
  } catch (error) {
    console.error(error);
    return res.status(401).json({ message: 'Not authorized, token failed' });
  }
};

// Authorize specific roles
exports.authorize = (...roles) => {
  return (req, res, next) => {

    if (!req.user) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        message: `Access denied: ${roles.join(' or ')} role required`
      });
    }

    next();
  };
};

// Authorize vet access levels (Primary, Full Access, Normal Access)
exports.authorizeVetAccess = (...levels) => {
  return (req, res, next) => {
    if (req.user.role !== 'vet') {
      return res.status(403).json({ message: 'Vet access required' });
    }

    if (!levels.includes(req.user.accessLevel)) {
      return res.status(403).json({
        message: `Vet access denied: requires ${levels.join(' or ')}`
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
      return res.status(404).json({ message: 'Pet not found' });
    }

    if (!pet.registeredClinicId) {
      return res.status(400).json({ message: 'This pet has no clinic registration request' });
    }

    if (req.user.role !== 'vet' || req.user.clinicId?.toString() !== pet.registeredClinicId.toString()) {
      return res.status(403).json({
        message: 'Not authorized: This pet registration request is not for your clinic'
      });
    }

    req.pet = pet;
    next();
  } catch (error) {
    res.status(500).json({ message: 'Error in vet clinic authorization', error: error.message });
  }
};

module.exports = {
  protect: exports.protect,           // or just protect,
  authorize: exports.authorize,
  authorizeVetAccess: exports.authorizeVetAccess,
  authorizeVetForClinicFromPet
};