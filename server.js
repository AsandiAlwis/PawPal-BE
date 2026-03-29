const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const axios = require('axios');
const path = require('path');
const fs = require('fs/promises');
const nodemailer = require('nodemailer');

dotenv.config({ quiet: true });

const app = express();
const http = require('http');
const { Server } = require('socket.io');
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'http://localhost:5173',
    methods: ['GET', 'POST', 'PATCH', 'PUT'],
    credentials: true
  }
});

// Attach io to app for use in controllers
app.set('socketio', io);

const PORT = process.env.PORT || 5000;

// === Cloudinary Configuration ===
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer + Cloudinary Storage
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'vet-medical-records',
    allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'pdf', 'doc', 'docx', 'xls', 'xlsx'],
    resource_type: 'auto',
    transformation: [{ width: 1000, height: 1000, crop: 'limit' }],
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/gif',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Images, PDFs, and Office documents are allowed.'), false);
    }
  }
});

// === Middleware ===
app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true
}));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// === MongoDB Connection ===
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected successfully'))
  .catch(err => {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  });

// === API Routes ===
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/owners', require('./routes/petOwnerRoutes'));
app.use('/api/pets', require('./routes/petProfileRoutes'));
app.use('/api/clinics', require('./routes/clinicRoutes'));
app.use('/api/vets', require('./routes/veterinarianRoutes'));
app.use('/api/appointments', require('./routes/appointmentRoutes'));
app.use('/api/medical-records', require('./routes/medicalRecordRoutes'));
app.use('/api/prescriptions', require('./routes/prescriptionRoutes'));
app.use('/api/chat', require('./routes/chatMessageRoutes'));
app.use('/api/upload', require('./routes/uploadRoutes'));

// === Nodemailer Configuration ===
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// === Contact Form API ===
app.post('/api/contact', async (req, res) => {
  const { name, email, phone, subject, message } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: 'pawpal2026@gmail.com',
    subject: `Pawpal Contact Form: ${subject || 'New Inquiry'}`,
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
        <h2 style="color: #10b981;">New Message from Pawpal Contact Us</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Phone:</strong> ${phone || 'N/A'}</p>
        <p><strong>Inquiry Type:</strong> ${subject}</p>
        <p><strong>Message:</strong></p>
        <div style="background: #f9f9f9; padding: 15px; border-radius: 5px; border-left: 4px solid #10b981;">
          ${message}
        </div>
        <hr style="margin-top: 20px;">
        <p style="font-size: 0.8rem; color: #777;">This email was sent from the Pawpal Contact Us form.</p>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    res.status(200).json({ success: true, message: 'Email sent successfully' });
  } catch (error) {
    console.error('Nodemailer Error:', error);
    res.status(500).json({ message: 'Failed to send email' });
  }
});

// === RAG CHATBOT USING YOUR PET_DATA FOLDER ===
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:latest';

const PET_DATA_FOLDER = path.join(__dirname, 'pet_data');

// Cache for loaded documents
let petKnowledgeBase = [];
let isOllamaAvailable = false;
let currentOllamaModel = OLLAMA_MODEL;

// Load all documents from pet_data folder
async function loadPetData() {

  try {
    // Check if folder exists
    await fs.access(PET_DATA_FOLDER);
    const files = await fs.readdir(PET_DATA_FOLDER);

    if (files.length === 0) {
      return;
    }

    let totalQuestions = 0;

    // Load each file
    for (const file of files) {
      const filePath = path.join(PET_DATA_FOLDER, file);

      try {
        if (file.endsWith('.txt')) {
          const content = await fs.readFile(filePath, 'utf-8');

          // Split text file into chunks for better search
          const chunks = splitTextIntoChunks(content, 500);

          chunks.forEach((chunk, index) => {
            petKnowledgeBase.push({
              id: `${file}_chunk_${index}`,
              content: chunk,
              source: file,
              type: 'text_chunk',
              metadata: {
                originalFile: file,
                chunkIndex: index,
                totalChunks: chunks.length
              }
            });
          });

          // chunks.forEach(...)

        } else if (file.endsWith('.json')) {
          const content = await fs.readFile(filePath, 'utf-8');
          const data = JSON.parse(content);

          if (Array.isArray(data)) {
            // Handle your Q&A JSON format
            data.forEach((item, index) => {
              if (item.question && item.answer) {
                petKnowledgeBase.push({
                  id: `${file}_qa_${index}`,
                  question: item.question,
                  content: `Question: ${item.question}\nAnswer: ${item.answer}`,
                  source: file,
                  type: 'qa_pair',
                  metadata: {
                    originalFile: file,
                    qaIndex: index
                  }
                });
                totalQuestions++;
              }
            });
              // totalQuestions++;
          } else {
            // Handle other JSON structures
            petKnowledgeBase.push({
              id: file,
              content: JSON.stringify(data, null, 2),
              source: file,
              type: 'json_data',
              metadata: { originalFile: file }
            });
              // metadata: { originalFile: file }
          }
        }
      } catch (fileError) {
        console.warn(`   ✗ Error processing ${file}:`, fileError.message);
      }
    }

    // petKnowledgeBase.push...

  } catch (error) {
    console.error(`❌ Error accessing pet_data folder:`, error.message);
  }
}

// Helper function to split text into chunks
function splitTextIntoChunks(text, chunkSize = 500) {
  const chunks = [];
  let start = 0;

  while (start < text.length) {
    let end = start + chunkSize;

    // Try to split at sentence boundaries
    if (end < text.length) {
      const lastPeriod = text.lastIndexOf('.', end);
      const lastNewline = text.lastIndexOf('\n', end);

      if (lastPeriod > start + chunkSize * 0.5) {
        end = lastPeriod + 1;
      } else if (lastNewline > start + chunkSize * 0.5) {
        end = lastNewline;
      }
    } else {
      end = text.length;
    }

    const chunk = text.substring(start, end).trim();
    if (chunk) {
      chunks.push(chunk);
    }

    start = end;
  }

  return chunks;
}

// Check Ollama availability
async function checkOllama() {
  try {
    const response = await axios.get(`${OLLAMA_BASE_URL}/api/tags`, {
      timeout: 5000
    });

    if (response.data && response.data.models) {
      const models = response.data.models;

      // Prioritize better models
      const preferredModels = ['llama3.2:latest', 'llama3.2', 'llama3.2:1b', 'llama3.2:3b'];

      let discoveredModel = null;

      // Try each preferred model until one works
      for (const pref of preferredModels) {
        const match = models.find(m => {
          const mName = m.name.toLowerCase();
          return mName === pref || mName.startsWith(pref + ':');
        });

        if (match) {
          // console.log(`🎯 Testing preferred model: ${match.name}`);
          try {
            const testResponse = await axios.post(`${OLLAMA_BASE_URL}/api/generate`, {
              model: match.name,
              prompt: "Say 'READY'",
              stream: false
            }, { timeout: 10000 });

            if (testResponse.data && testResponse.data.response) {
              discoveredModel = match.name;
              break;
            }
          } catch (e) {
            // console.log(`   Model ${match.name} test failed: ${e.message}`);
          }
        }
      }

      // Fallback
      if (!discoveredModel && models.length > 0) {
        for (const m of models) {
          if (preferredModels.some(p => m.name.toLowerCase().startsWith(p))) continue; // Already tried
          // console.log(`⚠️ Trying fallback model: ${m.name}`);
          try {
            const res = await axios.post(`${OLLAMA_BASE_URL}/api/generate`, {
              model: m.name,
              prompt: "Say 'READY'",
              stream: false
            }, { timeout: 10000 });
            if (res.data && res.data.response) {
              discoveredModel = m.name;
              break;
            }
          } catch (e) { }
        }
      }

      if (discoveredModel) {
        currentOllamaModel = discoveredModel;
        isOllamaAvailable = true;
      } else {
        console.log('⚠️ No functional AI models found in Ollama.');
        isOllamaAvailable = false;
      }
    }
  } catch (error) {
    console.log('⚠️ Ollama not available:', error.message);
    isOllamaAvailable = false;
  }
}

// Enhanced search in knowledge base
function searchKnowledgeBase(query) {
  if (petKnowledgeBase.length === 0) {
    return {
      context: "No pet health information available in the knowledge base.",
      sources: []
    };
  }

  const lowerQuery = query.toLowerCase();
  const queryWords = lowerQuery.split(' ')
    .filter(word => word.length > 2)
    .map(word => word.replace(/[^a-z]/g, ''));

  const relevantItems = [];

  // Score each knowledge item
  for (const item of petKnowledgeBase) {
    let score = 0;
    const searchText = (item.question ? item.question + ' ' : '') + item.content;
    const lowerContent = searchText.toLowerCase();

    // Exact phrase match (highest score)
    if (lowerContent.includes(lowerQuery)) {
      score += 10;
    }

    // Word matches
    for (const word of queryWords) {
      if (word.length > 2) {
        const regex = new RegExp(`\\b${word}\\b`, 'gi');
        const matches = (searchText.match(regex) || []).length;
        score += matches * 2;
      }
    }

    // Boost Q&A items that match questions
    if (item.type === 'qa_pair' && item.question.toLowerCase().includes(lowerQuery)) {
      score += 5;
    }

    // Category-based scoring
    if (lowerQuery.includes('food') || lowerQuery.includes('diet') || lowerQuery.includes('nutrition')) {
      if (lowerContent.includes('food') || lowerContent.includes('diet') || lowerContent.includes('nutrition')) {
        score += 3;
      }
    }

    if (lowerQuery.includes('vaccin') || lowerQuery.includes('shot')) {
      if (lowerContent.includes('vaccin') || lowerContent.includes('vaccination')) {
        score += 3;
      }
    }

    if (score > 0) {
      relevantItems.push({
        item: item,
        score: score
      });
    }
  }

  // Sort by relevance
  relevantItems.sort((a, b) => b.score - a.score);

  // Get top 5 most relevant items
  const topItems = relevantItems.slice(0, 5);

  if (topItems.length === 0) {
    // Return general information if no matches
    const generalItems = petKnowledgeBase.slice(0, 2);
    return {
      context: generalItems.map(item => item.content).join('\n\n'),
      sources: generalItems.map(item => item.source)
    };
  }

  // Combine content from top items
  let context = "";
  const sources = [];

  topItems.forEach((result, index) => {
    const item = result.item;

    if (item.type === 'qa_pair') {
      context += `Q: ${item.question}\nA: ${item.content.split('Answer: ')[1] || item.content}\n\n`;
    } else {
      context += `${item.content.substring(0, 600)}\n\n`;
    }

    if (!sources.includes(item.source)) {
      sources.push(item.source);
    }
  });

  return { context, sources };
}

// Get response from Ollama with context
async function getOllamaResponse(query, context) {
  try {
    const prompt = `[System Role]
You are Dr. Sara, an AI veterinary assistant for Pawpal (Sri Lanka).
Your mission is to provide helpful, safe, and accurate advice to pet owners.

[Context Info]
${context}

[Instructions]
1. SEARCH THE CONTEXT FIRST: If the answer is found in the "Context Info" above, use it as your primary source.
2. USE YOUR OWN KNOWLEDGE: If the answer is NOT in the context, use your professional veterinary knowledge to answer directly.
3. STRUCTURE & FORMATTING (CRITICAL):
   - Use plain bullet points with the "•" symbol.
   - NEVER use asterisks (*), hash symbols (#), or bold markers (**) for lists or formatting.
   - Use EXACTLY TWO newlines between every paragraph or section to ensure clear, vertical separation.
   - Headers should be plain text on their own line, NOT preceded by symbols.
   - Each bullet point or numbered item must be on its own line.
4. BE DIRECT: Start answering the question directly with a friendly tone. Do not use filler phrases.
5. PETS ONLY: Only answer questions about animals and pet health.
6. SAFETY: Always remind users to consult a local veterinarian in Sri Lanka.

[User Question]
${query}

[Dr. Sara's Response]`;

    // headers should be plain text...

    const response = await axios.post(`${OLLAMA_BASE_URL}/api/generate`, {
      model: currentOllamaModel,
      prompt: prompt,
      stream: false,
      options: {
        temperature: 0.7,
        num_predict: 800,
        top_p: 0.9,
        repeat_penalty: 1.1
      }
    }, { timeout: 45000 }); // Increased timeout

    // options: { ... }

    // Safety formatting: ensure bullets and numbers have newlines
    let cleaned = response.data.response;

    // 1. Standardize all bullet marks (•, *, -) into a unique internal placeholder first
    // This catches bullets at the start of any line or in the middle of sentences.
    cleaned = cleaned.replace(/(?:^|\s+)[•*-]\s+/gm, ' __BT__ ');

    // 2. Strip all '#' and leftovers '*' symbols (bolding/headers)
    cleaned = cleaned.replace(/[#*]+/g, '');

    // 3. Convert placeholders into "•" with mandatory double newlines for separation
    cleaned = cleaned.replace(/\s*__BT__\s+/g, '\n\n• ');

    // 4. Ensure double newlines before numbering (e.g. 1.)
    cleaned = cleaned.replace(/([^\n])\s*(\d+\.)\s+/g, '$1\n\n$2 ');

    // 5. Clean up excessive spacing
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    // 6. Handle cases where the text starts with a bullet but wasn't caught by the regex
    if (cleaned.startsWith('•') || cleaned.startsWith(' __BT__ ')) {
      cleaned = cleaned.replace(/^ __BT__ /, '• ');
    } else if (response.data.response.trim().startsWith('•') || response.data.response.trim().startsWith('*') || response.data.response.trim().startsWith('-')) {
      if (!cleaned.startsWith('• ')) cleaned = '• ' + cleaned.trim();
    }

    return cleaned.trim();

  } catch (error) {
    console.error('❌ Ollama API error:', error.message);

    // Check if it's a model not found error
    if (error.message.includes('model') && error.message.includes('not found')) {
      isOllamaAvailable = false;
    }

    throw error;
  }
}

// Initialize on startup
async function initializeChatbot() {
  await loadPetData();
  await checkOllama();
}

// Chatbot Endpoint
app.post('/api/pet-chatbot', async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Emergency detection
    const lowerMsg = message.toLowerCase();
    const emergencyKeywords = ['emergency', 'bleeding', 'choking', 'not breathing', 'poison', 'seizure', 'dying', 'urgent'];

    if (emergencyKeywords.some(keyword => lowerMsg.includes(keyword))) {
      const emergencyResponse = `🚨 **EMERGENCY DETECTED**

I understand this seems urgent. Please take these immediate steps:

1. **Stay calm** - Your pet needs you to be calm
2. **Call emergency vet immediately**: 011-2694533 (Colombo) or 077-1234567
3. **Do not give** any human medications unless instructed by a vet
4. **Keep your pet warm and still** during transport

**Sri Lanka Emergency Contacts:**
- Colombo Veterinary Hospital: 011-2694533
- Animal SOS: 011-2712755
- Kandy Veterinary Hospital: 081-2222444

⚠️ **This is an automated emergency alert. Please seek professional veterinary care immediately.**`;

      return res.json({
        response: emergencyResponse,
        emergency: true,
        source: 'emergency_protocol',
        aiGenerated: false
      });
    }

    // Search for relevant information
    const searchResult = searchKnowledgeBase(message);

    let response;
    let source;
    let aiGenerated = false;

    if (isOllamaAvailable && currentOllamaModel) {
      try {
        response = await getOllamaResponse(message, searchResult.context);
        source = 'ai_with_knowledge_base';
        aiGenerated = true;
      } catch (ollamaError) {
        response = `**Based on our pet health knowledge base:**\n\n`;

        // Format the knowledge base results nicely
        const qaPairs = searchResult.context.split('\n\n').filter(item => item.trim());
        qaPairs.forEach((qa, index) => {
          if (qa.includes('Q:') && qa.includes('A:')) {
            const [question, answer] = qa.split('\nA: ');
            response += `${question.replace('Q: ', '**')}**\n`;
            response += `${answer}\n\n`;
          } else {
            response += `${qa}\n\n`;
          }
        });

        source = 'knowledge_base_only';
        aiGenerated = false;
      }
    } else {
      response = `**Based on our pet health knowledge base:**\n\n`;

      // Format the knowledge base results nicely
      const qaPairs = searchResult.context.split('\n\n').filter(item => item.trim());
      qaPairs.forEach((qa, index) => {
        if (qa.includes('Q:') && qa.includes('A:')) {
          const [question, answer] = qa.split('\nA: ');
          response += `${question.replace('Q: ', '**')}**\n`;
          response += `${answer}\n\n`;
        } else {
          response += `${qa}\n\n`;
        }
      });

      source = 'knowledge_base_only';
      aiGenerated = false;
    }

    // Add disclaimer (but not if it's already in the AI response)
    if (!response.includes('Disclaimer') && !response.includes('consult a veterinarian')) {
      response += "\n---\n**Disclaimer:** This information is from our pet health knowledge base and should not replace professional veterinary advice. Always consult a veterinarian for your pet's specific needs in Sri Lanka.";
    }

    res.json({
      response: response,
      source: source,
      aiGenerated: aiGenerated,
      knowledgeSources: searchResult.sources,
      totalKnowledgeItems: petKnowledgeBase.length,
      modelUsed: aiGenerated ? currentOllamaModel : null
    });

  } catch (err) {
    console.error('❌ Chatbot error:', err.message);

    // Simple fallback
    const fallbackResponse = `I'm having trouble accessing our knowledge base right now. 

For immediate assistance with pet health questions in Sri Lanka, please contact:

**Emergency Contacts:**
- Colombo Veterinary Hospital: 011-2694533
- Animal SOS: 011-2712755
- 24/7 Pet Helpline: 011-2222222

Please try again in a few minutes or contact a veterinarian directly.`;

    res.status(500).json({
      response: fallbackResponse,
      error: 'Service error',
      fallback: true
    });
  }
});

// Simple test endpoint to verify Ollama works
app.get('/api/test-ollama', async (req, res) => {
  try {
    const testPrompt = "What are safe foods for dogs? Answer in 2 sentences.";

    const response = await axios.post(`${OLLAMA_BASE_URL}/api/generate`, {
      model: currentOllamaModel,
      prompt: testPrompt,
      stream: false,
      options: {
        temperature: 0.7,
        num_predict: 200
      }
    }, { timeout: 15000 });

    res.json({
      success: true,
      model: currentOllamaModel,
      prompt: testPrompt,
      response: response.data.response,
      ollamaAvailable: isOllamaAvailable
    });
  } catch (error) {
    res.json({
      success: false,
      error: error.message,
      ollamaAvailable: isOllamaAvailable,
      suggestion: "Make sure Ollama is running and the model is downloaded"
    });
  }
});

// Endpoint to reload knowledge base
app.post('/api/reload-knowledge', async (req, res) => {
  try {
    petKnowledgeBase = [];
    await loadPetData();

    res.json({
      success: true,
      message: 'Knowledge base reloaded',
      itemsLoaded: petKnowledgeBase.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    service: 'Pet Health Chatbot',
    timestamp: new Date().toISOString(),
    knowledgeBase: {
      totalItems: petKnowledgeBase.length,
      qaPairs: petKnowledgeBase.filter(item => item.type === 'qa_pair').length,
      sources: [...new Set(petKnowledgeBase.map(item => item.source))]
    },
    ai: {
      available: isOllamaAvailable,
      model: currentOllamaModel,
      baseUrl: OLLAMA_BASE_URL
    }
  });
});

// Error Handlers
app.use((err, req, res, next) => {
  console.error('❌ Server error:', err.stack);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ message: err.message });
  }
  res.status(500).json({
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
});

app.use((req, res) => {
  res.status(404).json({
    message: 'Route not found',
    url: req.originalUrl,
    availableEndpoints: {
      chatbot: 'POST /api/pet-chatbot',
      health: 'GET /health',
      testOllama: 'GET /api/test-ollama'
    }
  });
});

// Start server
async function startServer() {
  await initializeChatbot();

  // Socket.IO handlers
  io.on('connection', (socket) => {

    // Join a personal notification room (e.g. user_<userId>)
    socket.on('join_user', (userId) => {
      socket.join(`user_${userId}`);
    });

    // Join clinic notification room (e.g. clinic_<clinicId>)
    socket.on('join_clinic', (clinicId) => {
      socket.join(`clinic_${clinicId}`);
    });

    // Join pet-specific chat room for real-time messages
    socket.on('join_chat', (petId) => {
      socket.join(`chat_pet_${petId}`);
    });

    // Leave a pet chat room
    socket.on('leave_chat', (petId) => {
      socket.leave(`chat_pet_${petId}`);
    });

    // Legacy join (kept for backward compatibility)
    socket.on('join', (userId) => {
      socket.join(userId);
    });

    // Client disconnected
    socket.on('disconnect', () => {
    });
  });

  server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });

  process.on('SIGTERM', () => {
    console.log('SIGTERM received: Closing server...');
    server.close(() => mongoose.connection.close());
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

module.exports = { app, server, io };