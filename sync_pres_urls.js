const mongoose = require('mongoose');
const Appointment = require('./models/Appointment');
const MedicalRecord = require('./models/MedicalRecord');
const dotenv = require('dotenv');
dotenv.config();

async function syncPrescriptionUrls() {
  const uri = 'mongodb+srv://saman2020al_db_user:C7yfY6OEsM3pobh5@pawpal.jkf03x8.mongodb.net/test?retryWrites=true&w=majority';
  console.log('Connecting to:', uri);
  await mongoose.connect(uri);
  console.log('Connected to "test" DB.');
  
  const appts = await Appointment.find({ prescriptionUrl: { $exists: true, $ne: null, $ne: '' } });
  console.log(`Found ${appts.length} appointments with prescriptionUrl in the "test" DB`);
  
  let synced = 0;
  for (const appt of appts) {
    const record = await MedicalRecord.findOne({ appointmentId: appt._id });
    if (record) {
      if (!record.prescriptionUrl) {
        record.prescriptionUrl = appt.prescriptionUrl;
        await record.save();
        console.log(`Synced record for appt ${appt._id}`);
        synced++;
      }
    } else {
      console.log(`No medical record found for appt ${appt._id}`);
    }
  }
  
  console.log(`Synced ${synced} medical records with prescriptionUrls`);
  process.exit(0);
}
syncPrescriptionUrls();
