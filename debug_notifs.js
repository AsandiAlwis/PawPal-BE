const mongoose = require('mongoose');
const Appointment = require('./models/Appointment');
const PetProfile = require('./models/PetProfile');
const Veterinarian = require('./models/Veterinarian');
const dotenv = require('dotenv');

dotenv.config();

async function debugNotifications() {
  try {
    const uri = process.env.MONGO_URI || 'mongodb+srv://saman2020al_db_user:C7yfY6OEsM3pobh5@pawpal.jkf03x8.mongodb.net/PetCare?retryWrites=true&w=majority';
    await mongoose.connect(uri);
    console.log('Connected to MongoDB');

    const vetId = '694fae4fca17c25090ce82de';
    const clinicId = '69aad3b8db2247e5da2f6e67';
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    console.log('--- DEBUG INFO ---');
    console.log('Searching for Vet ID:', vetId);
    console.log('Searching for Clinic ID:', clinicId);
    console.log('Today (start of day):', today.toISOString());

    // 1. Check all appointments for this clinic
    const allClinicAppts = await Appointment.find({ clinicId: clinicId });
    console.log(`Total appointments for clinic ${clinicId}:`, allClinicAppts.length);
    if (allClinicAppts.length > 0) {
        console.log('Clinic appts status/date:', allClinicAppts.map(a => ({ id: a._id, status: a.status, date: a.dateTime, isRead: a.isReadByVet })));
    }

    // 2. Check all appointments for this vet
    const allVetAppts = await Appointment.find({ vetId: vetId });
    console.log(`Total appointments for vet ${vetId}:`, allVetAppts.length);
    if (allVetAppts.length > 0) {
        console.log('Vet appts status/date:', allVetAppts.map(a => ({ id: a._id, status: a.status, date: a.dateTime, isRead: a.isReadByVet })));
    }

    // 3. Check for specific Booked appointments
    const bookedAppts = await Appointment.find({ status: 'Booked' });
    console.log('All "Booked" appointments in system:', bookedAppts.length);
    if (bookedAppts.length > 0) {
        console.log('Booked appts clinics/vets:', bookedAppts.map(a => ({ id: a._id, clinic: a.clinicId, vet: a.vetId, date: a.dateTime, status: a.status })));
    }

    // 4. Check Veterinarian info
    const vet = await Veterinarian.findById(vetId);
    console.log('Vet access level:', vet.accessLevel);
    console.log('Vet active clinic:', vet.currentActiveClinicId);
    console.log('Vet owned clinics:', vet.ownedClinics);

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

debugNotifications();
