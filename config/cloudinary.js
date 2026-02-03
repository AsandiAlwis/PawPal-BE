// config/cloudinary.js
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'vet-medical-records', // organized folder
    allowed_formats: ['jpg', 'jpeg', 'png', 'pdf', 'gif'],
    resource_type: 'auto', // handles images + PDFs
    transformation: [{ width: 1000, height: 1000, crop: 'limit' }], // optional: resize large images
  },
});

module.exports = { cloudinary, storage };