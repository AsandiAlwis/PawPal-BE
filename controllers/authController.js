const PetOwner = require('../models/PetOwner');
const Veterinarian = require('../models/Veterinarian');
const ClinicStaff = require('../models/ClinicStaff');
const Clinic = require('../models/Clinic');
const bcrypt = require('bcryptjs');
const generateToken = require('../utils/generateToken');
const { OAuth2Client } = require('google-auth-library');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

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

    // If still not found → try ClinicStaff
    if (!user) {
      user = await ClinicStaff.findOne({
        email: normalizedEmail,
        status: 'Active'
      }).populate('clinicId', 'name address phoneNumber');

      if (user) {
        role = 'vet'; // Use vet role for frontend routing
        modelName = 'ClinicStaff';
        user.currentActiveClinicId = user.clinicId; // Map for response formatting
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

    if (user.isTwoFactorEnabled) {
      return res.status(200).json({
        success: true,
        requires2FA: true,
        userId: user._id,
        role: role,
        message: '2FA verification required'
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
      address: user.address || null,
      isTwoFactorEnabled: user.isTwoFactorEnabled || false,
      hasPassword: !!user.passwordHash
    };

    // Vet-specific fields
    if (role === 'vet') {
      responseUser.accessLevel = user.accessLevel || null;
      responseUser.isPrimaryVet = user.isPrimaryVet || false;
      responseUser.ownedClinics = user.ownedClinics || [];
      responseUser.staffRole = user.role || null;
      responseUser.veterinaryId = user.veterinaryId || null;

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
      if (user) role = 'vet';
    }

    if (!user) {
      user = await ClinicStaff.findById(req.user.id)
        .select('-passwordHash -__v')
        .populate('clinicId', 'name address phoneNumber');
      if (user) {
        role = 'vet';
        user.currentActiveClinicId = user.clinicId;
      }
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
      isTwoFactorEnabled: user.isTwoFactorEnabled || false,
      hasPassword: !!user.passwordHash,
      role
    };

    if (role === 'vet') {
      responseUser.accessLevel = user.accessLevel || null;
      responseUser.isPrimaryVet = user.isPrimaryVet || false;
      responseUser.ownedClinics = user.ownedClinics || [];
      responseUser.staffRole = user.role || null;

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

// ────────────────────────────────────────────────
// Google Login
// ────────────────────────────────────────────────
exports.googleLogin = async (req, res) => {
  try {
    const { token, role } = req.body; // Expect frontend to send token and requested role (owner/vet)
    if (!token) {
      return res.status(400).json({ success: false, message: 'No Google token provided' });
    }

    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    const { email, given_name, family_name, sub: googleId, picture } = payload;
    const normalizedEmail = email.toLowerCase().trim();

    // Check if user exists by googleId first (most authoritative for Google login)
    let user = await PetOwner.findOne({ googleId: googleId });
    let actualRole = 'owner';
    let isNewUser = false;

    if (!user) {
      user = await Veterinarian.findOne({ googleId: googleId, status: 'Active' })
        .populate('currentActiveClinicId', 'name address phoneNumber');
      if (user) {
        actualRole = 'vet';
      }
    }

    // If not found by googleId, search by email
    if (!user) {
      user = await PetOwner.findOne({ email: normalizedEmail });
      if (user) {
        actualRole = 'owner';
      }
    }

    if (!user) {
      user = await Veterinarian.findOne({ email: normalizedEmail, status: 'Active' })
        .populate('currentActiveClinicId', 'name address phoneNumber');
      if (user) {
        actualRole = 'vet';
      }
    }

    if (!user) {
      user = await ClinicStaff.findOne({ email: normalizedEmail, status: 'Active' })
        .populate('clinicId', 'name address phoneNumber');
      if (user) {
        actualRole = 'vet';
        user.currentActiveClinicId = user.clinicId;
      }
    }

    // If no user exists, register them automatically based on requested role
    if (!user) {
      if (role === 'vet') {
        // Fetch all existing clinics to assign to the new vet
        const allClinics = await Clinic.find({});
        const assignedClinics = allClinics.map(clinic => clinic._id);
        const currentActiveClinicId = assignedClinics.length > 0 ? assignedClinics[0] : null;

        // Create new Veterinarian
        user = new Veterinarian({
          firstName: given_name || normalizedEmail.split('@')[0],
          lastName: family_name || 'Veterinarian',
          email: normalizedEmail,
          googleId,
          accessLevel: 'Enhanced',
          status: 'Active',
          assignedClinics,
          clinicId: currentActiveClinicId,
          currentActiveClinicId
        });
      } else {
        // Create new Pet Owner
        user = new PetOwner({
          firstName: given_name || normalizedEmail.split('@')[0],
          lastName: family_name || 'Owner',
          email: normalizedEmail,
          googleId,
          profilePhoto: picture,
          address: 'Please update your address',
          phoneNumber: '0000000000'
        });
      }
      await user.save();
      actualRole = role;
      isNewUser = true;
    } else {
      // Link googleId if not linked, or update email if it changed in Google
      let updated = false;
      if (!user.googleId) {
        user.googleId = googleId;
        updated = true;
      }
      // Optional: keep email in sync with Google if it changed?
      // Some apps prefer to keep the original email for identification
      // For now, let's just make sure googleId is linked
      
      if (updated) {
        await user.save();
      }
    }

    if (user.isTwoFactorEnabled) {
      return res.status(200).json({
        success: true,
        requires2FA: true,
        userId: user._id,
        role: actualRole,
        message: '2FA verification required'
      });
    }

    const jwtToken = generateToken({
      id: user._id,
      email: user.email,
      role: actualRole
    });

    const responseUser = {
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: actualRole,
      phoneNumber: user.phoneNumber || null,
      address: user.address || null,
      profilePhoto: user.profilePhoto || null,
      isTwoFactorEnabled: user.isTwoFactorEnabled || false,
      hasPassword: !!user.passwordHash
    };

    if (actualRole === 'vet') {
      responseUser.accessLevel = user.accessLevel || null;
      responseUser.isPrimaryVet = user.isPrimaryVet || false;
      responseUser.staffRole = user.role || null;
      responseUser.veterinaryId = user.veterinaryId || null;
      if (user.currentActiveClinicId && typeof user.currentActiveClinicId === 'object') {
        responseUser.clinic = {
          id: user.currentActiveClinicId._id,
          name: user.currentActiveClinicId.name
        };
      }
    }

    return res.status(200).json({
      success: true,
      token: jwtToken,
      user: responseUser,
      isNewUser
    });
  } catch (error) {
    console.error('Google login error:', error);
    return res.status(500).json({ success: false, message: 'Google login failed', error: error.message });
  }
};

// ────────────────────────────────────────────────
// 2FA Setup
// ────────────────────────────────────────────────
exports.setup2FA = async (req, res) => {
  try {
    const userId = req.user.id;
    let user = await PetOwner.findById(userId) || await Veterinarian.findById(userId) || await ClinicStaff.findById(userId);

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const secret = speakeasy.generateSecret({ length: 20, name: `PetCare App (${user.email})` });

    user.twoFactorSecret = secret.base32;
    await user.save();

    qrcode.toDataURL(secret.otpauth_url, (err, data_url) => {
      if (err) return res.status(500).json({ success: false, message: 'Error generating QR code' });
      res.json({
        success: true,
        secret: secret.base32,
        qrCode: data_url
      });
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to setup 2FA', error: error.message });
  }
};

// ────────────────────────────────────────────────
// 2FA Verify & Enable / Login Verify
// ────────────────────────────────────────────────
exports.verify2FA = async (req, res) => {
  try {
    const { token, userId, role } = req.body;

    // Distinguish between logged-in user enabling 2FA vs user logging in
    const targetUserId = req.user ? req.user.id : userId;

    let user = null;
    if (role === 'vet') {
      user = await Veterinarian.findById(targetUserId).populate('currentActiveClinicId', 'name address phoneNumber');
      if (!user) {
        user = await ClinicStaff.findById(targetUserId).populate('clinicId', 'name address phoneNumber');
        if (user) user.currentActiveClinicId = user.clinicId;
      }
    } else {
      user = await PetOwner.findById(targetUserId);
    }

    if (!user) user = await Veterinarian.findById(targetUserId) || await ClinicStaff.findById(targetUserId) || await PetOwner.findById(targetUserId);

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: token
    });

    if (!verified) {
      return res.status(400).json({ success: false, message: 'Invalid 2FA token' });
    }

    // If enabling during setup
    if (req.user && !user.isTwoFactorEnabled) {
      user.isTwoFactorEnabled = true;
      await user.save();
      return res.json({ success: true, message: '2FA enabled successfully' });
    }

    // If verifying during login flow
    let actualRole = user.accessLevel ? 'vet' : 'owner';
    const jwtToken = generateToken({
      id: user._id,
      email: user.email,
      role: actualRole
    });

    const responseUser = {
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: actualRole,
      phoneNumber: user.phoneNumber || null,
      address: user.address || null
    };

    if (actualRole === 'vet') {
      responseUser.accessLevel = user.accessLevel || null;
      responseUser.isPrimaryVet = user.isPrimaryVet || false;
      responseUser.staffRole = user.role || null;
      if (user.currentActiveClinicId && typeof user.currentActiveClinicId === 'object') {
        responseUser.clinic = {
          id: user.currentActiveClinicId._id,
          name: user.currentActiveClinicId.name
        };
      }
    }

    res.json({
      success: true,
      message: '2FA verified. Login successful.',
      token: jwtToken,
      user: responseUser
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Verification failed', error: error.message });
  }
};

// ────────────────────────────────────────────────
// Disable 2FA
// ────────────────────────────────────────────────
exports.disable2FA = async (req, res) => {
  try {
    const userId = req.user.id;
    let user = await PetOwner.findById(userId) || await Veterinarian.findById(userId) || await ClinicStaff.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    user.isTwoFactorEnabled = false;
    user.twoFactorSecret = undefined;
    await user.save();

    res.json({ success: true, message: '2FA disabled successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to disable 2FA', error: error.message });
  }
};

// ────────────────────────────────────────────────
// Forgot Password 
// ────────────────────────────────────────────────
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const normalizedEmail = email.toLowerCase().trim();

    let user = await PetOwner.findOne({ email: normalizedEmail }) || await Veterinarian.findOne({ email: normalizedEmail }) || await ClinicStaff.findOne({ email: normalizedEmail });

    if (!user) {
      // Don't reveal user doesn't exist for security
      return res.status(200).json({ success: true, message: 'If that email exists, a reset link has been sent.' });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    user.resetPasswordExpires = Date.now() + 30 * 60 * 1000; // 30 minutes
    await user.save();

    // Mock sending email in console using nodemailer mock or raw text
    const resetUrl = `http://localhost:5173/reset-password/${resetToken}`;
    console.log(`\n\n--- FORGOT PASSWORD MOCK EMAIL ---`);
    console.log(`To: ${user.email}`);
    console.log(`Subject: Password Reset Request`);
    console.log(`Body: You requested a password reset. Please click the link to reset: ${resetUrl}`);
    console.log(`--- END MOCK EMAIL ---\n\n`);

    res.status(200).json({ success: true, message: 'If that email exists, a reset link has been sent.' });

  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to process forgot password request', error: error.message });
  }
};

// ────────────────────────────────────────────────
// Reset Password 
// ────────────────────────────────────────────────
exports.resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    let user = await PetOwner.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() }
    }) || await Veterinarian.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() }
    }) || await ClinicStaff.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) return res.status(400).json({ success: false, message: 'Invalid or expired reset token' });

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.json({ success: true, message: 'Password reset successful. You can now log in.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to reset password', error: error.message });
  }
};

// ────────────────────────────────────────────────
// Change Password 
// ────────────────────────────────────────────────
exports.changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const userId = req.user.id;

    if (!newPassword) {
      return res.status(400).json({ success: false, message: 'Please provide a new password' });
    }

    // Find user in any model - prioritize by role
    let user = null;
    if (req.user.role === 'vet') {
      user = await Veterinarian.findById(userId) || await ClinicStaff.findById(userId);
    } else {
      user = await PetOwner.findById(userId);
    }

    // Default fallback
    if (!user) {
      user = await PetOwner.findById(userId) || await Veterinarian.findById(userId) || await ClinicStaff.findById(userId);
    }

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // Handle users without a password (e.g. Google Auth users)
    if (!user.passwordHash) {
      // If it's a first time setting password, we don't need oldPassword
      // BUT we should verify that this was intended
      if (user.googleId) {
        console.log(`Setting initial password for Google user: ${user.email}`);
      } else {
        // This is weird (no password and no Google ID)
        return res.status(400).json({ 
          success: false, 
          message: 'Your account does not have a password set. This is unusual. Please contact support.' 
        });
      }
    } else {
      // Normal verification for users that HAVE a password
      if (!oldPassword) {
         return res.status(400).json({ success: false, message: 'Old password is required for security' });
      }
      const isMatch = await bcrypt.compare(oldPassword, user.passwordHash);
      if (!isMatch) {
         return res.status(401).json({ success: false, message: 'Incorrect old password' });
      }
    }

    // Hash and set new password
    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to change password', error: error.message });
  }
};