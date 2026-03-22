const mongoose = require('mongoose');
const Veterinarian = require('./models/Veterinarian');

function testSchema() {
  const v = new Veterinarian({
    firstName: 'Test',
    lastName: 'User',
    email: 'test@test.com',
    accessLevel: 'Basic'
  });
  
  console.log('Document before save:', JSON.stringify(v, null, 2));
  console.log('Is veterinaryId in keys?', Object.keys(v.toObject()).includes('veterinaryId'));
  console.log('Value of veterinaryId:', v.veterinaryId);
}

testSchema();
