const jwt = require('jsonwebtoken');

const generateToken = (payloadData) => {
  // payloadData can be:
  // - an object { id, email, role, ... }
  // - or just a string (old style – user ID only)

  let payload = {};

  if (typeof payloadData === 'string') {
    // Backward compatibility – old calls that only pass user._id
    payload = { id: payloadData };
  } else if (typeof payloadData === 'object' && payloadData !== null) {
    // Modern usage – expect at least id + role
    payload = {
      id: payloadData.id || payloadData._id,
      email: payloadData.email || undefined,
      role: payloadData.role,           // ← This is required now
      // userType: payloadData.userType, // ← you can REMOVE this completely
    };

    // Optional: add more fields if needed (but keep token small)
    // iat & exp are added automatically by jwt.sign
  } else {
    throw new Error('Invalid payload for generateToken');
  }

  // Safety check – role is now mandatory
  if (!payload.role) {
    console.error('generateToken called without role!', payload);
    throw new Error('Token generation failed: role is required');
  }

  return jwt.sign(
    payload,
    process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production',
    { expiresIn: '30d' }   // ← changed to 30 days – 7d is quite short
  );
};

module.exports = generateToken;