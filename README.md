# PawPal: Comprehensive Pet Care Management System

PawPal is a modern, full-stack application designed to streamline pet healthcare management in Sri Lanka. It connects pet owners with veterinarians and clinics through an intuitive platform featuring real-time booking, medical record management, and an AI-powered veterinary assistant, **Dr. Sara**.

---

## 🏗️ System Architecture

The project is divided into three main components:

### 1. Backend (Node.js & Express)
- **Powering**: Core business logic, database management, and integrations.
- **Location**: `/Backend`
- **Port**: `5000`
- **Key Features**:
  *   **Authentication**: Secure JWT-based login for Owners, Vets, and Clinic Admins.
  *   **Database**: MongoDB (Mongoose) for scalable data storage.
  *   **Storage**: Cloudinary for medical record images and pet photos.
  *   **Communication**: Nodemailer for automated email notifications.
  *   **Real-time**: Socket.io for notifications and chat updates.

### 2. Frontend (React & Vite)
- **Powering**: The user interface and interactive dashboards.
- **Location**: `/frontend`
- **Port**: `5173`
- **Key Features**:
  *   **Owner Dashboard**: Manage pets, view medical history, and book appointments.
  *   **Dynamic Booking**: Smart time-slot generation based on clinic operating hours.
  *   **Vet/Clinic Dashboards**: Manage staff, approve appointments, and update medical records.
  *   **Responsive Design**: Premium UI built with Material-UI (MUI) and custom CSS.

### 3. AI Chatbot (Dr. Sara)
- **Powering**: RAG-based (Retrieval-Augmented Generation) veterinary diagnostics.
- **Location**: Root directory (`server.py` and `/chatbot`)
- **Port**: `5001` (Flask)
- **AI Core**:
  *   **Ollama**: Local LLM runner (Offline-first privacy).
  *   **Model**: `llama3.2:1b` (Optimized for speed/efficiency).
  *   **RAG Engine**: LangChain with FAISS vector store for accurate Sri Lanka-specific pet health advice.

---

## 🚀 How to Run the Project

### Prerequisites
1.  **Node.js** (v18+)
2.  **Python** (3.10+)
3.  **MongoDB** (Local or Atlas URI)
4.  **Ollama** (Downloaded and running)

### Step 1: Initialize the AI Model
Ensure Ollama is installed and the model is downloaded:
```bash
ollama run llama3.2:1b
```

### Step 2: Start the Backend (Node.js)
1.  Navigate to the Backend directory:
    ```bash
    cd Backend
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Configure `.env` (MONGO_URI, CLOUDINARY_URL, etc.).
4.  Run the server:
    ```bash
    npm run start  # or: node server.js
    ```

### Step 3: Start the UI (Frontend)
1.  Navigate to the frontend directory:
    ```bash
    cd ../frontend
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Run the development server:
    ```bash
    npm run dev
    ```

### Step 4: Start AI Chatbot
1.  In the root directory, install Python dependencies:
    ```bash
    pip install -r requirements.txt
    ```
2.  Run the Flask server:
    ```bash
    python server.py --port 5001
    ```

---

## 🛠️ Key Technologies
- **Frontend**: React, Material-UI, Axios, SweetAlert2.
- **Backend**: Node.js, Express, Mongoose, Socket.io.
- **AI/ML**: LangChain, FAISS, FastEmbed, Ollama.
- **Cloud**: Cloudinary (Media), MongoDB Atlas (Data), Gmail (SMTP).

---

## 📋 Note on Dynamic Appointment Slots
The system features a **smart scheduling engine** that automatically:
- Parses clinic hours (e.g., "8 AM - 2 PM").
- Checks clinic operating days.
- Filters out already-booked slots for specific veterinarians.
- Prevents same-day bookings for times that have already passed.

---

*PawPal - Making Pet Care Smarter in Sri Lanka.*
