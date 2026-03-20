const mongoose = require('mongoose');
const Prescription = require('./models/Prescription');
const Appointment = require('./models/Appointment');
const MedicalRecord = require('./models/MedicalRecord');
const dotenv = require('dotenv');
dotenv.config();

async function findAbc() {
  const uri = 'mongodb+srv://saman2020al_db_user:C7yfY6OEsM3pobh5@pawpal.jkf03x8.mongodb.net/test?retryWrites=true&w=majority';
  await mongoose.connect(uri);
  const pres = await Prescription.findOne({ medicationName: 'Abc Test' }).populate('medicalRecordId');
  if (pres) {
    console.log('Pres data:', JSON.stringify(pres, null, 2));
    if (pres.medicalRecordId) {
      console.log('Linked MedicalRecord:', JSON.stringify(pres.medicalRecordId, null, 2));
      const appt = await Appointment.findById(pres.medicalRecordId.appointmentId);
      if (appt) {
        console.log('Linked Appointment:', JSON.stringify(appt, null, 2));
      } else {
        console.log('No appointment linked to medical record');
      }
    } else {
      console.log('No medical record linked to prescription');
    }
  } else {
    console.log('Prescription "Abc Test" not found');
  }
  process.exit(0);
}
findAbc();
