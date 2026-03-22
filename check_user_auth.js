const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Veterinarian = require('./models/Veterinarian');
const ClinicStaff = require('./models/ClinicStaff');

dotenv.config();

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('Connected to MongoDB');
    
    // List collections to be sure
    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log('Collections:', collections.map(c => c.name));

    const email = 'dineshofficial2026@gmail.com';
    const id = '69bbfb4d7255a7499c0f929e';

    const vetByEmail = await Veterinarian.findOne({ email: new RegExp('^' + email + '$', 'i') });
    const vetById = await Veterinarian.findById(id);
    
    if (vetByEmail) console.log('Vet Found by Email');
    if (vetById) {
       console.log('Vet Found by ID');
       console.log('PasswordHash:', vetById.passwordHash);
       console.log('GoogleId:', vetById.googleId);
    } else {
       console.log('Vet Not Found by ID');
    }

    mongoose.disconnect();
  })
  .catch(err => console.error('Connection error:', err));
