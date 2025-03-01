// Database Models

let mongoose = require('mongoose');
let bcrypt = require('bcryptjs');

let UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, unique: true, required: true },
  mobileNumber: { type: String, required: true },
  password: { type: String, required: true },
  role: {
    type: String,
    enum: ['admin', 'doctor', 'patient'],
    required: true
  },
  specialization: {
    type: String,
    enum: ['nerves', 'heart', 'lungs', 'skin'],
  },
  availableDays: {
    type: [String],
    enum: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  },
});

// Password hashing middleware
UserSchema.pre('save', async function (next) {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 10);
  }
  next();
});

// Check password validity
UserSchema.methods.comparePassword = async function (password) {
  return await bcrypt.compare(password, this.password);
};

module.exports = mongoose.model('User', UserSchema);


//Appointment Schema
let mongoose = require('mongoose');

let AppointmentSchema = new mongoose.Schema({
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  appointmentDateTime: { type: Date, required: true },
  symptoms: { type: String },
  fees: { type: Number },
  prescription: { type: String },
  isDiagnosisDone: { type: Boolean, default: false }
});

module.exports = mongoose.model('Appointment', AppointmentSchema);


//Authentication Routes JWT

let express = require('express');
let jwt = require('jsonwebtoken');
let bcrypt = require('bcryptjs');
let User = require('../models/User');
let router = express.Router();

// Register user (admin, doctor, patient)
router.post('/register', async (req, res) => {
    let { name, email, mobileNumber, password, role, specialization, availableDays } = req.body;
    let user = new User({ name, email, mobileNumber, password, role, specialization, availableDays });
  await user.save();
  res.status(201).json({ message: 'User registered successfully' });
});

// Login user
router.post('/login', async (req, res) => {
    let { email, password } = req.body;
    let user = await User.findOne({ email });
  if (!user || !(await user.comparePassword(password))) {
    return res.status(400).json({ message: 'Invalid credentials' });
  }
  let token = jwt.sign({ userId: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
  res.json({ token });
});

module.exports = router;


//Admin Routes

let express = require('express');
let User = require('../models/User');
let Appointment = require('../models/Appointment');
let router = express.Router();

// View all users
router.get('/users', async (req, res) => {
    let users = await User.find();
  res.json(users);
});

// View specific user by ID
router.get('/users/:id', async (req, res) => {
    let user = await User.findById(req.params.id);
  res.json(user);
});

// Delete a user
router.delete('/users/:id', async (req, res) => {
  await User.findByIdAndDelete(req.params.id);
  res.status(200).json({ message: 'User deleted successfully' });
});

// View all appointments
router.get('/appointments', async (req, res) => {
    let appointments = await Appointment.find().populate('patientId doctorId');
  res.json(appointments);
});

// Delete an appointment
router.delete('/appointments/:id', async (req, res) => {
  await Appointment.findByIdAndDelete(req.params.id);
  res.status(200).json({ message: 'Appointment deleted successfully' });
});

// Reports (CSV generation)
let ObjectToCSV = require('object-to-csv'); // library to convert JSON to CSV
router.get('/reports', async (req, res) => {
    let users = await User.aggregate([
    { $group: { _id: '$role', total: { $sum: 1 } } }
  ]);
  let appointmentsCount = await Appointment.countDocuments();

  let csvData = new ObjectToCSV([
    { TotalDoctors: users.find(u => u._id === 'doctor')?.total || 0 },
    { TotalPatients: users.find(u => u._id === 'patient')?.total || 0 },
    { TotalAppointments: appointmentsCount },
  ]);

  csvData.toDisk('./admin-reports.csv');
  res.download('./admin-reports.csv');
});

module.exports = router;


//Doctor Routes

let express = require('express');
let Appointment = require('../models/Appointment');
let router = express.Router();

// View all appointments assigned to the doctor
router.get('/appointments', async (req, res) => {
    let doctorAppointments = await Appointment.find({ doctorId: req.userId }).populate('patientId doctorId');
  res.json(doctorAppointments);
});

// Update appointment details (fees, prescription, etc.)
router.put('/appointments/:id', async (req, res) => {
    let appointment = await Appointment.findById(req.params.id);
  if (appointment) {
    appointment.fees = req.body.fees;
    appointment.prescription = req.body.prescription;
    appointment.isDiagnosisDone = req.body.isDiagnosisDone;
    await appointment.save();
    res.json({ message: 'Appointment updated successfully' });
  } else {
    res.status(404).json({ message: 'Appointment not found' });
  }
});

module.exports = router;


//Patient Routes

let express = require('express');
let Appointment = require('../models/Appointment');
let redis = require('redis');
let router = express.Router();

let client = redis.createClient();

// Book a new appointment
router.post('/appointments', async (req, res) => {
    let { doctorId, appointmentDateTime, symptoms } = req.body;
    let appointment = new Appointment({
    patientId: req.userId,
    doctorId,
    appointmentDateTime,
    symptoms,
  });
  await appointment.save();
  res.status(201).json({ message: 'Appointment booked successfully' });
});

// View all booked appointments
router.get('/appointments', async (req, res) => {
    let appointments = await Appointment.find({ patientId: req.userId });
  res.json(appointments);
});

// Update appointment details (if more than 24 hours remain)
router.put('/appointments/:id', async (req, res) => {
    let appointment = await Appointment.findById(req.params.id);
  if (new Date(appointment.appointmentDateTime) > Date.now() + 24 * 60 * 60 * 1000) {
    appointment.symptoms = req.body.symptoms;
    await appointment.save();
    res.json({ message: 'Appointment updated successfully' });
  } else {
    res.status(400).json({ message: 'Cannot modify appointment within 24 hours' });
  }
});

// Request appointment deletion (stored in Redis)
router.post('/appointments/request-delete/:id', async (req, res) => {
  client.set(req.params.id, JSON.stringify({ userId: req.userId, requestedAt: new Date() }));
  res.json({ message: 'Deletion request submitted' });
});

module.exports = router;
